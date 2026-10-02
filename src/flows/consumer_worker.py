# src/flows/consumer_worker.py
"""
Kafka Consumer Worker — the bridge between Kafka and the Bronze → Silver flow.

A long-running process that, for each message, in order:
    1. Runs the Bronze → Silver transform
    2. On failure, parks the message in the dead-letter topic
    3. Commits the offset of *that message only* once (1) or (2) succeeded

Failures are split into two kinds:
    - permanent (malformed event, schema violation, no FX rate): dead-lettered
      immediately, since retrying cannot help
    - transient (database, MinIO or broker unavailable): retried with
      exponential backoff, up to MAX_TRANSIENT_ATTEMPTS, then dead-lettered

If the dead-letter publish itself fails, the offset is NOT committed: the
consumer rewinds and retries. Stalling a partition is the correct trade-off
for financial events; skipping one is not.

Delivery semantics: at-least-once from Kafka + the UNIQUE Silver
idempotency_key = effectively-once in Silver.

Runs as the consumer_worker Docker service.

References:
    - TDD §10.2: Bronze to Silver Flow
    - TDD §4.4: Kafka Consumer Configuration
"""

import asyncio
import base64
import signal
from types import FrameType
from uuid import UUID

import structlog
from pandera.errors import SchemaError

from src.config import get_settings
from src.engine.normaliser import PermanentEventError
from src.flows.transform_flow import process_kafka_message
from src.observability.logging import configure_logging
from src.observability.metrics import DEAD_LETTERED_COUNTER
from src.storage.kafka_consumer import ConsumedMessage, KafkaConsumer
from src.storage.kafka_producer import get_producer
from src.storage.pipeline_runs import finish_run, record_progress, start_run

log = structlog.get_logger(__name__)

MAX_BACKOFF_SECONDS = 60.0
MAX_TRANSIENT_ATTEMPTS = 5
PROGRESS_EVERY = 100


class ConsumerWorker:
    """
    Long-running Kafka consumer. Processes one message at a time so that a
    commit can never acknowledge a message that has not been handled.
    Graceful shutdown via SIGTERM/SIGINT.
    """

    def __init__(self) -> None:
        self._running = False
        settings = get_settings()
        self._topics = [
            settings.kafka_topic_paystack,
            settings.kafka_topic_flutterwave,
            settings.kafka_topic_polling,
        ]
        self._dead_letter_topic = settings.kafka_topic_dead_letter
        self._backoff = 1.0
        self._attempts: dict[tuple[str, int, int], int] = {}
        self._processed = 0
        self._failed = 0
        self._run_id: UUID | None = None

    async def start(self) -> None:
        """Start consuming messages."""
        self._running = True
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, self._handle_shutdown)

        run_id = await start_run("bronze-to-silver-consumer", triggered_by="consumer_worker")
        self._run_id = run_id
        consumer = KafkaConsumer(topics=self._topics)
        log.info("consumer_worker.started", topics=self._topics, run_id=str(run_id))
        error: BaseException | None = None
        try:
            while self._running:
                message = await asyncio.to_thread(consumer.poll_one, 1.0)
                if message is None:
                    continue
                handled = await self._handle(message)
                if handled:
                    await asyncio.to_thread(consumer.commit_message, message)
                    self._attempts.pop((message.topic, message.partition, message.offset), None)
                    self._backoff = 1.0
                    if (self._processed + self._failed) % PROGRESS_EVERY == 0:
                        await record_progress(run_id, processed=self._processed, failed=self._failed)
                else:
                    await asyncio.to_thread(consumer.rewind_to, message)
                    log.warning(
                        "consumer_worker.retrying_after_backoff",
                        topic=message.topic,
                        partition=message.partition,
                        offset=message.offset,
                        backoff_seconds=self._backoff,
                    )
                    await asyncio.sleep(self._backoff)
                    self._backoff = min(self._backoff * 2, MAX_BACKOFF_SECONDS)
        except BaseException as e:
            error = e
            raise
        finally:
            consumer.close()
            await finish_run(run_id, processed=self._processed, failed=self._failed, error=error)
            log.info("consumer_worker.stopped")

    async def _handle(self, message: ConsumedMessage) -> bool:
        """
        Process one message. Returns True when it is safe to commit the offset
        (processed, or durably dead-lettered), False when it must be retried.
        """
        if message.value is None:
            return await self._dead_letter(message, f"undecodable message: {message.decode_error}")

        kafka_message = {
            **message.value,
            "kafka_topic": message.topic,
            "kafka_partition": message.partition,
            "kafka_offset": message.offset,
        }
        kafka_message.setdefault("source_type", "webhook")
        if self._run_id is None:
            raise RuntimeError("consumer run not started")
        try:
            result = await process_kafka_message(kafka_message, self._run_id)
        except (PermanentEventError, SchemaError) as e:
            log.error(
                "consumer_worker.permanent_failure",
                topic=message.topic,
                offset=message.offset,
                error_type=type(e).__name__,
                error=str(e),
            )
            return await self._dead_letter(message, f"{type(e).__name__}: {e}")
        except Exception as e:
            position = (message.topic, message.partition, message.offset)
            attempts = self._attempts.get(position, 0) + 1
            self._attempts[position] = attempts
            log.warning(
                "consumer_worker.transient_failure",
                topic=message.topic,
                offset=message.offset,
                attempt=attempts,
                error_type=type(e).__name__,
                error=str(e),
            )
            if attempts < MAX_TRANSIENT_ATTEMPTS:
                return False
            return await self._dead_letter(message, f"gave up after {attempts} attempts: {type(e).__name__}: {e}")

        self._processed += 1
        log.info(
            "consumer_worker.processed",
            outcome=result.get("outcome"),
            silver_id=result.get("silver_transaction_id"),
            psp_name=kafka_message.get("psp_name"),
        )
        return True

    async def _dead_letter(self, message: ConsumedMessage, reason: str) -> bool:
        payload = {
            "original_topic": message.topic,
            "original_partition": message.partition,
            "original_offset": message.offset,
            "error": reason,
            "raw_value_b64": base64.b64encode(message.raw_value).decode("ascii"),
        }
        try:
            await asyncio.to_thread(
                get_producer().publish,
                topic=self._dead_letter_topic,
                payload=payload,
                key=f"dlq:{message.topic}:{message.partition}:{message.offset}",
            )
        except Exception as e:
            log.error("consumer_worker.dead_letter_failed", error_type=type(e).__name__)
            return False
        self._failed += 1
        DEAD_LETTERED_COUNTER.labels(topic=message.topic).inc()
        log.warning(
            "consumer_worker.dead_lettered",
            topic=message.topic,
            offset=message.offset,
            dead_letter_topic=self._dead_letter_topic,
        )
        return True

    def _handle_shutdown(self, signum: int, frame: FrameType | None) -> None:
        """Handle SIGTERM/SIGINT for graceful shutdown."""
        log.info("consumer_worker.shutdown_requested", signal=signal.Signals(signum).name)
        self._running = False


async def main() -> None:
    """Entry point for the consumer worker process."""
    configure_logging(level=get_settings().log_level)
    await ConsumerWorker().start()


if __name__ == "__main__":
    asyncio.run(main())
