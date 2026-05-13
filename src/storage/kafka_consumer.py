# src/storage/kafka_consumer.py
"""
Redpanda (Kafka-compatible) consumer wrapper.

Provides a blocking consume loop used by the Bronze writer worker.
Handles deserialization, error logging, and graceful shutdown.

References:
    - TDD §7.3: Kafka Producer/Consumer
    - Data Architecture §3.2: Event Streaming
"""
import json
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

import structlog
from confluent_kafka import Consumer, KafkaError, KafkaException

from src.config import get_settings

log = structlog.get_logger(__name__)


@dataclass
class ConsumedMessage:
    """Deserialized Kafka message with partition metadata."""

    topic: str
    partition: int
    offset: int
    key: str | None
    value: dict[str, Any]
    timestamp_ms: int


class KafkaConsumer:
    """
    Thin wrapper around confluent-kafka Consumer.
    Provides a generator-based consume API for clean iteration.
    """

    def __init__(
        self,
        topics: list[str],
        group_id: str | None = None,
    ) -> None:
        settings = get_settings()
        self._consumer = Consumer({
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "group.id": group_id or settings.kafka_consumer_group_id,
            "auto.offset.reset": "earliest",
            # Start from the earliest offset on first join — ensures
            # no financial events are skipped if the consumer starts late.
            "enable.auto.commit": False,
            # Manual commit only — we commit after successful processing
            # to guarantee at-least-once delivery semantics.
            "max.poll.interval.ms": 300_000,  # 5 minutes
            "session.timeout.ms": 30_000,
        })
        self._consumer.subscribe(topics)
        self._topics = topics
        log.info("kafka.consumer_subscribed", topics=topics, group_id=group_id)

    def consume(
        self,
        timeout: float = 1.0,
        max_messages: int = 100,
    ) -> Generator[ConsumedMessage, None, None]:
        """
        Yield deserialized messages from subscribed topics.

        This is a blocking call that polls for up to `timeout` seconds.
        Yields up to `max_messages` per invocation.
        Caller must call commit() after successful processing.
        """
        count = 0
        while count < max_messages:
            msg = self._consumer.poll(timeout=timeout)
            if msg is None:
                break

            if msg.error():
                if msg.error().code() == KafkaError._PARTITION_EOF:
                    # End of partition — not an error
                    log.debug(
                        "kafka.partition_eof",
                        topic=msg.topic(),
                        partition=msg.partition(),
                    )
                    continue
                log.error(
                    "kafka.consume_error",
                    error=msg.error().str(),
                    topic=msg.topic(),
                )
                continue

            try:
                value = json.loads(msg.value().decode("utf-8"))
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                log.error(
                    "kafka.deserialize_failed",
                    topic=msg.topic(),
                    offset=msg.offset(),
                    error=str(e),
                )
                continue

            key = msg.key().decode("utf-8") if msg.key() else None
            timestamp_type, timestamp_ms = msg.timestamp()

            yield ConsumedMessage(
                topic=msg.topic(),
                partition=msg.partition(),
                offset=msg.offset(),
                key=key,
                value=value,
                timestamp_ms=timestamp_ms,
            )
            count += 1

    def commit(self) -> None:
        """Commit current offsets. Called after successful batch processing."""
        self._consumer.commit(asynchronous=False)
        log.debug("kafka.offsets_committed")

    def close(self) -> None:
        """Close consumer connection and leave consumer group."""
        self._consumer.close()
        log.info("kafka.consumer_closed", topics=self._topics)
