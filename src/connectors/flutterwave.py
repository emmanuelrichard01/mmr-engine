# src/connectors/flutterwave.py
"""
Flutterwave PSP webhook connector.

Signature scheme: Secret Hash comparison
    Header:  verif-hash
    Secret:  Configured webhook secret hash (FLUTTERWAVE_SECRET_HASH)
    Compare: constant-time via hmac.compare_digest

Handled event types:
    - charge.completed     → credit (payment received)
    - transfer.completed   → debit  (payout completed)

Key difference from Paystack:
    - Amounts are in major currency units (NGN, not kobo)
    - Uses tx_ref as the primary transaction reference
    - Uses flw_ref as the Flutterwave internal reference

References:
    - TDD §8.3: Flutterwave Connector
    - Flutterwave Docs: https://developer.flutterwave.com/docs/integration-guides/webhooks
"""
import hmac
from typing import Any

from src.config import get_settings
from src.connectors.base import BasePSPConnector

HANDLED_EVENT_TYPES = {
    "charge.completed",
    "transfer.completed",
}


class FlutterwaveConnector(BasePSPConnector):
    """Flutterwave webhook validation and event extraction."""

    @property
    def psp_name(self) -> str:
        return "flutterwave"

    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Flutterwave uses a simpler scheme: compare the
        verif-hash header directly against a configured secret hash.
        Header: verif-hash
        """
        settings = get_settings()
        return hmac.compare_digest(
            settings.flutterwave_secret_hash,
            signature_header,
        )

    def extract_event_type(self, payload: dict[str, Any]) -> str:
        """Extract event type from Flutterwave payload root."""
        return payload.get("event", "unknown")

    def is_handled_event(self, event_type: str) -> bool:
        """Check if this event type should be processed to Silver."""
        return event_type in HANDLED_EVENT_TYPES

    def extract_transaction_ref(self, payload: dict[str, Any]) -> str:
        """Extract the PSP transaction reference from the payload."""
        return payload.get("data", {}).get("tx_ref", "")
