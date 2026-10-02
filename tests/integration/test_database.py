# tests/integration/test_database.py
"""
Database-level guarantees, tested against real PostgreSQL with the real
migrations: one-to-one matching, append-only audit tables, least privilege,
durable ingestion, missing-settlement classification and the resolve API.
"""

import asyncio
import itertools
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import UUID, uuid4

import asyncpg
import httpx
import pytest

from src.engine.matching import DEFAULT_CONFIG
from src.engine.pii import tokenize_name
from src.flows import matching_flow
from src.flows.ingestion_flow import ingest_event
from src.storage.kafka_producer import KafkaDeliveryError

pytestmark = pytest.mark.db

_offsets = itertools.count(1)


async def _run(conn: asyncpg.Connection) -> UUID:
    return await conn.fetchval(
        "INSERT INTO system_pipeline_runs (flow_name, triggered_by) VALUES ('test', 'pytest') RETURNING id"
    )


async def _silver(
    conn: asyncpg.Connection,
    *,
    psp: str,
    tx_type: str,
    amount: str,
    initiated_at: datetime,
    name: str | None = None,
    status: str = "settled",
    expected_settlement_at: datetime | None = None,
) -> UUID:
    run_id = await _run(conn)
    offset = next(_offsets)
    bronze_id = await conn.fetchval(
        """
        INSERT INTO bronze_ingestion_log (psp_name, source_type, kafka_topic, kafka_partition, kafka_offset,
                                          content_hash, file_path, event_count, ingestion_run_id, status)
        VALUES ($1, 'webhook', 'test', 0, $2, repeat('a', 64), 's3://test', 1, $3, 'written')
        RETURNING id
        """,
        psp,
        offset,
        run_id,
    )
    return await conn.fetchval(
        """
        INSERT INTO silver_canonical_transactions (
            idempotency_key, bronze_ingestion_id, psp_name, psp_transaction_ref, psp_event_type,
            psp_event_received_at, transaction_type, amount_raw, currency_raw, amount_ngn,
            initiated_at, settled_at, expected_settlement_at, settlement_status, has_pii_masked,
            counterparty_name_tokens, processed_by_run_id)
        VALUES ($1, $2, $3, $4, 'test.event', NOW(), $5, $6, 'NGN', $6, $7::timestamptz,
                CASE WHEN $8::text = 'settled' THEN $7::timestamptz END, $9::timestamptz, $8::settlement_status_enum, TRUE, $10::text[], $11)
        RETURNING id
        """,
        f"{psp}:REF{offset}:test",
        bronze_id,
        psp,
        f"REF{offset}",
        tx_type,
        Decimal(amount),
        initiated_at,
        status,
        expected_settlement_at,
        tokenize_name(name) if name else [],
        run_id,
    )


async def _clear(conn: asyncpg.Connection) -> None:
    """Test-only reset (superuser). The append-only guards are disabled just for
    the duration of the truncate; production code has no such path."""
    guarded = ("gold_discrepancy_events", "silver_transaction_audit_log")
    async with conn.transaction():
        for table in guarded:
            await conn.execute(f"ALTER TABLE {table} DISABLE TRIGGER USER")
        await conn.execute(
            "TRUNCATE gold_discrepancy_events, system_alert_events, gold_discrepancies, "
            "gold_matched_transactions, gold_reconciliation_pairs, silver_transaction_audit_log, "
            "silver_idempotency_keys, silver_canonical_transactions CASCADE"
        )
        for table in guarded:
            await conn.execute(f"ALTER TABLE {table} ENABLE TRIGGER USER")


# ── Schema guarantees ───────────────────────────────────────────────────────


async def test_migrations_reach_head(conn):
    assert await conn.fetchval("SELECT version_num FROM alembic_version") == "015"


async def test_transaction_cannot_be_matched_twice(conn):
    await _clear(conn)
    now = datetime.now(UTC)
    a = await _silver(conn, psp="paystack", tx_type="credit", amount="100", initiated_at=now)
    b = await _silver(conn, psp="flutterwave", tx_type="debit", amount="100", initiated_at=now)
    c = await _silver(conn, psp="flutterwave", tx_type="debit", amount="100", initiated_at=now)

    async def pair(x: UUID, y: UUID) -> None:
        async with conn.transaction():
            pid = await conn.fetchval(
                "INSERT INTO gold_reconciliation_pairs (transaction_a_id, transaction_b_id, amount_a_ngn) "
                "VALUES ($1, $2, 100) RETURNING id",
                x,
                y,
            )
            await conn.execute(
                "INSERT INTO gold_matched_transactions (transaction_id, pair_id) VALUES ($1, $3), ($2, $3)", x, y, pid
            )

    await pair(a, b)
    with pytest.raises(asyncpg.UniqueViolationError):
        await pair(a, c)  # A already matched
    with pytest.raises(asyncpg.UniqueViolationError):
        await pair(b, a)  # the reversed pair is also rejected


