# QUALITY ASSURANCE & TESTING STRATEGY

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, TDD v1.0, API Specification v1.0
**Last Updated:** May 2026

---

## 1. What "Correct" Means for This System

Before test cases, a definition of correctness. This is not generic. It is derived from the specific failure modes of a financial reconciliation system operating in the Nigerian PSP environment.

**The system is correct when:**

**C-001 — Idempotency:** Processing the same PSP event N times produces exactly the same state as processing it once. No duplicate Silver records. No duplicate Gold pairs. No duplicate discrepancies.

**C-002 — Financial accuracy:** `amount_ngn` for any non-NGN transaction equals `amount_raw / fx_rate_applied` with precision to 6 decimal places. No rounding errors. No floating-point arithmetic on monetary values anywhere.

**C-003 — PII containment:** No raw account number, full name, or BVN reference exists in any table in the Silver or Gold layers. Bronze Parquet contains raw PII and is access-controlled.

**C-004 — Match correctness:** A transaction pair marked `matched` with strategy `exact_primary` has identical `amount_ngn` values and overlapping timestamp windows. A pair marked with `probabilistic_secondary` has `confidence_score >= 0.75`.

**C-005 — Discrepancy completeness:** Every transaction that has been in `pending` status for longer than its `expected_settlement_at` appears in `gold_discrepancies` with classification `missing_settlement`.

**C-006 — FX timing correctness:** The FX rate applied to a transaction is the most recent rate captured at or before `settled_at`, not the current rate at query time.

**C-007 — Audit completeness:** Every status change to a canonical transaction has a corresponding record in `silver_transaction_audit_log`. No status change occurs without an audit entry.

**C-008 — CBN report accuracy:** `total_credit_volume_ngn` in `gold_cbn_daily_returns` equals the sum of `amount_ngn` for all transactions where `transaction_type = 'credit'` and `DATE(initiated_at AT TIME ZONE 'Africa/Lagos') = return_date`.

**C-009 — API contract:** Every API response conforms to the OpenAPI 3.1 schema defined in the API Specification. No undocumented fields. No missing required fields. No type mismatches.

**C-010 — Graceful degradation:** When a dependency (Kafka, MinIO, FX provider) is unavailable, the system degrades gracefully — returning 503 with appropriate retry headers rather than crashing or returning partial data silently.

---

## 2. Testing Pyramid

```
                        ┌──────────────────────────────┐
                        │                              │
                        │      E2E / Smoke Tests       │
                        │      (5–10 scenarios)        │
                        │    Slowest. Run on deploy.   │
                        │                              │
                      ┌─┴──────────────────────────────┴─┐
                      │                                  │
                      │      Integration Tests           │
                      │      (60–80 tests)               │
                      │   Real DB. Real HTTP. No mocks   │
                      │   for infrastructure concerns.   │
                      │                                  │
                  ┌───┴──────────────────────────────────┴───┐
                  │                                          │
                  │           Contract Tests                 │
                  │           (20–30 tests)                  │
                  │   Pandera schema validation.             │
                  │   dbt test suite. API schema tests.      │
                  │                                          │
              ┌───┴──────────────────────────────────────────┴───┐
              │                                                  │
              │                Unit Tests                        │
              │                (100–150 tests)                   │
              │   Fast. Isolated. No I/O. Pure logic.            │
              │   All core engine functions.                      │
              │   Every edge case in the matching algorithm.     │
              │                                                  │
              └──────────────────────────────────────────────────┘

Target coverage: ≥ 80% line coverage, ≥ 90% branch coverage on engine/
```

---

## 3. Test Environment Strategy

### 3.1 Local Development Environment

Full Docker Compose stack. Tests run against real PostgreSQL (test database), real MinIO, and real Redpanda. No mocking of infrastructure — only external PSP APIs and the FX provider are mocked.

```yaml
# docker-compose.test.yml
name: reconciliation-test

services:
  postgres_test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: reconciliation_test
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: test_password
    ports:
      - "5433:5432"   # Different port to avoid collision with dev stack
    tmpfs:
      - /var/lib/postgresql/data   # In-memory for speed in tests

  redpanda_test:
    image: redpandadata/redpanda:v23.3.21
    command:
      - redpanda start
      - --mode dev-container
      - --smp 1
      - --memory 256M
    ports:
      - "19093:19092"

  minio_test:
    image: minio/minio:RELEASE.2024-05-01T01-11-10Z
    command: server /data
    environment:
      MINIO_ROOT_USER: testadmin
      MINIO_ROOT_PASSWORD: testpassword
    tmpfs:
      - /data
```

### 3.2 CI Environment

GitHub Actions spins up PostgreSQL and MinIO as service containers. Redpanda is replaced by a lightweight in-memory Kafka mock for unit tests that touch Kafka interfaces, and the real Redpanda service container for integration tests.

### 3.3 Test Database Isolation

Each test function gets a clean database state. The approach:

```python
# tests/conftest.py

@pytest_asyncio.fixture(scope="function")
async def test_db_session():
    """
    Each test function runs inside a transaction that is rolled back
    after the test completes. This means:
    - Test isolation: no state leakage between tests
    - Speed: no teardown scripts needed
    - Reliability: test order does not affect outcomes
    
    For tests that cannot run inside a transaction
    (e.g., tests that need COMMIT semantics for constraint checking),
    use the test_db_session_committed fixture below.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: None)  # warmup
    
    async with AsyncSession(engine) as session:
        await session.begin()
        yield session
        await session.rollback()
    
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def test_db_session_committed():
    """
    For tests that require actual commits — e.g., testing
    database-level CHECK constraints, triggers, or UNIQUE violations.
    Uses a separate test schema that is truncated after each test.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    async with AsyncSession(engine) as session:
        yield session
        # Truncate all tables in reverse dependency order
        await session.execute(text("""
            TRUNCATE TABLE
                gold_exposure_tracker,
                gold_cbn_daily_returns,
                gold_discrepancies,
                gold_reconciliation_pairs,
                silver_transaction_audit_log,
                silver_idempotency_keys,
                silver_canonical_transactions,
                silver_fx_rate_snapshots,
                bronze_ingestion_log,
                system_pipeline_runs,
                system_api_keys,
                system_alert_events
            RESTART IDENTITY CASCADE
        """))
        await session.commit()
    await engine.dispose()
```

