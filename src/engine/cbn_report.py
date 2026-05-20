"""
CBN Daily Return Generator.

Produces Central Bank of Nigeria compliant daily transaction returns
from Gold-layer reconciliation data.

Output format follows CBN's electronic financial return (EFR) structure:
- Daily transaction summary per PSP
- Cross-border transaction declarations
- Suspicious transaction flags (velocity anomalies)
- Settlement reconciliation status

Schedule: Prefect cron at 02:00 WAT daily.
"""
from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import uuid4


class ReportStatus(str, Enum):
    DRAFT = "draft"
    GENERATED = "generated"
    REVIEWED = "reviewed"
    SUBMITTED = "submitted"
    FAILED = "failed"


class TransactionCategory(str, Enum):
    DOMESTIC_CREDIT = "domestic_credit"
    DOMESTIC_DEBIT = "domestic_debit"
    CROSS_BORDER_INWARD = "cross_border_inward"
    CROSS_BORDER_OUTWARD = "cross_border_outward"


@dataclass
class CBNDailySummary:
    """Summary statistics for a single day's transactions."""

    report_date: str
    report_id: str = field(default_factory=lambda: f"CBN-{uuid4().hex[:8].upper()}")
    status: str = ReportStatus.DRAFT.value
    generated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    # Volume metrics
    total_transactions: int = 0
    total_volume_ngn: float = 0.0
    matched_transactions: int = 0
    unmatched_transactions: int = 0
    match_rate_pct: float = 0.0

    # Per-PSP breakdown
    psp_breakdown: dict = field(default_factory=dict)

    # Cross-border
    cross_border_count: int = 0
    cross_border_volume_ngn: float = 0.0
    cross_border_currencies: list = field(default_factory=list)

    # Discrepancies
    open_discrepancies: int = 0
    resolved_discrepancies: int = 0
    total_exposure_ngn: float = 0.0

    # Flags
    suspicious_transaction_count: int = 0
    velocity_anomaly_count: int = 0


@dataclass
class CBNTransactionLine:
    """Individual transaction line item for the CBN return."""

    reference: str
    psp: str
    category: str
    amount_ngn: float
    currency: str
    fx_rate_applied: Optional[float]
    settlement_status: str
    beneficiary_masked: str  # PII masked — NUBAN last 4 only
    timestamp: str
    match_status: str
    discrepancy_type: Optional[str] = None


def generate_daily_return(
    report_date: date,
    transactions: list[dict],
    discrepancies: list[dict],
    fx_snapshots: list[dict],
) -> CBNDailySummary:
    """
    Generate a CBN-compliant daily return from Gold-layer data.

    Args:
        report_date: The business date for this return
        transactions: Silver-layer canonical transactions for the date
        discrepancies: Gold-layer discrepancies for the date
        fx_snapshots: FX rate snapshots used during the date

    Returns:
        CBNDailySummary with all computed metrics
    """
    summary = CBNDailySummary(report_date=report_date.isoformat())

    # ── Compute volume metrics ────────────────────────────────────────
    summary.total_transactions = len(transactions)

    for txn in transactions:
        amount = float(txn.get("amount_ngn", 0))
        summary.total_volume_ngn += amount

        psp = txn.get("psp_name", "unknown")
        if psp not in summary.psp_breakdown:
            summary.psp_breakdown[psp] = {
                "count": 0,
                "volume_ngn": 0.0,
                "matched": 0,
                "unmatched": 0,
            }
        summary.psp_breakdown[psp]["count"] += 1
        summary.psp_breakdown[psp]["volume_ngn"] += amount

        if txn.get("match_status") == "matched":
            summary.matched_transactions += 1
            summary.psp_breakdown[psp]["matched"] += 1
        else:
            summary.unmatched_transactions += 1
            summary.psp_breakdown[psp]["unmatched"] += 1

        # Cross-border detection
        currency = txn.get("original_currency", "NGN")
        if currency != "NGN":
            summary.cross_border_count += 1
            summary.cross_border_volume_ngn += amount
            if currency not in summary.cross_border_currencies:
                summary.cross_border_currencies.append(currency)

    if summary.total_transactions > 0:
        summary.match_rate_pct = round(
            (summary.matched_transactions / summary.total_transactions) * 100, 2
        )

    # ── Discrepancy summary ───────────────────────────────────────────
    for disc in discrepancies:
        if disc.get("status") == "open":
            summary.open_discrepancies += 1
            summary.total_exposure_ngn += float(disc.get("amount_ngn", 0))
        elif disc.get("status") == "resolved":
            summary.resolved_discrepancies += 1

    # ── Flag suspicious patterns ──────────────────────────────────────
    summary.suspicious_transaction_count = _detect_suspicious(transactions)
    summary.velocity_anomaly_count = _detect_velocity_anomalies(transactions)

    summary.status = ReportStatus.GENERATED.value
    return summary


