# API SPECIFICATION

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0.0
**Format:** OpenAPI 3.1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, ERD v1.0, Data Dictionary v1.0, TDD v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose and Scope

The TDD defined how the system is built internally. This document defines how the system is consumed externally. It is the contract between the API and every client — dashboards, integrations, CI/CD pipelines, and future engineers.

Three guarantees this document makes:

**Precision:** Every field has a type, a description, an example, and defined behaviour on absence or invalidity. No implicit assumptions.

**Completeness:** Every possible response from every endpoint is documented — not just the happy path. Errors are first-class citizens of this specification.

**Stability:** The versioning strategy and deprecation policy are defined here. A client built against this spec will not break without explicit, versioned notice.

---

## 2. API Design Principles

Before any endpoint definition, these principles govern every decision in this document.

**Principle 1 — Errors are information, not exceptions.**
Every error response carries a machine-readable `error` code, a human-readable `message`, and contextual `details`. A client should never need to parse an error message string to understand what went wrong.

**Principle 2 — The API never lies about state.**
If a webhook has been received and deduplicated, the response says so. If a discrepancy is open but under review, that distinction is in the response. Ambiguous state responses cause client-side bugs.

**Principle 3 — Idempotency is the client's right.**
All `POST` endpoints that create or trigger processing accept idempotency. Calling the same endpoint twice with identical data produces the same observable outcome, not a duplicate.

**Principle 4 — Pagination is always available, never optional.**
Every list endpoint is paginated from day one. A response that returns all records today returns an unmanageable payload in six months. Cursor-based pagination is used throughout — offset pagination degrades at scale.

**Principle 5 — Sensitive data is never in URLs.**
Transaction references, account numbers, and any PII-adjacent identifiers are never in URL path or query parameters. They appear only in request bodies or response bodies, which are TLS-protected and not logged by default.

**Principle 6 — The API fails loudly and precisely at the boundary.**
Validation failures return 422 with field-level detail. Missing authentication returns 401. Insufficient scope returns 403. These are never collapsed into generic 400s.

---

## 3. Base Configuration

```
Base URL (local):     http://localhost:8000
Base URL (staging):   https://api-staging.reconciliation.internal
Base URL (production): https://api.reconciliation.internal

API Version Prefix:   /v1
Health Endpoint:      /health        (no auth, no versioning)
Metrics Endpoint:     /metrics       (no auth, internal access only)

TLS:                  Required for staging and production
                      HTTP accepted in local development only

Content-Type:         application/json for all request/response bodies
                      Webhook endpoints also accept raw bytes for HMAC validation
```

---

## 4. Authentication and Authorization

### 4.1 Authentication Scheme

All API endpoints (except `/health`, `/metrics`, and webhook ingestion endpoints) require authentication via API key.

```
Header:  X-API-Key: {raw_api_key}
```

The raw key is hashed (SHA-256) on receipt and compared against `system_api_keys.key_hash`. The raw key is never stored and cannot be recovered after initial issuance.

**Key format:** `reck_{32_random_alphanumeric_chars}`
**Example:** `reck_A3f9B2c1D4e5F6a7B8c9D0e1F2a3B4c5`

### 4.2 Authorization Scopes

```
Scope       Permissions
─────────── ─────────────────────────────────────────────────────────
read        GET on all data endpoints
            Cannot modify any records
            
write       read + POST on resolution and review endpoints
            Cannot access admin functions
            
admin       write + access to key management, CBN report approval,
            system configuration endpoints
```

### 4.3 Webhook Authentication

Webhook endpoints authenticate via PSP-specific HMAC signatures, not API keys. The full mechanism is defined per endpoint. A missing or invalid signature results in the event being silently dropped — the API always returns HTTP 200 to prevent PSP retry storms.

---

## 5. Standard Response Envelope

Every response — success or error — uses a consistent envelope structure.

### 5.1 Success Envelope

```json
{
  "data": { },          // The actual response payload — object or array
  "meta": {             // Present on list responses only
    "page_size": 20,
    "next_cursor": "eyJpZCI6IjEyMyJ9",
    "prev_cursor": null,
    "total_count": 847,
    "has_more": true
  },
  "request_id": "req_3f4a5b6c7d8e9f0a"
}
```

### 5.2 Error Envelope

```json
{
  "error": "validation_error",
  "message": "One or more fields failed validation.",
  "details": [
    {
      "field": "start_date",
      "code": "invalid_date_format",
      "message": "Expected ISO 8601 date (YYYY-MM-DD), got '05-01-2026'"
    }
  ],
  "request_id": "req_3f4a5b6c7d8e9f0a",
  "documentation_url": "https://docs.reconciliation.internal/errors#validation_error"
}
```

### 5.3 Error Code Registry

Every machine-readable `error` value used anywhere in this API:

```
Error Code                      HTTP Status     Meaning
─────────────────────────────── ─────────────── ────────────────────────────────────────────
missing_api_key                 401             X-API-Key header absent
invalid_api_key                 401             Key hash not found or key inactive
expired_api_key                 401             Key exists but past expires_at
insufficient_scope              403             Key valid but lacks required scope
rate_limit_exceeded             429             >100 requests/minute for this key
not_found                       404             Resource with given ID does not exist
validation_error                422             Request body or query param failed validation
conflict                        409             Request would create a duplicate record
internal_server_error           500             Unhandled server-side failure
service_unavailable             503             Dependency (DB, Kafka) temporarily unavailable
webhook_signature_invalid       200*            PSP webhook HMAC validation failed
                                                *Always 200 to prevent PSP retry storms
idempotent_request              200             Request deduplicated — previous result returned
discrepancy_already_resolved    409             Attempt to resolve an already-resolved discrepancy
report_not_yet_generated        404             CBN report for the requested date not yet generated
invalid_date_range              422             start_date > end_date or range exceeds 90 days
cursor_invalid                  422             Pagination cursor is malformed or expired
```

---

## 6. Pagination

All list endpoints use cursor-based pagination.

### 6.1 Request Parameters

```
page_size   integer   Records per page. Default: 20. Min: 1. Max: 100.
cursor      string    Opaque cursor from previous response meta.next_cursor.
                      Absent on first request. Encodes the last seen record's
                      sort key as base64 JSON.
```

### 6.2 Cursor Design

```python
# Cursor encoding (internal — not part of public contract)
import base64, json

def encode_cursor(last_id: str, last_created_at: str) -> str:
    payload = {"id": last_id, "created_at": last_created_at}
    return base64.urlsafe_b64encode(
        json.dumps(payload).encode()
    ).decode()

def decode_cursor(cursor: str) -> dict:
    return json.loads(base64.urlsafe_b64decode(cursor.encode()))
```

Cursors are valid for 24 hours. An expired cursor returns `cursor_invalid`.

---

## 7. Rate Limiting

```
Limit:          100 requests per minute per API key
Window:         Rolling 60-second window
Response:       HTTP 429 on breach
Headers returned on every response:

    X-RateLimit-Limit:      100
    X-RateLimit-Remaining:  87
    X-RateLimit-Reset:      1746095460    (Unix timestamp of window reset)
    Retry-After:            23            (seconds, only on 429 response)
```

---

## 8. OpenAPI 3.1.0 Specification

