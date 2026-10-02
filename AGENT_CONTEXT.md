# MMR Engine — AI Agent Progress Context

> **Purpose:** This file provides full context for any AI agent continuing work on this project.
> It documents what has been built, the current state, and what remains.
>
> **Last Updated:** 2026-06-05

---

## Project Identity

- **Name:** Cross-Border Mobile Money Reconciliation Engine
- **Owner:** Emmanuel Richard (`emmanuelrichard01`)
- **Type:** Production-grade fintech data engineering system + executive dashboard
- **Backend:** Python 3.12 — FastAPI + Prefect 3 + dbt + SQLAlchemy async
- **Dashboard:** Next.js 15 + React 19 + TypeScript + Tailwind CSS v4 + Recharts
- **Database:** PostgreSQL 16 (with pgcrypto, pg_trgm, btree_gist; pgaudit in production only)
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
| `OPERATIONS.md` | **Operations guide** — dashboard pages, data flow, demo mode, scripts, troubleshooting |

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
| **Migrations** | `alembic/versions/000–014` | 15 migrations: extensions, 13 enums, 14 tables, 1 materialized view, 1 trigger function, 1 SQL function, unique constraints, role permissions, seed data |
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

### Week 7: UX Polish + Infrastructure Hardening ✅ (12 new/modified files)

| Category | Files | Details |
|----------|-------|---------|
| **Walkthrough Tour** | `walkthrough.tsx` (new) | Custom SVG spotlight mask, keyboard nav, step progress dots, smooth fade animations — no external dependencies |
| **Welcome Banner** | `welcome-banner.tsx` (new) | First-visit dismissable banner with 3 action cards (Tour, Connect PSPs, Docs) |
| **Page Help** | `page-help.tsx` (new) | Collapsible help panels on Overview, Discrepancies, PSP Health, Reports |
| **Onboarding Polish** | `onboarding/page.tsx` (modified) | Added "Skip to Demo" button, welcome header with 2-minute estimate |
| **Migration 005 Fix** | `005_silver_canonical_transactions.py` | Fixed `GENERATED ALWAYS AS` — removed volatile `NOW()`, now immutable-only |
| **Migration 013** | `013_unique_gold_pairs_constraint.py` (new) | `UNIQUE (transaction_a_id, transaction_b_id)` on gold pairs |
| **Migration 014** | `014_add_severity_and_unique_constraint.py` (new) | `severity` column + `UNIQUE (transaction_id, classification)` on discrepancies |
| **Docker Fixes** | `docker-compose.yml` | MinIO init: removed failing Object Lock; Prefect server: added healthcheck; worker/consumer: `service_healthy` dependency |
| **Dockerfile** | `Dockerfile` | Added `PYTHONPATH=/app`, `PYTHONUNBUFFERED=1`, full `src/` copy for migrations |
| **Operations Guide** | `docs/OPERATIONS.md` (new) | Dashboard page explanations, data flow, demo mode, scripts reference, troubleshooting |
| **Doc Sync** | `ERD.md`, `DATA DICTIONARY.md` | Updated `settlement_sla_breached` definition to match corrected migration |
| **README** | `README.md` | Added OPERATIONS.md to docs table, updated migration count, component list |

### Week 8: Production Hardening ✅ (5 files modified)

| Category | Files | Details |
|----------|-------|---------|
| **Auth Middleware Fix** | `auth.py` | Fixed critical CORS preflight bug — `OPTIONS` requests now bypass auth; added dev mode unauthenticated access for dashboard |
| **Redpanda Init** | `docker-compose.yml` | Added `redpanda_init` service to pre-create all 5 Kafka topics on startup; consumer_worker depends on `service_completed_successfully` |
| **Makefile** | `Makefile` | Added `status`, `logs-errors`, `rebuild`, `clean-data` targets; replaced fixed `sleep` with `pg_isready` polling |
| **OPERATIONS.md** | `docs/OPERATIONS.md` | Added API Authentication section (dev vs prod mode); added 3 new troubleshooting entries (FX 404, Prefect startup, MinIO Object Lock) |
| **Gitignore** | `.gitignore` | Added `scripts/demo_data/`, `*.log`, `logs/`, `.gemini/`, `analysis_results.md` |

### Week 9: Dashboard Overhaul + Investor Demo ✅ (14 new/modified files)