---

## 4. Unit Tests — Complete Coverage Map

Every correctness property (C-001 through C-010) is covered by unit tests. The coverage map is explicit — not "we have tests," but "test X covers property Y."

### 4.1 Idempotency Engine (covers C-001)

```python
# tests/unit/test_idempotency.py

class TestIdempotencyKeyGeneration:
    """Tests for build_idempotency_key()"""

    def test_canonical_format(self):
        """Key format: {psp}:{ref}:{event_type}"""
        key = build_idempotency_key("paystack", "T_abc123", "charge.success")
        assert key == "paystack:T_abc123:charge.success"

    def test_psp_name_lowercased(self):
        assert build_idempotency_key("PAYSTACK", "T_abc", "charge.success") \
            == build_idempotency_key("paystack", "T_abc", "charge.success")

    def test_event_type_lowercased(self):
        assert build_idempotency_key("paystack", "T_abc", "CHARGE.SUCCESS") \
            == build_idempotency_key("paystack", "T_abc", "charge.success")

    def test_whitespace_stripped(self):
        assert build_idempotency_key("  paystack  ", "T_abc", "charge.success") \
            == "paystack:T_abc:charge.success"

    def test_ref_case_preserved(self):
        """PSP references are case-sensitive — never normalise them"""
        key1 = build_idempotency_key("paystack", "T_ABC", "charge.success")
        key2 = build_idempotency_key("paystack", "T_abc", "charge.success")
        assert key1 != key2

    def test_different_psps_same_ref_produce_different_keys(self):
        """Same ref on two PSPs must not collide"""
        key1 = build_idempotency_key("paystack", "REF001", "charge.success")
        key2 = build_idempotency_key("flutterwave", "REF001", "charge.completed")
        assert key1 != key2

    def test_same_ref_different_event_types_produce_different_keys(self):
        """charge.success and transfer.success on same ref are different events"""
        key1 = build_idempotency_key("paystack", "T_abc", "charge.success")
        key2 = build_idempotency_key("paystack", "T_abc", "transfer.success")
        assert key1 != key2


class TestIdempotencyRegistry:
    """Tests for check_and_register_idempotency_key()"""

    @pytest.mark.asyncio
    async def test_first_occurrence_returns_is_new_true(
        self, test_db_session_committed
    ):
        is_new, count = await check_and_register_idempotency_key(
            test_db_session_committed,
            "paystack:T_unique_001:charge.success",
        )
        assert is_new is True
        assert count == 1

    @pytest.mark.asyncio
    async def test_second_occurrence_returns_is_new_false(
        self, test_db_session_committed
    ):
        key = "paystack:T_dup_001:charge.success"
        await check_and_register_idempotency_key(test_db_session_committed, key)
        is_new, count = await check_and_register_idempotency_key(
            test_db_session_committed, key
        )
        assert is_new is False
        assert count == 2

    @pytest.mark.asyncio
    async def test_concurrent_registrations_of_same_key(
        self, test_db_session_committed
    ):
        """
        Simulates two webhook deliveries arriving simultaneously.
        Only one should be treated as new. Both should succeed without error.
        This relies on ON CONFLICT DO UPDATE being atomic.
        """
        import asyncio
        key = "paystack:T_concurrent_001:charge.success"

        results = await asyncio.gather(
            check_and_register_idempotency_key(test_db_session_committed, key),
            check_and_register_idempotency_key(test_db_session_committed, key),
            return_exceptions=True,
        )
        new_results = [r for r in results if not isinstance(r, Exception)]
        new_count = sum(1 for is_new, _ in new_results if is_new)
        assert new_count == 1
```

### 4.2 PII Masking Engine (covers C-003)

