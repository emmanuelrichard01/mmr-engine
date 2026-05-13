# src/observability/metrics.py
"""
Prometheus metrics for the Reconciliation Engine.

All metrics follow the naming convention: reconciliation_{subsystem}_{metric_name}_{unit}
Labels are kept minimal to prevent cardinality explosion.

References:
    - TDD §12.1: Prometheus Metrics
    - PRD NFR-006: Observability
"""
from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
    REGISTRY,
)

METRICS_REGISTRY = REGISTRY

# ── Webhook Ingestion ─────────────────────────────────────────────────────────
WEBHOOK_RECEIVED_COUNTER = Counter(
    "reconciliation_webhooks_received_total",
    "Total webhooks received by PSP and event type",
    ["psp_name", "event_type"],
)

WEBHOOK_SIGNATURE_FAILURES = Counter(
    "reconciliation_webhook_signature_failures_total",
    "Webhook events rejected due to invalid HMAC signature",
    ["psp"],
)

DUPLICATE_EVENTS_COUNTER = Counter(
    "reconciliation_duplicate_events_total",
    "Webhook events skipped due to idempotency key already existing",
    ["psp_name"],
)

# ── Pipeline ──────────────────────────────────────────────────────────────────
PIPELINE_LATENCY = Histogram(
    "reconciliation_pipeline_duration_seconds",
    "End-to-end pipeline duration from webhook receipt to Gold output",
    ["flow_name"],
    buckets=[0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0],
)

SILVER_RECORDS_WRITTEN = Counter(
    "reconciliation_silver_records_written_total",
    "Canonical transaction records written to Silver layer",
    ["psp_name"],
)

INGESTION_LATENCY = Histogram(
    "reconciliation_ingestion_latency_seconds",
    "Webhook receipt to Bronze persistence latency",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)

# ── Matching Engine ───────────────────────────────────────────────────────────
MATCHING_RESULTS = Counter(
    "reconciliation_matching_results_total",
    "Matching engine outcomes by strategy and result",
    ["strategy", "result"],  # result: matched | no_match
)

MATCHING_CONFIDENCE_HISTOGRAM = Histogram(
    "reconciliation_matching_confidence_score",
    "Distribution of confidence scores for probabilistic matches",
    buckets=[0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.99, 1.0],
)

# ── Financial State ───────────────────────────────────────────────────────────
OPEN_DISCREPANCIES = Gauge(
    "reconciliation_open_discrepancies",
    "Current count of open discrepancies by PSP and classification",
    ["psp_name", "classification"],
)

OPEN_EXPOSURE_NGN = Gauge(
    "reconciliation_open_exposure_ngn",
    "Total estimated financial exposure from open discrepancies in NGN",
    ["psp_name"],
)

MATCH_RATE_GAUGE = Gauge(
    "reconciliation_match_rate_pct",
    "Current reconciliation match rate percentage by PSP",
    ["psp_name"],
)

# ── FX ────────────────────────────────────────────────────────────────────────
FX_RATE_GAUGE = Gauge(
    "reconciliation_fx_rate",
    "Current FX rate (1 NGN = X quote currency)",
    ["currency_pair"],
)

FX_RATE_AGE_SECONDS = Gauge(
    "reconciliation_fx_rate_age_seconds",
    "Age of most recent FX rate snapshot in seconds",
    ["currency_pair"],
)
