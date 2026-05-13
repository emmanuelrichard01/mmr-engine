# Cross-Border Mobile Money Reconciliation Engine

<p align="center">
  <strong>Real-time payment operations reconciliation — know whether your PSP actually paid you</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.12+-blue?style=flat-square&logo=python" alt="Python 3.12+">
  <img src="https://img.shields.io/badge/FastAPI-0.111+-00C7B7?style=flat-square&logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/Kafka-Redpanda-FF6B35?style=flat-square" alt="Redpanda">
  <img src="https://img.shields.io/badge/Prefect-3.x-024DFD?style=flat-square" alt="Prefect 3">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tests-123_passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/Demo-Synthetic_Data-8B5CF6?style=flat-square" alt="Synthetic Data">
  <img src="https://img.shields.io/badge/Production-Live_PSP_Credentials-10B981?style=flat-square" alt="Live PSP">
</p>

> **Data Notice:** This demo environment uses synthetic transaction data calibrated to real Nigerian fintech patterns — multi-PSP settlement flows, WAT business day windows, NGN/USD/KES cross-border activity, and common discrepancy types. Production deployment connects to live Paystack and Flutterwave merchant accounts via their standard API credentials.

---

## Problem

Every Nigerian business processing payments across multiple PSPs — Paystack, Flutterwave, M-Pesa — has a reconciliation gap. Settlement is asynchronous. Reference IDs are not shared across providers. FX rates shift between initiation and settlement. Webhooks arrive out of order, duplicate, or not at all.

The result: finance teams spend 30–40% of their time on manual reconciliation, with industry error rates of 3–8% of transaction volume. At scale, that's millions of naira in undetected discrepancies monthly.

## Solution

A production-grade reconciliation engine that:

- **Ingests** webhook events and polls PSP APIs with HMAC-authenticated endpoints
- **Normalises** disparate PSP formats into a canonical financial ledger (PII-masked, FX-normalised)
- **Matches** transactions using a two-tier engine (exact primary + probabilistic secondary with trigram similarity)
- **Detects** discrepancies — missing settlements, amount mismatches, FX variance, duplicate credits, late settlements
- **Reports** CBN-compliant daily returns automatically
- **Alerts** on financial exposure exceeding configurable thresholds

**Target: 99.5% match rate · <10s end-to-end latency · exactly-once processing semantics**

---

## Architecture

```
                    ┌─────────────────┐
                    │   PSP Webhooks  │     ┌──────────────┐
                    │ Paystack | FLW  │     │  PSP REST    │
                    │ M-Pesa          │     │  APIs (Poll) │
                    └────────┬────────┘     └──────┬───────┘
                             │ HMAC-validated       │ Scheduled
                    ┌────────▼────────▼────────────┐
                    │     FastAPI Gateway           │──── /health, /metrics
                    │  (Ingestion + Reconciliation) │
                    └────────┬─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │    Redpanda     │  Kafka-compatible
                    │  (Event Queue)  │  acks=all, idempotent
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
     │  Bronze Layer │ │   FX    │ │ Idempotency │
     │ MinIO/Parquet │ │ Engine  │ │   Registry  │
     │  (Immutable)  │ │         │ │             │
     └───────────────┘ └─────────┘ └─────────────┘
              │
     ┌────────▼──────────────────────────────────┐
     │            Silver Layer (PostgreSQL)       │
     │  Canonical Ledger — PII masked, FX-normalised  │
     └────────┬──────────────────────────────────┘
              │
     ┌────────▼──────────────────────────────────┐
     │             Gold Layer (dbt + PG)          │
     │  Matched Pairs │ Discrepancies │ CBN Reports │
     └────────┬──────────────────────────────────┘
              │
     ┌────────▼──────┐  ┌──────────────┐
     │   Prometheus  │  │   Grafana    │
     │   + Alerting  │  │  Dashboards  │
     └───────────────┘  └──────────────┘
```

**Medallion Architecture**: Bronze (raw immutable) → Silver (canonical ACID) → Gold (business logic)

---

## Data Ingestion

Three paths for real-world data — **all production-ready**:

| Path | Mechanism | When Used |
|------|-----------|-----------|
| **Webhooks** (Push) | PSP pushes events to HMAC-authenticated endpoints | Primary: real-time transaction capture |
| **Polling** (Pull) | Scheduled API calls to PSP REST endpoints | Fallback: missed webhooks, historical backfill |
| **Gap Detection** | Cross-check received webhooks vs PSP API records | Safety net: runs every 6h, auto-backfills gaps |

