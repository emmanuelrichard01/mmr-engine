# src/flows/scheduler.py
"""
Scheduler process: runs the periodic flows in-process.

    matching           every MATCHING_SCHEDULE_MINUTES (default 5)
    fx capture         every FX_CAPTURE_INTERVAL_MINUTES (default 30)
    gap detection      every GAP_DETECTION_INTERVAL_HOURS (default 6), per PSP
    daily return       02:00 Africa/Lagos (experimental report)

Each job is a Prefect flow, so every execution is visible as a flow run in
the Prefect UI. Jobs run in this process (rather than via `prefect serve`
subprocesses) so their Prometheus counters are exported on :9102.

A job never overlaps itself; a failed run is logged and retried at the next
tick. The process exits non-zero only on startup errors.
"""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import structlog
from prometheus_client import start_http_server

from src.config import get_settings
from src.observability.logging import configure_logging

log = structlog.get_logger(__name__)
LAGOS = ZoneInfo("Africa/Lagos")
METRICS_PORT = 9102

Job = Callable[[], Awaitable[Any]]


async def _run_safely(name: str, job: Job) -> None:
    started = datetime.now(LAGOS)
    try:
        result = await job()
        log.info(
            "scheduler.job_completed",
            job=name,
            seconds=round((datetime.now(LAGOS) - started).total_seconds(), 2),
            result=result if isinstance(result, dict) else None,
        )
    except Exception as e:
        log.error("scheduler.job_failed", job=name, error_type=type(e).__name__, error=str(e))


async def every(interval: timedelta, name: str, job: Job, *, run_at_start: bool = True) -> None:
    if not run_at_start:
        await asyncio.sleep(interval.total_seconds())
    while True:
        await _run_safely(name, job)
        await asyncio.sleep(interval.total_seconds())


def seconds_until(at: time, now: datetime) -> float:
    """Seconds from `now` until the next occurrence of wall-clock `at` (Lagos)."""
    target = now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


async def daily_at(at: time, name: str, job: Job) -> None:
    while True:
        await asyncio.sleep(seconds_until(at, datetime.now(LAGOS)))
        await _run_safely(name, job)


async def _fx_capture() -> Any:
    from src.flows.fx_capture_flow import fx_rate_capture_flow

    return await fx_rate_capture_flow()


async def _matching() -> Any:
    from src.flows.matching_flow import silver_to_gold_matching_flow

    return await silver_to_gold_matching_flow()


def _gap_detection(psp: str) -> Job:
    async def run() -> Any:
        from src.flows.gap_detection_flow import gap_detection_flow

        return await gap_detection_flow(psp_name=psp)

    return run


async def _daily_return() -> Any:
    from src.flows.daily_report_flow import daily_return_flow

    return await daily_return_flow()


async def main() -> None:
    settings = get_settings()
    configure_logging(level=settings.log_level)
    start_http_server(METRICS_PORT)
    log.info("scheduler.started", metrics_port=METRICS_PORT)

    jobs = [
        every(timedelta(minutes=settings.matching_schedule_minutes), "matching", _matching),
        daily_at(time(2, 0), "daily_return", _daily_return),
    ]
    if settings.fx_provider_api_key is not None:
        jobs.append(every(timedelta(minutes=settings.fx_capture_interval_minutes), "fx_capture", _fx_capture))
    else:
        log.warning("scheduler.fx_capture_disabled", reason="FX_PROVIDER_API_KEY not configured")
    gap_interval = timedelta(hours=settings.gap_detection_interval_hours)
    for psp in ("paystack", "flutterwave"):
        jobs.append(every(gap_interval, f"gap_detection:{psp}", _gap_detection(psp), run_at_start=False))

    await asyncio.gather(*jobs)


if __name__ == "__main__":
    asyncio.run(main())
