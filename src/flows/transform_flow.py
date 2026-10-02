# src/flows/transform_flow.py
"""
Bronze-to-Silver transform, executed by the consumer worker for each message.

    Kafka message → Bronze Parquet (MinIO, always) → classify →
    normalise → Pandera validate → Silver (Postgres)

Every message is written to Bronze, including events the engine does not
model, so the raw record is always available for audit and replay. Only
events that `classify_event` accepts become Silver rows.

This is a plain coroutine rather than a Prefect flow per message: creating a
flow run per event added a hard dependency on the Prefect API and seconds of
overhead per message, for no orchestration benefit. Retries and dead-lettering
are owned by the consumer worker, which knows the Kafka offsets.

References:
    - TDD §10.2: Bronze to Silver Flow
"""

import asyncio
import json
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

import pandas as pd
import pyarrow as pa
import structlog
from sqlalchemy import text

from src.contracts.silver.canonical_schema import SILVER_CANONICAL_SCHEMA
from src.engine.fx import capture_fx_rates, get_fx_rate_at
from src.engine.normaliser import (
    NORMALISERS,
    PermanentEventError,
    classify_event,
    parse_timestamp,
)
from src.engine.settlement import compute_expected_settlement
from src.observability.metrics import BRONZE_RECORDS_WRITTEN, EVENTS_SKIPPED, SILVER_RECORDS_WRITTEN
from src.storage.minio_client import MinIOClient
from src.storage.postgres import pipeline_session

log = structlog.get_logger(__name__)

# Columns validated by Pandera (identifiers, lineage and JSON blobs excluded).
_UNVALIDATED_COLUMNS = frozenset(
    {
        "id",
        "processed_by_run_id",
        "psp_metadata",
        "bronze_ingestion_id",
        "psp_event_received_at",
        "fx_rate_applied",
        "counterparty_name_tokens",
    }
)


async def write_bronze_parquet(
    psp_name: str,
    kafka_message: dict[str, Any],
    run_id: UUID,
) -> tuple[str, UUID]:
    """
    Write the raw message payload to Bronze Parquet on MinIO and register it
    in bronze_ingestion_log. Returns (file_path, bronze_ingestion_id).

    Replays of the same Kafka offset reuse the existing log row; the object
    key is derived from the offset so a replay overwrites rather than orphans.
    """
    now = datetime.now(UTC)
    topic = kafka_message.get("kafka_topic", f"raw.{psp_name}.events")
    partition = int(kafka_message.get("kafka_partition", 0))
    offset = int(kafka_message.get("kafka_offset", -1))

    table = pa.table(
        {
            "_ingestion_id": [str(uuid4())],
            "_received_at": [now],
            "_source_type": [kafka_message.get("source_type", "webhook")],
            "_content_hash": [kafka_message["content_hash"]],
            "_kafka_offset": [offset],
            "event": [kafka_message["event_type"]],
            "data": [json.dumps(kafka_message["payload"])],
        }
    )

    client = MinIOClient()
    file_path = await asyncio.to_thread(
        client.write_parquet,
        table=table,
        psp_name=psp_name,
        event_date=now,
        run_id=f"{topic}-p{partition}-o{offset}",
    )

    async with pipeline_session() as session:
        result = await session.execute(
            text("""
                INSERT INTO bronze_ingestion_log
                    (psp_name, source_type, kafka_topic, kafka_partition,
                     kafka_offset, content_hash, file_path, event_count,
                     ingestion_run_id, status)
                VALUES
                    (:psp_name, :source_type, :topic, :partition,
                     :offset, :hash, :path, 1, :run_id, 'written')
                ON CONFLICT (kafka_topic, kafka_partition, kafka_offset) DO NOTHING
                RETURNING id, file_path
            """),
            {
                "psp_name": psp_name,
                "source_type": kafka_message.get("source_type", "webhook"),
                "topic": topic,
                "partition": partition,
                "offset": offset,
                "hash": kafka_message["content_hash"],
                "path": file_path,
                "run_id": run_id,
            },
        )
        row = result.one_or_none()
        if row is None:
            # Redelivery of an offset already logged (the log is append-only).
            existing = await session.execute(
                text("""
                    SELECT id, file_path FROM bronze_ingestion_log
                    WHERE kafka_topic = :topic AND kafka_partition = :partition AND kafka_offset = :offset
                """),
                {"topic": topic, "partition": partition, "offset": offset},
            )
            row = existing.one()
        bronze_ingestion_id: UUID = row[0]
        actual_file_path: str = row[1]

    BRONZE_RECORDS_WRITTEN.labels(psp_name=psp_name).inc()
    return actual_file_path, bronze_ingestion_id


async def _resolve_fx_rate(session: Any, currency_raw: str, initiated_at: datetime) -> tuple[UUID | None, Any]:
    if currency_raw == "NGN":
        return None, None
    currency_pair = f"NGN/{currency_raw}"
    fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
    if fx_result is None:
        log.warning("transform.fx_rate_missing", pair=currency_pair, at=initiated_at.isoformat())
        await capture_fx_rates(session)
        fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
    if fx_result is None:
        raise PermanentEventError(f"no FX rate for {currency_pair} at or shortly after {initiated_at.isoformat()}")
    return fx_result


