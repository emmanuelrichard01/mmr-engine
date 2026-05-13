# DATA DICTIONARY

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, Data Architecture Blueprint v1.0, ERD v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose

The Database Schema (ERD v1.0) defines the *structure* of every entity. This document defines the *meaning*. Together they constitute the complete data contract for the system.

Every field in every table is documented here. A field not in this document has no agreed meaning and cannot be used in business logic, reports, or API responses until it is added here first.

This document is the reference for:
- Pipeline engineers writing Silver transform logic
- dbt authors writing Gold layer models
- API engineers defining response schemas
- Compliance officers verifying CBN report field mappings
- Any future engineer joining the project

---

## 2. Sensitivity Classification

Every field carries one of four sensitivity levels. This drives masking, logging, access control, and NDPR compliance decisions.

```
Level       Label           Meaning
─────────── ─────────────── ────────────────────────────────────────────────────
PUBLIC      [PUB]           No restrictions. Safe in logs, API responses, dashboards.
INTERNAL    [INT]           Internal use only. Not for external API consumers.
                            Safe in structured logs with appropriate access controls.
RESTRICTED  [RES]           Sensitive operational data. Role-gated. Not in logs.
                            API responses require 'admin' scope.
PII         [PII]           Personal Identifiable Information under NDPR.
                            Masked in Silver. Never in logs. Encrypted at rest.
                            Bronze Parquet only, MinIO access-controlled.
```

---

## 3. Derivation Source Codes

Used in the "Source" column to indicate where field values originate:

```
[PSP-PY]    Paystack webhook or API response
[PSP-FW]    Flutterwave webhook or API response
[PSP-MP]    M-Pesa Daraja webhook or API response
[SYS]       System-generated at ingestion time (UUID, timestamp, hash)
[TRANSFORM] Computed during Bronze→Silver or Silver→Gold transform
[CONFIG]    Read from silver_psp_settlement_windows or environment config
[MANUAL]    Set by a human operator via API or admin interface
[DBT]       Computed by a dbt model during Gold layer build
[TRIGGER]   Set by a PostgreSQL trigger automatically
```

---

## 4. System Layer Tables

### 4.1 `system_pipeline_runs`