| Category | Files | Details |
|----------|-------|---------|
| **Design System** | `app/globals.css` | Added `color-scheme` declarations, fixed select SVG to use `currentColor`, pipeline animation classes for investor demo |
| **Theme** | `app/layout.tsx` | Inter + JetBrains Mono fonts; ThemeProvider with `data-theme` attribute; dark mode support |
| **Sidebar** | `components/sidebar.tsx` | Brand: "MMR Engine / by Emmanuel Richard"; logout now redirects to `/onboarding`; Investor Demo link with "Live" accent badge; functional collapse |
| **Dashboard Layout** | `app/(dashboard)/layout.tsx` | Removed non-functional search bar; fixed initials `ER`; theme toggle |
| **KPI Card** | `components/kpi-card.tsx` | Fixed SVG gradient ID collision (React `useId()`); replaced Tailwind color classes with CSS custom properties; sparkline dot |
| **Demo Banner** | `components/demo-banner.tsx` | Left-edge accent stripe; gradient background; "Connect live API" CTA link; WifiOff icon in demo mode |
| **PSP Logos** | `components/psp-logos.tsx` | Pre-existing SVG logos confirmed; used across all pages |
| **Investor Demo Page** | `app/(dashboard)/investor/page.tsx` | NEW: 6-section live demo — pipeline simulation state machine (webhook→bronze→silver→gold), live KPIs from real hooks, problem/solution narrative, medallion architecture diagram, tech stack, CTA |
| **Settings Page** | `app/(dashboard)/settings/page.tsx` | Full rewrite: 4 live tabs — PSP Connections (test via /health/ready), API Keys (masked/reveal), Alert Thresholds (localStorage persist), System Health (live /health/ready probe) |
| **Utils** | `lib/utils.ts` | `formatCurrency` overloaded with compact mode: `formatCurrency(amount, true)` → abbreviated |
| **Makefile** | `Makefile` | Full overhaul: non-blocking `make up`, `make doctor`, `make demo-investor`, `make investor-reset`, `make reset`, grouped help with colors |
| **Doctor Script** | `scripts/doctor.py` | Pre-flight check: Docker, Compose, .env, Python, Node.js, ports, required files |
| **Investor Demo Script** | `scripts/investor_demo.py` | 8-step verified pipeline runner with actual DB record count verification and colored output |
| **Postgres Wait Script** | `scripts/wait_for_postgres.py` | Replaces brittle Python one-liner; polls pg_isready with progress dots and timeout |

---

## Remaining Work

> Core features, UX polish, and investor demo are all complete. The following are the remaining enhancement opportunities:

### Phase 2: API Wiring (Remaining)
- Per-PSP health API endpoint (currently falls back to demo data for settlement window)
- Daily summaries aggregation API (not yet exposed via REST — `gold_reconciliation_summary` mat. view exists)
- Report download endpoint (`GET /v1/reports/daily/{date}/download`)
- Settings: team management requires a `users` table and session auth

### Phase 3: Production Hardening
- Login page with session-based authentication (currently uses API key in .env)
- Grafana dashboard JSON provisioning (panels defined but not auto-imported)
- Rate limiting dashboard (expose `system_api_keys.rate_limit_*` metrics)

### Documentation
- Grafana provisioning guide
- Production deployment guide (Option B: managed cloud)

### Documentation Polish ✅
- Update CDA.md: fix repo URL references (Done)
- Correct non-existent `make seed` references (Done)
- Add unique constraints to `ERD.md` and `DATA ARCHITECTURE.md` schemas (Done)
- Fix repository root folder paths in tree diagrams (Done)
- Create OPERATIONS.md with dashboard walkthrough + troubleshooting (Done)
- Sync ERD/Data Dictionary with migration fixes (Done)

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
make doctor                    # Pre-flight: Docker, .env, ports, Python
make up                        # Start 10-service Docker graph (non-blocking)
make migrate                   # Run 15 Alembic migrations (000-014)
make smoke                     # Verify all services healthy

# Dashboard (local dev)
cd dashboard && npm install && npm run dev

# Full investor demo (30 days data, verified pipeline)
make demo-investor             # All services + Grafana + 30-day data + verification

# Clean slate
make investor-reset            # Destroy all data, rebuild, full demo setup
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
