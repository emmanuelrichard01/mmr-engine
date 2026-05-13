Both documents are written to the same standard as everything before them. No generic templates. Every decision traces back to a specific requirement, a real threat, or an actual failure mode this system will face.

---

# DATA GOVERNANCE & SECURITY POLICY
## Cross-Border Mobile Money Reconciliation Engine
**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, Data Architecture Blueprint v1.0, ERD v1.0, Data Dictionary v1.0, TDD v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose

This document defines how sensitive financial data is classified, protected, retained, accessed, and disposed of throughout the system's lifecycle. It is simultaneously a technical security specification and a regulatory compliance framework.

Three regulatory regimes govern this system directly:

**NDPR (Nigeria Data Protection Regulation):** Enacted 2019, operationalised through NDPR Implementation Framework 2020 and the Nigeria Data Protection Act 2023. Applies to all personal data of Nigerian residents processed by any system, regardless of where the system operates.

**CBN Regulatory Framework:** CBN Guidelines on Electronic Banking, Risk-Based Cybersecurity Framework for Banks and Payment Service Providers (2021), and AML/CFT regulations. Applies because this system processes financial transaction data that falls under CBN oversight for licensed entities using it.

**PCI-DSS Awareness:** This system does not process raw card data and is therefore not in-scope for PCI-DSS certification. However, because it handles payment references that may appear alongside card data in PSP responses, PCI-DSS principles inform several design decisions as a defence-in-depth measure.

---

## 2. Data Classification Framework

Every piece of data in the system belongs to exactly one classification tier. Classification determines storage, access, logging, retention, and disposal rules.

```
Tier        Label       Definition
─────────── ─────────── ─────────────────────────────────────────────────────
Tier 1      CRITICAL    Data whose exposure causes direct financial harm or
                        enables identity fraud. Subject to strictest controls.
                        Examples: raw account numbers, BVN, full names in 
                        combination with account data.

Tier 2      SENSITIVE   Data that is confidential but does not directly enable
                        harm in isolation. Access controlled and audited.
                        Examples: masked account numbers, transaction amounts,
                        PSP references, settlement status.

Tier 3      INTERNAL    Operational data not for public exposure. No PII.
                        Examples: pipeline run metadata, Kafka offsets,
                        confidence scores, system logs.

Tier 4      PUBLIC      Data safe for unrestricted access.
                        Examples: PSP names, bank names, currency codes,
                        WAT timestamps, match rate percentages.
```

### 2.1 Field-Level Classification Map

Every field from the Data Dictionary, restated with its tier and justification:

```
Table                               Field                           Tier    Justification
─────────────────────────────────── ─────────────────────────────── ─────── ──────────────────────────────────────
bronze_ingestion_log (Parquet)      raw PSP payload (data field)    CRIT    Contains unmasked account numbers,
                                                                            names, BVN references as received
                                                                            from PSP. Never leaves Bronze.

silver_canonical_transactions       sender_account_masked           SENS    Masked NUBAN. Still PII under NDPR —
                                                                            partial identifiers remain personal data.
                                    beneficiary_account_masked      SENS    Same as above.
                                    beneficiary_name_masked         SENS    Masked name. Still PII.
                                    narration                       SENS    May contain partial PII despite scrubbing.
                                    amount_ngn                      SENS    Financial amount. Confidential.
                                    psp_transaction_ref             SENS    Enables PSP-side lookup of transaction.
                                    initiated_at / settled_at       SENS    Transaction timing. Confidential.
                                    fx_rate_applied                 INT     Non-PII. Operational.
                                    idempotency_key                 INT     Contains PSP reference. Internal only.
                                    psp_name                        PUB     Public knowledge.
                                    currency_raw                    PUB     Public knowledge.
                                    transaction_type                PUB     Public knowledge.

gold_discrepancies                  evidence (JSONB)                SENS    May contain amounts and references.
                                    estimated_exposure_ngn          SENS    Financial exposure amount.
                                    resolution_note                 INT     Internal operational text.

gold_cbn_daily_returns              report_payload                  SENS    Aggregate financial data for CBN.
                                    total_*_volume_ngn              SENS    Aggregate financial totals.

system_api_keys                     key_hash                        CRIT    Compromise enables impersonation.
                                    key_prefix                      INT     Partial identifier. Operational.

system_pipeline_runs                error_traceback                 INT     May reveal system internals.
                                    metadata                        INT     Operational context.
```

