# PRODUCT REQUIREMENTS DOCUMENT

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0 — Pre-Engineering Draft
**Author:** Emmanuel Richard
**Status:** Active — Foundation Document
**Last Updated:** May 2026

---

## 1. Problem Statement

### 1.1 The Core Problem

Every Nigerian business that operates across multiple payment service providers — and in 2026, that is most serious businesses — has a reconciliation gap. Money moves through Paystack, Flutterwave, Moniepoint, and M-Pesa simultaneously. Settlement is asynchronous. Reference IDs are not shared across providers. FX rates shift between transaction initiation and settlement. Webhooks arrive out of order, duplicate, or not at all.

The result: businesses cannot, at any given moment, answer the most fundamental financial question — **"Did all the money that should have arrived, actually arrive, in the correct amount?"**

The current solution is manual: spreadsheets, phone calls to PSP support lines, and a finance team that spends 30–40% of its time on reconciliation instead of financial analysis. The error rate is non-trivial — industry estimates for manual B2B reconciliation error rates range from 3–8% of transaction volume. At scale, this is millions of naira in undetected discrepancies monthly.

### 1.2 The Nigerian-Specific Dimensions

This problem has characteristics specific to the Nigerian and West African operating environment that generic reconciliation tools do not address:

**FX Volatility and Rate Timing:** The Naira's exchange rate against USD, GBP, and other currencies can move significantly within a single settlement window. A transaction initiated at NGN 1,580/USD that settles 4 hours later at NGN 1,610/USD has a legitimate FX discrepancy that is not a reconciliation failure. The system must distinguish FX timing variances from genuine settlement failures.

**Multi-PSP Settlement Lag Variance:** Paystack settles to Nigerian banks on T+1 business days. Flutterwave settlement windows vary by account tier and transaction type. M-Pesa cross-border settlements operate on different cycles. A reconciliation engine that applies a single expected settlement window will produce false positives continuously.

**Webhook Unreliability:** Nigerian internet infrastructure means PSP webhooks are delivered unreliably. The same payment event can arrive zero times, once, or multiple times. The engine must be idempotent and must have a fallback polling mechanism for missed webhook events.

**CBN Regulatory Reporting:** The Central Bank of Nigeria requires licensed fintechs to produce specific returns — daily transaction reports, suspicious transaction reports, cross-border transfer declarations. A reconciliation engine operating in this market must produce CBN-compliant output, not just internal analytics.

**NDPR Compliance:** The Nigeria Data Protection Regulation applies to all personal financial data processed in Nigeria. The system must handle PII (account numbers, BVN references, names) with appropriate controls.

### 1.3 What the Market Has Now

| Current Solution | Limitation |
| --- | --- |
| Manual spreadsheet reconciliation | Error-prone, 30–40% of finance team time, no audit trail |
| PSP-native dashboards | Single-provider only, no cross-PSP view, no automated matching |
| Enterprise ERP reconciliation modules | Priced for Fortune 500, not built for Nigerian PSP APIs, require 6-month implementations |
| Generic accounting software (QuickBooks, Sage) | No real-time PSP integration, no Nigerian-specific FX handling, no CBN reporting |

**The gap:** No tool exists that is built specifically for the multi-PSP Nigerian operating environment, handles FX timing correctly, is priced for African businesses, and produces CBN-compliant output automatically.

---

## 2. Goals and Success Metrics

### 2.1 Engineering Goals

| Goal | Metric | Target |
| --- | --- | --- |
| Reconciliation completeness | % of transactions matched across PSPs | ≥ 99.5% |
| False positive rate | % of flagged discrepancies that are not real | < 0.5% |
| Processing latency | Time from webhook receipt to reconciliation decision | < 10 seconds |
| System availability | Uptime during Nigerian business hours (WAT 08:00–22:00) | ≥ 99.9% |
| Idempotency | Duplicate webhook events that result in duplicate records | 0 |
| FX accuracy | Rate applied within correct settlement window | 100% |
| CBN report generation | Time to generate compliant daily return | < 60 seconds |

