# src/api/v1/routes/system.py
"""
Operational read endpoints: pipeline run history and unified search.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text

from src.api.middleware.auth import require_role
from src.api.v1.routes.reconciliation import READ_ROLES, money
from src.storage.postgres import readonly_session

router = APIRouter(tags=["System"])

SEARCH_LIMIT = 20


def _first_line(message: str | None) -> str | None:
    """First line only, capped: tracebacks stay in the database, not in the UI."""
    lines = (message or "").strip().splitlines()
    return lines[0][:300] if lines else None


@router.get(
    "/v1/system/pipeline-runs",
    summary="Recent pipeline runs",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def list_pipeline_runs(
    limit: int = Query(20, ge=1, le=200),
    flow_name: str | None = Query(None, max_length=200),
) -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                        SELECT id, flow_name, status::text AS status, triggered_by, started_at, completed_at,
                               duration_seconds, records_processed, records_failed, error_message
                        FROM system_pipeline_runs
                        WHERE (CAST(:flow AS text) IS NULL OR flow_name = :flow)
                        ORDER BY started_at DESC, id
                        LIMIT :limit
                    """),
                    {"flow": flow_name, "limit": limit},
                )
            )
            .mappings()
            .all()
        )
    return {
        "runs": [
            {
                "id": r["id"],
                "flow_name": r["flow_name"],
                "status": r["status"],
                "triggered_by": r["triggered_by"],
                "started_at": r["started_at"].isoformat(),
                "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                "duration_seconds": float(r["duration_seconds"]) if r["duration_seconds"] is not None else None,
                "records_processed": r["records_processed"] or 0,
                "records_failed": r["records_failed"] or 0,
                "error_message": _first_line(r["error_message"]),
            }
            for r in rows
        ]
    }


@router.get(
    "/v1/search",
    summary="Search transactions, discrepancies and pairs",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def search(q: str = Query(..., min_length=3, max_length=200)) -> dict[str, Any]:
    """
    Exact id lookups across all three entity kinds, plus PSP-reference prefix
    search over transactions. Prefix search uses the (psp_name, ref) index.
    """
    term = q.strip()
    try:
        exact_id: str | None = str(UUID(term))
    except ValueError:
        exact_id = None
    prefix = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    results: list[dict[str, Any]] = []
    async with readonly_session() as session:
        if exact_id:
            disc = (
                (
                    await session.execute(
                        text("""
                            SELECT d.id, d.classification::text AS kind, d.severity, d.estimated_exposure_ngn,
                                   s.psp_transaction_ref
                            FROM gold_discrepancies d
                            JOIN silver_canonical_transactions s ON s.id = d.transaction_id
                            WHERE d.id = CAST(:id AS uuid)
                        """),
                        {"id": exact_id},
                    )
                )
                .mappings()
                .first()
            )
            if disc:
                results.append(
                    {
                        "kind": "discrepancy",
                        "id": disc["id"],
                        "title": disc["kind"].replace("_", " ").capitalize(),
                        "subtitle": f"{disc['severity'] or 'unclassified'} · NGN {money(disc['estimated_exposure_ngn'])}"
                        f" · {disc['psp_transaction_ref']}",
                    }
                )
            pair = (
                (
                    await session.execute(
                        text("""
                            SELECT id, match_strategy::text AS strategy, confidence_score
                            FROM gold_reconciliation_pairs WHERE id = CAST(:id AS uuid)
                        """),
                        {"id": exact_id},
                    )
                )
                .mappings()
                .first()
            )
            if pair:
                results.append(
                    {
                        "kind": "pair",
                        "id": pair["id"],
                        "title": "Matched pair",
                        "subtitle": f"{pair['strategy'].replace('_', ' ')} · confidence {pair['confidence_score']}",
                    }
                )

        txs = (
            (
                await session.execute(
                    text("""
                        SELECT id, psp_name::text AS psp_name, psp_transaction_ref,
                               transaction_type::text AS transaction_type, amount_ngn
                        FROM silver_canonical_transactions
                        WHERE (CAST(:id AS uuid) IS NOT NULL AND id = CAST(:id AS uuid))
                           OR psp_transaction_ref ILIKE :prefix
                        ORDER BY initiated_at DESC
                        LIMIT :limit
                    """),
                    {"id": exact_id, "prefix": prefix, "limit": SEARCH_LIMIT},
                )
            )
            .mappings()
            .all()
        )
        for t in txs:
            results.append(
                {
                    "kind": "transaction",
                    "id": t["id"],
                    "title": t["psp_transaction_ref"],
                    "subtitle": f"{t['psp_name']} {t['transaction_type']} · NGN {money(t['amount_ngn'])}",
                }
            )
    return {"results": results[:SEARCH_LIMIT]}
