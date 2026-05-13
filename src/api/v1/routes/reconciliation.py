# src/api/v1/routes/reconciliation.py
"""
Reconciliation API Routes.

Provides read access to matching results, discrepancies,
and reconciliation summaries. Write access for discrepancy
resolution (analyst+ role).

References:
    - API Specification §4: Reconciliation Endpoints
    - QA C-004, C-005, C-010
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import text

from src.api.middleware.auth import require_role
from src.storage.postgres import api_session

import structlog

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/reconciliation", tags=["Reconciliation"])


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get(
    "/summary",
    summary="Daily reconciliation summary",
    dependencies=[Depends(require_role(["admin", "analyst", "readonly"]))],
)
async def get_reconciliation_summary(
    request: Request,
    report_date: Optional[date] = Query(None, description="Date (YYYY-MM-DD). Defaults to today."),
):
    """
    Returns the reconciliation summary for a given date.
    Includes: total transactions, matched, unmatched, match rate,
    total exposure, discrepancy counts by type.
    """
    target_date = report_date or date.today()

    async with api_session() as session:
        # Core matching stats
        result = await session.execute(
            text("""
                SELECT
                    COUNT(*) FILTER (WHERE g.id IS NOT NULL) AS matched_count,
                    COUNT(*) FILTER (WHERE g.id IS NULL) AS unmatched_count,
                    COUNT(*) AS total_count
                FROM silver_canonical_transactions s
                LEFT JOIN gold_reconciliation_pairs g
                    ON s.id = g.transaction_a_id OR s.id = g.transaction_b_id
                WHERE DATE(s.initiated_at AT TIME ZONE 'Africa/Lagos') = :d
            """),
            {"d": target_date},
        )
        stats = result.mappings().first()

        # Discrepancy stats
        disc_result = await session.execute(
            text("""
                SELECT
                    discrepancy_type,
                    COUNT(*) AS count,
                    COALESCE(SUM(estimated_exposure_ngn), 0) AS total_exposure
                FROM gold_discrepancies
                WHERE DATE(detected_at AT TIME ZONE 'Africa/Lagos') = :d
                GROUP BY discrepancy_type
            """),
            {"d": target_date},
        )
        discrepancies = [dict(r) for r in disc_result.mappings().all()]

    total = stats["total_count"] if stats else 0
    matched = stats["matched_count"] if stats else 0

    return {
        "report_date": target_date.isoformat(),
        "total_transactions": total,
        "matched": matched,
        "unmatched": stats["unmatched_count"] if stats else 0,
        "match_rate_pct": round(matched / max(total, 1) * 100, 2),
        "discrepancies": discrepancies,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ── Matched Pairs ─────────────────────────────────────────────────────────────

@router.get(
    "/pairs",
    summary="List matched transaction pairs",
    dependencies=[Depends(require_role(["admin", "analyst", "readonly"]))],
)
async def list_reconciliation_pairs(
    request: Request,
    status: Optional[str] = Query(None, description="Filter: matched, unmatched"),
    psp_name: Optional[str] = Query(None, description="Filter by PSP"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Paginated list of reconciliation pairs from the Gold layer.
    Includes confidence scores and matching strategy.
    """
    async with api_session() as session:
        filters = []
        params: dict = {"limit": limit, "offset": offset}

        if status:
            filters.append("g.status = :status")
            params["status"] = status
        if psp_name:
            filters.append("(sa.psp_name = :psp OR sb.psp_name = :psp)")
            params["psp"] = psp_name

        where_clause = ("WHERE " + " AND ".join(filters)) if filters else ""

        result = await session.execute(
            text(f"""
                SELECT
                    g.id, g.transaction_a_id, g.transaction_b_id,
                    g.match_strategy, g.confidence_score,
                    g.amount_a_ngn, g.amount_delta_ngn,
                    g.is_within_fx_threshold, g.status,
                    g.created_at,
                    sa.psp_name AS psp_a, sb.psp_name AS psp_b
                FROM gold_reconciliation_pairs g
                JOIN silver_canonical_transactions sa ON g.transaction_a_id = sa.id
                JOIN silver_canonical_transactions sb ON g.transaction_b_id = sb.id
                {where_clause}
                ORDER BY g.created_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        pairs = [dict(r) for r in result.mappings().all()]

    return {"pairs": pairs, "limit": limit, "offset": offset, "count": len(pairs)}


# ── Discrepancies ─────────────────────────────────────────────────────────────

@router.get(
    "/discrepancies",
    summary="List discrepancies",
    dependencies=[Depends(require_role(["admin", "analyst", "readonly"]))],
)
async def list_discrepancies(
    request: Request,
    status: str = Query("open", description="Filter: open, investigating, resolved"),
    severity: Optional[str] = Query(None, description="Filter: low, medium, high, critical"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Paginated list of discrepancies from the Gold layer.
    Filterable by status and severity.
    """
    async with api_session() as session:
        filters = ["d.status = :status"]
        params: dict = {"status": status, "limit": limit, "offset": offset}

        if severity:
            filters.append("d.severity = :severity")
            params["severity"] = severity

        where_clause = "WHERE " + " AND ".join(filters)

        result = await session.execute(
            text(f"""
                SELECT
                    d.id, d.transaction_id, d.discrepancy_type,
                    d.severity, d.estimated_exposure_ngn,
                    d.evidence, d.status, d.detected_at,
                    d.resolved_at, d.resolved_by,
                    s.psp_name, s.amount_ngn, s.psp_transaction_ref
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions s ON d.transaction_id = s.id
                {where_clause}
                ORDER BY
                    CASE d.severity
                        WHEN 'critical' THEN 1
                        WHEN 'high' THEN 2
                        WHEN 'medium' THEN 3
                        WHEN 'low' THEN 4
                    END,
                    d.detected_at DESC
                LIMIT :limit OFFSET :offset
            """),
            params,
        )
        discrepancies = [dict(r) for r in result.mappings().all()]

    return {
        "discrepancies": discrepancies,
        "limit": limit,
        "offset": offset,
        "count": len(discrepancies),
    }


# ── Discrepancy Resolution ───────────────────────────────────────────────────

@router.post(
    "/discrepancies/{discrepancy_id}/resolve",
    summary="Resolve a discrepancy",
    dependencies=[Depends(require_role(["admin", "analyst"]))],
)
async def resolve_discrepancy(
    request: Request,
    discrepancy_id: int,
    resolution_note: str = Query(..., min_length=10, description="Explanation of resolution"),
):
    """
    Mark a discrepancy as resolved with an audit trail.
    Only admin and analyst roles can resolve.
    """
    resolved_by = getattr(request.state, "api_key_name", "unknown")

    async with api_session() as session:
        # Verify discrepancy exists and is open
        check = await session.execute(
            text("SELECT id, status FROM gold_discrepancies WHERE id = :id"),
            {"id": discrepancy_id},
        )
        row = check.mappings().first()

        if not row:
            raise HTTPException(status_code=404, detail="Discrepancy not found")
        if row["status"] == "resolved":
            raise HTTPException(status_code=409, detail="Already resolved")

        # Resolve with audit trail
        await session.execute(
            text("""
                UPDATE gold_discrepancies
                SET status = 'resolved',
                    resolved_at = NOW(),
                    resolved_by = :resolved_by,
                    resolution_note = :note
                WHERE id = :id
            """),
            {
                "id": discrepancy_id,
                "resolved_by": resolved_by,
                "note": resolution_note,
            },
        )

    log.info(
        "discrepancy.resolved",
        discrepancy_id=discrepancy_id,
        resolved_by=resolved_by,
    )

    return {
        "discrepancy_id": discrepancy_id,
        "status": "resolved",
        "resolved_by": resolved_by,
    }


# ── Exposure ──────────────────────────────────────────────────────────────────

@router.get(
    "/exposure",
    summary="Current open financial exposure",
    dependencies=[Depends(require_role(["admin", "analyst", "readonly"]))],
)
async def get_exposure(request: Request):
    """
    Returns the current open financial exposure by PSP and discrepancy type.
    C-010: Exposure must always be non-negative.
    """
    async with api_session() as session:
        result = await session.execute(
            text("""
                SELECT
                    s.psp_name,
                    d.discrepancy_type,
                    COUNT(*) AS open_count,
                    COALESCE(SUM(d.estimated_exposure_ngn), 0) AS total_exposure_ngn
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions s ON d.transaction_id = s.id
                WHERE d.status != 'resolved'
                GROUP BY s.psp_name, d.discrepancy_type
                ORDER BY total_exposure_ngn DESC
            """),
        )
        exposure = [dict(r) for r in result.mappings().all()]

    total = sum(float(e["total_exposure_ngn"]) for e in exposure)

    return {
        "total_open_exposure_ngn": round(total, 2),
        "by_psp_and_type": exposure,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
