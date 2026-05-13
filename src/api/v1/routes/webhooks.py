# src/api/v1/routes/webhooks.py
"""
PSP Webhook Endpoints.

Receives webhook events from Paystack, Flutterwave, and M-Pesa.
Each endpoint validates the PSP-specific HMAC signature before
routing the event through the ingestion pipeline.

These endpoints are NOT behind API key auth — they use HMAC
signature validation instead (PSP-provided secret keys).

References:
    - API Specification §3.1: Webhook Endpoints
    - TDD §8.1: PSP Connector Abstraction
"""
import hashlib
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException

from src.connectors.paystack import PaystackConnector
from src.connectors.flutterwave import FlutterwaveConnector
from src.flows.ingestion_flow import webhook_ingestion_flow

import structlog

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/v1/webhooks", tags=["Webhooks"])


@router.post("/paystack", summary="Receive Paystack webhook")
async def receive_paystack_webhook(request: Request):
    """
    Receives and validates Paystack charge.success and other events.
    Validates HMAC-SHA512 signature from X-Paystack-Signature header.
    """
    raw_body = await request.body()
    signature = request.headers.get("X-Paystack-Signature", "")

    connector = PaystackConnector()
    if not connector.validate_signature(raw_body, signature):
        log.warning("webhook.paystack.invalid_signature")
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = json.loads(raw_body)
    event = connector.build_event(
        raw_body=raw_body,
        payload=payload,
        received_at=datetime.now(timezone.utc).isoformat(),
    )

    result = await webhook_ingestion_flow(
        psp_name=event.psp_name,
        event_type=event.event_type,
        raw_payload=event.raw_payload,
        content_hash=event.content_hash,
        received_at=event.received_at,
    )

    return {
        "status": "accepted",
        "is_new": result.get("is_new", False),
        "idempotency_key": result.get("idempotency_key"),
    }


@router.post("/flutterwave", summary="Receive Flutterwave webhook")
async def receive_flutterwave_webhook(request: Request):
    """
    Receives and validates Flutterwave charge.completed events.
    Validates secret hash from verif-hash header.
    """
    raw_body = await request.body()
    signature = request.headers.get("verif-hash", "")

    connector = FlutterwaveConnector()
    if not connector.validate_signature(raw_body, signature):
        log.warning("webhook.flutterwave.invalid_signature")
        raise HTTPException(status_code=401, detail="Invalid signature")

    payload = json.loads(raw_body)
    event = connector.build_event(
        raw_body=raw_body,
        payload=payload,
        received_at=datetime.now(timezone.utc).isoformat(),
    )

    result = await webhook_ingestion_flow(
        psp_name=event.psp_name,
        event_type=event.event_type,
        raw_payload=event.raw_payload,
        content_hash=event.content_hash,
        received_at=event.received_at,
    )

    return {
        "status": "accepted",
        "is_new": result.get("is_new", False),
        "idempotency_key": result.get("idempotency_key"),
    }


@router.post("/mpesa", summary="Receive M-Pesa callback")
async def receive_mpesa_callback(request: Request):
    """
    Receives M-Pesa Daraja API callbacks.
    M-Pesa uses IP whitelisting (validated at network level)
    rather than HMAC signatures.
    """
    raw_body = await request.body()
    payload = json.loads(raw_body)

    content_hash = hashlib.sha256(raw_body).hexdigest()
    event_type = payload.get("Body", {}).get("stkCallback", {}).get("ResultCode", "unknown")

    result = await webhook_ingestion_flow(
        psp_name="mpesa",
        event_type=f"mpesa.callback.{event_type}",
        raw_payload=payload,
        content_hash=content_hash,
        received_at=datetime.now(timezone.utc).isoformat(),
    )

    return {
        "status": "accepted",
        "is_new": result.get("is_new", False),
    }
