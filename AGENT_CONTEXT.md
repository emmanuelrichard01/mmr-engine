# Agent context — mmr-engine

Read this before changing anything in this repository.

## Status

**Frozen reference implementation (v1.0.0).** No new features. Changes are limited to correctness and
security fixes, and to keeping documentation true. New product work happens in a separate repository
(see "What I'd do next" in README.md).

## Sources of truth, in order

1. The code and its tests.
2. `README.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, `docs/adr/`.
3. `docs/archive/`: pre-build design specs. Not authoritative; many described parts were never built.

## Rules that keep it honest

- Every claim in README.md must be verifiable from the repo. If you change behaviour, update the
  numbers and limitations there.
- Money is `Decimal` / `NUMERIC`, never float. API responses carry money as decimal strings.
- Never default an unknown PSP event into a money movement (see `classify_event`).
- Webhook intake: the idempotency key and the broker ack commit together. Do not reorder.
- Consumer: commit an offset only after the message is processed or durably dead-lettered.
- One match per transaction is enforced by `gold_matched_transactions`. Never bypass it.
- `gold_discrepancy_events` and `silver_transaction_audit_log` are append-only (enforced by trigger).
- Masked values are for display; matching uses keyed tokens (ADR 0001).
- `ENVIRONMENT` defaults to `production`; do not add fail-open defaults.

## Before committing

```bash
make check     # ruff, format check, mypy --strict, security scan, tests (incl. real Postgres)
cd dashboard && npm run lint && npx tsc --noEmit && npm run build
```