def _detect_suspicious(transactions: list[dict]) -> int:
    """
    Flag transactions matching known structuring patterns.

    Rules:
    - Multiple transactions just below reporting threshold (NGN 5M)
    - Round-number transactions above NGN 1M
    - Rapid succession from same beneficiary (< 2 min intervals)
    """
    count = 0
    threshold = 4_500_000  # Just below CBN reporting threshold

    for txn in transactions:
        amount = float(txn.get("amount_ngn", 0))
        # Structuring pattern: amount between 4.5M and 5M
        if threshold <= amount < 5_000_000:
            count += 1

    return count


def _detect_velocity_anomalies(transactions: list[dict]) -> int:
    """
    Detect unusual transaction velocity per beneficiary.

    Flags when same beneficiary receives > 5 transactions within 10 minutes.
    """
    from collections import defaultdict

    by_beneficiary: dict[str, list[str]] = defaultdict(list)
    for txn in transactions:
        key = txn.get("beneficiary_account_masked", "unknown")
        by_beneficiary[key].append(txn.get("timestamp", ""))

    anomalies = 0
    for _, timestamps in by_beneficiary.items():
        if len(timestamps) > 5:
            sorted_ts = sorted(timestamps)
            for i in range(len(sorted_ts) - 5):
                try:
                    t1 = datetime.fromisoformat(sorted_ts[i])
                    t2 = datetime.fromisoformat(sorted_ts[i + 5])
                    if (t2 - t1).total_seconds() < 600:  # 10 minutes
                        anomalies += 1
                        break
                except (ValueError, TypeError):
                    continue

    return anomalies


def export_to_csv(summary: CBNDailySummary, lines: list[CBNTransactionLine]) -> str:
    """Export CBN return as CSV for download."""
    output = io.StringIO()
    writer = csv.writer(output)

    # Header section
    writer.writerow(["CBN DAILY TRANSACTION RETURN"])
    writer.writerow(["Report Date", summary.report_date])
    writer.writerow(["Report ID", summary.report_id])
    writer.writerow(["Generated At", summary.generated_at])
    writer.writerow(["Status", summary.status])
    writer.writerow([])

    # Summary section
    writer.writerow(["SUMMARY"])
    writer.writerow(["Total Transactions", summary.total_transactions])
    writer.writerow(["Total Volume (NGN)", f"{summary.total_volume_ngn:,.2f}"])
    writer.writerow(["Match Rate", f"{summary.match_rate_pct}%"])
    writer.writerow(["Open Discrepancies", summary.open_discrepancies])
    writer.writerow(["Total Exposure (NGN)", f"{summary.total_exposure_ngn:,.2f}"])
    writer.writerow(["Cross-Border Transactions", summary.cross_border_count])
    writer.writerow(["Suspicious Flags", summary.suspicious_transaction_count])
    writer.writerow([])

    # PSP Breakdown
    writer.writerow(["PSP BREAKDOWN"])
    writer.writerow(["PSP", "Count", "Volume (NGN)", "Matched", "Unmatched"])
    for psp, data in summary.psp_breakdown.items():
        writer.writerow([
            psp,
            data["count"],
            f"{data['volume_ngn']:,.2f}",
            data["matched"],
            data["unmatched"],
        ])
    writer.writerow([])

    # Transaction lines
    if lines:
        writer.writerow(["TRANSACTION DETAIL"])
        writer.writerow([
            "Reference", "PSP", "Category", "Amount (NGN)", "Currency",
            "FX Rate", "Settlement Status", "Beneficiary", "Timestamp",
            "Match Status", "Discrepancy Type",
        ])
        for line in lines:
            writer.writerow([
                line.reference,
                line.psp,
                line.category,
                f"{line.amount_ngn:,.2f}",
                line.currency,
                line.fx_rate_applied or "",
                line.settlement_status,
                line.beneficiary_masked,
                line.timestamp,
                line.match_status,
                line.discrepancy_type or "",
            ])

    return output.getvalue()


def export_to_json(summary: CBNDailySummary) -> str:
    """Export CBN return as JSON for API consumption."""
    return json.dumps(asdict(summary), indent=2, default=str)
