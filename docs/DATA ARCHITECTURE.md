# DATA ARCHITECTURE & PIPELINE BLUEPRINT

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0
**Last Updated:** May 2026

---

## 1. Architectural Philosophy

Before any schema or tool decision, three principles govern every choice in this document. These are not generic best practices — they are derived directly from the specific failure modes of financial reconciliation systems operating in the Nigerian PSP environment.

**Principle 1 — Bronze is Sacred.**
Raw events, once written, are never modified, never deleted, never transformed in place. The Bronze layer is the system's ground truth. If the matching engine produces a wrong result in six months, the ability to reprocess from Bronze without data loss is the difference between a recoverable bug and an unrecoverable financial discrepancy. Immutability is enforced at the storage level, not just by convention.

**Principle 2 — Money Doesn't Tolerate Eventual Consistency.**
DuckDB's single-writer model and its eventual consistency patterns are acceptable for analytics dashboards. They are not acceptable for a financial ledger where a duplicate record means a business thinks it received money it didn't, or vice versa. The Silver and Gold layers use PostgreSQL with full ACID guarantees. Analytical queries run against read replicas or exported snapshots — not against the operational store.

**Principle 3 — Every State Transition Is an Auditable Event.**
A transaction record doesn't get updated silently. Every change in status — from `pending` to `settled`, from `unmatched` to `matched`, from `open` discrepancy to `resolved` — is recorded with a timestamp, the triggering mechanism, and enough context to reconstruct why the change happened. This is a regulatory requirement (CBN audit trails) and an operational necessity (debugging reconciliation failures at 11 PM).

---

## 2. System Data Flow — End to End

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL EVENT SOURCES                            │
│                                                                             │
│   Paystack Webhook ──┐                                                      │
│   Flutterwave Webhook─┼──► FastAPI Ingestion Gateway                       │
│   M-Pesa Daraja ─────┘         │                                           │
│                                │  (validate HMAC, reject invalid)          │
│   PSP Polling Fallback ────────┘                                           │
│   (every 15 min via Prefect)                                               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INGESTION & QUEUE LAYER                             │
│                                                                             │
│   Kafka Topic: raw.paystack.events                                          │
│   Kafka Topic: raw.flutterwave.events                                       │
│   Kafka Topic: raw.mpesa.events          (Phase 2)                          │
│   Kafka Topic: raw.fx.rates              (continuous)                       │
│                                                                             │
│   Consumer Group: bronze-writer (exactly-once via idempotency key check)   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         🥉 BRONZE LAYER                                     │
│                     (Immutable Raw Storage)                                 │
│                                                                             │
│   Storage: Parquet files on MinIO (S3-compatible)                           │
│   Partitioned by: psp_name / event_date / hour                              │
│                                                                             │
│   bronze_paystack_events      ← raw Paystack JSON payloads                 │
│   bronze_flutterwave_events   ← raw Flutterwave JSON payloads              │
│   bronze_fx_rate_snapshots    ← FX rate captures at ingestion time         │
│   bronze_polling_records      ← fallback polling API responses             │
│                                                                             │
│   Metadata registry: PostgreSQL bronze_ingestion_log                       │
│   (file path, content hash, ingestion run ID, row count, status)           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                          Prefect Flow triggered
                          on Bronze write event
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         🥈 SILVER LAYER                                     │
│                   (Cleaned, Typed, Canonical)                               │
│                                                                             │
│   Storage: PostgreSQL (ACID, concurrent writes, FK constraints)             │
│                                                                             │
│   silver_canonical_transactions   ← normalised ledger across all PSPs      │
│   silver_fx_rate_snapshots        ← typed, validated FX rates              │
│   silver_idempotency_keys         ← deduplication registry                 │
│   silver_psp_settlement_windows   ← per-PSP settlement lag config          │
│   silver_transaction_audit_log    ← immutable state transition history     │
│                                                                             │
│   Pandera schema validation enforced before write                          │
│   PII fields masked at this layer (account numbers, names)                 │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                          Prefect Flow triggered
                          on Silver write completion
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         🥇 GOLD LAYER                                       │
│                  (Business Value, Reconciliation Truth)                     │
│                                                                             │
│   Storage: PostgreSQL (operational) + DuckDB (analytical read replica)     │
│                                                                             │
│   gold_reconciliation_pairs       ← matched transaction pairs              │
│   gold_discrepancies              ← unmatched / anomalous transactions     │
│   gold_reconciliation_summary     ← daily aggregated view (materialised)  │
│   gold_cbn_daily_returns          ← CBN-format report records             │
│   gold_exposure_tracker           ← running NGN exposure from open gaps   │
│                                                                             │
│   DuckDB reads from PostgreSQL via FDWB export (read-only, no contention) │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                    ┌────────────┴───────────┐
                    ▼                        ▼
         FastAPI Report API          Streamlit Dashboard
         (versioned, auth-gated)     (read-only DuckDB)