```yaml
openapi: "3.1.0"

info:
  title: "Cross-Border Mobile Money Reconciliation Engine API"
  version: "1.0.0"
  description: |
    Event-driven financial reconciliation API for multi-PSP Nigerian 
    payment environments.

    ## Authentication
    All endpoints (except `/health`, `/metrics`, and webhook ingestion)
    require an API key passed in the `X-API-Key` header.

    ## Webhook Authentication
    Webhook endpoints authenticate via PSP-specific HMAC signatures.
    See individual endpoint descriptions for details.

    ## Error Handling
    All errors follow a consistent envelope. See the `Error` schema
    and the error code registry in the API specification document.

    ## Versioning
    This is v1 of the API. Breaking changes will be introduced only
    in a new major version (`/v2`). Non-breaking additions
    (new optional fields, new endpoints) may be made to v1 without
    version increment.

  contact:
    name: "Emmanuel Richard"
    email: "engineering@reconciliation.internal"

  license:
    name: "Proprietary"

servers:
  - url: "http://localhost:8000"
    description: "Local development"
  - url: "https://api-staging.reconciliation.internal"
    description: "Staging"
  - url: "https://api.reconciliation.internal"
    description: "Production"

# ── Security Schemes ────────────────────────────────────────────────────────
components:
  securitySchemes:
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-API-Key
      description: |
        API key in format `reck_{32_chars}`. 
        Required scope varies per endpoint — see endpoint documentation.

  # ── Reusable Parameters ──────────────────────────────────────────────────
  parameters:
    PageSize:
      name: page_size
      in: query
      required: false
      schema:
        type: integer
        minimum: 1
        maximum: 100
        default: 20
      description: Number of records per page.

    Cursor:
      name: cursor
      in: query
      required: false
      schema:
        type: string
      description: |
        Opaque pagination cursor from `meta.next_cursor` of a previous 
        response. Omit for first page.

    PspNameFilter:
      name: psp_name
      in: query
      required: false
      schema:
        $ref: "#/components/schemas/PspName"
      description: Filter results to a single PSP.

    StartDate:
      name: start_date
      in: query
      required: false
      schema:
        type: string
        format: date
        example: "2026-05-01"
      description: |
        Filter start date (WAT calendar date, inclusive).
        Format: YYYY-MM-DD.

    EndDate:
      name: end_date
      in: query
      required: false
      schema:
        type: string
        format: date
        example: "2026-05-31"
      description: |
        Filter end date (WAT calendar date, inclusive).
        Must be >= start_date. Maximum range: 90 days.

  # ── Reusable Schemas ─────────────────────────────────────────────────────
  schemas:

    # ── Primitives and Enums ────────────────────────────────────────────────
    UUID:
      type: string
      format: uuid
      example: "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6"

    AmountNGN:
      type: number
      format: double
      minimum: 0
      description: |
        Monetary amount in Nigerian Naira (NGN).
        Always represented as a decimal number with up to 6 decimal places.
        Example: 50000.00 = NGN 50,000.00
      example: 50000.00

    ConfidenceScore:
      type: number
      format: float
      minimum: 0.0
      maximum: 1.0
      description: |
        Match or classification confidence. Range 0.0–1.0.
        0.0 = no confidence. 1.0 = certainty.
        Scores below 0.75 require human review.
      example: 0.9700

    PspName:
      type: string
      enum:
        - paystack
        - flutterwave
        - mpesa
        - moniepoint
      description: Payment Service Provider identifier.
      example: "paystack"

    TransactionType:
      type: string
      enum:
        - credit
        - debit
        - reversal
      description: Canonical transaction direction.

    SettlementStatus:
      type: string
      enum:
        - pending
        - settled
        - failed
        - reversed
        - disputed
      description: Current settlement lifecycle state.

    MatchStrategy:
      type: string
      enum:
        - exact_primary
        - probabilistic_secondary
        - manual
      description: |
        Algorithm used to produce this reconciliation pair.
        - `exact_primary`: identical amount + timestamp + account match.
        - `probabilistic_secondary`: weighted similarity scoring.
        - `manual`: human operator confirmed or created the match.

    PairStatus:
      type: string
      enum:
        - matched
        - discrepancy
        - under_review
        - resolved
        - false_positive
      description: |
        Current lifecycle state of a reconciliation pair.

    DiscrepancyClass:
      type: string
      enum:
        - missing_settlement
        - amount_mismatch
        - fx_variance
        - duplicate_credit
        - unmatched_credit
        - late_settlement
      description: |
        Classification of the anomaly type.
        - `missing_settlement`: expected settlement not received.
        - `amount_mismatch`: received but wrong amount beyond FX tolerance.
        - `fx_variance`: amount difference attributable to FX rate timing.
        - `duplicate_credit`: same transaction credited twice.
        - `unmatched_credit`: received credit with no initiating transaction found.
        - `late_settlement`: settlement received but after SLA window.

    DiscrepancyStatus:
      type: string
      enum:
        - open
        - under_review
        - resolved
        - false_positive
        - escalated

    CbnSubmissionStatus:
      type: string
      enum:
        - draft
        - approved
        - submitted
        - acknowledged

    # ── Core Resource Schemas ───────────────────────────────────────────────
    CanonicalTransaction:
      type: object
      description: |
        A single normalised transaction record from the Silver layer.
        PII fields are always masked in API responses regardless of scope.
      properties:
        id:
          $ref: "#/components/schemas/UUID"
        internal_ref:
          type: string
          description: |
            Human-readable internal reference. Safe to share in tickets/emails.
          example: "REC-A3F9B2C1D4E5F6A7B8C9D0E1F2A3B4"
        psp_name:
          $ref: "#/components/schemas/PspName"
        psp_transaction_ref:
          type: string
          description: PSP's own reference for this transaction.
          example: "T_abc123xyz789"
        psp_event_type:
          type: string
          description: Raw PSP event type as received.
          example: "charge.success"
        transaction_type:
          $ref: "#/components/schemas/TransactionType"
        amount_raw:
          type: number
          format: double
          minimum: 0
          description: Amount in original currency.
          example: 50000.00
        currency_raw:
          type: string
          minLength: 3
          maxLength: 3
          description: ISO 4217 currency code of the original transaction.
          example: "NGN"
        amount_ngn:
          $ref: "#/components/schemas/AmountNGN"
        fx_rate_applied:
          type: number
          format: double
          nullable: true
          description: |
            FX rate applied to convert to NGN. Null when currency_raw is NGN.
          example: null
        sender_account_masked:
          type: string
          nullable: true
          description: |
            Sender NUBAN, masked. Format: 01******89.
            Null when not disclosed by PSP.
          example: "01******89"
        sender_bank_name:
          type: string
          nullable: true
          example: "Guaranty Trust Bank"
        beneficiary_account_masked:
          type: string
          nullable: true
          description: |
            Beneficiary NUBAN, masked. Format: 05******23.
          example: "05******23"
        beneficiary_bank_name:
          type: string
          nullable: true
          example: "First Bank of Nigeria"
        beneficiary_name_masked:
          type: string
          nullable: true
          description: |
            Beneficiary account name, masked. Format: C****** O*******.
          example: "C****** O*******"
        narration:
          type: string
          nullable: true
          description: |
            Transaction narration, PII-scrubbed and truncated to 500 chars.
          example: "Payment for order #INV-2026-0501-A"
        initiated_at:
          type: string
          format: date-time
          description: UTC timestamp of transaction initiation on the PSP.
          example: "2026-05-01T08:12:00.000Z"
        settled_at:
          type: string
          format: date-time
          nullable: true
          description: UTC timestamp of settlement confirmation. Null if pending.
          example: "2026-05-02T10:23:00.000Z"
        expected_settlement_at:
          type: string
          format: date-time
          nullable: true
          description: Computed expected settlement time based on PSP SLA.
          example: "2026-05-02T17:00:00.000Z"
        settlement_status:
          $ref: "#/components/schemas/SettlementStatus"
        settlement_sla_breached:
          type: boolean
          description: |
            True when settlement is confirmed late, or when expected_settlement_at
            has passed without confirmation.
          example: false
        created_at:
          type: string
          format: date-time
          example: "2026-05-01T08:14:35.203Z"
      required:
        - id
        - internal_ref
        - psp_name
        - psp_transaction_ref
        - psp_event_type
        - transaction_type
        - amount_raw
        - currency_raw
        - amount_ngn
        - initiated_at
        - settlement_status
        - settlement_sla_breached
        - created_at

    ReconciliationPair:
      type: object
      description: |
        The output of the matching engine. Links two canonical transactions
        (or records an unmatched discrepancy) with match quality metadata.
      properties:
        id:
          $ref: "#/components/schemas/UUID"
        transaction_a:
          $ref: "#/components/schemas/CanonicalTransaction"
          description: The initiating/source transaction.
        transaction_b:
          allOf:
            - $ref: "#/components/schemas/CanonicalTransaction"
          nullable: true
          description: |
            The matched settlement/confirmation transaction.
            Null when no match was found (status is discrepancy).
        match_strategy:
          allOf:
            - $ref: "#/components/schemas/MatchStrategy"
          nullable: true
          description: Null when no match was found.
        confidence_score:
          allOf:
            - $ref: "#/components/schemas/ConfidenceScore"
          nullable: true
        match_evidence:
          type: object
          nullable: true
          description: |
            Structured evidence from the matching engine. Schema varies by
            match_strategy. See API documentation for evidence field reference.
          example:
            amount_exact_match: true
            timestamp_delta_seconds: 1847
            beneficiary_account_match: true
            beneficiary_name_similarity: 0.94
            fx_variance_pct: 0.0031
        amount_a_ngn:
          $ref: "#/components/schemas/AmountNGN"
        amount_b_ngn:
          allOf:
            - $ref: "#/components/schemas/AmountNGN"
          nullable: true
        amount_delta_ngn:
          type: number
          format: double
          nullable: true
          description: |
            amount_b_ngn - amount_a_ngn.
            Negative = underpayment. Positive = overpayment.
            Null when transaction_b is null.
          example: -150.00
        fx_variance_pct:
          type: number
          format: double
          nullable: true
          description: |
            Percentage of amount delta attributable to FX rate timing.
            Null when both transactions are in NGN.
          example: 0.003100
        is_within_fx_threshold:
          type: boolean
          nullable: true
          description: |
            True when FX variance is within configured tolerance (default 0.5%).
            A true value means the delta is not a genuine discrepancy.
            Null when no FX conversion involved.
          example: true
        settlement_lag_actual_minutes:
          type: number
          format: double
          nullable: true
          description: |
            Actual minutes between transaction_a.initiated_at and
            transaction_b.settled_at. Null when transaction_b is null.
          example: 1571.00
        settlement_lag_expected_minutes:
          type: number
          format: double
          nullable: true
          description: Expected settlement lag from PSP SLA configuration.
          example: 1440.00
        is_settlement_on_time:
          type: boolean
          nullable: true
          description: True when actual lag <= expected lag. Null if not yet settled.
          example: false
        status:
          $ref: "#/components/schemas/PairStatus"
        matched_at:
          type: string
          format: date-time
          example: "2026-05-01T10:00:00.441Z"
        reviewed_at:
          type: string
          format: date-time
          nullable: true
          example: null
        resolved_at:
          type: string
          format: date-time
          nullable: true
          example: null
        resolved_by:
          type: string
          nullable: true
          description: API key prefix of the resolver, or operator identifier.
          example: null
        resolution_note:
          type: string
          nullable: true
          example: null
      required:
        - id
        - transaction_a
        - amount_a_ngn
        - status
        - matched_at

    Discrepancy:
      type: object
      description: |
        A detected financial anomaly. Always linked to at least one
        canonical transaction. May or may not be linked to a
        reconciliation pair.
      properties:
        id:
          $ref: "#/components/schemas/UUID"
        reconciliation_pair_id:
          allOf:
            - $ref: "#/components/schemas/UUID"
          nullable: true
          description: |
            The reconciliation pair that generated this discrepancy.
            Null for independently raised discrepancies.
        transaction_id:
          $ref: "#/components/schemas/UUID"
        transaction:
          $ref: "#/components/schemas/CanonicalTransaction"
          description: The canonical transaction at the centre of this discrepancy.
        classification:
          $ref: "#/components/schemas/DiscrepancyClass"
        confidence_score:
          $ref: "#/components/schemas/ConfidenceScore"
        evidence:
          type: object
          description: |
            Classification-specific evidence. Structure varies by classification.
            See Data Dictionary for evidence field schemas per classification.
          example:
            expected_at: "2026-05-02T17:00:00Z"
            hours_overdue: 26.5
            psp_name: "paystack"
            psp_transaction_ref: "T_abc123xyz"
            initiated_at: "2026-05-01T08:12:00Z"
            polling_attempts: 3
        estimated_exposure_ngn:
          $ref: "#/components/schemas/AmountNGN"
          description: |
            Estimated financial exposure in NGN from this discrepancy.
            Zero for late_settlement (money expected, just delayed).
        status:
          $ref: "#/components/schemas/DiscrepancyStatus"
        raised_at:
          type: string
          format: date-time
          example: "2026-05-01T10:00:01.441Z"
        reviewed_at:
          type: string
          format: date-time
          nullable: true
        resolved_at:
          type: string
          format: date-time
          nullable: true
        resolved_by:
          type: string
          nullable: true
        resolution_note:
          type: string
          nullable: true
        resolution_type:
          type: string
          nullable: true
          description: |
            Machine-readable resolution method.
            One of: found_in_next_batch | psp_confirmed_failure |
            manual_adjustment | write_off | false_positive_reclassified |
            timing_delay_resolved
        has_alert_sent:
          type: boolean
          example: true
        escalated_at:
          type: string
          format: date-time
          nullable: true
      required:
        - id
        - transaction_id
        - transaction
        - classification
        - confidence_score
        - evidence
        - estimated_exposure_ngn
        - status
        - raised_at
        - has_alert_sent

    ReconciliationSummary:
      type: object
      description: |
        Aggregated daily reconciliation metrics for a single PSP.
        Sourced from the gold_reconciliation_summary materialized view.
        Reflects state as of last_refreshed_at.
      properties:
        summary_date:
          type: string
          format: date
          description: WAT calendar date this summary covers.
          example: "2026-05-01"
        psp_name:
          $ref: "#/components/schemas/PspName"
        total_transactions:
          type: integer
          minimum: 0
          example: 512
        total_volume_ngn:
          $ref: "#/components/schemas/AmountNGN"
        total_matched:
          type: integer
          minimum: 0
          example: 505
        matched_volume_ngn:
          $ref: "#/components/schemas/AmountNGN"
        match_rate_pct:
          type: number
          format: double
          minimum: 0
          maximum: 100
          description: |
            Reconciliation match rate as a percentage.
            Formula: (total_matched / total_transactions) * 100.
            The primary KPI for this system.
          example: 98.6328
        open_discrepancy_count:
          type: integer
          minimum: 0
          example: 7
        resolved_discrepancy_count:
          type: integer
          minimum: 0
          example: 0
        open_exposure_ngn:
          $ref: "#/components/schemas/AmountNGN"
          description: Sum of estimated_exposure_ngn for all open discrepancies.
        avg_settlement_lag_minutes:
          type: number
          format: double
          nullable: true
          description: Average actual settlement lag across matched pairs.
          example: 1438.50
        sla_breach_count:
          type: integer
          minimum: 0
          description: Transactions where settlement SLA was breached.
          example: 2
        last_refreshed_at:
          type: string
          format: date-time
          description: |
            UTC timestamp of the most recent materialized view refresh.
            Use this to assess data freshness before acting on summary data.
          example: "2026-05-01T10:00:08.000Z"
      required:
        - summary_date
        - psp_name
        - total_transactions
        - total_volume_ngn
        - total_matched
        - matched_volume_ngn
        - match_rate_pct
        - open_discrepancy_count
        - resolved_discrepancy_count
        - open_exposure_ngn
        - sla_breach_count
        - last_refreshed_at

    CbnDailyReturn:
      type: object
      description: |
        A CBN-format daily transaction return record.
        One per calendar day. Tracks its own submission lifecycle.
      properties:
        id:
          $ref: "#/components/schemas/UUID"
        return_date:
          type: string
          format: date
          example: "2026-05-01"
        generated_at:
          type: string
          format: date-time
          example: "2026-05-02T01:00:03.000Z"
        total_transaction_count:
          type: integer
          minimum: 0
          example: 847
        total_credit_count:
          type: integer
          minimum: 0
          example: 512
        total_debit_count:
          type: integer
          minimum: 0
          example: 335
        total_credit_volume_ngn:
          $ref: "#/components/schemas/AmountNGN"
        total_debit_volume_ngn:
          $ref: "#/components/schemas/AmountNGN"
        cross_border_count:
          type: integer
          minimum: 0
          example: 47
        cross_border_volume_ngn:
          $ref: "#/components/schemas/AmountNGN"
        suspicious_tx_count:
          type: integer
          minimum: 0
          example: 3
        unreconciled_count:
          type: integer
          minimum: 0
          example: 12
        unreconciled_exposure_ngn:
          $ref: "#/components/schemas/AmountNGN"
        matched_count:
          type: integer
          minimum: 0
          example: 835
        match_rate_pct:
          type: number
          format: double
          nullable: true
          minimum: 0
          maximum: 100
          example: 98.5832
        open_discrepancy_count:
          type: integer
          minimum: 0
          example: 12
        submission_status:
          $ref: "#/components/schemas/CbnSubmissionStatus"
        approved_by:
          type: string
          nullable: true
          example: "aisha.compliance"
        approved_at:
          type: string
          format: date-time
          nullable: true
        submitted_at:
          type: string
          format: date-time
          nullable: true
        cbn_acknowledgement_ref:
          type: string
          nullable: true
          example: "CBN-RTN-2026-0502-00847"
      required:
        - id
        - return_date
        - generated_at
        - total_transaction_count
        - total_credit_count
        - total_debit_count
        - total_credit_volume_ngn
        - total_debit_volume_ngn
        - cross_border_count
        - cross_border_volume_ngn
        - suspicious_tx_count
        - unreconciled_count
        - unreconciled_exposure_ngn
        - matched_count
        - open_discrepancy_count
        - submission_status

    WebhookAcknowledgement:
      type: object
      description: Response returned to PSP after webhook receipt.
      properties:
        status:
          type: string
          enum:
            - received
          description: Always "received". Never reveals internal processing state.
          example: "received"
        is_new:
          type: boolean
          description: |
            True if this event was not previously seen (new processing initiated).
            False if the event was deduplicated (already processed).
            Informational only — PSP should not change behaviour based on this.
          example: true
      required:
        - status
        - is_new

    ResolveDiscrepancyRequest:
      type: object
      description: Request body for resolving a discrepancy.
      properties:
        resolution_note:
          type: string
          minLength: 20
          maxLength: 2000
          description: |
            Mandatory explanation of how and why this discrepancy is resolved.
            Minimum 20 characters enforced — "Resolved" alone is not acceptable.
            This note is stored permanently in the audit trail.
          example: >
            PSP confirmed settlement batch delay due to CBN NIBSS downtime
            on 2026-05-01. Settlement arrived 2026-05-02 08:47 WAT.
            Confirmed via Paystack support ticket #PSP-20260501-8847.
        resolution_type:
          type: string
          enum:
            - found_in_next_batch
            - psp_confirmed_failure
            - manual_adjustment
            - write_off
            - false_positive_reclassified
            - timing_delay_resolved
          description: Machine-readable resolution category for trend analysis.
          example: "found_in_next_batch"
        mark_as_false_positive:
          type: boolean
          default: false
          description: |
            When true, status is set to false_positive instead of resolved.
            Use when the discrepancy was raised in error (system bug, data
            timing issue, etc.) rather than representing a genuine financial gap.
          example: false
      required:
        - resolution_note
        - resolution_type

    Error:
      type: object
      description: Standard error envelope. All errors follow this structure.
      properties:
        error:
          type: string
          description: Machine-readable error code. See error code registry.
          example: "validation_error"
        message:
          type: string
          description: Human-readable error description.
          example: "One or more fields failed validation."
        details:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
                description: Dot-notation field path that failed.
                example: "start_date"
              code:
                type: string
                description: Field-level error code.
                example: "invalid_date_format"
              message:
                type: string
                description: Field-level human-readable explanation.
                example: "Expected ISO 8601 date (YYYY-MM-DD), got '05-01-2026'"
          description: Field-level error details. Present on validation_error only.
        request_id:
          type: string
          description: |
            Request ID from X-Request-ID header or system-generated.
            Include this when reporting issues.
          example: "req_3f4a5b6c7d8e9f0a"
        documentation_url:
          type: string
          format: uri
          description: Link to documentation for this error code.
          example: "https://docs.reconciliation.internal/errors#validation_error"
      required:
        - error
        - message
        - request_id

  # ── Reusable Responses ──────────────────────────────────────────────────
  responses:
    Unauthorized:
      description: Authentication failed or API key missing.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          examples:
            missing_key:
              summary: X-API-Key header absent
              value:
                error: "missing_api_key"
                message: "X-API-Key header is required."
                request_id: "req_abc123"
                documentation_url: "https://docs.reconciliation.internal/auth"
            invalid_key:
              summary: Key not recognised or inactive
              value:
                error: "invalid_api_key"
                message: "The provided API key is invalid or expired."
                request_id: "req_abc123"
                documentation_url: "https://docs.reconciliation.internal/auth"

    Forbidden:
      description: API key valid but lacks required scope.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "insufficient_scope"
            message: "This endpoint requires 'write' scope. Your key has 'read' only."
            request_id: "req_abc123"
            documentation_url: "https://docs.reconciliation.internal/auth#scopes"

    NotFound:
      description: Requested resource does not exist.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "not_found"
            message: "Discrepancy with id 'e5f6a7b8-...' not found."
            request_id: "req_abc123"

    ValidationError:
      description: Request body or query parameters failed validation.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "validation_error"
            message: "One or more fields failed validation."
            details:
              - field: "resolution_note"
                code: "too_short"
                message: "Minimum length is 20 characters. Got 8."
            request_id: "req_abc123"

    RateLimitExceeded:
      description: API key has exceeded the rate limit.
      headers:
        Retry-After:
          schema:
            type: integer
          description: Seconds until rate limit window resets.
        X-RateLimit-Reset:
          schema:
            type: integer
          description: Unix timestamp of window reset.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "rate_limit_exceeded"
            message: "Rate limit of 100 requests/minute exceeded. Retry after 23 seconds."
            request_id: "req_abc123"

    InternalServerError:
      description: Unexpected server-side failure.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "internal_server_error"
            message: "An unexpected error occurred. Include request_id when reporting."
            request_id: "req_abc123"

    ServiceUnavailable:
      description: A critical dependency (database, Kafka) is temporarily unavailable.
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/Error"
          example:
            error: "service_unavailable"
            message: "Database temporarily unavailable. Retry after 10 seconds."
            request_id: "req_abc123"

# ── Security applied globally ─────────────────────────────────────────────
security:
  - ApiKeyAuth: []

# ════════════════════════════════════════════════════════════════════════════
# PATHS
# ════════════════════════════════════════════════════════════════════════════
paths:

  # ── System Endpoints ──────────────────────────────────────────────────────
  /health:
    get:
      operationId: getHealth
      summary: System health check
      description: |
        Liveness probe endpoint. Returns 200 when the API service is running.
        Does not verify dependency health (database, Kafka) — only that
        the API process itself is alive.

        **Authentication:** None required.
        **Rate limiting:** Not applied.
      tags:
        - System
      security: []
      responses:
        "200":
          description: API service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    enum: [healthy]
                    example: "healthy"
                  version:
                    type: string
                    example: "1.0.0"
                required:
                  - status
                  - version

  # ── Webhook Ingestion ─────────────────────────────────────────────────────
  /v1/webhooks/paystack:
    post:
      operationId: receivePaystackWebhook
      summary: Receive Paystack webhook event
      description: |
        Ingestion endpoint for Paystack webhook events.

        ## Authentication
        Paystack authenticates webhooks via HMAC-SHA512 signature.
        The `X-Paystack-Signature` header must contain:
        `HMAC-SHA512(paystack_secret_key, raw_request_body)`

        **Important:** This endpoint always returns HTTP 200, even when:
        - The signature is invalid (event is dropped silently)
        - The event is a duplicate (event is deduplicated silently)
        - The JSON is malformed (event is dropped silently)

        This is intentional. Returning non-200 to Paystack triggers their
        retry mechanism, flooding the system with events that will be
        rejected again.

        ## Handled Event Types
        - `charge.success` — payment received
        - `transfer.success` — transfer completed
        - `transfer.failed` — transfer failed
        - `transfer.reversed` — transfer reversed

        Other event types are accepted, stored in Bronze, and flagged as
        unclassified in Silver.

        ## Processing
        Valid events are published to Kafka and processed asynchronously.
        The response does not indicate whether processing succeeded —
        only that the event was received.
      tags:
        - Webhook Ingestion
      security: []
      parameters:
        - name: X-Paystack-Signature
          in: header
          required: false
          schema:
            type: string
          description: |
            HMAC-SHA512 signature of the raw request body.
            Computed using the Paystack secret key.
            Events without this header are silently dropped.
          example: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              description: |
                Raw Paystack webhook payload. Schema varies by event type.
                See Paystack documentation for full payload structure.
              properties:
                event:
                  type: string
                  example: "charge.success"
                data:
                  type: object
                  description: Event-specific data payload.
              required:
                - event
                - data
            example:
              event: "charge.success"
              data:
                id: 123456789
                reference: "T_abc123xyz789"
                amount: 5000000
                currency: "NGN"
                status: "success"
                paid_at: "2026-05-01T08:12:00.000Z"
                channel: "bank_transfer"
                authorization:
                  account_number: "0123456789"
                  account_name: "CHIOMA OKONKWO"
                  bank: "Guaranty Trust Bank"
                  bank_code: "058"
      responses:
        "200":
          description: |
            Event received. Always returned regardless of signature validity
            or processing outcome. Check `is_new` to determine if this was
            a new event or a deduplicated duplicate.
          headers:
            X-Request-ID:
              schema:
                type: string
              description: System-generated request identifier for tracing.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WebhookAcknowledgement"
              examples:
                new_event:
                  summary: New event — processing initiated
                  value:
                    status: "received"
                    is_new: true
                duplicate_event:
                  summary: Duplicate — silently deduplicated
                  value:
                    status: "received"
                    is_new: false

  /v1/webhooks/flutterwave:
    post:
      operationId: receiveFlutterwaveWebhook
      summary: Receive Flutterwave webhook event
      description: |
        Ingestion endpoint for Flutterwave webhook events.

        ## Authentication
        Flutterwave authenticates webhooks by sending a secret hash
        in the `verif-hash` header. The value must match the configured
        Flutterwave webhook secret hash exactly.

        Same always-200 behaviour applies as for the Paystack endpoint.

        ## Handled Event Types
        - `charge.completed` — payment received
        - `transfer.completed` — transfer completed
      tags:
        - Webhook Ingestion
      security: []
      parameters:
        - name: verif-hash
          in: header
          required: false
          schema:
            type: string
          description: |
            Flutterwave webhook verification hash.
            Must match the configured secret hash exactly.
          example: "your_flw_webhook_hash_value"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                event:
                  type: string
                  example: "charge.completed"
                data:
                  type: object
              required:
                - event
                - data
            example:
              event: "charge.completed"
              data:
                id: 987654321
                tx_ref: "FLW-TXN-99887"
                flw_ref: "FLW-MOCK-abc123xyz"
                amount: 50000
                currency: "NGN"
                status: "successful"
                created_at: "2026-05-01T08:12:00Z"
                customer:
                  name: "Tunde Adeyemi"
                  email: "tunde@example.com"
                account:
                  account_number: "0567891234"
                  account_name: "TUNDE ADEYEMI"
                  bank_code: "011"
                  bank: "First Bank of Nigeria"
      responses:
        "200":
          description: Event received.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WebhookAcknowledgement"

  # ── Reconciliation ─────────────────────────────────────────────────────────
  /v1/reconciliation/summary:
    get:
      operationId: getReconciliationSummary
      summary: Get daily reconciliation summary
      description: |
        Returns aggregated daily reconciliation metrics sourced from the
        `gold_reconciliation_summary` materialized view.

        Results reflect state as of `last_refreshed_at` — not necessarily
        real-time. The view is refreshed after every Gold pipeline run
        (typically within seconds of each new transaction event).

        ## Filtering
        - Without `psp_name`: returns one row per PSP per date in range.
        - With `psp_name`: returns rows for that PSP only.
        - Without `start_date`/`end_date`: defaults to the last 7 days.
        - Maximum date range: 90 days. Use the reports endpoint for longer periods.

        ## Required Scope
        `read`
      tags:
        - Reconciliation
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/StartDate"
        - $ref: "#/components/parameters/EndDate"
        - $ref: "#/components/parameters/PspNameFilter"
        - $ref: "#/components/parameters/PageSize"
        - $ref: "#/components/parameters/Cursor"
      responses:
        "200":
          description: Reconciliation summary records.
          headers:
            X-RateLimit-Remaining:
              schema:
                type: integer
            X-RateLimit-Reset:
              schema:
                type: integer
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/ReconciliationSummary"
                  meta:
                    type: object
                    properties:
                      page_size:
                        type: integer
                        example: 20
                      next_cursor:
                        type: string
                        nullable: true
                        example: "eyJpZCI6IjEyMyIsImNyZWF0ZWRfYXQiOiIyMDI2LTA1LTAxIn0="
                      prev_cursor:
                        type: string
                        nullable: true
                        example: null
                      total_count:
                        type: integer
                        example: 14
                      has_more:
                        type: boolean
                        example: false
                  request_id:
                    type: string
                    example: "req_3f4a5b6c7d8e9f0a"
              example:
                data:
                  - summary_date: "2026-05-01"
                    psp_name: "paystack"
                    total_transactions: 512
                    total_volume_ngn: 84750000.00
                    total_matched: 505
                    matched_volume_ngn: 83750000.00
                    match_rate_pct: 98.6328
                    open_discrepancy_count: 7
                    resolved_discrepancy_count: 0
                    open_exposure_ngn: 1000000.00
                    avg_settlement_lag_minutes: 1438.50
                    sla_breach_count: 2
                    last_refreshed_at: "2026-05-01T10:00:08.000Z"
                meta:
                  page_size: 20
                  next_cursor: null
                  prev_cursor: null
                  total_count: 14
                  has_more: false
                request_id: "req_3f4a5b6c7d8e9f0a"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"
        "503":
          $ref: "#/components/responses/ServiceUnavailable"

  /v1/reconciliation/pairs:
    get:
      operationId: listReconciliationPairs
      summary: List reconciliation pairs
      description: |
        Returns paginated list of reconciliation pairs from the Gold layer.
        Each pair represents one matching engine decision — either a 
        successful match or a recorded discrepancy.

        ## Filtering
        Multiple filters can be combined. All filters are AND conditions.

        ## Required Scope
        `read`
      tags:
        - Reconciliation
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/StartDate"
        - $ref: "#/components/parameters/EndDate"
        - $ref: "#/components/parameters/PspNameFilter"
        - $ref: "#/components/parameters/PageSize"
        - $ref: "#/components/parameters/Cursor"
        - name: status
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/PairStatus"
          description: Filter by pair status.
        - name: match_strategy
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/MatchStrategy"
          description: Filter by matching strategy used.
        - name: min_confidence
          in: query
          required: false
          schema:
            type: number
            format: float
            minimum: 0.0
            maximum: 1.0
          description: |
            Return only pairs with confidence_score >= this value.
            Useful for isolating low-confidence pairs requiring review.
          example: 0.75
      responses:
        "200":
          description: Paginated list of reconciliation pairs.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/ReconciliationPair"
                  meta:
                    type: object
                    properties:
                      page_size:
                        type: integer
                      next_cursor:
                        type: string
                        nullable: true
                      prev_cursor:
                        type: string
                        nullable: true
                      total_count:
                        type: integer
                      has_more:
                        type: boolean
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/reconciliation/pairs/{pair_id}:
    get:
      operationId: getReconciliationPair
      summary: Get a single reconciliation pair
      description: |
        Returns the full detail of a single reconciliation pair,
        including both linked canonical transactions and full
        match evidence.

        ## Required Scope
        `read`
      tags:
        - Reconciliation
      security:
        - ApiKeyAuth: []
      parameters:
        - name: pair_id
          in: path
          required: true
          schema:
            $ref: "#/components/schemas/UUID"
          description: The reconciliation pair UUID.
      responses:
        "200":
          description: Reconciliation pair detail.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: "#/components/schemas/ReconciliationPair"
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  # ── Discrepancies ─────────────────────────────────────────────────────────
  /v1/discrepancies:
    get:
      operationId: listDiscrepancies
      summary: List discrepancies
      description: |
        Returns a paginated list of detected financial discrepancies.
        Sorted by `raised_at` descending by default — newest first.

        ## Default Behaviour
        Without filters, returns all `open` discrepancies.
        Use `status` filter to see resolved or all discrepancies.

        ## Exposure Ordering
        Set `order_by=exposure` to surface the highest-risk discrepancies 
        first. This is the recommended view for daily operational review.

        ## Required Scope
        `read`
      tags:
        - Discrepancies
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/StartDate"
        - $ref: "#/components/parameters/EndDate"
        - $ref: "#/components/parameters/PspNameFilter"
        - $ref: "#/components/parameters/PageSize"
        - $ref: "#/components/parameters/Cursor"
        - name: status
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/DiscrepancyStatus"
          description: |
            Filter by discrepancy status.
            Default: open
          example: "open"
        - name: classification
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/DiscrepancyClass"
          description: Filter by anomaly classification.
        - name: min_exposure_ngn
          in: query
          required: false
          schema:
            type: number
            format: double
            minimum: 0
          description: |
            Return only discrepancies with estimated_exposure_ngn >= this value.
            Useful for prioritising high-value gaps.
          example: 10000
        - name: order_by
          in: query
          required: false
          schema:
            type: string
            enum:
              - raised_at
              - exposure
              - confidence
            default: raised_at
          description: |
            Sort order for results.
            - `raised_at`: newest first (default).
            - `exposure`: highest estimated_exposure_ngn first.
            - `confidence`: highest confidence_score first.
      responses:
        "200":
          description: Paginated list of discrepancies.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/Discrepancy"
                  meta:
                    type: object
                    properties:
                      page_size:
                        type: integer
                      next_cursor:
                        type: string
                        nullable: true
                      prev_cursor:
                        type: string
                        nullable: true
                      total_count:
                        type: integer
                      has_more:
                        type: boolean
                      total_open_exposure_ngn:
                        type: number
                        format: double
                        description: |
                          Sum of estimated_exposure_ngn across ALL open
                          discrepancies matching the current filter —
                          not just the current page.
                        example: 4821500.00
                  request_id:
                    type: string
              example:
                data:
                  - id: "e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0"
                    transaction_id: "a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6"
                    classification: "missing_settlement"
                    confidence_score: 0.97
                    evidence:
                      expected_at: "2026-05-02T17:00:00Z"
                      hours_overdue: 26.5
                      psp_name: "paystack"
                      psp_transaction_ref: "T_abc123xyz"
                      polling_attempts: 3
                    estimated_exposure_ngn: 50000.00
                    status: "open"
                    raised_at: "2026-05-01T10:00:01.441Z"
                    has_alert_sent: true
                meta:
                  page_size: 20
                  next_cursor: null
                  total_count: 7
                  has_more: false
                  total_open_exposure_ngn: 847500.00
                request_id: "req_3f4a5b6c7d8e9f0a"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/discrepancies/{discrepancy_id}:
    get:
      operationId: getDiscrepancy
      summary: Get a single discrepancy
      description: |
        Returns full detail for a single discrepancy, including the
        canonical transaction, full evidence payload, and complete
        audit trail of all status changes.

        ## Required Scope
        `read`
      tags:
        - Discrepancies
      security:
        - ApiKeyAuth: []
      parameters:
        - name: discrepancy_id
          in: path
          required: true
          schema:
            $ref: "#/components/schemas/UUID"
      responses:
        "200":
          description: Discrepancy detail with audit trail.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    allOf:
                      - $ref: "#/components/schemas/Discrepancy"
                      - type: object
                        properties:
                          audit_trail:
                            type: array
                            description: |
                              Chronological list of all state changes for the
                              underlying canonical transaction.
                              Sourced from silver_transaction_audit_log.
                            items:
                              type: object
                              properties:
                                event_type:
                                  type: string
                                  example: "STATUS_CHANGED"
                                previous_state:
                                  type: object
                                  nullable: true
                                  example:
                                    settlement_status: "pending"
                                new_state:
                                  type: object
                                  example:
                                    settlement_status: "settled"
                                triggered_by:
                                  type: string
                                  example: "pipeline_run:a3f9b2c1"
                                occurred_at:
                                  type: string
                                  format: date-time
                                  example: "2026-05-02T10:23:01.441Z"
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/discrepancies/{discrepancy_id}/resolve:
    post:
      operationId: resolveDiscrepancy
      summary: Resolve a discrepancy
      description: |
        Mark a discrepancy as resolved or as a false positive.
        Records the resolution permanently in the audit trail.

        ## Constraints
        - Discrepancy must be in `open`, `under_review`, or `escalated` status.
        - `resolution_note` minimum 20 characters — enforced at API level.
        - Resolved discrepancies cannot be re-opened. Contact system admin
          if a resolved discrepancy needs to be reconsidered.
        - This action is irreversible. The resolution note and type are
          permanent audit records.

        ## Side Effects
        - Updates `gold_discrepancies.status`, `resolved_at`, `resolved_by`,
          `resolution_note`, `resolution_type`.
        - Writes an audit event to `silver_transaction_audit_log` with
          event_type `DISCREPANCY_RESOLVED`.
        - If the discrepancy is linked to a reconciliation pair, the pair's
          status is also updated to `resolved` or `false_positive`.
        - `gold_reconciliation_summary` materialized view is scheduled for
          refresh after resolution.

        ## Required Scope
        `write`
      tags:
        - Discrepancies
      security:
        - ApiKeyAuth: []
      parameters:
        - name: discrepancy_id
          in: path
          required: true
          schema:
            $ref: "#/components/schemas/UUID"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ResolveDiscrepancyRequest"
            examples:
              found_next_batch:
                summary: Settlement arrived in next batch
                value:
                  resolution_note: >
                    Settlement confirmed in Paystack batch run of 2026-05-02.
                    Reference FLW-TXN-99887 matched to T_abc123xyz via support
                    ticket #PSP-20260501-8847. Delay attributed to CBN NIBSS
                    maintenance window 2026-05-01 18:00–22:00 WAT.
                  resolution_type: "found_in_next_batch"
                  mark_as_false_positive: false
              false_positive:
                summary: Discrepancy was raised in error
                value:
                  resolution_note: >
                    Discrepancy raised due to FX rate snapshot missing for NGN/USD
                    pair between 09:00–09:30 WAT on 2026-05-01. Amount delta of
                    NGN 312 is entirely explained by 0.63% FX rate movement during
                    the gap window. Not a genuine financial discrepancy.
                  resolution_type: "false_positive_reclassified"
                  mark_as_false_positive: true
      responses:
        "200":
          description: Discrepancy resolved successfully.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: "#/components/schemas/Discrepancy"
                  request_id:
                    type: string
              example:
                data:
                  id: "e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0"
                  status: "resolved"
                  resolved_at: "2026-05-02T09:15:00.441Z"
                  resolved_by: "reck_A3f"
                  resolution_note: "Settlement confirmed in next batch..."
                  resolution_type: "found_in_next_batch"
                request_id: "req_3f4a5b6c7d8e9f0a"
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Discrepancy is already in a terminal state.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
              example:
                error: "discrepancy_already_resolved"
                message: >
                  Discrepancy 'e5f6a7b8-...' is already resolved.
                  Resolved discrepancies cannot be re-opened via the API.
                request_id: "req_abc123"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/discrepancies/{discrepancy_id}/escalate:
    post:
      operationId: escalateDiscrepancy
      summary: Escalate a discrepancy
      description: |
        Move a discrepancy to `escalated` status for senior review or
        PSP dispute initiation. Triggers an alert to the escalation channel
        configured in the system.

        ## Constraints
        - Discrepancy must be in `open` or `under_review` status.
        - An escalation note is required.

        ## Required Scope
        `write`
      tags:
        - Discrepancies
      security:
        - ApiKeyAuth: []
      parameters:
        - name: discrepancy_id
          in: path
          required: true
          schema:
            $ref: "#/components/schemas/UUID"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                escalation_note:
                  type: string
                  minLength: 20
                  maxLength: 2000
                  description: |
                    Reason for escalation. Sent with the escalation alert.
                  example: >
                    Discrepancy open for 48 hours with no PSP response to
                    support ticket #PSP-20260501-8847. Escalating to
                    dispute team.
              required:
                - escalation_note
      responses:
        "200":
          description: Discrepancy escalated.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: "#/components/schemas/Discrepancy"
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Discrepancy is not in an escalatable state.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  # ── Transactions ──────────────────────────────────────────────────────────
  /v1/transactions:
    get:
      operationId: listTransactions
      summary: List canonical transactions
      description: |
        Returns paginated canonical transactions from the Silver layer.
        All PII fields are masked in responses regardless of API key scope.

        ## Use Cases
        - Audit: find all transactions for a given date and PSP.
        - Debugging: trace a specific PSP reference through the system.
        - Reporting: enumerate pending transactions approaching SLA breach.

        ## Required Scope
        `read`
      tags:
        - Transactions
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/StartDate"
        - $ref: "#/components/parameters/EndDate"
        - $ref: "#/components/parameters/PspNameFilter"
        - $ref: "#/components/parameters/PageSize"
        - $ref: "#/components/parameters/Cursor"
        - name: settlement_status
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/SettlementStatus"
          description: Filter by settlement status.
        - name: sla_breached
          in: query
          required: false
          schema:
            type: boolean
          description: |
            When true, return only transactions where settlement_sla_breached
            is true. Useful for proactive SLA monitoring.
        - name: psp_transaction_ref
          in: query
          required: false
          schema:
            type: string
          description: |
            Filter to a specific PSP transaction reference.
            Must be combined with psp_name for unambiguous lookup
            (references are not globally unique across PSPs).
      responses:
        "200":
          description: Paginated canonical transactions.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/CanonicalTransaction"
                  meta:
                    type: object
                    properties:
                      page_size:
                        type: integer
                      next_cursor:
                        type: string
                        nullable: true
                      prev_cursor:
                        type: string
                        nullable: true
                      total_count:
                        type: integer
                      has_more:
                        type: boolean
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/transactions/{transaction_id}:
    get:
      operationId: getTransaction
      summary: Get a single canonical transaction
      description: |
        Returns full detail for a single canonical transaction,
        including its reconciliation pair (if matched) and
        any associated discrepancies.

        ## Required Scope
        `read`
      tags:
        - Transactions
      security:
        - ApiKeyAuth: []
      parameters:
        - name: transaction_id
          in: path
          required: true
          schema:
            $ref: "#/components/schemas/UUID"
      responses:
        "200":
          description: Canonical transaction with linked records.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    allOf:
                      - $ref: "#/components/schemas/CanonicalTransaction"
                      - type: object
                        properties:
                          reconciliation_pair:
                            allOf:
                              - $ref: "#/components/schemas/ReconciliationPair"
                            nullable: true
                            description: |
                              The reconciliation pair this transaction is part of.
                              Null if the matching engine has not yet processed
                              this transaction.
                          discrepancies:
                            type: array
                            items:
                              $ref: "#/components/schemas/Discrepancy"
                            description: |
                              All discrepancies associated with this transaction.
                              Empty array if no discrepancies exist.
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          $ref: "#/components/responses/NotFound"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  # ── Reports ───────────────────────────────────────────────────────────────
  /v1/reports/cbn-daily:
    get:
      operationId: listCbnDailyReturns
      summary: List CBN daily returns
      description: |
        Returns CBN-format daily transaction returns.
        One return per calendar day. Returns are generated by the
        `daily_report_flow` at 02:00 WAT for the previous day.

        ## Required Scope
        `read`
      tags:
        - Reports
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/StartDate"
        - $ref: "#/components/parameters/EndDate"
        - $ref: "#/components/parameters/PageSize"
        - $ref: "#/components/parameters/Cursor"
        - name: submission_status
          in: query
          required: false
          schema:
            $ref: "#/components/schemas/CbnSubmissionStatus"
          description: Filter by submission lifecycle status.
      responses:
        "200":
          description: CBN daily returns list.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      $ref: "#/components/schemas/CbnDailyReturn"
                  meta:
                    type: object
                    properties:
                      page_size:
                        type: integer
                      next_cursor:
                        type: string
                        nullable: true
                      prev_cursor:
                        type: string
                        nullable: true
                      total_count:
                        type: integer
                      has_more:
                        type: boolean
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/reports/cbn-daily/{report_date}:
    get:
      operationId: getCbnDailyReturn
      summary: Get CBN daily return for a specific date
      description: |
        Returns the full CBN daily return for a specific WAT calendar date,
        including the complete `report_payload` JSON ready for submission.

        ## Report Not Yet Generated
        Returns 404 with error code `report_not_yet_generated` when:
        - The date is today or in the future (report not yet generated).
        - The `daily_report_flow` has not yet run for this date.

        ## Required Scope
        `read`
      tags:
        - Reports
      security:
        - ApiKeyAuth: []
      parameters:
        - name: report_date
          in: path
          required: true
          schema:
            type: string
            format: date
          description: WAT calendar date of the report. Format YYYY-MM-DD.
          example: "2026-05-01"
      responses:
        "200":
          description: CBN daily return for the requested date.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: "#/components/schemas/CbnDailyReturn"
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "404":
          description: |
            No report exists for this date.
            Either the date is in the future, today, or the daily report
            flow has not yet run for this date.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
              example:
                error: "report_not_yet_generated"
                message: >
                  No CBN daily return exists for 2026-05-01. Reports are
                  generated at 02:00 WAT for the previous calendar day.
                  If this date is in the past, check pipeline health.
                request_id: "req_abc123"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  /v1/reports/cbn-daily/{report_date}/approve:
    post:
      operationId: approveCbnDailyReturn
      summary: Approve a CBN daily return for submission
      description: |
        Advance a draft CBN daily return to `approved` status.
        A return must be approved before it can be marked as submitted.

        This action records the approver's identity and timestamp permanently.
        It is intended for compliance officers with `admin` scope.

        ## Constraints
        - Return must be in `draft` status.
        - Once approved, status cannot revert to draft.

        ## Required Scope
        `admin`
      tags:
        - Reports
      security:
        - ApiKeyAuth: []
      parameters:
        - name: report_date
          in: path
          required: true
          schema:
            type: string
            format: date
          example: "2026-05-01"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                approver_name:
                  type: string
                  minLength: 2
                  maxLength: 200
                  description: |
                    Full name of the approving compliance officer.
                    Stored permanently in the audit trail.
                  example: "Aisha Mohammed"
                approval_note:
                  type: string
                  maxLength: 1000
                  description: Optional note accompanying the approval.
                  example: "Reviewed. All totals reconcile with PSP statements."
              required:
                - approver_name
      responses:
        "200":
          description: Return approved.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    $ref: "#/components/schemas/CbnDailyReturn"
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "403":
          $ref: "#/components/responses/Forbidden"
        "404":
          $ref: "#/components/responses/NotFound"
        "409":
          description: Return is not in draft status.
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Error"
              example:
                error: "conflict"
                message: >
                  CBN return for 2026-05-01 is already in 'approved' status.
                  Only draft returns can be approved.
                request_id: "req_abc123"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"

  # ── Exposure ─────────────────────────────────────────────────────────────
  /v1/exposure:
    get:
      operationId: getExposureSnapshot
      summary: Get current financial exposure snapshot
      description: |
        Returns the current open financial exposure across all PSPs and
        discrepancy classifications. Sourced from `gold_exposure_tracker`.

        This endpoint answers the question: "How much money is currently
        unaccounted for, and where?"

        ## Grouping
        Results are grouped by PSP and classification. Each row represents
        the total exposure for one (PSP, classification) combination.

        ## Required Scope
        `read`
      tags:
        - Exposure
      security:
        - ApiKeyAuth: []
      parameters:
        - $ref: "#/components/parameters/PspNameFilter"
        - name: snapshot_date
          in: query
          required: false
          schema:
            type: string
            format: date
          description: |
            Return exposure snapshot for a specific date.
            Default: today's most recent snapshot.
          example: "2026-05-01"
      responses:
        "200":
          description: Exposure snapshot.
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: array
                    items:
                      type: object
                      properties:
                        snapshot_date:
                          type: string
                          format: date
                          example: "2026-05-01"
                        psp_name:
                          $ref: "#/components/schemas/PspName"
                        classification:
                          $ref: "#/components/schemas/DiscrepancyClass"
                        open_discrepancy_count:
                          type: integer
                          minimum: 0
                          example: 3
                        total_exposure_ngn:
                          $ref: "#/components/schemas/AmountNGN"
                        oldest_open_discrepancy_at:
                          type: string
                          format: date-time
                          nullable: true
                          description: |
                            Timestamp of the oldest unresolved discrepancy
                            in this bucket. An old timestamp signals a stale
                            discrepancy that needs attention.
                          example: "2026-04-29T08:14:32.000Z"
                        computed_at:
                          type: string
                          format: date-time
                          example: "2026-05-01T10:00:05.000Z"
                  summary:
                    type: object
                    description: Aggregate totals across all rows in this response.
                    properties:
                      total_open_discrepancies:
                        type: integer
                        example: 12
                      total_exposure_ngn:
                        type: number
                        format: double
                        example: 847500.00
                      psp_count:
                        type: integer
                        example: 2
                  request_id:
                    type: string
        "401":
          $ref: "#/components/responses/Unauthorized"
        "422":
          $ref: "#/components/responses/ValidationError"
        "429":
          $ref: "#/components/responses/RateLimitExceeded"
        "500":
          $ref: "#/components/responses/InternalServerError"
```

