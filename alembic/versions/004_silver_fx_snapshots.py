"""Create silver FX rate snapshots

Revision ID: 004
Revises: 003
Create Date: 2026-05-04

Reference: ERD §6.5 — Silver Layer (FX snapshots, created before canonical_transactions due to FK)
"""
from typing import Sequence, Union

from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE silver_fx_rate_snapshots (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            currency_pair       VARCHAR(7) NOT NULL,
            rate                NUMERIC(20, 8) NOT NULL CHECK (rate > 0),
            bid                 NUMERIC(20, 8) CHECK (bid > 0),
            ask                 NUMERIC(20, 8) CHECK (ask > 0),
            mid                 NUMERIC(20, 8)
                GENERATED ALWAYS AS (
                    CASE WHEN bid IS NOT NULL AND ask IS NOT NULL
                    THEN (bid + ask) / 2
                    ELSE rate
                    END
                ) STORED,
            spread_pct          NUMERIC(10, 6)
                GENERATED ALWAYS AS (
                    CASE WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid > 0
                    THEN ((ask - bid) / bid) * 100
                    ELSE NULL
                    END
                ) STORED,
            source_provider     VARCHAR(100) NOT NULL,
            captured_at         TIMESTAMPTZ NOT NULL,
            valid_from          TIMESTAMPTZ NOT NULL,
            valid_until         TIMESTAMPTZ,
            bronze_snapshot_id  UUID REFERENCES bronze_ingestion_log(id),

            CONSTRAINT chk_fx_bid_ask_order
                CHECK (bid IS NULL OR ask IS NULL OR bid <= ask),
            CONSTRAINT chk_fx_valid_range
                CHECK (valid_until IS NULL OR valid_until > valid_from),
            CONSTRAINT chk_fx_currency_pair_format
                CHECK (currency_pair ~ '^[A-Z]{3}/[A-Z]{3}$')
        )
    """)
    # Only one current rate per currency pair (valid_until IS NULL)
    op.execute("""
        CREATE UNIQUE INDEX idx_fx_current_rate
            ON silver_fx_rate_snapshots (currency_pair)
            WHERE valid_until IS NULL
    """)
    op.execute("""
        CREATE INDEX idx_fx_pair_time
            ON silver_fx_rate_snapshots (currency_pair, captured_at DESC)
    """)

    # Point-in-time FX rate lookup function
    op.execute("""
        CREATE OR REPLACE FUNCTION get_fx_rate_at(
            p_currency_pair VARCHAR(7),
            p_at_time       TIMESTAMPTZ
        )
        RETURNS TABLE (
            snapshot_id     UUID,
            rate            NUMERIC(20, 8),
            captured_at     TIMESTAMPTZ,
            source_provider VARCHAR(100)
        )
        LANGUAGE SQL STABLE AS $$
            SELECT id, rate, captured_at, source_provider
            FROM silver_fx_rate_snapshots
            WHERE currency_pair = p_currency_pair
              AND captured_at <= p_at_time
            ORDER BY captured_at DESC
            LIMIT 1;
        $$
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS get_fx_rate_at(VARCHAR, TIMESTAMPTZ)")
    op.execute("DROP TABLE IF EXISTS silver_fx_rate_snapshots")
