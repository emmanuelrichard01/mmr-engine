# src/api/v1/routes/transactions.py
"""
Transaction explorer: the canonical Silver ledger, with match status,
open discrepancies, and full lineage back to the Kafka offset and Bronze file.

Only masked display fields are returned; raw payloads stay in Bronze.
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text

from src.api.middleware.auth import require_role
from src.api.v1.routes.reconciliation import PSP, READ_ROLES, money
from src.storage.postgres import readonly_session

router = APIRouter(prefix="/v1/reconciliation", tags=["Transactions"])

_SUMMARY_COLUMNS = """
    s.id, s.psp_name::text AS psp_name, s.psp_transaction_ref,
    s.transaction_type::text AS transaction_type, s.amount_ngn, s.amount_raw, s.currency_raw,
    s.settlement_status::text AS settlement_status, s.initiated_at, s.settled_at,
    s.expected_settlement_at, s.beneficiary_name_masked, s.beneficiary_bank_name,
    m.pair_id,
    (SELECT COUNT(*) FROM gold_discrepancies d
      WHERE d.transaction_id = s.id AND d.status IN ('open', 'under_review', 'escalated')) AS open_discrepancies
"""


def _iso(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def serialise_summary(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"],
        "psp_name": r["psp_name"],
        "psp_transaction_ref": r["psp_transaction_ref"],
        "transaction_type": r["transaction_type"],
        "amount_ngn": money(r["amount_ngn"]),
        "amount_raw": str(r["amount_raw"]),
        "currency_raw": r["currency_raw"].strip(),
        "settlement_status": r["settlement_status"],
        "initiated_at": _iso(r["initiated_at"]),
        "settled_at": _iso(r["settled_at"]),
        "expected_settlement_at": _iso(r["expected_settlement_at"]),
        "beneficiary_name_masked": r["beneficiary_name_masked"],
        "beneficiary_bank_name": r["beneficiary_bank_name"],
        "match_status": "matched" if r["pair_id"] is not None else "unmatched",
        "pair_id": r["pair_id"],
        "open_discrepancies": r["open_discrepancies"],
    }


def serialise_discrepancy_brief(r: Any) -> dict[str, Any]:
    return {
        "id": r["id"],
        "discrepancy_type": r["discrepancy_type"],
        "severity": r["severity"],
        "status": r["status"],
        "estimated_exposure_ngn": money(r["estimated_exposure_ngn"]),
        "detected_at": _iso(r["raised_at"]),
    }


_DISCREPANCY_BRIEF = """
    SELECT id, classification::text AS discrepancy_type, severity, status::text AS status,
           estimated_exposure_ngn, raised_at
    FROM gold_discrepancies WHERE transaction_id = ANY(:ids)
    ORDER BY raised_at DESC
