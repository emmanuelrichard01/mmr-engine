# src/config.py
"""
Centralised configuration management.

All configuration is typed, validated at startup, and never scattered across files.
A misconfigured environment fails fast and loudly at boot, not silently at runtime.

References:
    - TDD §4: Configuration Management
    - Data Governance §3: Secret Management
"""
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Environment ───────────────────────────────────────────────────────
    environment: Literal["development", "staging", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    debug: bool = False

    # ── PostgreSQL ────────────────────────────────────────────────────────
    # Connection strings per role — principle of least privilege
    postgres_pipeline_dsn: str = Field(
        description="DSN for reconciliation_pipeline role. "
        "Has INSERT/UPDATE on Silver and Gold."
    )
    postgres_api_dsn: str = Field(
        description="DSN for reconciliation_api_user role. "
        "Read-only + resolution updates."
    )
    postgres_readonly_dsn: str = Field(
        description="DSN for reconciliation_readonly role. "
        "Read-only. Used by Streamlit and DuckDB export."
    )
    postgres_pool_size: int = Field(default=10, ge=1, le=50)
    postgres_max_overflow: int = Field(default=20, ge=0, le=100)

    # ── Redpanda (Kafka) ──────────────────────────────────────────────────
    kafka_bootstrap_servers: str = "redpanda:9092"
    kafka_consumer_group_id: str = "bronze-writer-group"
    kafka_topic_paystack: str = "raw.paystack.events"
    kafka_topic_flutterwave: str = "raw.flutterwave.events"
    kafka_topic_mpesa: str = "raw.mpesa.events"
    kafka_topic_polling: str = "raw.polling.fallback"
    kafka_topic_dead_letter: str = "pipeline.dead.letter"
    kafka_producer_acks: Literal["0", "1", "all"] = "all"
    # "all" = strongest durability guarantee. Required for financial data.

    # ── MinIO ─────────────────────────────────────────────────────────────
    minio_endpoint: str = "minio:9000"
    minio_access_key: str = Field(description="MinIO access key")
    minio_secret_key: str = Field(description="MinIO secret key")
    minio_bronze_bucket: str = "reconciliation-bronze"
    minio_use_ssl: bool = False  # True in production

    # ── PSP Credentials (Sandbox) ─────────────────────────────────────────
    paystack_secret_key: str = Field(
        description="Paystack secret key for webhook validation and API calls. "
        "Format: sk_test_... for sandbox."
    )
    flutterwave_secret_key: str = Field(
        description="Flutterwave secret hash for webhook signature validation."
    )
    flutterwave_secret_hash: str = Field(
        description="Flutterwave webhook secret hash for HMAC verification."
    )
    mpesa_consumer_key: str = ""
    mpesa_consumer_secret: str = ""

    # ── FX Rate Provider ──────────────────────────────────────────────────
    fx_provider_api_key: str = Field(
        description="ExchangeRate-API key for FX rate capture."
    )
    fx_provider_base_url: str = "https://v6.exchangerate-api.com/v6"
    fx_capture_interval_minutes: int = Field(default=30, ge=5, le=1440)
    fx_variance_threshold_pct: float = Field(
        default=0.005,
        ge=0.0,
        le=0.1,
        description="FX variance below this threshold is not raised as a discrepancy. "
        "Default: 0.5% (0.005).",
    )

    # ── Matching Engine ───────────────────────────────────────────────────
    matching_primary_window_minutes: int = Field(
        default=5,
        description="Time window (±minutes) for primary exact matching on timestamp.",
    )
    matching_secondary_window_minutes: int = Field(
        default=30,
        description="Time window (±minutes) for probabilistic secondary matching.",
    )
    matching_secondary_confidence_threshold: float = Field(
        default=0.75,
        ge=0.5,
        le=1.0,
        description="Minimum confidence score for a probabilistic match to be accepted. "
        "Below this threshold the pair is flagged for manual review.",
    )
    matching_name_similarity_threshold: float = Field(
        default=0.80,
        ge=0.5,
        le=1.0,
        description="Minimum trigram similarity for beneficiary name fuzzy match.",
    )

    # ── Polling Fallback ──────────────────────────────────────────────────
    polling_interval_minutes: int = Field(default=15, ge=5, le=60)
    polling_trigger_after_minutes: int = Field(
        default=30,
        description="A pending transaction older than this without settlement "
        "confirmation triggers a polling check.",
    )
    polling_max_attempts: int = Field(default=10)

    # ── Alerting ──────────────────────────────────────────────────────────
    slack_webhook_url: str = ""
    slack_alert_channel: str = "#reconciliation-alerts"
    alert_confidence_threshold: float = Field(
        default=0.90,
        description="Discrepancies above this confidence score trigger "
        "immediate automatic alerting.",
    )
    alert_exposure_threshold_ngn: float = Field(
        default=100_000.0,
        description="Alert immediately when a single discrepancy's estimated "
        "exposure exceeds this NGN amount.",
    )

    # ── DuckDB ────────────────────────────────────────────────────────────
    duckdb_path: str = "/data/analytics/reconciliation.duckdb"
    duckdb_export_interval_minutes: int = Field(default=15)

    # ── API ───────────────────────────────────────────────────────────────
    api_rate_limit_per_minute: int = Field(default=100)
    api_request_timeout_seconds: int = Field(default=30)
    api_cors_origins: list[str] = [
        "http://localhost:3000",   # Next.js dashboard
        "http://localhost:8501",   # Legacy Streamlit (if used)
    ]

    @field_validator("environment", mode="before")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        return v.lower().strip()


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings instance. lru_cache ensures Settings is instantiated
    once per process — not once per request. Validation errors surface
    at startup, not mid-request.
    """
    return Settings()
