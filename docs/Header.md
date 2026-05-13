# Project Documentation — Reading Order

> **Purpose:** Master index for all specification documents.  
> Each document informs the next. Building them out of sequence means rework.  
> Read and analyse each document carefully for implementation guidelines.

---

## Foundation Documents

| # | Document | Purpose |
|---|----------|---------|
| 1 | [PRD.md](PRD.md) | What are we building and for whom? |
| 2 | [DATA ARCHITECTURE.md](DATA%20ARCHITECTURE.md) | How does data flow through the system? |
| 3 | [ERD.md](ERD.md) | What is the exact shape of every entity? |
| 4 | [DATA DICTIONARY.md](DATA%20DICTIONARY.md) | What does every field mean, precisely? |
| 5 | [TDD.md](TDD.md) | How is the entire system engineered? |
| 6 | [API SPECIFICATION.md](API%20SPECIFICATION.md) | What are the exact contracts between services? |

## Governance & Quality Documents

| # | Document | Purpose |
|---|----------|---------|
| 7 | [DATA GOVERNANCE & SECURITY.md](DATA%20GOVERNANCE%20%26%20SECURITY.md) | How is sensitive financial data protected? |
| 8 | [QUALITY ASSURANCE.md](QUALITY%20ASSURANCE.md) | What does "correct" mean, and how do we verify it? |

## Strategy & Positioning Documents

| # | Document | Purpose |
|---|----------|---------|
| 9 | [RELEVANCE AND THREAT ASSESSMENT.md](RELEVANCE%20AND%20THREAT%20ASSESSMENT.md) | Competitive landscape + differentiation |
| 10 | [GTM_STRATEGY.md](GTM_STRATEGY.md) | Data acquisition + go-to-market positioning |

---

## Implementation Status

| Week | Milestone | Status |
|------|-----------|--------|
| 1 | Infrastructure — Docker, Migrations, Observability | ✅ Complete |
| 2 | Engine Core — Idempotency, PII, FX, Normalisers | ✅ Complete |
| 3 | Pipeline — Prefect Flows, Pandera Contracts, Kafka Consumer | ✅ Complete |
| 4 | Gold Layer — Matching Engine, Discrepancy Classifier | ✅ Complete |
| 5 | API + Alerting — Routes, Auth, Rate Limiting, Slack | 🔄 In Progress |
| 6 | Integration + Polish — E2E Tests, CBN Reports, Performance | ⬜ Planned |
