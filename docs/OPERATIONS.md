# Operations Guide

> **Purpose**: Everything you need to understand, run, and demonstrate the MMR reconciliation engine.
> This is the operational companion to the technical specifications in `/docs`.

---

## Dashboard Pages

The executive dashboard (`http://localhost:3000`) has 7 screens. Each is designed for a specific audience and decision type.

### 1. Executive Overview (`/`)

**Audience**: Finance directors, CTOs, investors

**What you see**:

| Element | What It Means |
|---------|--------------|
| **Match Rate** | Percentage of transactions successfully matched across PSPs. Target: ≥99.5%. A drop signals webhook gaps or PSP settlement delays. |
| **Open Exposure** | Total ₦ value of unmatched or disputed transactions. This is *money at risk* — the finance team needs to investigate. |
| **Txns Today** | Total transactions processed across all connected PSPs in the current day. |
| **Pending Issues** | Count of open discrepancies requiring human review. |
| **Match Rate Trend** | 30-day area chart showing daily match rate. Look for sustained drops. |
| **Exposure by PSP** | Bar chart showing which PSP has the most unresolved exposure. Helps prioritize investigation. |
| **Recent Discrepancies** | Table of the most recent flagged issues, sorted by age. Clicking reveals details. |

---

### 2. Discrepancy Management (`/discrepancies`)

**Audience**: Reconciliation officers, finance teams

**What you see**:

| Element | What It Means |
|---------|--------------|
| **Severity Donut** | Visual breakdown of open issues by severity (critical → low). |
| **Filter Bar** | Filter by severity, status, or PSP to focus on what matters. |
| **Discrepancy Table** | Each row is a flagged transaction. Columns: type, PSP, amount, severity, age, status. |
| **Resolve Button** | Mark an issue as resolved with a resolution note. This updates the audit trail. |

**Discrepancy Types Explained**:

| Type | What Happened | Action Required |
|------|--------------|----------------|
| `missing_settlement` | PSP received payment but hasn't settled to your bank account | Contact PSP support with the transaction reference |
| `amount_mismatch` | Settlement amount differs from the original charge | Check for partial refunds, fees, or FX conversion errors |
| `fx_variance` | Exchange rate shifted between initiation and settlement | Review if variance exceeds your configured threshold (default: 0.5%) |
| `duplicate_credit` | Same transaction appears to have been credited twice | Verify with PSP — may need to return the duplicate |
| `late_settlement` | Settlement arrived but past the expected SLA window | Monitor for patterns — may indicate PSP degradation |

**Severity Levels**:

| Level | Threshold | SLA |
|-------|-----------|-----|
| 🔴 Critical | Exposure > ₦5M or age < 6 hours | Investigate within 1 hour |
| 🟠 High | Exposure > ₦1M or age < 48 hours | Investigate within 4 hours |
| 🔵 Medium | Exposure > ₦100K | Investigate within 24 hours |
| 🟢 Low | Below all thresholds | Review in next batch |

---

### 3. PSP Health (`/psp-health`)

**Audience**: Technical operations, DevOps

**What you see**:

| Element | What It Means |
|---------|--------------|
| **PSP Cards** | One card per connected PSP showing real-time status. |
| **Status Badge** | 🟢 Connected (webhooks arriving normally), 🟡 Degraded (elevated gap rate or latency), 🔴 Disconnected (no webhooks received recently). |
| **Webhook Gap Rate** | Percentage of expected webhooks that didn't arrive. > 1% triggers degraded status. |
| **Avg Settlement Hours** | Mean time from payment initiation to bank settlement. SLA varies by PSP. |
| **Settlement Timeline** | 24-hour area chart showing transaction volume per PSP. Reveals peak hours and outage windows. |

---

### 4. CBN Reports (`/reports`)

**Audience**: Compliance officers, regulatory teams

**What you see**:

| Element | What It Means |
|---------|--------------|
| **Calendar Grid** | Visual calendar showing report status per day. Green = submitted, yellow = reviewed, grey = generated, red = missing. |
| **Report Detail** | Click a day to see the full CBN daily return: transaction count, volume, match rate, cross-border count, suspicious flags. |
| **Download Buttons** | Export reports as CSV or JSON for submission to the Central Bank of Nigeria. |
| **Recent Reports Table** | List of recent reports with status and key metrics. |

**CBN Report Status Flow**: Generated → Reviewed → Submitted

---

### 5. Settings (`/settings`)

**Audience**: Administrators, DevOps

**4 tabs**:

| Tab | What It Does |
|-----|-------------|
| **PSP Connections** | View connected PSPs, webhook URLs, last verification time. |
| **API Keys** | Generate and manage API keys for programmatic access. Keys are SHA-256 hashed — cannot be recovered. |
| **Alert Configuration** | Set thresholds for Slack alerts: exposure limits, match rate minimums, settlement SLA windows. |
| **Team** | Manage team members and their roles. |

---

### 6. Onboarding Wizard (`/onboarding`)

**Audience**: New users, first-time setup

**4 steps**:
1. **Business Profile** — Organization name, industry, monthly volume, email
2. **Connect PSPs** — Enter API keys for Paystack, Flutterwave, M-Pesa. Keys are validated before connection.
3. **Import History** — Backfill 7/14/30 days of historical transactions from connected PSPs
4. **Ready** — Confirmation with summary stats and "Go to Dashboard" CTA

**"Skip to Demo"** — Jump directly to the dashboard with synthetic data if you just want to explore.

---

## Data Flow Architecture