---

## 3. Threat Model

Before controls, the threats. This is specific to what this system does in its operating environment — not a generic OWASP checklist.

### 3.1 External Threats

**T-001 — Webhook Spoofing**
An attacker sends fabricated webhook events mimicking Paystack or Flutterwave to inject false transaction records into the Bronze layer.

*Impact:* Fabricated transactions reach Silver and Gold. False reconciliation pairs created. Financial reporting corrupted.
*Likelihood:* Medium-High. Webhook endpoints are public. Paystack/Flutterwave references are observable.
*Control:* HMAC-SHA512 signature validation (Paystack), verif-hash comparison (Flutterwave) before any processing. Events without valid signatures are dropped silently. Detailed in §4.1.

**T-002 — API Key Theft and Impersonation**
An attacker obtains a valid API key through source code exposure (committed .env), log scraping, or social engineering.

*Impact:* Unauthorised access to reconciliation data, discrepancy records, CBN report payloads. Potential for spurious resolution of genuine discrepancies.
*Likelihood:* Medium. Nigerian software teams frequently commit secrets to version control.
*Control:* Keys stored as SHA-256 hashes only. Keys never logged. .env.example never contains real keys. GitHub secret scanning enabled. Key rotation procedure defined in §6.

**T-003 — SQL Injection**
An attacker crafts malicious input in query parameters or request bodies to extract data beyond their authorisation scope.

*Impact:* Full database exposure. All tier 1 and tier 2 data at risk.
*Likelihood:* Low, but consequence is catastrophic.
*Control:* All database interactions use SQLAlchemy parameterised queries. Raw SQL with string interpolation is prohibited. dbt models use Jinja templating (not f-strings). Enforced via code review and Ruff lint rules.

**T-004 — PSP Webhook Replay Attack**
An attacker captures a valid, signed Paystack webhook and replays it hours or days later to re-trigger a transaction event.

*Impact:* Depends on processing — idempotency prevents duplicate Silver records, but the attempt may consume API rate limits and generate noise.
*Likelihood:* Low for this specific threat. Most PSP signatures don't include timestamps.
*Control:* Idempotency key registry prevents any effect on data. Rate limiting on webhook endpoints (separate from API key rate limits) mitigates DoS via replay.

**T-005 — Insider Data Exfiltration**
A developer or operator with database access exports transaction data for personal use or sale.

*Impact:* NDPR breach. Regulatory enforcement action. Financial and reputational damage.
*Likelihood:* Non-trivial. Insider threat is the most common cause of PII breaches in financial services.
*Control:* Role-based database access (three roles, principle of least privilege). PII exists only in Bronze Parquet on MinIO with separate access controls. `pgaudit` logs all data access. Access reviews quarterly. Detailed in §5.

**T-006 — Dependency Compromise (Supply Chain)**
A malicious or compromised Python package in the dependency tree introduces backdoors or data exfiltration.

*Impact:* Complete system compromise.
*Likelihood:* Low per package. Medium across an entire dependency tree.
*Control:* `pyproject.toml` pins exact versions. `pip-audit` runs in CI on every push. Dependabot configured for automated security updates. Docker base images pinned to specific digest hashes in production.

### 3.2 Operational Threats

**T-007 — Unencrypted Data in Transit**
Transaction data intercepted between services within the Docker network, or between the API and external clients.

*Control:* TLS 1.3 required for all external communication. Internal Docker network traffic encrypted via mTLS in production (Traefik or Nginx sidecar). Detailed in §4.3.

**T-008 — Database Credentials in Environment Variables Exposed via Container Inspection**
An attacker with container access runs `docker inspect` to extract environment variables containing database credentials.

*Control:* In production, secrets are injected via a secrets manager (AWS Secrets Manager or HashiCorp Vault), not environment variables. Docker secrets used where available. Detailed in §4.4.

**T-009 — Log-Based PII Leakage**
Stack traces, debug logs, or structured log fields inadvertently contain account numbers, names, or transaction references.

*Control:* PII masking applied before any data enters the Silver layer. Log sanitisation rules in structlog configuration. `LOG_LEVEL=DEBUG` prohibited in staging and production. Log review procedure in §7.

---

## 4. Security Controls

### 4.1 Webhook Authentication — Per PSP