```python
# tests/unit/test_pii_masking.py

class TestAccountNumberMasking:

    @pytest.mark.parametrize("account,expected", [
        ("0123456789", "01******89"),
        ("0000000001", "00******01"),
        ("1234567890", "12******90"),
    ])
    def test_standard_nuban_masking(self, account, expected):
        assert mask_account_number(account) == expected

    def test_none_input_returns_none(self):
        assert mask_account_number(None) is None

    def test_short_input_fully_masked(self):
        assert mask_account_number("123") == "****"

    def test_non_numeric_account(self):
        """Non-standard accounts (e.g., alphanumeric) still get masked"""
        result = mask_account_number("IBAN123456")
        assert result is not None
        assert "*" in result
        assert "IBAN123456" not in result

    def test_whitespace_stripped_before_masking(self):
        assert mask_account_number("  0123456789  ") == "01******89"


class TestNameMasking:

    @pytest.mark.parametrize("name,expected", [
        ("Chioma Okonkwo", "C****** O*******"),
        ("Tunde", "T****"),
        ("A B", "A B"),           # Single-char words preserved
        ("Jean-Pierre Dumont", "J*********** D*****"),
    ])
    def test_name_masking_formats(self, name, expected):
        assert mask_name(name) == expected

    def test_none_input_returns_none(self):
        assert mask_name(None) is None

    def test_empty_string_returns_none(self):
        assert mask_name("") is None

    def test_masking_does_not_reveal_length_precisely(self):
        """Masked name reveals name length — this is by design.
        Verify the mask length reflects actual name length."""
        result = mask_name("Emmanuel Richard")
        e_part, r_part = result.split(" ")
        assert len(e_part) == len("Emmanuel")
        assert len(r_part) == len("Richard")


class TestNarrationScrubbing:

    def test_nuban_in_narration_is_redacted(self):
        narration = "Transfer to 0123456789 for rent"
        result = scrub_narration(narration)
        assert "0123456789" not in result
        assert "[REDACTED-ACCOUNT]" in result

    def test_bvn_in_narration_is_redacted(self):
        narration = "BVN verification: 12345678901"
        result = scrub_narration(narration)
        assert "12345678901" not in result
        assert "[REDACTED-BVN]" in result

    def test_phone_number_in_narration_is_redacted(self):
        narration = "Call customer at 08012345678"
        result = scrub_narration(narration)
        assert "08012345678" not in result

    def test_clean_narration_passes_through(self):
        narration = "Payment for invoice INV-2026-001"
        assert scrub_narration(narration) == narration

    def test_long_narration_truncated_to_500_chars(self):
        narration = "x" * 600
        result = scrub_narration(narration)
        assert len(result) == 500

    def test_none_input_returns_none(self):
        assert scrub_narration(None) is None
```

### 4.3 FX Rate Engine (covers C-006)

```python
# tests/unit/test_fx_engine.py

from decimal import Decimal
from datetime import datetime, timezone

class TestNGNConversion:

    def test_ngn_to_ngn_returns_unchanged(self):
        result = convert_to_ngn(
            amount_raw=Decimal("50000"),
            currency_raw="NGN",
            fx_rate=Decimal("1"),
        )
        assert result == Decimal("50000")

    def test_usd_to_ngn_conversion(self):
        """
        amount_raw = 31.645 USD
        fx_rate = 0.00063291 (1 NGN = 0.00063291 USD)
        expected amount_ngn = 31.645 / 0.00063291 ≈ 50,000 NGN
        """
        result = convert_to_ngn(
            amount_raw=Decimal("31.645"),
            currency_raw="USD",
            fx_rate=Decimal("0.00063291"),
        )
        assert abs(result - Decimal("50000")) < Decimal("1")

    def test_zero_fx_rate_raises_value_error(self):
        with pytest.raises(ValueError, match="positive"):
            convert_to_ngn(
                amount_raw=Decimal("100"),
                currency_raw="USD",
                fx_rate=Decimal("0"),
            )

    def test_negative_fx_rate_raises_value_error(self):
        with pytest.raises(ValueError, match="positive"):
            convert_to_ngn(
                amount_raw=Decimal("100"),
                currency_raw="USD",
                fx_rate=Decimal("-0.001"),
            )

    def test_precision_preserved_to_6_decimal_places(self):
        """Financial amounts must not lose precision through conversion"""
        result = convert_to_ngn(
            amount_raw=Decimal("1.00"),
            currency_raw="USD",
            fx_rate=Decimal("0.00063291"),
        )
        # Verify result has up to 6 decimal places
        assert result == result.quantize(Decimal("0.000001"))

    def test_float_not_used_internally(self):
        """
        All monetary arithmetic must use Decimal, not float.
        A float-based result would fail equality with Decimal('0.000001') precision.
        This test catches accidental float coercion.
        """
        result = convert_to_ngn(
            amount_raw=Decimal("1000000"),
            currency_raw="USD",
            fx_rate=Decimal("0.00063291"),
        )
        assert isinstance(result, Decimal)


class TestPointInTimeFXLookup:

    @pytest.mark.asyncio
    async def test_returns_most_recent_rate_before_timestamp(
        self, test_db_session
    ):
        """
        Given rates at T=09:00, T=09:30, T=10:00 —
        a query at T=09:45 should return the T=09:30 rate,
        not the T=10:00 (future) rate.
        """
        # Insert test FX rates
        base_time = datetime(2026, 5, 1, 9, 0, tzinfo=timezone.utc)
        for i, rate in enumerate([0.00063291, 0.00063100, 0.00062800]):
            await test_db_session.execute(
                text("""
                    INSERT INTO silver_fx_rate_snapshots
                        (currency_pair, rate, source_provider, captured_at, valid_from)
                    VALUES (:pair, :rate, 'test', :captured, :valid_from)
                """),
                {
                    "pair": "NGN/USD",
                    "rate": rate,
                    "captured": base_time.replace(minute=i*30),
                    "valid_from": base_time.replace(minute=i*30),
                },
            )

        query_time = datetime(2026, 5, 1, 9, 45, tzinfo=timezone.utc)
        result = await get_fx_rate_at(test_db_session, "NGN/USD", query_time)

        assert result is not None
        _, rate = result
        assert rate == Decimal("0.00063100")  # T=09:30 rate

    @pytest.mark.asyncio
    async def test_returns_none_when_no_rate_exists_before_timestamp(
        self, test_db_session
    ):
        query_time = datetime(2020, 1, 1, 0, 0, tzinfo=timezone.utc)
        result = await get_fx_rate_at(test_db_session, "NGN/USD", query_time)
        assert result is None
```

### 4.4 Matching Engine (covers C-004)

