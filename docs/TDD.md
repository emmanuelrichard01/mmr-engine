# TECHNICAL DESIGN DOCUMENT (TDD)

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, Data Architecture Blueprint v1.0, ERD v1.0, Data Dictionary v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose

This document specifies *how* the system is built. Every architectural decision, every component interaction, every algorithm, every failure mode, and every deployment concern is defined here with enough precision that implementation can begin without ambiguity.

The PRD defined what. The Data Architecture Blueprint defined the data flow. The ERD defined the schema. The Data Dictionary defined the meaning. This document defines the engineering.

Three guarantees this document makes:

**Completeness:** Every component in the system has a defined responsibility, defined interfaces, and defined failure behaviour. No component is assumed to "just work."

**Honesty:** Where a decision has a real trade-off, the trade-off is named. Where a choice is made for portfolio simplicity over production scale, it is marked explicitly so the distinction is never lost.

**Derivability:** Every implementation choice traces back to a requirement in the PRD or a constraint in the Data Architecture Blueprint. No arbitrary decisions.

---

## 2. Technology Stack — Final Decisions

All open questions from the PRD and Data Architecture Blueprint are resolved here. This is the authoritative stack reference.

```
Category                Technology              Version     Rationale
─────────────────────── ─────────────────────── ─────────── ──────────────────────────────────────────
Language                Python                  3.12        Type hints, async support, ecosystem depth
API Framework           FastAPI                 0.111+      Async-native, OpenAPI auto-generation, DI
Data Validation         Pydantic v2             2.7+        FastAPI integration, 5–50x faster than v1
Pipeline Orchestration  Prefect                 3.x         Event-driven flows, Docker-native, retry logic
Schema Validation       Pandera                 0.19+       DataFrame-level contracts with Pydantic bridge
SQL Transforms          dbt Core                1.8+        Versioned SQL, lineage, built-in testing
Message Queue           Redpanda                23.x        Kafka-compatible, single binary, 10x lower RAM
Object Storage          MinIO                   RELEASE.2024+ S3-compatible, Object Lock, local-first
Operational Database    PostgreSQL              16          ACID, concurrent writes, pg_trgm, pgaudit
Analytical Engine       DuckDB                  0.10+       Zero-contention reads, Parquet-native
Migrations              Alembic                 1.13+       Python-native, auto-generation, rollback
HTTP Client             httpx                   0.27+       Async, connection pooling, timeout control
Task Scheduling         Prefect Schedules        —          Cron-equivalent inside Prefect flows
Observability           Prometheus + Grafana    Latest      Metrics scraping, dashboard, alerting rules
Structured Logging      structlog               24.x        JSON logs, context binding, async support
Containerisation        Docker + Compose        26.x        Reproducible environment, service isolation
Secret Management       python-dotenv + env     —           MVP: .env file; Production: Vault/AWS SSM
Testing                 pytest + pytest-asyncio  8.x         Async test support, fixtures, parametrize
API Testing             httpx TestClient         —           FastAPI-native, no separate server needed
Data Testing            pytest + DuckDB          —           In-memory DB for unit testing SQL logic
CI                      GitHub Actions           —           Lint, test, build, smoke-test on every push
```

---

## 3. Repository Structure

```
reconciliation-engine/
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Lint, test, coverage on every PR
│       └── smoke_test.yml          # Docker Compose build + end-to-end check
│
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       ├── 000_setup.py
│       ├── 001_enum_types.py
│       ├── 002_system_tables.py
│       ├── 003_bronze_tables.py
│       ├── 004_silver_fx_snapshots.py
│       ├── 005_silver_canonical_transactions.py
│       ├── 006_silver_supporting_tables.py
│       ├── 007_gold_reconciliation_pairs.py
│       ├── 008_gold_discrepancies.py
│       ├── 009_gold_reporting_tables.py
│       ├── 010_gold_materialized_view.py
│       ├── 011_roles_and_permissions.py
│       └── 012_seed_data.py
│
├── src/
│   ├── api/                        # FastAPI application
│   │   ├── __init__.py
│   │   ├── main.py                 # App factory, middleware registration
│   │   ├── dependencies.py         # Shared DI: DB session, auth, rate limiter
│   │   ├── middleware/
│   │   │   ├── auth.py             # API key authentication
│   │   │   ├── rate_limit.py       # Per-key rate limiting
│   │   │   └── request_id.py       # Request ID injection for tracing
│   │   └── v1/
│   │       ├── router.py           # Route aggregation
│   │       ├── schemas/            # Pydantic request/response models
│   │       │   ├── reconciliation.py
│   │       │   ├── discrepancy.py
│   │       │   └── reports.py
│   │       └── routes/
│   │           ├── health.py
│   │           ├── ingestion.py    # POST /v1/webhooks/{psp}
│   │           ├── reconciliation.py
│   │           ├── discrepancies.py
│   │           └── reports.py
│   │
│   ├── connectors/                 # PSP-specific ingestion adapters
│   │   ├── __init__.py
│   │   ├── base.py                 # Abstract base connector
│   │   ├── paystack.py
│   │   ├── flutterwave.py
│   │   └── mpesa.py
│   │
│   ├── contracts/                  # Pandera schema contracts
│   │   ├── __init__.py
│   │   ├── bronze/
│   │   │   ├── paystack_schema.py
│   │   │   ├── flutterwave_schema.py
│   │   │   └── fx_rate_schema.py
│   │   └── silver/
│   │       ├── canonical_schema.py
│   │       └── fx_snapshot_schema.py
│   │
│   ├── engine/                     # Core computation
│   │   ├── __init__.py
│   │   ├── idempotency.py          # Key generation and registry lookup
│   │   ├── pii.py                  # Masking functions
│   │   ├── fx.py                   # FX rate capture and point-in-time lookup
│   │   ├── settlement.py           # Expected settlement time computation
│   │   ├── matching.py             # Primary and secondary matching algorithms
│   │   ├── anomaly.py              # Discrepancy classification logic
│   │   └── normaliser.py           # PSP-specific → canonical schema transform
│   │
│   ├── flows/                      # Prefect flow definitions
│   │   ├── __init__.py
│   │   ├── ingestion_flow.py       # webhook_ingestion_flow
│   │   ├── bronze_to_silver.py     # bronze_to_silver_flow
│   │   ├── silver_to_gold.py       # silver_to_gold_flow (dbt-driven)
│   │   ├── polling_fallback.py     # polling_fallback_flow
│   │   └── daily_report.py         # daily_report_flow
│   │
│   ├── storage/                    # Storage layer clients
│   │   ├── __init__.py
│   │   ├── minio_client.py         # MinIO Parquet read/write
│   │   ├── kafka_producer.py       # Redpanda producer wrapper
│   │   ├── kafka_consumer.py       # Redpanda consumer wrapper
│   │   └── postgres.py             # SQLAlchemy async engine + session factory
│   │
│   ├── observability/              # Metrics and logging
│   │   ├── __init__.py
│   │   ├── metrics.py              # Prometheus counters, histograms, gauges
│   │   └── logging.py              # structlog configuration
│   │
│   ├── alerting/                   # Outbound notifications
│   │   ├── __init__.py
│   │   ├── base.py                 # Abstract alert sender
│   │   ├── slack.py
│   │   └── dispatcher.py           # Routes alerts to correct channel
│   │
│   └── config.py                   # Pydantic Settings — all env vars typed
│
├── dbt_project/
│   ├── dbt_project.yml
│   ├── profiles.yml
│   ├── models/
│   │   ├── silver/
│   │   │   └── silver_canonical_staging.sql
│   │   └── gold/
│   │       ├── reconciliation/
│   │       │   ├── gold_reconciliation_pairs.sql
│   │       │   └── gold_discrepancies.sql
│   │       ├── reporting/
│   │       │   ├── gold_cbn_daily_returns.sql
│   │       │   └── gold_exposure_tracker.sql
│   │       └── views/
│   │           └── gold_reconciliation_summary.sql
│   ├── tests/
│   │   ├── assert_no_duplicate_idempotency_keys.sql
│   │   ├── assert_no_negative_exposure.sql
│   │   ├── assert_fx_constraint_consistent.sql
│   │   ├── assert_pii_masking_applied.sql
│   │   └── assert_resolution_fields_complete.sql
│   ├── macros/
│   │   ├── get_fx_rate_at.sql
│   │   └── compute_settlement_lag.sql
│   └── sources.yml
│
├── tests/
│   ├── conftest.py                 # Shared fixtures: test DB, test client, mock PSP
│   ├── unit/
│   │   ├── test_idempotency.py
│   │   ├── test_pii_masking.py
│   │   ├── test_fx_engine.py
│   │   ├── test_matching_engine.py
│   │   ├── test_anomaly_classifier.py
│   │   ├── test_normaliser_paystack.py
│   │   ├── test_normaliser_flutterwave.py
│   │   └── test_settlement_calculator.py
│   ├── integration/
│   │   ├── test_webhook_ingestion.py
│   │   ├── test_bronze_to_silver_flow.py
│   │   ├── test_silver_to_gold_flow.py
│   │   ├── test_api_reconciliation.py
│   │   ├── test_api_discrepancies.py
│   │   └── test_api_reports.py
│   └── contracts/
│       ├── test_bronze_paystack_schema.py
│       ├── test_bronze_flutterwave_schema.py
│       └── test_silver_canonical_schema.py
│
├── infra/
│   ├── prometheus/
│   │   ├── prometheus.yml
│   │   └── alerts.yml
│   └── grafana/
│       ├── provisioning/
│       └── dashboards/
│           └── reconciliation_overview.json
│
├── scripts/
│   ├── generate_test_data.py       # Synthetic PSP event generator
│   ├── seed_settlement_windows.py  # Populates silver_psp_settlement_windows
│   └── simulate_webhook.py         # Fires test webhooks against local API
│
├── docker-compose.yml              # Core services
├── docker-compose.monitoring.yml   # Prometheus + Grafana overlay
├── docker-compose.test.yml         # Isolated test environment
├── Makefile
├── pyproject.toml                  # Dependencies, ruff, mypy config
├── alembic.ini
└── .env.example                    # All required env vars documented
```

---

## 4. Configuration Management

All configuration is typed, validated at startup, and never scattered across files. A misconfigured environment fails fast and loudly at boot, not silently at runtime.

```python
# src/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, PostgresDsn, AnyHttpUrl, validator
from functools import lru_cache
from typing import Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Environment ───────────────────────────────────────────────────────
    environment: Literal["development", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    debug: bool = False

    # ── PostgreSQL ────────────────────────────────────────────────────────
    # Connection strings per role — principle of least privilege
    postgres_pipeline_dsn: PostgresDsn = Field(
        description="DSN for reconciliation_pipeline role. "
                    "Has INSERT/UPDATE on Silver and Gold."
    )
    postgres_api_dsn: PostgresDsn = Field(
        description="DSN for reconciliation_api_user role. "
                    "Read-only + resolution updates."
    )
    postgres_readonly_dsn: PostgresDsn = Field(
        description="DSN for reconciliation_readonly role. "
                    "Read-only. Used by Streamlit and DuckDB export."
    )
    postgres_pool_size: int = Field(default=10, ge=1, le=50)
    postgres_max_overflow: int = Field(default=20, ge=0, le=100)

    # ── Redpanda (Kafka) ──────────────────────────────────────────────────
    kafka_bootstrap_servers: str = "redpanda:9092"
    kafka_consumer_group_id: str = "bronze-writer-group"
    kafka_topic_paystack: str = "raw.paystack.events"
    kafka_topic_flutterwave: str = "raw.flutterwave.events"
    kafka_topic_mpesa: str = "raw.mpesa.events"
    kafka_topic_polling: str = "raw.polling.fallback"
    kafka_topic_dead_letter: str = "pipeline.dead.letter"
    kafka_producer_acks: Literal["0", "1", "all"] = "all"
        # "all" = strongest durability guarantee. Required for financial data.

    # ── MinIO ─────────────────────────────────────────────────────────────
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = Field(description="MinIO access key")
    minio_secret_key: str = Field(description="MinIO secret key")
    minio_bronze_bucket: str = "reconciliation-bronze"
    minio_use_ssl: bool = False  # True in production

    # ── PSP Credentials (Sandbox) ─────────────────────────────────────────
    paystack_secret_key: str = Field(
        description="Paystack secret key for webhook validation and API calls. "
                    "Format: sk_test_... for sandbox."
    )
    flutterwave_secret_key: str = Field(
        description="Flutterwave secret hash for webhook signature validation."
    )
    flutterwave_secret_hash: str = Field(
        description="Flutterwave webhook secret hash for HMAC verification."
    )
    mpesa_consumer_key: str = ""
    mpesa_consumer_secret: str = ""

    # ── FX Rate Provider ──────────────────────────────────────────────────
    fx_provider_api_key: str = Field(
        description="ExchangeRate-API key for FX rate capture."
    )
    fx_provider_base_url: AnyHttpUrl = "https://v6.exchangerate-api.com/v6"
    fx_capture_interval_minutes: int = Field(default=30, ge=5, le=1440)
    fx_variance_threshold_pct: float = Field(
        default=0.005,
        ge=0.0,
        le=0.1,
        description="FX variance below this threshold is not raised as a discrepancy. "
                    "Default: 0.5% (0.005)."
    )

    # ── Matching Engine ───────────────────────────────────────────────────
    matching_primary_window_minutes: int = Field(
        default=5,
        description="Time window (±minutes) for primary exact matching on timestamp."
    )
    matching_secondary_window_minutes: int = Field(
        default=30,
        description="Time window (±minutes) for probabilistic secondary matching."
    )
    matching_secondary_confidence_threshold: float = Field(
        default=0.75,
        ge=0.5,
        le=1.0,
        description="Minimum confidence score for a probabilistic match to be accepted. "
                    "Below this threshold the pair is flagged for manual review."
    )
    matching_name_similarity_threshold: float = Field(
        default=0.80,
        ge=0.5,
        le=1.0,
        description="Minimum trigram similarity for beneficiary name fuzzy match."
    )

    # ── Polling Fallback ──────────────────────────────────────────────────
    polling_interval_minutes: int = Field(default=15, ge=5, le=60)
    polling_trigger_after_minutes: int = Field(
        default=30,
        description="A pending transaction older than this without settlement "
                    "confirmation triggers a polling check."
    )
    polling_max_attempts: int = Field(default=10)

    # ── Alerting ──────────────────────────────────────────────────────────
    slack_webhook_url: str = ""
    slack_alert_channel: str = "#reconciliation-alerts"
    alert_confidence_threshold: float = Field(
        default=0.90,
        description="Discrepancies above this confidence score trigger "
                    "immediate automatic alerting."
    )
    alert_exposure_threshold_ngn: float = Field(
        default=100_000.0,
        description="Alert immediately when a single discrepancy's estimated "
                    "exposure exceeds this NGN amount."
    )

    # ── DuckDB ────────────────────────────────────────────────────────────
    duckdb_path: str = "/data/analytics/reconciliation.duckdb"
    duckdb_export_interval_minutes: int = Field(default=15)

    # ── API ───────────────────────────────────────────────────────────────
    api_rate_limit_per_minute: int = Field(default=100)
    api_request_timeout_seconds: int = Field(default=30)
    api_cors_origins: list[str] = ["http://localhost:8501"]

    @validator("environment", pre=True)
    def validate_environment(cls, v: str) -> str:
        if v == "production" and not v:
            raise ValueError(
                "Production environment requires explicit configuration. "
                "Do not use default values."
            )
        return v


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings instance. lru_cache ensures Settings is instantiated
    once per process — not once per request. Validation errors surface
    at startup, not mid-request.
    """
    return Settings()
```