```python
# Paystack: HMAC-SHA512
# Every byte of the raw request body is signed.
# Signature is in X-Paystack-Signature header.

import hashlib
import hmac

def validate_paystack_signature(
    raw_body: bytes,
    signature_header: str,
    secret_key: str,
) -> bool:
    """
    Constant-time comparison prevents timing oracle attacks.
    An attacker measuring response time to determine partial
    signature correctness is not viable with compare_digest.
    """
    expected = hmac.new(
        key=secret_key.encode("utf-8"),
        msg=raw_body,
        digestmod=hashlib.sha512,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

# Flutterwave: Direct hash comparison
# verif-hash header value is compared against configured secret hash.
# Same constant-time comparison principle applies.

def validate_flutterwave_signature(
    verif_hash_header: str,
    configured_secret_hash: str,
) -> bool:
    return hmac.compare_digest(configured_secret_hash, verif_hash_header)
```

**Failure behaviour:** Events with invalid signatures are silently dropped. The API returns HTTP 200 to prevent PSP retry storms. The failure is logged at WARNING level with the PSP name and a prefix of the invalid signature (first 16 chars only — not the full value, which may be sensitive). The `WEBHOOK_SIGNATURE_FAILURES` Prometheus counter increments. A rate of >10 failures/minute triggers an operational alert (potential spoofing attempt or PSP misconfiguration).

### 4.2 API Key Security

**Key generation:**
```python
import secrets
import hashlib

def generate_api_key() -> tuple[str, str, str]:
    """
    Generate a new API key.
    Returns: (raw_key, key_hash, key_prefix)
    
    raw_key:    Shown to user exactly once. Not stored anywhere.
    key_hash:   SHA-256(raw_key). Stored in system_api_keys.
    key_prefix: First 8 chars. Stored for identification.
    """
    random_component = secrets.token_urlsafe(32)
    raw_key = f"reck_{random_component}"
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    key_prefix = raw_key[:8]
    return raw_key, key_hash, key_prefix
```

**Key storage rules:**
- Raw key: never persisted anywhere. Shown to user once via API response. If lost, a new key must be generated.
- Key hash: stored in `system_api_keys.key_hash`. Used for authentication comparison.
- Key prefix: stored in `system_api_keys.key_prefix`. Used in audit logs and alerts to identify which key was used without exposing the full key.

**Key validation — timing attack prevention:**
```python
import hashlib
import hmac

def validate_api_key(raw_key: str, stored_hash: str) -> bool:
    """
    Always compute the hash and always compare — even for keys
    that don't exist. This prevents timing attacks that would
    allow an attacker to determine whether a key prefix exists
    by measuring response time differences.
    """
    computed = hashlib.sha256(raw_key.encode()).hexdigest()
    # hmac.compare_digest works on str and bytes
    # It is constant-time regardless of comparison result
    return hmac.compare_digest(computed, stored_hash)
```

**Key rotation policy:**
- Production keys: mandatory rotation every 90 days
- Integration keys: rotation on engineer departure from a project
- Compromised keys: immediate revocation via `is_active = FALSE`
- Rotation procedure: generate new key → provide to client → verify client using new key → revoke old key (keep record for 30-day audit window)

### 4.3 Transport Security

```
Context                         Protocol        Configuration
─────────────────────────────── ─────────────── ──────────────────────────────────────
External API clients → API      TLS 1.3         Enforced by reverse proxy (Nginx/Traefik)
                                                TLS 1.0, 1.1, 1.2 disabled
                                                HSTS header: max-age=31536000

PSP → Webhook endpoints         TLS 1.3         Same as above
                                                Paystack and Flutterwave both require HTTPS

API → PostgreSQL                TLS             SSL mode: require in staging/production
                                                SSL mode: prefer in local dev
                                                asyncpg: ssl=True in DSN

API → MinIO                     TLS             MINIO_USE_SSL=true in production
                                                Disabled in local dev only

API → Redpanda                  PLAINTEXT       Local dev: plaintext acceptable
                                                Staging/production: SASL_SSL

Internal Docker network         Network policy  Services isolated to rec_internal network
                                                No external exposure except API port 8000

FX Rate Provider → Worker       HTTPS           httpx enforces TLS by default
                                                Certificate verification: True (never False)
```