### 2.2 Portfolio Goals

This project must demonstrate the following to technical reviewers:

- Stream engineering: real event processing, not batch simulation
- Exactly-once semantics: a solved hard problem, not acknowledged and ignored
- Domain depth: FX timing, PSP settlement models, CBN compliance — not generic pipeline work
- Production-grade reliability: failure modes identified, handled, and tested
- African market specificity: decisions that only make sense if you understand this market

---

## 3. Scope Definition

### 3.1 In Scope — MVP (Phase 1)

- Webhook ingestion from Paystack and Flutterwave (test environments)
- Idempotent event processing with exactly-once guarantees
- Cross-PSP transaction matching engine with configurable matching rules
- FX rate integration with point-in-time rate lookup
- Bronze → Silver → Gold Medallion pipeline
- Discrepancy detection and classification
- REST API for reconciliation report queries
- Basic dashboard for reconciliation status
- Structured logging and pipeline observability
- NDPR-compliant PII handling (masking, access controls)

### 3.2 In Scope — Phase 2

- M-Pesa Daraja API integration
- Moniepoint webhook integration
- CBN daily return report generation (machine-readable format)
- Slack and email alerting for unresolved discrepancies
- Multi-tenant architecture (one engine, multiple business clients)
- Automated settlement prediction (expected arrival time per PSP)

### 3.3 Out of Scope (Explicit)

- Direct bank account integration (requires CBN license)
- Payment initiation (this is a reconciliation tool, not a payment gateway)
- Consumer-facing features
- Loan or credit products
- Integration with NIBSS directly (requires institutional agreement)
- Full BVN verification (requires CBN-licensed partner)

---

## 4. User Personas

### Persona 1: The Operations Finance Lead

**Name:** Chioma, Finance Operations Manager at a Lagos-based e-commerce company
**Context:** Manages reconciliation across Paystack (primary) and Flutterwave (backup) for NGN 200M+ monthly GMV. Currently spends Tuesday and Thursday mornings manually matching settlement reports against internal order records.
**Pain:** Three unresolved discrepancies from last month are still open. Total exposure: NGN 847,000. She doesn't know if the money is lost, in transit, or miscategorised.
**Goal:** Know within 2 hours of each business day whether all expected settlements arrived correctly. Stop being the human reconciliation engine.

### Persona 2: The Platform Engineering Lead

**Name:** Tunde, CTO at a Nigerian B2B SaaS fintech
**Context:** His company's product processes payments on behalf of their SME clients, using multiple PSPs for redundancy. His team needs programmatic access to reconciliation state for automated payout triggering.
**Pain:** They have a fragile internal script that pulls PSP reports and does naive matching. It breaks every time Flutterwave changes their export format, which happens without notice.
**Goal:** A stable, versioned API for reconciliation state that his engineering team can depend on. Webhook-first, not report-polling-dependent.

### Persona 3: The Compliance Officer

**Name:** Aisha, Head of Compliance at a licensed microfinance bank
**Context:** Required to submit daily transaction reports to CBN. Currently produces these manually from PSP dashboards. Audit trail is weak.
**Goal:** Automated CBN-compliant report generation with full audit trail. Reduce regulatory risk.

---

## 5. Functional Requirements

### 5.1 Ingestion Layer

**FR-001:** The system SHALL accept webhook events from Paystack (charge.success, transfer.success, transfer.failed) via a dedicated HTTP endpoint.

**FR-002:** The system SHALL accept webhook events from Flutterwave (charge.completed, transfer.completed) via a dedicated HTTP endpoint.

**FR-003:** Each webhook endpoint SHALL validate the PSP-specific HMAC signature before processing. Events with invalid signatures SHALL be rejected with HTTP 401 and logged.

**FR-004:** The system SHALL be idempotent — processing the same webhook event twice SHALL NOT produce duplicate records. Idempotency SHALL be enforced using a composite key of (psp_name, psp_transaction_reference, event_type).

