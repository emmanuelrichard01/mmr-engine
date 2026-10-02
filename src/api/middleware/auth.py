# src/api/middleware/auth.py
"""
API Key Authentication Middleware.

Validates the X-API-Key header against system_api_keys, where keys are stored
as SHA-256 hashes (the raw key is never persisted).

Roles are derived from the key's scopes:
    admin scope  → admin    (everything)
    write scope  → analyst  (read + discrepancy resolution)
    read scope   → readonly

Fail-closed: a request without a valid key is rejected. The only exception is
API_AUTH_DISABLED=true, which Settings refuses unless ENVIRONMENT=development.

Errors are returned as responses, not raised: an HTTPException raised inside
BaseHTTPMiddleware bypasses FastAPI's exception handlers and surfaces as a 500.

References:
    - API Specification §2.1: Authentication
    - ERD §6.2: system_api_keys table
"""

import hashlib
from datetime import UTC, datetime

import structlog
from fastapi import Request
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from src.config import get_settings
from src.observability.metrics import AUTH_FAILURES_COUNTER
from src.storage.postgres import api_session

log = structlog.get_logger(__name__)

# Exact paths that never require a key. Webhooks authenticate by PSP signature.
PUBLIC_PATHS = frozenset(
    {
        "/health",
        "/health/ready",
        "/metrics",
        "/v1/webhooks/paystack",
        "/v1/webhooks/flutterwave",
    }
)
# Interactive docs are public only outside production (they are disabled there).
DOCS_PATHS = frozenset({"/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"})


def _hash_api_key(raw_key: str) -> str:
    """Hash an API key with SHA-256 for storage/lookup."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def role_from_scopes(scopes: list[str] | None) -> str:
    """Map stored scopes to the API role used by `require_role`."""
    granted = set(scopes or [])
    if "admin" in granted:
        return "admin"
    if "write" in granted:
        return "analyst"
    return "readonly"


def is_public_path(path: str, environment: str) -> bool:
    normalised = path.rstrip("/") or "/"
    if normalised in PUBLIC_PATHS:
        return True
    return environment != "production" and normalised in DOCS_PATHS


def _reject(status_code: int, reason: str, detail: str) -> JSONResponse:
    AUTH_FAILURES_COUNTER.labels(reason=reason).inc()
    return JSONResponse(status_code=status_code, content={"detail": detail})


class APIKeyAuthMiddleware(BaseHTTPMiddleware):
    """Validates X-API-Key on every non-public route."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # CORS preflight never carries credentials.
        if request.method == "OPTIONS":
            return await call_next(request)

        settings = get_settings()
        if is_public_path(request.url.path, settings.environment):
            return await call_next(request)

        api_key = request.headers.get("X-API-Key")
        if not api_key:
            if settings.api_auth_disabled:
                # Development only (enforced by Settings).
                request.state.api_key_id = None
                request.state.api_key_name = "dev-unauthenticated"
                request.state.api_role = "analyst"
                return await call_next(request)
            return _reject(401, "missing_key", "Missing X-API-Key header")

        try:
            async with api_session() as session:
                row = (
                    (
                        await session.execute(
                            text("""
                        UPDATE system_api_keys
                        SET last_used_at = NOW(), usage_count = usage_count + 1
                        WHERE key_hash = :key_hash
                        RETURNING id, client_name, scopes, is_active, expires_at
                    """),
                            {"key_hash": _hash_api_key(api_key)},
                        )
                    )
                    .mappings()
                    .first()
                )
        except Exception as e:
            log.error("auth.db_error", error_type=type(e).__name__)
            return JSONResponse(status_code=503, content={"detail": "Auth service unavailable"})

        if row is None:
            log.warning("auth.invalid_key")
            return _reject(401, "invalid_key", "Invalid API key")
        if not row["is_active"]:
            return _reject(403, "inactive_key", "API key deactivated")
        if row["expires_at"] is not None and row["expires_at"] < datetime.now(UTC):
            return _reject(403, "expired_key", "API key expired")

        request.state.api_key_id = row["id"]
        request.state.api_key_name = row["client_name"]
        request.state.api_role = role_from_scopes(row["scopes"])
        return await call_next(request)


def require_role(allowed_roles: list[str]):  # type: ignore[no-untyped-def]  # FastAPI dependency factory
    """
    Dependency enforcing role-based access on specific endpoints.

    Usage:
        @router.get("/admin/keys", dependencies=[Depends(require_role(["admin"]))])
    """
    from fastapi import HTTPException

    async def _check_role(request: Request) -> None:
        role = getattr(request.state, "api_role", None)
        if role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required: {allowed_roles}",
            )

    return _check_role
