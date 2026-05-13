# ENTITY RELATIONSHIP DIAGRAM & DATABASE SCHEMA

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, Data Architecture Blueprint v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose and Scope

The Data Architecture Blueprint defined *what* data flows through the system and *why* each layer exists. This document defines the *exact shape* of every entity in the system — field names, types, constraints, indexes, relationships, and the reasoning behind non-obvious decisions.

This document governs three things simultaneously:

- **The ERD** — visual representation of entity relationships across all layers
- **The complete DDL** — production-ready SQL `CREATE` statements for every table
- **The schema decision log** — why specific type choices, constraints, and index strategies were made

Any discrepancy between this document and actual database migrations is a bug in the migration, not in this document.

---

## 2. Naming Conventions

Established here. Enforced everywhere. No exceptions.

```
Tables:         {layer}_{entity_name}          snake_case, plural nouns
                bronze_ingestion_log
                silver_canonical_transactions
                gold_reconciliation_pairs
                system_pipeline_runs

Columns:        snake_case, descriptive, no abbreviations except
                established domain terms (psp, fx, ngn, bvn, cbn)
                
Primary Keys:   id                             UUID always, never serial integer
Foreign Keys:   {referenced_table_singular}_{referenced_column}
                e.g., fx_rate_snapshot_id → silver_fx_rate_snapshots.id
                
Timestamps:     {event}_at                     TIMESTAMPTZ always, never DATE alone
                created_at, updated_at on every mutable table
                occurred_at for immutable event records

Booleans:       is_{state} or has_{thing}      positive framing only
                is_within_fx_threshold, has_pii_masked

Enums:          {domain}_{type}_enum
                psp_name_enum, settlement_status_enum

Indexes:        idx_{table_short}_{columns}
                idx_silver_tx_psp_ref
                idx_gold_pairs_status

Constraints:    chk_{table_short}_{rule}
                chk_silver_tx_positive_amount
```

---

## 3. Entity Overview — All Layers

Before the full ERD, a structural overview showing entity count and primary purpose per layer:

```
LAYER           ENTITY                              TYPE        PURPOSE
─────────────── ─────────────────────────────────── ─────────── ──────────────────────────────
SYSTEM          system_pipeline_runs                Table       Prefect flow run registry
SYSTEM          system_api_keys                     Table       API authentication
SYSTEM          system_alert_events                 Table       Outbound alert audit trail

BRONZE          bronze_ingestion_log                Table       Parquet file metadata registry

SILVER          silver_canonical_transactions       Table       Core normalised ledger
SILVER          silver_fx_rate_snapshots            Table       Point-in-time FX rate store
SILVER          silver_idempotency_keys             Table       Deduplication registry
SILVER          silver_psp_settlement_windows       Table       Per-PSP settlement config
SILVER          silver_transaction_audit_log        Table       Immutable state change history

GOLD            gold_reconciliation_pairs           Table       Matched transaction pairs
GOLD            gold_discrepancies                  Table       Unmatched / anomalous events
GOLD            gold_cbn_daily_returns              Table       CBN-format report records
GOLD            gold_exposure_tracker               Table       Running open exposure by PSP
GOLD            gold_reconciliation_summary         Mat. View   Aggregated daily summary
```

---

## 4. Full Entity Relationship Diagram

