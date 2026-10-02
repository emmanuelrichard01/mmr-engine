# tests/unit/test_consumer_worker.py
"""
Offset-safety rules of the consumer worker: when is it safe to commit?
`_handle` returning True means "commit this offset"; False means "rewind and retry".
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from src.engine.normaliser import PermanentEventError
from src.flows.consumer_worker import MAX_TRANSIENT_ATTEMPTS, ConsumerWorker
from src.storage.kafka_consumer import ConsumedMessage
from src.storage.kafka_producer import KafkaDeliveryError


def _msg(value=None, offset=7) -> ConsumedMessage:
    return ConsumedMessage(
        topic="raw.paystack.events",
        partition=0,
        offset=offset,
        key=None,
        value=value,
        raw_value=b"raw",
        timestamp_ms=0,
        decode_error=None if value is not None else "JSONDecodeError",
    )


@pytest.fixture
def worker() -> ConsumerWorker:
    w = ConsumerWorker()
    w._run_id = uuid4()
    return w


async def test_processed_message_is_committed(worker):
    with patch("src.flows.consumer_worker.process_kafka_message", new=AsyncMock(return_value={"outcome": "written"})):
        assert await worker._handle(_msg({"psp_name": "paystack"})) is True


async def test_permanent_error_is_dead_lettered_then_committed(worker):
    with (
        patch("src.flows.consumer_worker.process_kafka_message", new=AsyncMock(side_effect=PermanentEventError("bad"))),
        patch("src.flows.consumer_worker.get_producer") as producer,
    ):
        assert await worker._handle(_msg({"psp_name": "paystack"})) is True
    producer.return_value.publish.assert_called_once()


async def test_undecodable_message_is_dead_lettered(worker):
    with patch("src.flows.consumer_worker.get_producer") as producer:
        assert await worker._handle(_msg(None)) is True
    payload = producer.return_value.publish.call_args.kwargs["payload"]
    assert payload["raw_value_b64"] == "cmF3"  # base64("raw"): original bytes preserved


async def test_dead_letter_failure_is_never_committed(worker):
    """Regression: the offset was committed even when the DLQ publish failed."""
    with (
        patch("src.flows.consumer_worker.process_kafka_message", new=AsyncMock(side_effect=PermanentEventError("bad"))),
        patch("src.flows.consumer_worker.get_producer") as producer,
    ):
        producer.return_value.publish.side_effect = KafkaDeliveryError("down")
        assert await worker._handle(_msg({"psp_name": "paystack"})) is False


async def test_transient_errors_retry_then_dead_letter(worker):
    msg = _msg({"psp_name": "paystack"})
    with (
        patch("src.flows.consumer_worker.process_kafka_message", new=AsyncMock(side_effect=ConnectionError("db"))),
        patch("src.flows.consumer_worker.get_producer") as producer,
    ):
        outcomes = [await worker._handle(msg) for _ in range(MAX_TRANSIENT_ATTEMPTS)]
    assert outcomes == [False] * (MAX_TRANSIENT_ATTEMPTS - 1) + [True]
    producer.return_value.publish.assert_called_once()
