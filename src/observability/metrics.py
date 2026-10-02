# src/observability/metrics.py
"""
Prometheus metrics for the Reconciliation Engine.

Every metric defined here is recorded somewhere; an unused metric is a dashboard
panel or alert rule that can never fire. Naming: reconciliation_{subsystem}_
{name}_{unit}. Labels are bounded enums (PSP, strategy, classification),
never ids, to keep cardinality fixed.

Three processes expose metrics:
    api              :8000/metrics  (HTTP, webhook, auth + DB-derived gauges)
    consumer_worker  :9101/metrics  (Bronze/Silver ingestion)
    scheduler        :9102/metrics  (matching, alerting, FX)

The DB-derived gauges (open exposure, match rate, FX age) are refreshed by
the API at scrape time (`refresh_state_gauges`), so they reflect the
database rather than whatever one process happened to observe.
"""

import time
from decimal import Decimal

from prometheus_client import REGISTRY, Counter, Gauge, Histogram
from sqlalchemy import text

METRICS_REGISTRY = REGISTRY

# ── Webhook ingestion (api) ────────────────────────────────────────────────
WEBHOOK_RECEIVED_COUNTER = Counter(
    "reconciliation_webhooks_received_total",
    "PSP events durably published to Kafka",
    ["psp_name", "event_type"],
)
WEBHOOK_SIGNATURE_FAILURES = Counter(
    "reconciliation_webhook_signature_failures_total",
    "Webhooks rejected for a missing or invalid signature",
    ["psp_name"],
)
DUPLICATE_EVENTS_COUNTER = Counter(
    "reconciliation_duplicate_events_total",
    "Events skipped because their idempotency key was already registered",
    ["psp_name"],
)

# ── Bronze / Silver (consumer_worker) ──────────────────────────────────────
BRONZE_RECORDS_WRITTEN = Counter(
    "reconciliation_bronze_records_written_total",
    "Raw events written to Bronze (MinIO)",
    ["psp_name"],
)
SILVER_RECORDS_WRITTEN = Counter(
    "reconciliation_silver_records_written_total",
    "New canonical transactions written to Silver",
    ["psp_name"],
)
EVENTS_SKIPPED = Counter(
    "reconciliation_events_skipped_total",
    "Events kept in Bronze only (event type or status not modelled)",
    ["psp_name"],
)
DEAD_LETTERED_COUNTER = Counter(
    "reconciliation_dead_lettered_total",
    "Messages parked in the dead-letter topic",
    ["topic"],
)

# ── Matching / discrepancies (scheduler) ───────────────────────────────────
MATCHING_RESULTS = Counter(
    "reconciliation_matching_results_total",
    "Matching engine outcomes",
    ["strategy"],
)
MATCHING_CONFIDENCE_HISTOGRAM = Histogram(
    "reconciliation_match_confidence",
    "Confidence score of accepted matches",
    buckets=[0.75, 0.8, 0.85, 0.9, 0.95, 0.99, 1.0],
)
DISCREPANCIES_RAISED = Counter(
    "reconciliation_discrepancies_raised_total",
    "Discrepancies newly raised",
    ["classification"],
)
BACKFILL_RECORDS_COUNTER = Counter(
    "reconciliation_backfill_records_total",
    "Polled PSP transactions by ingestion outcome (outcome=new means a recovered gap)",
    ["psp_name", "outcome"],
)
ALERTS_DISPATCHED_COUNTER = Counter(
    "reconciliation_alerts_dispatched_total",
    "Alert delivery attempts",
    ["channel", "outcome"],
)