```

---

## 3. Technology Stack Decisions

These are resolved decisions, not options. Each has an explicit rationale tied to this system's requirements.

### 3.1 Event Queue — Apache Kafka (via Redpanda for local dev)

**Decision:** Kafka via Docker (Redpanda image for local development — same protocol, lower resource overhead).

**Why not Redis Streams:** Redis Streams lacks durable offset management and replay semantics at the level needed for a financial system. If the Bronze writer crashes mid-batch, Kafka's consumer group offset management guarantees exactly where to resume. Redis cannot make the same guarantee cleanly.

**Why not a Postgres-backed queue (like pgqueue or River):** Tempting for simplicity, but it creates a tight coupling between the ingestion layer and the Silver database. A Postgres queue that feeds a Postgres writer means database load spikes during ingestion bursts — exactly when financial systems need to be most stable.

**Why Kafka earns its complexity here:** The polling fallback (FR-005) and the webhook ingestion path both write to the same Kafka topics. The Bronze writer reads from one place regardless of source. This source-agnostic ingestion is only clean with a proper message queue.

**Topic design:**
```
raw.paystack.events         ← partitioned by transaction_reference (mod 12)
raw.flutterwave.events      ← partitioned by transaction_reference (mod 12)
raw.fx.rates                ← partitioned by currency_pair (mod 4)
raw.polling.fallback        ← partitioned by psp_name (mod 6)
pipeline.dead.letter        ← events that failed all processing attempts
```

**Retention:** 7 days on raw topics (allows full reprocessing window). Dead letter topic: 30 days.

---

### 3.2 Bronze Storage — Parquet on MinIO

**Decision:** Parquet files written to MinIO (local S3-compatible object store).

**Why Parquet over raw JSON files:** Parquet's columnar compression reduces storage by 60–80% over JSON for this event type. More importantly, DuckDB can query Parquet files directly using `read_parquet()` — enabling ad-hoc Bronze-layer investigation without a database engine.

**Why MinIO over local filesystem:** MinIO's S3-compatible API means the Bronze writer code is identical whether running locally or against real AWS S3 in production. This is a reversible decision (Principle 8 from your architecture principles) — swap the endpoint URL, not the code.

**Partition structure:**
```
s3://reconciliation-bronze/
  paystack/
    event_date=2026-05-01/
      hour=09/
        part-0001.parquet
        part-0002.parquet
  flutterwave/
    event_date=2026-05-01/
      hour=09/
        part-0001.parquet
  fx_rates/
    currency_pair=NGN-USD/
      event_date=2026-05-01/
        part-0001.parquet
```

**Immutability enforcement:** MinIO bucket configured with Object Lock in COMPLIANCE mode. No process — not even the pipeline — can modify or delete Bronze files once written. Reprocessing means reading existing files and writing new Silver records, never overwriting Bronze.

---

### 3.3 Silver & Gold Storage — PostgreSQL 16

**Decision:** PostgreSQL 16 as the primary operational store for Silver and Gold layers.

**Why not DuckDB for Silver/Gold:** DuckDB's single-writer constraint (acknowledged in the PRD open questions) is a hard blocker for a financial system. The webhook ingestion path, the polling fallback, and the Prefect orchestration flows all write concurrently. DuckDB would serialize these writes, creating a bottleneck and risking write failures under burst load (500 webhooks/minute from NFR-004).

**Why PostgreSQL earns its place:**
- ACID guarantees for financial data — non-negotiable
- Row-level locking handles concurrent PSP event writes cleanly
- `JSONB` columns allow storing contextual evidence without strict schema enforcement where needed
- `TIMESTAMPTZ` handles WAT/UTC timezone management correctly
- Native support for `UUID`, `ENUM` types, materialized views, and `CHECK` constraints — all needed here
- `pg_audit` extension for the CBN audit trail requirement

**DuckDB's role (retained):** DuckDB runs as an analytical sidecar. A Prefect flow exports Gold-layer snapshots to DuckDB periodically (every 15 minutes or on-demand). The Streamlit dashboard and heavy analytical queries run against DuckDB only — zero contention with operational PostgreSQL writes.

---

### 3.4 Orchestration — Prefect 3

**Decision:** Prefect 3 (self-hosted, Docker Compose).

**Why Prefect over Dagster:** Dagster's local development story requires more infrastructure (separate daemon, webserver, gRPC server). Prefect 3's server and worker run in two containers. For a solo engineer in a Docker Compose environment with port constraints, Prefect wins on operational simplicity without sacrificing capability.

**Why Prefect over Airflow:** Airflow's scheduler model is designed for time-based DAGs, not event-triggered flows. Prefect's event-driven deployment model (flows triggered by Kafka events or API calls) maps directly to this system's architecture.

---

### 3.5 Transformation — dbt Core (Silver → Gold)

**Decision:** dbt Core for Silver-to-Gold transformations.

**Why dbt here:** The Gold layer aggregations (reconciliation pairs, discrepancy classification, CBN report generation) are best expressed as SQL. dbt gives these SQL transforms: version control, documentation, lineage tracking, and testability. A `dbt test` run that fails because the matching logic produces unexpected results is far better than a silent Python bug in a Pandas transform.

**dbt project structure:**
```
dbt_project/
  models/
    silver/         ← Silver layer models (staging from Bronze)
    gold/           ← Gold layer models (business logic)
      reconciliation/
        gold_reconciliation_pairs.sql
        gold_discrepancies.sql
        gold_reconciliation_summary.sql
      reporting/
        gold_cbn_daily_returns.sql
        gold_exposure_tracker.sql
  tests/
    assert_no_duplicate_idempotency_keys.sql
    assert_fx_variance_within_threshold.sql
    assert_all_discrepancies_have_classification.sql
  sources.yml
  schema.yml