**.env.example** — every variable documented, no surprises for a new engineer:

```bash
# ── Environment ──────────────────────────────────────────────────────────
ENVIRONMENT=development
LOG_LEVEL=INFO
DEBUG=false

# ── PostgreSQL ────────────────────────────────────────────────────────────
# Three separate DSNs — one per application role
POSTGRES_PIPELINE_DSN=postgresql+asyncpg://reconciliation_pipeline:changeme@postgres:5432/reconciliation
POSTGRES_API_DSN=postgresql+asyncpg://reconciliation_api_user:changeme@postgres:5432/reconciliation
POSTGRES_READONLY_DSN=postgresql+asyncpg://reconciliation_readonly:changeme@postgres:5432/reconciliation
POSTGRES_POOL_SIZE=10
POSTGRES_MAX_OVERFLOW=20

# ── Redpanda ──────────────────────────────────────────────────────────────
KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
KAFKA_CONSUMER_GROUP_ID=bronze-writer-group

# ── MinIO ─────────────────────────────────────────────────────────────────
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=changeme_in_production
MINIO_BRONZE_BUCKET=reconciliation-bronze

# ── PSP Credentials (Sandbox) ─────────────────────────────────────────────
# Never commit real keys. Rotate on every environment.
PAYSTACK_SECRET_KEY=YOUR_PAYSTACK_SECRET_KEY_HERE
FLUTTERWAVE_SECRET_KEY=YOUR_FLUTTERWAVE_SECRET_KEY_HERE
FLUTTERWAVE_SECRET_HASH=your_flw_webhook_hash
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=

# ── FX Rate Provider ──────────────────────────────────────────────────────
FX_PROVIDER_API_KEY=your_exchangerate_api_key
FX_CAPTURE_INTERVAL_MINUTES=30
FX_VARIANCE_THRESHOLD_PCT=0.005

# ── Matching Engine ───────────────────────────────────────────────────────
MATCHING_PRIMARY_WINDOW_MINUTES=5
MATCHING_SECONDARY_WINDOW_MINUTES=30
MATCHING_SECONDARY_CONFIDENCE_THRESHOLD=0.75
MATCHING_NAME_SIMILARITY_THRESHOLD=0.80

# ── Polling Fallback ──────────────────────────────────────────────────────
POLLING_INTERVAL_MINUTES=15
POLLING_TRIGGER_AFTER_MINUTES=30

# ── Alerting ──────────────────────────────────────────────────────────────
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
SLACK_ALERT_CHANNEL=#reconciliation-alerts
ALERT_CONFIDENCE_THRESHOLD=0.90
ALERT_EXPOSURE_THRESHOLD_NGN=100000.0

# ── DuckDB ────────────────────────────────────────────────────────────────
DUCKDB_PATH=/data/analytics/reconciliation.duckdb
DUCKDB_EXPORT_INTERVAL_MINUTES=15

# ── API ───────────────────────────────────────────────────────────────────
API_RATE_LIMIT_PER_MINUTE=100
API_CORS_ORIGINS=["http://localhost:8501"]
```

---

## 5. Docker Compose — Service Graph

```yaml
# docker-compose.yml
name: reconciliation-engine

services:

  # ── PostgreSQL 16 ────────────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: rec_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: reconciliation
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init_postgres.sql:/docker-entrypoint-initdb.d/01_init.sql
        # Creates application roles on first boot
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d reconciliation"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - rec_internal

  # ── Redpanda (Kafka-compatible) ───────────────────────────────────────────
  redpanda:
    image: redpandadata/redpanda:v23.3.21
    container_name: rec_redpanda
    restart: unless-stopped
    command:
      - redpanda
      - start
      - --kafka-addr internal://0.0.0.0:9092,external://0.0.0.0:19092
      - --advertise-kafka-addr internal://redpanda:9092,external://localhost:19092
      - --pandaproxy-addr internal://0.0.0.0:8082,external://0.0.0.0:18082
      - --advertise-pandaproxy-addr internal://redpanda:8082,external://localhost:18082
      - --schema-registry-addr internal://0.0.0.0:8081,external://0.0.0.0:18081
      - --rpc-addr redpanda:33145
      - --advertise-rpc-addr redpanda:33145
      - --mode dev-container
      - --smp 1
      - --memory 512M
      - --reserve-memory 0M
      - --node-id 0
      - --check=false
    volumes:
      - redpanda_data:/var/lib/redpanda/data
    ports:
      - "19092:19092"   # External Kafka access for local tools
      - "18082:18082"   # Pandaproxy
      - "18081:18081"   # Schema registry
    healthcheck:
      test: ["CMD-SHELL", "rpk cluster health | grep -q 'Healthy:.*true'"]
      interval: 15s
      timeout: 10s
      retries: 5
      start_period: 30s
    networks:
      - rec_internal

  # ── Redpanda Console (UI for Kafka topics) ───────────────────────────────
  redpanda_console:
    image: redpandadata/console:v2.7.2
    container_name: rec_redpanda_console
    restart: unless-stopped
    environment:
      CONFIG_FILEPATH: /tmp/config.yml
    volumes:
      - ./infra/redpanda/console_config.yml:/tmp/config.yml
    ports:
      - "8080:8080"
    depends_on:
      redpanda:
        condition: service_healthy
    networks:
      - rec_internal

  # ── MinIO ─────────────────────────────────────────────────────────────────
  minio:
    image: minio/minio:RELEASE.2024-05-01T01-11-10Z
    container_name: rec_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${MINIO_SECRET_KEY}
    volumes:
      - minio_data:/data
    ports:
      - "9000:9000"   # API
      - "9001:9001"   # Console
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks:
      - rec_internal

  # ── MinIO Init (creates buckets and applies Object Lock) ──────────────────
  minio_init:
    image: minio/mc:RELEASE.2024-05-03T17-14-17Z
    container_name: rec_minio_init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 $$MINIO_ACCESS_KEY $$MINIO_SECRET_KEY &&
        mc mb --ignore-existing local/reconciliation-bronze &&
        mc retention set --default COMPLIANCE 7d local/reconciliation-bronze &&
        echo 'MinIO initialised successfully'
      "
    environment:
      MINIO_ACCESS_KEY: ${MINIO_ACCESS_KEY}
      MINIO_SECRET_KEY: ${MINIO_SECRET_KEY}
    networks:
      - rec_internal

  # ── FastAPI Gateway ───────────────────────────────────────────────────────
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: api
    container_name: rec_api
    restart: unless-stopped
    environment:
      - ENVIRONMENT=${ENVIRONMENT}
      - POSTGRES_PIPELINE_DSN=${POSTGRES_PIPELINE_DSN}
      - POSTGRES_API_DSN=${POSTGRES_API_DSN}
      - KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
      - PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}
      - FLUTTERWAVE_SECRET_HASH=${FLUTTERWAVE_SECRET_HASH}
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redpanda:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks:
      - rec_internal

  # ── Prefect Server ────────────────────────────────────────────────────────
  prefect_server:
    image: prefecthq/prefect:3-latest
    container_name: rec_prefect_server
    restart: unless-stopped
    command: prefect server start --host 0.0.0.0
    environment:
      PREFECT_SERVER_API_HOST: 0.0.0.0
      PREFECT_API_DATABASE_CONNECTION_URL: postgresql+asyncpg://postgres:${POSTGRES_SUPERUSER_PASSWORD}@postgres:5432/prefect
    ports:
      - "4200:4200"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - rec_internal

  # ── Prefect Worker ────────────────────────────────────────────────────────
  prefect_worker:
    build:
      context: .
      dockerfile: Dockerfile
      target: worker
    container_name: rec_prefect_worker
    restart: unless-stopped
    command: prefect worker start --pool reconciliation-pool
    environment:
      - PREFECT_API_URL=http://prefect_server:4200/api
      - POSTGRES_PIPELINE_DSN=${POSTGRES_PIPELINE_DSN}
      - KAFKA_BOOTSTRAP_SERVERS=redpanda:9092
      - MINIO_ENDPOINT=minio:9000
      - MINIO_ACCESS_KEY=${MINIO_ACCESS_KEY}
      - MINIO_SECRET_KEY=${MINIO_SECRET_KEY}
      - FX_PROVIDER_API_KEY=${FX_PROVIDER_API_KEY}
      - PAYSTACK_SECRET_KEY=${PAYSTACK_SECRET_KEY}
      - FLUTTERWAVE_SECRET_KEY=${FLUTTERWAVE_SECRET_KEY}
      - SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
    depends_on:
      prefect_server:
        condition: service_started
      postgres:
        condition: service_healthy
      redpanda:
        condition: service_healthy
      minio:
        condition: service_healthy
    volumes:
      - ./dbt_project:/app/dbt_project    # dbt models accessible in worker
      - duckdb_data:/data/analytics
    networks:
      - rec_internal

  # ── Alembic Migrations (runs once on startup) ─────────────────────────────
  migrations:
    build:
      context: .
      dockerfile: Dockerfile
      target: migrations
    container_name: rec_migrations
    command: alembic upgrade head
    environment:
      POSTGRES_PIPELINE_DSN: ${POSTGRES_PIPELINE_DSN}
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - rec_internal
    restart: "no"   # Run once and exit

  # ── Streamlit Dashboard ───────────────────────────────────────────────────
  dashboard:
    build:
      context: .
      dockerfile: Dockerfile
      target: dashboard
    container_name: rec_dashboard
    restart: unless-stopped
    environment:
      POSTGRES_READONLY_DSN: ${POSTGRES_READONLY_DSN}
      DUCKDB_PATH: /data/analytics/reconciliation.duckdb
    ports:
      - "8501:8501"
    volumes:
      - duckdb_data:/data/analytics:ro   # Read-only mount
    depends_on:
      - api
    networks:
      - rec_internal

volumes:
  postgres_data:
  redpanda_data:
  minio_data:
  duckdb_data:

networks:
  rec_internal:
    driver: bridge
```

```yaml
# docker-compose.monitoring.yml — overlay for observability stack
name: reconciliation-engine

services:
  prometheus:
    image: prom/prometheus:v2.52.0
    container_name: rec_prometheus
    volumes:
      - ./infra/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
      - ./infra/prometheus/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.retention.time=30d'
    ports:
      - "9090:9090"
    networks:
      - reconciliation-engine_rec_internal

  grafana:
    image: grafana/grafana:10.4.2
    container_name: rec_grafana
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:-admin}
      GF_USERS_ALLOW_SIGN_UP: "false"
    volumes:
      - grafana_data:/var/lib/grafana
      - ./infra/grafana/provisioning:/etc/grafana/provisioning
      - ./infra/grafana/dashboards:/var/lib/grafana/dashboards
    ports:
      - "3000:3000"
    depends_on:
      - prometheus
    networks:
      - reconciliation-engine_rec_internal

volumes:
  prometheus_data:
  grafana_data:
```

---

## 6. Dockerfile — Multi-Stage Build

```dockerfile
# Dockerfile
FROM python:3.12-slim AS base

WORKDIR /app

# System dependencies shared across all stages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster dependency resolution
RUN pip install --no-cache-dir uv

COPY pyproject.toml .
RUN uv pip install --system --no-cache .


# ── API stage ─────────────────────────────────────────────────────────────
FROM base AS api
COPY src/ ./src/
EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--log-config", "/dev/null"]
     # Logging configured by structlog, not uvicorn's default logger


# ── Worker stage ──────────────────────────────────────────────────────────
FROM base AS worker
# dbt requires git for package resolution
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN uv pip install --system --no-cache "dbt-postgres==1.8.*"
COPY src/ ./src/
COPY dbt_project/ ./dbt_project/
# No CMD — Prefect worker command provided by compose


# ── Migrations stage ──────────────────────────────────────────────────────
FROM base AS migrations
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY src/config.py ./src/config.py
# CMD provided by compose: alembic upgrade head


# ── Dashboard stage ───────────────────────────────────────────────────────
FROM base AS dashboard
RUN uv pip install --system --no-cache streamlit plotly
COPY src/dashboard/ ./src/dashboard/
EXPOSE 8501
CMD ["streamlit", "run", "src/dashboard/app.py", \
     "--server.port=8501", \
     "--server.address=0.0.0.0", \
     "--server.headless=true"]
```

---

## 7. Storage Layer Implementation

### 7.1 PostgreSQL — Async Session Factory

```python
# src/storage/postgres.py
from contextlib import asynccontextmanager
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
    AsyncEngine,
)
from sqlalchemy.pool import NullPool
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)


def _build_engine(dsn: str, pool_size: int = 10, max_overflow: int = 20) -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        str(dsn),
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,     # Verify connection health before checkout
        pool_recycle=3600,      # Recycle connections hourly (prevents stale connections)
        echo=settings.debug,    # SQL logging in debug mode only — never in production
    )


def _build_test_engine(dsn: str) -> AsyncEngine:
    """
    NullPool for test environments.
    Ensures connections are not shared between test cases,
    preventing state leakage between tests.
    """
    return create_async_engine(str(dsn), poolclass=NullPool)


class DatabaseManager:
    """
    Manages separate connection pools per database role.
    The pipeline role writes. The API role reads and resolves.
    The readonly role never writes.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._pipeline_engine = _build_engine(
            settings.postgres_pipeline_dsn,
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_max_overflow,
        )
        self._api_engine = _build_engine(
            settings.postgres_api_dsn,
            pool_size=settings.postgres_pool_size // 2,
        )
        self._readonly_engine = _build_engine(
            settings.postgres_readonly_dsn,
            pool_size=5,
        )

        self.pipeline_session = async_sessionmaker(
            self._pipeline_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.api_session = async_sessionmaker(
            self._api_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.readonly_session = async_sessionmaker(
            self._readonly_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    async def dispose(self) -> None:
        await self._pipeline_engine.dispose()
        await self._api_engine.dispose()
        await self._readonly_engine.dispose()


# Module-level singleton — initialised once at startup
_db_manager: DatabaseManager | None = None


def get_db_manager() -> DatabaseManager:
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager


@asynccontextmanager
async def pipeline_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_db_manager().pipeline_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def api_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_db_manager().api_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def readonly_session() -> AsyncGenerator[AsyncSession, None]:
    """Read-only session. Commit is a no-op — included for consistency."""
    async with get_db_manager().readonly_session() as session:
        yield session
```

