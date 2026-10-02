# src/storage/pipeline_runs.py
"""
Bookkeeping for system_pipeline_runs.

Every Bronze, Silver and Gold row references the run that produced it, so a
run row must exist (committed) before any data is written under its id.
"""

import json
import traceback
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import text

from src.storage.postgres import pipeline_session


async def start_run(flow_name: str, triggered_by: str, metadata: dict[str, Any] | None = None) -> UUID:
    """Insert a 'running' row and return its id."""
    run_id = uuid4()
    async with pipeline_session() as session:
        await session.execute(
            text("""
                INSERT INTO system_pipeline_runs (id, flow_name, status, triggered_by, metadata)
                VALUES (:id, :flow_name, 'running', :triggered_by, CAST(:metadata AS JSONB))
            """),
            {
                "id": run_id,
                "flow_name": flow_name,
                "triggered_by": triggered_by,
                "metadata": json.dumps(metadata or {}),
            },
        )
    return run_id


async def finish_run(
    run_id: UUID,
    *,
    processed: int = 0,
    failed: int = 0,
    error: BaseException | None = None,
) -> None:
    """Mark a run completed, or failed when `error` is given."""
    async with pipeline_session() as session:
        await session.execute(
            text("""
                UPDATE system_pipeline_runs
                SET status = CAST(:status AS pipeline_status_enum),
                    completed_at = NOW(),
                    records_processed = :processed,
                    records_failed = :failed,
                    error_message = :err,
                    error_traceback = :tb
                WHERE id = :id
            """),
            {
                "id": run_id,
                "status": "failed" if error is not None else "completed",
                "processed": processed,
                "failed": failed,
                "err": f"{type(error).__name__}: {error}" if error is not None else None,
                "tb": "".join(traceback.format_exception(error)) if error is not None else None,
            },
        )


async def record_progress(run_id: UUID, *, processed: int, failed: int) -> None:
    """Update counters on a long-running run (e.g. the consumer worker)."""
    async with pipeline_session() as session:
        await session.execute(
            text("""
                UPDATE system_pipeline_runs
                SET records_processed = :processed, records_failed = :failed
                WHERE id = :id
            """),
            {"id": run_id, "processed": processed, "failed": failed},
        )
