"""
Onboarding API Routes.

Handles the business onboarding flow:
1. Business profile creation
2. PSP credential validation (read-only test call)
3. Historical data backfill trigger
4. Onboarding status tracking

These routes power the dashboard's onboarding wizard.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field


router = APIRouter(prefix="/v1/onboarding", tags=["Onboarding"])


# ── Request / Response Models ─────────────────────────────────────────────

class BusinessProfileRequest(BaseModel):
    """Step 1: Basic business information."""

    organization_name: str = Field(min_length=2, max_length=200)
    industry: str = Field(
        default="fintech",
        description="Industry vertical: fintech, ecommerce, logistics, other",
    )
    estimated_monthly_volume_ngn: Optional[float] = Field(
        default=None,
        description="Estimated monthly transaction volume in NGN",
    )
    contact_email: str = Field(
        description="Primary contact email for notifications",
    )


class PSPValidationRequest(BaseModel):
    """Step 2: Validate a PSP API key before storing."""

    psp_name: str = Field(description="paystack | flutterwave | mpesa")
    api_key: str = Field(min_length=10, description="PSP API secret key")


class PSPValidationResponse(BaseModel):
    """Result of PSP credential validation."""

    psp_name: str
    is_valid: bool
    message: str
    webhook_url: str = ""
    permissions_detected: list[str] = []


class OnboardingStatusResponse(BaseModel):
    """Current onboarding progress."""

    organization_id: str
    organization_name: str
    steps_completed: list[str]
    steps_remaining: list[str]
    connected_psps: list[dict]
    backfill_status: Optional[dict] = None
    is_complete: bool


# ── In-memory store (demo mode) ──────────────────────────────────────────
# In production, this would use the PostgreSQL tenants table.

_demo_organizations: dict[str, dict] = {}
_demo_psp_connections: dict[str, list[dict]] = {}


# ── Routes ────────────────────────────────────────────────────────────────

@router.post("/profile", response_model=dict)
async def create_business_profile(body: BusinessProfileRequest):
    """
    Step 1: Register a new business.

    Creates an organization record and returns an organization_id
    used for all subsequent onboarding steps.
    """
    org_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    _demo_organizations[org_id] = {
        "id": org_id,
        "name": body.organization_name,
        "industry": body.industry,
        "estimated_volume": body.estimated_monthly_volume_ngn,
        "contact_email": body.contact_email,
        "created_at": now,
        "status": "onboarding",
    }
    _demo_psp_connections[org_id] = []

    # Configure matching thresholds based on volume
    thresholds = _compute_thresholds(body.estimated_monthly_volume_ngn)

    return {
        "data": {
            "organization_id": org_id,
            "organization_name": body.organization_name,
            "created_at": now,
            "recommended_thresholds": thresholds,
            "next_step": "connect_psp",
            "message": (
                f"Welcome, {body.organization_name}. "
                "Next, connect your payment service providers."
            ),
        }
    }


@router.post("/validate-psp", response_model=PSPValidationResponse)
async def validate_psp_credential(body: PSPValidationRequest):
    """
    Step 2: Validate a PSP API key.

    Makes a lightweight read-only test call to the PSP API to verify
    the key is valid. Does NOT store the key — that happens in Step 3.

    Security: The key is used for a single API call and discarded.
    It is never logged, stored, or returned after this call.
    """
    psp = body.psp_name.lower()
    if psp not in ("paystack", "flutterwave", "mpesa"):
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_psp", "message": f"Unknown PSP: {psp}"},
        )

    # In demo mode, simulate validation
    result = await _validate_psp_key(psp, body.api_key)
    return result


@router.post("/connect-psp")
async def connect_psp(
    organization_id: str,
    body: PSPValidationRequest,
):
    """
    Step 3: Connect a validated PSP to the organization.

    Stores the credential (encrypted in production, in-memory for demo)
    and returns the webhook URL the business must configure in their PSP dashboard.
    """
    if organization_id not in _demo_organizations:
        raise HTTPException(status_code=404, detail="Organization not found")

    psp = body.psp_name.lower()
    now = datetime.now(timezone.utc).isoformat()

    connection = {
        "psp_name": psp,
        "status": "connected",
        "connected_at": now,
        "last_verified_at": now,
        "key_fingerprint": hashlib.sha256(
            body.api_key.encode()
        ).hexdigest()[:12],
    }

    # Remove existing connection for same PSP if any
    _demo_psp_connections[organization_id] = [
        c for c in _demo_psp_connections.get(organization_id, [])
        if c["psp_name"] != psp
    ]
    _demo_psp_connections[organization_id].append(connection)

    webhook_base = "https://api.reconciliation.internal"
    webhook_url = f"{webhook_base}/v1/webhooks/{psp}?org={organization_id}"

    return {
        "data": {
            "psp_name": psp,
            "status": "connected",
            "connected_at": now,
            "webhook_url": webhook_url,
            "setup_instructions": _get_webhook_instructions(psp, webhook_url),
            "next_step": "backfill",
            "message": (
                f"{psp.title()} connected successfully. "
                "Configure the webhook URL in your PSP dashboard, "
                "then start the historical data import."
            ),
        }
    }


@router.post("/backfill/{organization_id}")
async def trigger_backfill(organization_id: str, days: int = 30):
    """
    Step 4: Start historical data import.

    Triggers the polling backfill flow for all connected PSPs.
    Returns immediately — backfill runs asynchronously.
    """
    if organization_id not in _demo_organizations:
        raise HTTPException(status_code=404, detail="Organization not found")

    connections = _demo_psp_connections.get(organization_id, [])
    if not connections:
        raise HTTPException(
            status_code=422,
            detail="No PSPs connected. Connect at least one PSP first.",
        )

    return {
        "data": {
            "organization_id": organization_id,
            "backfill_days": days,
            "psps_included": [c["psp_name"] for c in connections],
            "status": "started",
            "estimated_duration_minutes": days * 2,  # ~2 min per day
            "message": (
                f"Importing {days} days of transaction history. "
                "This runs in the background — check status at "
                f"/v1/onboarding/status/{organization_id}"
            ),
        }
    }


@router.get("/status/{organization_id}", response_model=OnboardingStatusResponse)
async def get_onboarding_status(organization_id: str):
    """Check onboarding progress for an organization."""
    if organization_id not in _demo_organizations:
        raise HTTPException(status_code=404, detail="Organization not found")

    org = _demo_organizations[organization_id]
    connections = _demo_psp_connections.get(organization_id, [])

    steps_completed = ["profile"]
    steps_remaining = []

    if connections:
        steps_completed.append("connect_psp")
    else:
        steps_remaining.append("connect_psp")

    # In demo mode, backfill is always "complete" for simplicity
    if connections:
        steps_completed.append("backfill")
        steps_completed.append("ready")
    else:
        steps_remaining.extend(["backfill", "ready"])

    return OnboardingStatusResponse(
        organization_id=organization_id,
        organization_name=org["name"],
        steps_completed=steps_completed,
        steps_remaining=steps_remaining,
        connected_psps=[
            {"psp": c["psp_name"], "status": c["status"]}
            for c in connections
        ],
        backfill_status={
            "status": "complete" if connections else "pending",
            "progress_pct": 100 if connections else 0,
        },
        is_complete=len(steps_remaining) == 0,
    )


# ── Helpers ───────────────────────────────────────────────────────────────

def _compute_thresholds(volume: Optional[float]) -> dict:
    """Recommend matching thresholds based on business volume."""
    if volume and volume > 500_000_000:  # > NGN 500M
        return {
            "matching_window_minutes": 3,
            "fx_variance_pct": 0.003,
            "alert_exposure_ngn": 500_000,
        }
    elif volume and volume > 50_000_000:  # > NGN 50M
        return {
            "matching_window_minutes": 5,
            "fx_variance_pct": 0.005,
            "alert_exposure_ngn": 100_000,
        }
    else:
        return {
            "matching_window_minutes": 10,
            "fx_variance_pct": 0.008,
            "alert_exposure_ngn": 50_000,
        }


async def _validate_psp_key(psp: str, key: str) -> PSPValidationResponse:
    """
    Validate PSP credential with a lightweight test API call.

    In production: makes a real GET request to the PSP.
    In demo: simulates a successful validation.
    """
    # Demo mode simulation
    webhook_base = "https://api.reconciliation.internal"
    return PSPValidationResponse(
        psp_name=psp,
        is_valid=True,
        message=f"{psp.title()} API key validated successfully (demo mode).",
        webhook_url=f"{webhook_base}/v1/webhooks/{psp}",
        permissions_detected=["read:transactions", "read:settlements"],
    )


def _get_webhook_instructions(psp: str, webhook_url: str) -> dict:
    """Return PSP-specific webhook configuration instructions."""
    instructions = {
        "paystack": {
            "dashboard_url": "https://dashboard.paystack.com",
            "steps": [
                "Log into dashboard.paystack.com",
                "Go to Settings → API Keys & Webhooks",
                f"Set Webhook URL to: {webhook_url}",
                "Enable events: charge.success, transfer.success, transfer.failed",
                "Save",
            ],
        },
        "flutterwave": {
            "dashboard_url": "https://app.flutterwave.com",
            "steps": [
                "Log into app.flutterwave.com",
                "Go to Settings → Webhooks",
                f"Set Webhook URL to: {webhook_url}",
                "Set a Secret Hash (must match your FLUTTERWAVE_SECRET_HASH)",
                "Enable events: charge.completed, transfer.completed",
                "Save",
            ],
        },
        "mpesa": {
            "dashboard_url": "https://developer.safaricom.co.ke",
            "steps": [
                "Log into Safaricom Developer Portal",
                "Go to your app → API Credentials",
                f"Set Confirmation URL to: {webhook_url}",
                "Save",
            ],
        },
    }
    return instructions.get(psp, {"steps": ["Contact support for setup."]})
