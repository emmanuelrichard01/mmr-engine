# tests/unit/test_connectors.py
"""
Unit tests for PSP webhook connectors.

Tests verify:
    1. Paystack HMAC-SHA512 signature validation
    2. Flutterwave secret hash validation
    3. Event type extraction from payloads
    4. RawWebhookEvent construction
    5. Handled vs unhandled event classification

References:
    - TDD §8.2: Paystack Connector
    - TDD §8.3: Flutterwave Connector
"""
import hashlib
import hmac
import json
from unittest.mock import patch

import pytest

from src.connectors.paystack import PaystackConnector, HANDLED_EVENT_TYPES as PS_EVENTS
from src.connectors.flutterwave import FlutterwaveConnector, HANDLED_EVENT_TYPES as FLW_EVENTS
from src.connectors.base import RawWebhookEvent


class TestPaystackConnector:
    """Tests for PaystackConnector."""

    def setup_method(self):
        self.connector = PaystackConnector()
        self.secret_key = "sk_test_abc123"

    def test_psp_name(self):
        assert self.connector.psp_name == "paystack"

    @patch("src.connectors.paystack.get_settings")
    def test_valid_signature(self, mock_settings):
        """Valid HMAC-SHA512 signature should return True."""
        mock_settings.return_value.paystack_secret_key = self.secret_key
        body = b'{"event": "charge.success", "data": {}}'

        expected_sig = hmac.new(
            key=self.secret_key.encode("utf-8"),
            msg=body,
            digestmod=hashlib.sha512,
        ).hexdigest()

        assert self.connector.validate_signature(body, expected_sig) is True

    @patch("src.connectors.paystack.get_settings")
    def test_invalid_signature(self, mock_settings):
        """Invalid signature should return False."""
        mock_settings.return_value.paystack_secret_key = self.secret_key
        body = b'{"event": "charge.success", "data": {}}'

        assert self.connector.validate_signature(body, "bad_signature") is False

    @patch("src.connectors.paystack.get_settings")
    def test_tampered_body(self, mock_settings):
        """Signature computed on original body should fail on tampered body."""
        mock_settings.return_value.paystack_secret_key = self.secret_key
        original_body = b'{"event": "charge.success", "data": {}}'
        tampered_body = b'{"event": "charge.success", "data": {"amount": 999}}'

        sig = hmac.new(
            key=self.secret_key.encode("utf-8"),
            msg=original_body,
            digestmod=hashlib.sha512,
        ).hexdigest()

        assert self.connector.validate_signature(tampered_body, sig) is False

    def test_extract_event_type(self):
        """Should extract event type from payload root."""
        payload = {"event": "charge.success", "data": {}}
        assert self.connector.extract_event_type(payload) == "charge.success"

    def test_extract_event_type_missing(self):
        """Missing event key should return 'unknown'."""
        assert self.connector.extract_event_type({}) == "unknown"

    def test_handled_events(self):
        """All documented Paystack events should be handled."""
        assert self.connector.is_handled_event("charge.success") is True
        assert self.connector.is_handled_event("transfer.success") is True
        assert self.connector.is_handled_event("transfer.failed") is True
        assert self.connector.is_handled_event("transfer.reversed") is True

    def test_unhandled_event(self):
        """Unknown event types should not be handled."""
        assert self.connector.is_handled_event("subscription.created") is False

    def test_build_event(self):
        """build_event should produce a RawWebhookEvent with SHA-256 hash."""
        payload = {"event": "charge.success", "data": {"reference": "ref123"}}
        body = json.dumps(payload).encode()
        event = self.connector.build_event(body, payload, "2026-05-01T08:00:00Z")

        assert isinstance(event, RawWebhookEvent)
        assert event.psp_name == "paystack"
        assert event.event_type == "charge.success"
        assert event.content_hash == hashlib.sha256(body).hexdigest()
        assert event.received_at == "2026-05-01T08:00:00Z"

    def test_extract_transaction_ref(self):
        """Should extract reference from data.reference."""
        payload = {"data": {"reference": "T_abc123"}}
        assert self.connector.extract_transaction_ref(payload) == "T_abc123"


class TestFlutterwaveConnector:
    """Tests for FlutterwaveConnector."""

    def setup_method(self):
        self.connector = FlutterwaveConnector()
        self.secret_hash = "flw_hash_abc123"

    def test_psp_name(self):
        assert self.connector.psp_name == "flutterwave"

    @patch("src.connectors.flutterwave.get_settings")
    def test_valid_signature(self, mock_settings):
        """Matching secret hash should return True."""
        mock_settings.return_value.flutterwave_secret_hash = self.secret_hash
        body = b'{"event": "charge.completed"}'

        assert self.connector.validate_signature(body, self.secret_hash) is True

    @patch("src.connectors.flutterwave.get_settings")
    def test_invalid_signature(self, mock_settings):
        """Non-matching hash should return False."""
        mock_settings.return_value.flutterwave_secret_hash = self.secret_hash
        body = b'{"event": "charge.completed"}'

        assert self.connector.validate_signature(body, "wrong_hash") is False

    def test_extract_event_type(self):
        payload = {"event": "charge.completed", "data": {}}
        assert self.connector.extract_event_type(payload) == "charge.completed"

    def test_handled_events(self):
        assert self.connector.is_handled_event("charge.completed") is True
        assert self.connector.is_handled_event("transfer.completed") is True

    def test_unhandled_event(self):
        assert self.connector.is_handled_event("payment.refund") is False

    def test_extract_transaction_ref(self):
        payload = {"data": {"tx_ref": "FLW-TXN-99887"}}
        assert self.connector.extract_transaction_ref(payload) == "FLW-TXN-99887"