**Purpose:** Registry of every Prefect flow execution. Every pipeline write operation references a run in this table. It is the operational heartbeat of the system.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this pipeline execution. Primary key. | Any valid UUID | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `flow_name` | VARCHAR(200) | No | [INT] | [SYS] | Name of the Prefect flow that produced this run. Used for filtering run history by pipeline type. | `webhook_ingestion_flow` `bronze_to_silver_flow` `silver_to_gold_flow` `polling_fallback_flow` `daily_report_flow` | `bronze_to_silver_flow` |
| `flow_version` | VARCHAR(50) | Yes | [INT] | [SYS] | Deployed version of the flow at execution time. Enables regression analysis when pipeline logic changes. NULL if version is not tracked in the deployment. | Semantic version string | `1.2.0` |
| `prefect_flow_run_id` | VARCHAR(200) | Yes | [INT] | [SYS] | Prefect's own run identifier. Used to correlate this record with Prefect UI logs and the Prefect API. NULL for runs not orchestrated via Prefect (manual scripts during development). | Prefect UUID string | `3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f` |
| `status` | ENUM | No | [INT] | [SYS]/[TRIGGER] | Execution state of the flow at this point in time. | `running` `completed` `failed` `cancelled` | `completed` |
| `triggered_by` | VARCHAR(100) | No | [INT] | [SYS] | Machine-readable description of what initiated this run. Format is `{source}:{identifier}`. Enables root-cause tracing from any output record back to its triggering event. | `webhook:paystack:T_abc123` `schedule:polling_fallback` `manual:admin` `api_user:reck_A3f9` | `webhook:paystack:T_abc123xyz` |
| `started_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when the flow execution began. | Any valid timestamp ≤ NOW() | `2026-05-01T09:14:32.841Z` |
| `completed_at` | TIMESTAMPTZ | Yes | [INT] | [SYS] | UTC timestamp when the flow reached a terminal state (completed, failed, or cancelled). NULL while status is `running`. | Any valid timestamp ≥ `started_at` | `2026-05-01T09:14:35.203Z` |
| `duration_seconds` | NUMERIC(10,3) | Yes | [INT] | [TRIGGER] | Computed column. Wall-clock duration of the flow in seconds. NULL while running. Derived as `EXTRACT(EPOCH FROM (completed_at - started_at))`. | Any positive decimal | `2.362` |
| `records_processed` | INTEGER | No | [INT] | [SYS] | Count of individual records (events, transactions) successfully handled in this run. Zero for runs that failed before processing. | ≥ 0 | `47` |
| `records_failed` | INTEGER | No | [INT] | [SYS] | Count of records that encountered errors during processing. A run can complete successfully with records_failed > 0 if partial failure handling is configured. | ≥ 0 | `0` |
| `error_message` | TEXT | Yes | [INT] | [SYS] | Human-readable summary of the failure reason. NULL for completed runs. Must not contain PII or raw secrets. | Free text, sanitised | `Pandera schema validation failed: 'amount_raw' column contains 3 null values` |
| `error_traceback` | TEXT | Yes | [INT] | [SYS] | Full Python stack trace for debugging. NULL for completed runs. Never exposed via API — internal pipeline access only. | Python traceback string | `Traceback (most recent call last)...` |
| `metadata` | JSONB | No | [INT] | [SYS] | Flow-specific contextual data that does not fit the fixed columns. Schema varies by flow type. Never contains PII. | Valid JSON object | `{"psp_name": "paystack", "billing_period": "2026-05", "file_path": "s3://bronze/paystack/..."}` |

**Metadata field conventions by flow:**
```
webhook_ingestion_flow:   {psp_name, source_type, kafka_topic, kafka_offset}
bronze_to_silver_flow:    {psp_name, file_path, event_count, validation_passed}
silver_to_gold_flow:      {dbt_models_run, tests_passed, tests_failed, discrepancies_raised}
polling_fallback_flow:    {psp_name, transactions_polled, status_updates_found}
daily_report_flow:        {return_date, total_tx_count, submission_status}
```

---

### 4.2 `system_api_keys`

**Purpose:** Authentication registry for API consumers. Keys are never stored in plaintext. The system stores only a SHA-256 hash for verification.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [RES] | [SYS] | Unique identifier for this API key record. | Any valid UUID | `b5c6d7e8-f9a0-b1c2-d3e4-f5a6b7c8d9e0` |
| `key_hash` | CHAR(64) | No | [RES] | [TRANSFORM] | SHA-256 hash of the raw API key. Used for constant-time comparison during authentication. The raw key is shown to the client exactly once at creation and is not recoverable thereafter. | 64-character lowercase hex string | `e3b0c44298fc1c149afb...` |
| `key_prefix` | VARCHAR(8) | No | [INT] | [TRANSFORM] | First 8 characters of the raw API key. Stored in plaintext to allow users to identify which key they are using without exposing the full key. Format: `reck_` + 3 random chars. | Alphanumeric, starts with `reck_` | `reck_A3f` |
| `client_name` | VARCHAR(200) | No | [INT] | [MANUAL] | Human-readable name of the system or team this key belongs to. Used in audit logs and alert notifications. | Non-empty string | `Chioma Finance Dashboard` |
| `client_description` | TEXT | Yes | [INT] | [MANUAL] | Optional longer description of the key's purpose and owner. | Free text | `Production key for Tunde's reconciliation API integration` |
| `scopes` | TEXT[] | No | [INT] | [MANUAL] | Array of permission scopes granted to this key. Determines what API endpoints are accessible. | Array containing only: `read` `write` `admin` | `{"read","write"}` |
| `is_active` | BOOLEAN | No | [INT] | [MANUAL] | Whether this key is currently valid for authentication. Set to FALSE to revoke without deleting — preserves audit history. | `TRUE` `FALSE` | `TRUE` |
| `created_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this key was created. | Valid timestamp ≤ NOW() | `2026-05-01T08:00:00.000Z` |
| `expires_at` | TIMESTAMPTZ | Yes | [INT] | [MANUAL] | UTC timestamp after which this key is no longer valid. NULL means the key has no expiry. Production keys should always have an expiry. | Valid timestamp > `created_at`, or NULL | `2027-05-01T00:00:00.000Z` |
| `last_used_at` | TIMESTAMPTZ | Yes | [INT] | [TRIGGER] | UTC timestamp of the most recent successful authentication with this key. Updated on every successful API request. Used to detect unused keys for rotation. | Valid timestamp, or NULL if never used | `2026-05-01T14:32:11.000Z` |
| `usage_count` | BIGINT | No | [INT] | [TRIGGER] | Running total of successful authentications with this key. Incremented on every successful request. | ≥ 0 | `1847` |

---

### 4.3 `system_alert_events`

**Purpose:** Immutable outbound alert audit trail. Every notification the system attempts to send — to Slack, email, PagerDuty — is recorded here before sending. Delivery confirmation is updated on callback. Enables re-queuing of failed alerts and a full compliance audit of who was notified about what, and when.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this alert event. | Any valid UUID | `c6d7e8f9-a0b1-c2d3-e4f5-a6b7c8d9e0f1` |
| `discrepancy_id` | UUID | Yes | [INT] | [SYS] | FK to `gold_discrepancies.id`. The discrepancy that triggered this alert. NULL for system-level alerts (pipeline failures, SLA breaches, daily summaries) that are not tied to a specific discrepancy. | Valid UUID or NULL | `d7e8f9a0-b1c2-d3e4-f5a6-b7c8d9e0f1a2` |
| `alert_channel` | ENUM | No | [INT] | [SYS] | The delivery mechanism for this alert. | `slack` `email` `pagerduty` `webhook` | `slack` |
| `alert_type` | VARCHAR(100) | No | [INT] | [SYS] | Machine-readable classification of what this alert is reporting. Used for filtering and escalation rules. | `discrepancy_raised` `pipeline_failure` `exposure_threshold_breached` `late_settlement_sla` `daily_summary` `duplicate_detected` | `discrepancy_raised` |
| `recipient` | VARCHAR(200) | No | [RES] | [CONFIG] | Destination of the alert. Format depends on channel. Treated as restricted because channel IDs and webhook URLs can expose internal infrastructure. | Slack: `#finops-alerts` Email: `ops@company.com` Webhook: `https://...` | `#finops-reconciliation` |
| `payload` | JSONB | No | [INT] | [TRANSFORM] | The full sanitised message payload sent to the channel. Must not contain raw PII — account numbers and names must be masked. Amounts in NGN are acceptable. | Valid JSON matching channel schema | `{"text": "⚠️ Discrepancy: NGN 48,500 missing settlement from Paystack ref T_abc123"}` |
| `status` | ENUM | No | [INT] | [SYS] | Current delivery state of this alert. | `queued` `sent` `delivered` `failed` | `delivered` |
| `queued_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this alert was created and queued for delivery. | Valid timestamp ≤ NOW() | `2026-05-01T09:14:36.000Z` |
| `sent_at` | TIMESTAMPTZ | Yes | [INT] | [SYS] | UTC timestamp when the HTTP request to the channel API was dispatched. NULL if still queued. | Valid timestamp ≥ `queued_at` | `2026-05-01T09:14:36.841Z` |
| `delivery_confirmed_at` | TIMESTAMPTZ | Yes | [INT] | [SYS] | UTC timestamp of delivery confirmation from the channel. For Slack, this is the API 200 response time. For email, this is the SMTP accepted timestamp (not read receipt). | Valid timestamp ≥ `sent_at` | `2026-05-01T09:14:37.102Z` |
| `failure_reason` | TEXT | Yes | [INT] | [SYS] | Description of why delivery failed. NULL for non-failed alerts. Must not contain raw secrets or PII. | Free text | `Slack API returned 429 Too Many Requests. Retry after 60s.` |
| `retry_count` | INTEGER | No | [INT] | [SYS] | Number of delivery attempts made for this alert. A count > 3 with status `failed` triggers escalation to a secondary channel. | ≥ 0 | `2` |

---

## 5. Bronze Layer

### 5.1 `bronze_ingestion_log`

**Purpose:** Metadata registry for all Parquet files written to MinIO. This table does not store raw event data — that lives in Parquet. This table answers: what was received, from where, when, and is it valid? It is the entry point for pipeline lineage tracing.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this ingestion record. Referenced by all Silver records to establish Bronze-to-Silver lineage. | Any valid UUID | `e8f9a0b1-c2d3-e4f5-a6b7-c8d9e0f1a2b3` |
| `psp_name` | ENUM | No | [PUB] | [SYS] | The Payment Service Provider that originated the events in this Parquet file. | `paystack` `flutterwave` `mpesa` `moniepoint` | `paystack` |
| `source_type` | ENUM | No | [INT] | [SYS] | Whether events arrived via real-time webhook push or via the polling fallback mechanism. This distinguishes events that arrived on time from events recovered by the fallback. | `webhook` `polling` | `webhook` |
| `kafka_topic` | VARCHAR(200) | No | [INT] | [SYS] | The Kafka topic this batch of events was consumed from. Together with partition and offset, this uniquely identifies the message batch and enforces ingestion idempotency. | `raw.paystack.events` `raw.flutterwave.events` `raw.mpesa.events` `raw.polling.fallback` | `raw.paystack.events` |
| `kafka_partition` | INTEGER | No | [INT] | [SYS] | Kafka partition number within the topic. Combined with kafka_offset for the unique constraint that prevents duplicate ingestion. | ≥ 0, per topic partition count | `3` |
| `kafka_offset` | BIGINT | No | [INT] | [SYS] | Kafka message offset within the partition. The unique constraint on (kafka_topic, kafka_partition, kafka_offset) is the primary idempotency guarantee for the Bronze layer. A message at a given offset can only be written once. | ≥ 0, monotonically increasing per partition | `100847` |
| `content_hash` | CHAR(64) | No | [INT] | [TRANSFORM] | SHA-256 hash of the raw payload bytes before any processing. Used to detect duplicate payloads arriving via different Kafka offsets (e.g., PSP retry sends identical webhook twice via different message). A second Bronze record with the same hash should raise an operational alert even if the Kafka offset differs. | Lowercase hex, exactly 64 characters | `9f86d081884c7d659a2f...` |
| `file_path` | VARCHAR(1000) | No | [INT] | [SYS] | Full MinIO object path of the Parquet file containing the raw events for this ingestion batch. Format: `s3://{bucket}/{psp}/{date_partition}/{hour_partition}/{filename}.parquet` | Valid MinIO/S3 URI | `s3://reconciliation-bronze/paystack/event_date=2026-05-01/hour=09/part-0001.parquet` |
| `event_count` | INTEGER | No | [INT] | [SYS] | Number of raw webhook events written to the Parquet file. A file with event_count = 0 should never exist — the constraint enforces this. Used to validate Silver processing completeness: Silver records produced by this ingestion batch must equal event_count (minus any deduplication). | ≥ 1 | `47` |
| `ingestion_run_id` | UUID | No | [INT] | [SYS] | FK to `system_pipeline_runs.id`. The pipeline run that wrote this Bronze file. Enables full lineage: run → Bronze file → Silver records → Gold output. | Valid UUID of a pipeline run | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `received_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when the first event in this batch was received by the FastAPI gateway. This is the system's arrival time, not the PSP's event time. WAT equivalent is `received_at AT TIME ZONE 'Africa/Lagos'`. | Valid timestamp ≤ NOW() | `2026-05-01T08:14:32.841Z` |
| `status` | ENUM | No | [INT] | [SYS] | Processing state of this ingestion record. `received` = payload validated, not yet written to MinIO. `written` = Parquet file successfully persisted to MinIO. `failed` = write failed; failure_reason is populated. | `received` `written` `failed` | `written` |
| `failure_reason` | TEXT | Yes | [INT] | [SYS] | Description of why MinIO write failed. Must be non-NULL when status = `failed`. Null for all other statuses — enforced by database constraint. Must not contain raw secrets. | Free text | `MinIO connection timeout after 5000ms. Retry 3/3 exhausted.` |

---

## 6. Silver Layer

### 6.1 `silver_fx_rate_snapshots`

**Purpose:** Point-in-time registry of foreign exchange rates. Every FX conversion applied to a transaction is traceable to a specific snapshot record. The get_fx_rate_at() function queries this table to retrieve the correct historical rate for any past timestamp, ensuring FX calculations are deterministic and auditable.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this rate snapshot. Referenced by `silver_canonical_transactions.fx_rate_snapshot_id`. | Any valid UUID | `f9a0b1c2-d3e4-f5a6-b7c8-d9e0f1a2b3c4` |
| `currency_pair` | VARCHAR(7) | No | [PUB] | [SYS] | The exchange rate pair expressed as BASE/QUOTE. In this system NGN is always the base currency — we express the cost of 1 NGN in the quote currency. Format validated by CHECK constraint: must match `^[A-Z]{3}/[A-Z]{3}$`. | `NGN/USD` `NGN/GBP` `NGN/EUR` `NGN/KES` | `NGN/USD` |
| `rate` | NUMERIC(20,8) | No | [PUB] | [PSP-PY]/[PSP-FW]/[CONFIG] | The mid-market exchange rate at the time of capture. Expressed as: 1 NGN = {rate} {quote_currency}. Example: rate = 0.00063291 means 1 NGN = 0.00063291 USD, or equivalently 1 USD = 1580 NGN. | > 0 | `0.00063291` |
| `bid` | NUMERIC(20,8) | Yes | [INT] | [CONFIG] | The buy-side rate from the provider. The rate at which the market buys NGN (lower than ask). NULL when the rate source provides only a mid-market rate. | > 0, ≤ ask | `0.00063200` |
| `ask` | NUMERIC(20,8) | Yes | [INT] | [CONFIG] | The sell-side rate from the provider. The rate at which the market sells NGN (higher than bid). NULL when the rate source provides only a mid-market rate. | > 0, ≥ bid | `0.00063382` |
| `mid` | NUMERIC(20,8) | Yes | [INT] | [TRIGGER] | Computed column. Average of bid and ask. Falls back to rate if bid/ask are not available. Formula: `(bid + ask) / 2` or `rate` if either is NULL. | > 0 | `0.00063291` |
| `spread_pct` | NUMERIC(10,6) | Yes | [INT] | [TRIGGER] | Computed column. Bid-ask spread as a percentage of the bid rate. Formula: `((ask - bid) / bid) * 100`. NULL when bid or ask is NULL. A spread > 1% signals a high-friction rate source; above 3% should raise an operational warning. | ≥ 0, NULL if bid/ask unavailable | `0.287400` |
| `source_provider` | VARCHAR(100) | No | [INT] | [CONFIG] | Identifier of the FX data provider that supplied this rate. Used to assess rate quality and switch providers during incidents. | `exchangerate-api` `cbn-official` `manual-override` | `exchangerate-api` |
| `captured_at` | TIMESTAMPTZ | No | [PUB] | [SYS] | UTC timestamp when this rate was fetched from the provider. This is the timestamp used by `get_fx_rate_at()` for point-in-time lookups. | Valid timestamp ≤ NOW() | `2026-05-01T09:00:00.000Z` |
| `valid_from` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp from which this rate is considered valid for FX conversions. Typically equals `captured_at`. | Valid timestamp ≤ `captured_at` | `2026-05-01T09:00:00.000Z` |
| `valid_until` | TIMESTAMPTZ | Yes | [INT] | [TRIGGER] | UTC timestamp when this rate was superseded by a newer snapshot. NULL means this is the current active rate for the currency pair. The partial unique index on (currency_pair WHERE valid_until IS NULL) enforces that only one current rate exists per pair. | Valid timestamp > `valid_from`, or NULL | `2026-05-01T09:30:00.000Z` |
| `bronze_snapshot_id` | UUID | Yes | [INT] | [SYS] | FK to `bronze_ingestion_log.id`. The Bronze ingestion record for the Parquet file that contained this rate. NULL for rates entered via manual override outside the normal ingestion path. | Valid UUID or NULL | `e8f9a0b1-c2d3-e4f5-a6b7-c8d9e0f1a2b3` |

---

### 6.2 `silver_canonical_transactions`

**Purpose:** The core entity of the entire system. Every PSP event — regardless of source, currency, or type — is normalised into a single row in this table. The matching engine operates exclusively on this table. All Gold-layer outputs trace back to records here. This is the system's financial ledger.

**Critical note:** This table stores only masked PII. Raw account numbers, full names, and BVN references exist only in Bronze Parquet files on MinIO, which are access-controlled separately.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique internal identifier for this canonical transaction record. Used as the primary FK target across all Gold-layer tables. | Any valid UUID | `a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6` |
| `idempotency_key` | VARCHAR(200) | No | [INT] | [TRANSFORM] | Composite deduplication key. Format: `{psp_name}:{psp_transaction_ref}:{event_type}`. The UNIQUE constraint on this column is the primary guarantee that a PSP event is never processed twice into Silver, regardless of how many times the webhook fires. | Non-empty string, format enforced at transform layer | `paystack:T_abc123xyz:charge.success` |
| `internal_ref` | VARCHAR(100) | No | [INT] | [SYS] | Human-readable internal reference number for this transaction. Used by support teams and in CBN reports. Prefixed with `REC-` followed by a UUID fragment. Safe to share in emails and tickets — contains no PII. | `REC-` + 32 uppercase alphanumeric chars | `REC-A3F9B2C1D4E5F6A7B8C9D0E1F2A3B4` |
| `bronze_ingestion_id` | UUID | No | [INT] | [SYS] | FK to `bronze_ingestion_log.id`. Traces this Silver record back to the exact Bronze Parquet file from which it was derived. The foundation of Bronze-to-Silver lineage. | Valid UUID | `e8f9a0b1-c2d3-e4f5-a6b7-c8d9e0f1a2b3` |
| `psp_name` | ENUM | No | [PUB] | [PSP-PY]/[PSP-FW]/[PSP-MP] | The Payment Service Provider that originated this transaction event. | `paystack` `flutterwave` `mpesa` `moniepoint` | `paystack` |
| `psp_transaction_ref` | VARCHAR(200) | No | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | The PSP's own reference number for this transaction. Not globally unique — Paystack and Flutterwave may issue references that collide. Unique only within a given PSP. Always combined with `psp_name` for lookups. | Non-empty string, format varies by PSP | `T_abc123xyz789` |
| `psp_event_type` | VARCHAR(100) | No | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | The webhook event type exactly as received from the PSP. Preserved from the raw payload. Used for classifying transaction_type during Silver transform. | Paystack: `charge.success` `transfer.success` `transfer.failed` Flutterwave: `charge.completed` `transfer.completed` M-Pesa: `PaymentRequest` | `charge.success` |
| `psp_event_received_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when the PSP webhook event arrived at the FastAPI ingestion gateway. This is the system's receipt time — not the time the transaction occurred on the PSP's side. Distinction matters for settlement lag calculation. | Valid timestamp ≤ NOW() | `2026-05-01T08:14:32.841Z` |
| `transaction_type` | ENUM | No | [PUB] | [TRANSFORM] | Canonical classification of the transaction direction. Derived from `psp_event_type` during Silver transform using a PSP-specific mapping table. | `credit` `debit` `reversal` | `credit` |
| `amount_raw` | NUMERIC(20,6) | No | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | Transaction amount in the original currency as reported by the PSP. Never rounded or modified. If the PSP reports NGN 50,000.00 this stores `50000.000000`. Stored with 6 decimal places even for currencies that use 2, to preserve precision if source data changes. | ≥ 0 | `50000.000000` |
| `currency_raw` | CHAR(3) | No | [PUB] | [PSP-PY]/[PSP-FW]/[PSP-MP] | ISO 4217 currency code of the original transaction as reported by the PSP. For Paystack NGN transactions this will always be `NGN`. For Flutterwave cross-border transactions this may be `USD`, `GBP`, or `KES`. | `NGN` `USD` `GBP` `EUR` `KES` | `NGN` |
| `amount_ngn` | NUMERIC(20,6) | No | [INT] | [TRANSFORM] | Transaction amount converted to Nigerian Naira. The canonical amount used by all matching and reporting logic. If `currency_raw = 'NGN'`, this equals `amount_raw` exactly. If foreign currency, this is `amount_raw / fx_rate_applied` at the settlement timestamp's rate. | ≥ 0 | `50000.000000` |
| `fx_rate_snapshot_id` | UUID | Yes | [INT] | [TRANSFORM] | FK to `silver_fx_rate_snapshots.id`. The specific rate snapshot used to compute `amount_ngn`. NULL only when `currency_raw = 'NGN'` (no FX conversion required). The CHECK constraint enforces that this is non-NULL for all non-NGN transactions. | Valid UUID or NULL (if currency_raw = NGN) | `f9a0b1c2-d3e4-f5a6-b7c8-d9e0f1a2b3c4` |
| `fx_rate_applied` | NUMERIC(20,8) | Yes | [INT] | [TRANSFORM] | The exact exchange rate used in the NGN conversion for this transaction. Stored redundantly with the snapshot reference for direct audit without a join. NULL when `currency_raw = 'NGN'`. Example: `0.00063291` means 1 NGN = 0.00063291 USD, so USD 31.645 ÷ 0.00063291 = NGN 50,000. | > 0, or NULL | `0.00063291` |
| `sender_account_masked` | VARCHAR(50) | Yes | [PII] | [TRANSFORM] | **PII field.** NUBAN account number of the sending party, masked during Silver transform. Format: first 2 digits + asterisks + last 2 digits. Raw value accessible only in Bronze Parquet. NULL for transactions where sender account is not disclosed by the PSP (e.g., card payments). | `01******89` format, or NULL | `01******89` |
| `sender_bank_code` | VARCHAR(10) | Yes | [PUB] | [PSP-PY]/[PSP-FW] | CBN-assigned bank sort code of the sender's financial institution. These are public CBN data, not PII. NULL when the PSP does not provide this field. | 3–6 digit CBN bank code | `058` |
| `sender_bank_name` | VARCHAR(200) | Yes | [PUB] | [TRANSFORM] | Full name of the sender's bank. Derived from `sender_bank_code` via a static CBN bank code lookup table in the transform layer. NULL when `sender_bank_code` is NULL. | Full bank name string | `Guaranty Trust Bank` |
| `beneficiary_account_masked` | VARCHAR(50) | Yes | [PII] | [TRANSFORM] | **PII field.** NUBAN account number of the receiving party, masked during Silver transform. Same masking format as `sender_account_masked`. This is the primary matching field for the probabilistic secondary matching strategy. | `01******89` format, or NULL | `05******23` |
| `beneficiary_bank_code` | VARCHAR(10) | Yes | [PUB] | [PSP-PY]/[PSP-FW] | CBN-assigned bank sort code of the beneficiary's financial institution. Public data. Used in matching logic as a high-confidence identifier alongside account number. | 3–6 digit CBN bank code | `011` |
| `beneficiary_bank_name` | VARCHAR(200) | Yes | [PUB] | [TRANSFORM] | Full name of the beneficiary's bank. Derived from `beneficiary_bank_code`. | Full bank name string | `First Bank of Nigeria` |
| `beneficiary_name_masked` | VARCHAR(200) | Yes | [PII] | [TRANSFORM] | **PII field.** Account name of the beneficiary, masked during Silver transform. Masking format: first character of each name component followed by asterisks matching remaining length. `Chioma Okonkwo` → `C****** O*******`. The trigram index on this field enables fuzzy name matching in the probabilistic matching engine. | Masked name format, or NULL | `C****** O*******` |
| `narration` | TEXT | Yes | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | Transaction narration or description as provided by the initiating party. Truncated to 500 characters during Silver transform. PII-scrubbing is applied — patterns matching NUBAN account numbers, BVN numbers (11 digits), and phone numbers are replaced with `[REDACTED]` before storage. | Truncated, PII-scrubbed free text | `Payment for order #INV-2026-0501-A` |
| `initiated_at` | TIMESTAMPTZ | No | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | UTC timestamp when the transaction was initiated by the originating party on the PSP's platform. This is the PSP's own reported transaction time, not the webhook receipt time. The primary time dimension for matching window calculations and CBN daily reports. | Valid timestamp ≤ NOW() | `2026-05-01T08:12:00.000Z` |
| `settled_at` | TIMESTAMPTZ | Yes | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | UTC timestamp when settlement was confirmed by the PSP. NULL for transactions in `pending` status. Updated via the polling fallback flow when settlement confirmation arrives after the initial webhook. Must be ≥ `initiated_at` — enforced by CHECK constraint. | Valid timestamp ≥ `initiated_at`, or NULL | `2026-05-02T10:23:00.000Z` |
| `expected_settlement_at` | TIMESTAMPTZ | Yes | [INT] | [TRANSFORM] | Computed UTC timestamp of when settlement is expected based on `silver_psp_settlement_windows` configuration for this PSP and transaction type. Computed during Silver transform using the settlement window active at `initiated_at`. Used to drive SLA breach detection and the polling fallback trigger. NULL if no settlement window is configured for this PSP/type combination. | Valid timestamp > `initiated_at`, or NULL | `2026-05-02T17:00:00.000Z` |
| `settlement_sla_breached` | BOOLEAN | No | [INT] | [TRIGGER] | Computed column. TRUE when settlement is late. Evaluated as: settlement confirmed AND settled_at > expected_settlement_at, OR settlement not confirmed AND NOW() > expected_settlement_at. Drives SLA breach alerting in the alert flow. | `TRUE` `FALSE` | `FALSE` |
| `settlement_status` | ENUM | No | [INT] | [SYS]/[TRIGGER] | Current status of this transaction's settlement lifecycle. Updated by the Silver transform on status-change events and by the polling fallback when new PSP data arrives. Changes to this field are automatically recorded in `silver_transaction_audit_log` by the database trigger. | `pending` = awaiting settlement `settled` = settlement confirmed `failed` = PSP confirmed failure `reversed` = transaction reversed post-settlement `disputed` = under dispute resolution | `settled` |
| `has_pii_masked` | BOOLEAN | No | [INT] | [TRANSFORM] | Explicit flag set to TRUE by the Silver transform after all PII fields have been masked. The CHECK constraint enforces this is always TRUE — a Silver write with FALSE or NULL fails at the database level. This prevents a pipeline bug from silently writing unmasked PII to Silver. | Always `TRUE` in valid records | `TRUE` |
| `psp_metadata` | JSONB | No | [INT] | [PSP-PY]/[PSP-FW]/[PSP-MP] | PSP-specific fields that have no equivalent in the canonical schema. Captured to preserve information that may be needed for edge-case debugging or future schema extension. Never contains PII — PII fields in PSP metadata are stripped during transform. | Valid JSON object, default `{}` | Paystack: `{"channel": "card", "fees": 1450}` Flutterwave: `{"app_fee": 200, "merchant_fee": 1250}` |
| `processed_by_run_id` | UUID | No | [INT] | [SYS] | FK to `system_pipeline_runs.id`. The pipeline run that created this Silver record. Enables complete lineage from Gold output → Silver record → Bronze file → pipeline run → triggering webhook. | Valid UUID | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `created_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this Silver record was first written. Never updated. | Valid timestamp ≤ NOW() | `2026-05-01T08:14:35.203Z` |
| `updated_at` | TIMESTAMPTZ | No | [INT] | [TRIGGER] | UTC timestamp of the most recent change to this record. Updated automatically by the database trigger on any field change. | Valid timestamp ≥ `created_at` | `2026-05-02T10:23:01.441Z` |

---

### 6.3 `silver_idempotency_keys`

**Purpose:** Narrow, high-performance deduplication registry. The first lookup on any incoming event before any processing begins. A hit here means the event has already been handled — increment the counter and return early without touching Silver or Gold.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `key` | VARCHAR(200) | No | [INT] | [TRANSFORM] | The idempotency key. Primary key. Format: `{psp_name}:{psp_transaction_ref}:{event_type}`. Identical to `silver_canonical_transactions.idempotency_key` for cross-table consistency. | Non-empty, composite key string | `paystack:T_abc123xyz:charge.success` |
| `first_seen_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this key was first encountered by the system. The definitive record of when this event was first processed. | Valid timestamp ≤ NOW() | `2026-05-01T08:14:32.000Z` |
| `occurrence_count` | INTEGER | No | [INT] | [SYS] | Total number of times this exact idempotency key has been received. A count > 1 means the PSP sent a duplicate event. A count > 5 indicates a PSP webhook misconfiguration that should generate an operational alert. | ≥ 1 | `3` |
| `last_seen_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp of the most recent duplicate arrival for this key. Updated on every occurrence beyond the first. Useful for detecting active PSP webhook retry storms. | Valid timestamp ≥ `first_seen_at` | `2026-05-01T08:19:11.000Z` |
| `canonical_tx_id` | UUID | Yes | [INT] | [SYS] | FK to `silver_canonical_transactions.id`. The Silver record created for the first (authoritative) occurrence of this event. NULL during a brief window between key insertion and transaction record creation. SET NULL if the transaction record is deleted (should not occur in production — tracked for forensics). | Valid UUID or NULL | `a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6` |

---

### 6.4 `silver_psp_settlement_windows`

**Purpose:** Configuration table for settlement expectations by PSP, transaction type, and account tier. This is the reference data used to compute `expected_settlement_at` and to detect late settlements. It is data, not code — settlement windows change without a deployment.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this settlement window configuration record. | Any valid UUID | `b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7` |
| `psp_name` | ENUM | No | [PUB] | [MANUAL] | The PSP this settlement window applies to. | `paystack` `flutterwave` `mpesa` `moniepoint` | `paystack` |
| `transaction_type` | ENUM | No | [PUB] | [MANUAL] | The transaction type this window applies to. Different transaction types within the same PSP may settle at different speeds. | `credit` `debit` `reversal` | `credit` |
| `account_tier` | VARCHAR(50) | No | [PUB] | [MANUAL] | The merchant account tier this window applies to. PSPs offer tiered accounts with different settlement speeds. `standard` is the default. | `standard` `growth` `enterprise` | `standard` |
| `settlement_lag_hours` | NUMERIC(5,2) | No | [PUB] | [MANUAL] | The expected number of hours between transaction initiation and settlement credit. Examples: 24.0 = T+1 business day, 1.5 = 90 minutes for faster tiers. This is a SLA expectation, not a guarantee. | > 0 | `24.00` |
| `settlement_days` | VARCHAR(20) | No | [PUB] | [MANUAL] | Whether settlement_lag_hours counts business days or calendar days. Business days exclude Nigerian public holidays and weekends. The holiday calendar is maintained separately in application config. | `business` `calendar` | `business` |
| `cutoff_time_wat` | TIME | Yes | [PUB] | [MANUAL] | The West Africa Time deadline after which a transaction rolls into the next settlement cycle. A credit transaction initiated at 17:30 WAT with a cutoff of 16:00 WAT will settle on T+2, not T+1. NULL means no intraday cutoff — all transactions settle the following cycle regardless of initiation time. | Valid time in HH:MM format, or NULL | `16:00` |
| `effective_from` | DATE | No | [PUB] | [MANUAL] | Date from which this settlement window configuration became active. Enables historical accuracy: a transaction from 2025-01-01 uses the window effective at that date, not the current window. | Valid date ≤ TODAY | `2024-01-01` |
| `effective_until` | DATE | Yes | [PUB] | [MANUAL] | Date on which this settlement window configuration was superseded. NULL means this is the currently active configuration for this PSP/type/tier combination. When a PSP changes its settlement terms, this field is set and a new record is inserted — never update in place. | Valid date > `effective_from`, or NULL | `2025-12-31` |
| `notes` | TEXT | Yes | [INT] | [MANUAL] | Free-text notes documenting the source of this configuration (e.g., link to PSP documentation, date of PSP announcement). Mandatory in practice — a settlement window without a source reference is unverifiable. | Free text | `Paystack standard T+1 settlement. Source: https://paystack.com/docs/payments/settlement/` |

