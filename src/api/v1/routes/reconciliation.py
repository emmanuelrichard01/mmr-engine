# src/api/v1/routes/reconciliation.py
"""
Reconciliation API Routes.

Read access to matching results, discrepancies and exposure; write access
for discrepancy resolution (analyst+).

Money is returned as decimal strings ("50000.00"), never JSON floats: a
float cannot represent most kobo amounts exactly. Timestamps are ISO-8601
UTC; "days" are Africa/Lagos calendar days.

References:
    - API Specification §4: Reconciliation Endpoints
    - QA C-004, C-005, C-010
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from src.api.middleware.auth import require_role
from src.storage.postgres import api_session, readonly_session

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/reconciliation", tags=["Reconciliation"])

LAGOS = ZoneInfo("Africa/Lagos")
READ_ROLES = ["admin", "analyst", "readonly"]
WRITE_ROLES = ["admin", "analyst"]

DiscrepancyStatus = Literal["open", "under_review", "resolved", "false_positive", "escalated"]
Severity = Literal["low", "medium", "high", "critical"]
PSP = Literal["paystack", "flutterwave"]


def money(value: Decimal | int | None) -> str | None:
    """Decimal → fixed 2dp string, preserving exactness."""
    if value is None:
        return None
    return str(Decimal(value).quantize(Decimal("0.01")))


def _today_lagos() -> date:
    return datetime.now(LAGOS).date()


# ── Summary ───────────────────────────────────────────────────────────────


@router.get("/summary", summary="Daily reconciliation summary", dependencies=[Depends(require_role(READ_ROLES))])
async def get_reconciliation_summary(
    report_date: date | None = Query(None, description="Lagos calendar date (YYYY-MM-DD). Defaults to today."),
) -> dict[str, Any]:
    target_date = report_date or _today_lagos()
    async with readonly_session() as session:
        stats = (
            (
                await session.execute(
                    text("""
                SELECT
                    COUNT(*) AS total_count,
                    COUNT(m.transaction_id) AS matched_count
                FROM silver_canonical_transactions s
                LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
                WHERE s.transaction_type IN ('credit', 'debit')
                  AND (s.initiated_at AT TIME ZONE 'Africa/Lagos')::date = :d
            """),
                    {"d": target_date},
                )
            )
            .mappings()
            .one()
        )
        disc_rows = (
            (
                await session.execute(
                    text("""
                SELECT classification::text AS discrepancy_type,
                       COUNT(*) AS count,
                       COALESCE(SUM(estimated_exposure_ngn), 0) AS total_exposure
                FROM gold_discrepancies
                WHERE (raised_at AT TIME ZONE 'Africa/Lagos')::date = :d
                GROUP BY classification
                ORDER BY classification
            """),
                    {"d": target_date},
                )
            )
            .mappings()
            .all()
        )

    total, matched = stats["total_count"], stats["matched_count"]
    return {
        "report_date": target_date.isoformat(),
        "total_transactions": total,
        "matched": matched,
        "unmatched": total - matched,
        "match_rate_pct": round(matched / total * 100, 2) if total else None,
        "discrepancies": [
            {
                "discrepancy_type": r["discrepancy_type"],
                "count": r["count"],
                "total_exposure": money(r["total_exposure"]),
            }
            for r in disc_rows
        ],
        "generated_at": datetime.now(UTC).isoformat(),
    }


@router.get("/trend", summary="Daily match-rate trend", dependencies=[Depends(require_role(READ_ROLES))])
async def get_trend(days: int = Query(30, ge=1, le=180)) -> dict[str, Any]:
    """One row per Lagos calendar day (oldest first), including days with no traffic."""
    end = _today_lagos()
    start = end - timedelta(days=days - 1)
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                WITH days AS (
                    SELECT d::date AS day
                    FROM generate_series(CAST(:start AS date), CAST(:end AS date), INTERVAL '1 day') d
                ),
                tx AS (
                    SELECT (s.initiated_at AT TIME ZONE 'Africa/Lagos')::date AS day,
                           COUNT(*) AS total,
                           COUNT(m.transaction_id) AS matched,
                           COALESCE(SUM(s.amount_ngn), 0) AS volume
                    FROM silver_canonical_transactions s
                    LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
                    WHERE s.transaction_type IN ('credit', 'debit')
                      AND s.initiated_at >= CAST(:start AS date) - INTERVAL '1 hour'
                    GROUP BY 1
                ),
                disc AS (
                    SELECT (raised_at AT TIME ZONE 'Africa/Lagos')::date AS day, COUNT(*) AS raised
                    FROM gold_discrepancies
                    WHERE raised_at >= CAST(:start AS date) - INTERVAL '1 hour'
                    GROUP BY 1
                )
                SELECT days.day, COALESCE(tx.total, 0) AS total, COALESCE(tx.matched, 0) AS matched,
                       COALESCE(tx.volume, 0) AS volume, COALESCE(disc.raised, 0) AS raised
                FROM days
                LEFT JOIN tx USING (day)
                LEFT JOIN disc USING (day)
                ORDER BY days.day
            """),
                    {"start": start, "end": end},
                )
            )
            .mappings()
            .all()
        )
    return {
        "days": [
            {
                "date": r["day"].isoformat(),
                "total": r["total"],
                "matched": r["matched"],
                "match_rate_pct": round(r["matched"] / r["total"] * 100, 2) if r["total"] else None,
                "volume_ngn": money(r["volume"]),
                "discrepancies_raised": r["raised"],
            }
            for r in rows
        ]
    }