**Prohibited configurations — enforced by CI check:**
```python
# scripts/security_check.py
# Run as part of CI pipeline — fails build if violations found

PROHIBITED_PATTERNS = [
    ("ssl=False", "TLS disabled — not permitted outside local dev"),
    ("verify=False", "Certificate verification disabled — never permitted"),
    ("check=False", "SSL check disabled — not permitted"),
    ("MINIO_USE_SSL=false", "MinIO SSL disabled — not permitted in staging/production"),
]
```

### 4.4 Secret Management

**Local development (acceptable):**
```bash
# .env file, never committed to version control
# .gitignore must include .env explicitly

echo ".env" >> .gitignore
echo "*.env" >> .gitignore
```

**Staging and production (required):**

Secrets are not passed as environment variables. They are injected at container startup from a secrets manager:

```python
# src/config.py — production secret resolution
import boto3
import json
from functools import lru_cache

def resolve_secret(secret_name: str) -> dict:
    """
    Resolve a secret from AWS Secrets Manager.
    Called at application startup — not per-request.
    Result cached for the process lifetime.
    """
    client = boto3.client("secretsmanager", region_name="eu-west-1")
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response["SecretString"])
```

**Secret naming convention:**
```
reconciliation/{environment}/{secret_category}
reconciliation/production/database
reconciliation/production/psp-credentials
reconciliation/production/fx-provider
reconciliation/production/slack-webhook
```

**Secrets never in:**
- Source code (any file committed to version control)
- Docker images (build args that end up in image layers)
- Log output (any level)
- Error messages returned to API clients
- Slack or email alert payloads

**Detection:** GitHub secret scanning enabled on the repository. Gitleaks runs in CI pre-commit hook. Any detected secret triggers immediate key rotation, not just removal from history.

### 4.5 Database Security

```sql
-- Role permissions (from ERD document migrations/011)
-- Restated here for security context

-- The API user cannot write to Silver or Gold operational tables
-- It can only update resolution fields on existing Gold records
-- This limits blast radius if the API layer is compromised

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

-- Pipeline role: write access to specific tables only
-- Cannot access system_api_keys (separation of concerns)
REVOKE SELECT ON system_api_keys FROM reconciliation_pipeline;

-- API role: read most tables, write only resolution fields
-- Cannot read error_traceback from pipeline runs (operational detail)
-- Cannot modify Bronze layer (immutability guarantee)
REVOKE UPDATE, DELETE ON bronze_ingestion_log FROM reconciliation_api_user;

-- Audit log: no one can delete or update (append-only enforced at DB level)
REVOKE UPDATE, DELETE ON silver_transaction_audit_log FROM ALL;

-- pgaudit: log all DDL and data access on sensitive tables
ALTER SYSTEM SET pgaudit.log = 'ddl, write';
ALTER SYSTEM SET pgaudit.log_relation = 'on';
```

**Connection security:**
```python
# Production DSN format
# SSL required, no plaintext fallback
POSTGRES_PIPELINE_DSN = (
    "postgresql+asyncpg://{user}:{password}@{host}:5432/{db}"
    "?ssl=require&sslrootcert=/certs/rds-ca-bundle.pem"
)
```

**pgaudit configuration:**
```
# postgresql.conf additions
shared_preload_libraries = 'pgaudit'
pgaudit.log = 'ddl, write, role'
pgaudit.log_catalog = off       # Reduce noise from catalog queries
pgaudit.log_parameter = on      # Log bind parameters (required for audit completeness)
pgaudit.log_statement_once = off
```

**What pgaudit captures (stored in PostgreSQL logs):**
- All DDL (CREATE, ALTER, DROP)
- All INSERT, UPDATE, DELETE on all tables
- All GRANT and REVOKE
- Timestamp, user, application name, query, parameters

This directly satisfies CBN's requirement for transaction audit trails.

### 4.6 MinIO Object Security

```bash
# Bronze bucket configuration
# Applied by minio_init container on first startup

# Object Lock in COMPLIANCE mode:
# - No object can be modified or deleted for the retention period
# - Not even the root MinIO user can override this
# - 7-day minimum retention (matches Kafka topic retention for replay parity)
mc retention set --default COMPLIANCE 7d local/reconciliation-bronze

# Bucket policy: deny all public access
mc anonymous set none local/reconciliation-bronze

# Separate access keys for read vs write operations
# Write key: pipeline worker only
# Read key: recovery/debug operations only, audited
```

