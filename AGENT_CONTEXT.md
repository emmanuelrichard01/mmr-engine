# MMR Engine — AI Agent Progress Context

> **Purpose:** This file provides full context for any AI agent continuing work on this project.
> It documents what has been built, the current state, and what remains.
>
> **Last Updated:** 2026-05-20

---

## Project Identity

- **Name:** Cross-Border Mobile Money Reconciliation Engine
- **Owner:** Emmanuel Richard (`emmanuelrichard01`)
- **Type:** Production-grade fintech data engineering system + executive dashboard
- **Backend:** Python 3.12 — FastAPI + Prefect 3 + dbt + SQLAlchemy async
- **Dashboard:** Next.js 15 + React 19 + TypeScript + Tailwind CSS v4 + Recharts
- **Database:** PostgreSQL 16 (with pgcrypto, pg_trgm, btree_gist, pgaudit extensions)
- **Message Queue:** Redpanda (Kafka-compatible)
- **Object Storage:** MinIO (S3-compatible, Object Lock for compliance)
- **Monitoring:** Prometheus + Grafana (9-panel dashboard)

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
| `CDA.md` | **Credential & Deployment Architecture** — 3 deployment models (A/B/C), migration paths, trust model |
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
    → CBN daily returns + Alerts → Dashboard + Grafana
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
| **Observability** | `src/observability/metrics.py`, `src/observability/logging.py` | 23 Prometheus metrics (webhooks, pipeline, matching, financial state, API, alerting, operational health), structlog JSON/console |
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
| **Makefile** | Demo targets | `make demo`, `make webhook-batch`, `make demo-data`, `make demo-investor` |

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

### Week 4: Gold Layer + Matching Engine ✅ (5 new files, 46 unit tests)

| Category | Files | Details |
|----------|-------|---------|
| **Matching Engine** | `matching.py` | Two-tier: exact primary + probabilistic secondary (trigram, weighted confidence) |
| **Discrepancy Engine** | `discrepancy.py` | 5 classifications: missing settlement, amount mismatch, FX variance, duplicate credit, late settlement |
| **Matching Flow** | `matching_flow.py` | Silver → Gold pipeline: fetch unmatched → match → write pairs → classify discrepancies |
| **Security Scanner** | `security_check.py` | CI prohibited pattern scanner (9 rules) per Data Governance §4 |
| **Matching Tests** | `test_matching.py` | 24 test cases: primary, probabilistic, trigram, weights, pipeline |
| **Discrepancy Tests** | `test_discrepancy.py` | 22 test cases: amounts, missing settlement, FX, duplicates, late |

### Week 5: API + Alerting ✅ (10 new files, 18 new tests)

| Category | Files | Details |
|----------|-------|---------|
| **Reconciliation API** | `reconciliation.py` | 5 endpoints: summary, pairs, discrepancies, resolve, exposure |
| **Webhook Routes** | `webhooks.py` | Paystack (HMAC-SHA512), Flutterwave (secret hash), M-Pesa |
| **Auth Middleware** | `auth.py` | SHA-256 key lookup, role-based access, expiry checks |
| **Rate Limiter** | `rate_limit.py` | Token bucket per-key, role-based limits, rate limit headers |
| **Slack Alerting** | `slack.py` | Discrepancy alerts, exposure thresholds, gap detection, audit trail |
| **Polling Backfill** | `polling_backfill_flow.py` | Client onboarding: fetch 30 days history → standard pipeline |
| **Gap Detection** | `gap_detection_flow.py` | 6h scheduled cross-check: webhooks vs PSP API, auto-backfill |
| **Onboarding API** | `onboarding.py` | 5 endpoints: profile, validate-psp, connect-psp, backfill, status |
| **CBN Report Engine** | `cbn_report.py` | Daily return generator, suspicious pattern detection, CSV/JSON export |
| **CBN Tests** | `test_cbn_report.py` | 11 tests (all passing): metrics, PSP breakdown, cross-border, export |

### Week 6: Dashboard + Onboarding + Integration + Polish ✅ (30+ files)