```
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║  SYSTEM LAYER                                                                            ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║  ┌─────────────────────────┐        ┌─────────────────────────┐                         ║
║  │  system_pipeline_runs   │        │  system_api_keys        │                         ║
║  ├─────────────────────────┤        ├─────────────────────────┤                         ║
║  │ PK id: UUID             │        │ PK id: UUID             │                         ║
║  │    flow_name: VARCHAR   │        │    key_hash: VARCHAR    │                         ║
║  │    flow_version: VARCHAR│        │    client_name: VARCHAR │                         ║
║  │    status: ENUM         │        │    scopes: TEXT[]       │                         ║
║  │    started_at: TSTZ     │        │    is_active: BOOLEAN   │                         ║
║  │    completed_at: TSTZ   │        │    created_at: TSTZ     │                         ║
║  │    records_processed:INT│        │    expires_at: TSTZ     │                         ║
║  │    error_message: TEXT  │        │    last_used_at: TSTZ   │                         ║
║  └────────────┬────────────┘        └─────────────────────────┘                         ║
║               │ 1                                                                        ║
║               │ referenced by all pipeline-                                              ║
║               │ triggered writes                                                         ║
╚═══════════════╪══════════════════════════════════════════════════════════════════════════╝
                │
                │
╔═══════════════╪══════════════════════════════════════════════════════════════════════════╗
║  BRONZE LAYER │                                                                          ║
╠═══════════════╪══════════════════════════════════════════════════════════════════════════╣
║               │ N                                                                        ║
║  ┌────────────▼────────────────────────────────────────────────────┐                    ║
║  │  bronze_ingestion_log                                           │                    ║
║  ├─────────────────────────────────────────────────────────────────┤                    ║
║  │ PK  id: UUID                                                    │                    ║
║  │     psp_name: ENUM         -- paystack|flutterwave|mpesa        │                    ║
║  │     source_type: ENUM      -- webhook|polling                   │                    ║
║  │     kafka_topic: VARCHAR                                        │                    ║
║  │     kafka_partition: INT                                        │                    ║
║  │     kafka_offset: BIGINT                                        │                    ║
║  │     content_hash: VARCHAR  -- SHA-256 of raw payload            │                    ║
║  │     file_path: VARCHAR     -- MinIO Parquet path                │                    ║
║  │     event_count: INT                                            │                    ║
║  │  FK ingestion_run_id → system_pipeline_runs.id                 │                    ║
║  │     received_at: TSTZ                                           │                    ║
║  │     status: ENUM           -- received|written|failed           │                    ║
║  │     failure_reason: TEXT                                        │                    ║
║  │                                                                 │                    ║
║  │  UNIQUE (kafka_topic, kafka_partition, kafka_offset)            │                    ║
║  └─────────────────────────────┬───────────────────────────────────┘                    ║
║                                │ 1                                                       ║
╚════════════════════════════════╪════════════════════════════════════════════════════════╝
                                 │
                                 │
╔════════════════════════════════╪════════════════════════════════════════════════════════╗
║  SILVER LAYER                  │                                                         ║
╠════════════════════════════════╪════════════════════════════════════════════════════════╣
║                                │ N                                                       ║
║  ┌─────────────────────────────▼───────────────────────────────────┐                    ║
║  │  silver_canonical_transactions          [CORE ENTITY]           │                    ║
║  ├─────────────────────────────────────────────────────────────────┤                    ║
║  │ PK  id: UUID                                                    │                    ║
║  │     idempotency_key: VARCHAR(200) UNIQUE                        │◄──────────┐        ║
║  │  FK bronze_ingestion_id → bronze_ingestion_log.id               │           │        ║
║  │     psp_name: psp_name_enum                                     │           │        ║
║  │     psp_transaction_ref: VARCHAR(200)                           │           │        ║
║  │     psp_event_type: VARCHAR(100)                                │           │        ║
║  │     psp_event_received_at: TSTZ                                 │           │        ║
║  │     internal_ref: VARCHAR(100) UNIQUE                           │           │        ║
║  │     transaction_type: transaction_type_enum                     │           │        ║
║  │     amount_raw: NUMERIC(20,6)                                   │           │        ║
║  │     currency_raw: CHAR(3)                                       │           │        ║
║  │     amount_ngn: NUMERIC(20,6)                                   │           │        ║
║  │  FK fx_rate_snapshot_id → silver_fx_rate_snapshots.id           │           │        ║
║  │     fx_rate_applied: NUMERIC(20,8)                              │           │        ║
║  │     sender_account_masked: VARCHAR(50)                          │           │        ║
║  │     sender_bank_code: VARCHAR(10)                               │           │        ║
║  │     beneficiary_account_masked: VARCHAR(50)                     │           │        ║
║  │     beneficiary_bank_code: VARCHAR(10)                          │           │        ║
║  │     beneficiary_name_masked: VARCHAR(100)                       │           │        ║
║  │     narration: TEXT                                             │           │        ║
║  │     initiated_at: TSTZ                                          │           │        ║
║  │     settled_at: TSTZ                                            │           │        ║
║  │     expected_settlement_at: TSTZ                                │           │        ║
║  │     settlement_status: settlement_status_enum                   │           │        ║
║  │     created_at: TSTZ                                            │           │        ║
║  │     updated_at: TSTZ                                            │           │        ║
║  │  FK processed_by_run_id → system_pipeline_runs.id              │           │        ║
║  └──┬──────────────────────────────────────────────────────────────┘           │        ║
║     │ 1                                                                         │        ║
║     │                                                                           │        ║
║     ├──────────────────────────┐                                                │        ║
║     │ 1:N (audit trail)        │ 1:1 (idempotency)                             │        ║
║     ▼                          ▼                                                │        ║
║  ┌──────────────────────┐  ┌──────────────────────────────────┐                │        ║
║  │ silver_transaction_  │  │  silver_idempotency_keys         │                │        ║
║  │ audit_log            │  ├──────────────────────────────────┤                │        ║
║  ├──────────────────────┤  │ PK key: VARCHAR(200)             ├────────────────┘        ║
║  │ PK id: UUID          │  │    first_seen_at: TSTZ           │                         ║
║  │ FK transaction_id    │  │    occurrence_count: INT         │                         ║
║  │    event_type:VARCHAR│  │    last_seen_at: TSTZ            │                         ║
║  │    previous_state:   │  │ FK canonical_tx_id →            │                         ║
║  │      JSONB           │  │    silver_canonical_             │                         ║
║  │    new_state: JSONB  │  │    transactions.id               │                         ║
║  │    triggered_by:     │  └──────────────────────────────────┘                         ║
║  │      VARCHAR         │                                                                ║
║  │    occurred_at: TSTZ │  ┌──────────────────────────────────┐                         ║
║  │    run_id: UUID      │  │  silver_fx_rate_snapshots        │                         ║
║  │    notes: TEXT       │  ├──────────────────────────────────┤                         ║
║  └──────────────────────┘  │ PK id: UUID                      │◄──── referenced by      ║
║                             │    currency_pair: VARCHAR(7)     │      canonical_tx        ║
║                             │    rate: NUMERIC(20,8)           │      fx_rate_snapshot_id ║
║                             │    bid: NUMERIC(20,8)            │                         ║
║                             │    ask: NUMERIC(20,8)            │                         ║
║                             │    source_provider: VARCHAR      │                         ║
║                             │    captured_at: TSTZ             │                         ║
║                             │    valid_from: TSTZ              │                         ║
║                             │    valid_until: TSTZ             │                         ║
║                             │ FK bronze_snapshot_id →          │                         ║
║                             │    bronze_ingestion_log.id       │                         ║
║                             └──────────────────────────────────┘                         ║
║                                                                                          ║
║  ┌──────────────────────────────────────────────────────────────────┐                   ║
║  │  silver_psp_settlement_windows           [CONFIG TABLE]          │                   ║
║  ├──────────────────────────────────────────────────────────────────┤                   ║
║  │ PK id: UUID                                                      │                   ║
║  │    psp_name: psp_name_enum                                       │                   ║
║  │    transaction_type: transaction_type_enum                       │                   ║
║  │    account_tier: VARCHAR(50)                                     │                   ║
║  │    settlement_lag_hours: NUMERIC(5,2)                            │                   ║
║  │    settlement_days: VARCHAR(20)                                  │                   ║
║  │    cutoff_time_wat: TIME                                         │                   ║
║  │    effective_from: DATE                                          │                   ║
║  │    effective_until: DATE                                         │                   ║
║  │    notes: TEXT                                                   │                   ║
║  │  UNIQUE (psp_name, transaction_type, account_tier, effective_from) │                 ║
║  └──────────────────────────────────────────────────────────────────┘                   ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
                    │                                │
                    │ 1:N (transaction_a)            │ 0:1 (transaction_b)
                    ▼                                ▼
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║  GOLD LAYER                                                                              ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║                                                                                          ║
║  ┌─────────────────────────────────────────────────────────────────┐                    ║
║  │  gold_reconciliation_pairs                [MATCHING TRUTH]      │                    ║
║  ├─────────────────────────────────────────────────────────────────┤                    ║
║  │ PK  id: UUID                                                    │                    ║
║  │  FK transaction_a_id → silver_canonical_transactions.id         │                    ║
║  │  FK transaction_b_id → silver_canonical_transactions.id (NULL)  │                    ║
║  │     match_strategy: match_strategy_enum                         │                    ║
║  │     confidence_score: NUMERIC(5,4)                              │                    ║
║  │     match_evidence: JSONB                                        │                    ║
║  │     amount_a_ngn: NUMERIC(20,6)                                 │                    ║
║  │     amount_b_ngn: NUMERIC(20,6)                                 │                    ║
║  │     amount_delta_ngn: NUMERIC(20,6)                             │                    ║
║  │     fx_variance_pct: NUMERIC(10,6)                              │                    ║
║  │     is_within_fx_threshold: BOOLEAN                             │                    ║
║  │     settlement_lag_actual_minutes: NUMERIC(10,2)                │                    ║
║  │     settlement_lag_expected_minutes: NUMERIC(10,2)              │                    ║
║  │     is_settlement_on_time: BOOLEAN                              │                    ║
║  │     status: pair_status_enum                                    │◄──────┐            ║
║  │     matched_at: TSTZ                                            │       │            ║
║  │     reviewed_at: TSTZ                                           │       │ 1:N        ║
║  │     resolved_at: TSTZ                                           │       │            ║
║  │     resolved_by: VARCHAR(100)                                   │       │            ║
║  │     resolution_note: TEXT                                       │       │            ║
║  │  FK dbt_run_id → system_pipeline_runs.id                        │       │            ║
║  │     created_at: TSTZ                                            │       │            ║
║  │     updated_at: TSTZ                                            │       │            ║
║  └─────────────────────────────────────────────────────────────────┘       │            ║
║                          │ 1                                                │            ║
║                          │                                                  │            ║
║                          ▼ N                                                │            ║
║  ┌─────────────────────────────────────────────────────────────────┐        │            ║
║  │  gold_discrepancies                  [ANOMALY REGISTRY]         │        │            ║
║  ├─────────────────────────────────────────────────────────────────┤        │            ║
║  │ PK  id: UUID                                                    │        │            ║
║  │  FK reconciliation_pair_id → gold_reconciliation_pairs.id (NULL)├────────┘            ║
║  │  FK transaction_id → silver_canonical_transactions.id           │                    ║
║  │     classification: discrepancy_class_enum                      │                    ║
║  │     confidence_score: NUMERIC(5,4)                              │                    ║
║  │     evidence: JSONB                                             │                    ║
║  │     estimated_exposure_ngn: NUMERIC(20,6)                       │                    ║
║  │     status: discrepancy_status_enum                             │                    ║
║  │     raised_at: TSTZ                                             │                    ║
║  │     reviewed_at: TSTZ                                           │                    ║
║  │     resolved_at: TSTZ                                           │                    ║
║  │     resolved_by: VARCHAR(100)                                   │                    ║
║  │     resolution_note: TEXT                                       │                    ║
║  │     resolution_type: VARCHAR(50)                                │                    ║
║  │     has_alert_sent: BOOLEAN                                     │                    ║
║  │     alert_sent_at: TSTZ                                         │                    ║
║  │     escalated_at: TSTZ                                          │                    ║
║  │  FK dbt_run_id → system_pipeline_runs.id                        │                    ║
║  │     created_at: TSTZ                                            │                    ║
║  │     updated_at: TSTZ                                            │                    ║
║  └─────────────────────────────────────────────────────────────────┘                    ║
║                                                                                          ║
║  ┌─────────────────────────────────────┐  ┌───────────────────────────────────────┐     ║
║  │  gold_cbn_daily_returns             │  │  gold_exposure_tracker                │     ║
║  ├─────────────────────────────────────┤  ├───────────────────────────────────────┤     ║
║  │ PK id: UUID                         │  │ PK id: UUID                           │     ║
║  │    return_date: DATE UNIQUE         │  │    snapshot_date: DATE                │     ║
║  │    generated_at: TSTZ               │  │    psp_name: psp_name_enum            │     ║
║  │ FK generated_by_run_id →            │  │    classification: discrepancy_class  │     ║
║  │    system_pipeline_runs.id          │  │    open_discrepancy_count: INT        │     ║
║  │    total_transaction_count: INT     │  │    total_exposure_ngn: NUMERIC(20,6)  │     ║
║  │    total_credit_count: INT          │  │    oldest_open_discrepancy_at: TSTZ   │     ║
║  │    total_debit_count: INT           │  │    computed_at: TSTZ                  │     ║
║  │    total_credit_volume_ngn:         │  │ FK computed_by_run_id →              │     ║
║  │      NUMERIC(25,2)                  │  │    system_pipeline_runs.id            │     ║
║  │    total_debit_volume_ngn:          │  │                                       │     ║
║  │      NUMERIC(25,2)                  │  │  UNIQUE (snapshot_date, psp_name,     │     ║
║  │    cross_border_count: INT          │  │          classification)              │     ║
║  │    cross_border_volume_ngn:         │  └───────────────────────────────────────┘     ║
║  │      NUMERIC(25,2)                  │                                                ║
║  │    suspicious_tx_count: INT         │  ┌───────────────────────────────────────┐     ║
║  │    unreconciled_count: INT          │  │  system_alert_events                  │     ║
║  │    unreconciled_exposure_ngn:       │  ├───────────────────────────────────────┤     ║
║  │      NUMERIC(25,2)                  │  │ PK id: UUID                           │     ║
║  │    report_payload: JSONB            │  │ FK discrepancy_id →                   │     ║
║  │    submission_status: ENUM          │  │    gold_discrepancies.id (NULL)        │     ║
║  │    approved_by: VARCHAR             │  │    alert_channel: VARCHAR(50)         │     ║
║  │    submitted_at: TSTZ               │  │    alert_type: VARCHAR(50)            │     ║
║  │    cbn_acknowledgement_ref: VARCHAR │  │    recipient: VARCHAR(200)            │     ║
║  └─────────────────────────────────────┘  │    payload: JSONB                     │     ║
║                                           │    status: VARCHAR(20)                │     ║
║                                           │    sent_at: TSTZ                      │     ║
║                                           │    delivery_confirmed_at: TSTZ        │     ║
║                                           │    failure_reason: TEXT               │     ║
║                                           └───────────────────────────────────────┘     ║
║                                                                                          ║
║  ╔══════════════════════════════════════════════════════════════════════════╗            ║
║  ║  gold_reconciliation_summary          [MATERIALIZED VIEW]               ║            ║
║  ╠══════════════════════════════════════════════════════════════════════════╣            ║
║  ║  summary_date | psp_name | total_transactions | total_matched |         ║            ║
║  ║  total_open_discrepancies | total_volume_ngn | matched_volume_ngn |     ║            ║
║  ║  open_exposure_ngn | match_rate_pct | avg_settlement_lag_minutes |      ║            ║
║  ║  last_refreshed_at                                                      ║            ║
║  ║                                                                         ║            ║
║  ║  Source: silver_canonical_transactions JOIN gold_reconciliation_pairs   ║            ║
║  ║          LEFT JOIN gold_discrepancies                                   ║            ║
║  ║  Refresh: CONCURRENTLY after each silver_to_gold_flow completion        ║            ║
║  ╚══════════════════════════════════════════════════════════════════════════╝            ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
```