```python
# tests/unit/test_matching_engine.py

class TestPrimaryMatchingLogic:

    @pytest.mark.asyncio
    async def test_exact_amount_and_timestamp_produces_match(
        self, test_db_session, pipeline_run_id
    ):
        """
        Property C-004: exact match requires identical amount_ngn
        within the configured time window.
        """
        initiated = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)

        # Insert source transaction (Paystack credit)
        source_id = await _insert_test_transaction(
            test_db_session,
            psp_name="paystack",
            transaction_type="credit",
            amount_ngn=Decimal("50000"),
            initiated_at=initiated,
            run_id=pipeline_run_id,
        )

        # Insert counterpart (Flutterwave debit, same amount, 2 min later)
        await _insert_test_transaction(
            test_db_session,
            psp_name="flutterwave",
            transaction_type="debit",
            amount_ngn=Decimal("50000"),
            initiated_at=initiated + timedelta(minutes=2),
            run_id=pipeline_run_id,
        )

        result = await run_matching_engine(test_db_session, source_id)

        assert result.strategy == MatchStrategy.EXACT_PRIMARY
        assert result.confidence_score == 1.0
        assert result.matched_transaction_id is not None

    @pytest.mark.asyncio
    async def test_amount_difference_prevents_primary_match(
        self, test_db_session, pipeline_run_id
    ):
        """
        Even NGN 1 difference in amount prevents primary matching.
        This is correct behaviour — primary matching is exact.
        """
        initiated = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source_id = await _insert_test_transaction(
            test_db_session, psp_name="paystack",
            transaction_type="credit", amount_ngn=Decimal("50000"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )
        await _insert_test_transaction(
            test_db_session, psp_name="flutterwave",
            transaction_type="debit", amount_ngn=Decimal("49999"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )

        result = await run_matching_engine(test_db_session, source_id)
        assert result.strategy == MatchStrategy.EXACT_PRIMARY
        assert result.matched_transaction_id is None

    @pytest.mark.asyncio
    async def test_same_psp_transactions_are_not_matched(
        self, test_db_session, pipeline_run_id
    ):
        """
        Two Paystack transactions should never be matched against each other.
        Cross-PSP matching only.
        """
        initiated = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source_id = await _insert_test_transaction(
            test_db_session, psp_name="paystack",
            transaction_type="credit", amount_ngn=Decimal("50000"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )
        await _insert_test_transaction(
            test_db_session, psp_name="paystack",  # Same PSP
            transaction_type="debit", amount_ngn=Decimal("50000"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )

        result = await run_matching_engine(test_db_session, source_id)
        assert result.matched_transaction_id is None

    @pytest.mark.asyncio
    async def test_already_matched_transaction_not_reused(
        self, test_db_session, pipeline_run_id
    ):
        """
        A transaction that is already transaction_b in a reconciliation pair
        cannot be matched again. One-to-one matching only.
        """
        initiated = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source_id_1 = await _insert_test_transaction(
            test_db_session, psp_name="paystack",
            transaction_type="credit", amount_ngn=Decimal("50000"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )
        source_id_2 = await _insert_test_transaction(
            test_db_session, psp_name="paystack",
            transaction_type="credit", amount_ngn=Decimal("50000"),
            initiated_at=initiated + timedelta(minutes=1), run_id=pipeline_run_id,
        )
        counterpart_id = await _insert_test_transaction(
            test_db_session, psp_name="flutterwave",
            transaction_type="debit", amount_ngn=Decimal("50000"),
            initiated_at=initiated, run_id=pipeline_run_id,
        )

        # Match source_1 to counterpart — creates a pair
        result_1 = await run_matching_engine(test_db_session, source_id_1)
        assert result_1.matched_transaction_id == counterpart_id

        # Insert the pair record so the matcher sees it as taken
        await test_db_session.execute(
            text("""
                INSERT INTO gold_reconciliation_pairs
                    (transaction_a_id, transaction_b_id, match_strategy,
                     confidence_score, amount_a_ngn, status, dbt_run_id)
                VALUES (:a_id, :b_id, 'exact_primary', 1.0, 50000, 'matched', :run_id)
            """),
            {"a_id": source_id_1, "b_id": counterpart_id, "run_id": pipeline_run_id},
        )

        # source_2 should NOT match the already-taken counterpart
        result_2 = await run_matching_engine(test_db_session, source_id_2)
        assert result_2.matched_transaction_id is None


class TestProbalisiticMatchingLogic:

    def test_confidence_score_components_sum_correctly(self):
        """
        Verify the confidence score formula:
        amount(0.40) + time(0.25) + name(0.25) + bank(0.10) = 1.0 max
        """
        settings = _make_test_settings()
        source = _make_source_tx(amount_ngn=Decimal("50000"))
        candidate = _make_candidate(
            amount_ngn=Decimal("50000"),    # perfect
            time_delta_seconds=0,           # perfect
            name_similarity=1.0,            # perfect
            bank_code_match=True,           # perfect
        )
        score, evidence = _compute_confidence_score(source, candidate, settings)
        assert abs(score - 1.0) < 0.001

    def test_score_below_threshold_produces_no_match(self):
        """
        A candidate with score 0.60 below threshold 0.75
        should not produce a match even if it exists.
        """
        settings = _make_test_settings(threshold=0.75)
        source = _make_source_tx(amount_ngn=Decimal("50000"))
        candidate = _make_candidate(
            amount_ngn=Decimal("48500"),    # ~3% delta → low amount score
            time_delta_seconds=1700,        # Near window edge
            name_similarity=0.5,            # Low similarity
            bank_code_match=False,
        )
        score, _ = _compute_confidence_score(source, candidate, settings)
        assert score < 0.75
```

### 4.5 Anomaly Classifier (covers C-005)