**Access key separation:**
```
Key Name                        Permission      Used By
─────────────────────────────── ─────────────── ──────────────────────────────
bronze-writer                   write-only      Prefect pipeline worker
bronze-reader                   read-only       Debug/recovery operations only
                                                Requires manual approval to use
```

### 4.7 PII Protection — The Masking Guarantee

The masking guarantee is: **raw PII never leaves the Bronze layer**. This is enforced at three levels:

**Level 1 — Application constraint:**
The Silver normaliser always calls masking functions before writing canonical records. `has_pii_masked = True` is set explicitly.

**Level 2 — Database constraint:**
```sql
CONSTRAINT chk_silver_tx_pii_masked CHECK (has_pii_masked = TRUE)
```
A Silver write without `has_pii_masked = TRUE` fails at the database level. The pipeline crashes loudly rather than silently persisting unmasked data.

**Level 3 — Role permission:**
The `reconciliation_api_user` role has no access to Bronze Parquet files (MinIO access is not a PostgreSQL permission). Reading raw PII requires a separate MinIO read key, which requires explicit approval and is logged.

**Masking verification in CI:**
```python
# tests/contracts/test_pii_masking.py

def test_silver_write_rejects_unmasked_record(test_db_session):
    """
    Attempt to insert a Silver record with has_pii_masked = False.
    The database CHECK constraint must reject it.
    This test verifies the database-level guarantee, not just application logic.
    """
    with pytest.raises(Exception) as exc_info:
        test_db_session.execute(
            text("""
                INSERT INTO silver_canonical_transactions
                    (..., has_pii_masked)
                VALUES
                    (..., FALSE)
            """)
        )
    assert "chk_silver_tx_pii_masked" in str(exc_info.value)
```

---

## 5. Access Control Matrix

Full RACI for data access across all system components:

```
Data Asset                  Pipeline Worker   API Service   Dashboard   DBA/Admin
─────────────────────────── ───────────────── ───────────── ─────────── ──────────
Bronze Parquet (raw PII)    Write             None          None        Audited R
bronze_ingestion_log        Write             Read          Read        Full
silver_canonical_tx         Write             Read          Read        Full
silver_fx_rate_snapshots    Write             Read          Read        Full
silver_idempotency_keys     Write             Read          None        Full
silver_psp_settlement_win   Read              Read          Read        Full
silver_transaction_audit    Write (append)    Read          None        Read only
gold_reconciliation_pairs   Write             Read+Resolve  Read        Full
gold_discrepancies          Write             Read+Resolve  Read        Full
gold_cbn_daily_returns      Write             Read+Approve  Read        Full
gold_exposure_tracker       Write             Read          Read        Full
system_pipeline_runs        Write             Read          None        Full
system_api_keys             None              Read (hash)   None        Full
system_alert_events         Write             Read          None        Full
```

**DBA/Admin access rules:**
- Requires dual approval (two named individuals) for access to Bronze Parquet
- All access sessions logged in `pgaudit` and MinIO access logs
- Access to production data requires a named incident or maintenance ticket
- Direct production database modifications require change advisory board approval

---

## 6. NDPR Compliance Framework

### 6.1 Lawful Basis for Processing

Under NDPR, processing personal data requires a lawful basis. This system's lawful bases:

```
Processing Activity                 Lawful Basis            Article Reference
─────────────────────────────────── ─────────────────────── ──────────────────
Storing raw PSP webhook payloads    Legitimate Interest     NDPR 2.2(a)
  containing beneficiary names,     (financial reconcili-
  account numbers                   ation — contractual
                                    necessity for clients)

Masked beneficiary data in Silver   Legitimate Interest     NDPR 2.2(a)
                                    + Performance of
                                    Contract

Transaction audit trail             Legal Obligation        NDPR 2.2(b)
  (CBN record-keeping requirement)  (CBN regulations)

CBN daily return reports            Legal Obligation        NDPR 2.2(b)
```

### 6.2 Data Processing Register

Maintained as a living document, updated whenever new data categories are processed:

