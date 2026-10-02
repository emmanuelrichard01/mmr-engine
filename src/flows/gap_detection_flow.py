# src/flows/gap_detection_flow.py
"""
Gap detection: catch webhooks the PSP sent but we never received.

Every GAP_DETECTION_INTERVAL_HOURS the scheduler polls the PSP for successful
transactions in a window slightly wider than the interval and ingests them.
Anything whose idempotency key was not yet registered is a gap: a missed
webhook, now recovered through the normal pipeline. Gap counts go to the
logs and the reconciliation_backfill_records_total{outcome="new"} metric.

References:
    - TDD §10.2: Polling Fallback Flow
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from prefect import flow

from src.flows.polling_backfill_flow import fetch_successful_transactions, ingest_polled

log = structlog.get_logger(__name__)

# Overlap between consecutive windows so nothing at a boundary is missed.
WINDOW_OVERLAP = timedelta(hours=1)
GAP_RATE_WARNING_PCT = 1.0


@flow(name="gap-detection-flow", log_prints=True)
async def gap_detection_flow(psp_name: str = "paystack", hours_back: int = 6) -> dict[str, Any]:
    until = datetime.now(UTC)
    since = until - timedelta(hours=hours_back) - WINDOW_OVERLAP
    transactions = await fetch_successful_transactions(psp_name, since, until)
    stats = await ingest_polled(psp_name, transactions)

    gap_rate = round(stats["new"] / len(transactions) * 100, 2) if transactions else 0.0
    result = {
        "psp": psp_name,
        "window_hours": hours_back,
        "polled": len(transactions),
        "gaps_recovered": stats["new"],
        "gap_rate_pct": gap_rate,
        "errors": stats["errors"],
    }
    if gap_rate > GAP_RATE_WARNING_PCT:
        log.warning("gap_detection.high_gap_rate", **result)
    else:
        log.info("gap_detection.completed", **result)
    return result