"""


@router.get("/transactions", summary="Explore canonical transactions", dependencies=[Depends(require_role(READ_ROLES))])
async def list_transactions(
    q: str | None = Query(None, max_length=200, description="PSP reference prefix or exact transaction id"),
    psp_name: PSP | None = Query(None),
    transaction_type: Literal["credit", "debit", "reversal"] | None = Query(None),
    match_status: Literal["matched", "unmatched"] | None = Query(None),
    settlement_status: Literal["pending", "settled", "failed", "reversed"] | None = Query(None),
    date_from: date | None = Query(None, description="Lagos calendar date, inclusive"),
    date_to: date | None = Query(None, description="Lagos calendar date, inclusive"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    tx_id: str | None = None
    ref_prefix: str | None = None
    if q:
        q = q.strip()
        try:
            tx_id = str(UUID(q))
        except ValueError:
            # Escape LIKE metacharacters: the reference is matched as a literal prefix.
            ref_prefix = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    where = """
        WHERE (CAST(:tx_id AS uuid) IS NULL OR s.id = CAST(:tx_id AS uuid))
          AND (CAST(:ref AS text) IS NULL OR s.psp_transaction_ref ILIKE :ref)
          AND (CAST(:psp AS text) IS NULL OR s.psp_name::text = :psp)
          AND (CAST(:tx_type AS text) IS NULL OR s.transaction_type::text = :tx_type)
          AND (CAST(:settlement AS text) IS NULL OR s.settlement_status::text = :settlement)
          AND (CAST(:match_status AS text) IS NULL
               OR (:match_status = 'matched') = (m.transaction_id IS NOT NULL))
          AND (CAST(:date_from AS date) IS NULL OR s.initiated_at >= CAST(:date_from AS date) - INTERVAL '1 hour')
          AND (CAST(:date_to AS date) IS NULL OR s.initiated_at < CAST(:date_to AS date) + INTERVAL '23 hours')
    """
    # Lagos is UTC+1 with no DST: a Lagos calendar day D spans [D 00:00-01, D+1 00:00-01) in UTC.
    params = {
        "tx_id": tx_id,
        "ref": ref_prefix,
        "psp": psp_name,
        "tx_type": transaction_type,
        "settlement": settlement_status,
        "match_status": match_status,
        "date_from": date_from,
        "date_to": date_to,
        "limit": limit,
        "offset": offset,
    }
    async with readonly_session() as session:
        total: int = (
            await session.execute(
                text(
                    "SELECT COUNT(*) FROM silver_canonical_transactions s "
                    "LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id " + where
                ),
                params,
            )
        ).scalar_one()
        rows = (
            (
                await session.execute(
                    text(
                        f"SELECT {_SUMMARY_COLUMNS} FROM silver_canonical_transactions s "
                        "LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id "
                        + where
                        + " ORDER BY s.initiated_at DESC, s.id LIMIT :limit OFFSET :offset"
                    ),
                    params,
                )
            )
            .mappings()
            .all()
        )
    return {"transactions": [serialise_summary(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get(
    "/transactions/{transaction_id}",
    summary="One transaction with match, discrepancies and lineage",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def get_transaction(transaction_id: UUID) -> dict[str, Any]:
    async with readonly_session() as session:
        row = (
            (
                await session.execute(
                    text(f"""
                        SELECT {_SUMMARY_COLUMNS},
                               s.psp_event_type, s.beneficiary_account_masked, s.narration,
                               s.fx_rate_applied, s.idempotency_key, s.created_at,
                               b.kafka_topic, b.kafka_partition, b.kafka_offset,
                               b.received_at AS bronze_received_at, b.file_path AS bronze_file_path,
                               s.processed_by_run_id
                        FROM silver_canonical_transactions s
                        LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
                        JOIN bronze_ingestion_log b ON b.id = s.bronze_ingestion_id
                        WHERE s.id = :id
                    """),
                    {"id": transaction_id},
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            raise HTTPException(status_code=404, detail="Transaction not found")

        pair: dict[str, Any] | None = None
        if row["pair_id"] is not None:
            p = (
                (
                    await session.execute(
                        text("""
                            SELECT g.id, g.match_strategy::text AS match_strategy, g.confidence_score,
                                   g.status::text AS status, g.amount_delta_ngn, g.match_evidence,
                                   c.id AS c_id, c.psp_name::text AS c_psp, c.psp_transaction_ref AS c_ref,
                                   c.transaction_type::text AS c_type, c.amount_ngn AS c_amount,
                                   c.initiated_at AS c_initiated_at
                            FROM gold_reconciliation_pairs g
                            JOIN silver_canonical_transactions c
                              ON c.id = CASE WHEN g.transaction_a_id = :tx THEN g.transaction_b_id
                                             ELSE g.transaction_a_id END
                            WHERE g.id = :pair
                        """),
                        {"tx": transaction_id, "pair": row["pair_id"]},
                    )
                )
                .mappings()
                .first()
            )
            if p is not None:
                pair = {
                    "id": p["id"],
                    "match_strategy": p["match_strategy"],
                    "confidence_score": str(p["confidence_score"]) if p["confidence_score"] is not None else None,
                    "status": p["status"],
                    "amount_delta_ngn": money(p["amount_delta_ngn"]),
                    "match_evidence": p["match_evidence"],
                    "counterpart": {
                        "id": p["c_id"],
                        "psp_name": p["c_psp"],
                        "psp_transaction_ref": p["c_ref"],
                        "transaction_type": p["c_type"],
                        "amount_ngn": money(p["c_amount"]),
                        "initiated_at": _iso(p["c_initiated_at"]),
                    },
                }

        discrepancies = (await session.execute(text(_DISCREPANCY_BRIEF), {"ids": [transaction_id]})).mappings().all()

    transaction = {
        **serialise_summary(row),
        "psp_event_type": row["psp_event_type"],
        "beneficiary_account_masked": row["beneficiary_account_masked"],
        "narration": row["narration"],
        "fx_rate_applied": str(row["fx_rate_applied"]) if row["fx_rate_applied"] is not None else None,
        "idempotency_key": row["idempotency_key"],
        "created_at": _iso(row["created_at"]),
    }
    return {
        "transaction": transaction,
        "pair": pair,
        "discrepancies": [serialise_discrepancy_brief(d) for d in discrepancies],
        "lineage": {
            "kafka_topic": row["kafka_topic"],
            "kafka_partition": row["kafka_partition"],
            "kafka_offset": row["kafka_offset"],
            "bronze_received_at": _iso(row["bronze_received_at"]),
            "bronze_file_path": row["bronze_file_path"],
            "run_id": row["processed_by_run_id"],
        },
    }


@router.get(
    "/pairs/{pair_id}", summary="One matched pair with both legs", dependencies=[Depends(require_role(READ_ROLES))]
)
async def get_pair(pair_id: UUID) -> dict[str, Any]:
    async with readonly_session() as session:
        p = (
            (
                await session.execute(
                    text("""
                        SELECT id, transaction_a_id, transaction_b_id, match_strategy::text AS match_strategy,
                               confidence_score, status::text AS status, amount_a_ngn, amount_b_ngn,
                               amount_delta_ngn, is_within_fx_threshold, match_evidence, created_at
                        FROM gold_reconciliation_pairs WHERE id = :id
                    """),
                    {"id": pair_id},
                )
            )
            .mappings()
            .first()
        )
        if p is None:
            raise HTTPException(status_code=404, detail="Pair not found")
        legs = (
            (
                await session.execute(
                    text(
                        f"SELECT {_SUMMARY_COLUMNS} FROM silver_canonical_transactions s "
                        "LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id "
                        "WHERE s.id = ANY(:ids)"
                    ),
                    {"ids": [p["transaction_a_id"], p["transaction_b_id"]]},
                )
            )
            .mappings()
            .all()
        )
        discrepancies = (
            (
                await session.execute(
                    text(_DISCREPANCY_BRIEF),
                    {"ids": [p["transaction_a_id"], p["transaction_b_id"]]},
                )
            )
            .mappings()
            .all()
        )

    by_id = {leg["id"]: serialise_summary(leg) for leg in legs}
    return {
        "pair": {
            "id": p["id"],
            "match_strategy": p["match_strategy"],
            "confidence_score": str(p["confidence_score"]) if p["confidence_score"] is not None else None,
            "status": p["status"],
            "amount_a_ngn": money(p["amount_a_ngn"]),
            "amount_b_ngn": money(p["amount_b_ngn"]),
            "amount_delta_ngn": money(p["amount_delta_ngn"]),
            "is_within_fx_threshold": p["is_within_fx_threshold"],
            "match_evidence": p["match_evidence"],
            "created_at": _iso(p["created_at"]),
        },
        "a": by_id.get(p["transaction_a_id"]),
        "b": by_id.get(p["transaction_b_id"]),
        "discrepancies": [serialise_discrepancy_brief(d) for d in discrepancies],
    }


AGING_BUCKETS = (("0-1d", 0, 1), ("1-3d", 1, 3), ("3-7d", 3, 7), ("7d+", 7, None))


@router.get(
    "/exposure/aging",
    summary="Open exposure by discrepancy age",
    dependencies=[Depends(require_role(READ_ROLES))],
)
async def get_exposure_aging() -> dict[str, Any]:
    async with readonly_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                        SELECT s.psp_name::text AS psp_name,
                               CASE WHEN NOW() - d.raised_at < INTERVAL '1 day' THEN '0-1d'
                                    WHEN NOW() - d.raised_at < INTERVAL '3 days' THEN '1-3d'
                                    WHEN NOW() - d.raised_at < INTERVAL '7 days' THEN '3-7d'
                                    ELSE '7d+' END AS bucket,
                               COUNT(*) AS n,
                               COALESCE(SUM(d.estimated_exposure_ngn), 0) AS exposure
                        FROM gold_discrepancies d
                        JOIN silver_canonical_transactions s ON s.id = d.transaction_id
                        WHERE d.status IN ('open', 'under_review', 'escalated')
                        GROUP BY 1, 2
                    """)
                )
            )
            .mappings()
            .all()
        )

    def empty() -> dict[str, dict[str, Any]]:
        return {name: {"bucket": name, "count": 0, "exposure": Decimal(0)} for name, _, _ in AGING_BUCKETS}

    overall = empty()
    per_psp: dict[str, dict[str, dict[str, Any]]] = {}
    for r in rows:
        for target in (overall, per_psp.setdefault(r["psp_name"], empty())):
            target[r["bucket"]]["count"] += r["n"]
            target[r["bucket"]]["exposure"] += Decimal(r["exposure"])

    def render(buckets: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"bucket": b["bucket"], "count": b["count"], "exposure_ngn": money(b["exposure"])} for b in buckets.values()
        ]

    return {
        "buckets": render(overall),
        "by_psp": [{"psp_name": psp, "buckets": render(b)} for psp, b in sorted(per_psp.items())],
        "generated_at": datetime.now(UTC).isoformat(),
    }
