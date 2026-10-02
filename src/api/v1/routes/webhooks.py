# src/api/v1/routes/webhooks.py
"""
PSP Webhook Endpoints.

Receives webhook events from Paystack and Flutterwave. Each endpoint verifies
the PSP-specific signature on the raw request body before anything else.

These endpoints are NOT behind API key auth — they authenticate with the PSP
signature instead. Response contract:
    401  signature missing/invalid (nothing is stored)
    400  body is not a JSON object
    200  event durably handed to the pipeline (or recognised as a duplicate)
    503  the event could not be recorded; the PSP should retry

References:
    - API Specification §3.1: Webhook Endpoints
    - TDD §8.1: PSP Connector Abstraction
"""

import json
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Request

from src.connectors.base import BasePSPConnector
from src.connectors.flutterwave import FlutterwaveConnector
from src.connectors.paystack import PaystackConnector
from src.flows.ingestion_flow import ingest_event
from src.observability.metrics import WEBHOOK_SIGNATURE_FAILURES

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/webhooks", tags=["Webhooks"])


async def _receive(request: Request, connector: BasePSPConnector, signature_header: str) -> dict[str, Any]:
    raw_body = await request.body()
    signature = request.headers.get(signature_header, "")

    if not connector.validate_signature(raw_body, signature):
        WEBHOOK_SIGNATURE_FAILURES.labels(psp_name=connector.psp_name).inc()
        log.warning("webhook.invalid_signature", psp_name=connector.psp_name)
        raise HTTPException(status_code=401, detail="Invalid signature")

    try:
        payload = json.loads(raw_body)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        raise HTTPException(status_code=400, detail="Body must be JSON") from e
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")

    event = connector.build_event(
        raw_body=raw_body,
        payload=payload,
        received_at=datetime.now(UTC).isoformat(),
    )

    try:
        result = await ingest_event(
            psp_name=event.psp_name,
            event_type=event.event_type,
            raw_payload=event.raw_payload,
            content_hash=event.content_hash,
            received_at=event.received_at,
        )
    except Exception as e:
        # Never acknowledge an event we failed to record: a non-2xx makes the
        # PSP retry, and the idempotency key was rolled back with the failure.
        log.error(
            "webhook.ingest_failed",
            psp_name=connector.psp_name,
            event_type=event.event_type,
            error_type=type(e).__name__,
        )
        raise HTTPException(status_code=503, detail="Event not recorded; retry later") from e

    return {
        "status": "accepted",
        "is_new": result["is_new"],
        "idempotency_key": result["idempotency_key"],
    }


@router.post("/paystack", summary="Receive Paystack webhook")
async def receive_paystack_webhook(request: Request) -> dict[str, Any]:
    """Verifies HMAC-SHA512 of the raw body (header `X-Paystack-Signature`)."""
    return await _receive(request, PaystackConnector(), "X-Paystack-Signature")


@router.post("/flutterwave", summary="Receive Flutterwave webhook")
async def receive_flutterwave_webhook(request: Request) -> dict[str, Any]:
    """Verifies the configured secret hash (header `verif-hash`)."""
    return await _receive(request, FlutterwaveConnector(), "verif-hash")
