# tests/unit/test_webhooks.py
"""
Webhook endpoint contract: signature first, 503 (so the PSP retries) when the
event could not be recorded, 200 only once it was durably handed off.
"""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import httpx

SECRET = "sk_test_dummy"  # PAYSTACK_SECRET_KEY from tests/conftest.py


def _signed(body: dict) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    sig = hmac.new(SECRET.encode(), raw, hashlib.sha512).hexdigest()
    return raw, {"X-Paystack-Signature": sig, "Content-Type": "application/json"}


def _client() -> httpx.AsyncClient:
    from src.api.main import create_app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test")


async def test_invalid_signature_is_401_and_nothing_ingested():
    with patch("src.api.v1.routes.webhooks.ingest_event", new=AsyncMock()) as ingest:
        async with _client() as client:
            r = await client.post("/v1/webhooks/paystack", content=b"{}", headers={"X-Paystack-Signature": "bad"})
    assert r.status_code == 401
    ingest.assert_not_awaited()


async def test_missing_signature_is_401():
    async with _client() as client:
        r = await client.post("/v1/webhooks/flutterwave", content=b"{}")
    assert r.status_code == 401


async def test_ingest_failure_returns_503_so_psp_retries():
    raw, headers = _signed({"event": "charge.success", "data": {"reference": "T1"}})
    with patch("src.api.v1.routes.webhooks.ingest_event", new=AsyncMock(side_effect=RuntimeError("kafka down"))):
        async with _client() as client:
            r = await client.post("/v1/webhooks/paystack", content=raw, headers=headers)
    assert r.status_code == 503


async def test_accepted_event():
    raw, headers = _signed({"event": "charge.success", "data": {"reference": "T1"}})
    result = {"is_new": True, "idempotency_key": "paystack:T1:charge.success", "kafka_topic": "raw.paystack.events"}
    with patch("src.api.v1.routes.webhooks.ingest_event", new=AsyncMock(return_value=result)) as ingest:
        async with _client() as client:
            r = await client.post("/v1/webhooks/paystack", content=raw, headers=headers)
    assert r.status_code == 200
    assert r.json() == {"status": "accepted", "is_new": True, "idempotency_key": "paystack:T1:charge.success"}
    assert ingest.await_args.kwargs["event_type"] == "charge.success"


async def test_signed_non_json_body_is_400():
    raw = b"not json"
    sig = hmac.new(SECRET.encode(), raw, hashlib.sha512).hexdigest()
    async with _client() as client:
        r = await client.post("/v1/webhooks/paystack", content=raw, headers={"X-Paystack-Signature": sig})
    assert r.status_code == 400


async def test_mpesa_route_removed():
    async with _client() as client:
        r = await client.post("/v1/webhooks/mpesa", content=b"{}")
    assert r.status_code in (401, 404)
