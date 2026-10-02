# src/storage/kafka_producer.py
"""
Redpanda (Kafka-compatible) producer wrapper.

Uses confluent-kafka with:
    - acks=all for maximum durability on financial events
    - enable.idempotence=True to prevent duplicate messages on producer retry
    - snappy compression + 5ms linger for efficient batching

`publish()` is synchronous and only returns once the broker has acknowledged
the message. Any delivery failure or timeout raises `KafkaDeliveryError`, so
callers can roll back the database transaction that recorded the event.
Silently "succeeding" here is how events get lost.

References:
    - TDD §7.3: Kafka Producer/Consumer
    - Data Architecture §3.2: Event Streaming
"""

import json
import threading
from typing import Any

import structlog
from confluent_kafka import KafkaError, KafkaException, Message, Producer

from src.config import get_settings

log = structlog.get_logger(__name__)


class KafkaDeliveryError(RuntimeError):
    """The broker did not acknowledge a message."""


class KafkaProducer:
    """
    Thin wrapper around confluent-kafka Producer.
    Uses 'all' acks for maximum durability on financial events.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._delivery_timeout = settings.kafka_delivery_timeout_seconds
        self._producer = Producer(
            {
                "bootstrap.servers": settings.kafka_bootstrap_servers,
                "acks": settings.kafka_producer_acks,
                "enable.idempotence": True,
                # Kafka producer-level idempotency: no duplicates on internal retry.
                "compression.type": "snappy",
                "linger.ms": 5,
                # Bound the total time librdkafka may spend retrying one message.
                "message.timeout.ms": int(self._delivery_timeout * 1000),
            }
        )

    def publish(
        self,
        topic: str,
        payload: dict[str, Any],
        key: str | None = None,
    ) -> None:
        """
        Publish a single message and block until the broker acknowledges it.

        key is used for partition assignment: same key → same partition →
        ordered delivery.

        Raises:
            KafkaDeliveryError: the message was not acknowledged.
        """
        outcome: dict[str, KafkaError | None] = {}

        def _on_delivery(err: KafkaError | None, msg: Message) -> None:
            outcome["error"] = err
            if err is None:
                log.debug(
                    "kafka.delivered",
                    topic=msg.topic(),
                    partition=msg.partition(),
                    offset=msg.offset(),
                )

        try:
            self._producer.produce(
                topic=topic,
                value=json.dumps(payload, default=str).encode("utf-8"),
                key=key.encode("utf-8") if key else None,
                on_delivery=_on_delivery,
            )
        except (KafkaException, BufferError) as e:
            log.error("kafka.publish_failed", topic=topic, error=str(e))
            raise KafkaDeliveryError(f"produce to {topic} failed") from e

        remaining = self._producer.flush(timeout=self._delivery_timeout)
        if remaining > 0 or "error" not in outcome:
            log.error("kafka.delivery_timeout", topic=topic, pending=remaining)
            raise KafkaDeliveryError(f"delivery to {topic} not acknowledged in time")
        if outcome["error"] is not None:
            log.error("kafka.delivery_failed", topic=topic, error=str(outcome["error"]))
            raise KafkaDeliveryError(f"delivery to {topic} failed: {outcome['error']}")

    def flush(self, timeout: float = 10.0) -> int:
        """Flush all pending messages. Returns the number of messages still in queue."""
        return int(self._producer.flush(timeout=timeout))


_producer: KafkaProducer | None = None
_producer_lock = threading.Lock()


def get_producer() -> KafkaProducer:
    """
    Process-wide producer. librdkafka producers are thread-safe and expensive
    to create (they open broker connections), so one per process is correct.
    """
    global _producer
    with _producer_lock:
        if _producer is None:
            _producer = KafkaProducer()
        return _producer