**FR-005:** The system SHALL implement a fallback polling mechanism that queries PSP transaction APIs every 15 minutes to capture events for which webhooks were not received within a configurable timeout window.

**FR-006:** The system SHALL persist raw webhook payloads to the Bronze layer before any processing. No transformation SHALL occur before persistence.

### 5.2 Matching Engine

**FR-007:** The matching engine SHALL attempt to match transactions across PSPs using a deterministic primary matching strategy: exact match on (amount, beneficiary_account, initiation_timestamp_window_±5min).

**FR-008:** For transactions that fail primary matching, the engine SHALL apply a probabilistic secondary strategy using a configurable similarity threshold on (amount_within_1%, beneficiary_name_fuzzy_match, timestamp_window_±30min).

**FR-009:** Each match result SHALL carry a confidence score (0.0–1.0) and a match_strategy field indicating which strategy produced the match.

**FR-010:** Transactions unmatched after both strategies SHALL be classified as DISCREPANCY and routed to the discrepancy table with a classification: MISSING_SETTLEMENT, AMOUNT_MISMATCH, FX_VARIANCE, DUPLICATE_CREDIT.

**FR-011:** FX_VARIANCE discrepancies SHALL only be raised if the variance exceeds a configurable threshold (default: 0.5% of transaction value) to filter out legitimate rate timing differences.

### 5.3 FX Rate Engine

**FR-012:** The system SHALL capture FX rates at ingestion time for all supported currency pairs (NGN/USD, NGN/GBP, NGN/EUR, NGN/KES) from a configurable rate source.

**FR-013:** Rate lookups for historical transactions SHALL use the rate captured at the closest available timestamp to the transaction settlement time, not the current rate.

**FR-014:** All FX rates used in reconciliation calculations SHALL be stored with their source, timestamp, and bid/ask spread for full auditability.

### 5.4 Reporting API

**FR-015:** The API SHALL expose a GET /v1/reconciliation/summary endpoint returning aggregated reconciliation status for a given date range and PSP filter.

**FR-016:** The API SHALL expose a GET /v1/discrepancies endpoint returning all unresolved discrepancies with classification, confidence, and estimated NGN exposure.

**FR-017:** The API SHALL expose a POST /v1/discrepancies/{id}/resolve endpoint for marking discrepancies as resolved with a required resolution_note field.

**FR-018:** The API SHALL expose a GET /v1/reports/cbn-daily endpoint generating a CBN-format daily transaction return for a specified date.

**FR-019:** All API endpoints SHALL require authentication via API key passed in the X-API-Key header.

---

## 6. Non-Functional Requirements

### 6.1 Performance

**NFR-001:** Webhook processing (receipt to Bronze persistence) SHALL complete in < 500ms at P99.

**NFR-002:** Full reconciliation pipeline (Bronze to Gold) SHALL complete in < 10 seconds for a single transaction event.

**NFR-003:** The API SHALL return responses in < 200ms at P95 for all read endpoints under normal load (< 100 concurrent requests).

**NFR-004:** The system SHALL handle a burst of 500 webhook events per minute without degradation.

### 6.2 Reliability

**NFR-005:** The pipeline SHALL guarantee at-least-once processing for all ingested events. Combined with idempotency (FR-004), this achieves exactly-once semantics.

**NFR-006:** A pipeline failure at any stage SHALL NOT result in data loss. Events in the Bronze layer SHALL be reprocessable at any time.

**NFR-007:** The system SHALL maintain a complete audit log of all state transitions for every transaction record, including who or what triggered each transition.

### 6.3 Security

**NFR-008:** All data in transit SHALL use TLS 1.3 minimum.

**NFR-009:** PII fields (account numbers, names, BVN references) SHALL be masked in all log output.

**NFR-010:** Database credentials, API keys, and PSP secrets SHALL be managed via environment variables or a secrets manager. No secrets in source code or version control.