---

## 5. Relationship Matrix

Precise cardinalities for every FK relationship in the system:

```
PARENT TABLE                        CHILD TABLE                         CARDINALITY   FK COLUMN
─────────────────────────────────── ─────────────────────────────────── ───────────── ────────────────────────────
system_pipeline_runs                bronze_ingestion_log                1 : N         ingestion_run_id
system_pipeline_runs                silver_canonical_transactions       1 : N         processed_by_run_id
system_pipeline_runs                gold_reconciliation_pairs           1 : N         dbt_run_id
system_pipeline_runs                gold_discrepancies                  1 : N         dbt_run_id
system_pipeline_runs                gold_cbn_daily_returns              1 : 1         generated_by_run_id
system_pipeline_runs                gold_exposure_tracker               1 : N         computed_by_run_id

bronze_ingestion_log                silver_canonical_transactions       1 : N         bronze_ingestion_id
bronze_ingestion_log                silver_fx_rate_snapshots            1 : 1         bronze_snapshot_id

silver_canonical_transactions       silver_idempotency_keys             1 : 1         canonical_tx_id
silver_canonical_transactions       silver_transaction_audit_log        1 : N         transaction_id
silver_canonical_transactions       gold_reconciliation_pairs (side A)  1 : N         transaction_a_id
silver_canonical_transactions       gold_reconciliation_pairs (side B)  1 : 0..1      transaction_b_id
silver_canonical_transactions       gold_discrepancies                  1 : N         transaction_id

silver_fx_rate_snapshots            silver_canonical_transactions       1 : N         fx_rate_snapshot_id

gold_reconciliation_pairs           gold_discrepancies                  1 : N         reconciliation_pair_id
gold_discrepancies                  system_alert_events                 1 : N         discrepancy_id
```

---

## 6. Complete DDL — Production Schema

### 6.1 Database Setup and Extensions

```sql
-- migrations/000_setup.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- trigram indexes for fuzzy name matching
CREATE EXTENSION IF NOT EXISTS "btree_gist";   -- range overlap indexes for time windows
CREATE EXTENSION IF NOT EXISTS "pgaudit";      -- CBN audit trail requirement

-- Application schemas — separate namespaces per layer
CREATE SCHEMA IF NOT EXISTS system_layer;
CREATE SCHEMA IF NOT EXISTS bronze_layer;
CREATE SCHEMA IF NOT EXISTS silver_layer;
CREATE SCHEMA IF NOT EXISTS gold_layer;

-- All tables use public schema for MVP simplicity.
-- Schema separation is the production migration path.
```

### 6.2 Enumerated Types

```sql
-- migrations/001_enum_types.sql

CREATE TYPE psp_name_enum AS ENUM (
    'paystack',
    'flutterwave',
    'mpesa',
    'moniepoint'
);

CREATE TYPE source_type_enum AS ENUM (
    'webhook',
    'polling'
);

CREATE TYPE ingestion_status_enum AS ENUM (
    'received',
    'written',
    'failed'
);

CREATE TYPE settlement_status_enum AS ENUM (
    'pending',
    'settled',
    'failed',
    'reversed',
    'disputed'
);

CREATE TYPE transaction_type_enum AS ENUM (
    'credit',
    'debit',
    'reversal'
);

CREATE TYPE match_strategy_enum AS ENUM (
    'exact_primary',
    'probabilistic_secondary',
    'manual'
);

CREATE TYPE pair_status_enum AS ENUM (
    'matched',
    'discrepancy',
    'under_review',
    'resolved',
    'false_positive'
);

CREATE TYPE discrepancy_class_enum AS ENUM (
    'missing_settlement',
    'amount_mismatch',
    'fx_variance',
    'duplicate_credit',
    'unmatched_credit',
    'late_settlement'
);

CREATE TYPE discrepancy_status_enum AS ENUM (
    'open',
    'under_review',
    'resolved',
    'false_positive',
    'escalated'
);

CREATE TYPE cbn_submission_status_enum AS ENUM (
    'draft',
    'approved',
    'submitted',
    'acknowledged'
);

CREATE TYPE alert_channel_enum AS ENUM (
    'slack',
    'email',
    'pagerduty',
    'webhook'
);

CREATE TYPE alert_status_enum AS ENUM (
    'queued',
    'sent',
    'delivered',
    'failed'
);

CREATE TYPE pipeline_status_enum AS ENUM (
    'running',
    'completed',
    'failed',
    'cancelled'
);
```