async def normalise_to_silver(
    psp_name: str,
    payload: dict[str, Any],
    event_type: str,
    bronze_ingestion_id: UUID,
    run_id: UUID,
) -> tuple[UUID, bool]:
    """
    Normalise, validate and write one event to silver_canonical_transactions.
    Returns (silver_id, is_new). Duplicate deliveries return the existing id.
    """
    normaliser = NORMALISERS[psp_name]
    data = payload.get("data") or {}

    async with pipeline_session() as session:
        initiated_at = parse_timestamp(data.get("paid_at") or data.get("created_at") or data.get("createdAt"))
        currency_raw = str(data.get("currency") or "NGN").upper()
        fx_rate_snapshot_id, fx_rate_applied = await _resolve_fx_rate(session, currency_raw, initiated_at)

        disposition = classify_event(psp_name, event_type, payload)
        expected_settlement_at = await compute_expected_settlement(
            session=session,
            psp_name=psp_name,
            transaction_type=disposition.transaction_type or "credit",
            initiated_at=initiated_at,
        )

        record = normaliser(
            payload=payload,
            bronze_ingestion_id=bronze_ingestion_id,
            run_id=run_id,
            fx_rate_snapshot_id=fx_rate_snapshot_id,
            fx_rate_applied=fx_rate_applied,
            expected_settlement_at=expected_settlement_at,
        )

        SILVER_CANONICAL_SCHEMA.validate(
            pd.DataFrame([{k: v for k, v in record.items() if k not in _UNVALIDATED_COLUMNS}])
        )

        params = {**record, "psp_metadata": json.dumps(record["psp_metadata"])}
        result = await session.execute(
            text("""
                INSERT INTO silver_canonical_transactions
                    (id, idempotency_key, bronze_ingestion_id, psp_name,
                     psp_transaction_ref, psp_event_type, psp_event_received_at,
                     transaction_type, amount_raw, currency_raw, amount_ngn,
                     fx_rate_snapshot_id, fx_rate_applied,
                     sender_account_masked, sender_bank_code, sender_bank_name,
                     beneficiary_account_masked, beneficiary_bank_code,
                     beneficiary_bank_name, beneficiary_name_masked,
                     counterparty_name_tokens,
                     narration, initiated_at, settled_at, expected_settlement_at,
                     settlement_status, has_pii_masked, psp_metadata,
                     processed_by_run_id)
                VALUES
                    (:id, :idempotency_key, :bronze_ingestion_id, :psp_name,
                     :psp_transaction_ref, :psp_event_type, :psp_event_received_at,
                     :transaction_type, :amount_raw, :currency_raw, :amount_ngn,
                     :fx_rate_snapshot_id, :fx_rate_applied,
                     :sender_account_masked, :sender_bank_code, :sender_bank_name,
                     :beneficiary_account_masked, :beneficiary_bank_code,
                     :beneficiary_bank_name, :beneficiary_name_masked,
                     :counterparty_name_tokens,
                     :narration, :initiated_at, :settled_at, :expected_settlement_at,
                     :settlement_status, :has_pii_masked, CAST(:psp_metadata AS JSONB),
                     :processed_by_run_id)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            """),
            params,
        )
        silver_id = result.scalar_one_or_none()
        if silver_id is not None:
            SILVER_RECORDS_WRITTEN.labels(psp_name=psp_name).inc()
            return silver_id, True

        existing = await session.execute(
            text("SELECT id FROM silver_canonical_transactions WHERE idempotency_key = :key"),
            {"key": record["idempotency_key"]},
        )
        return existing.scalar_one(), False


_REQUIRED_MESSAGE_FIELDS = ("psp_name", "event_type", "payload", "content_hash")


async def process_kafka_message(kafka_message: dict[str, Any], run_id: UUID) -> dict[str, Any]:
    """
    Bronze → Silver for one Kafka message. `run_id` is the consumer's
    system_pipeline_runs row, which every Bronze/Silver row references.

    Raises PermanentEventError (or pandera SchemaError) for events that can
    never succeed; any other exception is treated as transient by the caller.
    """
    missing = [f for f in _REQUIRED_MESSAGE_FIELDS if f not in kafka_message]
    if missing:
        raise PermanentEventError(f"kafka message missing fields {missing}")
    psp_name = str(kafka_message["psp_name"])
    event_type = str(kafka_message["event_type"])
    payload = kafka_message["payload"]
    if not isinstance(payload, dict):
        raise PermanentEventError("kafka message payload is not an object")

    _, bronze_ingestion_id = await write_bronze_parquet(psp_name, kafka_message, run_id)

    disposition = classify_event(psp_name, event_type, payload)
    if not disposition.process:
        EVENTS_SKIPPED.labels(psp_name=psp_name).inc()
        log.info("transform.skipped", psp_name=psp_name, event_type=event_type, reason=disposition.reason)
        return {"outcome": "skipped", "reason": disposition.reason, "bronze_ingestion_id": str(bronze_ingestion_id)}

    silver_id, is_new = await normalise_to_silver(
        psp_name=psp_name,
        payload=payload,
        event_type=event_type,
        bronze_ingestion_id=bronze_ingestion_id,
        run_id=run_id,
    )
    return {
        "outcome": "written" if is_new else "duplicate",
        "bronze_ingestion_id": str(bronze_ingestion_id),
        "silver_transaction_id": str(silver_id),
        "psp_name": psp_name,
    }
