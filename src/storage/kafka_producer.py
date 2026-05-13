# src/storage/kafka_producer.py
"""
Redpanda (Kafka-compatible) producer wrapper.

Uses confluent-kafka with:
    - acks=all for maximum durability on financial events
    - enable.idempotence=True to prevent duplicate messages on retry
    - snappy compression + 5ms linger for efficient batching

References:
    - TDD §7.3: Kafka Producer/Consumer
    - Data Architecture §3.2: Event Streaming
"""
import json
from typing import Any

import structlog
from confluent_kafka import KafkaException, Producer

from src.config import get_settings

log = structlog.get_logger(__name__)


class KafkaProducer:
    """
    Thin wrapper around confluent-kafka Producer.
    Uses 'all' acks for maximum durability on financial events.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._producer = Producer({
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "acks": settings.kafka_producer_acks,
            "retries": 5,
            "retry.backoff.ms": 500,
            "enable.idempotence": True,
            # Kafka producer-level idempotency:
            # prevents duplicate messages on producer retry
            "compression.type": "snappy",
            "linger.ms": 5,
            # 5ms batching window — balances latency vs throughput
        })

    def publish(
        self,
        topic: str,
        payload: dict[str, Any],
        key: str | None = None,
    ) -> None:
        """
        Publish a single message. Blocks until delivery confirmed (acks=all).
        key is used for partition assignment — same key → same partition → ordered delivery.
        """
        try:
            self._producer.produce(
                topic=topic,
                value=json.dumps(payload, default=str).encode("utf-8"),
                key=key.encode("utf-8") if key else None,
                on_delivery=self._delivery_callback,
            )
            self._producer.flush(timeout=10)
            # Flush blocks until the message is acknowledged.
            # 10s timeout — if not acknowledged, raise.
        except KafkaException as e:
            log.error("kafka.publish_failed", topic=topic, error=str(e))
            raise

    def flush(self, timeout: float = 10.0) -> int:
        """Flush all pending messages. Returns the number of messages still in queue."""
        return self._producer.flush(timeout=timeout)

    @staticmethod
    def _delivery_callback(err: Any, msg: Any) -> None:
        if err:
            log.error(
                "kafka.delivery_failed",
                topic=msg.topic(),
                partition=msg.partition(),
                error=str(err),
            )
        else:
            log.debug(
                "kafka.delivered",
                topic=msg.topic(),
                partition=msg.partition(),
                offset=msg.offset(),
            )