@pytest.mark.parametrize("table", ["gold_discrepancy_events", "silver_transaction_audit_log"])
async def test_audit_tables_are_append_only(conn, table):
    await _clear(conn)
    now = datetime.now(UTC)
    tx = await _silver(conn, psp="paystack", tx_type="credit", amount="5", initiated_at=now)
    if table == "gold_discrepancy_events":
        disc = await conn.fetchval(
            "INSERT INTO gold_discrepancies (transaction_id, classification, confidence_score, evidence) "
            "VALUES ($1, 'missing_settlement', 1, '{}') RETURNING id",
            tx,
        )
        await conn.execute(
            "INSERT INTO gold_discrepancy_events (discrepancy_id, action, to_status, actor) "
            "VALUES ($1, 'raised', 'open', 'pytest')",
            disc,
        )
    else:
        await conn.execute(
            "INSERT INTO silver_transaction_audit_log (transaction_id, event_type, new_state, triggered_by) "
            "VALUES ($1, 'TEST', '{}', 'pytest')",
            tx,
        )

    # Even the superuser/owner is blocked: the guarantee does not depend on grants.
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="append-only"):
        await conn.execute(f"UPDATE {table} SET occurred_at = NOW()")
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="append-only"):
        await conn.execute(f"DELETE FROM {table}")


async def test_least_privilege_api_role(conn):
    await _clear(conn)
    tx = await _silver(conn, psp="paystack", tx_type="credit", amount="5", initiated_at=datetime.now(UTC))
    disc = await conn.fetchval(
        "INSERT INTO gold_discrepancies (transaction_id, classification, confidence_score, evidence) "
        "VALUES ($1, 'missing_settlement', 1, '{}') RETURNING id",
        tx,
    )
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE reconciliation_api_user")
        # Allowed: the resolution columns.
        await conn.execute("UPDATE gold_discrepancies SET resolution_note = 'checked' WHERE id = $1", disc)
        # Denied: rewriting the money.
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            async with conn.transaction():
                await conn.execute("UPDATE gold_discrepancies SET estimated_exposure_ngn = 0 WHERE id = $1", disc)
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            async with conn.transaction():
                await conn.execute("DELETE FROM gold_discrepancies")


async def test_pipeline_role_cannot_rewrite_silver(conn):
    async with conn.transaction():
        await conn.execute("SET LOCAL ROLE reconciliation_pipeline")
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            await conn.execute("UPDATE silver_canonical_transactions SET amount_ngn = 0")


# ── Ingestion durability ───────────────────────────────────────────────────


async def test_failed_publish_does_not_register_idempotency_key(conn, app_db):
    """Regression: the key used to be committed before the Kafka publish, so a
    failed publish made every PSP retry look like a duplicate and the event was lost."""
    payload = {"event": "charge.success", "data": {"reference": f"T_{uuid4().hex[:10]}"}}
    key = f"paystack:{payload['data']['reference']}:charge.success"

    failing = patch("src.flows.ingestion_flow.get_producer")
    with failing as producer:
        producer.return_value.publish.side_effect = KafkaDeliveryError("broker down")
        with pytest.raises(KafkaDeliveryError):
            await ingest_event("paystack", "charge.success", payload, "h" * 64, datetime.now(UTC).isoformat())
    assert await conn.fetchval("SELECT count(*) FROM silver_idempotency_keys WHERE key = $1", key) == 0

    with patch("src.flows.ingestion_flow.get_producer") as producer:
        first = await ingest_event("paystack", "charge.success", payload, "h" * 64, datetime.now(UTC).isoformat())
        retry = await ingest_event("paystack", "charge.success", payload, "h" * 64, datetime.now(UTC).isoformat())
    assert first["is_new"] is True
    assert retry["is_new"] is False
    assert producer.return_value.publish.call_count == 1


# ── Matching flow against real data ────────────────────────────────────────


async def test_matching_flow_pairs_and_is_idempotent(conn, app_db):
    await _clear(conn)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    a = await _silver(conn, psp="paystack", tx_type="credit", amount="50000", initiated_at=t0, name="Ada Eze")
    b = await _silver(
        conn, psp="flutterwave", tx_type="debit", amount="50000", initiated_at=t0 + timedelta(minutes=3), name="ADA EZE"
    )
    lonely = await _silver(conn, psp="paystack", tx_type="credit", amount="777", initiated_at=t0)

    run_id = await _run(conn)
    candidates = await matching_flow.fetch_match_candidates(timedelta(days=14))
    pairs = matching_flow.match_all(candidates, DEFAULT_CONFIG)
    written, _ = await matching_flow.persist_pairs(pairs, {c.id: c for c in candidates}, run_id)
    assert written == 1
    matched = {r["transaction_id"] for r in await conn.fetch("SELECT transaction_id FROM gold_matched_transactions")}
    assert matched == {a, b}
    assert lonely not in matched

    # A second run finds nothing new to match.
    again = await matching_flow.fetch_match_candidates(timedelta(days=14))
    assert {c.id for c in again} == {lonely}