```python
# tests/unit/test_anomaly_classifier.py

class TestFXVarianceClassification:

    @pytest.mark.parametrize("amount_a, amount_b, expected_class", [
        # Within 0.5% threshold → no discrepancy
        (Decimal("50000"), Decimal("49800"), None),         # 0.4% — within threshold
        # Beyond threshold, no FX involved → amount_mismatch
        (Decimal("50000"), Decimal("49500"), "AMOUNT_MISMATCH"),   # 1% — beyond
        # Beyond threshold, FX explains it → fx_variance
        (Decimal("50000"), Decimal("49100"), "FX_VARIANCE"),
    ])
    def test_classification_by_delta(self, amount_a, amount_b, expected_class):
        fx_variance_pct = Decimal("0.018") if expected_class == "FX_VARIANCE" else None
        classification, within_threshold = classify_amount_delta(
            amount_a_ngn=amount_a,
            amount_b_ngn=amount_b,
            fx_variance_pct=fx_variance_pct,
        )
        assert classification == expected_class

    def test_zero_amount_b_is_missing_settlement(self):
        classification, _ = classify_amount_delta(
            amount_a_ngn=Decimal("50000"),
            amount_b_ngn=Decimal("0"),
            fx_variance_pct=None,
        )
        assert classification == "MISSING_SETTLEMENT"


class TestAuditCompletenessProperty:
    """Covers correctness property C-007"""

    @pytest.mark.asyncio
    async def test_status_change_writes_audit_record(
        self, test_db_session_committed, pipeline_run_id
    ):
        """
        Every status change to silver_canonical_transactions
        must produce an audit log entry. This is enforced by
        the database trigger. This test verifies the trigger fires.
        """
        tx_id = await _insert_test_transaction(
            test_db_session_committed,
            settlement_status="pending",
            run_id=pipeline_run_id,
        )

        # Update status — should trigger audit entry
        await test_db_session_committed.execute(
            text("""
                UPDATE silver_canonical_transactions
                SET settlement_status = 'settled',
                    settled_at = NOW(),
                    processed_by_run_id = :run_id
                WHERE id = :id
            """),
            {"id": tx_id, "run_id": pipeline_run_id},
        )
        await test_db_session_committed.commit()

        # Verify audit entry was created by the trigger
        audit_result = await test_db_session_committed.execute(
            text("""
                SELECT event_type, previous_state, new_state
                FROM silver_transaction_audit_log
                WHERE transaction_id = :id
                ORDER BY occurred_at DESC
                LIMIT 1
            """),
            {"id": tx_id},
        )
        audit_row = audit_result.one_or_none()
        assert audit_row is not None
        assert audit_row.event_type == "STATUS_CHANGED"
        assert audit_row.previous_state == {"settlement_status": "pending"}
        assert audit_row.new_state["settlement_status"] == "settled"
```

---

## 5. Contract Tests

Contract tests verify that data structures at layer boundaries conform to defined schemas. They catch upstream changes (PSP payload format changes, schema migrations) before they silently corrupt data.

```python
# tests/contracts/test_bronze_paystack_schema.py

class TestPaystackBronzeContract:

    def test_valid_charge_success_passes_schema(
        self, paystack_charge_success_payload
    ):
        """Standard Paystack charge.success passes Pandera validation"""
        import pandas as pd
        df = pd.DataFrame([_flatten_paystack_payload(paystack_charge_success_payload)])
        PAYSTACK_BRONZE_SCHEMA.validate(df)  # Should not raise

    def test_missing_reference_field_fails_schema(self):
        """
        If Paystack removes the 'reference' field (breaking change),
        the contract test catches it before Bronze write.
        """
        payload = {"event": "charge.success", "data": {"amount": 5000000}}
        df = pd.DataFrame([_flatten_paystack_payload(payload)])
        with pytest.raises(pandera.errors.SchemaError):
            PAYSTACK_BRONZE_SCHEMA.validate(df)

    def test_negative_amount_fails_schema(self):
        """
        Negative amounts are not valid in Bronze.
        If a PSP sends a negative amount, it is caught here —
        not silently persisted and propagated to Silver.
        """
        payload = _valid_paystack_payload()
        payload["data"]["amount"] = -5000000
        df = pd.DataFrame([_flatten_paystack_payload(payload)])
        with pytest.raises(pandera.errors.SchemaError):
            PAYSTACK_BRONZE_SCHEMA.validate(df)

    def test_unknown_fields_are_tolerated(self):
        """
        Paystack adds new fields without notice.
        Bronze schema uses strict=False — unknown fields are stored,
        not rejected. This test verifies forward compatibility.
        """
        payload = _valid_paystack_payload()
        payload["data"]["new_field_from_paystack"] = "some_value"
        df = pd.DataFrame([_flatten_paystack_payload(payload)])
        PAYSTACK_BRONZE_SCHEMA.validate(df)  # Must not raise


# tests/contracts/test_silver_canonical_schema.py

class TestSilverCanonicalContract:

    def test_pii_masking_flag_must_be_true(self):
        """
        has_pii_masked = False must fail Silver schema validation.
        This contract test verifies the Pandera check that mirrors
        the database CHECK constraint. If either fails, we catch it.
        """
        record = _valid_canonical_record()
        record["has_pii_masked"] = False
        df = pd.DataFrame([record])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_fx_rate_required_for_non_ngn(self):
        """
        A USD transaction without an fx_rate_snapshot_id
        violates the cross-field constraint. Caught in Pandera
        before the database constraint fires.
        """
        record = _valid_canonical_record(currency_raw="USD")
        record["fx_rate_snapshot_id"] = None
        df = pd.DataFrame([record])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)

    def test_raw_account_numbers_not_present(self):
        """
        Silver schema validation checks that account number fields
        conform to the masked format (not 10 raw digits).
        """
        record = _valid_canonical_record()
        record["beneficiary_account_masked"] = "0123456789"  # Unmasked!
        df = pd.DataFrame([record])
        with pytest.raises(pandera.errors.SchemaError):
            SILVER_CANONICAL_SCHEMA.validate(df)
```

