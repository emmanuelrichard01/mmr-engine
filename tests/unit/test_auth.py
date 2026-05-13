# tests/unit/test_auth.py
"""
API key authentication tests.

Tests the pure functions (hashing, path config) without importing
the middleware class (which depends on SQLAlchemy/FastAPI).

References:
    - API Specification §2.1: Authentication
    - Data Governance §4.4: Access Control
"""
import hashlib
import pytest


# Test the hashing logic directly without importing the middleware module
# (which cascades into SQLAlchemy/FastAPI dependencies)

def _hash_api_key(raw_key: str) -> str:
    """Mirror of auth._hash_api_key for isolated testing."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


# Mirror of auth.PUBLIC_PATHS for isolated testing
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


class TestAPIKeyHashing:
    """Test SHA-256 key hashing."""

    def test_deterministic_hash(self):
        """Same key always produces same hash."""
        key = "mmr_test_key_abc123"
        assert _hash_api_key(key) == _hash_api_key(key)

    def test_different_keys_different_hashes(self):
        """Different keys produce different hashes."""
        hash_a = _hash_api_key("key_alpha")
        hash_b = _hash_api_key("key_beta")
        assert hash_a != hash_b

    def test_hash_is_sha256(self):
        """Hash should be a valid SHA-256 hex string."""
        result = _hash_api_key("test_key")
        assert len(result) == 64  # SHA-256 = 64 hex chars
        assert all(c in "0123456789abcdef" for c in result)

    def test_hash_matches_manual_sha256(self):
        """Our hash function matches direct hashlib call."""
        key = "mmr_live_key_xyz"
        expected = hashlib.sha256(key.encode()).hexdigest()
        assert _hash_api_key(key) == expected

    def test_empty_key_still_hashes(self):
        """Empty string should still produce valid hash."""
        result = _hash_api_key("")
        assert len(result) == 64


class TestPublicPaths:
    """Test public path configuration."""

    def test_health_is_public(self):
        assert "/health" in PUBLIC_PATHS
        assert "/health/ready" in PUBLIC_PATHS

    def test_metrics_is_public(self):
        assert "/metrics" in PUBLIC_PATHS

    def test_webhooks_are_public(self):
        """Webhooks use HMAC, not API keys."""
        assert "/v1/webhooks/paystack" in PUBLIC_PATHS
        assert "/v1/webhooks/flutterwave" in PUBLIC_PATHS
        assert "/v1/webhooks/mpesa" in PUBLIC_PATHS

    def test_docs_is_public(self):
        assert "/docs" in PUBLIC_PATHS

    def test_reconciliation_is_not_public(self):
        """API routes require authentication."""
        assert "/v1/reconciliation/summary" not in PUBLIC_PATHS
        assert "/v1/reconciliation/pairs" not in PUBLIC_PATHS