### 6.3 System Layer Tables

```sql
-- migrations/002_system_tables.sql

CREATE TABLE system_pipeline_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flow_name               VARCHAR(200) NOT NULL,
    flow_version            VARCHAR(50),
    prefect_flow_run_id     VARCHAR(200) UNIQUE,    -- Prefect's own run ID for correlation
    status                  pipeline_status_enum NOT NULL DEFAULT 'running',
    triggered_by            VARCHAR(100) NOT NULL,
        -- webhook:{psp}:{ref} | schedule | manual | api_user:{key}
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMPTZ,
    duration_seconds        NUMERIC(10, 3)
        GENERATED ALWAYS AS (
            EXTRACT(EPOCH FROM (completed_at - started_at))
        ) STORED,
    records_processed       INTEGER DEFAULT 0,
    records_failed          INTEGER DEFAULT 0,
    error_message           TEXT,
    error_traceback         TEXT,
    metadata                JSONB DEFAULT '{}'
        -- Stores flow-specific context: {billing_period, psp_name, file_path, etc.}
);

CREATE INDEX idx_pipeline_runs_status
    ON system_pipeline_runs (status, started_at DESC);
CREATE INDEX idx_pipeline_runs_flow
    ON system_pipeline_runs (flow_name, started_at DESC);


CREATE TABLE system_api_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Key is hashed at rest — the raw key is shown to the user once on creation
    -- Storage: SHA-256(raw_key) — never the raw key itself
    key_hash            VARCHAR(64) NOT NULL UNIQUE,
    key_prefix          VARCHAR(8) NOT NULL,
        -- First 8 chars of raw key, stored plain for display/identification
        -- e.g., "reck_A3f" — lets users identify which key without exposing it

    client_name         VARCHAR(200) NOT NULL,
    client_description  TEXT,
    scopes              TEXT[] NOT NULL DEFAULT ARRAY['read'],
        -- ['read'] | ['read', 'write'] | ['read', 'write', 'admin']

    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,            -- NULL = no expiry
    last_used_at        TIMESTAMPTZ,
    usage_count         BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT chk_api_key_scopes
        CHECK (scopes <@ ARRAY['read', 'write', 'admin']::TEXT[])
);

CREATE INDEX idx_api_keys_hash
    ON system_api_keys (key_hash)
    WHERE is_active = TRUE;


CREATE TABLE system_alert_events (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- discrepancy_id is nullable — alerts can fire for pipeline failures too
    discrepancy_id          UUID REFERENCES gold_discrepancies(id) ON DELETE SET NULL,
    alert_channel           alert_channel_enum NOT NULL,
    alert_type              VARCHAR(100) NOT NULL,
        -- discrepancy_raised | pipeline_failure | exposure_threshold_breached
        -- late_settlement_sla | daily_summary
    recipient               VARCHAR(200) NOT NULL,
        -- Slack channel, email address, webhook URL (masked in logs)
    payload                 JSONB NOT NULL,
        -- Full alert payload, sanitised (no raw PII)
    status                  alert_status_enum NOT NULL DEFAULT 'queued',
    queued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at                 TIMESTAMPTZ,
    delivery_confirmed_at   TIMESTAMPTZ,
    failure_reason          TEXT,
    retry_count             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_alert_events_discrepancy
    ON system_alert_events (discrepancy_id, sent_at DESC);
CREATE INDEX idx_alert_events_status
    ON system_alert_events (status, queued_at)
    WHERE status IN ('queued', 'failed');
```

### 6.4 Bronze Layer

```sql
-- migrations/003_bronze_tables.sql

CREATE TABLE bronze_ingestion_log (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    psp_name            psp_name_enum NOT NULL,
    source_type         source_type_enum NOT NULL,
    kafka_topic         VARCHAR(200) NOT NULL,
    kafka_partition     INTEGER NOT NULL CHECK (kafka_partition >= 0),
    kafka_offset        BIGINT NOT NULL CHECK (kafka_offset >= 0),
    content_hash        CHAR(64) NOT NULL,          -- SHA-256, always 64 hex chars
    file_path           VARCHAR(1000) NOT NULL,      -- Full MinIO path
    event_count         INTEGER NOT NULL CHECK (event_count > 0),
    ingestion_run_id    UUID NOT NULL REFERENCES system_pipeline_runs(id),
    received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status              ingestion_status_enum NOT NULL DEFAULT 'received',
    failure_reason      TEXT,

    -- Kafka offset uniqueness is the Bronze idempotency guarantee
    CONSTRAINT uq_bronze_kafka_offset
        UNIQUE (kafka_topic, kafka_partition, kafka_offset),

    -- A failed record can be retried — update status, never insert duplicate
    CONSTRAINT chk_bronze_failure_reason
        CHECK (
            (status = 'failed' AND failure_reason IS NOT NULL)
            OR status != 'failed'
        )
);

CREATE INDEX idx_bronze_log_psp_date
    ON bronze_ingestion_log (psp_name, received_at DESC);
CREATE INDEX idx_bronze_log_hash
    ON bronze_ingestion_log (content_hash);
CREATE INDEX idx_bronze_log_status
    ON bronze_ingestion_log (status)
    WHERE status IN ('received', 'failed');
```

### 6.5 Silver Layer

```sql
-- migrations/004_silver_fx_snapshots.sql
-- Created before canonical_transactions because of FK dependency

CREATE TABLE silver_fx_rate_snapshots (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    currency_pair       VARCHAR(7) NOT NULL,
        -- Format: {BASE}/{QUOTE} — always NGN as base for this system
        -- Valid: NGN/USD, NGN/GBP, NGN/EUR, NGN/KES
    rate                NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
    bid                 NUMERIC(20, 8) CHECK (bid > 0),
    ask                 NUMERIC(20, 8) CHECK (ask > 0),
    mid                 NUMERIC(20, 8)
        GENERATED ALWAYS AS (
            CASE WHEN bid IS NOT NULL AND ask IS NOT NULL
            THEN (bid + ask) / 2
            ELSE rate
            END
        ) STORED,
    spread_pct          NUMERIC(10, 6)
        GENERATED ALWAYS AS (
            CASE WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid > 0
            THEN ((ask - bid) / bid) * 100
            ELSE NULL
            END
        ) STORED,
    source_provider     VARCHAR(100) NOT NULL,
    captured_at         TIMESTAMPTZ NOT NULL,
    valid_from          TIMESTAMPTZ NOT NULL,
    valid_until         TIMESTAMPTZ,                -- NULL = this is the current rate
    bronze_snapshot_id  UUID REFERENCES bronze_ingestion_log(id),

    CONSTRAINT chk_fx_bid_ask_order
        CHECK (bid IS NULL OR ask IS NULL OR bid <= ask),
    CONSTRAINT chk_fx_valid_range
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT chk_fx_currency_pair_format
        CHECK (currency_pair ~ '^[A-Z]{3}/[A-Z]{3}$')
);

-- Only one current rate per currency pair (valid_until IS NULL)
CREATE UNIQUE INDEX idx_fx_current_rate
    ON silver_fx_rate_snapshots (currency_pair)
    WHERE valid_until IS NULL;

CREATE INDEX idx_fx_pair_time
    ON silver_fx_rate_snapshots (currency_pair, captured_at DESC);


-- Point-in-time FX rate lookup — used by matching engine and Silver transform
CREATE OR REPLACE FUNCTION get_fx_rate_at(
    p_currency_pair VARCHAR(7),
    p_at_time       TIMESTAMPTZ
)
RETURNS TABLE (
    snapshot_id     UUID,
    rate            NUMERIC(20, 8),
    captured_at     TIMESTAMPTZ,
    source_provider VARCHAR(100)
)
LANGUAGE SQL STABLE AS $$
    SELECT
        id,
        rate,
        captured_at,
        source_provider
    FROM silver_fx_rate_snapshots
    WHERE currency_pair = p_currency_pair
      AND captured_at <= p_at_time
    ORDER BY captured_at DESC
    LIMIT 1;
$$;
```

