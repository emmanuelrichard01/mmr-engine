# src/config.py
"""
Centralised configuration management.

All configuration is typed, validated at startup, and never scattered across files.
A misconfigured environment fails fast and loudly at boot, not silently at runtime.

Fail-closed rules:
    - ENVIRONMENT defaults to "production". Development conveniences must be
      opted into explicitly, never inherited from a missing variable.
    - Secrets must be non-empty. An empty Flutterwave secret hash would make
      `compare_digest("", "")` accept unsigned webhooks.
    - API auth can only be disabled when ENVIRONMENT=development.

References:
    - TDD §4: Configuration Management
    - Data Governance §3: Secret Management
"""

from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ───────────────────────────────────────────────────────
    environment: Literal["development", "staging", "production"] = "production"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO"
    debug: bool = False

    # ── PostgreSQL ────────────────────────────────────────────────────────
    # Connection strings per role — principle of least privilege
    postgres_pipeline_dsn: str = Field(description="DSN for reconciliation_pipeline role. Writes Silver and Gold.")
    postgres_api_dsn: str = Field(description="DSN for reconciliation_api_user role. Reads + resolution updates.")
    postgres_readonly_dsn: str = Field(description="DSN for reconciliation_readonly role. Read-only.")
    postgres_pool_size: int = Field(default=10, ge=1, le=50)
    postgres_max_overflow: int = Field(default=20, ge=0, le=100)

    # ── Redpanda (Kafka) ──────────────────────────────────────────────────
    kafka_bootstrap_servers: str = "redpanda:9092"
    kafka_consumer_group_id: str = "bronze-writer-group"
    kafka_topic_paystack: str = "raw.paystack.events"
    kafka_topic_flutterwave: str = "raw.flutterwave.events"
    kafka_topic_polling: str = "raw.polling.fallback"
    kafka_topic_dead_letter: str = "dead.letter.queue"
    kafka_producer_acks: Literal["0", "1", "all"] = "all"
    # "all" = strongest durability guarantee. Required for financial data.
    kafka_delivery_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    # ── MinIO ─────────────────────────────────────────────────────────────
    minio_endpoint: str = "minio:9000"
    minio_access_key: SecretStr = Field(description="MinIO access key")
    minio_secret_key: SecretStr = Field(description="MinIO secret key")
    minio_bronze_bucket: str = "reconciliation-bronze"
    minio_use_ssl: bool = False  # True in production

    # ── PSP Credentials ───────────────────────────────────────────────────
    paystack_secret_key: SecretStr = Field(
        description="Paystack secret key: webhook HMAC-SHA512 key and API bearer token."
    )
    flutterwave_secret_key: SecretStr = Field(
        description="Flutterwave secret key: API bearer token for polling/verification."
    )
    flutterwave_secret_hash: SecretStr = Field(
        description="Flutterwave webhook secret hash, compared against the verif-hash header."
    )

    # ── FX Rate Provider ──────────────────────────────────────────────────
    # Optional: only needed for non-NGN transactions. When unset, FX capture
    # is skipped and non-NGN events fail loudly into the dead-letter topic.
    fx_provider_api_key: SecretStr | None = None
    fx_provider_base_url: str = "https://v6.exchangerate-api.com/v6"
    fx_capture_interval_minutes: int = Field(default=30, ge=5, le=1440)
    fx_variance_threshold_pct: float = Field(
        default=0.005,
        ge=0.0,
        le=0.1,
        description="FX variance below this threshold is not raised as a discrepancy. Default: 0.5%.",
    )

    # ── Matching Engine ───────────────────────────────────────────────────
    matching_primary_window_hours: int = Field(
        default=72,
        ge=1,
        le=720,
        description="Time window (±hours) for exact-amount primary matching.",
    )
    matching_secondary_window_hours: int = Field(
        default=168,
        ge=1,
        le=720,
        description="Time window (±hours) for probabilistic secondary matching.",
    )
    matching_secondary_confidence_threshold: float = Field(
        default=0.75,
        ge=0.5,
        le=1.0,
        description="Minimum confidence score for a probabilistic match to be accepted.",
    )
    matching_amount_tolerance_pct: float = Field(
        default=0.05,
        ge=0.0,
        le=0.2,
        description="Max relative amount delta a probabilistic match may carry.",
    )
    matching_schedule_minutes: int = Field(default=5, ge=1, le=1440)

    # ── PII tokenization ──────────────────────────────────────────────────
    # Keyed HMAC so names can be compared without being stored in clear.
    # See docs/adr/0001-pii-tokenization.md.
    pii_tokenization_key: SecretStr = Field(description="HMAC key for deterministic PII tokenization (>= 32 chars).")

    # ── Polling Fallback ──────────────────────────────────────────────────
    polling_interval_minutes: int = Field(default=15, ge=5, le=60)
    gap_detection_interval_hours: int = Field(default=6, ge=1, le=24)

    # ── Alerting ──────────────────────────────────────────────────────────
    slack_webhook_url: SecretStr | None = None
    alert_exposure_threshold_ngn: float = Field(
        default=100_000.0,
        ge=0,
        description="Alert when a single discrepancy's estimated exposure exceeds this NGN amount.",
    )

    # ── API ───────────────────────────────────────────────────────────────
    api_auth_disabled: bool = Field(
        default=False,
        description="Development only: treat unauthenticated requests as a read-only demo caller.",
    )
    api_rate_limit_per_minute: int = Field(default=100, ge=1)
    api_rate_limit_max_buckets: int = Field(default=10_000, ge=100)
    api_cors_origins: list[str] = ["http://localhost:3000"]

    @field_validator("environment", mode="before")
    @classmethod
    def normalise_environment(cls, v: str) -> str:
        return v.lower().strip()

    @field_validator(
        "minio_access_key",
        "minio_secret_key",
        "paystack_secret_key",
        "flutterwave_secret_key",
        "flutterwave_secret_hash",
    )
    @classmethod
    def secret_not_empty(cls, v: SecretStr) -> SecretStr:
        if not v.get_secret_value().strip():
            raise ValueError("must not be empty")
        return v

    @field_validator("fx_provider_api_key", "slack_webhook_url", mode="before")
    @classmethod
    def blank_optional_secret_is_none(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip():
            return None
        return v

    @field_validator("pii_tokenization_key")
    @classmethod
    def tokenization_key_strong(cls, v: SecretStr) -> SecretStr:
        if len(v.get_secret_value()) < 32:
            raise ValueError("must be at least 32 characters")
        return v

    @model_validator(mode="after")
    def auth_disable_only_in_development(self) -> Self:
        if self.api_auth_disabled and self.environment != "development":
            raise ValueError("API_AUTH_DISABLED=true is only allowed when ENVIRONMENT=development")
        if self.matching_primary_window_hours > self.matching_secondary_window_hours:
            raise ValueError("primary matching window must not exceed the secondary window")
        return self


@lru_cache
def get_settings() -> Settings:
    """
    Cached settings instance. lru_cache ensures Settings is instantiated
    once per process — not once per request. Validation errors surface
    at startup, not mid-request.
    """
    return Settings()
