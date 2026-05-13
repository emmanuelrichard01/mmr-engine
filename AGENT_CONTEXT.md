# MMR Engine — AI Agent Progress Context

> **Purpose:** This file provides full context for any AI agent continuing work on this project.
> It documents what has been built, the current state, and what remains.
>
> **Last Updated:** 2026-05-12

---

## Project Identity

- **Name:** Cross-Border Mobile Money Reconciliation Engine
- **Owner:** Emmanuel Richard
- **Type:** Production-grade fintech data engineering system
- **Language:** Python 3.12
- **Framework:** FastAPI + Prefect 3 + dbt + SQLAlchemy async
- **Database:** PostgreSQL 16 (with pgcrypto, pg_trgm, btree_gist, pgaudit extensions)
- **Message Queue:** Redpanda (Kafka-compatible)
- **Object Storage:** MinIO (S3-compatible, Object Lock for compliance)

---

## Documentation (Source of Truth)

All specifications live in `/docs/`. These are the canonical references:

| Document | Purpose |
|----------|---------|
| `Header.md` | Table of contents, reading order, implementation status |
| `PRD.md` | Product requirements, NFRs, user stories |
| `TDD.md` | **Primary implementation guide** — stack, architecture, week-by-week roadmap |
| `ERD.md` | Complete DDL — all tables, enums, indexes, constraints, triggers |
| `DATA ARCHITECTURE.md` | Medallion layers, data flows, PII masking rules |
| `DATA DICTIONARY.md` | Field-level definitions, valid ranges, transformation rules |
| `API SPECIFICATION.md` | All API endpoints, request/response schemas, error codes |
| `DATA GOVERNANCE & SECURITY.md` | Threat model (T-001–T-009), NDPR compliance, access controls |
| `QUALITY ASSURANCE.md` | 10 correctness properties (C-001–C-010), testing strategy |
| `RELEVANCE AND THREAT ASSESSMENT.md` | Competitive landscape, differentiation strategy |
| `GTM_STRATEGY.md` | Data acquisition paths, commercial positioning, demo scripts |

---

## Architecture Pattern

**Medallion Architecture:**
- **Bronze** — Raw immutable webhook payloads stored as Parquet in MinIO
- **Silver** — Canonical normalised transactions in PostgreSQL (PII-masked, FX-normalised)
- **Gold** — Matched reconciliation pairs, discrepancies, CBN reports

**Event Flow:**
```
PSP Webhooks → HMAC validation → Redpanda topics → Bronze (MinIO Parquet)
    → Silver transform (idempotency, PII mask, FX rate) → PostgreSQL
    → Gold matching engine → Reconciliation pairs / Discrepancies
    → CBN daily returns + Alerts
```

---

## Completed Work

### Week 1: Foundation ✅ (53 files)

| Category | Files | Details |
|----------|-------|---------|
| **Scaffolding** | `pyproject.toml`, `alembic.ini`, `.env.example`, `.gitignore`, `Makefile`, `README.md` | All dependencies, dev tools, environment config |
| **Configuration** | `src/config.py` | Pydantic `BaseSettings` with 40+ typed env vars, `@lru_cache` singleton |
| **Docker** | `Dockerfile`, `docker-compose.yml`, `docker-compose.monitoring.yml`, `docker-compose.test.yml` | Multi-stage build (api/worker/migrations/dashboard), 10 services |
| **Init Scripts** | `scripts/init_postgres.sql` | Creates 4 DB roles on first boot |
| **Infra Config** | `infra/prometheus/`, `infra/redpanda/` | Prometheus scrape config + 5 alert rules, Redpanda Console |
| **Migrations** | `alembic/versions/000–012` | 13 migrations: extensions, 13 enums, 14 tables, 1 materialized view, 1 trigger function, 1 SQL function, role permissions, seed data |
| **Observability** | `src/observability/metrics.py`, `src/observability/logging.py` | 13 Prometheus metrics, structlog JSON/console |
| **Storage** | `src/storage/postgres.py` | Role-based async connection pools (pipeline/api/readonly) |
| **API** | `src/api/main.py` | FastAPI factory with `/health`, `/health/ready` (deep), `/metrics`, CORS, exception handler |
| **CI** | `.github/workflows/ci.yml` | Lint → Test (with PG service) → Docker build validation |
| **Stubs** | 13 `__init__.py` files | Package structure for engine, connectors, contracts, flows, alerting, dashboard, tests |