```

---

## 4. Bronze Layer — Detailed Design

### 4.1 Bronze Ingestion Log (PostgreSQL)

This table is the metadata registry for all Bronze files. It does not store raw events — those live in Parquet on MinIO. It answers: "What was ingested, when, from where, and is it valid?"

```sql
CREATE TABLE bronze_ingestion_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    psp_name            VARCHAR(50) NOT NULL,           -- paystack | flutterwave | mpesa
    source_type         VARCHAR(20) NOT NULL,           -- webhook | polling
    kafka_topic         VARCHAR(100) NOT NULL,
    kafka_partition     INTEGER NOT NULL,
    kafka_offset        BIGINT NOT NULL,
    content_hash        VARCHAR(64) NOT NULL,           -- SHA-256 of raw payload
    file_path           VARCHAR(500) NOT NULL,          -- MinIO path to Parquet file
    event_count         INTEGER NOT NULL,
    ingestion_run_id    UUID NOT NULL,
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              VARCHAR(20) NOT NULL            -- received | written | failed
        CHECK (status IN ('received', 'written', 'failed')),
    failure_reason      TEXT,
    
    UNIQUE (kafka_topic, kafka_partition, kafka_offset)  -- idempotency on Kafka offset
);

CREATE INDEX idx_bronze_log_psp_date 
    ON bronze_ingestion_log (psp_name, received_at);
CREATE INDEX idx_bronze_log_hash 
    ON bronze_ingestion_log (content_hash);
```

### 4.2 Bronze Parquet Schema — Paystack Events

The Parquet schema preserves the exact Paystack webhook structure. No field renaming. No type coercion. No dropping of unknown fields. If Paystack adds a field tomorrow, it lands in Bronze.

```python
# contracts/bronze/paystack_event_schema.py
import pyarrow as pa

PAYSTACK_BRONZE_SCHEMA = pa.schema([
    pa.field("_ingestion_id",       pa.string()),      # Our UUID, added at ingestion
    pa.field("_received_at",        pa.timestamp("us", tz="UTC")),
    pa.field("_source_type",        pa.string()),      # webhook | polling
    pa.field("_content_hash",       pa.string()),      # SHA-256
    pa.field("_kafka_offset",       pa.int64()),
    
    # Paystack envelope fields
    pa.field("event",               pa.string()),      # charge.success | transfer.success
    pa.field("data",                pa.string()),      # Raw JSON string — not parsed here
])

# Bronze preserves raw JSON in 'data' field.
# Silver is responsible for parsing and typing.
```

### 4.3 Bronze Parquet Schema — Flutterwave Events

```python
# contracts/bronze/flutterwave_event_schema.py

FLUTTERWAVE_BRONZE_SCHEMA = pa.schema([
    pa.field("_ingestion_id",       pa.string()),
    pa.field("_received_at",        pa.timestamp("us", tz="UTC")),
    pa.field("_source_type",        pa.string()),
    pa.field("_content_hash",       pa.string()),
    pa.field("_kafka_offset",       pa.int64()),
    
    # Flutterwave envelope fields
    pa.field("event",               pa.string()),      # charge.completed | transfer.completed
    pa.field("data",                pa.string()),      # Raw JSON string
])
```

### 4.4 Bronze FX Rate Snapshot Schema

```python
BRONZE_FX_RATE_SCHEMA = pa.schema([
    pa.field("_snapshot_id",        pa.string()),
    pa.field("_captured_at",        pa.timestamp("us", tz="UTC")),
    pa.field("_source_provider",    pa.string()),      # exchangerate-api | manual | etc.
    
    pa.field("base_currency",       pa.string()),      # NGN
    pa.field("quote_currency",      pa.string()),      # USD | GBP | EUR | KES
    pa.field("rate",                pa.float64()),
    pa.field("bid",                 pa.float64()),
    pa.field("ask",                 pa.float64()),
    pa.field("raw_response",        pa.string()),      # Full API response JSON
])
```

---

## 5. Silver Layer — Detailed Design

### 5.1 Canonical Transaction Ledger

This is the most important table in the system. Every PSP's transaction data normalises into this single schema. The matching engine operates on this table only — it never touches Bronze.

```sql
CREATE TYPE psp_name_enum AS ENUM ('paystack', 'flutterwave', 'mpesa', 'moniepoint');
CREATE TYPE settlement_status_enum AS ENUM ('pending', 'settled', 'failed', 'reversed', 'disputed');
CREATE TYPE transaction_type_enum AS ENUM ('credit', 'debit', 'reversal');

