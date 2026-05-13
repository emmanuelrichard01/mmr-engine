# src/flows/transform_flow.py
"""
Bronze-to-Silver Transform Flow.

Consumes messages from Kafka, writes immutable Bronze Parquet to MinIO,
normalises to the canonical Silver schema, validates with Pandera,
and writes to PostgreSQL.

Pipeline:
    Kafka message → Bronze Parquet (MinIO) → Normalise → Pandera validate → Silver (PG)

Each step is a Prefect task with independent retry logic:
    - Bronze write: retries 3x (MinIO may be briefly unavailable)
    - Silver normalise: retries 2x (DB deadlocks, FX rate capture)

References:
    - TDD §10.2: Bronze to Silver Flow
"""
import asyncio
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import pandas as pd
import pandera
import pyarrow as pa
from prefect import flow, task, get_run_logger
from sqlalchemy import text

from src.config import get_settings
from src.engine.fx import get_fx_rate_at, capture_fx_rates
from src.engine.normaliser import (
    normalise_paystack_event,
    normalise_flutterwave_event,
    PAYSTACK_EVENT_TYPE_MAP,
    FLUTTERWAVE_EVENT_TYPE_MAP,
)
from src.engine.settlement import compute_expected_settlement
from src.contracts.silver.canonical_schema import SILVER_CANONICAL_SCHEMA
from src.storage.minio_client import MinIOClient
from src.storage.postgres import pipeline_session
from src.observability.metrics import SILVER_RECORDS_WRITTEN


@task(
    name="write-bronze-parquet",
    retries=3,
    retry_delay_seconds=[5, 15, 45],
    tags=["bronze", "storage"],
)
async def write_bronze_parquet(
    psp_name: str,
    kafka_message: dict[str, Any],
    run_id: UUID,
) -> tuple[str, UUID]:
    """
    Write raw Kafka message payload to Bronze Parquet on MinIO.
    Returns (file_path, bronze_ingestion_id).
    Registers the file in bronze_ingestion_log.
    """
    logger = get_run_logger()
    now = datetime.now(timezone.utc)
    ingestion_id = str(uuid4())

    # Build PyArrow table from raw payload
    table_data = {
        "_ingestion_id": [ingestion_id],
        "_received_at": [now],
        "_source_type": [kafka_message.get("source_type", "webhook")],
        "_content_hash": [kafka_message["content_hash"]],
        "_kafka_offset": [kafka_message.get("kafka_offset", -1)],
        "event": [kafka_message["event_type"]],
        "data": [json.dumps(kafka_message["payload"])],
    }
    table = pa.table(table_data)

    # Write to MinIO (synchronous client — run in thread)
    client = MinIOClient()
    file_path = await asyncio.to_thread(
        client.write_parquet,
        table=table,
        psp_name=psp_name,
        event_date=now,
        run_id=str(run_id),
    )

    # Register in bronze_ingestion_log
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
                RETURNING id
            """),
            {
                "psp_name": psp_name,
                "source_type": kafka_message.get("source_type", "webhook"),
                "topic": kafka_message.get("kafka_topic", f"raw.{psp_name}.events"),
                "partition": kafka_message.get("kafka_partition", 0),
                "offset": kafka_message.get("kafka_offset", 0),
                "hash": kafka_message["content_hash"],
                "path": file_path,
                "run_id": run_id,
            },
        )
        bronze_ingestion_id = result.scalar_one()

    logger.info(f"Bronze written: {file_path} (ingestion_id={bronze_ingestion_id})")
    return file_path, bronze_ingestion_id


@task(
    name="normalise-to-silver",
    retries=2,
    retry_delay_seconds=[10, 30],
    tags=["silver", "transform"],
)
async def normalise_to_silver(
    psp_name: str,
    payload: dict[str, Any],
    event_type: str,
    bronze_ingestion_id: UUID,
    run_id: UUID,
) -> UUID:
    """
    Transform Bronze payload to canonical Silver schema.
    1. Capture FX rate at event time (if non-NGN)
    2. Compute expected settlement time
    3. Apply PSP-specific normaliser
    4. Validate against Pandera Silver schema
    5. Write to silver_canonical_transactions
    Returns silver_canonical_transactions.id
    """
    logger = get_run_logger()

    async with pipeline_session() as session:
        # Step 1: FX rate capture
        initiated_at = _extract_initiated_at(psp_name, payload)
        currency_raw = payload.get("data", {}).get("currency", "NGN").upper()
        fx_rate_snapshot_id = None
        fx_rate_applied = None

        if currency_raw != "NGN":
            currency_pair = f"NGN/{currency_raw}"
            fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
            if fx_result:
                fx_rate_snapshot_id, fx_rate_applied = fx_result
            else:
                logger.warning(
                    f"No FX rate for {currency_pair} at {initiated_at}. "
                    f"Triggering fresh capture."
                )
                await capture_fx_rates(session)
                fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
                if fx_result:
                    fx_rate_snapshot_id, fx_rate_applied = fx_result

        # Step 2: Expected settlement time
        tx_type = _extract_transaction_type(psp_name, event_type)
        expected_settlement_at = await compute_expected_settlement(
            session=session,
            psp_name=psp_name,
            transaction_type=tx_type,
            initiated_at=initiated_at,
        )

        # Step 3: PSP-specific normalisation
        normaliser_map = {
            "paystack": normalise_paystack_event,
            "flutterwave": normalise_flutterwave_event,
        }
        normaliser = normaliser_map.get(psp_name)
        if not normaliser:
            raise ValueError(f"No normaliser registered for PSP: {psp_name}")

        canonical_record = normaliser(
            payload=payload,
            bronze_ingestion_id=bronze_ingestion_id,
            run_id=run_id,
            fx_rate_snapshot_id=fx_rate_snapshot_id,
            fx_rate_applied=fx_rate_applied,
            expected_settlement_at=expected_settlement_at,
        )

        # Step 4: Pandera schema validation
        validation_cols = {
            k: v for k, v in canonical_record.items()
            if k not in ("id", "processed_by_run_id", "psp_metadata",
                         "bronze_ingestion_id", "psp_event_received_at",
                         "fx_rate_snapshot_id", "fx_rate_applied")
        }
        df = pd.DataFrame([validation_cols])
        try:
            SILVER_CANONICAL_SCHEMA.validate(df)
        except pandera.errors.SchemaError as e:
            logger.error(f"Silver schema validation failed: {e}")
            raise

        # Step 5: Write to Silver
        # Serialize psp_metadata to JSON string for JSONB cast
        record = {**canonical_record}
        record["psp_metadata"] = json.dumps(record["psp_metadata"])

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
                     :narration, :initiated_at, :settled_at, :expected_settlement_at,
                     :settlement_status, :has_pii_masked, :psp_metadata::jsonb,
                     :processed_by_run_id)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            """),
            record,
        )
        silver_id = result.scalar_one_or_none()

        if silver_id is None:
            logger.warning(
                f"Silver write skipped — idempotency key already exists: "
                f"{canonical_record['idempotency_key']}"
            )
            existing = await session.execute(
                text("SELECT id FROM silver_canonical_transactions "
                     "WHERE idempotency_key = :key"),
                {"key": canonical_record["idempotency_key"]},
            )
            silver_id = existing.scalar_one()

        SILVER_RECORDS_WRITTEN.labels(psp_name=psp_name).inc()
        logger.info(f"Silver record written: {silver_id}")
        return silver_id