# ── API (api) ──────────────────────────────────────────────────────────────
HTTP_REQUEST_DURATION = Histogram(
    "reconciliation_http_request_duration_seconds",
    "HTTP request latency by route template",
    ["method", "route", "status_class"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
)
AUTH_FAILURES_COUNTER = Counter(
    "reconciliation_auth_failures_total",
    "Rejected API authentication attempts",
    ["reason"],
)
RATE_LIMIT_COUNTER = Counter(
    "reconciliation_rate_limited_total",
    "Requests rejected by the rate limiter",
)

# ── DB-derived state (api, refreshed at scrape) ────────────────────────────
OPEN_DISCREPANCIES = Gauge(
    "reconciliation_open_discrepancies",
    "Open discrepancies",
    ["psp_name", "severity"],
)
OPEN_EXPOSURE_NGN = Gauge(
    "reconciliation_open_exposure_ngn",
    "Estimated exposure of open discrepancies, NGN",
    ["psp_name"],
)
MATCH_RATE_GAUGE = Gauge(
    "reconciliation_match_rate_pct",
    "Share of credit/debit transactions matched over the last 7 days",
    ["psp_name"],
)
FX_RATE_AGE_SECONDS = Gauge(
    "reconciliation_fx_rate_age_seconds",
    "Age of the current FX snapshot",
    ["currency_pair"],
)

_STATE_TTL_SECONDS = 15.0
_last_state_refresh = 0.0


async def refresh_state_gauges() -> None:
    """Recompute DB-derived gauges, at most once per _STATE_TTL_SECONDS."""
    global _last_state_refresh
    if time.monotonic() - _last_state_refresh < _STATE_TTL_SECONDS:
        return
    from src.storage.postgres import readonly_session

    async with readonly_session() as session:
        open_rows = (
            (
                await session.execute(
                    text("""
            SELECT s.psp_name::text AS psp_name, COALESCE(d.severity, 'unknown') AS severity,
                   COUNT(*) AS n, COALESCE(SUM(d.estimated_exposure_ngn), 0) AS exposure
            FROM gold_discrepancies d
            JOIN silver_canonical_transactions s ON s.id = d.transaction_id
            WHERE d.status IN ('open', 'under_review', 'escalated')
            GROUP BY 1, 2
        """)
                )
            )
            .mappings()
            .all()
        )
        rate_rows = (
            (
                await session.execute(
                    text("""
            SELECT s.psp_name::text AS psp_name,
                   COUNT(*) AS total,
                   COUNT(m.transaction_id) AS matched
            FROM silver_canonical_transactions s
            LEFT JOIN gold_matched_transactions m ON m.transaction_id = s.id
            WHERE s.transaction_type IN ('credit', 'debit')
              AND s.initiated_at >= NOW() - INTERVAL '7 days'
            GROUP BY 1
        """)
                )
            )
            .mappings()
            .all()
        )
        fx_rows = (
            (
                await session.execute(
                    text("""
            SELECT currency_pair, EXTRACT(EPOCH FROM (NOW() - captured_at)) AS age
            FROM silver_fx_rate_snapshots WHERE valid_until IS NULL
        """)
                )
            )
            .mappings()
            .all()
        )

    OPEN_DISCREPANCIES.clear()
    OPEN_EXPOSURE_NGN.clear()
    exposure_by_psp: dict[str, Decimal] = {}
    for r in open_rows:
        OPEN_DISCREPANCIES.labels(psp_name=r["psp_name"], severity=r["severity"]).set(r["n"])
        exposure_by_psp[r["psp_name"]] = exposure_by_psp.get(r["psp_name"], Decimal(0)) + Decimal(r["exposure"])
    for psp, exposure in exposure_by_psp.items():
        OPEN_EXPOSURE_NGN.labels(psp_name=psp).set(float(exposure))  # gauge values are floats by design
    MATCH_RATE_GAUGE.clear()
    for r in rate_rows:
        MATCH_RATE_GAUGE.labels(psp_name=r["psp_name"]).set(100.0 * r["matched"] / r["total"] if r["total"] else 0.0)
    FX_RATE_AGE_SECONDS.clear()
    for r in fx_rows:
        FX_RATE_AGE_SECONDS.labels(currency_pair=r["currency_pair"]).set(float(r["age"]))
    _last_state_refresh = time.monotonic()