CREATE TABLE silver_canonical_transactions (
    -- Identity
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key             VARCHAR(200) NOT NULL UNIQUE,
        -- Format: {psp_name}:{psp_transaction_ref}:{event_type}
        -- Example: paystack:T_xyz123:charge.success

    -- Source Traceability
    bronze_ingestion_id         UUID NOT NULL REFERENCES bronze_ingestion_log(id),
    psp_name                    psp_name_enum NOT NULL,
    psp_transaction_ref         VARCHAR(200) NOT NULL,
    psp_event_type              VARCHAR(100) NOT NULL,
    psp_event_received_at       TIMESTAMPTZ NOT NULL,

    -- Our Internal Reference
    internal_ref                VARCHAR(100) NOT NULL UNIQUE
        DEFAULT 'REC-' || UPPER(SUBSTR(gen_random_uuid()::TEXT, 1, 8)),

    -- Transaction Classification
    transaction_type            transaction_type_enum NOT NULL,
    
    -- Amounts (always store original currency AND NGN equivalent)
    amount_raw                  NUMERIC(20, 6) NOT NULL CHECK (amount_raw >= 0),
    currency_raw                CHAR(3) NOT NULL,       -- ISO 4217: NGN, USD, GBP, KES
    amount_ngn                  NUMERIC(20, 6) NOT NULL CHECK (amount_ngn >= 0),
    fx_rate_snapshot_id         UUID REFERENCES silver_fx_rate_snapshots(id),
    fx_rate_applied             NUMERIC(20, 8),         -- NULL if currency_raw = NGN

    -- Party Information (masked at Silver — raw values never leave Bronze)
    sender_account_masked       VARCHAR(50),            -- e.g., ****6789
    sender_bank_code            VARCHAR(10),
    beneficiary_account_masked  VARCHAR(50),
    beneficiary_bank_code       VARCHAR(10),
    beneficiary_name_masked     VARCHAR(100),           -- First char + *** + last char
    
    -- Narration
    narration                   TEXT,

    -- Timing
    initiated_at                TIMESTAMPTZ NOT NULL,
    settled_at                  TIMESTAMPTZ,            -- NULL until settlement confirmed
    expected_settlement_at      TIMESTAMPTZ,            -- Computed from PSP settlement window
    
    -- Status
    settlement_status           settlement_status_enum NOT NULL DEFAULT 'pending',
    
    -- Metadata
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_by_run_id         UUID NOT NULL
);

-- Indexes optimised for matching engine query patterns
CREATE INDEX idx_silver_amount_ngn 
    ON silver_canonical_transactions (amount_ngn);
CREATE INDEX idx_silver_initiated_at 
    ON silver_canonical_transactions (initiated_at);
CREATE INDEX idx_silver_settled_at 
    ON silver_canonical_transactions (settled_at);
CREATE INDEX idx_silver_psp_ref 
    ON silver_canonical_transactions (psp_name, psp_transaction_ref);
CREATE INDEX idx_silver_status 
    ON silver_canonical_transactions (settlement_status);
CREATE INDEX idx_silver_beneficiary 
    ON silver_canonical_transactions (beneficiary_account_masked);

-- Composite index for the matching engine's primary query
CREATE INDEX idx_silver_matching_primary 
    ON silver_canonical_transactions (amount_ngn, initiated_at, settlement_status)
    WHERE settlement_status IN ('pending', 'settled');
```

### 5.2 FX Rate Snapshots

```sql
CREATE TABLE silver_fx_rate_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency_pair   VARCHAR(7) NOT NULL,    -- NGN/USD, NGN/GBP, etc.
    rate            NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
    bid             NUMERIC(20, 8),
    ask             NUMERIC(20, 8),
    source_provider VARCHAR(100) NOT NULL,
    captured_at     TIMESTAMPTZ NOT NULL,
    valid_from      TIMESTAMPTZ NOT NULL,
    valid_until     TIMESTAMPTZ,            -- NULL = current rate
    bronze_snapshot_id UUID NOT NULL,

    CONSTRAINT chk_bid_ask CHECK (bid IS NULL OR ask IS NULL OR bid <= ask)
);

CREATE UNIQUE INDEX idx_fx_current_rate 
    ON silver_fx_rate_snapshots (currency_pair) 
    WHERE valid_until IS NULL;

CREATE INDEX idx_fx_pair_time 
    ON silver_fx_rate_snapshots (currency_pair, captured_at DESC);
```

**Point-in-time FX lookup function:**
```sql
-- Called by the matching engine to get the correct rate for a historical transaction
CREATE OR REPLACE FUNCTION get_fx_rate_at(
    p_currency_pair VARCHAR(7),
    p_at_time TIMESTAMPTZ
) RETURNS NUMERIC AS $$
    SELECT rate
    FROM silver_fx_rate_snapshots
    WHERE currency_pair = p_currency_pair
      AND captured_at <= p_at_time
    ORDER BY captured_at DESC
    LIMIT 1;