@flow(
    name="bronze-to-silver-flow",
    log_prints=True,
)
async def bronze_to_silver_flow(kafka_message: dict[str, Any]) -> dict:
    """
    Orchestrates the Bronze → Silver pipeline for a single Kafka message.
    Triggered by the Kafka consumer after message receipt.
    """
    run_id = uuid4()
    psp_name = kafka_message["psp_name"]
    event_type = kafka_message["event_type"]
    payload = kafka_message["payload"]

    # Step 1: Write Bronze Parquet
    file_path, bronze_ingestion_id = await write_bronze_parquet(
        psp_name=psp_name,
        kafka_message=kafka_message,
        run_id=run_id,
    )

    # Step 2: Normalise to Silver
    silver_id = await normalise_to_silver(
        psp_name=psp_name,
        payload=payload,
        event_type=event_type,
        bronze_ingestion_id=bronze_ingestion_id,
        run_id=run_id,
    )

    return {
        "run_id": str(run_id),
        "bronze_ingestion_id": str(bronze_ingestion_id),
        "silver_transaction_id": str(silver_id),
        "psp_name": psp_name,
    }


def _extract_initiated_at(psp_name: str, payload: dict) -> datetime:
    """Extract the event initiation timestamp from the PSP payload."""
    data = payload.get("data", {})
    if psp_name == "paystack":
        ts = data.get("paid_at") or data.get("created_at")
    elif psp_name == "flutterwave":
        ts = data.get("created_at")
    else:
        ts = data.get("timestamp")
    if not ts:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)


def _extract_transaction_type(psp_name: str, event_type: str) -> str:
    """Map PSP event type to canonical transaction type."""
    type_map = {
        "paystack": PAYSTACK_EVENT_TYPE_MAP,
        "flutterwave": FLUTTERWAVE_EVENT_TYPE_MAP,
    }
    return type_map.get(psp_name, {}).get(event_type, "credit")