```sql
-- migrations/005_silver_canonical_transactions.sql

CREATE TABLE silver_canonical_transactions (

    -- ── Identity ──────────────────────────────────────────────────────────
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    idempotency_key             VARCHAR(200) NOT NULL UNIQUE,
        -- Composite: {psp_name}:{psp_transaction_ref}:{event_type}
        -- Example:   paystack:T_abc123xyz:charge.success
        -- This key is the system's deduplication guarantee

    internal_ref                VARCHAR(100) NOT NULL UNIQUE
        DEFAULT 'REC-' || UPPER(REPLACE(gen_random_uuid()::TEXT, '-', '')),
        -- Human-readable reference for support queries
        -- Example: REC-A3F9B2C1D4E5F6A7B8C9D0E1

    -- ── Source Traceability ───────────────────────────────────────────────
    bronze_ingestion_id         UUID NOT NULL
        REFERENCES bronze_ingestion_log(id) ON DELETE RESTRICT,
    psp_name                    psp_name_enum NOT NULL,
    psp_transaction_ref         VARCHAR(200) NOT NULL,
    psp_event_type              VARCHAR(100) NOT NULL,
    psp_event_received_at       TIMESTAMPTZ NOT NULL,

    -- ── Classification ────────────────────────────────────────────────────
    transaction_type            transaction_type_enum NOT NULL,

    -- ── Amounts ──────────────────────────────────────────────────────────
    -- Both the original currency amount and the NGN equivalent are stored.
    -- We never discard the source currency — FX reconstruction must be possible.
    amount_raw                  NUMERIC(20, 6) NOT NULL
        CHECK (amount_raw >= 0),
    currency_raw                CHAR(3) NOT NULL,
        -- ISO 4217: NGN, USD, GBP, EUR, KES
    amount_ngn                  NUMERIC(20, 6) NOT NULL
        CHECK (amount_ngn >= 0),
    fx_rate_snapshot_id         UUID
        REFERENCES silver_fx_rate_snapshots(id) ON DELETE RESTRICT,
        -- NULL only when currency_raw = 'NGN' (no FX conversion needed)
    fx_rate_applied             NUMERIC(20, 8),
        -- The actual rate used for the conversion at settlement time

    -- ── Party Information (PII-masked at this layer) ──────────────────────
    -- Raw PII lives only in Bronze Parquet, access-controlled at MinIO level.
    -- Silver stores masked versions only.
    sender_account_masked       VARCHAR(50),
        -- NUBAN format: 01******89 (first 2, last 2 visible)
    sender_bank_code            VARCHAR(10),
        -- Bank codes are not PII — public CBN data
    sender_bank_name            VARCHAR(200),
    beneficiary_account_masked  VARCHAR(50),
    beneficiary_bank_code       VARCHAR(10),
    beneficiary_bank_name       VARCHAR(200),
    beneficiary_name_masked     VARCHAR(200),
        -- C****** O******* (first char per word visible)

    -- ── Transaction Narrative ────────────────────────────────────────────
    narration                   TEXT,
        -- Truncated to 500 chars; PII stripped by Silver transform

    -- ── Timing ──────────────────────────────────────────────────────────
    initiated_at                TIMESTAMPTZ NOT NULL,
    settled_at                  TIMESTAMPTZ,
        -- NULL until settlement confirmation received
    expected_settlement_at      TIMESTAMPTZ,
        -- Computed from silver_psp_settlement_windows at ingestion time
    settlement_sla_breached     BOOLEAN
        GENERATED ALWAYS AS (
            CASE
                WHEN settled_at IS NOT NULL
                     AND expected_settlement_at IS NOT NULL
                     AND settled_at > expected_settlement_at
                THEN TRUE
                WHEN expected_settlement_at IS NOT NULL
                     AND settled_at IS NULL
                     AND NOW() > expected_settlement_at
                THEN TRUE
                ELSE FALSE
            END
        ) STORED,

    -- ── Status ──────────────────────────────────────────────────────────
    settlement_status           settlement_status_enum NOT NULL DEFAULT 'pending',

    -- ── Metadata ─────────────────────────────────────────────────────────
    has_pii_masked              BOOLEAN NOT NULL DEFAULT FALSE,
        -- Explicit flag — Silver transform sets TRUE after masking
        -- Allows auditors to verify masking was applied
    psp_metadata                JSONB DEFAULT '{}',
        -- PSP-specific fields that don't map to canonical schema
        -- e.g., Paystack's 'channel' (card|bank|ussd), Flutterwave's 'app_fee'

    -- ── Lineage ──────────────────────────────────────────────────────────
    processed_by_run_id         UUID NOT NULL
        REFERENCES system_pipeline_runs(id) ON DELETE RESTRICT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Cross-field Constraints ──────────────────────────────────────────
    CONSTRAINT chk_silver_tx_fx_required
        CHECK (
            (currency_raw = 'NGN' AND fx_rate_snapshot_id IS NULL)
            OR
            (currency_raw != 'NGN' AND fx_rate_snapshot_id IS NOT NULL)
        ),
    CONSTRAINT chk_silver_tx_pii_masked
        CHECK (has_pii_masked = TRUE),
        -- Enforces that PII masking is not optional — Silver write fails if flag is FALSE
    CONSTRAINT chk_silver_tx_settled_after_initiated
        CHECK (settled_at IS NULL OR settled_at >= initiated_at)
);

-- ── Indexes ──────────────────────────────────────────────────────────────

-- Primary matching engine query pattern
CREATE INDEX idx_silver_tx_matching_primary
    ON silver_canonical_transactions (amount_ngn, initiated_at, settlement_status)
    WHERE settlement_status IN ('pending', 'settled');

-- PSP reference lookup (for polling fallback and webhook dedup)
CREATE INDEX idx_silver_tx_psp_ref
    ON silver_canonical_transactions (psp_name, psp_transaction_ref);

-- Time-range queries (dashboard, CBN reports)
CREATE INDEX idx_silver_tx_initiated_at
    ON silver_canonical_transactions (initiated_at DESC);
CREATE INDEX idx_silver_tx_settled_at
    ON silver_canonical_transactions (settled_at DESC)
    WHERE settled_at IS NOT NULL;

-- Beneficiary fuzzy match support (trigram index for probabilistic matching)
CREATE INDEX idx_silver_tx_beneficiary_trgm
    ON silver_canonical_transactions
    USING GIN (beneficiary_name_masked gin_trgm_ops);

-- Status + PSP for operational queries
CREATE INDEX idx_silver_tx_status_psp
    ON silver_canonical_transactions (settlement_status, psp_name, created_at DESC);

-- SLA breach monitoring
CREATE INDEX idx_silver_tx_sla_breached
    ON silver_canonical_transactions (expected_settlement_at)
    WHERE settlement_status = 'pending'
      AND expected_settlement_at IS NOT NULL;


-- ── Audit trigger ────────────────────────────────────────────────────────
-- Automatically writes to audit log on status change
CREATE OR REPLACE FUNCTION fn_silver_tx_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.settlement_status IS DISTINCT FROM NEW.settlement_status THEN
        INSERT INTO silver_transaction_audit_log (
            transaction_id,
            event_type,
            previous_state,
            new_state,
            triggered_by,
            run_id
        ) VALUES (
            NEW.id,
            'STATUS_CHANGED',
            jsonb_build_object('settlement_status', OLD.settlement_status),
            jsonb_build_object('settlement_status', NEW.settlement_status),
            'system:trigger',
            NEW.processed_by_run_id
        );
    END IF;

    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_silver_tx_audit
    BEFORE UPDATE ON silver_canonical_transactions
    FOR EACH ROW EXECUTE FUNCTION fn_silver_tx_audit_trigger();
```

