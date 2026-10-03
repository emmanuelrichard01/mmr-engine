# tests/integration/test_api_endpoints.py
"""
Read/write API endpoints against real PostgreSQL: transaction explorer,
pair inspector, exposure aging, bulk resolve, pipeline runs, search, trend.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest

from src.engine.matching import DEFAULT_CONFIG
from src.flows import matching_flow
from tests.integration.test_database import _clear, _run, _silver

pytestmark = pytest.mark.db


@pytest.fixture
async def client(app_db, monkeypatch):
    monkeypatch.setenv("API_AUTH_DISABLED", "true")
    from src.config import get_settings

    get_settings.cache_clear()
    from src.api.main import create_app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()), base_url="http://test") as c:
        yield c


@pytest.fixture
async def seeded(conn, app_db):
    """Two matched legs, one amount-mismatch pair, one lonely credit."""
    await _clear(conn)
    t0 = datetime.now(UTC) - timedelta(hours=2)
    a = await _silver(conn, psp="paystack", tx_type="credit", amount="50000", initiated_at=t0, name="Ada Eze")
    b = await _silver(
        conn, psp="flutterwave", tx_type="debit", amount="50000", initiated_at=t0 + timedelta(minutes=2), name="Ada Eze"
    )
    c = await _silver(conn, psp="paystack", tx_type="credit", amount="100000", initiated_at=t0, name="Bola Ade")
    d = await _silver(
        conn,
        psp="flutterwave",
        tx_type="debit",
        amount="98500",
        initiated_at=t0 + timedelta(minutes=5),
        name="Bola Ade",
    )
    lonely = await _silver(conn, psp="paystack", tx_type="credit", amount="777", initiated_at=t0)
    run_id = await _run(conn)
    candidates = await matching_flow.fetch_match_candidates(timedelta(days=14))
    pairs = matching_flow.match_all(candidates, DEFAULT_CONFIG)
    await matching_flow.persist_pairs(pairs, {x.id: x for x in candidates}, run_id)
    await conn.execute(
        "UPDATE system_pipeline_runs SET status = 'completed', completed_at = NOW(), records_processed = 5 WHERE id = $1",
        run_id,
    )
    return {"a": a, "b": b, "c": c, "d": d, "lonely": lonely}


async def test_transaction_list_filters_and_totals(client, seeded):
    body = (await client.get("/v1/reconciliation/transactions?limit=2")).json()
    assert body["total"] == 5
    assert len(body["transactions"]) == 2

    unmatched = (await client.get("/v1/reconciliation/transactions?match_status=unmatched")).json()
    assert [t["id"] for t in unmatched["transactions"]] == [str(seeded["lonely"])]
    assert unmatched["transactions"][0]["amount_ngn"] == "777.00"

    by_psp = (await client.get("/v1/reconciliation/transactions?psp_name=flutterwave")).json()
    assert {t["psp_name"] for t in by_psp["transactions"]} == {"flutterwave"}

    by_id = (await client.get(f"/v1/reconciliation/transactions?q={seeded['a']}")).json()
    assert by_id["total"] == 1 and by_id["transactions"][0]["match_status"] == "matched"


async def test_transaction_ref_prefix_is_literal(client, seeded):
    # "%" must not act as a wildcard.
    assert (await client.get("/v1/reconciliation/transactions?q=%25")).json()["total"] == 0
    assert (await client.get("/v1/reconciliation/transactions?q=REF")).json()["total"] == 5


async def test_transaction_detail_has_counterpart_and_lineage(client, seeded):
    body = (await client.get(f"/v1/reconciliation/transactions/{seeded['a']}")).json()
    assert body["pair"]["counterpart"]["id"] == str(seeded["b"])
    assert body["pair"]["match_strategy"] == "exact_primary"
    assert body["lineage"]["kafka_topic"] == "test"
    assert body["transaction"]["idempotency_key"].startswith("paystack:")
    assert (await client.get(f"/v1/reconciliation/transactions/{uuid4()}")).status_code == 404


async def test_pair_detail_and_discrepancy(client, seeded):
    detail = (await client.get(f"/v1/reconciliation/transactions/{seeded['c']}")).json()
    pair_id = detail["pair"]["id"]
    body = (await client.get(f"/v1/reconciliation/pairs/{pair_id}")).json()
    assert {body["a"]["id"], body["b"]["id"]} == {str(seeded["c"]), str(seeded["d"])}
    assert body["pair"]["amount_delta_ngn"] == "1500.00"
    assert [d["discrepancy_type"] for d in body["discrepancies"]] == ["amount_mismatch"]
    assert {"amount_score", "time_score", "name_score", "bank_score"} <= set(body["pair"]["match_evidence"])


async def test_exposure_aging(client, seeded):
    body = (await client.get("/v1/reconciliation/exposure/aging")).json()
    assert [b["bucket"] for b in body["buckets"]] == ["0-1d", "1-3d", "3-7d", "7d+"]
    assert body["buckets"][0] == {"bucket": "0-1d", "count": 1, "exposure_ngn": "1500.00"}
    assert sum(Decimal(b["exposure_ngn"]) for b in body["buckets"]) == Decimal("1500.00")


async def test_bulk_resolve(client, conn, seeded):
    disc = await conn.fetchval("SELECT id FROM gold_discrepancies")
    unknown = uuid4()
    payload = {"ids": [str(disc), str(unknown)], "resolution_note": "Confirmed via settlement report"}
    first = (await client.post("/v1/reconciliation/discrepancies/bulk-resolve", json=payload)).json()
    assert first == {"resolved": [str(disc)], "skipped": [{"id": str(unknown), "reason": "not_found"}]}
    again = (await client.post("/v1/reconciliation/discrepancies/bulk-resolve", json=payload)).json()
    assert {s["reason"] for s in again["skipped"]} == {"not_found", "already_closed"}
    actions = [r["action"] for r in await conn.fetch("SELECT action FROM gold_discrepancy_events ORDER BY id")]
    assert actions == ["raised", "resolved"]
    too_many = {"ids": [str(uuid4()) for _ in range(101)], "resolution_note": "Confirmed via settlement report"}
    assert (await client.post("/v1/reconciliation/discrepancies/bulk-resolve", json=too_many)).status_code == 422


async def test_pipeline_runs(client, seeded):
    runs = (await client.get("/v1/system/pipeline-runs?limit=5")).json()["runs"]
    assert runs and {r["status"] for r in runs} <= {"running", "completed", "failed", "cancelled"}
    assert any(r["status"] == "completed" and r["records_processed"] == 5 for r in runs)


async def test_search(client, conn, seeded):
    disc = await conn.fetchval("SELECT id FROM gold_discrepancies")
    by_id = (await client.get(f"/v1/search?q={disc}")).json()["results"]
    assert by_id[0]["kind"] == "discrepancy" and by_id[0]["id"] == str(disc)
    by_ref = (await client.get("/v1/search?q=REF")).json()["results"]
    assert len(by_ref) == 5 and {r["kind"] for r in by_ref} == {"transaction"}
    assert (await client.get("/v1/search?q=ab")).status_code == 422


async def test_trend_has_volume_and_raised(client, seeded):
    days = (await client.get("/v1/reconciliation/trend?days=2")).json()["days"]
    assert len(days) == 2
    assert sum(d["discrepancies_raised"] for d in days) == 1
    assert sum(Decimal(d["volume_ngn"]) for d in days) == Decimal("299277.00")
