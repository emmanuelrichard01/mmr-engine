# src/engine/discrepancy.py
"""
Discrepancy Classification Engine.

Classifies reconciliation anomalies into actionable categories.
Used by the Gold layer to populate gold_discrepancies.

Classification types (from QA §4.5, TDD §8.3):
    - MISSING_SETTLEMENT: Expected settlement never arrived
    - AMOUNT_MISMATCH: Settled amount differs from expected (not FX-related)
    - FX_VARIANCE: Amount delta explained by FX rate timing difference
    - DUPLICATE_CREDIT: Same transaction credited more than once
    - LATE_SETTLEMENT: Settlement arrived after expected_settlement_at

References:
    - QA §4.5: Anomaly Classifier Tests
    - Correctness Property C-005
    - TDD §8.3: Discrepancy Classification
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any


class DiscrepancyType(StrEnum):
    MISSING_SETTLEMENT = "missing_settlement"
    AMOUNT_MISMATCH = "amount_mismatch"
    FX_VARIANCE = "fx_variance"
    DUPLICATE_CREDIT = "duplicate_credit"
    LATE_SETTLEMENT = "late_settlement"


class DiscrepancySeverity(StrEnum):
    LOW = "low"  # FX variance within tolerance, late by < 1 hour
    MEDIUM = "medium"  # Amount mismatch < 1%, late by < 24 hours
    HIGH = "high"  # Amount mismatch > 1%, missing settlement
    CRITICAL = "critical"  # Duplicate credit, missing > 48 hours


@dataclass
class DiscrepancyResult:
    """Result of classifying a potential discrepancy."""

    discrepancy_type: DiscrepancyType | None
    severity: DiscrepancySeverity | None
    estimated_exposure_ngn: Decimal
    evidence: dict[str, Any]
    requires_action: bool


# ── Amount Delta Classification ───────────────────────────────────────────────

# Threshold: within 0.5% is considered rounding/fee noise, not a discrepancy.
AMOUNT_THRESHOLD_PCT = Decimal("0.005")

# How closely the FX rate movement must account for the amount delta for the
# delta to be classified as FX variance (absolute, in fraction points).
FX_EXPLANATION_TOLERANCE_PCT = Decimal("0.0025")


def classify_amount_delta(
    amount_a_ngn: Decimal,
    amount_b_ngn: Decimal,
    fx_variance_pct: Decimal | None = None,
) -> tuple[str | None, bool]:
    """
    Classify the delta between two matched transaction amounts.

    Returns: (classification, is_within_threshold)
        - None: amounts agree within AMOUNT_THRESHOLD_PCT
        - "FX_VARIANCE": the delta is explained by the FX rate movement, i.e.
          |delta_pct - fx_variance_pct| <= FX_EXPLANATION_TOLERANCE_PCT
        - "AMOUNT_MISMATCH": anything else, including deltas far larger than
          the rate movement (a 0.01% rate change cannot explain a 20% gap)
        - "MISSING_SETTLEMENT": amount_b is zero (never arrived)
    """
    if amount_b_ngn == 0:
        return "MISSING_SETTLEMENT", False

    delta = abs(amount_a_ngn - amount_b_ngn)
    delta_pct = delta / amount_a_ngn if amount_a_ngn > 0 else Decimal("0")

    if delta_pct <= AMOUNT_THRESHOLD_PCT:
        return None, True

    if (
        fx_variance_pct is not None
        and fx_variance_pct > 0
        and abs(delta_pct - fx_variance_pct) <= FX_EXPLANATION_TOLERANCE_PCT
    ):
        return "FX_VARIANCE", False

    return "AMOUNT_MISMATCH", False


# ── Full Discrepancy Classification ───────────────────────────────────────────


def classify_missing_settlement(
    amount_ngn: Decimal,
    expected_settlement_at: datetime | None,
    current_time: datetime | None = None,
) -> DiscrepancyResult:
    """
    Classify a transaction whose settlement is missing.
    C-005: Every transaction past expected_settlement_at without settlement
    must appear in gold_discrepancies.
    """
    now = current_time or datetime.now(UTC)

    if expected_settlement_at is None:
        return DiscrepancyResult(
            discrepancy_type=DiscrepancyType.MISSING_SETTLEMENT,
            severity=DiscrepancySeverity.HIGH,
            estimated_exposure_ngn=amount_ngn,
            evidence={
                "reason": "No expected settlement time configured",
                "amount_ngn": str(amount_ngn),
            },
            requires_action=True,
        )

    overdue_seconds = (now - expected_settlement_at).total_seconds()

    if overdue_seconds <= 0:
        # Not yet overdue — not a discrepancy yet
        return DiscrepancyResult(
            discrepancy_type=None,
            severity=None,
            estimated_exposure_ngn=Decimal("0"),
            evidence={"reason": "Settlement not yet due"},
            requires_action=False,
        )

    overdue_hours = overdue_seconds / 3600

    if overdue_hours > 48:
        severity = DiscrepancySeverity.CRITICAL
    elif overdue_hours > 24:
        severity = DiscrepancySeverity.HIGH
    else:
        severity = DiscrepancySeverity.MEDIUM

    return DiscrepancyResult(
        discrepancy_type=DiscrepancyType.MISSING_SETTLEMENT,
        severity=severity,
        estimated_exposure_ngn=amount_ngn,
        evidence={
            "expected_settlement_at": expected_settlement_at.isoformat(),
            "overdue_hours": round(overdue_hours, 2),
            "amount_ngn": str(amount_ngn),
        },
        requires_action=True,
    )


def classify_amount_discrepancy(
    amount_a_ngn: Decimal,
    amount_b_ngn: Decimal,
    fx_rate_a: Decimal | None = None,
    fx_rate_b: Decimal | None = None,
) -> DiscrepancyResult:
    """
    Classify an amount discrepancy between matched transactions.
    Distinguishes between FX timing variance and genuine mismatches.
    """
    delta = abs(amount_a_ngn - amount_b_ngn)
    delta_pct = delta / amount_a_ngn if amount_a_ngn > 0 else Decimal("0")

    # Check if FX explains the delta
    fx_variance = None
    if fx_rate_a and fx_rate_b and fx_rate_a > 0:
        fx_variance = abs(fx_rate_a - fx_rate_b) / fx_rate_a

    classification, _within_threshold = classify_amount_delta(amount_a_ngn, amount_b_ngn, fx_variance)

    if classification is None:
        return DiscrepancyResult(
            discrepancy_type=None,
            severity=None,
            estimated_exposure_ngn=Decimal("0"),
            evidence={"delta_pct": f"{float(delta_pct):.4f}", "within_threshold": True},
            requires_action=False,
        )

    disc_type = DiscrepancyType(classification.lower())

    if disc_type == DiscrepancyType.FX_VARIANCE:
        severity = DiscrepancySeverity.LOW
    elif delta_pct > Decimal("0.01"):
        severity = DiscrepancySeverity.HIGH
    else:
        severity = DiscrepancySeverity.MEDIUM

    return DiscrepancyResult(
        discrepancy_type=disc_type,
        severity=severity,
        estimated_exposure_ngn=delta,
        evidence={
            "amount_a_ngn": str(amount_a_ngn),
            "amount_b_ngn": str(amount_b_ngn),
            "delta_ngn": str(delta),
            "delta_pct": f"{float(delta_pct):.4f}",
            "fx_variance": f"{float(fx_variance):.6f}" if fx_variance else None,
            "classification": classification,
        },
        requires_action=disc_type != DiscrepancyType.FX_VARIANCE,
    )


def classify_duplicate_credit(
    transaction_ref: str,
    occurrence_count: int,
    amount_ngn: Decimal,
) -> DiscrepancyResult:
    """Classify a duplicate credit event."""
    return DiscrepancyResult(
        discrepancy_type=DiscrepancyType.DUPLICATE_CREDIT,
        severity=DiscrepancySeverity.CRITICAL,
        estimated_exposure_ngn=amount_ngn * (occurrence_count - 1),
        evidence={
            "transaction_ref": transaction_ref,
            "occurrence_count": occurrence_count,
            "amount_per_occurrence_ngn": str(amount_ngn),
            "total_duplicate_exposure_ngn": str(amount_ngn * (occurrence_count - 1)),
        },
        requires_action=True,
    )


def classify_late_settlement(
    amount_ngn: Decimal,
    expected_at: datetime,
    settled_at: datetime,
) -> DiscrepancyResult:
    """Classify a settlement that arrived late."""
    late_seconds = (settled_at - expected_at).total_seconds()
    late_hours = late_seconds / 3600

    if late_hours < 1:
        severity = DiscrepancySeverity.LOW
    elif late_hours < 24:
        severity = DiscrepancySeverity.MEDIUM
    else:
        severity = DiscrepancySeverity.HIGH

    return DiscrepancyResult(
        discrepancy_type=DiscrepancyType.LATE_SETTLEMENT,
        severity=severity,
        estimated_exposure_ngn=Decimal("0"),  # Money arrived, no financial exposure
        evidence={
            "expected_at": expected_at.isoformat(),
            "settled_at": settled_at.isoformat(),
            "late_hours": round(late_hours, 2),
            "amount_ngn": str(amount_ngn),
        },
        requires_action=late_hours > 24,
    )
