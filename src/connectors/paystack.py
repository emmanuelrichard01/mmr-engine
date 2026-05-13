# src/connectors/paystack.py
"""
Paystack PSP webhook connector.

Signature scheme: HMAC-SHA512
    Header:  X-Paystack-Signature
    Secret:  Paystack secret key (sk_live_... / sk_test_...)
    Input:   raw request body (bytes)
    Algo:    HMAC-SHA512(secret_key, raw_body)
    Compare: constant-time via hmac.compare_digest

Handled event types:
    - charge.success       → credit (payment received)
    - transfer.success     → debit  (payout completed)
    - transfer.failed      → debit  (payout failed — reconcile as expected)
    - transfer.reversed    → reversal (payout reversed)

All other event types are stored in Bronze but not processed to Silver.

References:
    - TDD §8.2: Paystack Connector
    - Paystack API Docs: https://paystack.com/docs/payments/webhooks
"""
import hashlib
import hmac
from typing import Any

from src.config import get_settings
from src.connectors.base import BasePSPConnector

# Paystack event types this system handles.
# Any other event type is valid but will be stored and flagged as unclassified.
HANDLED_EVENT_TYPES = {
    "charge.success",
    "transfer.success",
    "transfer.failed",
    "transfer.reversed",
}


class PaystackConnector(BasePSPConnector):
    """Paystack webhook validation and event extraction."""

    @property
    def psp_name(self) -> str:
        return "paystack"

    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Paystack signs webhooks with HMAC-SHA512 using the secret key.
        Header: X-Paystack-Signature
        Validation: HMAC-SHA512(secret_key, raw_body) == signature_header

        Uses hmac.compare_digest for constant-time comparison
        to prevent timing attacks.
        """
        settings = get_settings()
        expected = hmac.new(
            key=settings.paystack_secret_key.encode("utf-8"),
            msg=raw_body,
            digestmod=hashlib.sha512,
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header)

    def extract_event_type(self, payload: dict[str, Any]) -> str:
        """Extract event type from Paystack payload root."""
        return payload.get("event", "unknown")

    def is_handled_event(self, event_type: str) -> bool:
        """Check if this event type should be processed to Silver."""
        return event_type in HANDLED_EVENT_TYPES

    def extract_transaction_ref(self, payload: dict[str, Any]) -> str:
        """Extract the PSP transaction reference from the payload."""
        return payload.get("data", {}).get("reference", "")