---

### 6.5 `silver_transaction_audit_log`

**Purpose:** Immutable, append-only record of every state change to every canonical transaction. No UPDATE or DELETE is permitted on this table at the database role level. This is both a CBN compliance requirement and the primary debugging tool for unexplained reconciliation outcomes.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this audit log entry. | Any valid UUID | `c3d4e5f6-a7b8-c9d0-e1f2-a3b4c5d6e7f8` |
| `transaction_id` | UUID | No | [INT] | [SYS] | FK to `silver_canonical_transactions.id`. The transaction whose state changed. ON DELETE RESTRICT ensures audit trail is never orphaned. | Valid UUID | `a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6` |
| `event_type` | VARCHAR(100) | No | [INT] | [SYS]/[TRIGGER] | Machine-readable classification of what changed. Used for filtering audit history by event category. | `STATUS_CHANGED` `FX_RATE_APPLIED` `MATCHING_ATTEMPTED` `DISCREPANCY_RAISED` `DISCREPANCY_RESOLVED` `MANUAL_OVERRIDE` `PII_MASKED` `POLLING_FALLBACK_TRIGGERED` `SETTLEMENT_CONFIRMED` `SLA_BREACH_DETECTED` | `STATUS_CHANGED` |
| `previous_state` | JSONB | Yes | [INT] | [SYS]/[TRIGGER] | The relevant state of the transaction before the change, as a JSON snapshot of only the affected fields. NULL for the first audit record of a newly created transaction (no previous state exists). Must not contain PII — only field names and non-PII values. | Valid JSON or NULL | `{"settlement_status": "pending"}` |
| `new_state` | JSONB | No | [INT] | [SYS]/[TRIGGER] | The state of the transaction after the change. Required for all records. Follows the same PII exclusion rule as `previous_state`. | Valid JSON object | `{"settlement_status": "settled", "settled_at": "2026-05-02T10:23:00Z"}` |
| `triggered_by` | VARCHAR(200) | No | [INT] | [SYS]/[TRIGGER] | Machine-readable identifier of what or who caused this state change. Format: `{source}:{identifier}`. Never contains PII. | `pipeline_run:a3f9b2c1` `api_user:reck_A3f` `system:trigger` `manual:compliance_officer` `prefect:bronze_to_silver_flow` | `pipeline_run:a3f9b2c1-d4e5-f6a7-b8c9` |
| `occurred_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this state change occurred. This is the system clock time, not an event time from a PSP. Set at insert time and never modified. | Valid timestamp ≤ NOW() | `2026-05-02T10:23:01.441Z` |
| `run_id` | UUID | Yes | [INT] | [SYS] | FK to `system_pipeline_runs.id`. The pipeline run that triggered this state change. NULL for state changes triggered by manual API actions rather than automated pipeline runs. | Valid UUID or NULL | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `notes` | TEXT | Yes | [INT] | [MANUAL]/[SYS] | Optional human-readable context for this audit entry. Required by convention (though not constraint) for MANUAL_OVERRIDE events — a manual change without a note is an audit gap. | Free text, no PII | `Settlement confirmed via PSP API poll after 47-minute webhook delay` |

---

## 7. Gold Layer

### 7.1 `gold_reconciliation_pairs`

**Purpose:** The output of the matching engine. Every canonical transaction that has been processed by the matcher results in a record here — either a successful match (transaction_a linked to transaction_b) or a discrepancy (transaction_b_id is NULL). This table is the reconciliation truth.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this reconciliation pair. | Any valid UUID | `d4e5f6a7-b8c9-d0e1-f2a3-b4c5d6e7f8a9` |
| `transaction_a_id` | UUID | No | [INT] | [DBT] | FK to `silver_canonical_transactions.id`. The initiating transaction — the outgoing payment that is expected to generate a settlement. This is always the transaction that triggered the reconciliation attempt. | Valid UUID | `a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6` |
| `transaction_b_id` | UUID | Yes | [INT] | [DBT] | FK to `silver_canonical_transactions.id`. The settlement/confirmation transaction that was matched against transaction_a. NULL when no matching counterpart was found — this pair is a discrepancy. The CHECK constraint prevents a transaction being matched against itself. | Valid UUID ≠ transaction_a_id, or NULL | `b2c3d4e5-f6a7-b8c9-d0e1-f2a3b4c5d6e7` |
| `match_strategy` | ENUM | Yes | [INT] | [DBT] | The algorithm used to identify the match. NULL for discrepancy records where no match was found. `exact_primary` is highest confidence. `probabilistic_secondary` requires human review above a confidence threshold. `manual` means a human operator confirmed or created the match. | `exact_primary` `probabilistic_secondary` `manual`, or NULL | `exact_primary` |
| `confidence_score` | NUMERIC(5,4) | Yes | [INT] | [DBT] | Match quality score from the matching engine. Range 0.0 (no confidence) to 1.0 (certain). Scores from `exact_primary` are always 1.0. Scores from `probabilistic_secondary` range 0.5–0.99. Scores below 0.75 require mandatory human review before the pair is considered resolved. NULL for unmatched discrepancy records. | 0.0000 to 1.0000, or NULL | `1.0000` |
| `match_evidence` | JSONB | Yes | [INT] | [DBT] | Structured record of which fields were compared and what the comparison produced. Enables a human reviewer to understand exactly why the engine made a match decision without re-running the algorithm. Must not contain PII values — only masked field references and scores. | Valid JSON, NULL for discrepancies with no comparison | `{"amount_exact_match": true, "timestamp_delta_seconds": 1847, "beneficiary_account_match": true, "beneficiary_name_similarity": 0.94, "fx_variance_pct": 0.0031}` |
| `amount_a_ngn` | NUMERIC(20,6) | No | [DBT] | The NGN amount of transaction_a at the time of matching. Copied from `silver_canonical_transactions.amount_ngn` at Gold run time. Stored here to make the pair self-contained — changes to Silver records after matching do not silently alter historical pair amounts. | ≥ 0 | `50000.000000` |
| `amount_b_ngn` | NUMERIC(20,6) | Yes | [DBT] | The NGN amount of transaction_b. NULL when transaction_b_id is NULL. | ≥ 0, or NULL | `49850.000000` |
| `amount_delta_ngn` | NUMERIC(20,6) | Yes | [DBT] | The difference between what was expected and what was received. Formula: `amount_b_ngn - amount_a_ngn`. Negative value means underpayment (money missing). Positive value means overpayment (money excess). NULL when transaction_b_id is NULL. | Any decimal, or NULL | `-150.000000` |
| `fx_variance_pct` | NUMERIC(10,6) | Yes | [DBT] | The percentage of the amount delta attributable to FX rate timing differences. Computed by the dbt model using `get_fx_rate_at()` for both transaction timestamps. NULL when both transactions are in NGN (no FX involved) or when transaction_b_id is NULL. | Any decimal, or NULL | `0.003100` |
| `is_within_fx_threshold` | BOOLEAN | Yes | [DBT] | TRUE when the absolute FX variance is within the configured acceptable tolerance (default 0.5% of transaction value). A TRUE value here means the amount delta is explained by FX timing and is not a discrepancy. NULL when no FX is involved. The FX variance classification logic in the matching engine uses this flag to prevent false positive discrepancy generation. | `TRUE` `FALSE`, or NULL | `TRUE` |
| `settlement_lag_actual_minutes` | NUMERIC(10,2) | Yes | [DBT] | Actual elapsed time in minutes between `transaction_a.initiated_at` and `transaction_b.settled_at`. NULL when transaction_b_id is NULL or when `settled_at` is not yet populated. Used for PSP settlement SLA analysis and trend reporting. | ≥ 0, or NULL | `1571.00` |
| `settlement_lag_expected_minutes` | NUMERIC(10,2) | Yes | [DBT] | Expected settlement time in minutes, derived from `silver_psp_settlement_windows` for this PSP/type/tier combination at the time of `transaction_a.initiated_at`. Used alongside actual lag to compute SLA compliance. NULL when no settlement window is configured. | > 0, or NULL | `1440.00` |
| `is_settlement_on_time` | BOOLEAN | Yes | [DBT] | TRUE when settlement arrived within the expected window. FALSE when settlement was late. NULL when the settlement has not yet arrived (transaction still pending). | `TRUE` `FALSE`, or NULL | `FALSE` |
| `status` | ENUM | No | [DBT]/[MANUAL] | Current status of this reconciliation pair. Updated by the API on human review actions. `matched` is the initial state for successful matches. `discrepancy` is the initial state for unmatched pairs. | `matched` `discrepancy` `under_review` `resolved` `false_positive` | `matched` |
| `matched_at` | TIMESTAMPTZ | No | [DBT] | UTC timestamp when the dbt model created this pair record. | Valid timestamp ≤ NOW() | `2026-05-01T10:00:00.000Z` |
| `reviewed_at` | TIMESTAMPTZ | Yes | [MANUAL] | UTC timestamp when a human reviewer first examined this pair. NULL for pairs not yet reviewed. Set via the API by authenticated users with `write` scope. | Valid timestamp ≥ `matched_at`, or NULL | `2026-05-01T14:30:00.000Z` |
| `resolved_at` | TIMESTAMPTZ | Yes | [MANUAL] | UTC timestamp when this pair reached a terminal resolution state. Required when status is `resolved` or `false_positive`. | Valid timestamp ≥ `reviewed_at`, or NULL | `2026-05-01T15:00:00.000Z` |
| `resolved_by` | VARCHAR(200) | Yes | [INT] | [MANUAL] | Identifier of the human or system that resolved this pair. Format: API key prefix for API-based resolutions, or operator identifier for manual resolutions. Required when `resolved_at` is not NULL. | API key prefix or operator ID | `reck_A3f` |
| `resolution_note` | TEXT | Yes | [MANUAL] | Mandatory explanation of the resolution. Required when status is `resolved` or `false_positive`. Enforcement is at the database constraint level. Must be substantive — "resolved" alone is not acceptable in practice. | Non-empty free text when resolved | `Confirmed with Paystack support ref #PSP-20260501-8847. Settlement arrived 26 hours late due to CBN interbank cutoff.` |
| `dbt_run_id` | UUID | Yes | [INT] | [DBT] | FK to `system_pipeline_runs.id`. The dbt pipeline run that created this pair. SET NULL if the run record is purged during maintenance. Used for model lineage debugging. | Valid UUID or NULL | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `created_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp of record creation. | Valid timestamp ≤ NOW() | `2026-05-01T10:00:00.441Z` |
| `updated_at` | TIMESTAMPTZ | No | [TRIGGER] | [INT] | UTC timestamp of most recent record update. | Valid timestamp ≥ `created_at` | `2026-05-01T15:00:01.203Z` |

---

### 7.2 `gold_discrepancies`

**Purpose:** Registry of all detected anomalies — transactions that could not be matched, amounts that differ beyond tolerance, settlements that arrived twice, or credits that arrived with no corresponding initiation. This table drives the alerting flow and the exposure tracker. An open discrepancy with non-zero `estimated_exposure_ngn` represents real financial risk.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this discrepancy record. | Any valid UUID | `e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0` |
| `reconciliation_pair_id` | UUID | Yes | [INT] | [DBT] | FK to `gold_reconciliation_pairs.id`. The matching pair that produced this discrepancy, if applicable. NULL for discrepancies raised independently (e.g., a duplicate credit detected without being part of a matching attempt). | Valid UUID or NULL | `d4e5f6a7-b8c9-d0e1-f2a3-b4c5d6e7f8a9` |
| `transaction_id` | UUID | No | [INT] | [DBT] | FK to `silver_canonical_transactions.id`. The canonical transaction at the centre of this discrepancy. For `missing_settlement`, this is the initiating transaction. For `unmatched_credit`, this is the received transaction. For `duplicate_credit`, this is the second (unexpected) credit. | Valid UUID | `a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6` |
| `classification` | ENUM | No | [INT] | [DBT] | The category of anomaly detected. Each classification has a specific evidence schema (documented below). | `missing_settlement` `amount_mismatch` `fx_variance` `duplicate_credit` `unmatched_credit` `late_settlement` | `missing_settlement` |
| `confidence_score` | NUMERIC(5,4) | No | [DBT] | [INT] | The matching engine's confidence that this is a genuine discrepancy and not a false positive caused by data timing, PSP lag, or temporary system state. Scores above 0.90 trigger automatic alerting. Scores 0.70–0.89 are logged and reviewed in the next business day cycle. Scores below 0.70 are held for manual review. | 0.0000 to 1.0000 | `0.9700` |
| `evidence` | JSONB | No | [DBT] | [INT] | Classification-specific structured evidence. Schema varies by `classification`. See evidence schema table below. Must not contain PII. | Valid JSON object, schema by classification | See evidence schemas below |
| `estimated_exposure_ngn` | NUMERIC(20,6) | No | [DBT] | [INT] | Best estimate of the financial exposure in NGN resulting from this discrepancy. This represents the amount of money that is unaccounted for. Zero for `late_settlement` (money is expected, just delayed) and `fx_variance` within threshold. Summed across open discrepancies to compute total portfolio exposure in `gold_exposure_tracker`. | ≥ 0 | `50000.000000` |
| `status` | ENUM | No | [DBT]/[MANUAL] | [INT] | Current lifecycle state of this discrepancy. | `open` = raised, no action taken `under_review` = being investigated `resolved` = closed with resolution `false_positive` = reclassified as not a real discrepancy `escalated` = sent to senior review or PSP dispute team | `open` |
| `raised_at` | TIMESTAMPTZ | No | [SYS] | [INT] | UTC timestamp when this discrepancy was first detected and written. | Valid timestamp ≤ NOW() | `2026-05-01T10:00:01.000Z` |
| `reviewed_at` | TIMESTAMPTZ | Yes | [MANUAL] | [INT] | UTC timestamp when a human first opened and reviewed this discrepancy. NULL until reviewed. | Valid timestamp ≥ `raised_at`, or NULL | `2026-05-01T14:30:00.000Z` |
| `resolved_at` | TIMESTAMPTZ | Yes | [MANUAL] | [INT] | UTC timestamp of final resolution. Required when status is `resolved` or `false_positive`. | Valid timestamp ≥ `reviewed_at`, or NULL | `2026-05-02T09:15:00.000Z` |
| `resolved_by` | VARCHAR(200) | Yes | [MANUAL] | [INT] | Identifier of the operator who resolved this discrepancy. Required when `resolved_at` is not NULL. | API key prefix or operator identifier | `reck_A3f` |
| `resolution_note` | TEXT | Yes | [MANUAL] | [INT] | Mandatory explanation of how and why this discrepancy was resolved. Required when status is `resolved` or `false_positive`. A resolution without a note is an audit gap. | Non-empty free text when resolved | `PSP confirmed settlement batch delay due to CBN NIBSS downtime on 2026-05-01. Settlement arrived 2026-05-02 08:47 WAT.` |
| `resolution_type` | VARCHAR(100) | Yes | [MANUAL] | [INT] | Machine-readable classification of the resolution method. Enables trend analysis: if `psp_confirmed_failure` is rising, it signals a PSP reliability problem. | `found_in_next_batch` `psp_confirmed_failure` `manual_adjustment` `write_off` `false_positive_reclassified` `timing_delay_resolved` | `found_in_next_batch` |
| `has_alert_sent` | BOOLEAN | No | [SYS] | [INT] | Whether the alerting flow has dispatched a notification for this discrepancy. FALSE until the alert flow processes it. A partial index on this field drives the alert queue query efficiently. | `TRUE` `FALSE` | `FALSE` |
| `alert_sent_at` | TIMESTAMPTZ | Yes | [SYS] | [INT] | UTC timestamp when the alert was dispatched. NULL until `has_alert_sent = TRUE`. | Valid timestamp ≥ `raised_at`, or NULL | `2026-05-01T10:00:05.000Z` |
| `escalated_at` | TIMESTAMPTZ | Yes | [MANUAL]/[SYS] | [INT] | UTC timestamp when this discrepancy was escalated to senior review. Set automatically when status transitions to `escalated`, or manually by an operator. NULL unless escalated. | Valid timestamp ≥ `raised_at`, or NULL | `2026-05-01T18:00:00.000Z` |
| `dbt_run_id` | UUID | Yes | [INT] | [DBT] | FK to `system_pipeline_runs.id`. The dbt run that generated this discrepancy record. | Valid UUID or NULL | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `created_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp of record creation. | Valid timestamp ≤ NOW() | `2026-05-01T10:00:01.441Z` |
| `updated_at` | TIMESTAMPTZ | No | [INT] | [TRIGGER] | UTC timestamp of most recent change. | Valid timestamp ≥ `created_at` | `2026-05-01T14:30:01.203Z` |

