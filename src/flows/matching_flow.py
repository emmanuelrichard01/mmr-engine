# src/flows/matching_flow.py
"""
Silver-to-Gold Matching Flow.

Orchestrates the reconciliation matching pipeline:
    1. Fetch unmatched Silver transactions
    2. Run the two-tier matching engine
    3. Write matched pairs to gold_reconciliation_pairs
    4. Classify and write discrepancies to gold_discrepancies
    5. Update exposure tracker

References:
    - TDD §10.4: Matching Flow
    - QA C-004, C-005
"""
import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
from typing import Any

from prefect import flow, task, get_run_logger
from sqlalchemy import text

from src.engine.matching import (
    TransactionCandidate, run_matching, MatchStrategy, DEFAULT_CONFIG,
)
from src.engine.discrepancy import (
    classify_missing_settlement, classify_amount_discrepancy,
    DiscrepancyType,
)
from src.storage.postgres import pipeline_session
from src.observability.metrics import (
    SILVER_RECORDS_WRITTEN, GOLD_MATCHES_COUNTER,
)


@task(name="fetch-unmatched-transactions", tags=["gold", "matching"])
async def fetch_unmatched_transactions(
    psp_name: str | None = None,
    limit: int = 500,
) -> list[dict]:
    """Fetch Silver transactions not yet in gold_reconciliation_pairs."""
    logger = get_run_logger()
    async with pipeline_session() as session:
        psp_filter = "AND s.psp_name = :psp" if psp_name else ""
        result = await session.execute(
            text(f"""
                SELECT s.id, s.psp_name, s.transaction_type, s.amount_ngn,
                       s.currency_raw, s.initiated_at, s.settled_at,
                       s.beneficiary_name_masked, s.beneficiary_bank_code,
                       s.sender_bank_code, s.expected_settlement_at,
                       s.settlement_status
                FROM silver_canonical_transactions s
                LEFT JOIN gold_reconciliation_pairs g1
                    ON s.id = g1.transaction_a_id
                LEFT JOIN gold_reconciliation_pairs g2
                    ON s.id = g2.transaction_b_id
                WHERE g1.id IS NULL AND g2.id IS NULL
                {psp_filter}
                ORDER BY s.initiated_at ASC
                LIMIT :limit
            """),
            {"psp": psp_name, "limit": limit},
        )
        rows = result.mappings().all()
    logger.info(f"Fetched {len(rows)} unmatched transactions")
    return [dict(r) for r in rows]


@task(name="run-matching-engine", tags=["gold", "matching"])
async def run_matching_engine_task(
    unmatched: list[dict],
) -> list[dict]:
    """Run two-tier matching on all unmatched transactions."""
    logger = get_run_logger()
    results = []

    candidates = [
        TransactionCandidate(
            id=tx["id"], psp_name=tx["psp_name"],
            transaction_type=tx["transaction_type"],
            amount_ngn=Decimal(str(tx["amount_ngn"])),
            currency_raw=tx["currency_raw"],
            initiated_at=tx["initiated_at"],
            settled_at=tx.get("settled_at"),
            beneficiary_name_masked=tx.get("beneficiary_name_masked"),
            beneficiary_bank_code=tx.get("beneficiary_bank_code"),
            sender_bank_code=tx.get("sender_bank_code"),
        )
        for tx in unmatched
    ]

    matched_ids = set()
    for i, tx_dict in enumerate(unmatched):
        source = candidates[i]
        if source.id in matched_ids:
            continue
        available = [
            c for c in candidates
            if c.id != source.id and c.id not in matched_ids
        ]
        result = run_matching(source, available)
        if result.matched_transaction_id is not None:
            matched_ids.add(result.matched_transaction_id)
            matched_ids.add(source.id)
        results.append({
            "source_id": result.source_transaction_id,
            "matched_id": result.matched_transaction_id,
            "strategy": result.strategy.value,
            "confidence": result.confidence_score,
            "evidence": result.confidence_evidence,
            "amount_delta_ngn": str(result.amount_delta_ngn) if result.amount_delta_ngn else None,
            "is_within_fx_threshold": result.is_within_fx_threshold,
            "source_amount_ngn": str(tx_dict["amount_ngn"]),
        })

    matched_count = sum(1 for r in results if r["matched_id"] is not None)
    logger.info(f"Matching complete: {matched_count}/{len(results)} matched")
    return results


