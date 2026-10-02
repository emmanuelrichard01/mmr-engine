# tests/unit/test_auth.py
"""
API authentication tests against the real middleware (no copied constants).

DB access is replaced by a stub session returning a canned row, so these run
without PostgreSQL; the SQL itself is exercised in tests/integration.
"""

import hashlib
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from src.api.middleware.auth import PUBLIC_PATHS, _hash_api_key, is_public_path, role_from_scopes


class _Result:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    def mappings(self) -> "_Result":
        return self

    def first(self) -> dict[str, Any] | None:
        return self._row


def _session_returning(row: dict[str, Any] | None):
    class _Session:
        async def execute(self, *_a: Any, **_k: Any) -> _Result:
            return _Result(row)

    @asynccontextmanager
    async def factory():
        yield _Session()

    return factory


def _client(monkeypatch: pytest.MonkeyPatch, **env: str) -> httpx.AsyncClient:
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    from src.config import get_settings

    get_settings.cache_clear()
    from src.api.main import create_app

    return httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test")


def _key_row(**overrides: Any) -> dict[str, Any]:
    row = {"id": "k1", "client_name": "ops-dashboard", "scopes": ["read"], "is_active": True, "expires_at": None}
    row.update(overrides)
    return row


class TestHelpers:
    def test_hash_is_sha256_hex(self):
        assert _hash_api_key("abc") == hashlib.sha256(b"abc").hexdigest()

    @pytest.mark.parametrize(
        ("scopes", "role"),
        [
            (["admin"], "admin"),
            (["read", "write"], "analyst"),
            (["read"], "readonly"),
            ([], "readonly"),
            (None, "readonly"),
        ],
    )
    def test_role_from_scopes(self, scopes, role):
        assert role_from_scopes(scopes) == role

    def test_webhooks_and_probes_public(self):
        assert {
            "/health",
            "/health/ready",
            "/metrics",
            "/v1/webhooks/paystack",
            "/v1/webhooks/flutterwave",
        } <= PUBLIC_PATHS

    def test_no_mpesa_or_onboarding_bypass(self):
        assert not is_public_path("/v1/webhooks/mpesa", "development")
        assert not is_public_path("/v1/onboarding/profile", "development")

    def test_docs_public_only_outside_production(self):
        assert is_public_path("/docs", "development")
        assert not is_public_path("/docs", "production")

    def test_reconciliation_not_public(self):
        assert not is_public_path("/v1/reconciliation/summary", "development")


class TestFailClosed:
    async def test_missing_key_is_401_even_in_development(self, monkeypatch):
        """Regression: development mode used to grant admin to unauthenticated callers."""
        async with _client(monkeypatch, ENVIRONMENT="development") as client:
            response = await client.get("/v1/reconciliation/summary")
        assert response.status_code == 401
        assert response.json() == {"detail": "Missing X-API-Key header"}

    async def test_auth_errors_carry_cors_headers(self, monkeypatch):
        async with _client(monkeypatch) as client:
            response = await client.get("/v1/reconciliation/summary", headers={"Origin": "http://localhost:3000"})
        assert response.status_code == 401
        assert response.headers["access-control-allow-origin"] == "http://localhost:3000"

    async def test_unknown_key_is_401(self, monkeypatch):
        with patch("src.api.middleware.auth.api_session", _session_returning(None)):
            async with _client(monkeypatch) as client:
                response = await client.get("/v1/reconciliation/summary", headers={"X-API-Key": "nope"})
        assert response.status_code == 401

    @pytest.mark.parametrize(
        ("row", "status"),
        [
            (_key_row(is_active=False), 403),
            (_key_row(expires_at=datetime.now(UTC) - timedelta(days=1)), 403),
        ],
    )
    async def test_inactive_or_expired_key_is_403(self, monkeypatch, row, status):
        with patch("src.api.middleware.auth.api_session", _session_returning(row)):
            async with _client(monkeypatch) as client:
                response = await client.get("/v1/reconciliation/summary", headers={"X-API-Key": "k"})
        assert response.status_code == status

    async def test_readonly_key_cannot_resolve(self, monkeypatch):
        with patch("src.api.middleware.auth.api_session", _session_returning(_key_row(scopes=["read"]))):
            async with _client(monkeypatch) as client:
                response = await client.post(
                    "/v1/reconciliation/discrepancies/00000000-0000-0000-0000-000000000000/resolve",
                    headers={"X-API-Key": "k"},
                    json={"resolution_note": "long enough note"},
                )
        assert response.status_code == 403

    async def test_auth_disabled_requires_development(self, monkeypatch):
        monkeypatch.setenv("ENVIRONMENT", "production")
        monkeypatch.setenv("API_AUTH_DISABLED", "true")
        from pydantic import ValidationError

        from src.config import Settings

        with pytest.raises(ValidationError, match="only allowed when ENVIRONMENT=development"):
            Settings()

    def test_environment_defaults_to_production(self, monkeypatch):
        monkeypatch.delenv("ENVIRONMENT", raising=False)
        from src.config import Settings

        assert Settings(_env_file=None).environment == "production"

    async def test_docs_disabled_in_production(self, monkeypatch):
        async with _client(monkeypatch, ENVIRONMENT="production") as client:
            assert (await client.get("/docs")).status_code in (401, 404)
            assert (await client.get("/openapi.json")).status_code in (401, 404)