**Evidence JSONB schemas by classification:**

```
missing_settlement:
{
  "expected_at":           "2026-05-02T17:00:00Z",   -- expected_settlement_at
  "hours_overdue":         26.5,                      -- hours past expected_at
  "psp_name":              "paystack",
  "psp_transaction_ref":   "T_abc123xyz",
  "initiated_at":          "2026-05-01T08:12:00Z",
  "polling_attempts":      3                          -- how many fallback polls found nothing
}

amount_mismatch:
{
  "expected_ngn":          50000.00,                  -- amount_a_ngn
  "received_ngn":          49500.00,                  -- amount_b_ngn
  "delta_ngn":             -500.00,                   -- shortfall
  "delta_pct":             -0.01,                     -- 1% short
  "fx_conversion_involved": false
}

fx_variance:
{
  "expected_rate":         0.00063291,
  "applied_rate":          0.00062100,
  "variance_pct":          0.018800,                  -- 1.88% — above threshold
  "threshold_pct":         0.005000,                  -- system configured threshold
  "initiation_rate":       0.00063291,
  "settlement_rate":       0.00062100
}

duplicate_credit:
{
  "original_tx_id":        "a1b2c3d4-...",
  "duplicate_tx_id":       "b2c3d4e5-...",
  "delta_seconds":         187,                       -- time between duplicates
  "original_received_at":  "2026-05-01T08:14:32Z",
  "duplicate_received_at": "2026-05-01T08:17:39Z"
}

unmatched_credit:
{
  "received_amount_ngn":   50000.00,
  "psp_name":              "flutterwave",
  "psp_reference":         "FLW-TXN-99887",
  "received_at":           "2026-05-01T09:00:00Z",
  "search_window_hours":   48,                        -- how far back matching was attempted
  "candidates_evaluated":  0                          -- no close matches found
}

late_settlement:
{
  "expected_at":           "2026-05-02T16:00:00Z",
  "actual_at":             "2026-05-02T19:47:00Z",
  "lag_hours_actual":      27.58,
  "lag_hours_expected":    24.00,
  "overage_hours":         3.58
}
```