```
Category        Purpose                     Retention   Stored Where    Access Control
─────────────── ─────────────────────────── ─────────── ─────────────── ──────────────
Account numbers Reconciliation matching      7 years     Bronze (raw)    MinIO ACL
                                             (CBN req)   Silver (masked) DB roles
Full names      Identity in raw payload      7 years     Bronze only     MinIO ACL
                                             (CBN req)
Transaction     Financial reconciliation     7 years     Silver, Gold    DB roles
amounts         and CBN reporting            (CBN req)
PSP references  Cross-PSP matching           7 years     Silver, Gold    DB roles
                                             (CBN req)
Narration text  Audit trail                  7 years     Silver          DB roles
                                             (CBN req)
IP addresses    Security/rate limiting       90 days     Application     Not persisted
                                                         memory only     to DB
```

### 6.3 Data Subject Rights — Implementation

Under NDPR Article 3.1, individuals have rights to access, correct, and delete their personal data. Implementation for this system:

**Right of Access (Article 3.1.1):**
```python
# src/api/v1/routes/data_subject.py (Phase 2 endpoint)

async def get_data_subject_records(
    identifier: str,  # Could be account number prefix or internal ref
    request_ticket_id: str,
) -> dict:
    """
    Returns all Silver records where the data subject's masked identifiers
    appear. Raw PII access (Bronze Parquet) requires separate authorised
    retrieval with documented justification.
    
    Response must be generated within 72 hours of verified request.
    """
    ...
```

**Right to Erasure (Article 3.1.6):**
Financial data subject to CBN 7-year retention cannot be erased during that period — the legal obligation lawful basis overrides the erasure right. After 7 years, automated anonymisation runs (detailed in §6.4).

**Right to Correction:** Data sourced from PSPs cannot be corrected unilaterally — corrections require PSP confirmation. The system logs correction requests and their outcomes.

### 6.4 Data Retention and Disposal

```
Data Category           Retention Period        Disposal Method
─────────────────────── ─────────────────────── ──────────────────────────────────────
Bronze Parquet (raw PII) 7 years                MinIO Object Lock expires → 
                                                 automatic deletion by MinIO
                                                 After 7 years, bucket lifecycle
                                                 rule permanently deletes

Silver transaction data  7 years                After retention: anonymise
                                                 account_masked → NULL
                                                 name_masked → NULL
                                                 narration → '[ANONYMISED]'
                                                 Amounts and references retained
                                                 for aggregate reporting

Gold reconciliation      7 years                Cascade anonymisation from Silver
Gold discrepancies       7 years                Same

Audit logs               7 years                Not anonymised — required for
                                                 CBN compliance in full

System pipeline logs     90 days                Automated log rotation
                                                 Docker log driver: json-file
                                                 max-size: 100m, max-file: 3

API access logs          90 days                Same as pipeline logs
Application metrics      13 months              Prometheus TSDB retention

FX rate snapshots        7 years                Retained as-is (no PII)

API keys (revoked)       Metadata: 7 years      key_hash and key_prefix retained
                         Raw key: never stored   for audit trail
                                                 is_active = FALSE permanently
```

**Automated retention enforcement:**

```python
# src/flows/retention_flow.py
# Runs monthly via Prefect schedule

from prefect import flow, task
from datetime import date, timedelta

RETENTION_YEARS = 7

@task
async def anonymise_expired_silver_records(session) -> int:
    """
    Anonymise Silver records where initiated_at is beyond the 7-year
    retention window. Amounts and references are preserved for aggregate
    reporting. PII fields are set to NULL.
    
    Returns count of anonymised records.
    """
    cutoff_date = date.today() - timedelta(days=365 * RETENTION_YEARS)
    result = await session.execute(
        text("""
            UPDATE silver_canonical_transactions SET
                sender_account_masked = NULL,
                beneficiary_account_masked = NULL,
                beneficiary_name_masked = NULL,
                narration = '[ANONYMISED - RETENTION PERIOD EXPIRED]',
                updated_at = NOW()
            WHERE initiated_at < :cutoff
              AND beneficiary_name_masked IS NOT NULL
            RETURNING id
        """),
        {"cutoff": cutoff_date},
    )
    return result.rowcount


@task
async def expire_minio_retention_verification() -> None:
    """
    Verify MinIO Object Lock retention is configured correctly.
    Alert if Bronze objects older than 7 years + 30 days still exist
    (indicates Object Lock misconfiguration).
    """
    ...


@flow(name="monthly-retention-flow")
async def monthly_retention_flow():
    async with pipeline_session() as session:
        anonymised = await anonymise_expired_silver_records(session)
    await expire_minio_retention_verification()
```

---

## 7. Security Incident Response

### 7.1 Incident Classification