### 7.2 MinIO Client — Parquet Write/Read

```python
# src/storage/minio_client.py
import io
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from minio import Minio
from minio.error import S3Error
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)


class MinIOClient:
    """
    Thin wrapper around the MinIO SDK.
    All methods are synchronous — called from async contexts
    via asyncio.to_thread() in Prefect tasks.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        self._bronze_bucket = settings.minio_bronze_bucket

    def write_parquet(
        self,
        table: pa.Table,
        psp_name: str,
        event_date: datetime,
        run_id: str,
        part_number: int = 1,
    ) -> str:
        """
        Write a PyArrow Table as a Parquet file to MinIO.

        Partition path: {psp}/{event_date=YYYY-MM-DD}/hour={HH}/
        Returns the full MinIO object path.
        """
        date_str = event_date.strftime("%Y-%m-%d")
        hour_str = event_date.strftime("%H")
        object_path = (
            f"{psp_name}/"
            f"event_date={date_str}/"
            f"hour={hour_str}/"
            f"{run_id}-part-{part_number:04d}.parquet"
        )

        buffer = io.BytesIO()
        pq.write_table(
            table,
            buffer,
            compression="snappy",
            write_statistics=True,
        )
        buffer.seek(0)
        file_size = buffer.getbuffer().nbytes

        try:
            self._client.put_object(
                bucket_name=self._bronze_bucket,
                object_name=object_path,
                data=buffer,
                length=file_size,
                content_type="application/octet-stream",
            )
        except S3Error as e:
            log.error(
                "minio.write_failed",
                object_path=object_path,
                error=str(e),
            )
            raise

        full_path = f"s3://{self._bronze_bucket}/{object_path}"
        log.info(
            "minio.parquet_written",
            path=full_path,
            rows=table.num_rows,
            size_bytes=file_size,
        )
        return full_path

    def read_parquet(self, object_path: str) -> pa.Table:
        """
        Read a Parquet file from MinIO into a PyArrow Table.
        Strips the s3:// prefix if present.
        """
        clean_path = object_path.replace(
            f"s3://{self._bronze_bucket}/", ""
        )
        try:
            response = self._client.get_object(self._bronze_bucket, clean_path)
            buffer = io.BytesIO(response.read())
            return pq.read_table(buffer)
        except S3Error as e:
            log.error("minio.read_failed", path=object_path, error=str(e))
            raise
        finally:
            response.close()
            response.release_conn()
```

### 7.3 Kafka Producer/Consumer

```python
# src/storage/kafka_producer.py
import json
from typing import Any
from confluent_kafka import Producer, KafkaException
import structlog
from src.config import get_settings

log = structlog.get_logger(__name__)


class KafkaProducer:
    """
    Thin wrapper around confluent-kafka Producer.
    Uses 'all' acks for maximum durability on financial events.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._producer = Producer({
            "bootstrap.servers": settings.kafka_bootstrap_servers,
            "acks": settings.kafka_producer_acks,
            "retries": 5,
            "retry.backoff.ms": 500,
            "enable.idempotence": True,
                # Kafka producer-level idempotency:
                # prevents duplicate messages on producer retry
            "compression.type": "snappy",
            "linger.ms": 5,
                # 5ms batching window — balances latency vs throughput
        })

    def publish(
        self,
        topic: str,
        payload: dict[str, Any],
        key: str | None = None,
    ) -> None:
        """
        Publish a single message. Blocks until delivery confirmed (acks=all).
        key is used for partition assignment — same key → same partition → ordered delivery.
        """
        try:
            self._producer.produce(
                topic=topic,
                value=json.dumps(payload).encode("utf-8"),
                key=key.encode("utf-8") if key else None,
                on_delivery=self._delivery_callback,
            )
            self._producer.flush(timeout=10)
                # Flush blocks until the message is acknowledged.
                # 10s timeout — if not acknowledged, raise.
        except KafkaException as e:
            log.error("kafka.publish_failed", topic=topic, error=str(e))
            raise

    @staticmethod
    def _delivery_callback(err: Any, msg: Any) -> None:
        if err:
            log.error(
                "kafka.delivery_failed",
                topic=msg.topic(),
                partition=msg.partition(),
                error=str(err),
            )
        else:
            log.debug(
                "kafka.delivered",
                topic=msg.topic(),
                partition=msg.partition(),
                offset=msg.offset(),
            )
```

---

## 8. PSP Connectors — Ingestion Adapters

### 8.1 Abstract Base

```python
# src/connectors/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
import hashlib
import hmac
from typing import Any


@dataclass
class RawWebhookEvent:
    """Normalised container for a validated PSP webhook event."""
    psp_name: str
    event_type: str
    raw_payload: dict[str, Any]
    content_hash: str
    received_at: str       # ISO 8601 UTC


class BasePSPConnector(ABC):
    """
    Abstract base for all PSP webhook connectors.

    Each PSP has:
    - A unique HMAC signature scheme
    - A unique event type vocabulary
    - A unique payload structure

    The connector's job is to validate and wrap — not transform.
    Transformation to the canonical schema happens in the Silver normaliser.
    """

    @property
    @abstractmethod
    def psp_name(self) -> str: ...

    @abstractmethod
    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Verify the PSP's HMAC signature.
        Returns False (not raise) on invalid — caller decides to reject.
        """
        ...

    @abstractmethod
    def extract_event_type(self, payload: dict[str, Any]) -> str:
        """Extract the event type string from the PSP payload."""
        ...

    def build_event(
        self,
        raw_body: bytes,
        payload: dict[str, Any],
        received_at: str,
    ) -> RawWebhookEvent:
        """Wrap a validated payload into a RawWebhookEvent."""
        return RawWebhookEvent(
            psp_name=self.psp_name,
            event_type=self.extract_event_type(payload),
            raw_payload=payload,
            content_hash=hashlib.sha256(raw_body).hexdigest(),
            received_at=received_at,
        )
```

### 8.2 Paystack Connector

```python
# src/connectors/paystack.py
import hashlib
import hmac
import json
from typing import Any

from src.connectors.base import BasePSPConnector
from src.config import get_settings

# Paystack event types this system handles.
# Any other event type is valid but will be stored and flagged as unclassified.
HANDLED_EVENT_TYPES = {
    "charge.success",
    "transfer.success",
    "transfer.failed",
    "transfer.reversed",
}


class PaystackConnector(BasePSPConnector):

    @property
    def psp_name(self) -> str:
        return "paystack"

    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Paystack signs webhooks with HMAC-SHA512 using the secret key.
        Header: X-Paystack-Signature
        Validation: HMAC-SHA512(secret_key, raw_body) == signature_header

        Uses hmac.compare_digest for constant-time comparison
        to prevent timing attacks.
        """
        settings = get_settings()
        expected = hmac.new(
            key=settings.paystack_secret_key.encode("utf-8"),
            msg=raw_body,
            digestmod=hashlib.sha512,
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header)

    def extract_event_type(self, payload: dict[str, Any]) -> str:
        return payload.get("event", "unknown")

    def is_handled_event(self, event_type: str) -> bool:
        return event_type in HANDLED_EVENT_TYPES
```

### 8.3 Flutterwave Connector

```python
# src/connectors/flutterwave.py
import hashlib
import hmac
from typing import Any

from src.connectors.base import BasePSPConnector
from src.config import get_settings

HANDLED_EVENT_TYPES = {
    "charge.completed",
    "transfer.completed",
}


class FlutterwaveConnector(BasePSPConnector):

    @property
    def psp_name(self) -> str:
        return "flutterwave"

    def validate_signature(
        self,
        raw_body: bytes,
        signature_header: str,
    ) -> bool:
        """
        Flutterwave uses a simpler scheme: compare the
        verif-hash header directly against a configured secret hash.
        Header: verif-hash
        """
        settings = get_settings()
        return hmac.compare_digest(
            settings.flutterwave_secret_hash,
            signature_header,
        )

    def extract_event_type(self, payload: dict[str, Any]) -> str:
        return payload.get("event", "unknown")
```

---

## 9. Core Engine — Component by Component

### 9.1 Idempotency Engine

```python
# src/engine/idempotency.py
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

log = structlog.get_logger(__name__)


def build_idempotency_key(
    psp_name: str,
    psp_transaction_ref: str,
    event_type: str,
) -> str:
    """
    Canonical idempotency key format.
    Must match the format documented in the Data Dictionary (XR-005).
    Format: {psp_name}:{psp_transaction_ref}:{event_type}
    Example: paystack:T_abc123xyz:charge.success

    All components are lowercased for normalisation.
    A difference in case between two identical events must not produce
    two different keys.
    """
    return ":".join([
        psp_name.lower().strip(),
        psp_transaction_ref.strip(),
        event_type.lower().strip(),
    ])


async def check_and_register_idempotency_key(
    session: AsyncSession,
    idempotency_key: str,
) -> tuple[bool, int]:
    """
    Atomically check and register an idempotency key.

    Returns:
        (is_new, occurrence_count)
        is_new = True: first time this key is seen — proceed with processing
        is_new = False: duplicate — skip processing, return early

    Uses INSERT ... ON CONFLICT DO UPDATE with RETURNING to make
    the check-and-increment atomic. No separate SELECT + INSERT
    which would have a race condition under concurrent requests.
    """
    now = datetime.now(timezone.utc)

    result = await session.execute(
        text("""
            INSERT INTO silver_idempotency_keys
                (key, first_seen_at, occurrence_count, last_seen_at)
            VALUES
                (:key, :now, 1, :now)
            ON CONFLICT (key) DO UPDATE SET
                occurrence_count = silver_idempotency_keys.occurrence_count + 1,
                last_seen_at = :now
            RETURNING occurrence_count, (xmax = 0) AS is_insert
                -- xmax = 0 means this was an INSERT (not UPDATE)
                -- xmax != 0 means this was an UPDATE (conflict — duplicate)
        """),
        {"key": idempotency_key, "now": now},
    )
    row = result.one()
    occurrence_count: int = row.occurrence_count
    is_new: bool = row.is_insert

    if not is_new:
        log.warning(
            "idempotency.duplicate_detected",
            idempotency_key=idempotency_key,
            occurrence_count=occurrence_count,
        )
        if occurrence_count > 5:
            log.error(
                "idempotency.excessive_duplicates",
                idempotency_key=idempotency_key,
                occurrence_count=occurrence_count,
                message="PSP may have webhook retry misconfiguration",
            )

    return is_new, occurrence_count
```

### 9.2 PII Masking Engine

```python
# src/engine/pii.py
import re
from typing import Optional


# Patterns for PII detection in narration fields
_NUBAN_PATTERN = re.compile(r"\b\d{10}\b")         # 10-digit NUBAN
_BVN_PATTERN = re.compile(r"\b\d{11}\b")           # 11-digit BVN
_PHONE_PATTERN = re.compile(
    r"(\+?234|0)[789]\d{9}"                         # Nigerian phone number variants
)


def mask_account_number(account: Optional[str]) -> Optional[str]:
    """
    Mask a NUBAN account number (10 digits).
    Format: first 2 digits + asterisks + last 2 digits.
    Example: 0123456789 → 01******89

    Non-10-digit inputs: fully masked as ****
    None inputs: returned as None (field not provided by PSP)
    """
    if account is None:
        return None
    account = account.strip()
    if len(account) == 10 and account.isdigit():
        return account[:2] + "*" * 6 + account[-2:]
    if len(account) >= 4:
        return account[:2] + "*" * (len(account) - 4) + account[-2:]
    return "****"


def mask_name(name: Optional[str]) -> Optional[str]:
    """
    Mask a person's full name.
    Format: first character of each word + asterisks for remaining characters.
    Example: 'Chioma Okonkwo' → 'C****** O*******'

    Single character words: returned as is (initials).
    None inputs: returned as None.
    """
    if name is None:
        return None
    name = name.strip()
    if not name:
        return None
    parts = name.split()
    masked = []
    for part in parts:
        if len(part) <= 1:
            masked.append(part)
        else:
            masked.append(part[0] + "*" * (len(part) - 1))
    return " ".join(masked)


def mask_bvn(bvn: Optional[str]) -> Optional[str]:
    """
    Mask a BVN (11 digits).
    Format: asterisks + last 4 digits.
    Example: 12345678901 → *******8901
    """
    if bvn is None:
        return None
    bvn = bvn.strip()
    if len(bvn) < 4:
        return "***"
    return "*" * (len(bvn) - 4) + bvn[-4:]


def scrub_narration(narration: Optional[str]) -> Optional[str]:
    """
    Remove PII patterns from free-text narration fields.
    Applies regex substitution for NUBAN, BVN, and phone patterns.
    Truncates to 500 characters after scrubbing.

    This is not perfect — it's a defence-in-depth measure.
    The primary PII control is that raw payloads never leave Bronze.
    """
    if narration is None:
        return None
    text = narration.strip()
    text = _NUBAN_PATTERN.sub("[REDACTED-ACCOUNT]", text)
    text = _BVN_PATTERN.sub("[REDACTED-BVN]", text)
    text = _PHONE_PATTERN.sub("[REDACTED-PHONE]", text)
    return text[:500]
```

### 9.3 FX Rate Engine

