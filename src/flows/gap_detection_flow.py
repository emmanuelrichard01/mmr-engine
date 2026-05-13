# src/flows/gap_detection_flow.py
"""
Gap Detection Flow — Webhook Completeness Verification.

Scheduled flow that runs every 6 hours to verify that no webhook
events were lost. Compares our received transactions against what
the PSP API reports, and auto-backfills any gaps.

This is the safety net that ensures data completeness regardless
of webhook reliability. It answers: "Did we receive everything
the PSP says it sent?"

Detection logic:
    1. Query Silver for all psp_transaction_ref values in the window
    2. Query PSP API for all transactions in the same window
    3. Diff: PSP has it, we don't = gap
    4. Auto-ingest any gaps through the standard pipeline
    5. Alert if gap rate exceeds threshold (>1% = something is wrong)

References:
    - TDD §10.2: Polling Fallback Flow
    - QA C-001: No transaction must be processed more than once
    - GTM Strategy: Data Completeness Guarantee
"""
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from prefect import flow, task, get_run_logger
from prefect.tasks import task_input_hash
from sqlalchemy import text

from src.connectors.paystack_polling import PaystackAPIClient
from src.connectors.flutterwave_polling import FlutterwaveAPIClient
from src.flows.polling_backfill_flow import process_backfill_batch
from src.storage.postgres import pipeline_session


@task(
    name="fetch-known-references",
    tags=["gap-detection"],
    cache_key_fn=task_input_hash,
    cache_expiration=timedelta(minutes=30),
)
async def fetch_known_references(
    psp_name: str,
    from_date: datetime,
    to_date: datetime,
) -> set[str]:
    """
    Get all psp_transaction_ref values we already have in Silver
    for the given PSP and time window.
    """
    logger = get_run_logger()
    async with pipeline_session() as session:
        result = await session.execute(
            text("""
                SELECT psp_transaction_ref
                FROM silver_canonical_transactions
                WHERE psp_name = :psp
                  AND initiated_at >= :from_date
                  AND initiated_at <= :to_date
            """),
            {"psp": psp_name, "from_date": from_date, "to_date": to_date},
        )
        refs = {row[0] for row in result.fetchall()}

    logger.info(f"Found {len(refs)} known references for {psp_name}")
    return refs


@task(name="detect-gaps", tags=["gap-detection"])
async def detect_gaps(
    psp_name: str,
    known_refs: set[str],
    hours_back: int = 6,
) -> list[dict[str, Any]]:
    """
    Compare our known transactions against what the PSP API reports.
    Returns transactions present in PSP but missing from our system.
    """
    logger = get_run_logger()
    to_date = datetime.now(timezone.utc)
    from_date = to_date - timedelta(hours=hours_back)

    from_iso = from_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    to_iso = to_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    if psp_name == "paystack":
        client = PaystackAPIClient()
        missing = await client.fetch_missing_transactions(
            known_references=known_refs,
            from_date=from_iso,
            to_date=to_iso,
        )
    elif psp_name == "flutterwave":
        client = FlutterwaveAPIClient()
        missing = await client.fetch_missing_transactions(
            known_references=known_refs,
            from_date=from_iso,
            to_date=to_iso,
        )
    else:
        logger.warning(f"Gap detection not supported for PSP: {psp_name}")
        return []

    if missing:
        gap_rate = len(missing) / max(len(known_refs), 1) * 100
        logger.warning(
            f"Gap detected: {len(missing)} missing transactions for {psp_name} "
            f"(gap rate: {gap_rate:.2f}%)"
        )
    else:
        logger.info(f"No gaps detected for {psp_name}")

    return missing


@flow(name="gap-detection-flow", log_prints=True)
async def gap_detection_flow(
    psp_name: str = "paystack",
    hours_back: int = 6,
    auto_backfill: bool = True,
) -> dict:
    """
    Scheduled gap detection and auto-backfill.

    Runs every 6 hours per PSP. Compares webhook-received
    transactions against PSP API records. Auto-fills gaps.

    Schedule (via Prefect deployments):
        - gap-detection-paystack:  every 6h
        - gap-detection-flutterwave: every 6h
    """
    run_id = str(uuid4())
    logger = get_run_logger()
    logger.info(f"Gap detection starting: {psp_name}, {hours_back}h window")

    to_date = datetime.now(timezone.utc)
    from_date = to_date - timedelta(hours=hours_back)

    # Step 1: Get what we already have
    known_refs = await fetch_known_references(psp_name, from_date, to_date)

    # Step 2: Find gaps
    missing = await detect_gaps(psp_name, known_refs, hours_back)

    result = {
        "run_id": run_id,
        "psp": psp_name,
        "window_hours": hours_back,
        "known_count": len(known_refs),
        "gaps_found": len(missing),
        "gap_rate_pct": round(len(missing) / max(len(known_refs), 1) * 100, 2),
        "auto_backfilled": 0,
    }

    # Step 3: Auto-backfill if enabled
    if missing and auto_backfill:
        stats = await process_backfill_batch(psp_name, missing)
        result["auto_backfilled"] = stats["processed"]
        logger.info(f"Auto-backfilled {stats['processed']} gap transactions")

    # Step 4: Alert if gap rate is concerning (>1%)
    if result["gap_rate_pct"] > 1.0:
        logger.error(
            f"HIGH GAP RATE for {psp_name}: {result['gap_rate_pct']}% — "
            f"investigate webhook delivery health"
        )

    return result
