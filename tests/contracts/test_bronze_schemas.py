# tests/contracts/test_bronze_schemas.py
"""
Contract tests for Bronze Pandera schemas.

Verifies that:
    1. Valid Bronze records pass validation
    2. Missing required columns are rejected
    3. Invalid source types are rejected
    4. Extra columns are allowed (schema-on-read)
    5. Coercion handles common type mismatches

References:
    - TDD §9.5: Schema Contracts
"""
import pandas as pd
import pandera
import pytest
from datetime import datetime, timezone

from src.contracts.bronze.paystack_schema import PAYSTACK_BRONZE_SCHEMA
from src.contracts.bronze.flutterwave_schema import FLUTTERWAVE_BRONZE_SCHEMA


def _valid_bronze_row():
    """Factory for a valid Bronze row."""
    return {
        "_ingestion_id": "abc-123-def-456",
        "_received_at": pd.Timestamp.now(tz="UTC"),
        "_source_type": "webhook",
        "_content_hash": "sha256_abcdef1234567890",
        "_kafka_offset": 42,
        "event": "charge.success",
        "data": '{"amount": 5000000, "currency": "NGN"}',
    }


class TestPaystackBronzeSchema:
    """Tests for Paystack Bronze schema validation."""

    def test_valid_record_passes(self):
        """A well-formed Bronze record should pass."""
        df = pd.DataFrame([_valid_bronze_row()])
        result = PAYSTACK_BRONZE_SCHEMA.validate(df)
        assert len(result) == 1

    def test_missing_event_fails(self):
        """Missing required 'event' column should fail."""
        row = _valid_bronze_row()
        del row["event"]
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            PAYSTACK_BRONZE_SCHEMA.validate(df)

    def test_missing_data_fails(self):
        """Missing 'data' column should fail."""
        row = _valid_bronze_row()
        del row["data"]
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            PAYSTACK_BRONZE_SCHEMA.validate(df)

    def test_invalid_source_type_fails(self):
        """Source type not in allowed set should fail."""
        row = _valid_bronze_row()
        row["_source_type"] = "unknown_source"
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            PAYSTACK_BRONZE_SCHEMA.validate(df)

    def test_valid_source_types(self):
        """All valid source types should pass."""
        for source_type in ["webhook", "polling", "manual"]:
            row = _valid_bronze_row()
            row["_source_type"] = source_type
            df = pd.DataFrame([row])
            result = PAYSTACK_BRONZE_SCHEMA.validate(df)
            assert len(result) == 1

    def test_extra_columns_allowed(self):
        """Extra columns should be allowed (schema-on-read)."""
        row = _valid_bronze_row()
        row["extra_field"] = "this should be fine"
        row["another_field"] = 42
        df = pd.DataFrame([row])
        result = PAYSTACK_BRONZE_SCHEMA.validate(df)
        assert "extra_field" in result.columns

    def test_null_kafka_offset_allowed(self):
        """Kafka offset can be null (manual ingestion)."""
        row = _valid_bronze_row()
        row["_kafka_offset"] = None
        df = pd.DataFrame([row])
        result = PAYSTACK_BRONZE_SCHEMA.validate(df)
        assert len(result) == 1


class TestFlutterwaveBronzeSchema:
    """Tests for Flutterwave Bronze schema — same structure."""

    def test_valid_record_passes(self):
        df = pd.DataFrame([_valid_bronze_row()])
        result = FLUTTERWAVE_BRONZE_SCHEMA.validate(df)
        assert len(result) == 1

    def test_missing_content_hash_fails(self):
        row = _valid_bronze_row()
        del row["_content_hash"]
        df = pd.DataFrame([row])
        with pytest.raises(pandera.errors.SchemaError):
            FLUTTERWAVE_BRONZE_SCHEMA.validate(df)
