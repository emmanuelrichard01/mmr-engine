# src/flows/matching_flow.py
"""
Silver-to-Gold Matching Flow.

    1. Load every not-yet-matched credit/debit inside the lookback window
    2. Run the two-tier matching engine (pure, in memory)
    3. Persist each pair atomically: the pair row plus one
       gold_matched_transactions row per side. The primary key on
       transaction_id means a concurrent run cannot match the same
       transaction twice; the losing run's savepoint is rolled back.
    4. Classify amount/FX discrepancies on probabilistic pairs with a delta
    5. Raise missing-settlement discrepancies with one set-based SQL statement
    6. Refresh the summary view

Fixes over the original implementation:
    - Results are keyed by transaction id. The old code skipped already-matched
      sources without emitting a result, then paired results with inputs by
      list position, so discrepancies landed on the wrong transactions.
    - The candidate set is everything unmatched within the lookback window,
      not "the oldest 500 unmatched", which permanently starved new
      transactions once 500 unmatchable ones accumulated.
    - Missing-settlement detection is independent of which rows the matcher
      happened to load.

References:
    - TDD §10.4: Matching Flow
    - QA C-004, C-005
"""

import json
from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

import structlog
from prefect import flow
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from src.engine.discrepancy import DiscrepancyType, classify_amount_discrepancy
from src.engine.matching import MatchingConfig, MatchResult, MatchStrategy, TransactionCandidate, run_matching
from src.observability.metrics import (
    DISCREPANCIES_RAISED,
    MATCHING_CONFIDENCE_HISTOGRAM,
    MATCHING_RESULTS,
)
from src.storage.pipeline_runs import finish_run, start_run
from src.storage.postgres import pipeline_session

log = structlog.get_logger(__name__)

# Severity grows with how overdue a settlement is. Computed in SQL so the
# whole backlog is classified in one statement; mirrors
# src/engine/discrepancy.py::classify_missing_settlement.
_MISSING_SETTLEMENT_SQL = text("""
    WITH overdue AS (
        SELECT s.id, s.amount_ngn, s.expected_settlement_at,
               EXTRACT(EPOCH FROM (NOW() - s.expected_settlement_at)) / 3600 AS overdue_hours
        FROM silver_canonical_transactions s
        WHERE s.transaction_type IN ('credit', 'debit')
          AND s.settlement_status = 'pending'
          AND s.expected_settlement_at IS NOT NULL
          AND s.expected_settlement_at < NOW()
          AND NOT EXISTS (SELECT 1 FROM gold_matched_transactions m WHERE m.transaction_id = s.id)
    ),
    upserted AS (
        INSERT INTO gold_discrepancies
            (transaction_id, classification, severity, confidence_score,
             estimated_exposure_ngn, evidence, dbt_run_id, status)
        SELECT
            o.id,
            'missing_settlement'::discrepancy_class_enum,
            CASE WHEN o.overdue_hours > 48 THEN 'critical'
                 WHEN o.overdue_hours > 24 THEN 'high'
                 ELSE 'medium' END,
            1.0,
            o.amount_ngn,
            jsonb_build_object(
                'expected_settlement_at', o.expected_settlement_at,
                'overdue_hours', ROUND(o.overdue_hours::numeric, 2),
                'amount_ngn', o.amount_ngn::text
            ),
            CAST(:run_id AS UUID),
            'open'
        FROM overdue o
        ON CONFLICT (transaction_id, classification) DO UPDATE
            SET severity = EXCLUDED.severity,
                evidence = EXCLUDED.evidence,
                updated_at = NOW()
            WHERE gold_discrepancies.status = 'open'
              AND gold_discrepancies.severity IS DISTINCT FROM EXCLUDED.severity
        RETURNING id, (xmax = 0) AS inserted
    )
    INSERT INTO gold_discrepancy_events (discrepancy_id, action, from_status, to_status, actor)
    SELECT id,
           CASE WHEN inserted THEN 'raised' ELSE 'severity_changed' END,
           CASE WHEN inserted THEN NULL ELSE 'open'::discrepancy_status_enum END,
           'open'::discrepancy_status_enum,
           'system:matching-flow'
    FROM upserted
    RETURNING discrepancy_id, action
""")