**NFR-011:** The system SHALL implement rate limiting on all public endpoints: 100 requests per minute per API key.

### 6.4 NDPR Compliance

**NFR-012:** Personal financial data SHALL be retained for a maximum of 7 years in line with CBN record-keeping requirements, after which it SHALL be deleted or anonymised.

**NFR-013:** The system SHALL maintain a data processing register documenting what personal data is collected, why, and how it is protected.

**NFR-014:** The system SHALL support data subject access requests — the ability to extract all records associated with a given individual identifier within 72 hours.

---

## 7. Technical Constraints and Assumptions

**TC-001:** The system will use Paystack and Flutterwave test environments for MVP. Production PSP integration requires live API credentials and business registration.

**TC-002:** FX rate source for MVP will be ExchangeRate-API or a similar free-tier service. Production will require a licensed financial data provider.

**TC-003:** The system must run on a single server (4 vCPU, 8GB RAM) for portfolio deployment. Architecture must be horizontally scalable in design even if not deployed that way initially.

**TC-004:** CBN report format will be modelled on publicly available CBN return templates. Exact schema may require adjustment for live compliance use.

**TC-005:** M-Pesa integration requires a registered Safaricom developer account. Daraja sandbox is available for testing cross-border scenarios.

---

## 8. MVP Delivery Definition

The MVP is complete when the following are demonstrable end-to-end in a live environment:

1. A Paystack test webhook fires → event appears in Bronze layer within 500ms
2. A matching Flutterwave event fires → matching engine produces a MATCHED result with confidence score
3. A deliberately mismatched event fires → engine produces DISCREPANCY with correct classification
4. An FX rate variance below threshold → engine does NOT raise a false positive discrepancy
5. The reconciliation summary API returns correct aggregated state
6. The CBN daily report endpoint produces a correctly formatted output
7. A duplicate webhook → zero duplicate records in Silver or Gold
8. All PII fields are masked in log output

---

## 9. Open Questions (To Be Resolved in TDD Phase)

| # | Question | Impact | Owner |
| --- | --- | --- | --- |
| OQ-001 | Kafka vs. Redis Streams vs. Postgres-backed queue for event ingestion? | Architecture, cost, complexity | TDD |
| OQ-002 | DuckDB vs. Postgres for Silver/Gold layers given concurrent write requirements? | Data integrity, performance | TDD |
| OQ-003 | Which FX rate provider has the best NGN pair coverage at acceptable cost? | FX accuracy | Research |
| OQ-004 | Exact CBN daily return format — which template applies to this use case? | Compliance | Research |
| OQ-005 | How to handle M-Pesa's B2C vs. C2B transaction type differences in the canonical schema? | Data model | TDD |
| OQ-006 | Prefect vs. Dagster for orchestration — which has better Docker Compose story? | DevEx | TDD |

---

## What Comes Next

That PRD is your anchor document. Every subsequent document derives from it. Here's what we build next, in sequence:

**Next: Data Architecture Blueprint** — The Medallion design specific to this domain. This is where we define the exact Bronze schema for Paystack and Flutterwave raw events, the Silver canonical ledger schema, the Gold reconciliation and discrepancy tables, and the data flow between them. This document is where the matching engine logic, the FX rate snapshot design, and the idempotency mechanism get their first precise technical definition.

**Then: ERD + Data Dictionary** — Exact table definitions, field names, types, constraints, and business meaning for every entity in the system.

**Then: TDD** — Full technical design, stack decisions resolved, component interaction diagrams, failure mode analysis.

**Then: API Specification** — OpenAPI 3.1 spec, exact endpoint definitions, request/response schemas, error codes.

**Then: Data Governance & Security Policy** — NDPR compliance framework, RBAC design, encryption standards, audit log specification.

We can work through each one properly. Which do you want to tackle next — the Data Architecture Blueprint, or do you want to make any adjustments to the PRD first?