---

## 9. Pydantic Request/Response Models

The OpenAPI spec is the contract. These are the FastAPI-native implementations that enforce it at runtime.

```python
# src/api/v1/schemas/reconciliation.py
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class ReconciliationSummaryFilters(BaseModel):
    """Query parameters for GET /v1/reconciliation/summary"""
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    psp_name: Optional[str] = None
    page_size: int = Field(default=20, ge=1, le=100)
    cursor: Optional[str] = None

    @model_validator(mode="after")
    def validate_date_range(self) -> "ReconciliationSummaryFilters":
        if self.start_date and self.end_date:
            if self.start_date > self.end_date:
                raise ValueError(
                    "start_date must be on or before end_date."
                )
            delta = (self.end_date - self.start_date).days
            if delta > 90:
                raise ValueError(
                    f"Date range cannot exceed 90 days. "
                    f"Requested range: {delta} days."
                )
        return self


class ReconciliationSummaryResponse(BaseModel):
    summary_date: date
    psp_name: str
    total_transactions: int
    total_volume_ngn: Decimal
    total_matched: int
    matched_volume_ngn: Decimal
    match_rate_pct: Decimal
    open_discrepancy_count: int
    resolved_discrepancy_count: int
    open_exposure_ngn: Decimal
    avg_settlement_lag_minutes: Optional[Decimal]
    sla_breach_count: int
    last_refreshed_at: datetime

    model_config = {"from_attributes": True}
```