async def test_concurrent_persist_matches_once(conn, app_db):
    await _clear(conn)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    await _silver(conn, psp="paystack", tx_type="credit", amount="9000", initiated_at=t0)
    await _silver(conn, psp="flutterwave", tx_type="debit", amount="9000", initiated_at=t0)
    run_id = await _run(conn)
    candidates = await matching_flow.fetch_match_candidates(timedelta(days=14))
    pairs = matching_flow.match_all(candidates, DEFAULT_CONFIG)
    by_id = {c.id: c for c in candidates}

    results = await asyncio.gather(
        matching_flow.persist_pairs(pairs, by_id, run_id),
        matching_flow.persist_pairs(pairs, by_id, run_id),
    )
    assert sorted(r[0] for r in results) == [0, 1]
    assert await conn.fetchval("SELECT count(*) FROM gold_reconciliation_pairs") == 1


async def test_amount_mismatch_raises_discrepancy_on_pair(conn, app_db):
    await _clear(conn)
    t0 = datetime.now(UTC) - timedelta(hours=1)
    await _silver(conn, psp="paystack", tx_type="credit", amount="100000", initiated_at=t0, name="Bola Ade")
    await _silver(
        conn,
        psp="flutterwave",
        tx_type="debit",
        amount="98500",
        initiated_at=t0 + timedelta(minutes=5),
        name="Bola Ade",
    )
    run_id = await _run(conn)
    candidates = await matching_flow.fetch_match_candidates(timedelta(days=14))
    pairs = matching_flow.match_all(candidates, DEFAULT_CONFIG)
    written, raised = await matching_flow.persist_pairs(pairs, {c.id: c for c in candidates}, run_id)
    assert (written, raised) == (1, 1)
    row = await conn.fetchrow("SELECT classification::text, severity, estimated_exposure_ngn FROM gold_discrepancies")
    assert row["classification"] == "amount_mismatch"
    assert row["severity"] == "high"
    assert row["estimated_exposure_ngn"] == Decimal("1500")
    assert await conn.fetchval("SELECT status::text FROM gold_reconciliation_pairs") == "discrepancy"


async def test_missing_settlement_raised_once_then_escalated(conn, app_db):
    await _clear(conn)
    now = datetime.now(UTC)
    tx = await _silver(
        conn,
        psp="flutterwave",
        tx_type="debit",
        amount="25000",
        initiated_at=now - timedelta(hours=5),
        status="pending",
        expected_settlement_at=now - timedelta(hours=2),
    )
    run_id = await _run(conn)

    assert await matching_flow.raise_missing_settlements(run_id) == 1
    assert await matching_flow.raise_missing_settlements(run_id) == 0  # idempotent
    assert await conn.fetchval("SELECT severity FROM gold_discrepancies WHERE transaction_id = $1", tx) == "medium"

    # Age the expectation past 48h: the open discrepancy escalates, with an audit event.
    await conn.execute("ALTER TABLE silver_canonical_transactions DISABLE TRIGGER trg_silver_tx_audit")
    await conn.execute(
        "UPDATE silver_canonical_transactions SET expected_settlement_at = $2 WHERE id = $1",
        tx,
        now - timedelta(hours=50),
    )
    await conn.execute("ALTER TABLE silver_canonical_transactions ENABLE TRIGGER trg_silver_tx_audit")
    await matching_flow.raise_missing_settlements(run_id)
    assert await conn.fetchval("SELECT severity FROM gold_discrepancies WHERE transaction_id = $1", tx) == "critical"
    actions = [r["action"] for r in await conn.fetch("SELECT action FROM gold_discrepancy_events ORDER BY id")]
    assert actions == ["raised", "severity_changed"]


# ── Resolve API end to end ─────────────────────────────────────────────────


async def test_resolve_discrepancy_writes_audit_event(conn, app_db, monkeypatch):
    await _clear(conn)
    monkeypatch.setenv("API_AUTH_DISABLED", "true")
    from src.config import get_settings

    get_settings.cache_clear()
    tx = await _silver(conn, psp="paystack", tx_type="credit", amount="5", initiated_at=datetime.now(UTC))
    disc = await conn.fetchval(
        "INSERT INTO gold_discrepancies (transaction_id, classification, confidence_score, evidence) "
        "VALUES ($1, 'missing_settlement', 1, '{}') RETURNING id",
        tx,
    )

    from src.api.main import create_app

    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        url = f"/v1/reconciliation/discrepancies/{disc}/resolve"
        assert (await client.post(url, json={"resolution_note": "short"})).status_code == 422
        ok = await client.post(url, json={"resolution_note": "Confirmed settled in bank statement"})
        assert ok.status_code == 200, ok.text
        again = await client.post(url, json={"resolution_note": "Confirmed settled in bank statement"})
        assert again.status_code == 409
        assert (
            await client.post(
                "/v1/reconciliation/discrepancies/not-a-uuid/resolve",
                json={"resolution_note": "Confirmed settled in bank statement"},
            )
        ).status_code == 422
        events = (await client.get(f"/v1/reconciliation/discrepancies/{disc}/events")).json()["events"]

    assert [e["action"] for e in events] == ["resolved"]
    assert events[0]["actor"] == "dev-unauthenticated"
    assert await conn.fetchval("SELECT status::text FROM gold_discrepancies WHERE id = $1", disc) == "resolved"
