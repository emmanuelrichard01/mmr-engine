# src/flows/ingestion_flow.py
"""
Webhook Ingestion — FastAPI → Kafka → Bronze.

This is the entry point for all PSP events (webhooks and polling backfill). It:
    1. Builds the idempotency key from the validated payload
    2. Registers the key (atomic INSERT ... ON CONFLICT) inside a transaction
    3. Publishes to the PSP-specific Kafka topic and waits for the broker ack
    4. Commits the transaction only after the broker has acknowledged

Delivery guarantee: effectively-once, built from at-least-once delivery plus
deduplication. If the publish fails, the transaction rolls back and the key
is NOT registered, so the PSP's retry is processed normally. If the process
dies between the broker ack and the commit, the PSP retries and the event is
published twice. The Silver layer's UNIQUE idempotency_key then drops the
duplicate. Registering the key *before* a successful publish (the original
design) turned every publish failure into a permanently lost event.

`ingest_event` is a plain coroutine so the webhook request path does not depend
on the Prefect API being reachable. `webhook_ingestion_flow` wraps it for
orchestrated callers (polling backfill, gap detection).

References:
    - TDD §10.1: Webhook Ingestion Flow
    - API Specification §3.1: Webhook Endpoints
"""

import asyncio
from typing import Any

import structlog
from prefect import flow

from src.config import get_settings
from src.engine.idempotency import (
    build_idempotency_key,
    check_and_register_idempotency_key,
)
from src.observability.metrics import (
    DUPLICATE_EVENTS_COUNTER,
    WEBHOOK_RECEIVED_COUNTER,
)
from src.storage.kafka_producer import get_producer
from src.storage.postgres import pipeline_session

log = structlog.get_logger(__name__)


def extract_transaction_ref(psp_name: str, raw_payload: dict[str, Any], content_hash: str) -> str:
    """
    The PSP's own reference for the transaction an event is about.
    Falls back to the content hash for events without a reference, so that
    byte-identical redeliveries still deduplicate.
    """
    data = raw_payload.get("data") or {}
    ref: Any = None
    if psp_name == "paystack":
        ref = data.get("reference")
    elif psp_name == "flutterwave":
        ref = data.get("tx_ref") or data.get("reference")
    return str(ref) if ref else f"sha256-{content_hash[:32]}"


async def ingest_event(
    psp_name: str,
    event_type: str,
    raw_payload: dict[str, Any],
    content_hash: str,
    received_at: str,
) -> dict[str, Any]:
    """
    Durably hand one PSP event to the pipeline.

    Returns: {is_new, idempotency_key, kafka_topic}
    Raises:  KafkaDeliveryError / database errors. The caller must surface these
             as a failure (HTTP 5xx) so the PSP retries.
    """
    settings = get_settings()
    psp_tx_ref = extract_transaction_ref(psp_name, raw_payload, content_hash)
    idempotency_key = build_idempotency_key(psp_name, psp_tx_ref, event_type)

    topic_map = {
        "paystack": settings.kafka_topic_paystack,
        "flutterwave": settings.kafka_topic_flutterwave,
    }
    topic = topic_map.get(psp_name, settings.kafka_topic_polling)

    async with pipeline_session() as session:
        is_new, occurrence_count = await check_and_register_idempotency_key(session, idempotency_key)
        if not is_new:
            DUPLICATE_EVENTS_COUNTER.labels(psp_name=psp_name).inc()
            log.info(
                "ingestion.duplicate_skipped",
                idempotency_key=idempotency_key,
                occurrence=occurrence_count,
            )
            return {"is_new": False, "idempotency_key": idempotency_key, "kafka_topic": None}

        kafka_message = {
            "psp_name": psp_name,
            "event_type": event_type,
            "payload": raw_payload,
            "content_hash": content_hash,
            "received_at": received_at,
            "idempotency_key": idempotency_key,
        }
        # Publish while the key registration is still uncommitted. The
        # producer blocks until acked, so run it off the event loop. Any
        # failure propagates and the session context manager rolls back.
        await asyncio.to_thread(
            get_producer().publish,
            topic=topic,
            payload=kafka_message,
            key=idempotency_key,
        )

    WEBHOOK_RECEIVED_COUNTER.labels(psp_name=psp_name, event_type=event_type).inc()
    log.info("ingestion.published", idempotency_key=idempotency_key, topic=topic)
    return {"is_new": True, "idempotency_key": idempotency_key, "kafka_topic": topic}


@flow(name="webhook-ingestion-flow", log_prints=True)
async def webhook_ingestion_flow(
    psp_name: str,
    event_type: str,
    raw_payload: dict[str, Any],
    content_hash: str,
    received_at: str,
) -> dict[str, Any]:
    """Orchestrated wrapper around `ingest_event` for backfill and gap detection."""
    return await ingest_event(
        psp_name=psp_name,
        event_type=event_type,
        raw_payload=raw_payload,
        content_hash=content_hash,
        received_at=received_at,
    )
