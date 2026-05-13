# src/flows/ingestion_flow.py
"""
Webhook Ingestion Flow — FastAPI → Kafka → Bronze.

This is the entry point for all webhook events. It:
    1. Builds the idempotency key from the validated webhook payload
    2. Checks the idempotency registry (atomic INSERT ON CONFLICT)
    3. Publishes to the PSP-specific Kafka topic
    4. Returns immediately — Bronze/Silver processing is async

This flow is called synchronously from the FastAPI webhook handler
via run_deployment or direct invocation. It must be fast (<500ms)
because PSPs timeout on slow webhook responses.

References:
    - TDD §10.1: Webhook Ingestion Flow
    - API Specification §3.1: Webhook Endpoints
"""
import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from prefect import flow, task, get_run_logger

from src.config import get_settings
from src.engine.idempotency import (
    build_idempotency_key,
    check_and_register_idempotency_key,
)
from src.storage.kafka_producer import KafkaProducer
from src.storage.postgres import pipeline_session
from src.observability.metrics import (
    WEBHOOK_RECEIVED_COUNTER,
    DUPLICATE_EVENTS_COUNTER,
)


@task(
    name="validate-and-publish",
    retries=3,
    retry_delay_seconds=[10, 30, 60],
    tags=["ingestion"],
)
async def validate_and_publish_to_kafka(
    psp_name: str,
    event_type: str,
    raw_payload: dict[str, Any],
    content_hash: str,
    received_at: str,
) -> dict:
    """
    1. Build idempotency key
    2. Check idempotency registry — skip if duplicate
    3. Publish to Kafka topic

    Returns: {is_new, idempotency_key, kafka_topic}
    """
    logger = get_run_logger()
    settings = get_settings()

    # Extract PSP-specific transaction reference
    psp_tx_ref = (
        raw_payload.get("data", {}).get("reference")       # Paystack
        or raw_payload.get("data", {}).get("tx_ref")        # Flutterwave
        or raw_payload.get("data", {}).get("TransID")       # M-Pesa
        or content_hash[:16]                                 # Fallback: hash prefix
    )

    idempotency_key = build_idempotency_key(psp_name, psp_tx_ref, event_type)

    # Atomic idempotency check
    async with pipeline_session() as session:
        is_new, occurrence_count = await check_and_register_idempotency_key(
            session, idempotency_key
        )

    if not is_new:
        DUPLICATE_EVENTS_COUNTER.labels(psp_name=psp_name).inc()
        logger.warning(
            f"Duplicate event skipped: {idempotency_key} "
            f"(occurrence #{occurrence_count})"
        )
        return {
            "is_new": False,
            "idempotency_key": idempotency_key,
            "kafka_topic": None,
        }

    # Route to PSP-specific Kafka topic
    topic_map = {
        "paystack": settings.kafka_topic_paystack,
        "flutterwave": settings.kafka_topic_flutterwave,
        "mpesa": settings.kafka_topic_mpesa,
    }
    topic = topic_map.get(psp_name, settings.kafka_topic_polling)

    kafka_message = {
        "psp_name": psp_name,
        "event_type": event_type,
        "payload": raw_payload,
        "content_hash": content_hash,
        "received_at": received_at,
        "idempotency_key": idempotency_key,
    }

    # Publish to Kafka (synchronous — runs in thread if needed)
    producer = KafkaProducer()
    producer.publish(
        topic=topic,
        payload=kafka_message,
        key=idempotency_key,
    )

    WEBHOOK_RECEIVED_COUNTER.labels(
        psp_name=psp_name, event_type=event_type
    ).inc()
    logger.info(f"Published to Kafka: {idempotency_key} → {topic}")

    return {
        "is_new": True,
        "idempotency_key": idempotency_key,
        "kafka_topic": topic,
    }


@flow(
    name="webhook-ingestion-flow",
    log_prints=True,
    retries=1,
)
async def webhook_ingestion_flow(
    psp_name: str,
    event_type: str,
    raw_payload: dict[str, Any],
    content_hash: str,
    received_at: str,
) -> dict:
    """
    Top-level ingestion flow for a single webhook event.
    Called from the FastAPI webhook handler.
    """
    return await validate_and_publish_to_kafka(
        psp_name=psp_name,
        event_type=event_type,
        raw_payload=raw_payload,
        content_hash=content_hash,
        received_at=received_at,
    )