### 5.1 dbt Test Suite

```sql
-- dbt_project/tests/assert_no_duplicate_idempotency_keys.sql
-- Fails if any idempotency key appears more than once in Silver
-- (would indicate an ON CONFLICT failure)

SELECT
    idempotency_key,
    COUNT(*) AS occurrence_count
FROM {{ ref('silver_canonical_transactions') }}
GROUP BY idempotency_key
HAVING COUNT(*) > 1

-- dbt_project/tests/assert_no_negative_exposure.sql
-- Property C-010: exposure is always non-negative

SELECT id, estimated_exposure_ngn
FROM {{ ref('gold_discrepancies') }}
WHERE estimated_exposure_ngn < 0

-- dbt_project/tests/assert_fx_constraint_consistent.sql
-- Property C-006: non-NGN transactions must have FX rate references

SELECT id, currency_raw, fx_rate_snapshot_id
FROM {{ ref('silver_canonical_transactions') }}
WHERE currency_raw != 'NGN'
  AND fx_rate_snapshot_id IS NULL

-- dbt_project/tests/assert_pii_masking_applied.sql
-- Property C-003: no unmasked NUBAN patterns in Silver
-- Regex checks for 10 consecutive digits in masked fields

SELECT id
FROM {{ ref('silver_canonical_transactions') }}
WHERE beneficiary_account_masked ~ '^\d{10}$'
   OR sender_account_masked ~ '^\d{10}$'

-- dbt_project/tests/assert_cbn_volume_reconciles.sql
-- Property C-008: CBN report totals match Silver source data

WITH silver_totals AS (
    SELECT
        DATE(initiated_at AT TIME ZONE 'Africa/Lagos') AS tx_date,
        SUM(amount_ngn) FILTER (WHERE transaction_type = 'credit') AS credit_vol,
        SUM(amount_ngn) FILTER (WHERE transaction_type = 'debit') AS debit_vol
    FROM {{ ref('silver_canonical_transactions') }}
    GROUP BY 1
),
cbn_totals AS (
    SELECT
        return_date,
        total_credit_volume_ngn,
        total_debit_volume_ngn
    FROM {{ ref('gold_cbn_daily_returns') }}
)
SELECT
    s.tx_date,
    ABS(s.credit_vol - c.total_credit_volume_ngn) AS credit_delta,
    ABS(s.debit_vol - c.total_debit_volume_ngn) AS debit_delta
FROM silver_totals s
JOIN cbn_totals c ON s.tx_date = c.return_date
WHERE ABS(s.credit_vol - c.total_credit_volume_ngn) > 0.01  -- NGN 0.01 tolerance
   OR ABS(s.debit_vol - c.total_debit_volume_ngn) > 0.01
```

---

## 6. Integration Tests

Integration tests verify end-to-end flows with real infrastructure. No mocks for database, MinIO, or Kafka. External PSP APIs and the FX provider are mocked with realistic responses.

```python
# tests/integration/test_bronze_to_silver_flow.py

class TestBronzeToSilverPipeline:

    @pytest.mark.asyncio
    async def test_paystack_event_lands_in_silver(
        self,
        api_client: AsyncClient,
        test_db_session_committed,
        paystack_charge_success_payload: dict,
    ):
        """
        Full pipeline test:
        1. Send valid Paystack webhook to API
        2. Wait for pipeline to process (mocked Kafka → real Bronze → real Silver)
        3. Verify canonical transaction exists in Silver with correct values
        """
        import json, hashlib, hmac, asyncio
        from src.config import get_settings
        settings = get_settings()

        body = json.dumps(paystack_charge_success_payload).encode()
        sig = hmac.new(
            settings.paystack_secret_key.encode(),
            body,
            hashlib.sha512,
        ).hexdigest()

        # Send webhook
        response = await api_client.post(
            "/v1/webhooks/paystack",
            content=body,
            headers={"X-Paystack-Signature": sig},
        )
        assert response.status_code == 200
        assert response.json()["is_new"] is True

        # Wait for async pipeline (in test, Prefect is synchronous)
        await asyncio.sleep(0.5)

        # Verify Silver record
        psp_ref = paystack_charge_success_payload["data"]["reference"]
        result = await test_db_session_committed.execute(
            text("""
                SELECT id, amount_ngn, settlement_status, has_pii_masked,
                       beneficiary_account_masked, psp_name
                FROM silver_canonical_transactions
                WHERE psp_transaction_ref = :ref AND psp_name = 'paystack'
            """),
            {"ref": psp_ref},
        )
        row = result.one_or_none()
        assert row is not None, f"No Silver record for ref {psp_ref}"
        assert row.psp_name == "paystack"
        assert row.has_pii_masked is True
        assert row.amount_ngn == Decimal("50000")  # 5000000 kobo / 100
        # Verify masking was applied
        if row.beneficiary_account_masked:
            assert not row.beneficiary_account_masked.replace("*", "").isdigit() \
                   or len(row.beneficiary_account_masked.replace("*", "")) < 10

    @pytest.mark.asyncio
    async def test_duplicate_webhook_does_not_create_duplicate_silver(
        self,
        api_client: AsyncClient,
        test_db_session_committed,
        paystack_charge_success_payload: dict,
    ):
        """
        Property C-001: idempotency guarantee.
        Same webhook sent twice → exactly one Silver record.
        """
        import json, hashlib, hmac, asyncio
        settings = get_settings()
        body = json.dumps(paystack_charge_success_payload).encode()
        sig = hmac.new(settings.paystack_secret_key.encode(), body, hashlib.sha512).hexdigest()
        headers = {"X-Paystack-Signature": sig}

        await api_client.post("/v1/webhooks/paystack", content=body, headers=headers)
        await api_client.post("/v1/webhooks/paystack", content=body, headers=headers)
        await asyncio.sleep(0.5)

        psp_ref = paystack_charge_success_payload["data"]["reference"]
        result = await test_db_session_committed.execute(
            text("""
                SELECT COUNT(*) FROM silver_canonical_transactions
                WHERE psp_transaction_ref = :ref AND psp_name = 'paystack'
            """),
            {"ref": psp_ref},
        )
        count = result.scalar_one()
        assert count == 1, f"Expected 1 Silver record, found {count}"
```

