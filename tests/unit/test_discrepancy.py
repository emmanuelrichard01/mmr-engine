# tests/unit/test_discrepancy.py
"""
Discrepancy classification unit tests — covers C-005.

References:
    - QA §4.5: Anomaly Classifier Tests
    - C-005: Discrepancy completeness
"""
import pytest
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from src.engine.discrepancy import (
    classify_amount_delta, classify_missing_settlement,
    classify_amount_discrepancy, classify_duplicate_credit,
    classify_late_settlement, DiscrepancyType, DiscrepancySeverity,
)


class TestAmountDeltaClassification:
    """Tests from QA §4.5 — FX variance classification."""

    @pytest.mark.parametrize("a, b, expected", [
        (Decimal("50000"), Decimal("49800"), None),              # 0.4% — within
        (Decimal("50000"), Decimal("49500"), "AMOUNT_MISMATCH"), # 1% — beyond
    ])
    def test_classification_without_fx(self, a, b, expected):
        classification, _ = classify_amount_delta(a, b, fx_variance_pct=None)
        assert classification == expected

    def test_fx_explains_delta(self):
        """Delta beyond threshold but FX explains it → FX_VARIANCE."""
        classification, _ = classify_amount_delta(
            Decimal("50000"), Decimal("49100"),
            fx_variance_pct=Decimal("0.018"),
        )
        assert classification == "FX_VARIANCE"

    def test_zero_amount_b_is_missing(self):
        classification, _ = classify_amount_delta(
            Decimal("50000"), Decimal("0"), fx_variance_pct=None,
        )
        assert classification == "MISSING_SETTLEMENT"

    def test_within_threshold_returns_none(self):
        classification, within = classify_amount_delta(
            Decimal("50000"), Decimal("49850"),  # 0.3%
        )
        assert classification is None
        assert within is True


class TestMissingSettlementClassification:
    """C-005: Missing settlement detection."""

    def test_overdue_48h_is_critical(self):
        now = datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)  # 52h ago
        result = classify_missing_settlement(Decimal("50000"), expected, now)
        assert result.discrepancy_type == DiscrepancyType.MISSING_SETTLEMENT
        assert result.severity == DiscrepancySeverity.CRITICAL
        assert result.requires_action is True

    def test_overdue_25h_is_high(self):
        now = datetime(2026, 5, 2, 9, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)  # 25h ago
        result = classify_missing_settlement(Decimal("50000"), expected, now)
        assert result.severity == DiscrepancySeverity.HIGH

    def test_overdue_2h_is_medium(self):
        now = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)  # 2h ago
        result = classify_missing_settlement(Decimal("50000"), expected, now)
        assert result.severity == DiscrepancySeverity.MEDIUM

    def test_not_yet_due_no_discrepancy(self):
        now = datetime(2026, 5, 1, 7, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)  # 1h in future
        result = classify_missing_settlement(Decimal("50000"), expected, now)
        assert result.discrepancy_type is None
        assert result.requires_action is False

    def test_no_expected_time_is_high(self):
        result = classify_missing_settlement(Decimal("50000"), None)
        assert result.severity == DiscrepancySeverity.HIGH

    def test_exposure_equals_amount(self):
        now = datetime(2026, 5, 3, 12, 0, tzinfo=timezone.utc)
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        result = classify_missing_settlement(Decimal("50000"), expected, now)
        assert result.estimated_exposure_ngn == Decimal("50000")


class TestAmountDiscrepancy:
    """Test amount discrepancy classification with FX context."""

    def test_within_threshold_no_discrepancy(self):
        result = classify_amount_discrepancy(
            Decimal("50000"), Decimal("49850"),  # 0.3%
        )
        assert result.discrepancy_type is None
        assert result.requires_action is False

    def test_fx_variance_low_severity(self):
        result = classify_amount_discrepancy(
            Decimal("50000"), Decimal("49100"),
            fx_rate_a=Decimal("0.00063291"),
            fx_rate_b=Decimal("0.00062000"),
        )
        assert result.discrepancy_type == DiscrepancyType.FX_VARIANCE
        assert result.severity == DiscrepancySeverity.LOW

    def test_amount_mismatch_high_severity(self):
        result = classify_amount_discrepancy(
            Decimal("50000"), Decimal("48000"),  # 4% delta
        )
        assert result.discrepancy_type == DiscrepancyType.AMOUNT_MISMATCH
        assert result.severity == DiscrepancySeverity.HIGH


class TestDuplicateCredit:
    """Test duplicate credit classification."""

    def test_duplicate_is_critical(self):
        result = classify_duplicate_credit("T_abc123", 3, Decimal("50000"))
        assert result.discrepancy_type == DiscrepancyType.DUPLICATE_CREDIT
        assert result.severity == DiscrepancySeverity.CRITICAL

    def test_exposure_is_extra_occurrences(self):
        result = classify_duplicate_credit("T_abc123", 3, Decimal("50000"))
        assert result.estimated_exposure_ngn == Decimal("100000")  # 2 extra

    def test_always_requires_action(self):
        result = classify_duplicate_credit("T_abc123", 2, Decimal("1000"))
        assert result.requires_action is True


class TestLateSettlement:
    """Test late settlement classification."""

    def test_late_30min_is_low(self):
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        settled = datetime(2026, 5, 1, 8, 30, tzinfo=timezone.utc)
        result = classify_late_settlement(Decimal("50000"), expected, settled)
        assert result.severity == DiscrepancySeverity.LOW
        assert result.requires_action is False

    def test_late_12h_is_medium(self):
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        settled = datetime(2026, 5, 1, 20, 0, tzinfo=timezone.utc)
        result = classify_late_settlement(Decimal("50000"), expected, settled)
        assert result.severity == DiscrepancySeverity.MEDIUM

    def test_late_48h_is_high(self):
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        settled = datetime(2026, 5, 3, 8, 0, tzinfo=timezone.utc)
        result = classify_late_settlement(Decimal("50000"), expected, settled)
        assert result.severity == DiscrepancySeverity.HIGH
        assert result.requires_action is True

    def test_exposure_is_zero(self):
        """Late settlement has no financial exposure — money arrived."""
        expected = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        settled = datetime(2026, 5, 3, 8, 0, tzinfo=timezone.utc)
        result = classify_late_settlement(Decimal("50000"), expected, settled)
        assert result.estimated_exposure_ngn == Decimal("0")
