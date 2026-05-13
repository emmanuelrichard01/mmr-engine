# tests/unit/test_normaliser.py
"""
Unit tests for Silver normaliser.

Tests verify:
    1. Paystack kobo → NGN conversion (divide by 100)
    2. Flutterwave major unit passthrough
    3. PII masking applied to all sensitive fields
    4. Idempotency key format in output
    5. Settlement status mapping per event type
    6. has_pii_masked always True

References:
    - TDD §9.4: Silver Normaliser
"""
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from src.engine.normaliser import (
    normalise_paystack_event,
    normalise_flutterwave_event,
    _parse_timestamp,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

PAYSTACK_CHARGE_SUCCESS = {
    "event": "charge.success",
    "data": {
        "id": 123456,
        "reference": "T_abc123xyz",
        "amount": 5000000,          # 50,000 NGN in kobo
        "currency": "NGN",
        "status": "success",
        "paid_at": "2026-05-01T08:12:00.000Z",
        "channel": "card",
        "fees": 145000,             # 1,450 NGN in kobo
        "authorization": {
            "account_number": "0123456789",
            "account_name": "Chioma Okonkwo",
            "bank_code": "057",
            "bank": "Zenith Bank",
        },
        "customer": {
            "email": "chioma@example.com"    # PII — must never appear in Silver
        },
        "metadata": {
            "custom_fields": [{"value": "Monthly subscription"}]
        },
    },
}

FLUTTERWAVE_CHARGE_COMPLETED = {
    "event": "charge.completed",
    "data": {
        "id": 789012,
        "tx_ref": "FLW-TXN-99887",
        "flw_ref": "FLW-MOCK-abc123",
        "amount": 50000,            # 50,000 NGN (major units)
        "currency": "NGN",
        "status": "successful",
        "created_at": "2026-05-01T08:12:00.000Z",
        "customer": {
            "name": "Ade Johnson",
            "email": "ade@example.com"
        },
        "account": {
            "account_number": "9876543210",
            "account_name": "ADE JOHNSON",
            "bank_code": "058",
            "bank": "GTBank",
        },
        "app_fee": 200,
        "merchant_fee": 1250,
        "narration": "Payment for order #1234",
    },
}


class TestNormalisePaystackEvent:
    """Tests for Paystack normalisation."""

    def setup_method(self):
        self.bronze_id = uuid4()
        self.run_id = uuid4()

    def test_kobo_to_ngn_conversion(self):
        """5,000,000 kobo should become 50,000.00 NGN."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["amount_raw"] == Decimal("50000")
        assert result["amount_ngn"] == Decimal("50000")

    def test_currency_preserved(self):
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["currency_raw"] == "NGN"

    def test_pii_masked(self):
        """Account number and name should be masked."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        # Account: 0123456789 → 01******89
        assert result["beneficiary_account_masked"] == "01******89"
        # Name: Chioma Okonkwo → C***** O******
        assert result["beneficiary_name_masked"].startswith("C")
        assert "*" in result["beneficiary_name_masked"]

    def test_email_not_in_output(self):
        """Customer email (PII) should never appear in the Silver record."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        output_str = str(result)
        assert "chioma@example.com" not in output_str

    def test_has_pii_masked_flag(self):
        """has_pii_masked must always be True for CHECK constraint."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["has_pii_masked"] is True

    def test_idempotency_key_format(self):
        """Key should follow psp:ref:event format."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["idempotency_key"] == "paystack:T_abc123xyz:charge.success"

    def test_transaction_type_credit(self):
        """charge.success → credit"""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["transaction_type"] == "credit"

    def test_settlement_status_settled(self):
        """charge.success → settled"""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["settlement_status"] == "settled"

    def test_fees_extracted(self):
        """Fees should be converted from kobo to NGN in metadata."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["psp_metadata"]["fees_ngn"] == 1450.0

    def test_lineage_preserved(self):
        """Bronze ingestion ID and run ID should be preserved."""
        result = normalise_paystack_event(
            PAYSTACK_CHARGE_SUCCESS, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["bronze_ingestion_id"] == self.bronze_id
        assert result["processed_by_run_id"] == self.run_id

    def test_non_ngn_requires_fx_rate(self):
        """Non-NGN currency without FX rate should raise ValueError."""
        payload = {
            "event": "charge.success",
            "data": {
                **PAYSTACK_CHARGE_SUCCESS["data"],
                "currency": "USD",
            },
        }
        with pytest.raises(ValueError, match="FX rate required"):
            normalise_paystack_event(
                payload, self.bronze_id, self.run_id,
                None, None, None,
            )


class TestNormaliseFlutterwaveEvent:
    """Tests for Flutterwave normalisation."""

    def setup_method(self):
        self.bronze_id = uuid4()
        self.run_id = uuid4()

    def test_major_unit_passthrough(self):
        """Flutterwave amounts are already in major units — no division."""
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["amount_raw"] == Decimal("50000")
        assert result["amount_ngn"] == Decimal("50000")

    def test_pii_masked(self):
        """Account number and name should be masked."""
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["beneficiary_account_masked"] == "98******10"
        assert result["beneficiary_name_masked"].startswith("A")
        assert "*" in result["beneficiary_name_masked"]

    def test_idempotency_key_format(self):
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["idempotency_key"] == "flutterwave:FLW-TXN-99887:charge.completed"

    def test_transaction_type_credit(self):
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["transaction_type"] == "credit"

    def test_has_pii_masked_flag(self):
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["has_pii_masked"] is True

    def test_flw_ref_in_metadata(self):
        """Flutterwave internal ref should be in metadata."""
        result = normalise_flutterwave_event(
            FLUTTERWAVE_CHARGE_COMPLETED, self.bronze_id, self.run_id,
            None, None, None,
        )
        assert result["psp_metadata"]["flw_ref"] == "FLW-MOCK-abc123"


class TestParseTimestamp:
    """Tests for timestamp parsing."""

    def test_iso_with_z(self):
        """ISO 8601 with Z suffix."""
        result = _parse_timestamp("2026-05-01T08:12:00.000Z")
        assert result.tzinfo is not None
        assert result.year == 2026

    def test_iso_with_offset(self):
        """ISO 8601 with UTC offset."""
        result = _parse_timestamp("2026-05-01T09:12:00+01:00")
        assert result.tzinfo is not None

    def test_none_input(self):
        assert _parse_timestamp(None) is None

    def test_empty_string(self):
        assert _parse_timestamp("") is None
