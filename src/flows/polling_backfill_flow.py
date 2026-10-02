# src/flows/polling_backfill_flow.py
"""
Polling fallback: pull successful transactions from a PSP's REST API and
feed them through the same ingestion path as webhooks.

Used two ways:
    - historical backfill (manual): `polling_backfill_flow("paystack", 30)`
    - gap detection (scheduled):     src/flows/gap_detection_flow.py

Because every event goes through `ingest_event`, whose idempotency key
(psp:reference:event_type) is identical for a webhook and a polled copy of
the same transaction, re-ingesting what we already have is a cheap no-op.
A "gap" is precisely a polled transaction whose key was new.

Only successful transactions are requested (status filter on the PSP API),
so polled records are safe to present as charge.success / charge.completed.

References:
    - TDD §10.2: Polling Fallback Flow
"""

import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from prefect import flow

from src.connectors.flutterwave_polling import FlutterwaveAPIClient
from src.connectors.paystack_polling import PaystackAPIClient
from src.flows.ingestion_flow import ingest_event
from src.observability.metrics import BACKFILL_RECORDS_COUNTER

log = structlog.get_logger(__name__)

# PSP → event type a webhook for a successful charge would carry
_POLLING = {
    "paystack": "charge.success",
    "flutterwave": "charge.completed",
}


async def fetch_successful_transactions(psp_name: str, since: datetime, until: datetime) -> list[dict[str, Any]]:
    """All successful transactions in [since, until] (each client handles its own pagination)."""
    if psp_name == "paystack":
        return await PaystackAPIClient().list_all_successful(since, until)
    if psp_name == "flutterwave":
        return await FlutterwaveAPIClient().list_all_successful(since, until)
    raise ValueError(f"Unsupported PSP for polling: {psp_name}")


async def ingest_polled(psp_name: str, transactions: list[dict[str, Any]]) -> dict[str, int]:
    """Ingest polled transactions as their webhook-equivalent events."""
    event_type = _POLLING[psp_name]
    stats = {"new": 0, "duplicates": 0, "errors": 0}
    for tx in transactions:
        payload = {"event": event_type, "data": tx}
        raw = json.dumps(payload, sort_keys=True, default=str).encode()
        try:
            result = await ingest_event(
                psp_name=psp_name,
                event_type=event_type,
                raw_payload=payload,
                content_hash=hashlib.sha256(raw).hexdigest(),
                received_at=datetime.now(UTC).isoformat(),
            )
        except Exception as e:
            stats["errors"] += 1
            log.error("polling.ingest_failed", psp_name=psp_name, error_type=type(e).__name__)
            continue
        stats["new" if result["is_new"] else "duplicates"] += 1
    BACKFILL_RECORDS_COUNTER.labels(psp_name=psp_name, outcome="new").inc(stats["new"])
    BACKFILL_RECORDS_COUNTER.labels(psp_name=psp_name, outcome="duplicate").inc(stats["duplicates"])
    BACKFILL_RECORDS_COUNTER.labels(psp_name=psp_name, outcome="error").inc(stats["errors"])
    return stats


@flow(name="polling-backfill-flow", log_prints=True)
async def polling_backfill_flow(psp_name: str, days_back: int = 30) -> dict[str, Any]:
    """Import `days_back` days of successful transactions from a PSP."""
    if psp_name not in _POLLING:
        raise ValueError(f"Unsupported PSP for polling: {psp_name}")
    until = datetime.now(UTC)
    transactions = await fetch_successful_transactions(psp_name, until - timedelta(days=days_back), until)
    stats = await ingest_polled(psp_name, transactions)
    return {"psp": psp_name, "days_back": days_back, "fetched": len(transactions), **stats}
