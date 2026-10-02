# src/api/middleware/rate_limit.py
"""
Token-bucket rate limiter.

Per API key (authenticated) or per client IP (unauthenticated), with limits
per role. Buckets live in a bounded LRU map so a flood of distinct IPs cannot
exhaust memory.

Scope and limits (documented, not hidden):
    - In-process: each API worker process keeps its own buckets. With N
      workers, the effective limit is up to N times the configured one. A shared
      store (Redis) would be needed for a global limit.
    - Client IP is the socket peer. Behind a reverse proxy, run uvicorn with
      --proxy-headers and trusted --forwarded-allow-ips so this is the real
      client address.
    - Webhooks are exempt: PSPs retry on 429, and they are signature-checked.

Default limits (requests/minute): admin 200, analyst 100, readonly 60,
otherwise API_RATE_LIMIT_PER_MINUTE.
"""

import time
from collections import OrderedDict
from dataclasses import dataclass, field

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

from src.config import get_settings
from src.observability.metrics import RATE_LIMIT_COUNTER

ROLE_LIMITS: dict[str, int] = {
    "admin": 200,
    "analyst": 100,
    "readonly": 60,
}
EXEMPT_PATHS = frozenset({"/health", "/health/ready", "/metrics"})


@dataclass
class TokenBucket:
    """Token bucket refilled continuously at `capacity` tokens per 60 seconds."""

    capacity: int
    tokens: float = -1.0
    last_refill: float = field(default_factory=time.monotonic)

    def __post_init__(self) -> None:
        if self.tokens < 0:
            self.tokens = float(self.capacity)

    def consume(self, now: float | None = None) -> bool:
        """Try to take one token. Returns True if the request is allowed."""
        now = time.monotonic() if now is None else now
        elapsed = max(0.0, now - self.last_refill)
        self.tokens = min(float(self.capacity), self.tokens + elapsed * self.capacity / 60.0)
        self.last_refill = now
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True
        return False

    @property
    def remaining(self) -> int:
        return int(self.tokens)


class BucketStore:
    """LRU-bounded map of bucket key → TokenBucket."""

    def __init__(self, max_buckets: int) -> None:
        self._max = max_buckets
        self._buckets: OrderedDict[str, TokenBucket] = OrderedDict()

    def get(self, key: str, capacity: int) -> TokenBucket:
        bucket = self._buckets.get(key)
        if bucket is None or bucket.capacity != capacity:
            bucket = TokenBucket(capacity=capacity)
            self._buckets[key] = bucket
        self._buckets.move_to_end(key)
        while len(self._buckets) > self._max:
            self._buckets.popitem(last=False)
        return bucket

    def __len__(self) -> int:
        return len(self._buckets)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-key / per-IP token bucket. Must run after authentication."""

    def __init__(self, app) -> None:  # type: ignore[no-untyped-def]  # Starlette ASGI app
        super().__init__(app)
        settings = get_settings()
        self._default_capacity = settings.api_rate_limit_per_minute
        self._store = BucketStore(settings.api_rate_limit_max_buckets)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        path = request.url.path.rstrip("/")
        if request.method == "OPTIONS" or path in EXEMPT_PATHS or path.startswith("/v1/webhooks"):
            return await call_next(request)

        key_id = getattr(request.state, "api_key_id", None)
        role = getattr(request.state, "api_role", None)
        if key_id:
            bucket_key = f"key:{key_id}"
            capacity = ROLE_LIMITS.get(role or "", self._default_capacity)
        else:
            bucket_key = f"ip:{request.client.host if request.client else 'unknown'}"
            capacity = self._default_capacity

        bucket = self._store.get(bucket_key, capacity)
        if not bucket.consume():
            RATE_LIMIT_COUNTER.inc()
            return JSONResponse(
                status_code=429,
                content={"detail": "Rate limit exceeded. Try again later."},
                headers={
                    "X-RateLimit-Limit": str(capacity),
                    "X-RateLimit-Remaining": "0",
                    "Retry-After": str(max(1, int(60 / capacity))),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(capacity)
        response.headers["X-RateLimit-Remaining"] = str(bucket.remaining)
        return response
