# Operations guide

How to run, observe and troubleshoot the MMR engine locally. For how the system works and what it
guarantees, see [ARCHITECTURE.md](ARCHITECTURE.md).

## First run

```bash
cp .env.example .env     # replace every "replace-me"; PII_TOKENIZATION_KEY needs 32+ chars
make doctor              # checks Docker, .env, ports, Python
make up                  # builds images, runs migrations, starts everything, waits for health
make api-key NAME=dashboard SCOPE=write
#   → copy the printed key into DASHBOARD_API_KEY in .env, then:
docker compose up -d dashboard
```

Optional: `FX_PROVIDER_API_KEY` (only needed for non-NGN events) and `SLACK_WEBHOOK_URL` (alerts).
Without an FX key, FX capture is skipped and non-NGN events are dead-lettered rather than converted with
a guessed rate.

## Demo data

Everything the demo shows is synthetic.

| Command | Effect |
|---|---|
| `make demo-full` | Start the stack, generate 14 days of events (the matching lookback), replay them through the signed webhooks, wait for Silver to settle, run matching, and verify every layer holds data. Exits non-zero if a layer is empty. |
| `make demo` | The same with 7 days of data. |
| `make demo-reset` | Destroy all volumes, then `demo-full`. |
| `make webhook` / `webhook-batch` / `webhook-unmatched` / `webhook-duplicate` | Fire individual signed webhook scenarios. |
| `make matching` | Run the matching flow now (the scheduler runs it every 5 minutes anyway). |

The dashboard can also run with no backend: build it with `NEXT_PUBLIC_DEMO_MODE=true`. A banner that
cannot be dismissed then marks every page as demo data. Without that flag the dashboard shows only
real API data, or a real error.

## Dashboard

| Page | Shows | Backed by |
|---|---|---|
| Overview `/` | Today's KPIs, open exposure, the 30-day match-rate trend, exposure by PSP | `/summary`, `/trend`, `/psp-health`, `/exposure` |
| Discrepancies | Filterable list. The detail panel has the evidence, the audit trail, and a resolve / false-positive form that requires a note. | `/discrepancies`, `/discrepancies/{id}/events`, `/discrepancies/{id}/resolve` |
| PSP health | Events in the last 24 h, last event time, 7-day match rate and open exposure per PSP | `/psp-health`, `/exposure` |
| Daily return (experimental) | Generated daily summaries, with CSV download | `/v1/reports/daily` |
| System | Per-dependency readiness, including a degraded `503` body | `/health/ready` |

The browser never talks to the API directly. It calls `/api/mmr/*` on the dashboard server, which adds
`DASHBOARD_API_KEY` and forwards only an allow-list of routes. Anyone who can open the dashboard acts
with that key's scope, so give it `write` only if dashboard users may resolve discrepancies.

## Observability

| Signal | Where |
|---|---|
| Flow runs (matching, FX, gap detection, daily return) | Prefect UI, http://localhost:4200, and the `system_pipeline_runs` table |
| Metrics | `make up-monitoring`, then Grafana (http://localhost:3001, password from `GRAFANA_PASSWORD`) and Prometheus (:9090) |
| Alert rules | `infra/prometheus/alerts.yml`: signature failures, dead letters, process down, exposure, critical discrepancies, match rate, recovered gaps, stale FX, API latency |
| Slack | Critical discrepancies and those at or above `ALERT_EXPOSURE_THRESHOLD_NGN`. Each attempt is recorded in `system_alert_events`. |
| Raw events | Redpanda console (http://localhost:8080). Dead letters are on `dead.letter.queue`, with the original bytes base64-encoded and the error. |
| Layer counts | `make status` |

## Routine operations

- **Issue or rotate an API key:** `make api-key NAME=<client> SCOPE=read|write|admin`. Keys are stored
  hashed. To revoke, set `is_active = false` in `system_api_keys`.
- **Replay a dead letter:** fix the cause, decode `raw_value_b64`, and re-publish it to its
  `original_topic`. Idempotency makes replays safe.
- **Backfill a PSP:** `docker compose exec scheduler python -c "import asyncio; from src.flows.polling_backfill_flow import polling_backfill_flow as f; print(asyncio.run(f('paystack', 30)))"`.
- **Regenerate a daily return:** re-running `daily_return_flow(date)` replaces the row while its status is
  `draft`. Approved or submitted returns are never overwritten.
- **Roll back a migration:** `make migrate-down`. Every migration has a tested `downgrade()`.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| A service exits at boot with a validation error | A required secret is missing or empty, or `PII_TOKENIZATION_KEY` is under 32 chars | Fix `.env`; Settings fails fast by design |
| Every API call returns 401 | No key configured; `ENVIRONMENT` defaults to `production` | `make api-key`, set `DASHBOARD_API_KEY`; or for local-only work set `ENVIRONMENT=development` and `API_AUTH_DISABLED=true` |
| Dashboard says "Engine unreachable" | `MMR_API_URL` wrong, or the API is not healthy | `docker compose ps api`; `curl localhost:8000/health/ready` |
| System page shows `degraded` | One dependency is down; the body names which | `make logs-errors` |
| Webhooks return 401 | The signing secret differs from `.env` | Check `PAYSTACK_SECRET_KEY` / `FLUTTERWAVE_SECRET_HASH` |
| Webhooks return 503 | Redpanda or Postgres unavailable; nothing was recorded | Restore the dependency; PSPs retry automatically |
| Events pile up on `dead.letter.queue` | Malformed payloads, or non-NGN events without an FX key | Inspect the `error` field on the message |
| Non-NGN events dead-lettered | No FX snapshot within 2 h after the event | Set `FX_PROVIDER_API_KEY`, wait for a capture, replay |
| Windows console prints garbled characters | Console code page is not UTF-8 | `$env:PYTHONIOENCODING="utf-8"` |

## Ports (all bound to 127.0.0.1)

| Service | Port |
|---|---|
| Dashboard | 3000 |
| API | 8000 |
| Prefect UI | 4200 |
| Redpanda console | 8080 |
| MinIO API / console | 9000 / 9001 |
| PostgreSQL | 5432 |
| Redpanda (Kafka, external listener) | 19092 |
| Grafana / Prometheus (monitoring overlay) | 3001 / 9090 |

Run `make help` for every target.
