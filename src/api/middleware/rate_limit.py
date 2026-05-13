# src/api/middleware/rate_limit.py
"""
Token Bucket Rate Limiter.

In-memory rate limiting per API key. Limits are configurable
per role to prevent abuse while allowing legitimate high-volume
access for automated reconciliation queries.

Default limits:
    - admin:    200 requests/minute
    - analyst:  100 requests/minute
    - readonly:  60 requests/minute
    - default:   30 requests/minute (unauthenticated/unknown)

References:
    - API Specification §2.3: Rate Limiting
    - NFR-004: API rate limiting
"""
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

import structlog

log = structlog.get_logger(__name__)

# Rate limits per role (requests per minute)
ROLE_LIMITS: dict[str, int] = {
    "admin": 200,
    "analyst": 100,
    "readonly": 60,
}
DEFAULT_LIMIT = 30


@dataclass
class TokenBucket:
    """Token bucket for a single API key."""
    capacity: int
    tokens: float = 0.0
    last_refill: float = field(default_factory=time.monotonic)

    def __post_init__(self):
        self.tokens = float(self.capacity)

    def consume(self) -> bool:
        """Try to consume a token. Returns True if allowed."""
        now = time.monotonic()
        elapsed = now - self.last_refill

        # Refill tokens based on elapsed time (capacity per 60 seconds)
        refill_rate = self.capacity / 60.0
        self.tokens = min(self.capacity, self.tokens + elapsed * refill_rate)
        self.last_refill = now

        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False

    @property
    def remaining(self) -> int:
        return int(self.tokens)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Per-key token bucket rate limiter.

    Adds rate limit headers to all responses:
        X-RateLimit-Limit: maximum requests per minute
        X-RateLimit-Remaining: tokens remaining
        X-RateLimit-Reset: seconds until full refill
    """

    def __init__(self, app):
        super().__init__(app)
        self._buckets: dict[str, TokenBucket] = defaultdict(
            lambda: TokenBucket(capacity=DEFAULT_LIMIT)
        )

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Skip rate limiting for health/metrics
        path = request.url.path.rstrip("/")
        if path in {"/health", "/health/ready", "/metrics"}:
            return await call_next(request)

        # Determine rate limit key and capacity
        key_id = getattr(request.state, "api_key_id", None)
        role = getattr(request.state, "api_role", None)

        if key_id:
            bucket_key = f"key:{key_id}"
            capacity = ROLE_LIMITS.get(role, DEFAULT_LIMIT)
        else:
            # Unauthenticated — rate limit by IP
            client_ip = request.client.host if request.client else "unknown"
            bucket_key = f"ip:{client_ip}"
            capacity = DEFAULT_LIMIT

        # Get or create bucket
        if bucket_key not in self._buckets:
            self._buckets[bucket_key] = TokenBucket(capacity=capacity)

        bucket = self._buckets[bucket_key]

        if not bucket.consume():
            log.warning(
                "rate_limit.exceeded",
                bucket_key=bucket_key,
                role=role,
            )
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Try again later.",
                headers={
                    "X-RateLimit-Limit": str(capacity),
                    "X-RateLimit-Remaining": "0",
                    "Retry-After": "60",
                },
            )

        response = await call_next(request)

        # Add rate limit headers
        response.headers["X-RateLimit-Limit"] = str(capacity)
        response.headers["X-RateLimit-Remaining"] = str(bucket.remaining)

        return response