```python
# src/api/v1/schemas/discrepancy.py
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class DiscrepancyStatusEnum(str, Enum):
    OPEN = "open"
    UNDER_REVIEW = "under_review"
    RESOLVED = "resolved"
    FALSE_POSITIVE = "false_positive"
    ESCALATED = "escalated"


class DiscrepancyClassEnum(str, Enum):
    MISSING_SETTLEMENT = "missing_settlement"
    AMOUNT_MISMATCH = "amount_mismatch"
    FX_VARIANCE = "fx_variance"
    DUPLICATE_CREDIT = "duplicate_credit"
    UNMATCHED_CREDIT = "unmatched_credit"
    LATE_SETTLEMENT = "late_settlement"


class ResolveDiscrepancyRequest(BaseModel):
    resolution_note: str = Field(
        min_length=20,
        max_length=2000,
        description="Mandatory explanation. Minimum 20 characters.",
    )
    resolution_type: str = Field(
        description="Machine-readable resolution category.",
    )
    mark_as_false_positive: bool = Field(
        default=False,
        description="Set True to classify as false positive instead of resolved.",
    )

    @field_validator("resolution_type")
    @classmethod
    def validate_resolution_type(cls, v: str) -> str:
        valid_types = {
            "found_in_next_batch",
            "psp_confirmed_failure",
            "manual_adjustment",
            "write_off",
            "false_positive_reclassified",
            "timing_delay_resolved",
        }
        if v not in valid_types:
            raise ValueError(
                f"Invalid resolution_type '{v}'. "
                f"Must be one of: {', '.join(sorted(valid_types))}"
            )
        return v

    @field_validator("resolution_note")
    @classmethod
    def validate_note_not_generic(cls, v: str) -> str:
        """
        Reject trivially short or generic notes that add no audit value.
        The minimum character check catches the worst cases.
        Additional heuristic: reject notes that are only common filler words.
        """
        generic_notes = {
            "resolved", "done", "fixed", "ok", "okay", "n/a",
            "see above", "as discussed", "confirmed",
        }
        if v.lower().strip() in generic_notes:
            raise ValueError(
                "Resolution note must be substantive. "
                "Generic notes like 'resolved' or 'confirmed' are not accepted."
            )
        return v.strip()


class EscalateDiscrepancyRequest(BaseModel):
    escalation_note: str = Field(
        min_length=20,
        max_length=2000,
        description="Reason for escalation. Sent with alert.",
    )


class DiscrepancyListFilters(BaseModel):
    """Query parameters for GET /v1/discrepancies"""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    psp_name: Optional[str] = None
    status: DiscrepancyStatusEnum = DiscrepancyStatusEnum.OPEN
    classification: Optional[DiscrepancyClassEnum] = None
    min_exposure_ngn: Optional[Decimal] = Field(default=None, ge=0)
    order_by: str = Field(
        default="raised_at",
        pattern="^(raised_at|exposure|confidence)$",
    )
    page_size: int = Field(default=20, ge=1, le=100)
    cursor: Optional[str] = None
```