async def fetch_match_candidates(lookback: timedelta) -> list[TransactionCandidate]:
    """Every unmatched, non-failed credit/debit initiated within the lookback window."""
    async with pipeline_session() as session:
        result = await session.execute(
            text("""
                SELECT s.id, s.psp_name, s.transaction_type, s.amount_ngn, s.currency_raw,
                       s.initiated_at, s.settled_at, s.counterparty_name_tokens,
                       s.beneficiary_bank_code, s.sender_bank_code
                FROM silver_canonical_transactions s
                WHERE s.transaction_type IN ('credit', 'debit')
                  AND s.settlement_status <> 'failed'
                  AND s.initiated_at >= NOW() - CAST(:lookback AS INTERVAL)
                  AND NOT EXISTS (
                      SELECT 1 FROM gold_matched_transactions m WHERE m.transaction_id = s.id
                  )
                ORDER BY s.initiated_at, s.id
            """),
            {"lookback": lookback},
        )
        rows = result.mappings().all()
    return [
        TransactionCandidate(
            id=r["id"],
            psp_name=r["psp_name"],
            transaction_type=r["transaction_type"],
            amount_ngn=Decimal(r["amount_ngn"]),
            currency_raw=r["currency_raw"],
            initiated_at=r["initiated_at"],
            settled_at=r["settled_at"],
            counterparty_name_tokens=list(r["counterparty_name_tokens"] or []),
            beneficiary_bank_code=r["beneficiary_bank_code"],
            sender_bank_code=r["sender_bank_code"],
        )
        for r in rows
    ]


def match_all(candidates: list[TransactionCandidate], config: MatchingConfig) -> list[MatchResult]:
    """
    Greedy one-to-one matching in initiation order. Each transaction appears in
    at most one returned pair; results are keyed by transaction ids, never by
    list position.
    """
    matched: set[Any] = set()
    pairs: list[MatchResult] = []
    for source in candidates:
        if source.id in matched:
            continue
        available = [c for c in candidates if c.id not in matched]
        result = run_matching(source, available, config)
        MATCHING_RESULTS.labels(strategy=result.strategy.value).inc()
        if result.matched_transaction_id is None:
            continue
        matched.update({source.id, result.matched_transaction_id})
        MATCHING_CONFIDENCE_HISTOGRAM.observe(result.confidence_score)
        pairs.append(result)
    return pairs


async def persist_pairs(
    pairs: list[MatchResult],
    by_id: dict[Any, TransactionCandidate],
    run_id: UUID,
) -> tuple[int, int]:
    """
    Write each pair (and its amount discrepancy, if any) in its own savepoint.
    Returns (pairs_written, amount_discrepancies_raised).
    """
    written = 0
    raised = 0
    async with pipeline_session() as session:
        for r in pairs:
            a, b = by_id[r.source_transaction_id], by_id[r.matched_transaction_id]
            try:
                async with session.begin_nested():
                    pair_id: UUID = (
                        await session.execute(
                            text("""
                            INSERT INTO gold_reconciliation_pairs
                                (transaction_a_id, transaction_b_id, match_strategy,
                                 confidence_score, amount_a_ngn, amount_b_ngn, amount_delta_ngn,
                                 is_within_fx_threshold, status, match_evidence, dbt_run_id)
                            VALUES
                                (:a_id, :b_id, CAST(:strategy AS match_strategy_enum), :confidence,
                                 :amount_a, :amount_b, :delta, :fx_flag,
                                 CAST(:status AS pair_status_enum), CAST(:evidence AS JSONB), :run_id)
                            RETURNING id
                        """),
                            {
                                "a_id": a.id,
                                "b_id": b.id,
                                "strategy": r.strategy.value,
                                "confidence": r.confidence_score,
                                "amount_a": a.amount_ngn,
                                "amount_b": b.amount_ngn,
                                "delta": r.amount_delta_ngn or Decimal("0"),
                                "fx_flag": r.is_within_fx_threshold,
                                "status": "matched",
                                "evidence": json.dumps(r.confidence_evidence, default=str),
                                "run_id": run_id,
                            },
                        )
                    ).scalar_one()
                    await session.execute(
                        text("""
                            INSERT INTO gold_matched_transactions (transaction_id, pair_id)
                            VALUES (:a_id, :pair_id), (:b_id, :pair_id)
                        """),
                        {"a_id": a.id, "b_id": b.id, "pair_id": pair_id},
                    )
                    if r.amount_delta_ngn and r.amount_delta_ngn > 0:
                        raised += await _raise_amount_discrepancy(session, pair_id, a, b, run_id)
                written += 1
            except IntegrityError:
                # Another run matched one of these transactions first.
                log.info("matching.pair_conflict", a_id=str(a.id), b_id=str(b.id))
    return written, raised