```sql
-- migrations/006_silver_supporting_tables.sql

CREATE TABLE silver_idempotency_keys (
    key                 VARCHAR(200) PRIMARY KEY,
        -- {psp_name}:{psp_transaction_ref}:{event_type}
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    occurrence_count    INTEGER NOT NULL DEFAULT 1
        CHECK (occurrence_count >= 1),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    canonical_tx_id     UUID
        REFERENCES silver_canonical_transactions(id) ON DELETE SET NULL
        -- SET NULL if transaction is somehow deleted (should not happen — tracked for forensics)
);

CREATE INDEX idx_idempotency_tx_id
    ON silver_idempotency_keys (canonical_tx_id);


CREATE TABLE silver_psp_settlement_windows (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    psp_name                psp_name_enum NOT NULL,
    transaction_type        transaction_type_enum NOT NULL,
    account_tier            VARCHAR(50) NOT NULL DEFAULT 'standard',
        -- PSPs have tiered accounts with different settlement speeds
        -- Paystack: standard | growth | enterprise
        -- Flutterwave: starter | growth | enterprise
    settlement_lag_hours    NUMERIC(5, 2) NOT NULL CHECK (settlement_lag_hours > 0),
        -- e.g., 24.0 = T+1 day, 1.5 = 90 minutes
    settlement_days         VARCHAR(20) NOT NULL DEFAULT 'business'
        CHECK (settlement_days IN ('business', 'calendar')),
    cutoff_time_wat         TIME,
        -- Transactions after cutoff roll to next settlement cycle
        -- NULL = no intraday cutoff (settlement always next business day)
    effective_from          DATE NOT NULL,
    effective_until         DATE,
        -- NULL = currently active window
    notes                   TEXT,

    CONSTRAINT uq_settlement_window
        UNIQUE (psp_name, transaction_type, account_tier, effective_from),
    CONSTRAINT chk_settlement_window_dates
        CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE INDEX idx_settlement_windows_active
    ON silver_psp_settlement_windows (psp_name, transaction_type, effective_from DESC)
    WHERE effective_until IS NULL;


CREATE TABLE silver_transaction_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL
        REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
        -- RESTRICT: never allow a transaction to be deleted if audit trail exists
    event_type      VARCHAR(100) NOT NULL,
        -- STATUS_CHANGED | FX_RATE_APPLIED | MATCHING_ATTEMPTED
        -- DISCREPANCY_RAISED | DISCREPANCY_RESOLVED | MANUAL_OVERRIDE
        -- PII_MASKED | POLLING_FALLBACK_TRIGGERED
    previous_state  JSONB,
    new_state       JSONB NOT NULL,
    triggered_by    VARCHAR(200) NOT NULL,
        -- pipeline_run:{uuid} | api_user:{key_prefix} | system:trigger | manual:{user}
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_id          UUID REFERENCES system_pipeline_runs(id),
    notes           TEXT
    -- No updated_at — this table is append-only, never updated
    -- No delete permissions granted to application user on this table
);

CREATE INDEX idx_audit_log_transaction
    ON silver_transaction_audit_log (transaction_id, occurred_at DESC);
CREATE INDEX idx_audit_log_event_type
    ON silver_transaction_audit_log (event_type, occurred_at DESC);
CREATE INDEX idx_audit_log_run
    ON silver_transaction_audit_log (run_id)
    WHERE run_id IS NOT NULL;
```

### 6.6 Gold Layer

```sql
-- migrations/007_gold_reconciliation_pairs.sql

CREATE TABLE gold_reconciliation_pairs (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── The Two Sides of the Reconciliation ──────────────────────────────
    -- transaction_a: the initiating / outgoing transaction
    -- transaction_b: the expected settlement / incoming confirmation
    -- transaction_b_id is NULL for DISCREPANCY pairs with no counterpart found
    transaction_a_id                UUID NOT NULL
        REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
    transaction_b_id                UUID
        REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,

    -- ── Match Quality ──────────────────────────────────────────────────
    match_strategy                  match_strategy_enum,
        -- NULL if no match found (pure discrepancy record)
    confidence_score                NUMERIC(5, 4)
        CHECK (confidence_score BETWEEN 0 AND 1),
    match_evidence                  JSONB,
        -- Structured evidence from the matching engine:
        -- {
        --   "amount_exact_match": true,
        --   "timestamp_delta_seconds": 1847,
        --   "beneficiary_account_match": true,
        --   "beneficiary_name_similarity": 0.94,
        --   "fx_variance_pct": 0.0031,
        --   "matching_fields_used": ["amount_ngn", "beneficiary_account_masked"]
        -- }

    -- ── Financial Reconciliation ─────────────────────────────────────────
    amount_a_ngn                    NUMERIC(20, 6) NOT NULL CHECK (amount_a_ngn >= 0),
    amount_b_ngn                    NUMERIC(20, 6) CHECK (amount_b_ngn >= 0),
    amount_delta_ngn                NUMERIC(20, 6),
        -- GENERATED: amount_b_ngn - amount_a_ngn
        -- Negative = underpayment, Positive = overpayment
    fx_variance_pct                 NUMERIC(10, 6),
    is_within_fx_threshold          BOOLEAN,
        -- TRUE if abs(fx_variance_pct) <= configured threshold (0.5%)

    -- ── Timing Analysis ──────────────────────────────────────────────────
    settlement_lag_actual_minutes   NUMERIC(10, 2),
        -- COMPUTED: (transaction_b.settled_at - transaction_a.initiated_at) in minutes
    settlement_lag_expected_minutes NUMERIC(10, 2),
        -- From silver_psp_settlement_windows for this PSP/type/tier
    is_settlement_on_time           BOOLEAN,

    -- ── Status & Resolution ──────────────────────────────────────────────
    status                          pair_status_enum NOT NULL DEFAULT 'matched',
    matched_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at                     TIMESTAMPTZ,
    resolved_at                     TIMESTAMPTZ,
    resolved_by                     VARCHAR(200),
    resolution_note                 TEXT,

    -- ── Lineage ──────────────────────────────────────────────────────────
    dbt_run_id                      UUID
        REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Constraints ──────────────────────────────────────────────────────
    -- A transaction cannot be reconciled against itself
    CONSTRAINT chk_pairs_different_transactions
        CHECK (transaction_a_id != transaction_b_id),
    -- Resolved pairs must have resolution metadata
    CONSTRAINT chk_pairs_resolution_complete
        CHECK (
            status != 'resolved'
            OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
        )
);

CREATE INDEX idx_gold_pairs_status
    ON gold_reconciliation_pairs (status, matched_at DESC);
CREATE INDEX idx_gold_pairs_tx_a
    ON gold_reconciliation_pairs (transaction_a_id);
CREATE INDEX idx_gold_pairs_tx_b
    ON gold_reconciliation_pairs (transaction_b_id)
    WHERE transaction_b_id IS NOT NULL;
CREATE INDEX idx_gold_pairs_confidence
    ON gold_reconciliation_pairs (confidence_score DESC)
    WHERE status = 'matched';
CREATE INDEX idx_gold_pairs_open
    ON gold_reconciliation_pairs (matched_at DESC)
    WHERE status IN ('discrepancy', 'under_review');
```