---

### 7.3 `gold_cbn_daily_returns`

**Purpose:** CBN-format daily transaction returns. One record per calendar date. Generated by the `daily_report_flow` at 02:00 WAT each day for the previous business day. Tracks its own submission lifecycle from `draft` through `acknowledged`.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier for this daily return record. | Any valid UUID | `f6a7b8c9-d0e1-f2a3-b4c5-d6e7f8a9b0c1` |
| `return_date` | DATE | No | [INT] | [SYS] | The calendar date (WAT) this return covers. UNIQUE constraint ensures one return per date. All transactions where `initiated_at AT TIME ZONE 'Africa/Lagos'` falls on this date are included. | Valid past date | `2026-05-01` |
| `generated_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this return was generated by the daily_report_flow. | Valid timestamp ≤ NOW() | `2026-05-02T01:00:03.000Z` |
| `generated_by_run_id` | UUID | No | [INT] | [SYS] | FK to `system_pipeline_runs.id`. The pipeline run that produced this report. ON DELETE RESTRICT — a run record cannot be deleted while a CBN return references it. | Valid UUID | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |
| `total_transaction_count` | INTEGER | No | [INT] | [DBT] | Total number of transactions processed on `return_date` across all PSPs. | ≥ 0 | `847` |
| `total_credit_count` | INTEGER | No | [INT] | [DBT] | Count of credit transactions on `return_date`. | ≥ 0, ≤ total_transaction_count | `512` |
| `total_debit_count` | INTEGER | No | [INT] | [DBT] | Count of debit transactions on `return_date`. | ≥ 0, ≤ total_transaction_count | `335` |
| `total_credit_volume_ngn` | NUMERIC(25,2) | No | [INT] | [DBT] | Sum of all credit transaction amounts in NGN on `return_date`. | ≥ 0 | `84750000.00` |
| `total_debit_volume_ngn` | NUMERIC(25,2) | No | [INT] | [DBT] | Sum of all debit transaction amounts in NGN on `return_date`. | ≥ 0 | `61230000.00` |
| `cross_border_count` | INTEGER | No | [INT] | [DBT] | Count of transactions where `currency_raw != 'NGN'`, indicating cross-border activity. Reported separately per CBN foreign transfer reporting requirements. | ≥ 0 | `47` |
| `cross_border_volume_ngn` | NUMERIC(25,2) | No | [INT] | [DBT] | NGN equivalent sum of all cross-border transactions on `return_date`. | ≥ 0 | `12500000.00` |
| `suspicious_tx_count` | INTEGER | No | [INT] | [DBT] | Count of transactions flagged by the anomaly engine as suspicious. In MVP: transactions that match ML-flagged velocity or amount patterns. In practice: a placeholder for future AML module integration. | ≥ 0 | `3` |
| `unreconciled_count` | INTEGER | No | [INT] | [DBT] | Count of transactions initiated on `return_date` that remain unreconciled (no matching settlement found) at report generation time. | ≥ 0 | `12` |
| `unreconciled_exposure_ngn` | NUMERIC(25,2) | No | [INT] | [DBT] | Sum of NGN amounts for all unreconciled transactions on `return_date`. Represents financial exposure reported to CBN. | ≥ 0 | `1847500.00` |
| `matched_count` | INTEGER | No | [INT] | [DBT] | Count of transactions with confirmed successful reconciliation. For internal quality tracking, not a standard CBN field. | ≥ 0 | `835` |
| `match_rate_pct` | NUMERIC(7,4) | Yes | [INT] | [DBT] | Reconciliation match rate as a percentage. Formula: `(matched_count / total_transaction_count) * 100`. NULL if total_transaction_count = 0 (no-activity day). | 0.0000 to 100.0000, or NULL | `98.5832` |
| `open_discrepancy_count` | INTEGER | No | [INT] | [DBT] | Count of open discrepancies at report generation time that involve transactions from `return_date`. A non-zero value on a return submitted to CBN requires an explanatory note. | ≥ 0 | `12` |
| `report_payload` | JSONB | No | [INT] | [DBT] | Full CBN-format JSON payload ready for submission. Structure matches the CBN electronic return template. Validated against the CBN schema before insert. Stored for re-submission without recomputation. | Valid JSON conforming to CBN return schema | `{"return_period": "2026-05-01", "institution_code": "...", "transactions": [...]}` |
| `submission_status` | ENUM | No | [MANUAL] | [INT] | Lifecycle state of this return's submission to CBN. Transitions must follow the sequence: draft → approved → submitted → acknowledged. | `draft` `approved` `submitted` `acknowledged` | `draft` |
| `approved_by` | VARCHAR(200) | Yes | [MANUAL] | [INT] | Identifier of the compliance officer who approved this return for submission. Required before status can advance to `submitted`. | Operator identifier | `aisha.compliance` |
| `approved_at` | TIMESTAMPTZ | Yes | [MANUAL] | [INT] | UTC timestamp of approval. | Valid timestamp ≥ `generated_at`, or NULL | `2026-05-02T08:30:00.000Z` |
| `submitted_at` | TIMESTAMPTZ | Yes | [MANUAL] | [INT] | UTC timestamp when the return was transmitted to CBN. NULL until submitted. | Valid timestamp ≥ `approved_at`, or NULL | `2026-05-02T09:00:00.000Z` |
| `cbn_acknowledgement_ref` | VARCHAR(200) | Yes | [INT] | [MANUAL] | CBN's acknowledgement reference number for a submitted return. NULL until CBN confirms receipt. | CBN-format reference string | `CBN-RTN-2026-0502-00847` |
| `acknowledgement_received_at` | TIMESTAMPTZ | Yes | [MANUAL] | [INT] | UTC timestamp when CBN's acknowledgement was received. | Valid timestamp ≥ `submitted_at`, or NULL | `2026-05-02T11:15:00.000Z` |

---

### 7.4 `gold_exposure_tracker`

**Purpose:** Daily snapshot of open financial exposure by PSP and discrepancy classification. Computed by the dbt `gold_exposure_tracker` model after each Gold run. Powers the dashboard's exposure trend chart and the alert threshold logic.

| Field | Type | Null | Sensitivity | Source | Business Definition | Valid Values | Example |
|---|---|---|---|---|---|---|---|
| `id` | UUID | No | [INT] | [SYS] | Unique identifier. | Any valid UUID | `a7b8c9d0-e1f2-a3b4-c5d6-e7f8a9b0c1d2` |
| `snapshot_date` | DATE | No | [INT] | [DBT] | The calendar date (WAT) this exposure snapshot represents. Combined with `psp_name` and `classification` forms the UNIQUE key. | Valid past date | `2026-05-01` |
| `psp_name` | ENUM | No | [INT] | [DBT] | The PSP this exposure row covers. | `paystack` `flutterwave` `mpesa` `moniepoint` | `paystack` |
| `classification` | ENUM | No | [INT] | [DBT] | The discrepancy type this exposure row covers. One row per (date, PSP, classification) combination. | All values from `discrepancy_class_enum` | `missing_settlement` |
| `open_discrepancy_count` | INTEGER | No | [INT] | [DBT] | Count of open discrepancies of this classification for this PSP on this date. | ≥ 0 | `3` |
| `total_exposure_ngn` | NUMERIC(20,6) | No | [INT] | [DBT] | Sum of `estimated_exposure_ngn` for all open discrepancies of this classification/PSP/date. | ≥ 0 | `150000.000000` |
| `oldest_open_discrepancy_at` | TIMESTAMPTZ | Yes | [INT] | [DBT] | Timestamp of the oldest currently open discrepancy in this bucket. NULL if `open_discrepancy_count = 0`. An old open discrepancy that hasn't been reviewed is an operational red flag. | Valid timestamp, or NULL | `2026-04-29T08:14:32.000Z` |
| `computed_at` | TIMESTAMPTZ | No | [INT] | [SYS] | UTC timestamp when this snapshot was computed. | Valid timestamp ≤ NOW() | `2026-05-01T10:00:05.000Z` |
| `computed_by_run_id` | UUID | Yes | [INT] | [DBT] | FK to `system_pipeline_runs.id`. | Valid UUID or NULL | `a3f9b2c1-d4e5-f6a7-b8c9-d0e1f2a3b4c5` |

---

### 7.5 `gold_reconciliation_summary` (Materialized View)

**Purpose:** Pre-aggregated daily summary across all PSPs. Refreshed after every Gold run. The primary data source for the Streamlit dashboard and the `/v1/reconciliation/summary` API endpoint.

| Field | Type | Sensitivity | Business Definition | Example |
|---|---|---|---|---|
| `summary_date` | DATE | [PUB] | Calendar date (WAT) this summary row covers. | `2026-05-01` |
| `psp_name` | ENUM | [PUB] | The PSP this summary row covers. One row per (date, PSP) combination. | `paystack` |
| `total_transactions` | INTEGER | [INT] | Total canonical transactions processed on this date for this PSP. | `512` |
| `total_volume_ngn` | NUMERIC(20,6) | [INT] | Sum of all transaction amounts in NGN. | `84750000.000000` |
| `total_matched` | INTEGER | [INT] | Count of transactions with status `matched` in gold_reconciliation_pairs. | `505` |
| `matched_volume_ngn` | NUMERIC(20,6) | [INT] | Sum of NGN amounts for matched transactions only. | `83750000.000000` |
| `match_rate_pct` | NUMERIC(7,4) | [PUB] | `(total_matched / total_transactions) * 100`. The headline reconciliation KPI. | `98.6328` |
| `open_discrepancy_count` | INTEGER | [INT] | Count of discrepancies currently in `open` status linked to this date/PSP. | `7` |
| `resolved_discrepancy_count` | INTEGER | [INT] | Count of discrepancies linked to this date/PSP that have been resolved. | `0` |
| `open_exposure_ngn` | NUMERIC(20,6) | [INT] | Sum of `estimated_exposure_ngn` for open discrepancies on this date/PSP. | `1000000.000000` |
| `avg_settlement_lag_minutes` | NUMERIC(10,2) | [INT] | Average actual settlement lag across matched pairs for this date/PSP. | `1438.50` |
| `sla_breach_count` | INTEGER | [INT] | Count of transactions where `settlement_sla_breached = TRUE`. | `2` |
| `last_refreshed_at` | TIMESTAMPTZ | [INT] | UTC timestamp of the most recent `REFRESH MATERIALIZED VIEW CONCURRENTLY` execution. Used to display data freshness in the dashboard. | `2026-05-01T10:00:08.000Z` |

---

## 8. Cross-Table Field Consistency Rules

These rules apply across the entire schema and must be enforced in application code, dbt tests, and pipeline validation logic.

```
Rule ID   Scope                               Rule Description
───────── ─────────────────────────────────── ──────────────────────────────────────────────────
XR-001    All timestamp fields                All timestamps stored as TIMESTAMPTZ (UTC).
                                              WAT display conversion at the application layer only.
                                              No bare TIMESTAMP columns.

