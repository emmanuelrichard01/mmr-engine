# src/flows/polling_backfill_flow.py
"""
Polling Backfill Flow — Historical Transaction Import.

This is the onboarding pipeline. When a new client connects their PSP
credentials, this flow fetches their historical transaction data and
processes it through the standard Bronze → Silver pipeline.

Real-world onboarding sequence:
    1. Client provides PSP API key (sk_live_* or sk_test_*)
    2. This flow fetches 30 days (configurable) of historical data
    3. Each transaction enters the standard idempotency → Bronze → Silver path
    4. Webhooks are activated simultaneously for real-time going forward
    5. Gap detection flow (scheduled) catches anything missed during transition

References:
    - TDD §10.2: Polling Fallback Flow
    - GTM Strategy: Data Acquisition Path
"""
import json
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from prefect import flow, task, get_run_logger

from src.connectors.paystack_polling import PaystackAPIClient
from src.connectors.flutterwave_polling import FlutterwaveAPIClient
from src.flows.ingestion_flow import webhook_ingestion_flow
from src.observability.metrics import WEBHOOK_RECEIVED_COUNTER

import hashlib


@task(name="fetch-historical-transactions", tags=["backfill", "polling"])
async def fetch_historical_transactions(
    psp_name: str,
    days_back: int = 30,
    status: str = "success",
) -> list[dict[str, Any]]:
    """
    Fetch historical transactions from a PSP's REST API.

    Paginates automatically until all transactions in the date range
    are retrieved. Returns raw PSP payloads.
    """
    logger = get_run_logger()
    to_date = datetime.now(timezone.utc)
    from_date = to_date - timedelta(days=days_back)

    from_iso = from_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    to_iso = to_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    all_transactions: list[dict] = []

    if psp_name == "paystack":
        client = PaystackAPIClient()
        page = 1
        while True:
            batch = await client.list_transactions(
                from_date=from_iso, to_date=to_iso,
                status=status, per_page=100, page=page,
            )
            if not batch:
                break
            all_transactions.extend(batch)
            if len(batch) < 100:
                break
            page += 1

    elif psp_name == "flutterwave":
        client = FlutterwaveAPIClient()
        page = 1
        while True:
            batch = await client.list_transactions(
                from_date=from_iso, to_date=to_iso,
                status=status, per_page=100, page=page,
            )
            if not batch:
                break
            all_transactions.extend(batch)
            if len(batch) < 100:
                break
            page += 1
    else:
        logger.warning(f"Unsupported PSP for polling backfill: {psp_name}")
        return []

    logger.info(
        f"Fetched {len(all_transactions)} historical transactions "
        f"from {psp_name} ({from_iso} → {to_iso})"
    )
    return all_transactions


@task(name="process-backfill-batch", tags=["backfill"])
async def process_backfill_batch(
    psp_name: str,
    transactions: list[dict[str, Any]],
) -> dict[str, int]:
    """
    Process a batch of historical transactions through the ingestion pipeline.

    Each transaction is wrapped into the webhook event format and processed
    through the standard idempotency → Kafka → Bronze → Silver path.
    Duplicates are automatically skipped by the idempotency registry.
    """
    logger = get_run_logger()
    stats = {"processed": 0, "duplicates": 0, "errors": 0}

    for tx in transactions:
        try:
            # Build a synthetic webhook payload matching PSP format
            if psp_name == "paystack":
                event_type = "charge.success"
                payload = {"event": event_type, "data": tx}
            elif psp_name == "flutterwave":
                event_type = "charge.completed"
                payload = {"event": event_type, "data": tx}
            else:
                continue

            raw_body = json.dumps(payload).encode()
            content_hash = hashlib.sha256(raw_body).hexdigest()
            received_at = datetime.now(timezone.utc).isoformat()

            result = await webhook_ingestion_flow(
                psp_name=psp_name,
                event_type=event_type,
                raw_payload=payload,
                content_hash=content_hash,
                received_at=received_at,
            )

            if result.get("is_new"):
                stats["processed"] += 1
            else:
                stats["duplicates"] += 1

        except Exception as e:
            logger.error(f"Backfill error for transaction: {e}")
            stats["errors"] += 1

    logger.info(
        f"Backfill batch complete: {stats['processed']} new, "
        f"{stats['duplicates']} duplicates, {stats['errors']} errors"
    )
    return stats


@flow(name="polling-backfill-flow", log_prints=True)
async def polling_backfill_flow(
    psp_name: str,
    days_back: int = 30,
) -> dict:
    """
    Onboarding flow: fetch and process historical PSP transactions.

    Usage:
        # Backfill 30 days of Paystack transactions
        await polling_backfill_flow("paystack", days_back=30)

        # Backfill 7 days of Flutterwave transactions
        await polling_backfill_flow("flutterwave", days_back=7)
    """
    run_id = str(uuid4())
    logger = get_run_logger()
    logger.info(f"Starting backfill: {psp_name}, {days_back} days, run={run_id}")

    transactions = await fetch_historical_transactions(psp_name, days_back)

    if not transactions:
        return {"run_id": run_id, "psp": psp_name, "total": 0}

    # Process in batches of 50 to avoid overwhelming the pipeline
    batch_size = 50
    total_stats = {"processed": 0, "duplicates": 0, "errors": 0}

    for i in range(0, len(transactions), batch_size):
        batch = transactions[i:i + batch_size]
        stats = await process_backfill_batch(psp_name, batch)
        for key in total_stats:
            total_stats[key] += stats[key]

    logger.info(f"Backfill complete: {total_stats}")
    return {
        "run_id": run_id,
        "psp": psp_name,
        "days_back": days_back,
        "total_fetched": len(transactions),
        **total_stats,
    }
