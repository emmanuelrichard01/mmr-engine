# src/storage/kafka_consumer.py
"""
Redpanda (Kafka-compatible) consumer wrapper.

Offsets are committed explicitly, per message, only after that message has
been fully handled (processed, or parked in the dead-letter topic). Committing
the consumer's *position* instead would also acknowledge messages that were
polled but not yet processed, and a crash would then silently drop them.

References:
    - TDD §7.3: Kafka Producer/Consumer
    - Data Architecture §3.2: Event Streaming
"""

import json
from dataclasses import dataclass
from typing import Any

import structlog
from confluent_kafka import Consumer, KafkaError, TopicPartition

from src.config import get_settings

log = structlog.get_logger(__name__)


@dataclass
class ConsumedMessage:
    """A Kafka message with partition metadata.

    `value` is the decoded JSON object, or None when the bytes could not be
    decoded. In that case `decode_error` explains why and `raw_value` keeps
    the original bytes for the dead-letter topic.
    """

    topic: str
    partition: int
    offset: int
    key: str | None
    value: dict[str, Any] | None
    raw_value: bytes
    timestamp_ms: int
    decode_error: str | None = None


class KafkaConsumer:
    """Thin wrapper around confluent-kafka Consumer with manual, per-message commits."""

    def __init__(
        self,
        topics: list[str],
        group_id: str | None = None,
    ) -> None:
        settings = get_settings()
        self._consumer = Consumer(
            {
                "bootstrap.servers": settings.kafka_bootstrap_servers,
                "group.id": group_id or settings.kafka_consumer_group_id,
                # Start from the earliest offset on first join, so no financial
                # events are skipped if the consumer starts late.
                "auto.offset.reset": "earliest",
                # Manual commit only, after successful processing (at-least-once).
                "enable.auto.commit": False,
                "enable.auto.offset.store": False,
                "max.poll.interval.ms": 300_000,  # 5 minutes
                "session.timeout.ms": 30_000,
            }
        )
        self._consumer.subscribe(topics)
        self._topics = topics
        log.info("kafka.consumer_subscribed", topics=topics, group_id=group_id)

    def poll_one(self, timeout: float = 1.0) -> ConsumedMessage | None:
        """
        Return the next message, or None if none arrived within `timeout`.
        Transport-level errors are logged and reported as None.
        """
        msg = self._consumer.poll(timeout=timeout)
        if msg is None:
            return None
        err = msg.error()
        if err is not None:
            if err.code() != KafkaError._PARTITION_EOF:
                log.error("kafka.consume_error", error=err.str(), topic=msg.topic())
            return None

        raw: bytes = msg.value() or b""
        value: dict[str, Any] | None = None
        decode_error: str | None = None
        try:
            decoded = json.loads(raw.decode("utf-8"))
            if isinstance(decoded, dict):
                value = decoded
            else:
                decode_error = "message is not a JSON object"
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            decode_error = f"{type(e).__name__}: {e}"

        topic, partition, offset = msg.topic(), msg.partition(), msg.offset()
        if topic is None or partition is None or offset is None:
            log.error("kafka.message_without_position")
            return None
        key_bytes = msg.key()
        _, timestamp_ms = msg.timestamp()
        return ConsumedMessage(
            topic=topic,
            partition=partition,
            offset=offset,
            key=key_bytes.decode("utf-8", errors="replace") if key_bytes else None,
            value=value,
            raw_value=raw,
            timestamp_ms=timestamp_ms,
            decode_error=decode_error,
        )

    def commit_message(self, message: ConsumedMessage) -> None:
        """Synchronously commit exactly this message (offset + 1 = next to read)."""
        self._consumer.commit(
            offsets=[TopicPartition(message.topic, message.partition, message.offset + 1)],
            asynchronous=False,
        )

    def rewind_to(self, message: ConsumedMessage) -> None:
        """Seek back so `message` is redelivered by the next poll."""
        self._consumer.seek(TopicPartition(message.topic, message.partition, message.offset))

    def close(self) -> None:
        """Close consumer connection and leave consumer group."""
        self._consumer.close()
        log.info("kafka.consumer_closed", topics=self._topics)
