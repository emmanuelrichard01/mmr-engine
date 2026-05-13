# tests/contracts/test_silver_schema.py
"""
Contract tests for Silver canonical Pandera schema.

Verifies that:
    1. Valid Silver records pass all checks
    2. Negative amounts are rejected
    3. has_pii_masked=False is rejected
    4. Invalid settlement status is rejected
    5. Invalid PSP name is rejected
    6. Malformed idempotency key is rejected
    7. Invalid currency is rejected
    8. Invalid transaction type is rejected

These tests validate the schema contract boundary between
the ingestion pipeline and the canonical ledger.

References:
    - TDD §9.5: Schema Contracts
    - ERD §6.5: silver_canonical_transactions constraints
"""
import pandas as pd
import pandera
import pytest
from datetime import datetime, timezone

from src.contracts.silver.canonical_schema import SILVER_CANONICAL_SCHEMA


def _valid_silver_row():
    """Factory for a valid Silver canonical row."""
    return {
        "idempotency_key": "paystack:T_abc123xyz:charge.success",
        "psp_name": "paystack",
        "psp_transaction_ref": "T_abc123xyz",
        "psp_event_type": "charge.success",
        "transaction_type": "credit",
        "amount_raw": 50000.0,
        "currency_raw": "NGN",
        "amount_ngn": 50000.0,
        "settlement_status": "settled",
        "has_pii_masked": True,
        "beneficiary_account_masked": "01******89",
        "beneficiary_bank_code": "057",
        "beneficiary_bank_name": "Zenith Bank",
        "beneficiary_name_masked": "C***** O******",
        "sender_account_masked": None,
        "sender_bank_code": None,
        "sender_bank_name": None,
        "narration": "Monthly subscription",
        "initiated_at": pd.Timestamp.now(tz="UTC"),
        "settled_at": pd.Timestamp.now(tz="UTC"),
        "expected_settlement_at": None,
    }


class TestSilverSchemaValidRecords:
    """Tests that valid records pass."""

    def test_complete_record_passes(self):
        """Fully populated Silver record should pass."""
        df = pd.DataFrame([_valid_silver_row()])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1

    def test_nullable_fields_all_none(self):
        """Records with all nullable fields as None should pass."""
        row = _valid_silver_row()
        row["beneficiary_account_masked"] = None
        row["beneficiary_bank_code"] = None
        row["beneficiary_bank_name"] = None
        row["beneficiary_name_masked"] = None
        row["narration"] = None
        row["settled_at"] = None
        row["expected_settlement_at"] = None
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1

    def test_flutterwave_record(self):
        """Flutterwave record should pass."""
        row = _valid_silver_row()
        row["psp_name"] = "flutterwave"
        row["idempotency_key"] = "flutterwave:FLW-TXN-99887:charge.completed"
        row["psp_event_type"] = "charge.completed"
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1


class TestSilverSchemaAmountValidation:
    """Tests that amount rules are enforced."""

    def test_negative_amount_raw_rejected(self):
        """Negative amount_raw should fail."""
        row = _valid_silver_row()
        row["amount_raw"] = -50000.0
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_zero_amount_rejected(self):
        """Zero amount should fail (must be > 0)."""
        row = _valid_silver_row()
        row["amount_raw"] = 0.0
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_negative_amount_ngn_rejected(self):
        """Negative amount_ngn should fail."""
        row = _valid_silver_row()
        row["amount_ngn"] = -1.0
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)


class TestSilverSchemaPIIFlag:
    """Tests that PII masking flag is enforced."""

    def test_pii_masked_false_rejected(self):
        """has_pii_masked=False should fail — PII not scrubbed."""
        row = _valid_silver_row()
        row["has_pii_masked"] = False
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_pii_masked_true_passes(self):
        """has_pii_masked=True should pass."""
        row = _valid_silver_row()
        row["has_pii_masked"] = True
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1