**Client onboarding flow:**
```
Client provides PSP API key → Polling backfill (30 days) →
  Webhooks activated for real-time → Gap detection every 6h
```

---

## Tech Stack

| Category | Technology | Why |
|----------|-----------|-----|
| **API** | FastAPI 0.111+ | Async-native, OpenAPI auto-gen, DI |
| **Database** | PostgreSQL 16 | ACID, pg_trgm fuzzy matching, pgaudit |
| **Queue** | Redpanda 23.x | Kafka-compatible, 10x lower RAM |
| **Storage** | MinIO | S3-compatible, Object Lock for compliance |
| **Orchestration** | Prefect 3 | Event-driven flows, retry logic |
| **Transforms** | dbt Core 1.8 | Versioned SQL, lineage, built-in tests |
| **Observability** | Prometheus + Grafana | Metrics, alerting, dashboards |
| **Logging** | structlog | JSON in prod, human-readable in dev |

---

## Quick Start

```bash
# 1. Clone and configure
git clone https://github.com/emmanuelrichard/mmr-engine.git
cd mmr-engine
cp .env.example .env    # Edit credentials as needed

# 2. Start all services (PostgreSQL, Redpanda, MinIO, API, Prefect)
make up

# 3. Run database migrations
make migrate

# 4. Verify health
make smoke

# 5. Generate demo data + fire test webhooks (full demo)
make demo
```

## Development Commands

```bash
make up                 # Start core services
make up-monitoring      # Start with Prometheus + Grafana
make down               # Stop all services
make migrate            # Run Alembic migrations
make test               # Full test suite
make test-unit          # Unit tests only
make lint               # Ruff lint check
make format             # Ruff auto-format
make typecheck          # Mypy strict type check
make coverage           # Tests + HTML coverage report
make security-check     # Run CI security scanner
make clean              # Remove containers, volumes, caches
```

## Demo & Simulation

```bash
make demo               # Full demo: services + migrations + data + webhooks
make demo-data          # Generate 30 days of synthetic transaction data
make demo-data-week     # Quick: 7 days of synthetic data
make webhook            # Fire a single matched pair (Paystack + Flutterwave)
make webhook-batch      # Fire 20 mixed webhook scenarios
make webhook-unmatched  # Fire an unmatched event (creates discrepancy)
make webhook-duplicate  # Fire a duplicate event (tests idempotency)
```

---

## Project Structure

```
mmr-engine/
├── src/
│   ├── api/                    # FastAPI — routes, middleware, schemas
│   ├── connectors/             # PSP adapters: webhooks + polling clients
│   │   ├── paystack.py         #   HMAC-SHA512 webhook validation
│   │   ├── flutterwave.py      #   Secret hash webhook validation
│   │   ├── paystack_polling.py #   REST API polling + gap detection
│   │   └── flutterwave_polling.py
│   ├── contracts/              # Pandera schema contracts (Bronze, Silver)
│   ├── engine/                 # Core computation
│   │   ├── matching.py         #   Two-tier reconciliation matching
│   │   ├── discrepancy.py      #   Anomaly classification (5 types)
│   │   ├── fx.py               #   FX rate engine (PIT lookups)
│   │   ├── pii.py              #   PII masking (NUBAN, BVN, names)
│   │   ├── idempotency.py      #   Exactly-once processing
│   │   └── normaliser.py       #   PSP → canonical transforms
│   ├── flows/                  # Prefect orchestration
│   │   ├── ingestion_flow.py   #   Webhook → Kafka → Bronze
│   │   ├── transform_flow.py   #   Bronze → Silver (Pandera validated)
│   │   ├── matching_flow.py    #   Silver → Gold reconciliation
│   │   ├── polling_backfill_flow.py  # Historical data import
│   │   ├── gap_detection_flow.py     # Webhook completeness check
│   │   └── fx_capture_flow.py  #   Scheduled FX rate snapshots
│   ├── storage/                # PostgreSQL, MinIO, Kafka clients
│   ├── observability/          # Prometheus metrics + structlog
│   └── config.py               # Pydantic Settings — all env vars typed
├── alembic/versions/           # 13 database migrations
├── dbt_project/                # Silver → Gold SQL transforms
├── tests/                      # 123+ tests across 6 suites
│   ├── unit/                   #   Matching, discrepancy, PII, FX, connectors
│   ├── contracts/              #   Bronze + Silver Pandera schemas
│   └── integration/            #   Full pipeline with real infra
├── scripts/                    # Tooling
│   ├── security_check.py       #   CI prohibited pattern scanner
│   ├── simulate_webhooks.py    #   Webhook scenario simulator
│   └── generate_demo_data.py   #   Synthetic data generator
├── infra/                      # Prometheus rules, Grafana dashboards
├── docs/                       # 10 specification documents (440KB+)
├── docker-compose.yml          # 10-service stack
├── Dockerfile                  # Multi-stage build
└── Makefile                    # Developer commands
```