```python
# src/api/v1/schemas/reports.py
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class CbnDailyReturnResponse(BaseModel):
    id: UUID
    return_date: date
    generated_at: datetime
    total_transaction_count: int
    total_credit_count: int
    total_debit_count: int
    total_credit_volume_ngn: Decimal
    total_debit_volume_ngn: Decimal
    cross_border_count: int
    cross_border_volume_ngn: Decimal
    suspicious_tx_count: int
    unreconciled_count: int
    unreconciled_exposure_ngn: Decimal
    matched_count: int
    match_rate_pct: Optional[Decimal]
    open_discrepancy_count: int
    submission_status: str
    approved_by: Optional[str]
    approved_at: Optional[datetime]
    submitted_at: Optional[datetime]
    cbn_acknowledgement_ref: Optional[str]

    model_config = {"from_attributes": True}


class ApproveCbnReturnRequest(BaseModel):
    approver_name: str = Field(
        min_length=2,
        max_length=200,
        description="Full name of approving compliance officer.",
    )
    approval_note: Optional[str] = Field(
        default=None,
        max_length=1000,
    )

    @field_validator("approver_name")
    @classmethod
    def validate_name_not_generic(cls, v: str) -> str:
        if v.strip().lower() in {"admin", "system", "auto", "test"}:
            raise ValueError(
                "approver_name must be a real person's name, "
                "not a generic identifier."
            )
        return v.strip()
```