```sql
-- migrations/008_gold_discrepancies.sql

CREATE TABLE gold_discrepancies (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── Links ─────────────────────────────────────────────────────────────
    reconciliation_pair_id      UUID
        REFERENCES gold_reconciliation_pairs(id) ON DELETE SET NULL,
        -- NULL for discrepancies raised independently of the matching engine
        -- (e.g., duplicate credit detected without a pair)
    transaction_id              UUID NOT NULL
        REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,

    -- ── Classification ────────────────────────────────────────────────────
    classification              discrepancy_class_enum NOT NULL,
    confidence_score            NUMERIC(5, 4) NOT NULL
        CHECK (confidence_score BETWEEN 0 AND 1),
    evidence                    JSONB NOT NULL,
        -- Classification-specific evidence structure.
        -- missing_settlement: {expected_at, hours_overdue, psp_name}
        -- amount_mismatch: {expected_ngn, received_ngn, delta_ngn, delta_pct}
        -- fx_variance: {expected_rate, applied_rate, variance_pct, threshold_pct}
        -- duplicate_credit: {original_tx_id, duplicate_tx_id, delta_seconds}
        -- unmatched_credit: {received_amount_ngn, psp_name, reference}
        -- late_settlement: {expected_at, actual_at, lag_hours, sla_hours}

    -- ── Financial Exposure ────────────────────────────────────────────────
    estimated_exposure_ngn      NUMERIC(20, 6) NOT NULL DEFAULT 0
        CHECK (estimated_exposure_ngn >= 0),
        -- Best estimate of money at risk.
        -- For missing_settlement: full transaction amount
        -- For amount_mismatch: absolute delta
        -- For fx_variance: delta beyond threshold

    -- ── Status & Lifecycle ────────────────────────────────────────────────
    status                      discrepancy_status_enum NOT NULL DEFAULT 'open',
    raised_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at                 TIMESTAMPTZ,
    resolved_at                 TIMESTAMPTZ,
    resolved_by                 VARCHAR(200),
    resolution_note             TEXT,
    resolution_type             VARCHAR(100),
        -- found_in_next_batch | psp_confirmed_failure | manual_adjustment
        -- write_off | false_positive_reclassified | timing_delay_resolved

    -- ── Alerting ──────────────────────────────────────────────────────────
    has_alert_sent              BOOLEAN NOT NULL DEFAULT FALSE,
    alert_sent_at               TIMESTAMPTZ,
    escalated_at                TIMESTAMPTZ,

    -- ── Lineage ──────────────────────────────────────────────────────────
    dbt_run_id                  UUID
        REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- ── Constraints ──────────────────────────────────────────────────────
    CONSTRAINT chk_discrepancy_resolution_complete
        CHECK (
            status NOT IN ('resolved', 'false_positive')
            OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
        ),
    CONSTRAINT chk_discrepancy_escalation_sequence
        CHECK (escalated_at IS NULL OR escalated_at >= raised_at)
);

CREATE INDEX idx_discrepancy_status_raised
    ON gold_discrepancies (status, raised_at DESC);
CREATE INDEX idx_discrepancy_classification
    ON gold_discrepancies (classification, status);
CREATE INDEX idx_discrepancy_exposure
    ON gold_discrepancies (estimated_exposure_ngn DESC)
    WHERE status = 'open';
CREATE INDEX idx_discrepancy_alert_pending
    ON gold_discrepancies (raised_at)
    WHERE has_alert_sent = FALSE AND status = 'open';
CREATE INDEX idx_discrepancy_transaction
    ON gold_discrepancies (transaction_id);
```

```sql
-- migrations/009_gold_reporting_tables.sql

CREATE TABLE gold_cbn_daily_returns (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_date                 DATE NOT NULL UNIQUE,
    generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    generated_by_run_id         UUID NOT NULL
        REFERENCES system_pipeline_runs(id) ON DELETE RESTRICT,

    -- ── CBN Report Totals ─────────────────────────────────────────────────
    total_transaction_count     INTEGER NOT NULL CHECK (total_transaction_count >= 0),
    total_credit_count          INTEGER NOT NULL CHECK (total_credit_count >= 0),
    total_debit_count           INTEGER NOT NULL CHECK (total_debit_count >= 0),
    total_credit_volume_ngn     NUMERIC(25, 2) NOT NULL CHECK (total_credit_volume_ngn >= 0),
    total_debit_volume_ngn      NUMERIC(25, 2) NOT NULL CHECK (total_debit_volume_ngn >= 0),
    cross_border_count          INTEGER NOT NULL DEFAULT 0,
    cross_border_volume_ngn     NUMERIC(25, 2) NOT NULL DEFAULT 0,
    suspicious_tx_count         INTEGER NOT NULL DEFAULT 0,
    unreconciled_count          INTEGER NOT NULL DEFAULT 0,
    unreconciled_exposure_ngn   NUMERIC(25, 2) NOT NULL DEFAULT 0,

    -- ── Internal Validation Totals ────────────────────────────────────────
    matched_count               INTEGER NOT NULL DEFAULT 0,
    match_rate_pct              NUMERIC(7, 4),
    open_discrepancy_count      INTEGER NOT NULL DEFAULT 0,

    -- ── Report Payload ────────────────────────────────────────────────────
    report_payload              JSONB NOT NULL,
        -- Full CBN-format JSON ready for submission.
        -- Validated against CBN return template schema before insert.

    -- ── Submission Lifecycle ──────────────────────────────────────────────
    submission_status           cbn_submission_status_enum NOT NULL DEFAULT 'draft',
    approved_by                 VARCHAR(200),
    approved_at                 TIMESTAMPTZ,
    submitted_at                TIMESTAMPTZ,
    cbn_acknowledgement_ref     VARCHAR(200),
    acknowledgement_received_at TIMESTAMPTZ,

    CONSTRAINT chk_cbn_credit_debit_sum
        CHECK (total_credit_count + total_debit_count <= total_transaction_count),
    CONSTRAINT chk_cbn_submission_approved
        CHECK (
            submission_status NOT IN ('submitted', 'acknowledged')
            OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
        )
);

CREATE INDEX idx_cbn_returns_status
    ON gold_cbn_daily_returns (submission_status, return_date DESC);


CREATE TABLE gold_exposure_tracker (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date               DATE NOT NULL,
    psp_name                    psp_name_enum NOT NULL,
    classification              discrepancy_class_enum NOT NULL,
    open_discrepancy_count      INTEGER NOT NULL DEFAULT 0,
    total_exposure_ngn          NUMERIC(20, 6) NOT NULL DEFAULT 0,
    oldest_open_discrepancy_at  TIMESTAMPTZ,
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    computed_by_run_id          UUID
        REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,

    CONSTRAINT uq_exposure_snapshot
        UNIQUE (snapshot_date, psp_name, classification)
);

CREATE INDEX idx_exposure_date
    ON gold_exposure_tracker (snapshot_date DESC, total_exposure_ngn DESC);
```