@router.get(
    "/psp-health",
    summary="Per-PSP ingestion and reconciliation health",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def get_psp_health() -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                WITH psps AS (SELECT unnest(ARRAY['paystack', 'flutterwave']) AS psp_name),
                events AS (
                    SELECT psp_name::text AS psp_name,
                           COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') AS events_24h,
                           MAX(received_at) AS last_event_at
                    FROM bronze_ingestion_log GROUP BY 1
                ),
                rate AS (
                    SELECT s.psp_name::text AS psp_name, COUNT(*) AS total, COUNT(m.transaction_id) AS matched
                    FROM silver_canonical_transactions s
                    LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
                    WHERE s.transaction_type IN ('credit', 'debit')
                      AND s.initiated_at >= NOW() - INTERVAL '7 days'
                    GROUP BY 1
                ),
                disc AS (
                    SELECT s.psp_name::text AS psp_name, COUNT(*) AS open_count,
                           COALESCE(SUM(d.estimated_exposure_ngn), 0) AS open_exposure
                    FROM gold_discrepancies d
                    JOIN silver_canonical_transactions s ON s.id = d.transaction_id
                    WHERE d.status IN ('open', 'under_review', 'escalated')
                    GROUP BY 1
                )
                SELECT p.psp_name,
                       COALESCE(e.events_24h, 0) AS events_24h, e.last_event_at,
                       r.total, r.matched,
                       COALESCE(d.open_count, 0) AS open_discrepancies,
                       COALESCE(d.open_exposure, 0) AS open_exposure
                FROM psps p
                LEFT JOIN events e USING (psp_name)
                LEFT JOIN rate r USING (psp_name)
                LEFT JOIN disc d USING (psp_name)
                ORDER BY p.psp_name
            """),
                )
            )
            .mappings()
            .all()
        )
    return {
        "psps": [
            {
                "psp_name": r["psp_name"],
                "events_24h": r["events_24h"],
                "last_event_at": r["last_event_at"].isoformat() if r["last_event_at"] else None,
                "match_rate_pct_7d": round(r["matched"] / r["total"] * 100, 2) if r["total"] else None,
                "open_discrepancies": r["open_discrepancies"],
                "open_exposure_ngn": money(r["open_exposure"]),
            }
            for r in rows
        ]
    }


# ── Matched Pairs ─────────────────────────────────────────────────────────


@router.get("/pairs", summary="List matched transaction pairs", dependencies=[Depends(require_role(READ_ROLES))])
async def list_reconciliation_pairs(
    status: Literal["matched", "discrepancy", "under_review", "resolved", "false_positive"] | None = Query(None),
    psp_name: PSP | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                SELECT g.id, g.transaction_a_id, g.transaction_b_id,
                       g.match_strategy::text AS match_strategy, g.confidence_score,
                       g.amount_a_ngn, g.amount_b_ngn, g.amount_delta_ngn,
                       g.is_within_fx_threshold, g.status::text AS status, g.created_at,
                       sa.psp_name::text AS psp_a, sb.psp_name::text AS psp_b
                FROM gold_reconciliation_pairs g
                JOIN silver_canonical_transactions sa ON g.transaction_a_id = sa.id
                JOIN silver_canonical_transactions sb ON g.transaction_b_id = sb.id
                WHERE (CAST(:status AS text) IS NULL OR g.status::text = :status)
                  AND (CAST(:psp AS text) IS NULL OR sa.psp_name::text = :psp OR sb.psp_name::text = :psp)
                ORDER BY g.created_at DESC, g.id
                LIMIT :limit OFFSET :offset
            """),
                    {"status": status, "psp": psp_name, "limit": limit, "offset": offset},
                )
            )
            .mappings()
            .all()
        )
    pairs = [
        {
            **{
                k: r[k]
                for k in (
                    "id",
                    "transaction_a_id",
                    "transaction_b_id",
                    "match_strategy",
                    "is_within_fx_threshold",
                    "status",
                    "psp_a",
                    "psp_b",
                )
            },
            "confidence_score": str(r["confidence_score"]) if r["confidence_score"] is not None else None,
            "amount_a_ngn": money(r["amount_a_ngn"]),
            "amount_b_ngn": money(r["amount_b_ngn"]),
            "amount_delta_ngn": money(r["amount_delta_ngn"]),
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    return {"pairs": pairs, "limit": limit, "offset": offset, "count": len(pairs)}


# ── Discrepancies ─────────────────────────────────────────────────────────


@router.get("/discrepancies", summary="List discrepancies", dependencies=[Depends(require_role(READ_ROLES))])
async def list_discrepancies(
    status: DiscrepancyStatus | Literal["all"] = Query("open", description="Filter by status, or 'all'"),
    severity: Severity | None = Query(None),
    psp_name: PSP | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                SELECT d.id, d.transaction_id, d.classification::text AS discrepancy_type,
                       d.severity, d.estimated_exposure_ngn, d.evidence,
                       d.status::text AS status, d.raised_at, d.resolved_at, d.resolved_by,
                       d.resolution_note,
                       s.psp_name::text AS psp_name, s.amount_ngn, s.psp_transaction_ref
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions s ON d.transaction_id = s.id
                WHERE (CAST(:status AS text) IS NULL OR d.status::text = :status)
                  AND (CAST(:severity AS text) IS NULL OR d.severity = :severity)
                  AND (CAST(:psp AS text) IS NULL OR s.psp_name::text = :psp)
                ORDER BY
                    CASE d.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                                    WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
                    d.raised_at DESC, d.id
                LIMIT :limit OFFSET :offset
            """),
                    {
                        "status": None if status == "all" else status,
                        "severity": severity,
                        "psp": psp_name,
                        "limit": limit,
                        "offset": offset,
                    },
                )
            )
            .mappings()
            .all()
        )
    discrepancies = [
        {
            "id": r["id"],
            "transaction_id": r["transaction_id"],
            "discrepancy_type": r["discrepancy_type"],
            "severity": r["severity"],
            "estimated_exposure_ngn": money(r["estimated_exposure_ngn"]),
            "amount_ngn": money(r["amount_ngn"]),
            "evidence": r["evidence"],
            "status": r["status"],
            "detected_at": r["raised_at"].isoformat(),
            "resolved_at": r["resolved_at"].isoformat() if r["resolved_at"] else None,
            "resolved_by": r["resolved_by"],
            "resolution_note": r["resolution_note"],
            "psp_name": r["psp_name"],
            "psp_transaction_ref": r["psp_transaction_ref"],
        }
        for r in rows
    ]
    return {"discrepancies": discrepancies, "limit": limit, "offset": offset, "count": len(discrepancies)}


@router.get(
    "/discrepancies/{discrepancy_id}/events",
    summary="Audit trail of one discrepancy",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def get_discrepancy_events(discrepancy_id: UUID) -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                SELECT action, from_status::text AS from_status, to_status::text AS to_status,
                       actor, note, occurred_at
                FROM gold_discrepancy_events
                WHERE discrepancy_id = CAST(:id AS uuid)
                ORDER BY occurred_at, id
            """),
                    {"id": str(discrepancy_id)},
                )
            )
            .mappings()
            .all()
        )
    return {
        "discrepancy_id": str(discrepancy_id),
        "events": [{**dict(r), "occurred_at": r["occurred_at"].isoformat()} for r in rows],
    }


