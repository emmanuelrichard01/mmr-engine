# Architecture

This document describes the system as built. Pre-build design specs live in [archive/](archive/README.md)
and are not authoritative.

## Processes

| Process | Command | Responsibility | Metrics |
|---|---|---|---|
| `api` | `uvicorn src.api.main:app` | Webhook intake, reconciliation/read API, readiness | `:8000/metrics` |
| `consumer_worker` | `python -m src.flows.consumer_worker` | Kafka → Bronze (MinIO) → Silver | `:9101` |
| `scheduler` | `python -m src.flows.scheduler` | Matching (5 min), FX capture (30 min), gap detection (6 h), daily return (02:00 WAT) | `:9102` |
| `migrations` | `alembic upgrade head` | Schema, as the database owner; runs before the services above | — |
| `dashboard` | Next.js | Operations console; calls the API only through its server-side proxy | — |

Every scheduler job is a Prefect flow, so each run appears in the Prefect UI. Every run also writes a
`system_pipeline_runs` row, which all Bronze/Silver/Gold rows reference for lineage.

## Data layers

| Layer | Store | Contents | Mutability |
|---|---|---|---|
| Bronze | MinIO (Parquet) + `bronze_ingestion_log` | Every raw event, keyed by Kafka topic/partition/offset | Append-only |
| Silver | `silver_canonical_transactions` | One row per modelled event: type, `NUMERIC` amounts, NGN conversion with the FX snapshot used, masked display fields, keyed name tokens | Append-only (no app role may `UPDATE`) |
| Gold | `gold_reconciliation_pairs`, `gold_matched_transactions`, `gold_discrepancies`, `gold_discrepancy_events`, `gold_cbn_daily_returns`, `gold_reconciliation_summary` (MV) | Matches, discrepancies and their history, reports | Pairs/discrepancies change state only through audited paths |

## Guarantees and where they are enforced

| Guarantee | Mechanism | Test |
|---|---|---|
| A webhook is never acknowledged unless recorded | Idempotency key + broker ack commit together; any failure → 503 → PSP retries | `test_failed_publish_does_not_register_idempotency_key`, `test_ingest_failure_returns_503_so_psp_retries` |
| An event lands in Silver at most once | `UNIQUE (idempotency_key)` + `ON CONFLICT DO NOTHING` | `test_matching_flow_pairs_and_is_idempotent` |
| A consumed message is never silently skipped | Per-message offset commit only after processing or DLQ publish; DLQ failure → rewind | `tests/unit/test_consumer_worker.py` |
| A transaction is matched at most once, even under concurrency | PK on `gold_matched_transactions.transaction_id`; savepoint per pair | `test_transaction_cannot_be_matched_twice`, `test_concurrent_persist_matches_once` |
| Unknown or failed events never become money movements | `classify_event` allow-list; Flutterwave `data.status` checked | `TestClassifyEvent` |
| Discrepancy history cannot be rewritten | Trigger raises on `UPDATE`/`DELETE`/`TRUNCATE` of `gold_discrepancy_events` (owner included) | `test_audit_tables_are_append_only` |
| The API cannot rewrite money | Column-level grants: API role updates resolution columns only | `test_least_privilege_api_role` |
| Callers without a valid key get nothing | Fail-closed middleware; `ENVIRONMENT` defaults to `production` | `tests/unit/test_auth.py` |
| Migrations are reversible | `downgrade()` for every revision | `test_migrations_round_trip` |

## Failure modes

| Failure | Behaviour |
|---|---|
| Redpanda down | Webhooks return 503; nothing is registered; PSPs retry. Readiness reports `redpanda: unhealthy`. |
| Postgres down during consumption | Transient error: the consumer retries the same offset with exponential backoff (up to 5 attempts), then dead-letters it. |
| Malformed or unprocessable event | Dead-lettered immediately with the original bytes (base64) and the error. |
| Dead-letter topic unavailable | Offset not committed; the consumer rewinds and retries. The partition stalls rather than losing the event. |
| Missed webhook | Gap detection re-polls the PSP; the idempotency key makes re-ingestion of known events a no-op. |
| Non-NGN event with no FX snapshot | A rate captured up to 2 h after the event is accepted; otherwise the event is dead-lettered. It is never converted with a guessed rate. |
| Two matching runs overlap | The database admits one match per transaction; the other run's savepoint rolls back. |
| Slack unreachable | Alert attempt recorded as `failed` in `system_alert_events`; the discrepancy stays un-alerted and is retried next run. |

## Matching

Tier 1 (exact): a different PSP, a complementary type (credit ↔ debit), the identical amount, and within
`MATCHING_PRIMARY_WINDOW_HOURS`. The closest in time wins; an exact tie is left unmatched with
`ambiguous: true`.

Tier 2 (probabilistic): within `MATCHING_SECONDARY_WINDOW_HOURS` and `MATCHING_AMOUNT_TOLERANCE_PCT`,
the score is `0.40·amount + 0.25·time + 0.25·name + 0.10·bank`, and it must reach
`MATCHING_SECONDARY_CONFIDENCE_THRESHOLD` (0.75). The best candidate must beat the runner-up by 0.05,
or the result is ambiguous.

Matched pairs with an amount delta above 0.5% raise `amount_mismatch` (`high` above 1%). They raise
`fx_variance` only when the FX rate movement between the two legs explains the delta to within
0.25 percentage points.

## Security model

- PSP webhooks: Paystack HMAC-SHA512 over the raw body; Flutterwave `verif-hash`. Comparisons are
  constant-time on bytes; empty secrets are rejected at boot.
- API: `X-API-Key` (SHA-256-hashed at rest), scopes → roles (`read` → readonly, `write` → analyst,
  `admin`), per-key/IP token buckets in a bounded LRU.
- Database: migrations run as the owner; three login roles (`pipeline`, `api_user`, `readonly`) with
  table- and column-level grants; there are no blanket default privileges.
- PII: raw payloads stay in Bronze; Silver holds masked display values and keyed name tokens
  ([ADR 0001](adr/0001-pii-tokenization.md)); narrations are regex-scrubbed; logs carry no PII and no
  secrets (the FX key lives in the provider URL and is never logged).
- Dashboard: the browser calls `/api/mmr/*` on the Next.js server, which injects the API key server-side
  and only forwards an allow-list of read/resolve routes.