```
Severity    Definition                              Response Time   Escalation
─────────── ─────────────────────────────────────── ─────────────── ──────────────────
P1 CRITICAL Active data breach. PII confirmed       Immediate       NDPR regulator
            exposed. System actively compromised.   (< 1 hour)      (72-hour NDPR
                                                                    notification SLA)
                                                                    CBN notification

P2 HIGH     Potential breach. Suspicious access      < 4 hours      System owner
            patterns. API key compromise suspected.                 Legal counsel

P3 MEDIUM   Failed breach attempt. Signature         < 24 hours     Engineering lead
            validation failures elevated.
            Unusual query patterns.

P4 LOW      Policy violation. Developer accessed     < 72 hours     Engineering lead
            production without ticket. Log PII
            leakage suspected.
```

### 7.2 NDPR Breach Notification Procedure

Under NDPR Article 2.11, personal data breaches must be reported to NITDA within 72 hours of becoming aware. Delayed notification must be justified.

```
Hour 0:    Breach detected or suspected
Hour 1:    Incident commander assigned
           Affected systems isolated if active breach
           Evidence preservation begins (logs, snapshots)
Hour 4:    Preliminary assessment complete
           Affected data categories identified
           Number of affected data subjects estimated
Hour 24:   Legal counsel notified
           NITDA notification drafted
Hour 48:   NITDA notification submitted
           (via NITDA Data Breach Portal)
Hour 72:   NITDA deadline
Hour 72+:  Affected data subjects notified
           (required if breach creates high risk to their rights)
```

**Notification content requirements (NDPR Article 2.11):**
- Nature of the breach
- Categories and approximate number of data subjects concerned
- Categories and approximate number of personal data records concerned
- Likely consequences of the breach
- Measures taken or proposed to address the breach

### 7.3 Runbooks for Top Threats

**Runbook: API Key Compromise (T-002)**
```
1. Immediately: SET is_active = FALSE WHERE key_hash = [compromised hash]
2. Review: query system_alert_events and API access logs for this key_prefix
3. Assess: what data was accessed, what actions were taken, over what period
4. Rotate: generate new key for the affected client, verify client switches
5. Audit: review all discrepancy resolutions triggered by this key_prefix
6. Document: incident log with timeline, scope assessment, corrective action
```

**Runbook: Signature Validation Failure Spike (T-001)**
```
1. Check: WEBHOOK_SIGNATURE_FAILURES Prometheus counter — which PSP, what rate
2. Verify: confirm PSP hasn't rotated their webhook secret unilaterally
   (Paystack and Flutterwave do this; it manifests as sudden 100% failure rate)
3. If PSP secret rotation: update PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_HASH
   and restart the API service
4. If attack signature: review source IPs from nginx/Traefik logs
   Block at infrastructure level if confirmed attack
5. If ambiguous: leave system running (events dropped, not processed)
   Alert does not require service degradation
```

---

## 8. Security Controls Verification

How each control is verified to be working, not just configured:

```
Control                     Verification Method             Frequency
─────────────────────────── ─────────────────────────────── ──────────
HMAC signature validation   CI integration test:            Every commit
                            send invalid signature →
                            verify event is dropped

API key authentication      CI integration test:            Every commit
                            request without key → 401
                            request with invalid key → 401
                            request with expired key → 401

Scope enforcement           CI integration test:            Every commit
                            read key → 403 on write endpoint
                            write key → 200 on write endpoint

PII masking (DB constraint) CI integration test:            Every commit
                            attempt Silver write with
                            has_pii_masked=FALSE →
                            verify DB rejects

Rate limiting               CI integration test:            Every commit
                            send 101 requests in 60s →
                            verify 429 on 101st

TLS enforcement             Staging automated check:        Weekly
                            curl --tlsv1.0 → connection refused
                            curl --tlsv1.2 → connection refused
                            curl --tlsv1.3 → 200

pgaudit logging             Manual spot check:              Monthly
                            run known query → verify
                            it appears in audit log

MinIO Object Lock           Automated check:                Weekly
                            attempt delete of Bronze
                            object → verify rejected

Secret scanning             GitHub Actions + gitleaks       Every commit
                            pre-commit hook

Dependency audit            pip-audit in CI                 Every commit

Retention enforcement       Integration test:               Monthly
                            insert record with 8-year-old
                            initiated_at → run retention flow
                            → verify PII fields nulled
```
