# tests/unit/test_rate_limit.py
"""
Rate limiter unit tests.

References:
    - API Specification §2.3: Rate Limiting
"""
import pytest
import time

from src.api.middleware.rate_limit import TokenBucket, ROLE_LIMITS


class TestTokenBucket:
    """Test the token bucket implementation."""

    def test_initial_tokens_equal_capacity(self):
        bucket = TokenBucket(capacity=10)
        assert bucket.remaining == 10

    def test_consume_decrements(self):
        bucket = TokenBucket(capacity=10)
        assert bucket.consume() is True
        assert bucket.remaining == 9

    def test_exhausted_bucket_rejects(self):
        bucket = TokenBucket(capacity=2)
        bucket.consume()
        bucket.consume()
        assert bucket.consume() is False

    def test_refill_over_time(self):
        bucket = TokenBucket(capacity=60)
        # Consume all tokens
        for _ in range(60):
            bucket.consume()
        assert bucket.remaining == 0
        # Simulate 1 second passing (should refill 1 token at 60/min)
        bucket.last_refill -= 1.0
        assert bucket.consume() is True

    def test_refill_does_not_exceed_capacity(self):
        bucket = TokenBucket(capacity=10)
        # Simulate 10 minutes passing
        bucket.last_refill -= 600
        bucket.consume()  # Triggers refill
        assert bucket.remaining <= 10


class TestRoleLimits:
    """Verify role limit configuration."""

    def test_admin_highest_limit(self):
        assert ROLE_LIMITS["admin"] > ROLE_LIMITS["analyst"]
        assert ROLE_LIMITS["analyst"] > ROLE_LIMITS["readonly"]

    def test_all_roles_defined(self):
        for role in ["admin", "analyst", "readonly"]:
            assert role in ROLE_LIMITS

    def test_limits_are_positive(self):
        for role, limit in ROLE_LIMITS.items():
            assert limit > 0, f"Limit for {role} must be positive"