### Week 2: Core Engine ✅ (16 new files, 93+ test cases)

| Category | Files | Details |
|----------|-------|---------|
| **Storage Clients** | `minio_client.py`, `kafka_producer.py`, `kafka_consumer.py` | Parquet R/W, acks=all producer, manual-commit consumer |
| **PSP Connectors** | `base.py`, `paystack.py`, `flutterwave.py` | Abstract base, HMAC-SHA512, secret hash validation |
| **Engine: Idempotency** | `idempotency.py` | Atomic INSERT ON CONFLICT, occurrence tracking |
| **Engine: PII** | `pii.py` | Account, name, BVN, phone, email masking + narration scrub |
| **Engine: FX** | `fx.py` | Rate capture, PIT lookup, NGN conversion with Decimal precision |
| **Engine: Settlement** | `settlement.py` | Expected settlement with business day + WAT cutoff logic |
| **Engine: Normaliser** | `normaliser.py` | Paystack (kobo→NGN) + Flutterwave transforms with PII masking |
| **Tests** | `conftest.py` + 6 test files | 93+ test cases: PII, idempotency, connectors, FX, normaliser, settlement |

### Go-to-Market Tooling ✅ (5 new files)

| Category | Files | Details |
|----------|-------|---------|
| **Polling Clients** | `paystack_polling.py`, `flutterwave_polling.py` | REST API webhook fallback + gap detection |
| **Simulator** | `simulate_webhooks.py` | CLI tool: matched pairs, duplicates, FX variance, batch |
| **Data Generator** | `generate_demo_data.py` | 30-day synthetic Nigerian transaction history |
| **Makefile** | Demo targets | `make demo`, `make webhook-batch`, `make demo-data` |

### Week 3: Pipeline Flows ✅ (11 new files, 29 contract tests)

| Category | Files | Details |
|----------|-------|---------|
| **Bronze Contracts** | `paystack_schema.py`, `flutterwave_schema.py` | Schema-on-read structural validation |
| **Silver Contract** | `canonical_schema.py` | Amount positivity, PII flag, enum enforcement, NUBAN masking check (C-003), FX cross-field validation (C-006) |
| **Ingestion Flow** | `ingestion_flow.py` | Webhook → Idempotency → Kafka publish |
| **Transform Flow** | `transform_flow.py` | Kafka → Bronze Parquet → Normalise → Pandera → Silver PG |
| **FX Capture Flow** | `fx_capture_flow.py` | Scheduled every 30min, retries 3x |
| **Consumer Worker** | `consumer_worker.py` | Kafka consumer → Prefect bridge, dead letter queue |
| **Contract Tests** | `test_bronze_schemas.py`, `test_silver_schema.py` | 36 test cases (incl. NUBAN + FX cross-field) |

---

### Week 4: Gold Layer + Matching Engine ✅ (5 new files, 46 unit tests)

| Category | Files | Details |
|----------|-------|---------|
| **Matching Engine** | `matching.py` | Two-tier: exact primary + probabilistic secondary (trigram, weighted confidence) |
| **Discrepancy Engine** | `discrepancy.py` | 5 classifications: missing settlement, amount mismatch, FX variance, duplicate credit, late settlement |
| **Matching Flow** | `matching_flow.py` | Silver → Gold pipeline: fetch unmatched → match → write pairs → classify discrepancies |
| **Security Scanner** | `security_check.py` | CI prohibited pattern scanner (9 rules) per Data Governance §4 |
| **Matching Tests** | `test_matching.py` | 24 test cases: primary, probabilistic, trigram, weights, pipeline |
| **Discrepancy Tests** | `test_discrepancy.py` | 22 test cases: amounts, missing settlement, FX, duplicates, late |

---