XR-002    All monetary fields                 NUMERIC(20,6) for transaction-level amounts.
                                              NUMERIC(25,2) for aggregated report totals.
                                              No FLOAT or DOUBLE PRECISION for money.

XR-003    PII fields                          PII fields in Silver must always be masked.
                                              has_pii_masked = TRUE enforced by CHECK constraint.
                                              PII fields are never logged, even as DEBUG output.
                                              PII fields are never returned by API without
                                              explicit 'admin' scope.

XR-004    FX fields                           fx_rate_snapshot_id IS NULL ↔ currency_raw = 'NGN'
                                              fx_rate_applied IS NULL ↔ currency_raw = 'NGN'
                                              Enforced by CHECK constraint on silver_canonical_transactions.

XR-005    Idempotency key format              Format: {psp_name}:{psp_transaction_ref}:{event_type}
                                              Must be consistent between silver_idempotency_keys.key
                                              and silver_canonical_transactions.idempotency_key.
                                              Any deviation is a data integrity failure.

XR-006    Resolution completeness             resolved_at, resolved_by, resolution_note
                                              must all be non-NULL together.
                                              Partial resolution is not permitted.
                                              Enforced by CHECK constraints.

XR-007    Audit log append-only               No UPDATE or DELETE on silver_transaction_audit_log.
                                              Enforced via role permissions.
                                              A SELECT on this table should never return a record
                                              with updated_at ≠ occurred_at.