---

## 10. Route Implementations — FastAPI

```python
# src/api/v1/routes/reconciliation.py
from datetime import date, datetime, timezone, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import require_scope, get_api_session
from src.api.v1.schemas.reconciliation import (
    ReconciliationSummaryFilters,
    ReconciliationSummaryResponse,
)
from src.api.pagination import build_cursor, decode_cursor, PaginatedResponse
from src.observability.metrics import MATCH_RATE_GAUGE
import structlog

router = APIRouter(prefix="/reconciliation", tags=["Reconciliation"])
log = structlog.get_logger(__name__)


@router.get("/summary")
async def get_reconciliation_summary(
    request: Request,
    start_date: Annotated[Optional[date], Query()] = None,
    end_date: Annotated[Optional[date], Query()] = None,
    psp_name: Annotated[Optional[str], Query()] = None,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[Optional[str], Query()] = None,
    session: AsyncSession = Depends(get_api_session),
    _: None = Depends(require_scope("read")),
) -> dict:
    """
    GET /v1/reconciliation/summary
    """
    # Apply default date range: last 7 days
    if not end_date:
        end_date = datetime.now(timezone.utc).date()
    if not start_date:
        start_date = end_date - timedelta(days=7)

    # Validate date range
    if start_date > end_date:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "start_date must be on or before end_date.",
                "details": [
                    {
                        "field": "start_date",
                        "code": "invalid_date_range",
                        "message": f"start_date {start_date} is after end_date {end_date}.",
                    }
                ],
                "request_id": getattr(request.state, "request_id", "unknown"),
            },
        )

    delta_days = (end_date - start_date).days
    if delta_days > 90:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_date_range",
                "message": f"Date range cannot exceed 90 days. Requested: {delta_days} days.",
                "request_id": getattr(request.state, "request_id", "unknown"),
            },
        )

    # Build cursor condition
    cursor_condition = ""
    cursor_params: dict = {}
    if cursor:
        try:
            cursor_data = decode_cursor(cursor)
            cursor_condition = (
                "AND (summary_date, psp_name) < (:cursor_date, :cursor_psp)"
            )
            cursor_params = {
                "cursor_date": cursor_data["summary_date"],
                "cursor_psp": cursor_data["psp_name"],
            }
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "cursor_invalid",
                    "message": "Pagination cursor is malformed or expired.",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

    psp_condition = "AND psp_name = :psp_name" if psp_name else ""

    query_params = {
        "start_date": start_date,
        "end_date": end_date,
        "limit": page_size + 1,  # Fetch one extra to detect has_more
        **cursor_params,
    }
    if psp_name:
        query_params["psp_name"] = psp_name

    result = await session.execute(
        text(f"""
            SELECT
                summary_date, psp_name, total_transactions, total_volume_ngn,
                total_matched, matched_volume_ngn, match_rate_pct,
                open_discrepancy_count, resolved_discrepancy_count,
                open_exposure_ngn, avg_settlement_lag_minutes,
                sla_breach_count, last_refreshed_at
            FROM gold_reconciliation_summary
            WHERE summary_date BETWEEN :start_date AND :end_date
              {psp_condition}
              {cursor_condition}
            ORDER BY summary_date DESC, psp_name ASC
            LIMIT :limit
        """),
        query_params,
    )
    rows = result.fetchall()
    has_more = len(rows) > page_size
    rows = rows[:page_size]

    # Update Prometheus gauges
    for row in rows:
        if row.match_rate_pct:
            MATCH_RATE_GAUGE.labels(psp_name=row.psp_name).set(
                float(row.match_rate_pct)
            )

    # Count total (without pagination for meta)
    count_result = await session.execute(
        text(f"""
            SELECT COUNT(*) FROM gold_reconciliation_summary
            WHERE summary_date BETWEEN :start_date AND :end_date
            {psp_condition}
        """),
        {k: v for k, v in query_params.items() if k not in ("limit",)},
    )
    total_count = count_result.scalar_one()

    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = build_cursor({
            "summary_date": str(last.summary_date),
            "psp_name": last.psp_name,
        })

    return {
        "data": [dict(row._mapping) for row in rows],
        "meta": {
            "page_size": page_size,
            "next_cursor": next_cursor,
            "prev_cursor": None,    # Backward pagination not supported in v1
            "total_count": total_count,
            "has_more": has_more,
        },
        "request_id": getattr(request.state, "request_id", "unknown"),
    }
```