class TestSilverSchemaEnumValidation:
    """Tests that enum values are enforced."""

    def test_invalid_psp_rejected(self):
        """Unknown PSP should fail."""
        row = _valid_silver_row()
        row["psp_name"] = "unknown_psp"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_invalid_settlement_status_rejected(self):
        """Invalid settlement status should fail."""
        row = _valid_silver_row()
        row["settlement_status"] = "unknown_status"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_all_valid_settlement_statuses(self):
        """All valid settlement statuses should pass."""
        for status in ["pending", "settled", "failed", "reversed"]:
            row = _valid_silver_row()
            row["settlement_status"] = status
            df = pd.DataFrame([row])
            result = SILVER_CANONICAL_SCHEMA.validate(df)
            assert len(result) == 1

    def test_invalid_currency_rejected(self):
        """Currency not in ISO 4217 subset should fail."""
        row = _valid_silver_row()
        row["currency_raw"] = "FAKE"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_all_valid_currencies(self):
        """All supported currencies should pass."""
        for currency in ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR"]:
            row = _valid_silver_row()
            row["currency_raw"] = currency
            df = pd.DataFrame([row])
            result = SILVER_CANONICAL_SCHEMA.validate(df)
            assert len(result) == 1

    def test_invalid_transaction_type_rejected(self):
        """Invalid transaction type should fail."""
        row = _valid_silver_row()
        row["transaction_type"] = "refund"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)


class TestSilverSchemaIdempotencyKey:
    """Tests that idempotency key format is enforced."""

    def test_malformed_key_rejected(self):
        """Key without colons should fail regex."""
        row = _valid_silver_row()
        row["idempotency_key"] = "no_colons_here"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_short_key_rejected(self):
        """Key shorter than 10 chars should fail."""
        row = _valid_silver_row()
        row["idempotency_key"] = "a:b:c"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_valid_key_format(self):
        """Well-formed key should pass."""
        row = _valid_silver_row()
        row["idempotency_key"] = "paystack:T_abc123:charge.success"
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1


class TestSilverSchemaNUBANMasking:
    """Tests that raw NUBAN detection works (correctness property C-003)."""

    def test_raw_nuban_in_beneficiary_rejected(self):
        """A raw 10-digit account number in beneficiary field should fail."""
        row = _valid_silver_row()
        row["beneficiary_account_masked"] = "0123456789"  # Raw NUBAN!
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError, match="C-003"):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_raw_nuban_in_sender_rejected(self):
        """A raw 10-digit account number in sender field should fail."""
        row = _valid_silver_row()
        row["sender_account_masked"] = "9876543210"  # Raw NUBAN!
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError, match="C-003"):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_properly_masked_account_passes(self):
        """Properly masked account (01******89) should pass."""
        row = _valid_silver_row()
        row["beneficiary_account_masked"] = "01******89"
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1

    def test_null_account_passes_nuban_check(self):
        """None account (nullable) should pass NUBAN check."""
        row = _valid_silver_row()
        row["beneficiary_account_masked"] = None
        row["sender_account_masked"] = None
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1


class TestSilverSchemaFXCrossField:
    """Tests FX cross-field validation (correctness property C-006)."""

    def test_non_ngn_without_fx_rate_rejected(self):
        """USD transaction without fx_rate_snapshot_id should fail."""
        row = _valid_silver_row()
        row["currency_raw"] = "USD"
        row["fx_rate_snapshot_id"] = None  # Missing!
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError, match="C-006"):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_non_ngn_with_fx_rate_passes(self):
        """USD transaction with fx_rate_snapshot_id should pass."""
        row = _valid_silver_row()
        row["currency_raw"] = "USD"
        row["fx_rate_snapshot_id"] = 42
        row["amount_raw"] = 31.65
        row["amount_ngn"] = 50000.0
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1

    def test_ngn_without_fx_rate_passes(self):
        """NGN transaction without fx_rate_snapshot_id should pass — no FX needed."""
        row = _valid_silver_row()
        row["currency_raw"] = "NGN"
        row["fx_rate_snapshot_id"] = None
        df = pd.DataFrame([row])
        result = SILVER_CANONICAL_SCHEMA.validate(df)
        assert len(result) == 1