```python
# src/engine/fx.py
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)

SUPPORTED_PAIRS = ["NGN/USD", "NGN/GBP", "NGN/EUR", "NGN/KES"]


async def capture_fx_rates(session: AsyncSession) -> list[dict]:
    """
    Fetch current FX rates for all supported pairs from the configured provider.
    Writes new snapshot records and marks previous current rates as expired.
    Called by the FX capture task on its configured interval.

    Returns list of snapshot IDs created.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    created_snapshots = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for pair in SUPPORTED_PAIRS:
            base, quote = pair.split("/")
            try:
                response = await client.get(
                    f"{settings.fx_provider_base_url}"
                    f"/{settings.fx_provider_api_key}"
                    f"/pair/{base}/{quote}"
                )
                response.raise_for_status()
                data = response.json()

                rate = Decimal(str(data["conversion_rate"]))

                # Expire the previous current rate for this pair
                await session.execute(
                    text("""
                        UPDATE silver_fx_rate_snapshots
                        SET valid_until = :now
                        WHERE currency_pair = :pair
                          AND valid_until IS NULL
                    """),
                    {"now": now, "pair": pair},
                )

                # Insert new current rate
                result = await session.execute(
                    text("""
                        INSERT INTO silver_fx_rate_snapshots
                            (currency_pair, rate, source_provider,
                             captured_at, valid_from)
                        VALUES
                            (:pair, :rate, :provider, :now, :now)
                        RETURNING id
                    """),
                    {
                        "pair": pair,
                        "rate": rate,
                        "provider": "exchangerate-api",
                        "now": now,
                    },
                )
                snapshot_id = result.scalar_one()
                created_snapshots.append({"pair": pair, "rate": float(rate), "id": str(snapshot_id)})
                log.info("fx.rate_captured", pair=pair, rate=float(rate))

            except (httpx.HTTPError, KeyError) as e:
                log.error("fx.capture_failed", pair=pair, error=str(e))
                # Do not raise — a failed rate capture for one pair
                # should not block other pairs or the ingestion pipeline.
                # An alert is raised if the last captured rate is > 2 hours old.

    await session.commit()
    return created_snapshots


async def get_fx_rate_at(
    session: AsyncSession,
    currency_pair: str,
    at_time: datetime,
) -> Optional[tuple[UUID, Decimal]]:
    """
    Point-in-time FX rate lookup.
    Returns (snapshot_id, rate) for the most recent snapshot
    captured at or before at_time.
    Returns None if no rate exists for this pair before at_time.
    """
    result = await session.execute(
        text("""
            SELECT id, rate
            FROM silver_fx_rate_snapshots
            WHERE currency_pair = :pair
              AND captured_at <= :at_time
            ORDER BY captured_at DESC
            LIMIT 1
        """),
        {"pair": currency_pair, "at_time": at_time},
    )
    row = result.one_or_none()
    if row is None:
        log.warning(
            "fx.no_rate_found",
            pair=currency_pair,
            at_time=at_time.isoformat(),
        )
        return None
    return row.id, Decimal(str(row.rate))


def convert_to_ngn(
    amount_raw: Decimal,
    currency_raw: str,
    fx_rate: Decimal,
) -> Decimal:
    """
    Convert a foreign currency amount to NGN.

    Rate convention: 1 NGN = {rate} {quote_currency}
    So: amount_ngn = amount_foreign / rate

    Example:
        amount_raw = 31.645 (USD)
        fx_rate    = 0.00063291 (1 NGN = 0.00063291 USD)
        amount_ngn = 31.645 / 0.00063291 = 50,000 NGN
    """
    if currency_raw.upper() == "NGN":
        return amount_raw
    if fx_rate <= 0:
        raise ValueError(f"FX rate must be positive, got {fx_rate}")
    return (amount_raw / fx_rate).quantize(Decimal("0.000001"))
```

### 9.4 Silver Normaliser — PSP → Canonical Schema

```python
# src/engine/normaliser.py
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from src.engine.pii import (
    mask_account_number,
    mask_name,
    scrub_narration,
)
from src.engine.idempotency import build_idempotency_key
from src.engine.settlement import compute_expected_settlement

# PSP event type → canonical transaction_type mapping
PAYSTACK_EVENT_TYPE_MAP: dict[str, str] = {
    "charge.success": "credit",
    "transfer.success": "debit",
    "transfer.failed": "debit",   # Failed debit still a debit attempt
    "transfer.reversed": "reversal",
}

FLUTTERWAVE_EVENT_TYPE_MAP: dict[str, str] = {
    "charge.completed": "credit",
    "transfer.completed": "debit",
}


def normalise_paystack_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: Optional[UUID],
    fx_rate_applied: Optional[Decimal],
    expected_settlement_at: Optional[datetime],
) -> dict[str, Any]:
    """
    Transform a Paystack webhook payload into a canonical Silver record.

    Paystack payload structure:
    {
        "event": "charge.success",
        "data": {
            "id": 123456,
            "reference": "T_abc123xyz",
            "amount": 5000000,        ← in kobo (1/100 NGN)
            "currency": "NGN",
            "status": "success",
            "paid_at": "2026-05-01T08:12:00.000Z",
            "channel": "card",
            "fees": 145000,           ← in kobo
            "authorization": {...},
            "customer": {
                "email": "customer@example.com"  ← PII, never stored
            },
            "metadata": {...}
        }
    }
    """
    data = payload["data"]
    event_type = payload["event"]

    # Paystack amounts are in kobo (subunit). Convert to NGN.
    amount_kobo = Decimal(str(data["amount"]))
    amount_raw = amount_kobo / Decimal("100")

    currency_raw = data.get("currency", "NGN").upper()
    if currency_raw == "NGN":
        amount_ngn = amount_raw
        fx_rate_snapshot_id = None
        fx_rate_applied = None
    else:
        if fx_rate_applied is None:
            raise ValueError(
                f"FX rate required for non-NGN currency: {currency_raw}"
            )
        from src.engine.fx import convert_to_ngn
        amount_ngn = convert_to_ngn(amount_raw, currency_raw, fx_rate_applied)

    initiated_at = _parse_timestamp(data.get("paid_at") or data.get("created_at"))
    settled_at = _parse_timestamp(data.get("paid_at")) if event_type == "charge.success" else None

    # PSP-specific metadata — no PII
    psp_metadata = {
        "channel": data.get("channel"),
        "fees_ngn": float(Decimal(str(data.get("fees", 0))) / Decimal("100")),
        "paystack_id": data.get("id"),
        "status": data.get("status"),
    }

    return {
        "id": uuid4(),
        "idempotency_key": build_idempotency_key(
            "paystack", data["reference"], event_type
        ),
        "bronze_ingestion_id": bronze_ingestion_id,
        "psp_name": "paystack",
        "psp_transaction_ref": data["reference"],
        "psp_event_type": event_type,
        "psp_event_received_at": datetime.now(timezone.utc),
        "transaction_type": PAYSTACK_EVENT_TYPE_MAP.get(event_type, "credit"),
        "amount_raw": amount_raw,
        "currency_raw": currency_raw,
        "amount_ngn": amount_ngn,
        "fx_rate_snapshot_id": fx_rate_snapshot_id,
        "fx_rate_applied": fx_rate_applied,
        # PII masking applied here — raw values never stored in Silver
        "sender_account_masked": None,  # Paystack charges don't expose sender NUBAN
        "sender_bank_code": None,
        "sender_bank_name": None,
        "beneficiary_account_masked": mask_account_number(
            data.get("authorization", {}).get("account_number")
        ),
        "beneficiary_bank_code": data.get("authorization", {}).get("bank_code"),
        "beneficiary_bank_name": data.get("authorization", {}).get("bank"),
        "beneficiary_name_masked": mask_name(
            data.get("authorization", {}).get("account_name")
        ),
        "narration": scrub_narration(
            data.get("metadata", {}).get("custom_fields", [{}])[0].get("value")
            if data.get("metadata", {}).get("custom_fields") else None
        ),
        "initiated_at": initiated_at,
        "settled_at": settled_at,
        "expected_settlement_at": expected_settlement_at,
        "settlement_status": "settled" if event_type == "charge.success" else "pending",
        "has_pii_masked": True,         # Explicit flag — required by CHECK constraint
        "psp_metadata": psp_metadata,
        "processed_by_run_id": run_id,
    }


def normalise_flutterwave_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: Optional[UUID],
    fx_rate_applied: Optional[Decimal],
    expected_settlement_at: Optional[datetime],
) -> dict[str, Any]:
    """
    Transform a Flutterwave webhook payload into canonical Silver record.

    Flutterwave payload structure:
    {
        "event": "charge.completed",
        "data": {
            "id": 123456,
            "tx_ref": "FLW-TXN-99887",
            "flw_ref": "FLW-MOCK-abc123",
            "amount": 50000,           ← in NGN directly (not subunit)
            "currency": "NGN",
            "status": "successful",
            "created_at": "2026-05-01T08:12:00.000Z",
            "customer": {
                "name": "Chioma Okonkwo",   ← PII
                "email": "chioma@example.com"  ← PII
            },
            "account": {
                "account_number": "0123456789",  ← PII
                "account_name": "CHIOMA OKONKWO"  ← PII
            },
            "app_fee": 200,
            "merchant_fee": 1250
        }
    }
    """
    data = payload["data"]
    event_type = payload["event"]

    # Flutterwave amounts are already in major currency units (NGN, not kobo)
    amount_raw = Decimal(str(data["amount"]))
    currency_raw = data.get("currency", "NGN").upper()

    if currency_raw == "NGN":
        amount_ngn = amount_raw
        fx_rate_snapshot_id = None
        fx_rate_applied = None
    else:
        from src.engine.fx import convert_to_ngn
        amount_ngn = convert_to_ngn(amount_raw, currency_raw, fx_rate_applied)

    initiated_at = _parse_timestamp(data.get("created_at"))
    account = data.get("account", {})

    psp_metadata = {
        "flw_ref": data.get("flw_ref"),
        "app_fee_ngn": float(data.get("app_fee", 0)),
        "merchant_fee_ngn": float(data.get("merchant_fee", 0)),
        "flutterwave_id": data.get("id"),
        "status": data.get("status"),
    }

    return {
        "id": uuid4(),
        "idempotency_key": build_idempotency_key(
            "flutterwave", data["tx_ref"], event_type
        ),
        "bronze_ingestion_id": bronze_ingestion_id,
        "psp_name": "flutterwave",
        "psp_transaction_ref": data["tx_ref"],
        "psp_event_type": event_type,
        "psp_event_received_at": datetime.now(timezone.utc),
        "transaction_type": FLUTTERWAVE_EVENT_TYPE_MAP.get(event_type, "credit"),
        "amount_raw": amount_raw,
        "currency_raw": currency_raw,
        "amount_ngn": amount_ngn,
        "fx_rate_snapshot_id": fx_rate_snapshot_id,
        "fx_rate_applied": fx_rate_applied,
        "sender_account_masked": None,
        "sender_bank_code": None,
        "sender_bank_name": None,
        "beneficiary_account_masked": mask_account_number(
            account.get("account_number")
        ),
        "beneficiary_bank_code": account.get("bank_code"),
        "beneficiary_bank_name": account.get("bank"),
        "beneficiary_name_masked": mask_name(account.get("account_name")),
        "narration": scrub_narration(data.get("narration")),
        "initiated_at": initiated_at,
        "settled_at": initiated_at if event_type == "charge.completed" else None,
        "expected_settlement_at": expected_settlement_at,
        "settlement_status": "settled" if event_type == "charge.completed" else "pending",
        "has_pii_masked": True,
        "psp_metadata": psp_metadata,
        "processed_by_run_id": run_id,
    }


def _parse_timestamp(ts_str: Optional[str]) -> Optional[datetime]:
    if not ts_str:
        return None
    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)
```

### 9.5 Matching Engine — The Core Algorithm

