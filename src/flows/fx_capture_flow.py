# src/flows/fx_capture_flow.py
"""
Scheduled FX Rate Capture Flow.

Runs every 30 minutes (configurable) to capture current exchange rates
for all supported currency pairs. This ensures the Silver normaliser
always has a recent FX rate available for cross-border transactions.

Rate convention: 1 NGN = {rate} {foreign_currency}

If rate capture fails for a pair, the flow continues with other pairs
and logs a warning. The monitoring stack alerts if the most recent
rate for any pair is older than 2 hours.

References:
    - TDD §9.3: FX Rate Engine
    - TDD §10.3: Scheduled Flows
"""
from datetime import datetime, timezone
from uuid import uuid4

from prefect import flow, task, get_run_logger
from prefect.tasks import task_input_hash

from src.engine.fx import capture_fx_rates
from src.storage.postgres import pipeline_session


@task(
    name="capture-fx-rates",
    retries=3,
    retry_delay_seconds=[30, 60, 120],
    tags=["fx", "external-api"],
)
async def capture_fx_rates_task() -> list[dict]:
    """
    Capture FX rates for all supported pairs.
    Retries with increasing backoff — external API may be rate-limited.
    """
    logger = get_run_logger()

    async with pipeline_session() as session:
        snapshots = await capture_fx_rates(session)

    logger.info(
        f"Captured {len(snapshots)} FX rate snapshots: "
        f"{[s['pair'] for s in snapshots]}"
    )
    return snapshots


@flow(
    name="fx-rate-capture-flow",
    log_prints=True,
)
async def fx_rate_capture_flow() -> dict:
    """
    Scheduled flow to capture FX rates.
    Deploy with:
        prefect deployment build \
            src/flows/fx_capture_flow.py:fx_rate_capture_flow \
            --name "fx-capture-every-30m" \
            --cron "*/30 * * * *" \
            --apply
    """
    run_id = uuid4()
    logger = get_run_logger()
    logger.info(f"FX rate capture flow started: run_id={run_id}")

    snapshots = await capture_fx_rates_task()

    return {
        "run_id": str(run_id),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "snapshots_count": len(snapshots),
        "snapshots": snapshots,
    }