@task(name="write-gold-pairs", tags=["gold", "storage"])
async def write_gold_pairs(
    match_results: list[dict],
    run_id: str,
) -> int:
    """Write matched pairs to gold_reconciliation_pairs."""
    logger = get_run_logger()
    written = 0
    async with pipeline_session() as session:
        for r in match_results:
            if r["matched_id"] is None:
                continue
            status = "matched" if r["strategy"] != "unmatched" else "unmatched"
            await session.execute(
                text("""
                    INSERT INTO gold_reconciliation_pairs
                        (transaction_a_id, transaction_b_id, match_strategy,
                         confidence_score, amount_a_ngn, amount_delta_ngn,
                         is_within_fx_threshold, status,
                         confidence_evidence, dbt_run_id)
                    VALUES
                        (:a_id, :b_id, :strategy, :confidence,
                         :amount_a, :delta, :fx_flag, :status,
                         :evidence::jsonb, :run_id)
                    ON CONFLICT (transaction_a_id, transaction_b_id) DO NOTHING
                """),
                {
                    "a_id": r["source_id"],
                    "b_id": r["matched_id"],
                    "strategy": r["strategy"],
                    "confidence": r["confidence"],
                    "amount_a": Decimal(r["source_amount_ngn"]),
                    "delta": Decimal(r["amount_delta_ngn"]) if r["amount_delta_ngn"] else Decimal("0"),
                    "fx_flag": r["is_within_fx_threshold"],
                    "status": status,
                    "evidence": json.dumps(r["evidence"]),
                    "run_id": run_id,
                },
            )
            written += 1
    logger.info(f"Wrote {written} Gold reconciliation pairs")
    return written


@task(name="classify-discrepancies", tags=["gold", "discrepancy"])
async def classify_and_write_discrepancies(
    unmatched_txs: list[dict],
    run_id: str,
) -> int:
    """
    For unmatched transactions past their expected settlement,
    classify and write discrepancies.
    """
    logger = get_run_logger()
    now = datetime.now(timezone.utc)
    written = 0

    async with pipeline_session() as session:
        for tx in unmatched_txs:
            expected = tx.get("expected_settlement_at")
            if expected is None:
                continue
            if tx.get("settlement_status") == "settled":
                continue
            result = classify_missing_settlement(
                Decimal(str(tx["amount_ngn"])), expected, now,
            )
            if result.discrepancy_type is None:
                continue
            await session.execute(
                text("""
                    INSERT INTO gold_discrepancies
                        (transaction_id, discrepancy_type, severity,
                         estimated_exposure_ngn, evidence,
                         detected_by_run_id, status)
                    VALUES
                        (:tx_id, :dtype, :severity, :exposure,
                         :evidence::jsonb, :run_id, 'open')
                    ON CONFLICT (transaction_id, discrepancy_type) DO NOTHING
                """),
                {
                    "tx_id": tx["id"],
                    "dtype": result.discrepancy_type.value,
                    "severity": result.severity.value,
                    "exposure": result.estimated_exposure_ngn,
                    "evidence": json.dumps(result.evidence),
                    "run_id": run_id,
                },
            )
            written += 1
    logger.info(f"Wrote {written} Gold discrepancies")
    return written


@flow(name="silver-to-gold-matching-flow", log_prints=True)
async def silver_to_gold_matching_flow(
    psp_name: str | None = None,
    limit: int = 500,
) -> dict:
    """Orchestrate the full Silver → Gold matching pipeline."""
    run_id = str(uuid4())
    unmatched = await fetch_unmatched_transactions(psp_name, limit)
    if not unmatched:
        return {"run_id": run_id, "matched": 0, "discrepancies": 0}
    results = await run_matching_engine_task(unmatched)
    pairs_written = await write_gold_pairs(results, run_id)
    unmatched_txs = [
        unmatched[i] for i, r in enumerate(results) if r["matched_id"] is None
    ]
    disc_written = await classify_and_write_discrepancies(unmatched_txs, run_id)
    return {
        "run_id": run_id,
        "total_processed": len(unmatched),
        "matched": pairs_written,
        "discrepancies": disc_written,
        "unmatched_remaining": len(unmatched) - pairs_written,
    }
