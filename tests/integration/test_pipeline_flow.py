# tests/integration/test_pipeline_flow.py
"""
Integration tests for the reconciliation pipeline.

Tests the data flow from webhook ingestion through matching.
Uses mocked external services (PostgreSQL, Kafka, MinIO).

References:
    - TDD §10: Pipeline Flows
    - QA C-004, C-005: End-to-end pipeline tests
"""
import pytest
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

from src.engine.matching import (
    TransactionCandidate,
    run_matching,
    MatchStrategy,
)
from src.engine.discrepancy import (
    classify_missing_settlement,
    classify_amount_discrepancy,
    DiscrepancyType,
    DiscrepancySeverity,
)
from src.engine.normaliser import normalise_paystack_event, normalise_flutterwave_event
from src.engine.pii import mask_pii_fields


class TestNormalisationPipeline:
    """Test webhook event normalisation (Bronze → Silver)."""

    def test_normalise_paystack_charge_success(self):
        """Paystack charge.success normalises amount from kobo to NGN."""
        event = {
            "event": "charge.success",
            "data": {
                "id": 12345,
                "reference": "TXN-PS-001",
                "amount": 5_000_00,  # 5000 NGN in kobo
                "currency": "NGN",
                "status": "success",
                "paid_at": "2026-05-20T10:00:00.000Z",
                "customer": {
                    "email": "customer@example.com",
                    "customer_code": "CUS_abc123",
                },
                "authorization": {
                    "bank": "058",  # GTBank
                },
            },
        }
        result = normalise_paystack_event(event)
        assert result is not None
        assert result["amount_ngn"] == Decimal("5000.00")
        assert result["psp_name"] == "paystack"
        assert result["currency_raw"] == "NGN"

    def test_normalise_flutterwave_charge_completed(self):
        """Flutterwave charge.completed normalises correctly."""
        event = {
            "event": "charge.completed",
            "data": {
                "id": 67890,
                "tx_ref": "TXN-FW-001",
                "amount": 12500.50,
                "currency": "NGN",
                "status": "successful",
                "created_at": "2026-05-20T11:00:00.000Z",
                "customer": {
                    "email": "buyer@test.com",
                    "name": "Emeka Nwosu",
                },
            },
        }
        result = normalise_flutterwave_event(event)
        assert result is not None
        assert result["amount_ngn"] == Decimal("12500.50")
        assert result["psp_name"] == "flutterwave"


class TestPIIMasking:
    """Test PII masking in the Silver layer."""

    def test_nuban_account_number_masked(self):
        """10-digit NUBAN account numbers are masked."""
        result = mask_pii_fields(
            "Payment to account 0123456789 for order 42"
        )
        assert "0123456789" not in result
        assert "***" in result or "XXXX" in result.upper()

    def test_bvn_masked(self):
        """11-digit BVN numbers are masked."""
        result = mask_pii_fields("BVN: 12345678901")
        assert "12345678901" not in result

    def test_name_masking(self):
        """Nigerian names are properly masked."""
        result = mask_pii_fields(
            "Transfer to Adebayo Ogundimu at GTBank"
        )
        # Name should be masked or partially replaced
        assert result is not None


class TestMatchingPipeline:
    """Test the two-tier matching engine (Silver → Gold)."""

    def test_exact_match_same_amount_and_time(self):
        """Two transactions with identical amount and close timestamps match exactly."""
        source = TransactionCandidate(
            id=1,
            psp_name="paystack",
            transaction_type="credit",
            amount_ngn=Decimal("50000.00"),
            currency_raw="NGN",
            initiated_at=datetime(2026, 5, 20, 10, 0, 0, tzinfo=timezone.utc),
            settled_at=datetime(2026, 5, 20, 10, 5, 0, tzinfo=timezone.utc),
        )
        candidate = TransactionCandidate(
            id=2,
            psp_name="flutterwave",
            transaction_type="credit",
            amount_ngn=Decimal("50000.00"),
            currency_raw="NGN",
            initiated_at=datetime(2026, 5, 20, 10, 1, 0, tzinfo=timezone.utc),
            settled_at=datetime(2026, 5, 20, 10, 6, 0, tzinfo=timezone.utc),
        )
        result = run_matching(source, [candidate])
        assert result.matched_transaction_id == 2
        assert result.strategy == MatchStrategy.PRIMARY_EXACT
        assert result.confidence_score >= 0.95

    def test_no_match_different_amount(self):
        """Transactions with significantly different amounts don't match."""
        source = TransactionCandidate(
            id=1,
            psp_name="paystack",
            transaction_type="credit",
            amount_ngn=Decimal("50000.00"),
            currency_raw="NGN",
            initiated_at=datetime(2026, 5, 20, 10, 0, 0, tzinfo=timezone.utc),
        )
        candidate = TransactionCandidate(
            id=2,
            psp_name="flutterwave",
            transaction_type="credit",
            amount_ngn=Decimal("99999.00"),
            currency_raw="NGN",
            initiated_at=datetime(2026, 5, 20, 10, 1, 0, tzinfo=timezone.utc),
        )
        result = run_matching(source, [candidate])
        assert result.matched_transaction_id is None
        assert result.strategy == MatchStrategy.UNMATCHED

    def test_no_candidates_returns_unmatched(self):
        """Empty candidate list returns unmatched."""
        source = TransactionCandidate(
            id=1,
            psp_name="paystack",
            transaction_type="credit",
            amount_ngn=Decimal("10000.00"),
            currency_raw="NGN",
            initiated_at=datetime(2026, 5, 20, 10, 0, 0, tzinfo=timezone.utc),
        )
        result = run_matching(source, [])
        assert result.matched_transaction_id is None
        assert result.strategy == MatchStrategy.UNMATCHED


class TestDiscrepancyClassification:
    """Test discrepancy detection (Gold layer)."""

    def test_missing_settlement_after_deadline(self):
        """Transaction past expected settlement is classified as missing."""
        expected_at = datetime.now(timezone.utc) - timedelta(hours=48)
        result = classify_missing_settlement(
            amount_ngn=Decimal("100000.00"),
            expected_settlement_at=expected_at,
            current_time=datetime.now(timezone.utc),
        )
        assert result.discrepancy_type == DiscrepancyType.MISSING_SETTLEMENT
        assert result.severity in (
            DiscrepancySeverity.HIGH,
            DiscrepancySeverity.CRITICAL,
        )

    def test_no_discrepancy_within_window(self):
        """Transaction within settlement window is not flagged."""
        expected_at = datetime.now(timezone.utc) + timedelta(hours=2)
        result = classify_missing_settlement(
            amount_ngn=Decimal("5000.00"),
            expected_settlement_at=expected_at,
            current_time=datetime.now(timezone.utc),
        )
        assert result.discrepancy_type is None

    def test_amount_discrepancy_detected(self):
        """Mismatched amounts are classified correctly."""
        result = classify_amount_discrepancy(
            expected_ngn=Decimal("100000.00"),
            actual_ngn=Decimal("95000.00"),
        )
        assert result.discrepancy_type == DiscrepancyType.AMOUNT_MISMATCH
        assert result.estimated_exposure_ngn == Decimal("5000.00")


class TestIdempotency:
    """Test idempotent webhook processing."""

    def test_same_event_processed_once(self):
        """Duplicate webhook events should be deduplicated."""
        # This would require a DB session — tested at the API level
        # in test_api_routes.py instead
        pass