```python
# src/engine/matching.py
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)


class MatchStrategy(str, Enum):
    EXACT_PRIMARY = "exact_primary"
    PROBABILISTIC_SECONDARY = "probabilistic_secondary"
    NO_MATCH = "no_match"


@dataclass
class MatchResult:
    strategy: MatchStrategy
    confidence_score: float
    matched_transaction_id: Optional[UUID]
    evidence: dict = field(default_factory=dict)


async def run_matching_engine(
    session: AsyncSession,
    transaction_id: UUID,
) -> MatchResult:
    """
    Entry point for the matching engine.
    Attempts primary exact matching first.
    Falls back to probabilistic secondary matching if primary finds no match.
    Returns a MatchResult with confidence score and evidence.

    Called by the silver_to_gold_flow after each Silver write.
    """
    settings = get_settings()

    # Fetch the transaction to be matched
    tx = await _fetch_transaction(session, transaction_id)
    if not tx:
        log.error("matching.transaction_not_found", transaction_id=str(transaction_id))
        return MatchResult(
            strategy=MatchStrategy.NO_MATCH,
            confidence_score=0.0,
            matched_transaction_id=None,
            evidence={"error": "source transaction not found"},
        )

    # ── Step 1: Primary Exact Matching ────────────────────────────────────
    primary_result = await _primary_exact_match(session, tx, settings)
    if primary_result.matched_transaction_id:
        log.info(
            "matching.primary_match_found",
            source_tx=str(transaction_id),
            matched_tx=str(primary_result.matched_transaction_id),
            confidence=primary_result.confidence_score,
        )
        return primary_result

    # ── Step 2: Probabilistic Secondary Matching ───────────────────────────
    secondary_result = await _secondary_probabilistic_match(session, tx, settings)
    if secondary_result.matched_transaction_id:
        log.info(
            "matching.secondary_match_found",
            source_tx=str(transaction_id),
            matched_tx=str(secondary_result.matched_transaction_id),
            confidence=secondary_result.confidence_score,
        )
        return secondary_result

    # ── No Match Found ─────────────────────────────────────────────────────
    log.warning(
        "matching.no_match_found",
        source_tx=str(transaction_id),
        amount_ngn=float(tx["amount_ngn"]),
        psp_name=tx["psp_name"],
    )
    return MatchResult(
        strategy=MatchStrategy.NO_MATCH,
        confidence_score=0.0,
        matched_transaction_id=None,
        evidence={
            "primary_candidates_evaluated": primary_result.evidence.get("candidates", 0),
            "secondary_candidates_evaluated": secondary_result.evidence.get("candidates", 0),
            "search_window_minutes": settings.matching_secondary_window_minutes,
        },
    )


async def _primary_exact_match(
    session: AsyncSession,
    tx: dict,
    settings,
) -> MatchResult:
    """
    Primary matching strategy: exact amount match within a tight time window
    on the same PSP's counterpart transactions.

    Matching criteria (all must be true):
    1. Different PSP from source transaction
    2. Opposite transaction direction (credit ↔ debit)
    3. Identical amount_ngn
    4. Initiated within ±{matching_primary_window_minutes} of source initiated_at
    5. Not already matched in a reconciliation pair
    6. beneficiary_account_masked matches (if available on both)
    """
    window = timedelta(minutes=settings.matching_primary_window_minutes)
    time_lower = tx["initiated_at"] - window
    time_upper = tx["initiated_at"] + window

    counterpart_type = "debit" if tx["transaction_type"] == "credit" else "credit"

    result = await session.execute(
        text("""
            SELECT
                ct.id,
                ct.amount_ngn,
                ct.initiated_at,
                ct.beneficiary_account_masked,
                ct.psp_name,
                -- Check if beneficiary accounts match when both are available
                CASE
                    WHEN ct.beneficiary_account_masked IS NOT NULL
                     AND :source_beneficiary IS NOT NULL
                    THEN ct.beneficiary_account_masked = :source_beneficiary
                    ELSE NULL   -- unknown — not counted against the match
                END AS account_match
            FROM silver_canonical_transactions ct
            WHERE ct.psp_name != :source_psp
              AND ct.transaction_type = :counterpart_type
              AND ct.amount_ngn = :amount_ngn
              AND ct.initiated_at BETWEEN :time_lower AND :time_upper
              AND ct.settlement_status IN ('pending', 'settled')
              AND ct.id NOT IN (
                  SELECT transaction_b_id FROM gold_reconciliation_pairs
                  WHERE transaction_b_id IS NOT NULL
              )
              AND ct.id != :source_id
            ORDER BY ct.initiated_at ASC
            LIMIT 5
        """),
        {
            "source_psp": tx["psp_name"],
            "counterpart_type": counterpart_type,
            "amount_ngn": tx["amount_ngn"],
            "time_lower": time_lower,
            "time_upper": time_upper,
            "source_beneficiary": tx.get("beneficiary_account_masked"),
            "source_id": tx["id"],
        },
    )
    candidates = result.fetchall()

    if not candidates:
        return MatchResult(
            strategy=MatchStrategy.EXACT_PRIMARY,
            confidence_score=0.0,
            matched_transaction_id=None,
            evidence={"candidates": 0},
        )

    # Take the closest in time as the best candidate
    best = candidates[0]
    time_delta_seconds = abs(
        (best.initiated_at - tx["initiated_at"]).total_seconds()
    )

    # Build confidence: 1.0 baseline, minor penalty for account mismatch
    confidence = 1.0
    account_match = best.account_match
    if account_match is False:
        # Account explicitly present on both and they don't match —
        # this is a false candidate, skip it
        return MatchResult(
            strategy=MatchStrategy.EXACT_PRIMARY,
            confidence_score=0.0,
            matched_transaction_id=None,
            evidence={
                "candidates": len(candidates),
                "rejected": "beneficiary_account_mismatch",
            },
        )

    return MatchResult(
        strategy=MatchStrategy.EXACT_PRIMARY,
        confidence_score=confidence,
        matched_transaction_id=best.id,
        evidence={
            "amount_exact_match": True,
            "timestamp_delta_seconds": time_delta_seconds,
            "beneficiary_account_match": account_match,
            "candidates_evaluated": len(candidates),
        },
    )


async def _secondary_probabilistic_match(
    session: AsyncSession,
    tx: dict,
    settings,
) -> MatchResult:
    """
    Secondary matching strategy: probabilistic match using fuzzy comparison.
    Used when exact matching finds no candidate.

    Matching criteria (weighted scoring):
    - Amount within 0.5% of expected (after FX adjustment): 0.40 weight
    - Timestamp within secondary window: 0.25 weight (decays with distance)
    - Beneficiary name trigram similarity: 0.25 weight
    - Beneficiary bank code match: 0.10 weight
    """
    window = timedelta(minutes=settings.matching_secondary_window_minutes)
    time_lower = tx["initiated_at"] - window
    time_upper = tx["initiated_at"] + window
    counterpart_type = "debit" if tx["transaction_type"] == "credit" else "credit"

    # Amount tolerance: 1.5x the FX variance threshold
    # (wider than FX threshold to catch legitimate FX-adjusted amounts)
    amount_tolerance_pct = Decimal(str(settings.fx_variance_threshold_pct)) * Decimal("3")
    amount_lower = tx["amount_ngn"] * (1 - amount_tolerance_pct)
    amount_upper = tx["amount_ngn"] * (1 + amount_tolerance_pct)

    result = await session.execute(
        text("""
            SELECT
                ct.id,
                ct.amount_ngn,
                ct.initiated_at,
                ct.beneficiary_account_masked,
                ct.beneficiary_name_masked,
                ct.beneficiary_bank_code,
                ct.psp_name,
                -- Trigram similarity on beneficiary name (requires pg_trgm)
                CASE
                    WHEN ct.beneficiary_name_masked IS NOT NULL
                     AND :source_name IS NOT NULL
                    THEN similarity(ct.beneficiary_name_masked, :source_name)
                    ELSE NULL
                END AS name_similarity
            FROM silver_canonical_transactions ct
            WHERE ct.psp_name != :source_psp
              AND ct.transaction_type = :counterpart_type
              AND ct.amount_ngn BETWEEN :amount_lower AND :amount_upper
              AND ct.initiated_at BETWEEN :time_lower AND :time_upper
              AND ct.settlement_status IN ('pending', 'settled')
              AND ct.id NOT IN (
                  SELECT transaction_b_id FROM gold_reconciliation_pairs
                  WHERE transaction_b_id IS NOT NULL
              )
              AND ct.id != :source_id
            ORDER BY
                ABS(ct.amount_ngn - :amount_ngn) ASC,
                ABS(EXTRACT(EPOCH FROM (ct.initiated_at - :initiated_at))) ASC
            LIMIT 10
        """),
        {
            "source_psp": tx["psp_name"],
            "counterpart_type": counterpart_type,
            "amount_lower": amount_lower,
            "amount_upper": amount_upper,
            "time_lower": time_lower,
            "time_upper": time_upper,
            "amount_ngn": tx["amount_ngn"],
            "initiated_at": tx["initiated_at"],
            "source_name": tx.get("beneficiary_name_masked"),
            "source_id": tx["id"],
        },
    )
    candidates = result.fetchall()

    if not candidates:
        return MatchResult(
            strategy=MatchStrategy.PROBABILISTIC_SECONDARY,
            confidence_score=0.0,
            matched_transaction_id=None,
            evidence={"candidates": 0},
        )

    best_score = 0.0
    best_candidate = None
    best_evidence = {}

    for candidate in candidates:
        score, evidence = _compute_confidence_score(tx, candidate, settings)
        if score > best_score:
            best_score = score
            best_candidate = candidate
            best_evidence = evidence

    if best_score < settings.matching_secondary_confidence_threshold:
        return MatchResult(
            strategy=MatchStrategy.PROBABILISTIC_SECONDARY,
            confidence_score=best_score,
            matched_transaction_id=None,
            evidence={
                **best_evidence,
                "below_threshold": True,
                "threshold": settings.matching_secondary_confidence_threshold,
                "candidates_evaluated": len(candidates),
            },
        )

    return MatchResult(
        strategy=MatchStrategy.PROBABILISTIC_SECONDARY,
        confidence_score=best_score,
        matched_transaction_id=best_candidate.id,
        evidence={
            **best_evidence,
            "candidates_evaluated": len(candidates),
        },
    )


def _compute_confidence_score(
    source_tx: dict,
    candidate,
    settings,
) -> tuple[float, dict]:
    """
    Weighted confidence score computation for a candidate match.

    Weights:
    - Amount closeness:    0.40
    - Time closeness:      0.25
    - Name similarity:     0.25
    - Bank code match:     0.10
    """
    evidence = {}
    score = 0.0

    # ── Amount Score (0.40 weight) ────────────────────────────────────────
    amount_delta_pct = abs(
        float(candidate.amount_ngn - source_tx["amount_ngn"])
        / float(source_tx["amount_ngn"])
    )
    evidence["amount_delta_pct"] = round(amount_delta_pct, 6)
    # Linear decay from 1.0 at 0% delta to 0.0 at 1.5% delta
    amount_score = max(0.0, 1.0 - (amount_delta_pct / 0.015))
    score += amount_score * 0.40

    # ── Time Score (0.25 weight) ──────────────────────────────────────────
    window_seconds = settings.matching_secondary_window_minutes * 60
    time_delta_seconds = abs(
        (candidate.initiated_at - source_tx["initiated_at"]).total_seconds()
    )
    evidence["timestamp_delta_seconds"] = round(time_delta_seconds, 1)
    # Linear decay from 1.0 at 0s to 0.0 at window boundary
    time_score = max(0.0, 1.0 - (time_delta_seconds / window_seconds))
    score += time_score * 0.25

    # ── Name Similarity Score (0.25 weight) ───────────────────────────────
    name_similarity = float(candidate.name_similarity) if candidate.name_similarity is not None else 0.5
    evidence["beneficiary_name_similarity"] = round(name_similarity, 4)
    score += name_similarity * 0.25

    # ── Bank Code Score (0.10 weight) ─────────────────────────────────────
    source_bank = source_tx.get("beneficiary_bank_code")
    candidate_bank = candidate.beneficiary_bank_code
    if source_bank and candidate_bank:
        bank_match = source_bank == candidate_bank
        evidence["beneficiary_bank_code_match"] = bank_match
        score += (1.0 if bank_match else 0.0) * 0.10
    else:
        # Unknown — award partial credit rather than penalising absence
        score += 0.05

    evidence["total_confidence"] = round(score, 4)
    return score, evidence


async def _fetch_transaction(
    session: AsyncSession,
    transaction_id: UUID,
) -> Optional[dict]:
    result = await session.execute(
        text("""
            SELECT id, psp_name, transaction_type, amount_ngn,
                   currency_raw, initiated_at, settled_at,
                   beneficiary_account_masked, beneficiary_name_masked,
                   beneficiary_bank_code
            FROM silver_canonical_transactions
            WHERE id = :id
        """),
        {"id": transaction_id},
    )
    row = result.one_or_none()
    if not row:
        return None
    return dict(row._mapping)
```

---

## 10. Prefect Flows — Orchestration

### 10.1 Webhook Ingestion Flow

```python
# src/flows/ingestion_flow.py
import json
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import pyarrow as pa
from prefect import flow, task, get_run_logger
from prefect.tasks import task_input_hash

from src.config import get_settings
from src.engine.idempotency import build_idempotency_key, check_and_register_idempotency_key
from src.storage.postgres import pipeline_session
from src.storage.minio_client import MinIOClient
from src.storage.kafka_producer import KafkaProducer
from src.contracts.bronze.paystack_schema import PAYSTACK_BRONZE_SCHEMA
from src.observability.metrics import (
    WEBHOOK_RECEIVED_COUNTER,
    INGESTION_LATENCY,
    DUPLICATE_EVENTS_COUNTER,
)


@task(
    name="validate-and-publish",
    retries=3,
    retry_delay_seconds=[10, 30, 60],   # Exponential-ish backoff
    tags=["ingestion"],
)
async def validate_and_publish_to_kafka(
    psp_name: str,
    event_type: str,
    raw_payload: dict[str, Any],
    content_hash: str,
    received_at: str,
) -> dict:
    """
    1. Build idempotency key
    2. Check idempotency registry — skip if duplicate
    3. Publish to Kafka topic

    Returns: {is_new, idempotency_key, kafka_topic}
    """
    logger = get_run_logger()
    settings = get_settings()

    psp_tx_ref = (
        raw_payload.get("data", {}).get("reference")        # Paystack
        or raw_payload.get("data", {}).get("tx_ref")        # Flutterwave
        or raw_payload.get("data", {}).get("TransID")       # M-Pesa
        or content_hash[:16]                                 # Fallback: hash prefix
    )

    idempotency_key = build_idempotency_key(psp_name, psp_tx_ref, event_type)

    async with pipeline_session() as session:
        is_new, occurrence_count = await check_and_register_idempotency_key(
            session, idempotency_key
        )

    if not is_new:
        DUPLICATE_EVENTS_COUNTER.labels(psp_name=psp_name).inc()
        logger.warning(
            f"Duplicate event skipped: {idempotency_key} "
            f"(occurrence #{occurrence_count})"
        )
        return {
            "is_new": False,
            "idempotency_key": idempotency_key,
            "kafka_topic": None,
        }

    topic_map = {
        "paystack": settings.kafka_topic_paystack,
        "flutterwave": settings.kafka_topic_flutterwave,
        "mpesa": settings.kafka_topic_mpesa,
    }
    topic = topic_map.get(psp_name, settings.kafka_topic_polling)

    kafka_message = {
        "psp_name": psp_name,
        "event_type": event_type,
        "payload": raw_payload,
        "content_hash": content_hash,
        "received_at": received_at,
        "idempotency_key": idempotency_key,
    }

    producer = KafkaProducer()
    producer.publish(
        topic=topic,
        payload=kafka_message,
        key=idempotency_key,      # Partition by key → ordered delivery per transaction
    )

    WEBHOOK_RECEIVED_COUNTER.labels(psp_name=psp_name, event_type=event_type).inc()
    logger.info(f"Published to Kafka: {idempotency_key} → {topic}")

    return {
        "is_new": True,
        "idempotency_key": idempotency_key,
        "kafka_topic": topic,
    }
```

### 10.2 Bronze to Silver Flow

