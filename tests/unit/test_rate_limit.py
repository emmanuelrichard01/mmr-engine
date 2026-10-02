# tests/unit/test_rate_limit.py
"""Token bucket, bounded bucket store, and role limits."""

from src.api.middleware.rate_limit import ROLE_LIMITS, BucketStore, TokenBucket


class TestTokenBucket:
    def test_starts_full(self):
        assert TokenBucket(capacity=10).remaining == 10

    def test_exhausts_then_rejects(self):
        b = TokenBucket(capacity=3, last_refill=0.0)
        assert [b.consume(now=0.0) for _ in range(4)] == [True, True, True, False]

    def test_refills_at_capacity_per_minute(self):
        b = TokenBucket(capacity=60, last_refill=0.0)
        for _ in range(60):
            b.consume(now=0.0)
        assert b.consume(now=0.0) is False
        assert b.consume(now=1.0) is True  # 60/min = 1 token per second

    def test_refill_capped_at_capacity(self):
        b = TokenBucket(capacity=5, last_refill=0.0)
        b.consume(now=10_000.0)
        assert b.remaining == 4

    def test_clock_going_backwards_does_not_mint_tokens(self):
        b = TokenBucket(capacity=2, last_refill=100.0)
        b.consume(now=100.0)
        b.consume(now=100.0)
        assert b.consume(now=50.0) is False


class TestBucketStore:
    def test_lru_bound_prevents_unbounded_growth(self):
        """Regression: one bucket per client IP was kept forever."""
        store = BucketStore(max_buckets=100)
        for i in range(1000):
            store.get(f"ip:10.0.{i // 256}.{i % 256}", capacity=30)
        assert len(store) == 100

    def test_recently_used_bucket_survives_eviction(self):
        store = BucketStore(max_buckets=2)
        hot = store.get("hot", 5)
        store.get("a", 5)
        store.get("hot", 5)
        store.get("b", 5)
        assert store.get("hot", 5) is hot

    def test_capacity_change_resets_bucket(self):
        store = BucketStore(max_buckets=10)
        assert store.get("k", 5).capacity == 5
        assert store.get("k", 50).capacity == 50


def test_role_limits_ordered():
    assert ROLE_LIMITS["admin"] > ROLE_LIMITS["analyst"] > ROLE_LIMITS["readonly"] > 0