```sql
-- migrations/010_gold_materialized_view.sql

CREATE MATERIALIZED VIEW gold_reconciliation_summary AS
SELECT
    DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos') AS summary_date,
    ct.psp_name,

    -- Volume metrics
    COUNT(DISTINCT ct.id)                              AS total_transactions,
    SUM(ct.amount_ngn)                                 AS total_volume_ngn,

    -- Matching metrics
    COUNT(DISTINCT rp.id)
        FILTER (WHERE rp.status = 'matched')           AS total_matched,
    SUM(ct.amount_ngn)
        FILTER (WHERE rp.status = 'matched')           AS matched_volume_ngn,
    ROUND(
        COUNT(DISTINCT rp.id) FILTER (WHERE rp.status = 'matched') * 100.0
        / NULLIF(COUNT(DISTINCT ct.id), 0), 4
    )                                                  AS match_rate_pct,

    -- Discrepancy metrics
    COUNT(DISTINCT d.id)
        FILTER (WHERE d.status = 'open')               AS open_discrepancy_count,
    COUNT(DISTINCT d.id)
        FILTER (WHERE d.status = 'resolved')           AS resolved_discrepancy_count,
    COALESCE(
        SUM(d.estimated_exposure_ngn)
        FILTER (WHERE d.status = 'open'), 0
    )                                                  AS open_exposure_ngn,

    -- Settlement timing
    ROUND(AVG(rp.settlement_lag_actual_minutes), 2)   AS avg_settlement_lag_minutes,
    COUNT(DISTINCT ct.id)
        FILTER (WHERE ct.settlement_sla_breached = TRUE) AS sla_breach_count,

    NOW()                                              AS last_refreshed_at

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

---

## 7. Database Role Permissions

Least-privilege access per application component — a direct NFR-010 requirement:

```sql
-- migrations/011_roles_and_permissions.sql

-- Application roles — never use superuser in application code
CREATE ROLE reconciliation_api_user    LOGIN PASSWORD '${API_DB_PASSWORD}';
CREATE ROLE reconciliation_pipeline    LOGIN PASSWORD '${PIPELINE_DB_PASSWORD}';
CREATE ROLE reconciliation_readonly    LOGIN PASSWORD '${READONLY_DB_PASSWORD}';
CREATE ROLE reconciliation_dbt         LOGIN PASSWORD '${DBT_DB_PASSWORD}';

-- Pipeline role: writes to Silver and Gold, reads everything
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_pipeline;
GRANT INSERT, UPDATE ON
    bronze_ingestion_log,
    silver_canonical_transactions,
    silver_fx_rate_snapshots,
    silver_idempotency_keys,
    silver_psp_settlement_windows,
    silver_transaction_audit_log,
    gold_reconciliation_pairs,
    gold_discrepancies,
    gold_cbn_daily_returns,
    gold_exposure_tracker,
    system_pipeline_runs,
    system_alert_events
TO reconciliation_pipeline;

-- API role: reads all, writes only resolution and alert acknowledgement
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_api_user;
GRANT UPDATE (status, resolved_by, resolved_at, resolution_note, resolution_type,
              reviewed_at, updated_at)
    ON gold_discrepancies TO reconciliation_api_user;
GRANT UPDATE (status, reviewed_at, resolved_by, resolved_at, resolution_note, updated_at)
    ON gold_reconciliation_pairs TO reconciliation_api_user;

-- dbt role: reads Silver, writes Gold
GRANT SELECT ON
    silver_canonical_transactions,
    silver_fx_rate_snapshots,
    silver_psp_settlement_windows
TO reconciliation_dbt;
GRANT INSERT, UPDATE ON
    gold_reconciliation_pairs,
    gold_discrepancies,
    gold_cbn_daily_returns,
    gold_exposure_tracker
TO reconciliation_dbt;

-- Readonly role: no writes anywhere (Streamlit dashboard, DuckDB export queries)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_readonly;

-- Audit log is insert-only for all roles — no UPDATE, no DELETE ever
REVOKE UPDATE, DELETE ON silver_transaction_audit_log FROM ALL;
REVOKE UPDATE, DELETE ON bronze_ingestion_log FROM ALL;
```

---

## 8. Migration Execution Order

```
migrations/
├── 000_setup.sql                          -- Extensions and schemas
├── 001_enum_types.sql                     -- All ENUM types
├── 002_system_tables.sql                  -- system_pipeline_runs, system_api_keys
│                                          -- system_alert_events (FK to gold — add FK later)
├── 003_bronze_tables.sql                  -- bronze_ingestion_log
├── 004_silver_fx_snapshots.sql            -- silver_fx_rate_snapshots
├── 005_silver_canonical_transactions.sql  -- silver_canonical_transactions + trigger
├── 006_silver_supporting_tables.sql       -- idempotency_keys, settlement_windows,
│                                          -- transaction_audit_log
├── 007_gold_reconciliation_pairs.sql      -- gold_reconciliation_pairs
├── 008_gold_discrepancies.sql             -- gold_discrepancies
│                                          -- (add FK to system_alert_events here)
├── 009_gold_reporting_tables.sql          -- gold_cbn_daily_returns, gold_exposure_tracker
├── 010_gold_materialized_view.sql         -- gold_reconciliation_summary
├── 011_roles_and_permissions.sql          -- Role grants
└── 012_seed_data.sql                      -- silver_psp_settlement_windows seed values
```

**Migration tool:** Alembic (Python-native, integrates cleanly with the FastAPI/SQLAlchemy stack).

---

## 9. Schema Decision Log

Non-obvious decisions that would otherwise generate review questions:

**Why `NUMERIC(20, 6)` for all monetary amounts, not `FLOAT`?**
Floating-point arithmetic on financial data produces rounding errors. `NUMERIC` is exact. A reconciliation engine that rounds NGN 49,999.999 to NGN 50,000.000 due to float imprecision would produce false positives. `NUMERIC(20, 6)` handles amounts up to ₦99,999,999,999,999.999999 — sufficient for any foreseeable transaction.

**Why `TIMESTAMPTZ` everywhere, never `TIMESTAMP`?**
Nigeria runs on WAT (UTC+1). The CBN daily return is based on WAT calendar dates. Paystack reports times in WAT. Flutterwave uses UTC in their API. If timestamps are stored without timezone, a WAT/UTC mix in the same column produces off-by-one-hour errors in settlement lag calculations and daily summaries. `TIMESTAMPTZ` stores everything as UTC internally and converts correctly on read.

**Why is `has_pii_masked` a check constraint enforced to `TRUE` always?**
A nullable boolean or an unenforced application-layer convention will eventually fail — the pipeline crashes mid-transform, the masking step is skipped, raw account numbers land in Silver. The `CHECK (has_pii_masked = TRUE)` constraint makes it structurally impossible to write an unmasked record to Silver. The Silver transform must set the flag explicitly after masking — if it doesn't, the insert fails. This is defensive engineering.

**Why `ON DELETE RESTRICT` on most FKs, not `CASCADE`?**
In a financial system, cascading deletes are dangerous. If a `system_pipeline_run` record is somehow deleted, `RESTRICT` ensures you can't delete it while child records exist — forcing explicit cleanup. `CASCADE` would silently delete reconciliation pairs and discrepancy records. That's unrecoverable data loss.

**Why a separate `silver_idempotency_keys` table instead of relying on the `UNIQUE` constraint on `silver_canonical_transactions.idempotency_key`?**
The idempotency check happens *before* the full Silver transform — it's the very first check after webhook receipt. A separate, narrow table (`key` + `occurrence_count` + timestamps) means the idempotency lookup is a single-column PK scan on a small table, not a full scan of `silver_canonical_transactions` which will grow to millions of rows. It also captures occurrence count — knowing a duplicate arrived 3 times is operationally useful for detecting PSP webhook bugs.

---

## 10. What This Document Unlocks

The ERD and schema are now complete. Every table, every field, every constraint, every index is defined. The next documents are now unblocked with full precision:

**Immediate next — Data Dictionary:** Every field in every table now needs its formal business definition, valid value ranges, example values, source mapping, and transformation rules. The schema tells you the structure. The Data Dictionary tells you the meaning. Together they are the complete data contract for the system.

**Then — TDD:** Stack decisions are locked. Component interactions are mapped. The TDD now fills in implementation detail — the Silver transform logic per PSP, the matching engine algorithm, the Prefect flow definitions, the FastAPI middleware stack, the Docker Compose service graph, and the environment variable schema.

Ready to move into the Data Dictionary, or any adjustments needed here first?