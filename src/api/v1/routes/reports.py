# src/api/v1/routes/reports.py
"""
CBN Daily Returns API Routes.

Provides access to generated CBN regulatory reports:
    - List recent daily returns
    - Get specific date report
    - Download CSV/JSON exports

References:
    - TDD §12.1: CBN Reporting
    - API Specification §5: Reports
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.storage.postgres import readonly_session

router = APIRouter(prefix="/v1/reports", tags=["CBN Reports"])


# ── Response Models ───────────────────────────────────────────────────

class CBNDailyReturnResponse(BaseModel):
    """Single CBN daily return summary."""
    report_date: str
    total_transactions: int
    total_volume_ngn: float
    match_rate_pct: float
    cross_border_count: int
    suspicious_flags: int
    open_discrepancies: int
    total_exposure_ngn: float
    status: str
    generated_at: str


class CBNDailyReturnListResponse(BaseModel):
    """List of CBN daily returns."""
    reports: list[CBNDailyReturnResponse]
    count: int


# ── Routes ────────────────────────────────────────────────────────────

@router.get("/daily", response_model=CBNDailyReturnListResponse)
async def list_daily_reports(
    limit: int = Query(default=30, le=90),
    offset: int = Query(default=0, ge=0),
):
    """
    List recent CBN daily returns.

    Returns the most recent daily reports in reverse chronological order.
    """
    try:
        async with readonly_session() as session:
            result = await session.execute(
                text("""
                    SELECT report_date, total_transactions, total_volume_ngn,
                           match_rate_pct, cross_border_count, suspicious_flags,
                           open_discrepancies, total_exposure_ngn, status,
                           generated_at
                    FROM gold_cbn_daily_returns
                    ORDER BY report_date DESC
                    LIMIT :limit OFFSET :offset
                """),
                {"limit": limit, "offset": offset},
            )
            rows = result.mappings().all()

        reports = [
            CBNDailyReturnResponse(
                report_date=str(r["report_date"]),
                total_transactions=r["total_transactions"],
                total_volume_ngn=float(r["total_volume_ngn"]),
                match_rate_pct=float(r["match_rate_pct"]),
                cross_border_count=r["cross_border_count"],
                suspicious_flags=r["suspicious_flags"],
                open_discrepancies=r["open_discrepancies"],
                total_exposure_ngn=float(r["total_exposure_ngn"]),
                status=r["status"],
                generated_at=str(r["generated_at"]),
            )
            for r in rows
        ]

        return CBNDailyReturnListResponse(reports=reports, count=len(reports))

    except Exception:
        # Return empty list if table doesn't exist yet
        return CBNDailyReturnListResponse(reports=[], count=0)


@router.get("/daily/{report_date}", response_model=CBNDailyReturnResponse)
async def get_daily_report(report_date: str):
    """
    Get a specific date's CBN daily return.
    """
    try:
        async with readonly_session() as session:
            result = await session.execute(
                text("""
                    SELECT report_date, total_transactions, total_volume_ngn,
                           match_rate_pct, cross_border_count, suspicious_flags,
                           open_discrepancies, total_exposure_ngn, status,
                           generated_at
                    FROM gold_cbn_daily_returns
                    WHERE report_date = :report_date
                """),
                {"report_date": report_date},
            )
            row = result.mappings().first()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database error: {e}")

    if not row:
        raise HTTPException(
            status_code=404,
            detail=f"No CBN report found for {report_date}",
        )

    return CBNDailyReturnResponse(
        report_date=str(row["report_date"]),
        total_transactions=row["total_transactions"],
        total_volume_ngn=float(row["total_volume_ngn"]),
        match_rate_pct=float(row["match_rate_pct"]),
        cross_border_count=row["cross_border_count"],
        suspicious_flags=row["suspicious_flags"],
        open_discrepancies=row["open_discrepancies"],
        total_exposure_ngn=float(row["total_exposure_ngn"]),
        status=row["status"],
        generated_at=str(row["generated_at"]),
    )