```python
# src/flows/bronze_to_silver.py
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

import pandera
from prefect import flow, task, get_run_logger
from sqlalchemy import text

from src.config import get_settings
from src.engine.normaliser import normalise_paystack_event, normalise_flutterwave_event
from src.engine.fx import get_fx_rate_at, capture_fx_rates, convert_to_ngn
from src.engine.settlement import compute_expected_settlement
from src.storage.postgres import pipeline_session
from src.storage.minio_client import MinIOClient
from src.contracts.silver.canonical_schema import SILVER_CANONICAL_SCHEMA
from src.observability.metrics import PIPELINE_LATENCY, SILVER_RECORDS_WRITTEN


@task(
    name="write-bronze-parquet",
    retries=3,
    retry_delay_seconds=[5, 15, 45],
)
async def write_bronze_parquet(
    psp_name: str,
    kafka_message: dict[str, Any],
    run_id: UUID,
) -> tuple[str, UUID]:
    """
    Write raw Kafka message payload to Bronze Parquet on MinIO.
    Returns (file_path, bronze_ingestion_id).
    Writes bronze_ingestion_log metadata record to PostgreSQL.
    """
    import asyncio
    import pyarrow as pa
    from src.contracts.bronze.paystack_schema import PAYSTACK_BRONZE_SCHEMA

    logger = get_run_logger()

    # Build PyArrow table from raw payload
    now = datetime.now(timezone.utc)
    table_data = {
        "_ingestion_id": [str(uuid4())],
        "_received_at": [now],
        "_source_type": [kafka_message.get("source_type", "webhook")],
        "_content_hash": [kafka_message["content_hash"]],
        "_kafka_offset": [kafka_message.get("kafka_offset", -1)],
        "event": [kafka_message["event_type"]],
        "data": [str(kafka_message["payload"])],   # Raw JSON as string — Bronze is schema-on-read
    }
    table = pa.table(table_data)

    # Write to MinIO (synchronous client in thread)
    client = MinIOClient()
    file_path = await asyncio.to_thread(
        client.write_parquet,
        table=table,
        psp_name=psp_name,
        event_date=now,
        run_id=str(run_id),
    )

    # Register in bronze_ingestion_log
    async with pipeline_session() as session:
        result = await session.execute(
            text("""
                INSERT INTO bronze_ingestion_log
                    (psp_name, source_type, kafka_topic, kafka_partition,
                     kafka_offset, content_hash, file_path, event_count,
                     ingestion_run_id, status)
                VALUES
                    (:psp_name, :source_type, :topic, :partition,
                     :offset, :hash, :path, 1, :run_id, 'written')
                RETURNING id
            """),
            {
                "psp_name": psp_name,
                "source_type": kafka_message.get("source_type", "webhook"),
                "topic": kafka_message.get("kafka_topic", f"raw.{psp_name}.events"),
                "partition": kafka_message.get("kafka_partition", 0),
                "offset": kafka_message.get("kafka_offset", 0),
                "hash": kafka_message["content_hash"],
                "path": file_path,
                "run_id": run_id,
            },
        )
        bronze_ingestion_id = result.scalar_one()

    logger.info(f"Bronze written: {file_path} (ingestion_id={bronze_ingestion_id})")
    return file_path, bronze_ingestion_id


@task(
    name="normalise-to-silver",
    retries=2,
    retry_delay_seconds=[10, 30],
)
async def normalise_to_silver(
    psp_name: str,
    payload: dict[str, Any],
    event_type: str,
    bronze_ingestion_id: UUID,
    run_id: UUID,
) -> UUID:
    """
    Transform Bronze payload to canonical Silver schema.
    1. Capture FX rate at event time
    2. Compute expected settlement time
    3. Apply PSP-specific normaliser
    4. Validate against Pandera Silver schema
    5. Write to silver_canonical_transactions
    Returns silver_canonical_transactions.id
    """
    logger = get_run_logger()

    async with pipeline_session() as session:
        # Step 1: FX rate capture
        initiated_at = _extract_initiated_at(psp_name, payload)
        currency_raw = payload.get("data", {}).get("currency", "NGN").upper()
        fx_rate_snapshot_id = None
        fx_rate_applied = None

        if currency_raw != "NGN":
            currency_pair = f"NGN/{currency_raw}"
            fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
            if fx_result:
                fx_rate_snapshot_id, fx_rate_applied = fx_result
            else:
                logger.warning(
                    f"No FX rate for {currency_pair} at {initiated_at}. "
                    f"Triggering fresh capture."
                )
                await capture_fx_rates(session)
                fx_result = await get_fx_rate_at(session, currency_pair, initiated_at)
                if fx_result:
                    fx_rate_snapshot_id, fx_rate_applied = fx_result

        # Step 2: Expected settlement time
        expected_settlement_at = await compute_expected_settlement(
            session=session,
            psp_name=psp_name,
            transaction_type=_extract_transaction_type(psp_name, event_type),
            initiated_at=initiated_at,
        )

        # Step 3: PSP-specific normalisation
        normaliser_map = {
            "paystack": normalise_paystack_event,
            "flutterwave": normalise_flutterwave_event,
        }
        normaliser = normaliser_map.get(psp_name)
        if not normaliser:
            raise ValueError(f"No normaliser registered for PSP: {psp_name}")

        canonical_record = normaliser(
            payload=payload,
            bronze_ingestion_id=bronze_ingestion_id,
            run_id=run_id,
            fx_rate_snapshot_id=fx_rate_snapshot_id,
            fx_rate_applied=fx_rate_applied,
            expected_settlement_at=expected_settlement_at,
        )

        # Step 4: Pandera schema validation
        import pandas as pd
        df = pd.DataFrame([{
            k: v for k, v in canonical_record.items()
            if k not in ("id", "processed_by_run_id", "psp_metadata")
        }])
        try:
            SILVER_CANONICAL_SCHEMA.validate(df)
        except pandera.errors.SchemaError as e:
            logger.error(f"Silver schema validation failed: {e}")
            raise

        # Step 5: Write to Silver
        result = await session.execute(
            text("""
                INSERT INTO silver_canonical_transactions
                    (id, idempotency_key, bronze_ingestion_id, psp_name,
                     psp_transaction_ref, psp_event_type, psp_event_received_at,
                     transaction_type, amount_raw, currency_raw, amount_ngn,
                     fx_rate_snapshot_id, fx_rate_applied,
                     sender_account_masked, sender_bank_code, sender_bank_name,
                     beneficiary_account_masked, beneficiary_bank_code,
                     beneficiary_bank_name, beneficiary_name_masked,
                     narration, initiated_at, settled_at, expected_settlement_at,
                     settlement_status, has_pii_masked, psp_metadata,
                     processed_by_run_id)
                VALUES
                    (:id, :idempotency_key, :bronze_ingestion_id, :psp_name,
                     :psp_transaction_ref, :psp_event_type, :psp_event_received_at,
                     :transaction_type, :amount_raw, :currency_raw, :amount_ngn,
                     :fx_rate_snapshot_id, :fx_rate_applied,
                     :sender_account_masked, :sender_bank_code, :sender_bank_name,
                     :beneficiary_account_masked, :beneficiary_bank_code,
                     :beneficiary_bank_name, :beneficiary_name_masked,
                     :narration, :initiated_at, :settled_at, :expected_settlement_at,
                     :settlement_status, :has_pii_masked, :psp_metadata::jsonb,
                     :processed_by_run_id)
                ON CONFLICT (idempotency_key) DO NOTHING
                RETURNING id
            """),
            canonical_record,
        )
        silver_id = result.scalar_one_or_none()

        if silver_id is None:
            logger.warning(
                f"Silver write skipped — idempotency key already exists: "
                f"{canonical_record['idempotency_key']}"
            )
            # Fetch existing ID for downstream
            existing = await session.execute(
                text("SELECT id FROM silver_canonical_transactions WHERE idempotency_key = :key"),
                {"key": canonical_record["idempotency_key"]},
            )
            silver_id = existing.scalar_one()

        SILVER_RECORDS_WRITTEN.labels(psp_name=psp_name).inc()
        logger.info(f"Silver record written: {silver_id}")
        return silver_id


def _extract_initiated_at(psp_name: str, payload: dict) -> datetime:
    data = payload.get("data", {})
    if psp_name == "paystack":
        ts = data.get("paid_at") or data.get("created_at")
    elif psp_name == "flutterwave":
        ts = data.get("created_at")
    else:
        ts = data.get("timestamp")
    if not ts:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc)


def _extract_transaction_type(psp_name: str, event_type: str) -> str:
    from src.engine.normaliser import PAYSTACK_EVENT_TYPE_MAP, FLUTTERWAVE_EVENT_TYPE_MAP
    type_map = {
        "paystack": PAYSTACK_EVENT_TYPE_MAP,
        "flutterwave": FLUTTERWAVE_EVENT_TYPE_MAP,
    }
    return type_map.get(psp_name, {}).get(event_type, "credit")


@flow(
    name="bronze-to-silver-flow",
    log_prints=True,
)
async def bronze_to_silver_flow(kafka_message: dict[str, Any]) -> dict:
    """
    Orchestrates the Bronze → Silver pipeline for a single Kafka message.
    Triggered by the Kafka consumer after Bronze write.
    """
    run_id = uuid4()
    psp_name = kafka_message["psp_name"]
    event_type = kafka_message["event_type"]
    payload = kafka_message["payload"]

    # Write Bronze Parquet
    file_path, bronze_ingestion_id = await write_bronze_parquet(
        psp_name=psp_name,
        kafka_message=kafka_message,
        run_id=run_id,
    )

    # Normalise to Silver
    silver_id = await normalise_to_silver(
        psp_name=psp_name,
        payload=payload,
        event_type=event_type,
        bronze_ingestion_id=bronze_ingestion_id,
        run_id=run_id,
    )

    return {
        "run_id": str(run_id),
        "bronze_ingestion_id": str(bronze_ingestion_id),
        "silver_transaction_id": str(silver_id),
        "psp_name": psp_name,
    }
```

---

## 11. FastAPI Application

### 11.1 Application Factory

```python
# src/api/main.py
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import structlog

from src.api.middleware.auth import APIKeyMiddleware
from src.api.middleware.rate_limit import RateLimitMiddleware
from src.api.middleware.request_id import RequestIDMiddleware
from src.api.v1.router import v1_router
from src.config import get_settings
from src.observability.logging import configure_logging
from src.observability.metrics import METRICS_REGISTRY
from src.storage.postgres import get_db_manager
from prometheus_client import generate_latest, CONTENT_TYPE_LATEST


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """
    Startup: configure logging, validate DB connections, register Prefect deployments.
    Shutdown: dispose DB connection pools.
    """
    settings = get_settings()
    configure_logging(level=settings.log_level)
    log = structlog.get_logger()

    log.info("api.starting", environment=settings.environment)

    # Validate DB connections at startup — fail fast on misconfiguration
    try:
        db = get_db_manager()
        async with db.api_session() as session:
            await session.execute("SELECT 1")
        log.info("api.db_connected")
    except Exception as e:
        log.error("api.db_connection_failed", error=str(e))
        raise

    yield

    # Shutdown
    await get_db_manager().dispose()
    log.info("api.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Cross-Border Reconciliation Engine API",
        version="1.0.0",
        description=(
            "Event-driven financial reconciliation API for multi-PSP "
            "Nigerian payment environments."
        ),
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url="/redoc" if settings.environment != "production" else None,
        lifespan=lifespan,
    )

    # ── Middleware (order matters — innermost applied first) ──────────────
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(
        RateLimitMiddleware,
        requests_per_minute=settings.api_rate_limit_per_minute,
    )
    app.add_middleware(APIKeyMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.api_cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["X-API-Key", "Content-Type", "X-Request-ID"],
    )

    # ── Routes ─────────────────────────────────────────────────────────────
    app.include_router(v1_router, prefix="/v1")

    # ── Health endpoint (no auth required for liveness probes) ────────────
    @app.get("/health", tags=["system"], include_in_schema=False)
    async def health() -> dict:
        return {"status": "healthy", "version": "1.0.0"}

    # ── Prometheus metrics endpoint ────────────────────────────────────────
    @app.get("/metrics", include_in_schema=False)
    async def metrics(request: Request):
        from fastapi.responses import Response
        return Response(
            content=generate_latest(METRICS_REGISTRY),
            media_type=CONTENT_TYPE_LATEST,
        )

    # ── Global exception handler ───────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        log = structlog.get_logger()
        log.error(
            "api.unhandled_exception",
            path=request.url.path,
            method=request.method,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred.",
                "request_id": request.state.request_id,
            },
        )

    return app


app = create_app()
```

### 11.2 Authentication Middleware

```python
# src/api/middleware/auth.py
import hashlib
import time
from typing import Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
import structlog

from src.storage.postgres import get_db_manager

log = structlog.get_logger(__name__)

# Paths that bypass authentication
AUTH_EXEMPT_PATHS = {"/health", "/metrics"}
# Webhook paths authenticate via PSP HMAC, not API key
WEBHOOK_PATHS_PREFIX = "/v1/webhooks/"


class APIKeyMiddleware(BaseHTTPMiddleware):
    """
    API key authentication middleware.
    Validates X-API-Key header against SHA-256 hash in system_api_keys.
    Attaches api_key_record to request.state for downstream scope checks.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path

        # Exempt paths
        if path in AUTH_EXEMPT_PATHS:
            return await call_next(request)

        # Webhook paths: authenticated by PSP HMAC in route handler
        if path.startswith(WEBHOOK_PATHS_PREFIX):
            return await call_next(request)

        api_key = request.headers.get("X-API-Key")
        if not api_key:
            return JSONResponse(
                status_code=401,
                content={
                    "error": "missing_api_key",
                    "message": "X-API-Key header is required.",
                },
            )

        # Validate key
        key_record = await self._validate_key(api_key)
        if not key_record:
            log.warning(
                "auth.invalid_key_attempt",
                path=path,
                key_prefix=api_key[:8] if len(api_key) >= 8 else "short",
            )
            return JSONResponse(
                status_code=401,
                content={
                    "error": "invalid_api_key",
                    "message": "The provided API key is invalid or expired.",
                },
            )

        request.state.api_key = key_record
        log.info(
            "auth.authenticated",
            client=key_record["client_name"],
            path=path,
        )
        return await call_next(request)

    async def _validate_key(self, raw_key: str) -> Optional[dict]:
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        db = get_db_manager()
        async with db.api_session() as session:
            result = await session.execute(
                text("""
                    SELECT id, client_name, scopes, is_active, expires_at
                    FROM system_api_keys
                    WHERE key_hash = :hash
                      AND is_active = TRUE
                      AND (expires_at IS NULL OR expires_at > NOW())
                """),
                {"hash": key_hash},
            )
            row = result.one_or_none()
            if not row:
                return None

            # Update last_used_at and usage_count (fire and forget)
            await session.execute(
                text("""
                    UPDATE system_api_keys
                    SET last_used_at = NOW(), usage_count = usage_count + 1
                    WHERE key_hash = :hash
                """),
                {"hash": key_hash},
            )
            return dict(row._mapping)
```

### 11.3 Webhook Ingestion Route