```
How data gets from PSP to your dashboard:

1. PSP EVENT          Payment happens on Paystack/Flutterwave/M-Pesa
      │
2. WEBHOOK            PSP sends HMAC-signed webhook to our API
      │                (or: our polling client fetches via REST every 30min)
      │
3. INGESTION          FastAPI validates signature → publishes to Kafka topic
      │
4. BRONZE LAYER       Raw event stored as immutable Parquet in MinIO
      │
5. SILVER LAYER       Event normalised: PII masked, FX converted to NGN,
      │                stored in PostgreSQL (canonical_transactions table)
      │
6. GOLD LAYER         Matching engine runs: exact match → probabilistic match
      │                → discrepancies classified → CBN reports generated
      │
7. API                FastAPI serves matched pairs, discrepancies, exposure
      │                from PostgreSQL to the dashboard
      │
8. DASHBOARD          React hooks fetch from API → display in charts/tables
                       If API unreachable → falls back to demo-data.ts
```

---

## Demo Mode

### When does demo mode activate?

The dashboard **always works**, even without the backend. Here's the decision tree:

```
React hook (e.g. useKPISummary) runs:
  ├── Try: fetch("/v1/reconciliation/summary")
  │     ├── API responds 200 → use live data (green "Live" badge)
  │     └── API responds error or timeout → fall through ↓
  └── Catch: use demo-data.ts → show "Demo Mode" banner (amber)
```

### How to switch to live data

1. Start the full stack: `make up && make migrate`
2. Seed data: `make demo-data && make webhook-batch`
3. The dashboard hooks will automatically detect the live API and switch

### How demo data is generated

**Client-side** (`dashboard/lib/demo-data.ts`):
- Seeded pseudo-random generator (seed=42) for consistent values
- 30 days of daily summaries with realistic Nigerian fintech patterns
- 25 discrepancies with age-weighted severity
- 3 PSP health records (Paystack, Flutterwave, M-Pesa)
- 30 days of FX rate history (NGN/USD, NGN/GBP, NGN/KES)

**Server-side** (`scripts/generate_demo_data.py`):
- Generates ~3,000 events over 30 days as JSON files
- Distribution: 70% matched pairs, 10% unmatched, 5% FX variance, 3% late, 2% duplicate, 5% cross-border
- Output: `scripts/demo_data/day_YYYY-MM-DD.json`

---

## Scripts Reference

### `make demo` — Full Demo Setup
Starts all services, runs migrations, generates 7 days of data, fires 30 webhooks.
```bash
make demo
# Dashboard: http://localhost:3000
# API Docs:  http://localhost:8000/docs
# Prefect:   http://localhost:4200
```

### `make demo-investor` — Investor Demo
Like `make demo` but with 30 days of data, 100 webhooks, and Grafana monitoring.
```bash
make demo-investor
# Also includes:
# Grafana:    http://localhost:3001 (admin/admin)
# Prometheus: http://localhost:9090
```

### Webhook Simulator
```bash
# Single matched pair (Paystack + Flutterwave, same amount)
make webhook

# Batch of 20 mixed scenarios
make webhook-batch

# Unmatched transaction (creates a discrepancy)
make webhook-unmatched

# Duplicate event (tests idempotency)
make webhook-duplicate
```

### Data Generator
```bash
# 30 days of synthetic data
make demo-data

# Quick 7-day dataset
make demo-data-week
```

---

## Troubleshooting

### Dashboard shows "Demo Mode" when API is running

**Cause**: CORS not configured, or API is on a different port.

**Fix**: Check that `CORS_ORIGINS` in `.env` includes `http://localhost:3000` and restart the API.

### `npm install` fails with 404

**Cause**: A package in `package.json` doesn't exist.

**Fix**: Remove the invalid package from `dependencies` and retry.

### PostCSS function export error

**Cause**: `postcss.config.mjs` exports a function instead of a plain object.

**Fix**: Change `export default function()` to `export default {}`.

### Docker build fails on migrations stage

**Cause**: Missing `src/__init__.py` or `src/config.py` in the migrations COPY.

**Fix**: Ensure both files are listed in the Dockerfile migrations stage.

### Webhooks return 401

**Cause**: HMAC signature doesn't match.

**Fix**: Ensure `PAYSTACK_SECRET_KEY` in `.env` matches the key used to sign webhooks.

---

## Service Ports Reference

| Service | Port | URL | Purpose |
|---------|------|-----|---------|
| Dashboard | 3000 | http://localhost:3000 | Executive dashboard (Next.js) |
| API Gateway | 8000 | http://localhost:8000/docs | FastAPI + OpenAPI docs |
| Grafana | 3001 | http://localhost:3001 | Monitoring dashboards (admin/admin) |
| Prometheus | 9090 | http://localhost:9090 | Metrics collection |
| Prefect | 4200 | http://localhost:4200 | Pipeline orchestration UI |
| MinIO Console | 9001 | http://localhost:9001 | Object storage browser |
| Redpanda Console | 8080 | http://localhost:8080 | Kafka topic browser |
| PostgreSQL | 5432 | localhost:5432 | Direct DB access |
| Redpanda (Kafka) | 19092 | localhost:19092 | Kafka protocol access |

---

## Quick Reference: Make Commands

| Command | What It Does |
|---------|-------------|
| `make up` | Start all core services |
| `make down` | Stop everything |
| `make migrate` | Run database migrations |
| `make smoke` | Verify all services are healthy |
| `make demo` | Full demo: services + data + webhooks |
| `make demo-investor` | Investor demo: + Grafana + 30 days |
| `make test` | Run full test suite |
| `make test-all` | All tests + coverage report |
| `make lint` | Ruff lint check |
| `make format` | Ruff auto-format |
| `make security-check` | Run security scanner |
| `make dashboard` | Start dashboard dev server |
| `make dashboard-install` | Install dashboard dependencies |
| `make dashboard-build` | Production build |
| `make clean` | Remove containers + volumes + caches |
| `make help` | Show all available commands |