| Category | Files | Details |
|----------|-------|---------|
| **API Wiring** | `main.py` (modified) | Registered all 4 route modules (`reconciliation`, `webhooks`, `onboarding`, `reports`), auth + rate-limit middleware |
| **CORS Fix** | `config.py`, `.env.example` | Added `http://localhost:3000` (Next.js dashboard) to CORS origins |
| **KPI Fix** | `demo-data.ts` | Restructured `KPISummary` from flat fields to nested `{value, delta, trend}` objects |
| **DB Shutdown** | `main.py` | Added graceful DB connection pool disposal in lifespan shutdown |
| **API Client** | `dashboard/lib/api.ts` (new) | Typed fetch wrapper for all FastAPI endpoints with 10s timeout, error handling |
| **Data Hooks** | `dashboard/lib/hooks.ts` (new) | Custom React hooks with live API → demo data fallback, auto-refresh |
| **Demo Banner** | `dashboard/components/demo-banner.tsx` (new) | Dismissable "Demo Mode" banner + compact Live/Demo indicator |
| **Page Updates** | `page.tsx`, `discrepancies/`, `psp-health/`, `reports/` | All pages use hooks, loading skeletons, demo fallback |
| **Onboarding Layout** | `app/onboarding/layout.tsx` (new) | Standalone layout (no sidebar), centered card design |
| **Stepper Component** | `components/stepper.tsx` (new) | Responsive horizontal/vertical stepper with animated progress line |
| **Onboarding Wizard** | `app/onboarding/page.tsx` (new) | 4-step wizard: Business Profile → Connect PSPs → Import Data → Ready |
| **Pydantic Schemas** | `schemas/reconciliation.py`, `schemas/webhooks.py` (new) | 11 typed response models for API contracts |
| **CBN Reports API** | `routes/reports.py` (new) | `GET /v1/reports/daily`, `GET /v1/reports/daily/{date}` |
| **Integration Tests** | `tests/integration/test_api_routes.py` (new) | 20+ tests: health, reconciliation, webhooks, onboarding, reports |
| **Pipeline Tests** | `tests/integration/test_pipeline_flow.py` (new) | Normalisation, PII masking, matching, discrepancy classification tests |
| **CI Improvements** | `ci.yml` | Added security scanner, contract tests, dashboard build validation job |
| **Dockerfile Cleanup** | `Dockerfile` | Removed stale Streamlit dashboard stage |
| **Makefile** | `Makefile` | Added `security-check`, `test-all`, `help` targets |
| **Dashboard Config** | `.env.local`, `.env.example` (new) | Development environment defaults for Next.js |

---

## Remaining Work

> All core features are implemented. The following are enhancement opportunities:

### Future Enhancements (Not Blocking)
- Guided investor walkthrough overlay (interactive tooltip tour)
- Login page with session-based authentication (currently uses API key in env)
- Per-PSP health API endpoint (currently falls back to demo data)
- Daily summaries aggregation API (not yet exposed via REST)
- Report download endpoint (`GET /v1/reports/daily/{date}/download`)
- Settings page API wiring (currently local state only)

### Documentation Polish
- Update CDA.md: fix repo URL references
- Create condensed client-facing credential document

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
9. **Dark mode with indigo/emerald/amber/rose accents** — Dashboard design decision. Premium, high-contrast for data density.
10. **Option A (Self-Hosted) first** — CDA.md §9: self-hosted is the architectural foundation for all deployment models.

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

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Dashboard (Next.js) | 3000 | http://localhost:3000 |
| FastAPI Gateway | 8000 | http://localhost:8000/docs |
| Grafana | 3001 | http://localhost:3001 |
| Prometheus | 9090 | http://localhost:9090 |
| Prefect Server | 4200 | http://localhost:4200 |
| MinIO Console | 9001 | http://localhost:9001 |
| Redpanda Console | 8080 | http://localhost:8080 |
| Redpanda Kafka | 19092 | localhost:19092 |

---

## Environment Setup

```bash
cp .env.example .env           # Configure credentials
make up                        # Start 10-service Docker graph
make migrate                   # Run 13 Alembic migrations
make smoke                     # Verify all services healthy

# Dashboard (local dev)
cd dashboard && npm install && npm run dev

# Full investor demo
make demo-investor             # All services + Grafana + 30-day data
```

---

## How to Continue Work

1. Read `/docs/TDD.md` §19 for the week-by-week roadmap
2. Read `/docs/CDA.md` for deployment model decisions
3. Check the "Remaining Work" section above for current status
4. Follow existing patterns: typed config in `src/config.py`, async sessions from `src/storage/postgres.py`, structlog for all logging
5. All new tables/enums must go through Alembic migrations
6. Write tests in `tests/unit/` for pure logic, `tests/integration/` for DB/Kafka interactions
7. Dashboard components go in `dashboard/components/`, pages in `dashboard/app/(dashboard)/`