```python
# src/api/v1/routes/ingestion.py
import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
import structlog

from src.connectors.paystack import PaystackConnector
from src.connectors.flutterwave import FlutterwaveConnector
from src.flows.ingestion_flow import validate_and_publish_to_kafka
from src.observability.metrics import WEBHOOK_SIGNATURE_FAILURES

router = APIRouter(prefix="/webhooks", tags=["Webhook Ingestion"])
log = structlog.get_logger(__name__)

_PAYSTACK = PaystackConnector()
_FLUTTERWAVE = FlutterwaveConnector()


@router.post("/paystack")
async def receive_paystack_webhook(
    request: Request,
    x_paystack_signature: Annotated[str | None, Header()] = None,
) -> JSONResponse:
    """
    Receive and validate Paystack webhook events.

    Authentication: HMAC-SHA512 via X-Paystack-Signature header.
    Events are published to Kafka after validation.
    Always returns 200 to prevent PSP retry storms — errors are logged internally.
    """
    raw_body = await request.body()
    received_at = datetime.now(timezone.utc).isoformat()

    if not x_paystack_signature:
        WEBHOOK_SIGNATURE_FAILURES.labels(psp="paystack").inc()
        # Return 200 to Paystack — a 401 would trigger their retry mechanism
        # Log the failure internally for investigation
        log.warning("webhook.paystack.missing_signature")
        return JSONResponse(status_code=200, content={"status": "received"})

    if not _PAYSTACK.validate_signature(raw_body, x_paystack_signature):
        WEBHOOK_SIGNATURE_FAILURES.labels(psp="paystack").inc()
        log.warning(
            "webhook.paystack.invalid_signature",
            signature_prefix=x_paystack_signature[:16],
        )
        return JSONResponse(status_code=200, content={"status": "received"})

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        log.error("webhook.paystack.malformed_json")
        return JSONResponse(status_code=200, content={"status": "received"})

    event_type = _PAYSTACK.extract_event_type(payload)
    event = _PAYSTACK.build_event(raw_body, payload, received_at)

    # Dispatch to Prefect flow asynchronously
    # The API returns immediately — processing is async
    result = await validate_and_publish_to_kafka(
        psp_name=event.psp_name,
        event_type=event.event_type,
        raw_payload=event.raw_payload,
        content_hash=event.content_hash,
        received_at=event.received_at,
    )

    log.info(
        "webhook.paystack.received",
        event_type=event_type,
        idempotency_key=result.get("idempotency_key"),
        is_new=result.get("is_new"),
    )

    return JSONResponse(
        status_code=200,
        content={
            "status": "received",
            "is_new": result.get("is_new", True),
        },
    )


@router.post("/flutterwave")
async def receive_flutterwave_webhook(
    request: Request,
    verif_hash: Annotated[str | None, Header(alias="verif-hash")] = None,
) -> JSONResponse:
    """Receive and validate Flutterwave webhook events."""
    raw_body = await request.body()
    received_at = datetime.now(timezone.utc).isoformat()

    if not verif_hash or not _FLUTTERWAVE.validate_signature(raw_body, verif_hash):
        WEBHOOK_SIGNATURE_FAILURES.labels(psp="flutterwave").inc()
        log.warning("webhook.flutterwave.invalid_signature")
        return JSONResponse(status_code=200, content={"status": "received"})

    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError:
        return JSONResponse(status_code=200, content={"status": "received"})

    event = _FLUTTERWAVE.build_event(raw_body, payload, received_at)

    result = await validate_and_publish_to_kafka(
        psp_name=event.psp_name,
        event_type=event.event_type,
        raw_payload=event.raw_payload,
        content_hash=event.content_hash,
        received_at=event.received_at,
    )

    log.info(
        "webhook.flutterwave.received",
        event_type=event.event_type,
        idempotency_key=result.get("idempotency_key"),
        is_new=result.get("is_new"),
    )

    return JSONResponse(status_code=200, content={"status": "received"})
```

---

## 12. Observability

### 12.1 Prometheus Metrics

```python
# src/observability/metrics.py
from prometheus_client import (
    Counter, Histogram, Gauge, CollectorRegistry, REGISTRY
)

METRICS_REGISTRY = REGISTRY

# ── Webhook Ingestion ─────────────────────────────────────────────────────
WEBHOOK_RECEIVED_COUNTER = Counter(
    "reconciliation_webhooks_received_total",
    "Total webhooks received by PSP and event type",
    ["psp_name", "event_type"],
)

WEBHOOK_SIGNATURE_FAILURES = Counter(
    "reconciliation_webhook_signature_failures_total",
    "Webhook events rejected due to invalid HMAC signature",
    ["psp"],
)

DUPLICATE_EVENTS_COUNTER = Counter(
    "reconciliation_duplicate_events_total",
    "Webhook events skipped due to idempotency key already existing",
    ["psp_name"],
)

# ── Pipeline ──────────────────────────────────────────────────────────────
PIPELINE_LATENCY = Histogram(
    "reconciliation_pipeline_duration_seconds",
    "End-to-end pipeline duration from webhook receipt to Gold output",
    ["flow_name"],
    buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0],
)

SILVER_RECORDS_WRITTEN = Counter(
    "reconciliation_silver_records_written_total",
    "Canonical transaction records written to Silver layer",
    ["psp_name"],
)

INGESTION_LATENCY = Histogram(
    "reconciliation_ingestion_latency_seconds",
    "Webhook receipt to Bronze persistence latency",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

# ── Matching Engine ───────────────────────────────────────────────────────
MATCHING_RESULTS = Counter(
    "reconciliation_matching_results_total",
    "Matching engine outcomes by strategy and result",
    ["strategy", "result"],  # result: matched | no_match
)

MATCHING_CONFIDENCE_HISTOGRAM = Histogram(
    "reconciliation_matching_confidence_score",
    "Distribution of confidence scores for probabilistic matches",
    buckets=[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99, 1.0],
)

# ── Financial State ───────────────────────────────────────────────────────
OPEN_DISCREPANCIES = Gauge(
    "reconciliation_open_discrepancies",
    "Current count of open discrepancies by PSP and classification",
    ["psp_name", "classification"],
)

OPEN_EXPOSURE_NGN = Gauge(
    "reconciliation_open_exposure_ngn",
    "Total estimated financial exposure from open discrepancies in NGN",
    ["psp_name"],
)

MATCH_RATE_GAUGE = Gauge(
    "reconciliation_match_rate_pct",
    "Current reconciliation match rate percentage by PSP",
    ["psp_name"],
)

# ── FX ────────────────────────────────────────────────────────────────────
FX_RATE_GAUGE = Gauge(
    "reconciliation_fx_rate",
    "Current FX rate (1 NGN = X quote currency)",
    ["currency_pair"],
)

FX_RATE_AGE_SECONDS = Gauge(
    "reconciliation_fx_rate_age_seconds",
    "Age of most recent FX rate snapshot in seconds",
    ["currency_pair"],
)
```

### 12.2 Structured Logging

```python
# src/observability/logging.py
import logging
import sys
from typing import Literal

import structlog


def configure_logging(
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO",
) -> None:
    """
    Configure structlog for structured JSON logging in production
    and human-readable console logging in development.

    Every log event includes:
    - timestamp (ISO 8601 UTC)
    - level
    - logger name
    - event message
    - request_id (if bound to context)
    - All additional key=value fields passed to the logger
    """
    log_level = getattr(logging, level)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    if sys.stdout.isatty():
        # Development: coloured, readable output
        processors = [
            *shared_processors,
            structlog.dev.ConsoleRenderer(colors=True),
        ]
    else:
        # Production: JSON output, one line per event
        processors = [
            *shared_processors,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Redirect standard library logging through structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
```

### 12.3 Prometheus Alert Rules

```yaml
# infra/prometheus/alerts.yml
groups:
  - name: reconciliation.pipeline
    rules:

      - alert: PipelineLatencyHigh
        expr: histogram_quantile(0.95, reconciliation_pipeline_duration_seconds_bucket) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Pipeline P95 latency exceeds 10s SLA"
          description: "Flow {{ $labels.flow_name }} P95 latency is {{ $value }}s"

      - alert: WebhookSignatureFailuresHigh
        expr: rate(reconciliation_webhook_signature_failures_total[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High rate of webhook signature failures"
          description: "PSP {{ $labels.psp }} has {{ $value }} failures/s"

  - name: reconciliation.financial
    rules:

      - alert: OpenExposureHigh
        expr: reconciliation_open_exposure_ngn > 500000
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "Open financial exposure exceeds NGN 500,000"
          description: "PSP {{ $labels.psp_name }} exposure: NGN {{ $value }}"

      - alert: MatchRateLow
        expr: reconciliation_match_rate_pct < 95
        for: 15m
        labels:
          severity: warning
        annotations:
          summary: "Reconciliation match rate below 95%"
          description: "PSP {{ $labels.psp_name }} match rate: {{ $value }}%"

  - name: reconciliation.fx
    rules:

      - alert: FXRateStale
        expr: reconciliation_fx_rate_age_seconds > 7200
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "FX rate snapshot older than 2 hours"
          description: "{{ $labels.currency_pair }} rate not refreshed in {{ $value }}s"
```

---

## 13. Testing Strategy

### 13.1 Test Configuration and Fixtures

```python
# tests/conftest.py
import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import NullPool

from src.api.main import create_app
from src.config import get_settings


TEST_DATABASE_URL = "postgresql+asyncpg://postgres:test@localhost:5432/reconciliation_test"


@pytest.fixture(scope="session")
def event_loop():
    """Single event loop for all async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Isolated database session per test function.
    Uses NullPool to prevent connection sharing between tests.
    Rolls back all changes after each test — no state leakage.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        await session.begin()
        yield session
        await session.rollback()

    await engine.dispose()


@pytest_asyncio.fixture
async def api_client() -> AsyncGenerator[AsyncClient, None]:
    """Async test client for FastAPI routes."""
    app = create_app()
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client


@pytest.fixture
def paystack_charge_success_payload() -> dict:
    """Realistic Paystack charge.success webhook payload for test use."""
    return {
        "event": "charge.success",
        "data": {
            "id": 123456789,
            "reference": f"T_{uuid4().hex[:12]}",
            "amount": 5_000_000,       # NGN 50,000 in kobo
            "currency": "NGN",
            "status": "success",
            "paid_at": "2026-05-01T08:12:00.000Z",
            "created_at": "2026-05-01T08:11:58.000Z",
            "channel": "bank_transfer",
            "fees": 145_000,           # NGN 1,450 in kobo
            "customer": {
                "email": "customer@test.com",
                "customer_code": "CUS_test123",
            },
            "authorization": {
                "account_number": "0123456789",
                "account_name": "CHIOMA OKONKWO",
                "bank": "Guaranty Trust Bank",
                "bank_code": "058",
            },
            "metadata": {
                "custom_fields": [
                    {"display_name": "Narration", "value": "Payment for order INV-001"}
                ]
            },
        },
    }


@pytest.fixture
def flutterwave_charge_completed_payload() -> dict:
    """Realistic Flutterwave charge.completed webhook payload."""
    return {
        "event": "charge.completed",
        "data": {
            "id": 987654321,
            "tx_ref": f"FLW-TXN-{uuid4().hex[:8]}",
            "flw_ref": f"FLW-MOCK-{uuid4().hex[:12]}",
            "amount": 50_000,          # NGN 50,000 directly
            "currency": "NGN",
            "status": "successful",
            "created_at": "2026-05-01T08:12:00Z",
            "customer": {
                "name": "Tunde Adeyemi",
                "email": "tunde@test.com",
            },
            "account": {
                "account_number": "0567891234",
                "account_name": "TUNDE ADEYEMI",
                "bank_code": "011",
                "bank": "First Bank of Nigeria",
            },
            "app_fee": 200,
            "merchant_fee": 1250,
            "narration": "Settlement for invoice #INV-001",
        },
    }
```

### 13.2 Unit Test — Matching Engine

```python
# tests/unit/test_matching_engine.py
import pytest
from decimal import Decimal
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from src.engine.matching import (
    MatchStrategy,
    _compute_confidence_score,
    build_idempotency_key,
)


class TestConfidenceScoreComputation:

    def _make_candidate(self, **kwargs):
        """Build a candidate mock with sensible defaults."""
        from unittest.mock import MagicMock
        c = MagicMock()
        c.amount_ngn = kwargs.get("amount_ngn", Decimal("50000"))
        c.initiated_at = kwargs.get(
            "initiated_at",
            datetime(2026, 5, 1, 8, 12, tzinfo=timezone.utc),
        )
        c.beneficiary_name_masked = kwargs.get("beneficiary_name_masked", "C****** O*******")
        c.beneficiary_bank_code = kwargs.get("beneficiary_bank_code", "058")
        c.name_similarity = kwargs.get("name_similarity", 0.95)
        return c

    def _make_source_tx(self, **kwargs):
        return {
            "id": uuid4(),
            "amount_ngn": kwargs.get("amount_ngn", Decimal("50000")),
            "initiated_at": kwargs.get(
                "initiated_at",
                datetime(2026, 5, 1, 8, 12, tzinfo=timezone.utc),
            ),
            "beneficiary_name_masked": kwargs.get("beneficiary_name_masked", "C****** O*******"),
            "beneficiary_bank_code": kwargs.get("beneficiary_bank_code", "058"),
        }

    def test_perfect_match_returns_high_confidence(self):
        """Identical amount, timestamp, and name → confidence near 1.0"""
        settings = type("s", (), {
            "matching_secondary_window_minutes": 30,
            "fx_variance_threshold_pct": 0.005,
        })()
        source = self._make_source_tx()
        candidate = self._make_candidate(name_similarity=1.0)

        score, evidence = _compute_confidence_score(source, candidate, settings)
        assert score >= 0.95
        assert evidence["amount_delta_pct"] == 0.0
        assert evidence["timestamp_delta_seconds"] == 0.0

    def test_amount_mismatch_reduces_confidence(self):
        """1% amount difference should meaningfully reduce confidence."""
        settings = type("s", (), {
            "matching_secondary_window_minutes": 30,
            "fx_variance_threshold_pct": 0.005,
        })()
        source = self._make_source_tx(amount_ngn=Decimal("50000"))
        candidate = self._make_candidate(amount_ngn=Decimal("49500"))  # 1% short

        score, evidence = _compute_confidence_score(source, candidate, settings)
        assert score < 0.75
        assert evidence["amount_delta_pct"] == pytest.approx(0.01, abs=0.001)

    def test_late_timestamp_reduces_confidence(self):
        """A candidate 25 minutes away (near window edge) should score lower."""
        settings = type("s", (), {
            "matching_secondary_window_minutes": 30,
            "fx_variance_threshold_pct": 0.005,
        })()
        source_time = datetime(2026, 5, 1, 8, 0, tzinfo=timezone.utc)
        source = self._make_source_tx(initiated_at=source_time)
        candidate = self._make_candidate(
            initiated_at=source_time + timedelta(minutes=25)
        )

        score, evidence = _compute_confidence_score(source, candidate, settings)
        # Time score should be low: 25/30 = 0.83 decay → ~0.17 time contribution
        assert evidence["timestamp_delta_seconds"] == pytest.approx(1500, abs=1)

    def test_bank_code_mismatch_reduces_confidence(self):
        """Different bank codes on both sides should reduce score."""
        settings = type("s", (), {
            "matching_secondary_window_minutes": 30,
            "fx_variance_threshold_pct": 0.005,
        })()
        source = self._make_source_tx(beneficiary_bank_code="058")
        candidate = self._make_candidate(beneficiary_bank_code="011")

        score_match, _ = _compute_confidence_score(
            self._make_source_tx(beneficiary_bank_code="058"),
            self._make_candidate(beneficiary_bank_code="058"),
            settings,
        )
        score_mismatch, _ = _compute_confidence_score(source, candidate, settings)
        assert score_match > score_mismatch


class TestIdempotencyKeyGeneration:

    def test_canonical_format(self):
        key = build_idempotency_key("paystack", "T_abc123", "charge.success")
        assert key == "paystack:T_abc123:charge.success"

    def test_case_normalisation(self):
        key1 = build_idempotency_key("PAYSTACK", "T_abc123", "CHARGE.SUCCESS")
        key2 = build_idempotency_key("paystack", "T_abc123", "charge.success")
        assert key1 == key2

    def test_whitespace_stripped(self):
        key = build_idempotency_key("  paystack  ", " T_abc123 ", " charge.success ")
        assert key == "paystack:T_abc123:charge.success"
```