---

## 7. Performance Tests

Not load tests — this is a financial system, not a social network. Performance tests verify SLOs from the PRD are met under realistic conditions.

```python
# tests/performance/test_pipeline_latency.py

class TestPipelineLatencySLOs:
    """
    NFR-001: Webhook processing < 500ms at P99
    NFR-002: Full pipeline < 10 seconds
    NFR-003: API responses < 200ms at P95
    """

    @pytest.mark.asyncio
    async def test_webhook_to_bronze_under_500ms(
        self, api_client, paystack_charge_success_payload
    ):
        import time
        times = []
        for _ in range(50):  # 50 samples for P99
            start = time.perf_counter()
            await api_client.post(
                "/v1/webhooks/paystack",
                content=json.dumps(_fresh_payload()).encode(),
                headers={"X-Paystack-Signature": _valid_sig(_fresh_payload())},
            )
            times.append(time.perf_counter() - start)

        p99 = sorted(times)[int(len(times) * 0.99)]
        assert p99 < 0.500, f"P99 webhook latency {p99:.3f}s exceeds 500ms SLO"

    @pytest.mark.asyncio
    async def test_summary_api_under_200ms_p95(
        self, api_client, read_api_key, seeded_summary_data
    ):
        import time
        times = []
        for _ in range(100):
            start = time.perf_counter()
            await api_client.get(
                "/v1/reconciliation/summary",
                headers={"X-API-Key": read_api_key},
            )
            times.append(time.perf_counter() - start)

        p95 = sorted(times)[int(len(times) * 0.95)]
        assert p95 < 0.200, f"P95 API latency {p95:.3f}s exceeds 200ms SLO"
```

---

## 8. End-to-End / Smoke Tests

Five scenarios. These run against the full Docker Compose stack after every deployment. They verify the system's most critical guarantees in sequence.

```python
# tests/e2e/test_smoke.py

class TestCriticalUserJourneys:
    """
    These tests run against the full running stack.
    Make target: make smoke
    Run time: < 2 minutes.
    Failure here blocks deployment.
    """

    @pytest.mark.e2e
    @pytest.mark.asyncio
    async def test_sc_001_new_event_reaches_gold_layer(self, live_api_client):
        """
        Scenario: A new Paystack charge.success webhook fires.
        Expected: Within 15 seconds, a reconciliation pair exists in Gold.
        Covers: C-001 (idempotency), C-003 (PII), C-007 (audit)
        """
        ...

    @pytest.mark.e2e
    @pytest.mark.asyncio
    async def test_sc_002_duplicate_webhook_produces_no_duplicate_record(
        self, live_api_client, live_db_session
    ):
        """
        Scenario: Same Paystack webhook fires twice (PSP retry).
        Expected: Exactly one Silver record. One idempotency key entry.
        Covers: C-001
        """
        ...

    @pytest.mark.e2e
    @pytest.mark.asyncio
    async def test_sc_003_missing_settlement_raises_discrepancy(
        self, live_api_client, live_db_session
    ):
        """
        Scenario: A credit transaction arrives. No matching debit arrives.
        Polling fallback runs. After expected_settlement_at passes,
        a discrepancy appears in Gold.
        Covers: C-005
        """
        ...

    @pytest.mark.e2e
    @pytest.mark.asyncio
    async def test_sc_004_fx_variance_within_threshold_no_discrepancy(
        self, live_api_client, live_db_session
    ):
        """
        Scenario: Two matched transactions with a 0.3% FX-driven delta.
        Expected: match_status = 'matched', is_within_fx_threshold = True.
        No discrepancy raised.
        Covers: C-004, C-006
        """
        ...

    @pytest.mark.e2e
    @pytest.mark.asyncio
    async def test_sc_005_cbn_daily_report_totals_reconcile_with_silver(
        self, live_api_client, live_db_session
    ):
        """
        Scenario: Run daily_report_flow for yesterday.
        Expected: report total_credit_volume_ngn matches
        SUM(amount_ngn) WHERE transaction_type='credit' in Silver.
        Covers: C-008
        """
        ...
```

---

## 9. Test Coverage Requirements

```
Scope                           Required Coverage   Rationale
─────────────────────────────── ─────────────────── ──────────────────────────────────────
src/engine/                     ≥ 95% line          Core business logic. Every branch
                                ≥ 90% branch        of matching and FX has financial impact.

src/api/                        ≥ 80% line          API layer. Request validation and
                                                    error handling are critical.

src/connectors/                 ≥ 90% line          PSP signature validation must be
                                                    fully tested — security boundary.

src/flows/                      ≥ 70% line          Orchestration logic. Harder to unit
                                                    test; integration tests compensate.

src/storage/                    ≥ 60% line          Thin wrappers. Integration tests
                                                    cover the meaningful paths.

Overall                         ≥ 80% line          Enforced by CI coverage gate.
                                                    PR fails if coverage drops below.
```

