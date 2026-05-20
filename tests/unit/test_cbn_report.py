"""Tests for CBN daily return generator."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from src.engine.cbn_report import (
    CBNDailySummary,
    CBNTransactionLine,
    ReportStatus,
    TransactionCategory,
    generate_daily_return,
    export_to_csv,
    export_to_json,
)


# ── Fixtures ──────────────────────────────────────────────────────────────

def _make_transaction(
    ref: str = "T_001",
    psp: str = "paystack",
    amount: float = 50000.0,
    currency: str = "NGN",
    match_status: str = "matched",
    beneficiary: str = "****6789",
    timestamp: str = "2026-05-01T10:00:00Z",
) -> dict:
    return {
        "reference": ref,
        "psp_name": psp,
        "amount_ngn": amount,
        "original_currency": currency,
        "match_status": match_status,
        "beneficiary_account_masked": beneficiary,
        "timestamp": timestamp,
    }


def _make_discrepancy(
    status: str = "open",
    amount: float = 5000.0,
    disc_type: str = "missing_settlement",
) -> dict:
    return {
        "status": status,
        "amount_ngn": amount,
        "discrepancy_type": disc_type,
    }


# ── Tests ─────────────────────────────────────────────────────────────────

class TestGenerateDailyReturn:
    """Tests for the core report generation function."""

    def test_empty_report(self):
        """Generates a valid report with no transactions."""
        result = generate_daily_return(
            report_date=date(2026, 5, 1),
            transactions=[],
            discrepancies=[],
            fx_snapshots=[],
        )
        assert result.total_transactions == 0
        assert result.match_rate_pct == 0.0
        assert result.status == ReportStatus.GENERATED.value
        assert result.report_date == "2026-05-01"

    def test_basic_metrics(self):
        """Computes correct volume and match rate."""
        txns = [
            _make_transaction(ref="T_001", amount=50000, match_status="matched"),
            _make_transaction(ref="T_002", amount=30000, match_status="matched"),
            _make_transaction(ref="T_003", amount=20000, match_status="unmatched"),
        ]
        result = generate_daily_return(date(2026, 5, 1), txns, [], [])

        assert result.total_transactions == 3
        assert result.total_volume_ngn == 100000.0
        assert result.matched_transactions == 2
        assert result.unmatched_transactions == 1
        assert result.match_rate_pct == 66.67

    def test_psp_breakdown(self):
        """Generates per-PSP breakdown correctly."""
        txns = [
            _make_transaction(ref="T_001", psp="paystack", amount=50000),
            _make_transaction(ref="T_002", psp="paystack", amount=30000),
            _make_transaction(ref="T_003", psp="flutterwave", amount=20000),
        ]
        result = generate_daily_return(date(2026, 5, 1), txns, [], [])

        assert "paystack" in result.psp_breakdown
        assert "flutterwave" in result.psp_breakdown
        assert result.psp_breakdown["paystack"]["count"] == 2
        assert result.psp_breakdown["paystack"]["volume_ngn"] == 80000.0
        assert result.psp_breakdown["flutterwave"]["count"] == 1

    def test_cross_border_detection(self):
        """Detects cross-border transactions by currency."""
        txns = [
            _make_transaction(ref="T_001", currency="NGN", amount=50000),
            _make_transaction(ref="T_002", currency="USD", amount=100),
            _make_transaction(ref="T_003", currency="GBP", amount=50),
        ]
        result = generate_daily_return(date(2026, 5, 1), txns, [], [])

        assert result.cross_border_count == 2
        assert "USD" in result.cross_border_currencies
        assert "GBP" in result.cross_border_currencies

    def test_discrepancy_summary(self):
        """Summarises open vs resolved discrepancies."""
        discs = [
            _make_discrepancy(status="open", amount=5000),
            _make_discrepancy(status="open", amount=3000),
            _make_discrepancy(status="resolved", amount=1000),
        ]
        result = generate_daily_return(date(2026, 5, 1), [], discs, [])

        assert result.open_discrepancies == 2
        assert result.resolved_discrepancies == 1
        assert result.total_exposure_ngn == 8000.0

    def test_suspicious_pattern_detection(self):
        """Flags transactions near CBN reporting threshold."""
        txns = [
            _make_transaction(ref="T_001", amount=4_600_000),  # Just below 5M
            _make_transaction(ref="T_002", amount=4_800_000),  # Just below 5M
            _make_transaction(ref="T_003", amount=3_000_000),  # Not suspicious
        ]
        result = generate_daily_return(date(2026, 5, 1), txns, [], [])
        assert result.suspicious_transaction_count == 2

    def test_report_id_unique(self):
        """Each report gets a unique ID."""
        r1 = generate_daily_return(date(2026, 5, 1), [], [], [])
        r2 = generate_daily_return(date(2026, 5, 2), [], [], [])
        assert r1.report_id != r2.report_id


class TestExport:
    """Tests for CSV and JSON export functions."""

    def test_csv_export(self):
        """CSV export includes header and summary rows."""
        summary = CBNDailySummary(
            report_date="2026-05-01",
            total_transactions=100,
            total_volume_ngn=5_000_000.0,
            match_rate_pct=98.5,
        )
        csv_str = export_to_csv(summary, [])
        assert "CBN DAILY TRANSACTION RETURN" in csv_str
        assert "2026-05-01" in csv_str
        assert "98.5%" in csv_str

    def test_csv_with_lines(self):
        """CSV includes transaction detail lines."""
        summary = CBNDailySummary(report_date="2026-05-01")
        lines = [
            CBNTransactionLine(
                reference="T_001",
                psp="paystack",
                category=TransactionCategory.DOMESTIC_CREDIT.value,
                amount_ngn=50000.0,
                currency="NGN",
                fx_rate_applied=None,
                settlement_status="settled",
                beneficiary_masked="****6789",
                timestamp="2026-05-01T10:00:00Z",
                match_status="matched",
            ),
        ]
        csv_str = export_to_csv(summary, lines)
        assert "T_001" in csv_str
        assert "paystack" in csv_str

    def test_json_export(self):
        """JSON export produces valid JSON with all fields."""
        summary = CBNDailySummary(
            report_date="2026-05-01",
            total_transactions=50,
        )
        json_str = export_to_json(summary)
        parsed = json.loads(json_str)
        assert parsed["report_date"] == "2026-05-01"
        assert parsed["total_transactions"] == 50
        assert "report_id" in parsed


class TestReportStatus:
    """Tests for report status enum."""

    def test_status_values(self):
        assert ReportStatus.DRAFT.value == "draft"
        assert ReportStatus.GENERATED.value == "generated"
        assert ReportStatus.REVIEWED.value == "reviewed"
        assert ReportStatus.SUBMITTED.value == "submitted"
        assert ReportStatus.FAILED.value == "failed"