XR-008    Amount consistency                  gold_reconciliation_pairs.amount_a_ngn must equal
                                              silver_canonical_transactions.amount_ngn for
                                              transaction_a_id at the time of Gold run.
                                              Verified by dbt test.

XR-009    CBN return completeness             total_credit_count + total_debit_count
                                              must be ≤ total_transaction_count.
                                              (≤ not = because reversal type is separate)
                                              Enforced by CHECK constraint.

XR-010    Exposure non-negative               estimated_exposure_ngn ≥ 0 always.
                                              A negative exposure has no business meaning here.
                                              Enforced by CHECK constraint.
```

---

## 9. dbt Test Coverage Map

Every field with a business rule must have a corresponding dbt test. This table maps critical fields to their test type:

```
Table                               Field                       dbt Test
─────────────────────────────────── ─────────────────────────── ──────────────────────────────────────
silver_canonical_transactions       idempotency_key             unique, not_null
silver_canonical_transactions       amount_ngn                  not_null, greater_than_or_equal_to_zero
silver_canonical_transactions       currency_raw                accepted_values: [NGN,USD,GBP,EUR,KES]
silver_canonical_transactions       settlement_status           accepted_values, not_null
silver_canonical_transactions       has_pii_masked              accepted_values: [true]
silver_idempotency_keys             key                         unique, not_null
silver_idempotency_keys             occurrence_count            greater_than_or_equal_to: 1
silver_fx_rate_snapshots            rate                        not_null, greater_than_zero
silver_fx_rate_snapshots            currency_pair               not_null, regex: ^[A-Z]{3}/[A-Z]{3}$
gold_reconciliation_pairs           confidence_score            between_zero_and_one
gold_reconciliation_pairs           transaction_a_id            not_null, relationships
gold_reconciliation_pairs           amount_a_ngn                not_null, matches_silver_source
gold_discrepancies                  estimated_exposure_ngn      not_null, greater_than_or_equal_to_zero
gold_discrepancies                  confidence_score            between_zero_and_one
gold_discrepancies                  evidence                    not_null, valid_json_by_classification
gold_cbn_daily_returns              return_date                 unique, not_null
gold_cbn_daily_returns              match_rate_pct              between_zero_and_hundred (when not null)
gold_exposure_tracker               total_exposure_ngn          not_null, greater_than_or_equal_to_zero
```

---

## 10. What This Document Unlocks

The Data Dictionary is complete. Combined with the ERD, every piece of data in the system now has a precise definition, a sensitivity classification, a derivation source, and a validation rule.

The next documents are now fully unblocked:

**Immediate next — Technical Design Document (TDD):** The stack is decided. The schema is defined. The TDD now specifies *how* everything is implemented — the Silver transform logic per PSP in code, the matching engine algorithm step by step, the Prefect flow definitions, the FastAPI middleware stack, the Docker Compose service graph, the environment variable schema, and the local development setup guide. This is the longest and most technically detailed document in the pre-engineering phase.

**Parallel track — API Specification:** The database schema and data dictionary together define everything the API needs to expose. The OpenAPI 3.1 spec can now be written with exact request/response schemas, error codes, and field definitions derived directly from this document.

Which do you want to tackle next — the TDD, or the API Specification?