async def _raise_amount_discrepancy(
    session: Any,
    pair_id: UUID,
    a: TransactionCandidate,
    b: TransactionCandidate,
    run_id: UUID,
) -> int:
    rates = await session.execute(
        text("SELECT id, fx_rate_applied FROM silver_canonical_transactions WHERE id IN (:a, :b)"),
        {"a": a.id, "b": b.id},
    )
    fx = {row.id: row.fx_rate_applied for row in rates}
    result = classify_amount_discrepancy(a.amount_ngn, b.amount_ngn, fx.get(a.id), fx.get(b.id))
    if result.discrepancy_type is None or result.severity is None:
        return 0
    inserted = (
        await session.execute(
            text("""
            INSERT INTO gold_discrepancies
                (reconciliation_pair_id, transaction_id, classification, severity,
                 confidence_score, estimated_exposure_ngn, evidence, dbt_run_id, status)
            VALUES
                (:pair_id, :tx_id, CAST(:dtype AS discrepancy_class_enum), :severity,
                 1.0, :exposure, CAST(:evidence AS JSONB), :run_id, 'open')
            ON CONFLICT (transaction_id, classification) DO NOTHING
            RETURNING id
        """),
            {
                "pair_id": pair_id,
                "tx_id": a.id,
                "dtype": result.discrepancy_type.value,
                "severity": result.severity.value,
                "exposure": result.estimated_exposure_ngn,
                "evidence": json.dumps(result.evidence, default=str),
                "run_id": run_id,
            },
        )
    ).scalar_one_or_none()
    if inserted is None:
        return 0
    await session.execute(
        text("UPDATE gold_reconciliation_pairs SET status = 'discrepancy', updated_at = NOW() WHERE id = :id"),
        {"id": pair_id},
    )
    await session.execute(
        text("""
            INSERT INTO gold_discrepancy_events (discrepancy_id, action, from_status, to_status, actor)
            VALUES (:id, 'raised', NULL, 'open', 'system:matching-flow')
        """),
        {"id": inserted},
    )
    DISCREPANCIES_RAISED.labels(classification=result.discrepancy_type.value).inc()
    return 1


async def raise_missing_settlements(run_id: UUID) -> int:
    """Classify every overdue, unmatched, still-pending transaction. Returns newly raised count."""
    async with pipeline_session() as session:
        rows = (await session.execute(_MISSING_SETTLEMENT_SQL, {"run_id": run_id})).all()
    raised = sum(1 for r in rows if r.action == "raised")
    if raised:
        DISCREPANCIES_RAISED.labels(classification=DiscrepancyType.MISSING_SETTLEMENT.value).inc(raised)
    return raised


async def refresh_summary_view() -> None:
    async with pipeline_session() as session:
        await session.execute(text("SELECT refresh_reconciliation_summary()"))


@flow(name="silver-to-gold-matching-flow", log_prints=True)
async def silver_to_gold_matching_flow() -> dict[str, Any]:
    """Orchestrate the full Silver → Gold matching pipeline."""
    config = MatchingConfig.from_settings()
    # Twice the widest window: a transaction can still be matched by a
    # counterpart arriving up to one window later.
    lookback = config.probabilistic_time_window * 2
    run_id = await start_run("silver-to-gold-matching-flow", triggered_by="scheduler")
    try:
        candidates = await fetch_match_candidates(lookback)
        pairs = match_all(candidates, config)
        by_id = {c.id: c for c in candidates}
        pairs_written, amount_discrepancies = await persist_pairs(pairs, by_id, run_id)
        missing = await raise_missing_settlements(run_id)
        await refresh_summary_view()

        from src.alerting.slack import dispatch_pending_alerts

        alerts_sent = await dispatch_pending_alerts()
    except BaseException as e:
        await finish_run(run_id, error=e)
        raise

    summary = {
        "run_id": str(run_id),
        "candidates": len(candidates),
        "pairs_written": pairs_written,
        "transactions_matched": pairs_written * 2,
        "amount_discrepancies_raised": amount_discrepancies,
        "missing_settlements_raised": missing,
        "alerts_sent": alerts_sent,
        "strategies": {
            s.value: sum(1 for p in pairs if p.strategy == s)
            for s in (MatchStrategy.EXACT_PRIMARY, MatchStrategy.PROBABILISTIC_SECONDARY)
        },
    }
    await finish_run(run_id, processed=len(candidates))
    log.info("matching.completed", **summary)
    return summary