$$ LANGUAGE SQL STABLE;
```

### 5.3 Idempotency Key Registry

```sql
CREATE TABLE silver_idempotency_keys (
    key                 VARCHAR(200) PRIMARY KEY,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    occurrence_count    INTEGER NOT NULL DEFAULT 1,
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    canonical_tx_id     UUID REFERENCES silver_canonical_transactions(id)
);
```

### 5.4 PSP Settlement Window Configuration

This table drives `expected_settlement_at` computation. It's data, not code — settlement windows change without a deploy.

```sql
CREATE TABLE silver_psp_settlement_windows (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    psp_name                psp_name_enum NOT NULL,
    transaction_type        transaction_type_enum NOT NULL,
    account_tier            VARCHAR(50) DEFAULT 'standard', -- for PSPs with tiered settlement
    settlement_lag_hours    NUMERIC(5, 2) NOT NULL,         -- e.g., 24.0 for T+1
    settlement_days         VARCHAR(20) DEFAULT 'business', -- business | calendar
    cutoff_time_wat         TIME,                           -- e.g., 16:00 WAT for same-day
    effective_from          DATE NOT NULL,
    effective_until         DATE,
    notes                   TEXT,
    
    UNIQUE (psp_name, transaction_type, account_tier, effective_from)
);

-- Seed data
INSERT INTO silver_psp_settlement_windows 
    (psp_name, transaction_type, settlement_lag_hours, settlement_days, cutoff_time_wat, effective_from)
VALUES
    ('paystack',     'credit', 24.0, 'business', '16:00', '2024-01-01'),
    ('flutterwave',  'credit', 24.0, 'business', '17:00', '2024-01-01'),
    ('mpesa',        'credit', 72.0, 'business', NULL,    '2024-01-01');
```

### 5.5 Transaction Audit Log

Every state change is an append-only record. No updates to this table, ever.

```sql
CREATE TABLE silver_transaction_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES silver_canonical_transactions(id),
    event_type      VARCHAR(100) NOT NULL,
        -- examples: STATUS_CHANGED | FX_RATE_APPLIED | MATCHING_ATTEMPTED
        --           DISCREPANCY_RAISED | DISCREPANCY_RESOLVED | MANUAL_OVERRIDE
    previous_state  JSONB,
    new_state       JSONB,
    triggered_by    VARCHAR(100) NOT NULL,  -- pipeline_run:{id} | api_user:{key} | system
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_id          UUID,
    notes           TEXT
);

CREATE INDEX idx_audit_transaction_id 
    ON silver_transaction_audit_log (transaction_id, occurred_at);
```

---

## 6. Gold Layer — Detailed Design

### 6.1 Reconciliation Pairs

```sql
CREATE TYPE match_strategy_enum AS ENUM ('exact_primary', 'probabilistic_secondary', 'manual');
CREATE TYPE pair_status_enum AS ENUM ('matched', 'discrepancy', 'under_review', 'resolved', 'false_positive');

CREATE TABLE gold_reconciliation_pairs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- The two transactions being reconciled
    -- transaction_a = the initiating/source transaction
    -- transaction_b = the expected settlement/receiving transaction
    transaction_a_id        UUID NOT NULL REFERENCES silver_canonical_transactions(id),
    transaction_b_id        UUID REFERENCES silver_canonical_transactions(id),
        -- NULL if no match found (pure discrepancy with no counterpart)

    -- Match Quality
    match_strategy          match_strategy_enum,
    confidence_score        NUMERIC(5, 4) CHECK (confidence_score BETWEEN 0 AND 1),
    match_evidence          JSONB,
        -- Stores what fields matched, similarity scores, etc.
        -- e.g.: {"amount_match": true, "timestamp_delta_seconds": 187,
        --        "beneficiary_similarity": 0.94, "fx_variance_pct": 0.003}

    -- Financial Reconciliation
    amount_a_ngn            NUMERIC(20, 6) NOT NULL,
    amount_b_ngn            NUMERIC(20, 6),
    amount_delta_ngn        NUMERIC(20, 6),             -- amount_b - amount_a
    fx_variance_pct         NUMERIC(10, 6),             -- % difference after FX adjustment
    within_fx_threshold     BOOLEAN,                    -- Is variance within configured 0.5%?

    -- Timing
    settlement_lag_actual_minutes   NUMERIC(10, 2),
    settlement_lag_expected_minutes NUMERIC(10, 2),
    settlement_on_time              BOOLEAN,

    -- Status
    status                  pair_status_enum NOT NULL DEFAULT 'matched',
    matched_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at             TIMESTAMPTZ,
    resolved_at             TIMESTAMPTZ,
    resolved_by             VARCHAR(100),
    resolution_note         TEXT,
    
    -- Lineage
    dbt_run_id              VARCHAR(100),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pairs_status ON gold_reconciliation_pairs (status);
