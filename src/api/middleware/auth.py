# src/api/middleware/auth.py
"""
API Key Authentication Middleware.

Validates API keys against the system_api_keys table.
Keys are stored as SHA-256 hashes — the raw key is never persisted.

Roles:
    - admin: full read/write access + key management
    - analyst: read access + discrepancy resolution
    - readonly: read-only dashboard access

References:
    - API Specification §2.1: Authentication
    - Data Governance §4.4: Access Control
    - ERD §6.2: system_api_keys table
"""
import hashlib
from datetime import datetime, timezone
from typing import Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response
from sqlalchemy import text

import structlog

from src.storage.postgres import api_session

log = structlog.get_logger(__name__)

# Paths that don't require authentication
PUBLIC_PATHS = {
    "/health",
    "/health/ready",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/v1/webhooks/paystack",
    "/v1/webhooks/flutterwave",
    "/v1/webhooks/mpesa",
}


def _hash_api_key(raw_key: str) -> str:
    """Hash an API key with SHA-256 for storage/lookup."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware that validates X-API-Key header on protected routes.

    Public paths (health, metrics, webhooks) are excluded.
    Webhook endpoints use HMAC validation instead.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Skip auth for public paths
        path = request.url.path.rstrip("/")
        if path in PUBLIC_PATHS or path.startswith("/v1/webhooks/"):
            return await call_next(request)

        # Extract API key from header
        api_key = request.headers.get("X-API-Key")
        if not api_key:
            raise HTTPException(
                status_code=401,
                detail="Missing X-API-Key header",
            )

        # Validate key against database
        key_hash = _hash_api_key(api_key)
        try:
            async with api_session() as session:
                result = await session.execute(
                    text("""
                        SELECT id, key_name, role, is_active, expires_at
                        FROM system_api_keys
                        WHERE key_hash = :key_hash
                    """),
                    {"key_hash": key_hash},
                )
                row = result.mappings().first()
        except Exception as e:
            log.error("auth.db_error", error=str(e))
            raise HTTPException(status_code=503, detail="Auth service unavailable")

        if not row:
            log.warning("auth.invalid_key", key_prefix=api_key[:8])
            raise HTTPException(status_code=401, detail="Invalid API key")

        if not row["is_active"]:
            raise HTTPException(status_code=403, detail="API key deactivated")

        if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=403, detail="API key expired")

        # Attach auth context to request state
        request.state.api_key_id = row["id"]
        request.state.api_key_name = row["key_name"]
        request.state.api_role = row["role"]

        log.info(
            "auth.authenticated",
            key_name=row["key_name"],
            role=row["role"],
        )

        return await call_next(request)


def require_role(allowed_roles: list[str]):
    """
    Dependency to enforce role-based access on specific endpoints.

    Usage:
        @router.get("/admin/keys", dependencies=[Depends(require_role(["admin"]))])
    """
    async def _check_role(request: Request):
        role = getattr(request.state, "api_role", None)
        if role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required: {allowed_roles}",
            )
    return _check_role