**Coverage enforcement in CI:**
```yaml
# .github/workflows/ci.yml (excerpt)
- name: Enforce coverage threshold
  run: |
    pytest tests/unit/ tests/contracts/ \
      --cov=src \
      --cov-report=xml \
      --cov-fail-under=80
    
    # Engine-specific coverage check
    coverage report --include="src/engine/*" \
      --fail-under=95
```

---

## 10. Test Data Strategy

### 10.1 Synthetic Data Generator

```python
# scripts/generate_test_data.py

import json, hashlib, hmac, random, uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal

def generate_paystack_charge_success(
    amount_ngn: Decimal = Decimal("50000"),
    initiated_at: datetime | None = None,
) -> tuple[dict, str]:
    """
    Generate a realistic Paystack charge.success payload with valid HMAC.
    Returns (payload, signature).
    Used in development, integration tests, and smoke tests.
    """
    if initiated_at is None:
        initiated_at = datetime.now(timezone.utc)

    ref = f"T_{uuid.uuid4().hex[:12]}"
    payload = {
        "event": "charge.success",
        "data": {
            "id": random.randint(100000000, 999999999),
            "reference": ref,
            "amount": int(amount_ngn * 100),   # Convert to kobo
            "currency": "NGN",
            "status": "success",
            "paid_at": initiated_at.isoformat(),
            "created_at": initiated_at.isoformat(),
            "channel": random.choice(["bank_transfer", "card", "ussd"]),
            "fees": int(amount_ngn * 100 * 0.029),  # ~2.9% fee
            "authorization": {
                "account_number": f"{random.randint(0, 9999999999):010d}",
                "account_name": random.choice([
                    "CHIOMA OKONKWO", "TUNDE ADEYEMI",
                    "AMINA IBRAHIM", "EMEKA OKAFOR",
                ]),
                "bank": "Guaranty Trust Bank",
                "bank_code": "058",
            },
            "customer": {
                "email": f"customer_{ref}@test.internal",
            },
        },
    }
    body = json.dumps(payload).encode()
    from src.config import get_settings
    sig = hmac.new(
        get_settings().paystack_secret_key.encode(),
        body,
        hashlib.sha512,
    ).hexdigest()
    return payload, sig
```

### 10.2 Test Data Principles

These are non-negotiable for a financial system test suite:

**No real account numbers, ever.** Test account numbers always use the format `0000XXXXXX` where X is a digit. Never real NUBANs from actual transactions.

**No real names, ever.** Fixtures use a fixed set of clearly fictional test names. Never derive test data from real PSP transactions.

**Amounts are recognisable.** Test amounts use round numbers with clear meaning: NGN 50,000 (matched), NGN 50,500 (1% over), NGN 49,750 (0.5% under — at threshold boundary). These make failing tests readable.

**Timestamps are explicit.** Never `datetime.now()` in test assertions. Always anchor to a fixed datetime (`datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)`) so tests are deterministic regardless of when they run.

---

## 11. Defect Classification

Not all bugs are equal. This classification determines response priority:

```
Severity    Definition for This System                  Response
─────────── ─────────────────────────────────────────── ──────────────────────────────
P1 CRITICAL Financial data corrupted or duplicated.     Fix before any other work.
            Discrepancy missed. Audit trail broken.     Deploy hotfix immediately.
            PII exposed in Silver or Gold.              Incident procedure triggered.
            Idempotency failure.

P2 HIGH     Correct data but wrong API response.        Fix within current sprint.
            Rate limiting bypass. Auth scope bypass.    No new features until resolved.
            Performance SLO breached in production.

P3 MEDIUM   Non-critical UI display errors.             Fix in next sprint.
            Slow query (not yet at SLO breach).
            Log formatting issues.

P4 LOW      Documentation inaccuracies.                 Fix when convenient.
            Code style violations.
            Non-critical configuration warnings.
```

---

## 12. Definition of Done

A feature is done when all of these are true — not most, all:

```
□ Unit tests written for all new engine logic (coverage ≥ 95% for engine/)
□ Integration test covers the happy path end-to-end
□ Contract tests updated if any schema boundary changed
□ dbt tests updated if any Gold layer model changed
□ All correctness properties (C-001 to C-010) still pass
□ CI pipeline passes (lint, typecheck, test, coverage gate)
□ No new secrets committed (gitleaks passes)
□ Data Dictionary updated if any new field introduced
□ API Specification updated if any endpoint changed
□ Security review completed if any auth or PII-adjacent code changed
□ Performance tests pass (SLOs not degraded)
```

---

## 13. What These Documents Establish

The full pre-engineering documentation set is now complete:

```
✅ PRD v1.0                        What we build and why
✅ Data Architecture Blueprint      How data flows through the system
✅ ERD + Database Schema            Exact shape of every entity
✅ Data Dictionary                  Precise meaning of every field
✅ TDD v1.0                         How the system is engineered
✅ API Specification v1.0           How the system is consumed
✅ Data Governance & Security       How sensitive data is protected
✅ QA & Testing Strategy            What correct means and how we verify it
```

Together these eight documents mean that when the first line of code is written:

- Every data model decision is already made and recorded
- Every security control is specified before implementation — not retrofitted
- Every test has a named correctness property it covers
- Every regulatory requirement (NDPR, CBN) has a technical implementation
- Every engineer joining the project later has a complete reference

The build phase starts with the migration files and Docker Compose. Everything else follows the TDD implementation sequence. The documents don't change the code you write — they ensure you never have to make the same decision twice under implementation pressure.