class ResolveRequest(BaseModel):
    resolution_note: str = Field(min_length=10, max_length=2000)
    outcome: Literal["resolved", "false_positive"] = "resolved"


@router.post(
    "/discrepancies/{discrepancy_id}/resolve",
    summary="Resolve a discrepancy",
    dependencies=[Depends(require_role(WRITE_ROLES))],
)
async def resolve_discrepancy(request: Request, discrepancy_id: UUID, body: ResolveRequest) -> dict[str, Any]:
    """
    Close a discrepancy with a mandatory note. The state change and its audit
    event are written in one transaction; the row lock prevents two analysts
    resolving the same discrepancy concurrently.
    """
    actor = getattr(request.state, "api_key_name", None) or "unknown"
    disc_id = str(discrepancy_id)
    async with api_session() as session:
        row = (
            (
                await session.execute(
                    text("""
                SELECT id, status::text AS status FROM gold_discrepancies
                WHERE id = CAST(:id AS uuid)
                FOR UPDATE
            """),
                    {"id": disc_id},
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Discrepancy not found")
        if row["status"] in ("resolved", "false_positive"):
            raise HTTPException(status_code=409, detail=f"Already {row['status']}")

        await session.execute(
            text("""
                UPDATE gold_discrepancies
                SET status = CAST(:outcome AS discrepancy_status_enum),
                    resolved_at = NOW(), resolved_by = :actor,
                    resolution_note = :note, updated_at = NOW()
                WHERE id = CAST(:id AS uuid)
            """),
            {"id": disc_id, "outcome": body.outcome, "actor": actor, "note": body.resolution_note},
        )
        await session.execute(
            text("""
                INSERT INTO gold_discrepancy_events (discrepancy_id, action, from_status, to_status, actor, note)
                VALUES (CAST(:id AS uuid), :action, CAST(:from_status AS discrepancy_status_enum),
                        CAST(:outcome AS discrepancy_status_enum), :actor, :note)
            """),
            {
                "id": disc_id,
                "action": "resolved" if body.outcome == "resolved" else "marked_false_positive",
                "from_status": row["status"],
                "outcome": body.outcome,
                "actor": actor,
                "note": body.resolution_note,
            },
        )

    log.info("discrepancy.resolved", discrepancy_id=disc_id, outcome=body.outcome)
    return {"discrepancy_id": disc_id, "status": body.outcome, "resolved_by": actor}


class BulkResolveRequest(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=100)
    resolution_note: str = Field(min_length=10, max_length=2000)
    outcome: Literal["resolved", "false_positive"] = "resolved"


@router.post(
    "/discrepancies/bulk-resolve",
    summary="Resolve up to 100 discrepancies with one note",
    dependencies=[Depends(require_role(WRITE_ROLES))],
)
async def bulk_resolve_discrepancies(request: Request, body: BulkResolveRequest) -> dict[str, Any]:
    """
    All-or-nothing per item, in one transaction: each open discrepancy is
    locked, closed and given its own audit event; ids that are unknown or
    already closed are reported as skipped rather than failing the batch.
    """
    actor = getattr(request.state, "api_key_name", None) or "unknown"
    ids = sorted({str(i) for i in body.ids})  # stable lock order avoids deadlocks
    action = "resolved" if body.outcome == "resolved" else "marked_false_positive"
    async with api_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                        SELECT id::text AS id, status::text AS status FROM gold_discrepancies
                        WHERE id = ANY(CAST(:ids AS uuid[]))
                        ORDER BY id
                        FOR UPDATE
                    """),
                    {"ids": ids},
                )
            )
            .mappings()
            .all()
        )
        found = {r["id"]: r["status"] for r in rows}
        closable = [i for i in ids if found.get(i) not in (None, "resolved", "false_positive")]
        if closable:
            await session.execute(
                text("""
                    INSERT INTO gold_discrepancy_events (discrepancy_id, action, from_status, to_status, actor, note)
                    SELECT d.id, :action, d.status, CAST(:outcome AS discrepancy_status_enum), :actor, :note
                    FROM gold_discrepancies d WHERE d.id = ANY(CAST(:ids AS uuid[]))
                """),
                {
                    "ids": closable,
                    "action": action,
                    "outcome": body.outcome,
                    "actor": actor,
                    "note": body.resolution_note,
                },
            )
            await session.execute(
                text("""
                    UPDATE gold_discrepancies
                    SET status = CAST(:outcome AS discrepancy_status_enum),
                        resolved_at = NOW(), resolved_by = :actor,
                        resolution_note = :note, updated_at = NOW()
                    WHERE id = ANY(CAST(:ids AS uuid[]))
                """),
                {"ids": closable, "outcome": body.outcome, "actor": actor, "note": body.resolution_note},
            )

    skipped = [
        {"id": i, "reason": "not_found" if i not in found else "already_closed"} for i in ids if i not in closable
    ]
    log.info("discrepancy.bulk_resolved", resolved=len(closable), skipped=len(skipped), outcome=body.outcome)
    return {"resolved": closable, "skipped": skipped}


# ── Exposure ──────────────────────────────────────────────────────────────


@router.get("/exposure", summary="Current open financial exposure", dependencies=[Depends(require_role(READ_ROLES))])
async def get_exposure() -> dict[str, Any]:
    """Open exposure by PSP and discrepancy type. C-010: always non-negative."""
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                SELECT s.psp_name::text AS psp_name, d.classification::text AS discrepancy_type,
                       COUNT(*) AS open_count,
                       COALESCE(SUM(d.estimated_exposure_ngn), 0) AS total_exposure_ngn
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions s ON d.transaction_id = s.id
                WHERE d.status IN ('open', 'under_review', 'escalated')
                GROUP BY 1, 2
                ORDER BY total_exposure_ngn DESC
            """),
                )
            )
            .mappings()
            .all()
        )
    total = sum((Decimal(r["total_exposure_ngn"]) for r in rows), Decimal(0))
    return {
        "total_open_exposure_ngn": money(total),
        "by_psp_and_type": [{**dict(r), "total_exposure_ngn": money(r["total_exposure_ngn"])} for r in rows],
        "generated_at": datetime.now(UTC).isoformat(),
    }