## Remaining Work (Week 6)

### Week 5: API + Alerting + Data Strategy ✅ (10 new files, 18 new tests)

| Category | Files | Details |
|----------|-------|---------|
| **Reconciliation API** | `reconciliation.py` | 5 endpoints: summary, pairs, discrepancies, resolve, exposure |
| **Webhook Routes** | `webhooks.py` | Paystack (HMAC-SHA512), Flutterwave (secret hash), M-Pesa |
| **Auth Middleware** | `auth.py` | SHA-256 key lookup, role-based access, expiry checks |
| **Rate Limiter** | `rate_limit.py` | Token bucket per-key, role-based limits, rate limit headers |
| **Slack Alerting** | `slack.py` | Discrepancy alerts, exposure thresholds, gap detection, audit trail |
| **Polling Backfill** | `polling_backfill_flow.py` | Client onboarding: fetch 30 days history → standard pipeline |
| **Gap Detection** | `gap_detection_flow.py` | 6h scheduled cross-check: webhooks vs PSP API, auto-backfill |
| **Auth Tests** | `test_auth.py` | SHA-256 hashing, public path config |
| **Rate Limit Tests** | `test_rate_limit.py` | Token bucket mechanics, role limits |
| **Docs Cleanup** | `Header.md`, `README.md`, `GTM_STRATEGY.md` | Renamed QUESTIONS.md, refreshed README, updated all doc references |

---

### Week 6: Integration + Polish (NEXT)
- End-to-end integration tests
- DuckDB export pipeline
- CBN daily return generator
- Performance optimisation
- Documentation finalisation

---

## Key Design Decisions (Do Not Change Without Reviewing Docs)

1. **`NUMERIC(20,6)` for all money** — never FLOAT. Exact arithmetic required for financial reconciliation.
2. **`TIMESTAMPTZ` everywhere** — WAT/UTC mix from different PSPs requires timezone-aware storage.
3. **`CHECK (has_pii_masked = TRUE)`** — PII masking is enforced at the database level. Silver writes fail if flag is FALSE.
4. **`ON DELETE RESTRICT` on most FKs** — Financial data is never cascade-deleted.
5. **Separate `silver_idempotency_keys` table** — PK scan on a narrow table is faster than scanning millions of `silver_canonical_transactions`.
6. **Three database roles** — `pipeline` (writes), `api_user` (reads + resolution), `readonly` (dashboards). Never use superuser in app code.
7. **Kafka `acks=all`** — Strongest durability guarantee for financial event streams.
8. **Idempotency key format** — `{psp_name}:{psp_transaction_ref}:{event_type}` — exactly-once semantics.

---

## Database Schema Summary

```
14 tables + 1 materialized view:

System Layer:
  - system_pipeline_runs        (Prefect run registry)
  - system_api_keys             (HMAC-hashed keys)
  - system_alert_events         (outbound alert audit)

Bronze Layer:
  - bronze_ingestion_log        (Parquet file metadata)

Silver Layer:
  - silver_canonical_transactions  ← CORE ENTITY
  - silver_fx_rate_snapshots
  - silver_idempotency_keys
  - silver_psp_settlement_windows
  - silver_transaction_audit_log   (immutable, trigger-maintained)

Gold Layer:
  - gold_reconciliation_pairs
  - gold_discrepancies
  - gold_cbn_daily_returns
  - gold_exposure_tracker
  - gold_reconciliation_summary    (materialized view)
```

---

## Environment Setup

```bash
cp .env.example .env           # Configure credentials
make up                        # Start 10-service Docker graph
make migrate                   # Run 13 Alembic migrations
make smoke                     # Verify all services healthy
```

---

## How to Continue Work

1. Read `/docs/TDD.md` §19 for the week-by-week roadmap
2. Check the "Remaining Work" section above for current status
3. Follow existing patterns: typed config in `src/config.py`, async sessions from `src/storage/postgres.py`, structlog for all logging
4. All new tables/enums must go through Alembic migrations
5. Write tests in `tests/unit/` for pure logic, `tests/integration/` for DB/Kafka interactions