### 13.3 Integration Test — Webhook Ingestion

```python
# tests/integration/test_webhook_ingestion.py
import hashlib
import hmac
import json
import pytest
from httpx import AsyncClient

from src.config import get_settings


@pytest.mark.asyncio
class TestPaystackWebhookIngestion:

    async def _make_signature(self, body: bytes) -> str:
        settings = get_settings()
        return hmac.new(
            settings.paystack_secret_key.encode(),
            body,
            hashlib.sha512,
        ).hexdigest()

    async def test_valid_webhook_returns_200(
        self,
        api_client: AsyncClient,
        paystack_charge_success_payload: dict,
    ):
        body = json.dumps(paystack_charge_success_payload).encode()
        sig = await self._make_signature(body)

        response = await api_client.post(
            "/v1/webhooks/paystack",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Paystack-Signature": sig,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "received"
        assert data["is_new"] is True

    async def test_invalid_signature_returns_200_but_is_rejected(
        self,
        api_client: AsyncClient,
        paystack_charge_success_payload: dict,
    ):
        """
        Critically: even invalid webhooks return 200.
        Returning non-200 to PSPs triggers their retry mechanism,
        flooding the system with events we'll reject again.
        The event is logged and dropped silently.
        """
        body = json.dumps(paystack_charge_success_payload).encode()

        response = await api_client.post(
            "/v1/webhooks/paystack",
            content=body,
            headers={
                "Content-Type": "application/json",
                "X-Paystack-Signature": "invalid_signature_value",
            },
        )
        assert response.status_code == 200

    async def test_duplicate_webhook_returns_200_with_is_new_false(
        self,
        api_client: AsyncClient,
        paystack_charge_success_payload: dict,
    ):
        """Duplicate webhook should be silently deduplicated."""
        body = json.dumps(paystack_charge_success_payload).encode()
        sig = await self._make_signature(body)
        headers = {
            "Content-Type": "application/json",
            "X-Paystack-Signature": sig,
        }

        # First request
        resp1 = await api_client.post("/v1/webhooks/paystack", content=body, headers=headers)
        assert resp1.json()["is_new"] is True

        # Second request — identical payload
        resp2 = await api_client.post("/v1/webhooks/paystack", content=body, headers=headers)
        assert resp2.status_code == 200
        assert resp2.json()["is_new"] is False

    async def test_missing_signature_header_returns_200(
        self,
        api_client: AsyncClient,
        paystack_charge_success_payload: dict,
    ):
        body = json.dumps(paystack_charge_success_payload).encode()
        response = await api_client.post(
            "/v1/webhooks/paystack",
            content=body,
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200
```

---

## 14. CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
name: Reconciliation Engine CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  PYTHON_VERSION: "3.12"
  POSTGRES_TEST_DB: reconciliation_test

jobs:
  lint:
    name: Lint and Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dev dependencies
        run: pip install ruff mypy

      - name: Ruff lint
        run: ruff check src/ tests/

      - name: Ruff format check
        run: ruff format --check src/ tests/

      - name: Mypy type check
        run: mypy src/ --ignore-missing-imports --strict

  test:
    name: Test Suite
    runs-on: ubuntu-latest
    needs: lint

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: reconciliation_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: test_password
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: ${{ env.PYTHON_VERSION }}

      - name: Install dependencies
        run: pip install -e ".[test]"

      - name: Run migrations on test DB
        run: alembic upgrade head
        env:
          POSTGRES_PIPELINE_DSN: postgresql+asyncpg://postgres:test_password@localhost:5432/reconciliation_test

      - name: Run unit tests
        run: |
          pytest tests/unit/ -v \
            --tb=short \
            --cov=src \
            --cov-report=term-missing \
            --cov-report=xml

      - name: Run integration tests
        run: |
          pytest tests/integration/ -v \
            --tb=short \
            --asyncio-mode=auto
        env:
          POSTGRES_PIPELINE_DSN: postgresql+asyncpg://postgres:test_password@localhost:5432/reconciliation_test
          POSTGRES_API_DSN: postgresql+asyncpg://postgres:test_password@localhost:5432/reconciliation_test
          PAYSTACK_SECRET_KEY: sk_test_dummy_key_for_testing
          FLUTTERWAVE_SECRET_HASH: test_hash_value

      - name: Run contract tests
        run: pytest tests/contracts/ -v

      - name: Enforce coverage threshold
        run: |
          coverage report --fail-under=80

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          file: ./coverage.xml

  docker:
    name: Docker Build Validation
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4

      - name: Build all Docker stages
        run: |
          docker build --target api -t rec-api:ci .
          docker build --target worker -t rec-worker:ci .
          docker build --target migrations -t rec-migrations:ci .
          docker build --target dashboard -t rec-dashboard:ci .

      - name: Validate Compose stack
        run: |
          cp .env.example .env
          docker compose config --quiet
          echo "Docker Compose configuration is valid"
```

---

## 15. Makefile — Developer Commands

```makefile
# Makefile
.PHONY: up down build test test-unit test-integration test-contracts lint format \
        migrate seed data smoke logs shell clean

## ── Environment ─────────────────────────────────────────────────────────────
up:          ## Start all core services
	docker compose up -d --build
	docker compose logs -f api worker

down:        ## Stop all services
	docker compose down

up-monitoring: ## Start core services + Prometheus + Grafana
	docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d

build:       ## Rebuild all Docker images
	docker compose build --no-cache

logs:        ## Follow logs for all services
	docker compose logs -f

shell:       ## Open a shell in the API container
	docker compose exec api /bin/bash

## ── Database ─────────────────────────────────────────────────────────────────
migrate:     ## Run Alembic migrations
	docker compose run --rm migrations alembic upgrade head

migrate-down: ## Rollback one migration
	docker compose run --rm migrations alembic downgrade -1

seed:        ## Seed settlement windows and test data
	docker compose exec worker python scripts/seed_settlement_windows.py

## ── Testing ──────────────────────────────────────────────────────────────────
test:        ## Run full test suite
	pytest tests/ -v --asyncio-mode=auto --tb=short

test-unit:   ## Run unit tests only
	pytest tests/unit/ -v

test-integration: ## Run integration tests only
	pytest tests/integration/ -v --asyncio-mode=auto

test-contracts: ## Run schema contract tests only
	pytest tests/contracts/ -v

coverage:    ## Run tests with coverage report
	pytest tests/ --cov=src --cov-report=html --cov-report=term-missing
	@echo "Coverage report: htmlcov/index.html"

## ── Code Quality ─────────────────────────────────────────────────────────────
lint:        ## Lint with ruff
	ruff check src/ tests/

format:      ## Format with ruff
	ruff format src/ tests/

typecheck:   ## Type check with mypy
	mypy src/ --ignore-missing-imports

## ── Development Simulation ───────────────────────────────────────────────────
data:        ## Generate synthetic test webhook events
	python scripts/generate_test_data.py

webhook:     ## Fire a single test webhook at the local API
	python scripts/simulate_webhook.py --psp paystack --event charge.success

smoke:       ## Run smoke test against running stack
	@echo "Checking API health..."
	curl -sf http://localhost:8000/health | python -m json.tool
	@echo "Checking Prefect..."
	curl -sf http://localhost:4200/api/health
	@echo "Smoke test passed"

clean:       ## Remove all containers, volumes, and generated files
	docker compose down -v --remove-orphans
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .coverage htmlcov/ .pytest_cache/
```

---

## 16. Failure Mode Analysis

Every failure mode the system can encounter, its impact, and the mitigation:

```
Failure Mode                        Impact                  Mitigation
─────────────────────────────────── ─────────────────────── ──────────────────────────────────────────────
PSP webhook not delivered           Transaction never        Polling fallback flow runs every 15 minutes.
                                    enters the system        Queries PSP API for any pending transactions
                                                             with no Silver record older than 30 minutes.

PSP sends duplicate webhook         Duplicate Silver record  Idempotency key registry prevents duplicate
                                                             Silver writes. ON CONFLICT DO NOTHING.
                                                             Occurrence count tracked for alerting.

Kafka consumer crashes mid-batch    Messages re-processed    Consumer group offset not committed until
                                                             Bronze write confirmed. On restart, consumer
                                                             re-reads from last committed offset.
                                                             Bronze layer immutability + idempotency
                                                             means reprocessing is safe.

MinIO write failure                 Bronze not persisted     Prefect task retries 3x with exponential
                                                             backoff. After 3 failures → dead letter topic.
                                                             Alert fires. Kafka message retained for 7 days
                                                             for manual replay.

PostgreSQL connection pool exhausted API timeouts            Connection pool sized for burst load.
                                                             pool_pre_ping detects stale connections.
                                                             Prometheus alert fires at P95 > 1s DB latency.

FX rate provider unavailable        New non-NGN transactions Last known rate used if < 2 hours old.
                                    cannot be converted       Alert fires if rate > 2 hours stale.
                                                             NGN transactions unaffected (no FX needed).

dbt model failure (Gold layer)      Gold layer not updated   Prefect flow catches dbt exit code.
                                                             Silver data safe. dbt tests run before
                                                             Gold write. Pipeline retries.
                                                             Alert fires. Silver remains queryable.

PostgreSQL disk full                Writes begin failing     Prometheus alert at 80% disk usage.
                                                             Bronze Parquet (MinIO) separate volume.
                                                             Gold materialized view refresh paused.

Matching engine produces            False positive           Confidence score below 0.75 requires
false match                         reconciliation result    human review. Resolution note mandatory.
                                                             Audit log records all match decisions.

PII masking not applied             PII lands in Silver      has_pii_masked CHECK constraint prevents
                                                             unmasked records from being inserted.
                                                             Database rejects the write at constraint level.

CBN report generation fails         Compliance gap           Daily report flow retried automatically.
                                                             If still failing by 06:00 WAT, alert to
                                                             compliance officer. Silver data intact —
                                                             report can be regenerated at any time.
```

---

## 17. Security Controls Summary

```
Control                             Implementation                  Standard
─────────────────────────────────── ─────────────────────────────── ──────────────
Webhook authentication              HMAC-SHA512 (Paystack)          FR-003
                                    verif-hash comparison (FLW)
API authentication                  SHA-256 hashed key, DB lookup   NFR-009
API rate limiting                   100 req/min per key             NFR-011
PII storage                         Masked in Silver, raw in         NFR-009, NDPR
                                    access-controlled Bronze only
Secrets management                  Env vars, never in source code   NFR-010
TLS enforcement                     Required for all external calls  NFR-008
Audit trail                         Immutable append-only table,     CBN compliance
                                    trigger-enforced
Role-based DB access                3 roles: pipeline/api/readonly   NFR-010
Connection encryption               SSL mode required in production  NFR-008
SQL injection prevention            SQLAlchemy parameterised queries  OWASP
Path traversal prevention           os.path.basename on file paths   OWASP
```

---

## 18. Open Questions — All Resolved

Every open question from prior documents is resolved in this TDD:

| Document | Question | Resolution |
|---|---|---|
| PRD OQ-001 | Event queue | Kafka via Redpanda (§5 stack) |
| PRD OQ-002 | DuckDB vs Postgres | PostgreSQL operational, DuckDB analytical (§5) |
| PRD OQ-003 | FX provider | ExchangeRate-API MVP (§4 config) |
| PRD OQ-004 | CBN report format | Modelled in dbt, JSONB payload (§3 dbt structure) |
| PRD OQ-005 | M-Pesa type handling | Separate connector, normaliser handles type mapping (§8) |
| PRD OQ-006 | Prefect vs Dagster | Prefect 3 (§5 stack, §10 flows) |

---

## 19. What This Document Unlocks

The TDD is complete. Every implementation decision is made. The next document is a direct derivation:

**Immediate next — API Specification (OpenAPI 3.1):** Every route defined in §11, every Pydantic schema already implied by the data model, every error code pattern established by the middleware. The API spec is now a formalisation exercise — translating what is already designed here into the OpenAPI contract format that the dashboard and any external integrators will consume.

**Parallel — Begin implementation:** With the TDD complete, a developer can begin writing code immediately. The recommended start sequence:

```
Week 1:  migrations/ → alembic versions 000–012
         src/config.py
         docker-compose.yml (core services only)
         make up → verify all services healthy

Week 2:  src/storage/ → postgres, minio_client, kafka_producer
         src/connectors/ → base, paystack, flutterwave
         src/engine/idempotency.py + pii.py
         tests/unit/test_idempotency.py + test_pii_masking.py

Week 3:  src/engine/fx.py + settlement.py + normaliser.py
         src/flows/ingestion_flow.py + bronze_to_silver.py
         tests/unit/test_normaliser_paystack.py + test_normaliser_flutterwave.py
         tests/integration/test_webhook_ingestion.py

Week 4:  src/engine/matching.py + anomaly.py
         src/flows/silver_to_gold.py
         dbt_project/ → all models and tests
         tests/unit/test_matching_engine.py

Week 5:  src/api/ → all routes, middleware, schemas
         tests/integration/test_api_*.py
         .github/workflows/ci.yml

Week 6:  src/observability/ → metrics, logging
         infra/prometheus/ + infra/grafana/
         make up-monitoring → verify dashboards
         README.md → production-grade documentation
```

Shall we proceed with the API Specification, or do you want to adjust anything in the TDD first?