```python
# src/api/v1/routes/discrepancies.py
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

from src.api.dependencies import require_scope, get_api_session
from src.api.v1.schemas.discrepancy import (
    ResolveDiscrepancyRequest,
    EscalateDiscrepancyRequest,
)
from src.storage.postgres import pipeline_session as write_session

router = APIRouter(prefix="/discrepancies", tags=["Discrepancies"])
log = structlog.get_logger(__name__)


@router.get("")
async def list_discrepancies(
    request: Request,
    status: str = "open",
    psp_name: Annotated[Optional[str], Query()] = None,
    classification: Annotated[Optional[str], Query()] = None,
    min_exposure_ngn: Annotated[Optional[float], Query(ge=0)] = None,
    order_by: Annotated[str, Query(pattern="^(raised_at|exposure|confidence)$")] = "raised_at",
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: Annotated[Optional[str], Query()] = None,
    session: AsyncSession = Depends(get_api_session),
    _: None = Depends(require_scope("read")),
) -> dict:
    order_map = {
        "raised_at": "d.raised_at DESC",
        "exposure": "d.estimated_exposure_ngn DESC",
        "confidence": "d.confidence_score DESC",
    }
    order_clause = order_map.get(order_by, "d.raised_at DESC")

    conditions = ["d.status = :status"]
    params: dict = {"status": status, "limit": page_size + 1}

    if psp_name:
        conditions.append("ct.psp_name = :psp_name")
        params["psp_name"] = psp_name
    if classification:
        conditions.append("d.classification = :classification")
        params["classification"] = classification
    if min_exposure_ngn is not None:
        conditions.append("d.estimated_exposure_ngn >= :min_exposure")
        params["min_exposure"] = min_exposure_ngn

    where_clause = " AND ".join(conditions)

    result = await session.execute(
        text(f"""
            SELECT
                d.id, d.reconciliation_pair_id, d.transaction_id,
                d.classification, d.confidence_score, d.evidence,
                d.estimated_exposure_ngn, d.status, d.raised_at,
                d.reviewed_at, d.resolved_at, d.resolved_by,
                d.resolution_note, d.resolution_type,
                d.has_alert_sent, d.escalated_at,
                ct.psp_name, ct.internal_ref, ct.amount_ngn,
                ct.initiated_at, ct.settlement_status
            FROM gold_discrepancies d
            JOIN silver_canonical_transactions ct ON d.transaction_id = ct.id
            WHERE {where_clause}
            ORDER BY {order_clause}
            LIMIT :limit
        """),
        params,
    )
    rows = result.fetchall()
    has_more = len(rows) > page_size
    rows = rows[:page_size]

    # Total open exposure across all matching discrepancies (not just this page)
    exposure_result = await session.execute(
        text(f"""
            SELECT COALESCE(SUM(d.estimated_exposure_ngn), 0)
            FROM gold_discrepancies d
            JOIN silver_canonical_transactions ct ON d.transaction_id = ct.id
            WHERE {where_clause.replace(':limit', '')}
        """),
        {k: v for k, v in params.items() if k != "limit"},
    )
    total_exposure = exposure_result.scalar_one()

    return {
        "data": [dict(row._mapping) for row in rows],
        "meta": {
            "page_size": page_size,
            "next_cursor": None,   # TODO: implement cursor for discrepancies
            "prev_cursor": None,
            "total_count": len(rows),
            "has_more": has_more,
            "total_open_exposure_ngn": float(total_exposure),
        },
        "request_id": getattr(request.state, "request_id", "unknown"),
    }


@router.post("/{discrepancy_id}/resolve")
async def resolve_discrepancy(
    request: Request,
    discrepancy_id: UUID = Path(...),
    body: ResolveDiscrepancyRequest = ...,
    _: None = Depends(require_scope("write")),
) -> dict:
    """
    POST /v1/discrepancies/{id}/resolve

    Uses the pipeline session (write role) for the resolution update.
    """
    async with write_session() as session:
        # Fetch and lock the discrepancy for update
        result = await session.execute(
            text("""
                SELECT id, status, transaction_id
                FROM gold_discrepancies
                WHERE id = :id
                FOR UPDATE
            """),
            {"id": discrepancy_id},
        )
        discrepancy = result.one_or_none()

        if not discrepancy:
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "not_found",
                    "message": f"Discrepancy '{discrepancy_id}' not found.",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

        terminal_statuses = {"resolved", "false_positive"}
        if discrepancy.status in terminal_statuses:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "discrepancy_already_resolved",
                    "message": (
                        f"Discrepancy '{discrepancy_id}' is already in "
                        f"'{discrepancy.status}' status. "
                        "Resolved discrepancies cannot be re-opened via the API."
                    ),
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

        new_status = (
            "false_positive" if body.mark_as_false_positive else "resolved"
        )
        resolved_by = getattr(request.state, "api_key", {}).get(
            "key_prefix", "api_user"
        )

        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)

        await session.execute(
            text("""
                UPDATE gold_discrepancies SET
                    status = :status,
                    resolved_at = :now,
                    resolved_by = :resolved_by,
                    resolution_note = :note,
                    resolution_type = :resolution_type,
                    updated_at = :now
                WHERE id = :id
            """),
            {
                "status": new_status,
                "now": now,
                "resolved_by": resolved_by,
                "note": body.resolution_note,
                "resolution_type": body.resolution_type,
                "id": discrepancy_id,
            },
        )

        # Write audit log entry
        await session.execute(
            text("""
                INSERT INTO silver_transaction_audit_log
                    (transaction_id, event_type, previous_state, new_state,
                     triggered_by, occurred_at)
                VALUES
                    (:tx_id, 'DISCREPANCY_RESOLVED',
                     :previous, :new_state,
                     :triggered_by, :now)
            """),
            {
                "tx_id": discrepancy.transaction_id,
                "previous": f'{{"status": "{discrepancy.status}"}}',
                "new_state": (
                    f'{{"status": "{new_status}", '
                    f'"resolution_type": "{body.resolution_type}"}}'
                ),
                "triggered_by": f"api_user:{resolved_by}",
                "now": now,
            },
        )

        # Fetch updated record for response
        updated = await session.execute(
            text("""
                SELECT d.*, ct.psp_name, ct.internal_ref, ct.amount_ngn,
                       ct.initiated_at, ct.settlement_status
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions ct ON d.transaction_id = ct.id
                WHERE d.id = :id
            """),
            {"id": discrepancy_id},
        )
        row = updated.one()

    log.info(
        "discrepancy.resolved",
        discrepancy_id=str(discrepancy_id),
        resolved_by=resolved_by,
        new_status=new_status,
        resolution_type=body.resolution_type,
    )

    return {
        "data": dict(row._mapping),
        "request_id": getattr(request.state, "request_id", "unknown"),
    }
```

```python
# src/api/dependencies.py
from typing import Callable
from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from src.storage.postgres import get_db_manager


async def get_api_session() -> AsyncSession:
    """Dependency: provides a read-oriented API session."""
    db = get_db_manager()
    async with db.api_session() as session:
        yield session


def require_scope(required_scope: str) -> Callable:
    """
    Dependency factory: verifies the authenticated API key has
    the required scope. Raises 403 if scope is insufficient.

    Scope hierarchy: admin > write > read
    Having a higher scope implicitly grants lower scopes.
    """
    scope_hierarchy = {"read": 0, "write": 1, "admin": 2}

    async def _check_scope(request: Request) -> None:
        api_key = getattr(request.state, "api_key", None)
        if not api_key:
            raise HTTPException(
                status_code=401,
                detail={
                    "error": "missing_api_key",
                    "message": "Authentication required.",
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

        key_scopes = api_key.get("scopes", [])
        required_level = scope_hierarchy.get(required_scope, 0)
        key_max_level = max(
            (scope_hierarchy.get(s, -1) for s in key_scopes),
            default=-1,
        )

        if key_max_level < required_level:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "insufficient_scope",
                    "message": (
                        f"This endpoint requires '{required_scope}' scope. "
                        f"Your key has: {', '.join(key_scopes) or 'none'}."
                    ),
                    "request_id": getattr(request.state, "request_id", "unknown"),
                    "documentation_url": (
                        "https://docs.reconciliation.internal/auth#scopes"
                    ),
                },
            )

    return _check_scope
```

---

## 11. Pagination Utilities

```python
# src/api/pagination.py
import base64
import json
from datetime import datetime, timezone
from typing import Any

CURSOR_EXPIRY_HOURS = 24


def build_cursor(payload: dict[str, Any]) -> str:
    """
    Encode a cursor from a dict of sort key values.
    Includes expiry timestamp for cursor validation.
    """
    payload["_expires_at"] = (
        datetime.now(timezone.utc).timestamp() + (CURSOR_EXPIRY_HOURS * 3600)
    )
    return base64.urlsafe_b64encode(
        json.dumps(payload, default=str).encode()
    ).decode()


def decode_cursor(cursor: str) -> dict[str, Any]:
    """
    Decode and validate a cursor string.
    Raises ValueError on malformed or expired cursor.
    """
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor.encode()))
    except Exception:
        raise ValueError("Cursor is malformed.")

    expires_at = payload.get("_expires_at")
    if expires_at and datetime.now(timezone.utc).timestamp() > expires_at:
        raise ValueError("Cursor has expired.")

    return {k: v for k, v in payload.items() if k != "_expires_at"}
```

