# tests/unit/test_idempotency.py
"""
Unit tests for idempotency key generation.

Tests verify that:
    1. Keys follow the canonical format: {psp}:{ref}:{event_type}
    2. Case normalisation is applied to PSP and event type
    3. Whitespace is trimmed from all components
    4. Different events for the same transaction produce different keys
    5. Same event data always produces the same key (deterministic)

References:
    - TDD §9.1: Idempotency Engine
    - Data Dictionary XR-005: Idempotency Key
"""
import pytest

from src.engine.idempotency import build_idempotency_key


class TestBuildIdempotencyKey:
    """Tests for idempotency key generation."""

    def test_standard_key(self):
        """Standard key format: psp:ref:event_type"""
        key = build_idempotency_key("paystack", "T_abc123xyz", "charge.success")
        assert key == "paystack:T_abc123xyz:charge.success"

    def test_flutterwave_key(self):
        """Flutterwave key with different ref format."""
        key = build_idempotency_key("flutterwave", "FLW-TXN-99887", "charge.completed")
        assert key == "flutterwave:FLW-TXN-99887:charge.completed"

    def test_psp_name_lowercased(self):
        """PSP name should be lowercased."""
        key = build_idempotency_key("PAYSTACK", "ref123", "charge.success")
        assert key.startswith("paystack:")

    def test_event_type_lowercased(self):
        """Event type should be lowercased."""
        key = build_idempotency_key("paystack", "ref123", "CHARGE.SUCCESS")
        assert key.endswith("charge.success")

    def test_reference_preserved(self):
        """Transaction reference case should be preserved (PSP-specific)."""
        key = build_idempotency_key("paystack", "T_AbC123", "charge.success")
        assert "T_AbC123" in key

    def test_whitespace_trimmed(self):
        """Whitespace should be trimmed from all components."""
        key = build_idempotency_key("  paystack  ", " ref123 ", " charge.success ")
        assert key == "paystack:ref123:charge.success"

    def test_deterministic(self):
        """Same inputs always produce the same key."""
        key1 = build_idempotency_key("paystack", "ref123", "charge.success")
        key2 = build_idempotency_key("paystack", "ref123", "charge.success")
        assert key1 == key2

    def test_different_events_different_keys(self):
        """Different event types for the same transaction produce different keys."""
        key1 = build_idempotency_key("paystack", "ref123", "charge.success")
        key2 = build_idempotency_key("paystack", "ref123", "transfer.success")
        assert key1 != key2

    def test_different_psps_different_keys(self):
        """Same ref on different PSPs produces different keys."""
        key1 = build_idempotency_key("paystack", "ref123", "charge.success")
        key2 = build_idempotency_key("flutterwave", "ref123", "charge.success")
        assert key1 != key2

    def test_key_components_count(self):
        """Key should have exactly 3 colon-separated components."""
        key = build_idempotency_key("paystack", "ref123", "charge.success")
        parts = key.split(":")
        assert len(parts) == 3
