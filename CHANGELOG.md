# Changelog

## v1.0.0 — frozen reference implementation

This release turns the engine into an honest, verifiable reference implementation and freezes it.
Every claim in the README is now backed by code and tests.

### Correctness
- Webhook intake no longer loses events: the idempotency key and the broker acknowledgement commit
  together. Previously, a failed Kafka publish made every PSP retry look like a duplicate.
- The consumer commits offsets per message, and only after processing or a successful dead-letter
  publish. Previously, one commit acknowledged a whole polled batch.
- Matching results are keyed by transaction id. Previously, list-position pairing wrote discrepancies
  against the wrong transactions.
- The "oldest 500 unmatched" starvation is fixed. Candidates now come from a lookback window.
- One-to-one matching is enforced by the database (`gold_matched_transactions`), including under
  concurrent runs.
- Unknown PSP events are no longer guessed into credits, and failed Flutterwave charges no longer
  become settled credits.
- Names are matched on keyed HMAC tokens, not on masked strings that collide
  ([ADR 0001](docs/adr/0001-pii-tokenization.md)).
- FX variance is assigned only when the rate movement actually explains the amount gap.
- The ambiguity guard leaves ties unmatched for review instead of picking the first candidate.

### Security
- Fail-closed configuration: `ENVIRONMENT` defaults to `production`, empty secrets are rejected, and
  auth can be disabled only in development.
- API-key authentication works. It previously queried non-existent columns.
- The unsigned public M-Pesa webhook and the public in-memory "onboarding" routes are removed.
- Least-privilege grants are restored. The blanket default privileges are gone, and passwords come from
  the environment.
- `gold_discrepancy_events` (new) and the transaction audit log are append-only, enforced by trigger.
- The dashboard calls the API through a server-side proxy. The API key is never sent to the browser,
  and cross-origin writes are rejected.

### Operations
- A scheduler runs matching, FX capture, gap detection and the daily return; previously nothing ran
  on a schedule.
- Every exported metric is recorded, and every alert rule and Grafana panel references a real metric.
- Slack alerting is wired in, with each delivery attempt recorded.
- The Docker build works from a fresh clone, runs as a non-root image, and runs migrations
  automatically.
- CI runs ruff, strict mypy, the security scanner, pip-audit, real-Postgres tests, and the dashboard
  lint/type/build.

### Dashboard
- Redesigned as an operations console:
  - an inbox for keyboard-first triage, with bulk resolve;
  - a transaction explorer that traces each transaction's lineage;
  - a pair inspector showing per-signal confidence;
  - pipeline activity, exposure by age, and a command palette.
- Design system: `dashboard/DESIGN.md`. 51 unit tests and 52 Playwright + axe end-to-end tests.
- New read endpoints back it: transactions, pair detail, exposure aging, bulk resolve, pipeline runs
  and search.
- Shows only real data or a real error state. Demo data appears only behind an explicit build flag,
  with a banner that can't be dismissed.
- Money is formatted from integer kobo with exact decimal strings; there is no float arithmetic.
- Accessibility: keyboard-operable tables, a proper dialog, labelled controls, and AA contrast in
  both themes.

### Documentation
- New README, ARCHITECTURE and OPERATIONS docs, plus ADR 0001. The pre-build specs are archived as
  non-authoritative.

### Numbers
276 tests (23 against real PostgreSQL), `mypy --strict` clean, 16 reversible migrations, 15 tables +
1 materialized view.