---

## 12. Request ID Middleware

```python
# src/api/middleware/request_id.py
import uuid
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
import structlog


class RequestIDMiddleware(BaseHTTPMiddleware):
    """
    Injects a unique request ID into every request.

    Priority:
    1. Use X-Request-ID if provided by the client (useful for client tracing)
    2. Generate a new ID if not provided

    The request_id is:
    - Attached to request.state for downstream access
    - Bound to structlog context (appears in all log lines for this request)
    - Returned in the X-Request-ID response header
    - Included in all API response bodies as request_id field
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = (
            request.headers.get("X-Request-ID")
            or f"req_{uuid.uuid4().hex[:16]}"
        )
        request.state.request_id = request_id

        # Bind to structlog context — all logs within this request carry request_id
        structlog.contextvars.bind_contextvars(request_id=request_id)

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id

        # Clear context after request completes
        structlog.contextvars.clear_contextvars()

        return response
```

---

## 13. Rate Limiting Middleware

```python
# src/api/middleware/rate_limit.py
import time
from collections import defaultdict
from typing import DefaultDict

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding window rate limiter: N requests per minute per API key.

    Implementation: in-memory token bucket.
    For production at scale: replace with Redis-backed sliding window.
    The interface is identical — only the backing store changes.

    Exempt paths: /health, /metrics (system probes must not be rate-limited)
    """

    EXEMPT_PATHS = {"/health", "/metrics"}

    def __init__(self, app, requests_per_minute: int = 100) -> None:
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.window_seconds = 60
        # {api_key_prefix: [(timestamp, count)]}
        self._buckets: DefaultDict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)

        # Identify by API key prefix or IP fallback
        api_key = request.headers.get("X-API-Key", "")
        client_id = api_key[:8] if api_key else request.client.host

        now = time.time()
        window_start = now - self.window_seconds

        # Clean expired timestamps
        self._buckets[client_id] = [
            ts for ts in self._buckets[client_id]
            if ts > window_start
        ]

        request_count = len(self._buckets[client_id])
        remaining = max(0, self.requests_per_minute - request_count)
        reset_at = int(window_start + self.window_seconds)

        if request_count >= self.requests_per_minute:
            retry_after = int(self._buckets[client_id][0] + self.window_seconds - now)
            return JSONResponse(
                status_code=429,
                headers={
                    "X-RateLimit-Limit": str(self.requests_per_minute),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_at),
                    "Retry-After": str(max(1, retry_after)),
                },
                content={
                    "error": "rate_limit_exceeded",
                    "message": (
                        f"Rate limit of {self.requests_per_minute} requests/minute exceeded. "
                        f"Retry after {max(1, retry_after)} seconds."
                    ),
                    "request_id": getattr(request.state, "request_id", "unknown"),
                },
            )

        self._buckets[client_id].append(now)

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(remaining - 1)
        response.headers["X-RateLimit-Reset"] = str(reset_at)

        return response
```

---

## 14. API Contract Tests

```python
# tests/integration/test_api_reconciliation.py
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
class TestReconciliationSummaryEndpoint:

    async def test_requires_authentication(self, api_client: AsyncClient):
        response = await api_client.get("/v1/reconciliation/summary")
        assert response.status_code == 401
        body = response.json()
        assert body["error"] == "missing_api_key"
        assert "request_id" in body

    async def test_returns_correct_envelope_structure(
        self, api_client: AsyncClient, read_api_key: str
    ):
        response = await api_client.get(
            "/v1/reconciliation/summary",
            headers={"X-API-Key": read_api_key},
        )
        assert response.status_code == 200
        body = response.json()
        assert "data" in body
        assert "meta" in body
        assert "request_id" in body
        assert isinstance(body["data"], list)

    async def test_date_range_validation_rejects_inverted_range(
        self, api_client: AsyncClient, read_api_key: str
    ):
        response = await api_client.get(
            "/v1/reconciliation/summary",
            params={"start_date": "2026-05-31", "end_date": "2026-05-01"},
            headers={"X-API-Key": read_api_key},
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error"] == "validation_error"

    async def test_date_range_validation_rejects_range_over_90_days(
        self, api_client: AsyncClient, read_api_key: str
    ):
        response = await api_client.get(
            "/v1/reconciliation/summary",
            params={"start_date": "2025-01-01", "end_date": "2026-05-01"},
            headers={"X-API-Key": read_api_key},
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error"] == "invalid_date_range"

    async def test_request_id_in_response_header_and_body(
        self, api_client: AsyncClient, read_api_key: str
    ):
        response = await api_client.get(
            "/v1/reconciliation/summary",
            headers={
                "X-API-Key": read_api_key,
                "X-Request-ID": "custom-req-id-123",
            },
        )
        assert response.headers.get("X-Request-ID") == "custom-req-id-123"
        assert response.json()["request_id"] == "custom-req-id-123"

    async def test_rate_limit_headers_present(
        self, api_client: AsyncClient, read_api_key: str
    ):
        response = await api_client.get(
            "/v1/reconciliation/summary",
            headers={"X-API-Key": read_api_key},
        )
        assert "X-RateLimit-Limit" in response.headers
        assert "X-RateLimit-Remaining" in response.headers
        assert "X-RateLimit-Reset" in response.headers


@pytest.mark.asyncio
class TestDiscrepancyResolutionEndpoint:

    async def test_requires_write_scope(
        self, api_client: AsyncClient, read_only_api_key: str
    ):
        """Read-scope key cannot resolve discrepancies."""
        response = await api_client.post(
            "/v1/discrepancies/e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0/resolve",
            headers={"X-API-Key": read_only_api_key},
            json={
                "resolution_note": "This note is long enough to pass validation.",
                "resolution_type": "found_in_next_batch",
            },
        )
        assert response.status_code == 403
        assert response.json()["error"] == "insufficient_scope"

    async def test_resolution_note_minimum_length_enforced(
        self, api_client: AsyncClient, write_api_key: str
    ):
        response = await api_client.post(
            "/v1/discrepancies/e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0/resolve",
            headers={"X-API-Key": write_api_key},
            json={
                "resolution_note": "Too short.",
                "resolution_type": "found_in_next_batch",
            },
        )
        assert response.status_code == 422
        body = response.json()
        assert body["error"] == "validation_error"
        assert any(d["field"] == "resolution_note" for d in body["details"])

    async def test_generic_resolution_note_rejected(
        self, api_client: AsyncClient, write_api_key: str
    ):
        response = await api_client.post(
            "/v1/discrepancies/e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0/resolve",
            headers={"X-API-Key": write_api_key},
            json={
                "resolution_note": "resolved",
                "resolution_type": "found_in_next_batch",
            },
        )
        assert response.status_code == 422

    async def test_invalid_resolution_type_rejected(
        self, api_client: AsyncClient, write_api_key: str
    ):
        response = await api_client.post(
            "/v1/discrepancies/e5f6a7b8-c9d0-e1f2-a3b4-c5d6e7f8a9b0/resolve",
            headers={"X-API-Key": write_api_key},
            json={
                "resolution_note": "This is a valid resolution note with enough characters.",
                "resolution_type": "invalid_type_that_doesnt_exist",
            },
        )
        assert response.status_code == 422

    async def test_nonexistent_discrepancy_returns_404(
        self, api_client: AsyncClient, write_api_key: str
    ):
        response = await api_client.post(
            "/v1/discrepancies/00000000-0000-0000-0000-000000000000/resolve",
            headers={"X-API-Key": write_api_key},
            json={
                "resolution_note": "This is a valid resolution note with enough characters.",
                "resolution_type": "found_in_next_batch",
            },
        )
        assert response.status_code == 404
        assert response.json()["error"] == "not_found"
```

---

## 15. V1 Router Assembly

```python
# src/api/v1/router.py
from fastapi import APIRouter

from src.api.v1.routes.ingestion import router as ingestion_router
from src.api.v1.routes.reconciliation import router as reconciliation_router
from src.api.v1.routes.discrepancies import router as discrepancy_router
from src.api.v1.routes.transactions import router as transaction_router
from src.api.v1.routes.reports import router as reports_router
from src.api.v1.routes.exposure import router as exposure_router

v1_router = APIRouter()

v1_router.include_router(ingestion_router)
v1_router.include_router(reconciliation_router)
v1_router.include_router(discrepancy_router)
v1_router.include_router(transaction_router)
v1_router.include_router(reports_router)
v1_router.include_router(exposure_router)
```

---

## 16. Versioning and Deprecation Policy

```
Policy                          Detail
─────────────────────────────── ──────────────────────────────────────────────
Breaking change definition      Any change that requires a client to modify
                                code to continue operating correctly.

                                Breaking: removing a field, changing a field type,
                                changing an enum value, changing error codes,
                                changing HTTP status codes, removing an endpoint.

                                Non-breaking: adding an optional field, adding
                                a new endpoint, adding a new enum value,
                                adding a new optional query parameter.

Breaking change process         Breaking changes introduce a new version (/v2).
                                /v1 remains operational for minimum 6 months after
                                /v2 launch. Deprecation notices sent via:
                                - Sunset response header on all v1 endpoints
                                - Deprecation header with link to migration guide
                                - Direct notification to all registered API key holders

Non-breaking change process     Changes deployed to existing version without notice.
                                Clients must be built to tolerate unknown fields
                                in response bodies (forward compatibility).

Response field additions        All clients must ignore unknown fields.
                                This is not a breaking change and will not
                                be announced.

Sunset header format            Sunset: Sat, 01 Nov 2026 00:00:00 GMT
Deprecation header format       Deprecation: true
                                Link: <https://docs.../migration/v1-to-v2>; rel="deprecation"
```

---

## 17. What This Document Unlocks

The API Specification is complete. Every contract the system exposes is defined with sufficient precision that:

- A frontend engineer can build the Streamlit dashboard without asking a single clarifying question
- An external integrator can build against this API without access to source code
- A QA engineer can write test cases directly from this document
- A security auditor can verify every authentication and authorization decision

**The complete pre-engineering documentation set is now done:**

```
✅ PRD v1.0                    — What we build and why
✅ Data Architecture Blueprint — How data flows through the system
✅ ERD + Database Schema       — Exact shape of every entity
✅ Data Dictionary             — Precise meaning of every field
✅ TDD v1.0                    — How the system is engineered
✅ API Specification           — How the system is consumed
```

**What comes next is code.**

The implementation sequence from the TDD (§16) is the correct start order. Week 1 begins with migrations and Docker Compose. Everything in every document above was written so that first line of code lands on solid ground — no ambiguity, no rework, no design decisions made under implementation pressure.

The Data Governance & Security Policy and the QA & Testing Strategy are the remaining lightweight documents. Both can be written in parallel with early implementation since they formalise decisions already embedded in the TDD and API spec. They are not blockers to beginning the build.

Are you ready to begin implementation, or do you want to tackle either of the remaining documents first?
