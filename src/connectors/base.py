# src/connectors/base.py
"""
Abstract base connector for PSP webhook adapters.

Each PSP connector:
    1. Validates the HMAC signature (PSP-specific scheme)
    2. Extracts the event type from the payload
    3. Wraps the validated payload into a RawWebhookEvent

The connector's job is to validate and wrap — not transform.
Transformation to the canonical schema happens in the Silver normaliser.

References:
    - TDD §8.1: Abstract Base
    - API Specification §3.1: Webhook Endpoints
"""
import hashlib
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class RawWebhookEvent:
    """Normalised container for a validated PSP webhook event."""

    psp_name: str
    event_type: str
    raw_payload: dict[str, Any]
    content_hash: str
    received_at: str  # ISO 8601 UTC


class BasePSPConnector(ABC):
    """
    Abstract base for all PSP webhook connectors.

    Each PSP has:
    - A unique HMAC signature scheme
    - A unique event type vocabulary
    - A unique payload structure

    The connector's job is to validate and wrap — not transform.
    Transformation to the canonical schema happens in the Silver normaliser.
    """

    @property
    @abstractmethod
    def psp_name(self) -> str:
        """Return the canonical PSP identifier (lowercase)."""
        ...

    @abstractmethod
    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Verify the PSP's HMAC signature.
        Returns False (not raise) on invalid — caller decides to reject.
        """
        ...

    @abstractmethod
    def extract_event_type(self, payload: dict[str, Any]) -> str:
        """Extract the event type string from the PSP payload."""
        ...

    def build_event(
        self,
        raw_body: bytes,
        payload: dict[str, Any],
        received_at: str,
    ) -> RawWebhookEvent:
        """Wrap a validated payload into a RawWebhookEvent."""
        return RawWebhookEvent(
            psp_name=self.psp_name,
            event_type=self.extract_event_type(payload),
            raw_payload=payload,
            content_hash=hashlib.sha256(raw_body).hexdigest(),
            received_at=received_at,
        )
