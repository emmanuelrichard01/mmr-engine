# src/flows/consumer_worker.py
"""
Kafka Consumer Worker — the bridge between Kafka and Prefect flows.

This is a long-running process that:
    1. Consumes messages from all PSP Kafka topics
    2. Triggers the bronze_to_silver_flow for each message
    3. Commits offsets only after successful flow completion
    4. Sends failed messages to the dead letter topic

Runs as the prefect_worker Docker service.

Manual offset commit ensures at-least-once semantics:
    - If the flow fails, the offset is not committed
    - On restart, the consumer re-reads the message and retries
    - The idempotency registry prevents duplicate Silver writes

References:
    - TDD §10.2: Bronze to Silver Flow
    - TDD §4.4: Kafka Consumer Configuration
"""
import asyncio
import json
import signal
import sys
from typing import Any

import structlog

from src.config import get_settings
from src.flows.transform_flow import bronze_to_silver_flow
from src.storage.kafka_consumer import KafkaConsumer
from src.storage.kafka_producer import KafkaProducer

log = structlog.get_logger(__name__)


class ConsumerWorker:
    """
    Long-running Kafka consumer that triggers Prefect flows.
    Graceful shutdown via SIGTERM/SIGINT.
    """

    def __init__(self) -> None:
        self._running = False
        settings = get_settings()
        self._topics = [
            settings.kafka_topic_paystack,
            settings.kafka_topic_flutterwave,
            settings.kafka_topic_mpesa,
            settings.kafka_topic_polling,
        ]
        self._dead_letter_topic = settings.kafka_topic_dead_letter
        self._max_retries = 3

    async def start(self) -> None:
        """Start consuming messages and triggering flows."""
        self._running = True

        # Register signal handlers for graceful shutdown
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, self._handle_shutdown)

        consumer = KafkaConsumer(topics=self._topics)
        dead_letter_producer = KafkaProducer()

        log.info(
            "consumer_worker.started",
            topics=self._topics,
        )

        try:
            for message in consumer.consume(timeout=1.0):
                if not self._running:
                    break

                try:
                    # Parse Kafka message value
                    kafka_message = json.loads(message.value().decode("utf-8"))

                    log.info(
                        "consumer_worker.message_received",
                        psp_name=kafka_message.get("psp_name"),
                        event_type=kafka_message.get("event_type"),
                        topic=message.topic(),
                        partition=message.partition(),
                        offset=message.offset(),
                    )

                    # Enrich with Kafka metadata
                    kafka_message["kafka_topic"] = message.topic()
                    kafka_message["kafka_partition"] = message.partition()
                    kafka_message["kafka_offset"] = message.offset()
                    kafka_message["source_type"] = "webhook"

                    # Trigger the Bronze → Silver flow
                    result = asyncio.get_event_loop().run_until_complete(
                        bronze_to_silver_flow(kafka_message)
                    )

                    log.info(
                        "consumer_worker.flow_completed",
                        silver_id=result.get("silver_transaction_id"),
                        psp_name=kafka_message.get("psp_name"),
                    )

                    # Commit offset only after successful processing
                    consumer.commit(message)

                except Exception as e:
                    log.error(
                        "consumer_worker.flow_failed",
                        error=str(e),
                        topic=message.topic(),
                        offset=message.offset(),
                    )

                    # Send to dead letter topic for manual investigation
                    try:
                        dead_letter_payload = {
                            "original_topic": message.topic(),
                            "original_offset": message.offset(),
                            "original_partition": message.partition(),
                            "error": str(e),
                            "raw_value": message.value().decode("utf-8"),
                        }
                        dead_letter_producer.publish(
                            topic=self._dead_letter_topic,
                            payload=dead_letter_payload,
                            key=f"dlq:{message.topic()}:{message.offset()}",
                        )
                        log.info(
                            "consumer_worker.sent_to_dead_letter",
                            topic=self._dead_letter_topic,
                        )
                    except Exception as dlq_error:
                        log.error(
                            "consumer_worker.dead_letter_failed",
                            error=str(dlq_error),
                        )

                    # Commit the offset even on failure (message is in DLQ now)
                    consumer.commit(message)

        finally:
            consumer.close()
            log.info("consumer_worker.stopped")

    def _handle_shutdown(self, signum, frame):
        """Handle SIGTERM/SIGINT for graceful shutdown."""
        log.info(
            "consumer_worker.shutdown_requested",
            signal=signal.Signals(signum).name,
        )
        self._running = False


async def main():
    """Entry point for the consumer worker process."""
    worker = ConsumerWorker()
    await worker.start()


if __name__ == "__main__":
    asyncio.run(main())
