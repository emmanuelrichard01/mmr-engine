# src/api/v1/schemas/webhooks.py
"""
Pydantic response models for webhook API endpoints.

References:
    - API Specification §4: Webhook Contracts
    - TDD §8.3: Webhook Response
"""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel


class WebhookAcceptedResponse(BaseModel):
    """Response when a webhook is accepted and processed."""
    status: str = "accepted"
    is_new: bool = True
    idempotency_key: Optional[str] = None
    message: str = "Webhook received successfully"