CREATE INDEX idx_pairs_tx_a ON gold_reconciliation_pairs (transaction_a_id);
CREATE INDEX idx_pairs_tx_b ON gold_reconciliation_pairs (transaction_b_id);
CREATE INDEX idx_pairs_matched_at ON gold_reconciliation_pairs (matched_at DESC);
```

### 6.2 Discrepancy Table

```sql
CREATE TYPE discrepancy_class_enum AS ENUM (
    'missing_settlement',   -- Money sent, no settlement received
    'amount_mismatch',      -- Settlement received but wrong amount (beyond FX tolerance)
    'fx_variance',          -- Settlement correct but FX timing dispute
    'duplicate_credit',     -- Same settlement credited twice
    'unmatched_credit',     -- Settlement received with no initiating transaction found
    'late_settlement'       -- Settlement arrived but outside SLA window
);

CREATE TYPE discrepancy_status_enum AS ENUM ('open', 'under_review', 'resolved', 'false_positive', 'escalated');

CREATE TABLE gold_discrepancies (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reconciliation_pair_id      UUID REFERENCES gold_reconciliation_pairs(id),
    transaction_id              UUID NOT NULL REFERENCES silver_canonical_transactions(id),
    
    -- Classification
    classification              discrepancy_class_enum NOT NULL,
    confidence_score            NUMERIC(5, 4) NOT NULL,
    evidence                    JSONB NOT NULL,
        -- e.g.: {"expected_amount_ngn": 50000, "received_amount_ngn": 49500,
        --        "delta_ngn": -500, "delta_pct": -0.01,
        --        "expected_settlement_at": "2026-05-01T16:00:00Z",
        --        "actual_settled_at": null}
    
    -- Financial Exposure
    estimated_exposure_ngn      NUMERIC(20, 6) NOT NULL DEFAULT 0,
    
    -- Status & Resolution
    status                      discrepancy_status_enum NOT NULL DEFAULT 'open',
    raised_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at                 TIMESTAMPTZ,
    resolved_at                 TIMESTAMPTZ,
    resolved_by                 VARCHAR(100),
    resolution_note             TEXT,
    resolution_type             VARCHAR(50),
        -- found_in_next_batch | psp_confirmed_failure | manual_adjustment | write_off
    
    -- Alerting
    alert_sent                  BOOLEAN NOT NULL DEFAULT FALSE,
    alert_sent_at               TIMESTAMPTZ,
    escalated_at                TIMESTAMPTZ,
    
    -- Lineage
    dbt_run_id                  VARCHAR(100),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_discrepancy_status ON gold_discrepancies (status, raised_at DESC);
CREATE INDEX idx_discrepancy_class ON gold_discrepancies (classification, status);
CREATE INDEX idx_discrepancy_exposure ON gold_discrepancies (estimated_exposure_ngn DESC)
    WHERE status = 'open';
```

### 6.3 Reconciliation Summary (Materialized View)

```sql
CREATE MATERIALIZED VIEW gold_reconciliation_summary AS
SELECT
    DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos')   AS summary_date,
    ct.psp_name,
    COUNT(DISTINCT ct.id)                               AS total_transactions,
    COUNT(DISTINCT rp.id) 
        FILTER (WHERE rp.status = 'matched')            AS total_matched,
    COUNT(DISTINCT d.id) 
        FILTER (WHERE d.status = 'open')                AS total_open_discrepancies,
    COUNT(DISTINCT d.id) 
        FILTER (WHERE d.status = 'resolved')            AS total_resolved_discrepancies,
    SUM(ct.amount_ngn)                                  AS total_volume_ngn,
    SUM(ct.amount_ngn) 
        FILTER (WHERE rp.status = 'matched')            AS matched_volume_ngn,
    COALESCE(SUM(d.estimated_exposure_ngn) 
        FILTER (WHERE d.status = 'open'), 0)            AS open_exposure_ngn,
    ROUND(
        COUNT(DISTINCT rp.id) FILTER (WHERE rp.status = 'matched') * 100.0 
        / NULLIF(COUNT(DISTINCT ct.id), 0), 4
    )                                                   AS match_rate_pct,
    AVG(rp.settlement_lag_actual_minutes)               AS avg_settlement_lag_minutes,
    NOW()                                               AS last_refreshed_at

FROM silver_canonical_transactions ct
LEFT JOIN gold_reconciliation_pairs rp 
    ON ct.id = rp.transaction_a_id
LEFT JOIN gold_discrepancies d 
    ON ct.id = d.transaction_id

GROUP BY 
    DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos'),
    ct.psp_name;

CREATE UNIQUE INDEX idx_summary_date_psp 
    ON gold_reconciliation_summary (summary_date, psp_name);
```

**Refresh strategy:** Prefect flow triggers `REFRESH MATERIALIZED VIEW CONCURRENTLY gold_reconciliation_summary` after each Gold pipeline run. `CONCURRENTLY` means reads are not blocked during refresh.

### 6.4 CBN Daily Return Structure

```sql
CREATE TABLE gold_cbn_daily_returns (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_date                 DATE NOT NULL,
    generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_by_run_id         UUID NOT NULL,
    
    -- CBN fields (modelled on CBN transaction reporting requirements)
    total_transaction_count     INTEGER NOT NULL,
    total_credit_count          INTEGER NOT NULL,
    total_debit_count           INTEGER NOT NULL,
    total_credit_volume_ngn     NUMERIC(25, 2) NOT NULL,
    total_debit_volume_ngn      NUMERIC(25, 2) NOT NULL,
    cross_border_count          INTEGER NOT NULL DEFAULT 0,
    cross_border_volume_ngn     NUMERIC(25, 2) NOT NULL DEFAULT 0,
    suspicious_tx_count         INTEGER NOT NULL DEFAULT 0,
    unreconciled_count          INTEGER NOT NULL DEFAULT 0,
    unreconciled_exposure_ngn   NUMERIC(25, 2) NOT NULL DEFAULT 0,
    
    -- Report payload (CBN-format JSON, ready for submission)
    report_payload              JSONB NOT NULL,
    
    -- Submission tracking
    submission_status           VARCHAR(20) DEFAULT 'draft'
        CHECK (submission_status IN ('draft', 'approved', 'submitted', 'acknowledged')),
    approved_by                 VARCHAR(100),
    submitted_at                TIMESTAMPTZ,
    cbn_acknowledgement_ref     VARCHAR(100),
    
    UNIQUE (return_date)
);
```

---

## 7. Cross-Cutting Concerns

### 7.1 Idempotency — The Exact Mechanism

This is how exactly-once semantics are achieved without distributed transactions:

```
Webhook arrives at FastAPI
         │
         ▼
Compute idempotency_key = {psp_name}:{psp_transaction_ref}:{event_type}
         │
         ▼
Check silver_idempotency_keys WHERE key = computed_key
         │
    ┌────┴────┐
   Found    Not Found
    │              │
    ▼              ▼
Increment      Write to Kafka
occurrence_count   (Bronze write)
Update             │
last_seen_at       ▼
    │          Insert idempotency_key
    │          (with ON CONFLICT DO UPDATE)
    │              │
    ▼              ▼
Return HTTP    Continue pipeline
200 (already   
processed)         
```

The `ON CONFLICT DO UPDATE` on the idempotency key is atomic in PostgreSQL — there is no race condition between checking and inserting, even under concurrent requests.

### 7.2 PII Masking Strategy

PII masking happens at the Silver transformation stage. Bronze always retains the raw value in Parquet (access-controlled at the MinIO bucket level). Silver stores only masked values.

```python
# engine/pii.py

def mask_account_number(account: str) -> str:
    """
    10-digit NUBAN: show first 2 and last 2 digits.
    Example: 0123456789 → 01******89
    """
    if not account or len(account) < 4:
        return "****"
    return account[:2] + "*" * (len(account) - 4) + account[-2:]

def mask_name(name: str) -> str:
    """
    Full name: show first char of each word + asterisks.
    Example: 'Chioma Okonkwo' → 'C****** O*******'
    """
    if not name:
        return "****"
    parts = name.strip().split()
    return " ".join(p[0] + "*" * (len(p) - 1) for p in parts)

def mask_bvn(bvn: str) -> str:
    """BVN: 11 digits. Show only last 4."""
    if not bvn or len(bvn) < 4:
        return "***"
    return "*" * (len(bvn) - 4) + bvn[-4:]
```

### 7.3 FX Variance Classification Logic

This is the logic that resolves PRD FR-011 — distinguishing legitimate FX timing from genuine amount mismatches:

```python
# engine/fx_classifier.py
from decimal import Decimal

FX_VARIANCE_THRESHOLD_PCT = Decimal("0.005")  # 0.5% — configurable

def classify_amount_delta(
    amount_a_ngn: Decimal,
    amount_b_ngn: Decimal,
    fx_variance_pct: Decimal,
) -> tuple[str, bool]:
    """
    Returns: (discrepancy_classification, is_within_fx_threshold)
    
    Decision logic:
    - If delta > 0.5% AND no FX conversion involved → AMOUNT_MISMATCH
    - If delta > 0.5% AND FX conversion involved AND variance explainable 
      by rate timing → FX_VARIANCE (lower severity)
    - If delta <= 0.5% → no discrepancy, within acceptable tolerance
    """
    if amount_a_ngn == 0:
        return ("MISSING_SETTLEMENT", False)
    
    delta_pct = abs(amount_b_ngn - amount_a_ngn) / amount_a_ngn
    
    if delta_pct <= FX_VARIANCE_THRESHOLD_PCT:
        return (None, True)  # No discrepancy
    
    if fx_variance_pct is not None and delta_pct <= fx_variance_pct * Decimal("1.2"):
        # Delta is largely explained by FX rate timing — lower severity
        return ("FX_VARIANCE", False)
    
    return ("AMOUNT_MISMATCH", False)
```

---

## 8. Pipeline Orchestration Design

### 8.1 Prefect Flow Map

```
┌─────────────────────────────────────────────────────────┐
│  Flow 1: webhook_ingestion_flow                         │
│  Trigger: HTTP event (FastAPI → Prefect API)            │
│                                                         │
│  validate_signature(psp, payload, signature)            │
│    → compute_idempotency_key()                          │
│      → check_idempotency_registry()                     │
│        → [if new] publish_to_kafka()                    │
│          → write_bronze_parquet()                       │
│            → update_bronze_ingestion_log()              │
└─────────────────────────────────────────────────────────┘
                        │
               Kafka consumer triggers
                        │
┌─────────────────────────────────────────────────────────┐
│  Flow 2: bronze_to_silver_flow                          │
│  Trigger: Kafka message on raw.{psp}.events             │
│  Retries: 3, delay: 30s exponential                     │
│                                                         │
│  read_bronze_parquet(file_path)                         │
│    → validate_bronze_schema(pandera)                    │
│      → capture_fx_rate_snapshot(currency_pair, time)    │
│        → normalise_to_canonical_schema(psp_name)        │
│          → mask_pii_fields()                            │
│            → write_silver_canonical(ON CONFLICT SKIP)   │
│              → write_audit_log(STATUS: INGESTED)        │
└─────────────────────────────────────────────────────────┘
                        │
               Silver write event
                        │
┌─────────────────────────────────────────────────────────┐
│  Flow 3: silver_to_gold_flow (dbt-driven)               │
│  Trigger: Silver write completion event                 │
│  Retries: 2, delay: 60s                                 │
│                                                         │
│  run_dbt_model(gold_reconciliation_pairs)               │
│    → run_dbt_model(gold_discrepancies)                  │
│      → refresh_materialized_view(summary)               │
│        → run_dbt_tests()                                │
│          → [if tests pass] export_gold_to_duckdb()      │
│            → [if discrepancies] trigger_alert_flow()    │
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  Flow 4: polling_fallback_flow                          │
│  Trigger: Schedule (every 15 minutes)                   │
│                                                         │
│  query_pending_transactions(older_than=30min)           │
│    → poll_psp_api(psp_name, transaction_ref)            │
│      → [if status changed] publish_to_kafka()           │
│        → log_polling_record()                           │
└─────────────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────────────┐
│  Flow 5: daily_report_flow                              │
│  Trigger: Schedule (02:00 WAT daily)                    │
│                                                         │
│  generate_cbn_daily_return(yesterday)                   │
│    → validate_report_totals()                           │
│      → write_gold_cbn_daily_returns()                   │
│        → notify_compliance_team()                       │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Storage Architecture Summary

```
Component           Technology          Rationale
─────────────────── ─────────────────── ──────────────────────────────────────
Event Queue         Kafka (Redpanda)    Durable offsets, replay, source-agnostic
Bronze Files        Parquet on MinIO    Immutable, S3-compatible, DuckDB-readable
Bronze Metadata     PostgreSQL          Relational registry, queryable
Silver Layer        PostgreSQL 16       ACID, concurrent writes, FK constraints
Gold Layer          PostgreSQL 16       ACID, materialized views, audit trail
Analytical Queries  DuckDB              Zero-contention reads, fast aggregations
Orchestration       Prefect 3           Event-driven, Docker-native, retry logic
Transforms          dbt Core            Versioned SQL, testable, documented
Observability       Prometheus+Grafana  Operational metrics, pipeline health
```

---

## 10. Open Questions — Resolved from PRD

| PRD Ref | Question | Decision |
|---|---|---|
| OQ-001 | Event queue technology | Kafka (Redpanda) — see §3.1 |
| OQ-002 | DuckDB vs Postgres for Silver/Gold | PostgreSQL for operational, DuckDB for analytics — see §3.3 |
| OQ-003 | FX rate provider | ExchangeRate-API (MVP), CBN rate endpoint (Phase 2 research) |
| OQ-004 | CBN report format | Modelled in §6.4, exact schema confirmed via CBN public returns |
| OQ-005 | M-Pesa transaction type handling | Separate Bronze schema, normalised in Silver via PSP-specific mapper |
| OQ-006 | Prefect vs Dagster | Prefect 3 — see §3.4 |

---

## 11. What This Document Unlocks

With the Data Architecture Blueprint complete, you can now build these next documents with full precision — no more open questions blocking design decisions:

**Immediate next — ERD + Database Schema:** Every table is defined above. The ERD is the visual representation of the foreign key relationships across all layers. That document is now a formalisation exercise, not a discovery exercise.

**Then — Data Dictionary:** Every field in every table above needs a formal definition, its business meaning, validation rules, and example values. This is the document that proves domain depth to a technical reviewer.

**Then — TDD:** The stack is decided. The component interaction is mapped. The TDD fills in the implementation detail — class structures, API middleware, Docker Compose service definitions, environment variable schema, local development setup.

The blueprint is solid. Shall we move to the ERD and Data Dictionary next, or do you want to review and adjust anything in this document first?