---

## Database Schema

**14 tables + 1 materialized view** across the Medallion layers:

| Layer | Table | Purpose |
|-------|-------|---------| 
| System | `system_pipeline_runs` | Prefect flow run registry |
| System | `system_api_keys` | API authentication (SHA-256 hashed) |
| System | `system_alert_events` | Outbound alert audit trail |
| Bronze | `bronze_ingestion_log` | Parquet file metadata registry |
| Silver | `silver_canonical_transactions` | **Core normalised ledger** |
| Silver | `silver_fx_rate_snapshots` | Point-in-time FX rate store |
| Silver | `silver_idempotency_keys` | Deduplication registry |
| Silver | `silver_psp_settlement_windows` | Per-PSP settlement SLA config |
| Silver | `silver_transaction_audit_log` | Immutable state change history |
| Gold | `gold_reconciliation_pairs` | Matched transaction pairs |
| Gold | `gold_discrepancies` | Unmatched / anomalous events |
| Gold | `gold_cbn_daily_returns` | CBN-format report records |
| Gold | `gold_exposure_tracker` | Running open exposure by PSP |
| Gold | `gold_reconciliation_summary` | Aggregated daily summary (mat. view) |

---

## Test Suite

```
123 tests passing across 6 suites:

  contracts/test_bronze_schemas.py   ·····   9 tests  — Bronze structural validation
  contracts/test_silver_schema.py    ····  27 tests  — Silver business rules + PII + FX
  unit/test_matching.py              ····  24 tests  — Two-tier matching engine
  unit/test_discrepancy.py           ····  22 tests  — Discrepancy classification
  unit/test_pii_masking.py           ····  23 tests  — PII masking (NUBAN, BVN, names)
  unit/test_connectors.py            ····  18 tests  — PSP webhook validation
```

## Security & Compliance

- **HMAC-SHA512** webhook signature validation (Paystack)
- **SHA-256** hashed API keys — non-recoverable at rest
- **PII masking** enforced at database level (`CHECK (has_pii_masked = TRUE)`)
- **Role-based DB access** — 4 roles with least-privilege grants
- **Immutable audit trail** — trigger-enforced, no UPDATE/DELETE permitted
- **CI security scanner** — 9 rules checking for disabled TLS, hardcoded secrets, PII in logs
- **NDPR & CBN** regulatory compliance built into the data model

---

## Documentation

10 specification documents (440KB+ of pre-engineering design):

| Document | Purpose |
|----------|---------|
| [PRD](docs/PRD.md) | Product requirements and user stories |
| [Data Architecture](docs/DATA%20ARCHITECTURE.md) | Medallion layers, data flows, PII rules |
| [ERD](docs/ERD.md) | Complete DDL — tables, constraints, triggers |
| [Data Dictionary](docs/DATA%20DICTIONARY.md) | Field-level definitions and valid ranges |
| [TDD](docs/TDD.md) | Full technical design and implementation roadmap |
| [API Specification](docs/API%20SPECIFICATION.md) | All endpoints, schemas, error codes |
| [Data Governance](docs/DATA%20GOVERNANCE%20%26%20SECURITY.md) | Threat model, NDPR compliance, access controls |
| [Quality Assurance](docs/QUALITY%20ASSURANCE.md) | 10 correctness properties, testing strategy |
| [Threat Assessment](docs/RELEVANCE%20AND%20THREAT%20ASSESSMENT.md) | Competitive landscape, differentiation |
| [GTM Strategy](docs/GTM_STRATEGY.md) | Data acquisition, commercial positioning |

---

## License

MIT

---

*Built by Emmanuel Richard — designed for the Nigerian fintech ecosystem.*
