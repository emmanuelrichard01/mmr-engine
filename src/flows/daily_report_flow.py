# src/flows/daily_report_flow.py
"""
Daily return flow (experimental): builds yesterday's (Lagos calendar day)
summary with src/engine/cbn_report.py and upserts it into
gold_cbn_daily_returns. Re-running for the same date regenerates the draft,
unless it has already been approved or submitted.
"""

import json
from dataclasses import asdict
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from prefect import flow
from sqlalchemy import text

from src.engine.cbn_report import generate_daily_return
from src.storage.pipeline_runs import finish_run, start_run
from src.storage.postgres import pipeline_session

log = structlog.get_logger(__name__)
LAGOS = ZoneInfo("Africa/Lagos")


async def build_and_store_return(report_date: date, run_id: Any) -> dict[str, Any]:
    async with pipeline_session() as session:
        txns = (
            (
                await session.execute(
                    text("""
                SELECT s.psp_transaction_ref AS reference, s.psp_name::text AS psp_name,
                       s.transaction_type::text AS transaction_type, s.amount_ngn,
                       s.currency_raw AS original_currency, s.beneficiary_account_masked,
                       s.initiated_at,
                       CASE WHEN m.transaction_id IS NULL THEN 'unmatched' ELSE 'matched' END AS match_status
                FROM silver_canonical_transactions s
                LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
                WHERE s.transaction_type IN ('credit', 'debit')
                  AND (s.initiated_at AT TIME ZONE 'Africa/Lagos')::date = :d
            """),
                    {"d": report_date},
                )
            )
            .mappings()
            .all()
        )
        discs = (
            (
                await session.execute(
                    text("""
                SELECT status::text AS status, estimated_exposure_ngn AS amount_ngn
                FROM gold_discrepancies
                WHERE (raised_at AT TIME ZONE 'Africa/Lagos')::date = :d
            """),
                    {"d": report_date},
                )
            )
            .mappings()
            .all()
        )

        transactions = [{**dict(t), "timestamp": t["initiated_at"].isoformat()} for t in txns]
        summary = generate_daily_return(report_date, transactions, [dict(d) for d in discs], [])
        credits = [t for t in txns if t["transaction_type"] == "credit"]
        debits = [t for t in txns if t["transaction_type"] == "debit"]

        stored = (
            await session.execute(
                text("""
                INSERT INTO gold_cbn_daily_returns (
                    return_date, generated_by_run_id, total_transaction_count,
                    total_credit_count, total_debit_count,
                    total_credit_volume_ngn, total_debit_volume_ngn,
                    cross_border_count, cross_border_volume_ngn, suspicious_tx_count,
                    unreconciled_count, unreconciled_exposure_ngn, matched_count,
                    match_rate_pct, open_discrepancy_count, report_payload
                ) VALUES (
                    :d, :run_id, :total, :n_credit, :n_debit, :v_credit, :v_debit,
                    :xb_count, :xb_volume, :suspicious, :unreconciled, :exposure, :matched,
                    :match_rate, :open_disc, CAST(:payload AS JSONB)
                )
                ON CONFLICT (return_date) DO UPDATE SET
                    generated_at = NOW(),
                    generated_by_run_id = EXCLUDED.generated_by_run_id,
                    total_transaction_count = EXCLUDED.total_transaction_count,
                    total_credit_count = EXCLUDED.total_credit_count,
                    total_debit_count = EXCLUDED.total_debit_count,
                    total_credit_volume_ngn = EXCLUDED.total_credit_volume_ngn,
                    total_debit_volume_ngn = EXCLUDED.total_debit_volume_ngn,
                    cross_border_count = EXCLUDED.cross_border_count,
                    cross_border_volume_ngn = EXCLUDED.cross_border_volume_ngn,
                    suspicious_tx_count = EXCLUDED.suspicious_tx_count,
                    unreconciled_count = EXCLUDED.unreconciled_count,
                    unreconciled_exposure_ngn = EXCLUDED.unreconciled_exposure_ngn,
                    matched_count = EXCLUDED.matched_count,
                    match_rate_pct = EXCLUDED.match_rate_pct,
                    open_discrepancy_count = EXCLUDED.open_discrepancy_count,
                    report_payload = EXCLUDED.report_payload
                WHERE gold_cbn_daily_returns.submission_status = 'draft'
                RETURNING return_date
            """),
                {
                    "d": report_date,
                    "run_id": run_id,
                    "total": summary.total_transactions,
                    "n_credit": len(credits),
                    "n_debit": len(debits),
                    "v_credit": sum((c["amount_ngn"] for c in credits), start=0),
                    "v_debit": sum((d["amount_ngn"] for d in debits), start=0),
                    "xb_count": summary.cross_border_count,
                    "xb_volume": summary.cross_border_volume_ngn,
                    "suspicious": summary.suspicious_transaction_count,
                    "unreconciled": summary.unmatched_transactions,
                    "exposure": summary.total_exposure_ngn,
                    "matched": summary.matched_transactions,
                    "match_rate": summary.match_rate_pct if summary.total_transactions else None,
                    "open_disc": summary.open_discrepancies,
                    "payload": json.dumps(asdict(summary), default=str),
                },
            )
        ).scalar_one_or_none()

    if stored is None:
        log.info("daily_return.locked", report_date=report_date.isoformat())
    return {
        "report_date": report_date.isoformat(),
        "stored": stored is not None,
        "total_transactions": summary.total_transactions,
    }


@flow(name="daily-return-flow", log_prints=True)
async def daily_return_flow(report_date: date | None = None) -> dict[str, Any]:
    """Generate the experimental daily return for `report_date` (default: yesterday, Lagos)."""
    target = report_date or (datetime.now(LAGOS).date() - timedelta(days=1))
    run_id = await start_run("daily-return-flow", triggered_by="scheduler", metadata={"date": target.isoformat()})
    try:
        result = await build_and_store_return(target, run_id)
    except BaseException as e:
        await finish_run(run_id, error=e)
        raise
    await finish_run(run_id, processed=result["total_transactions"])
    return result
