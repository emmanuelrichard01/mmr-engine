"""Create silver canonical transactions

Revision ID: 005
Revises: 004
Create Date: 2026-05-04

Reference: ERD §6.5 — Silver Layer (Core Entity)
"""
from typing import Sequence, Union

from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE silver_canonical_transactions (

            -- Identity
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            idempotency_key             VARCHAR(200) NOT NULL UNIQUE,
            internal_ref                VARCHAR(100) NOT NULL UNIQUE
                DEFAULT 'REC-' || UPPER(REPLACE(gen_random_uuid()::TEXT, '-', '')),

            -- Source Traceability
            bronze_ingestion_id         UUID NOT NULL
                REFERENCES bronze_ingestion_log(id) ON DELETE RESTRICT,
            psp_name                    psp_name_enum NOT NULL,
            psp_transaction_ref         VARCHAR(200) NOT NULL,
            psp_event_type              VARCHAR(100) NOT NULL,
            psp_event_received_at       TIMESTAMPTZ NOT NULL,

            -- Classification
            transaction_type            transaction_type_enum NOT NULL,

            -- Amounts
            amount_raw                  NUMERIC(20, 6) NOT NULL CHECK (amount_raw >= 0),
            currency_raw                CHAR(3) NOT NULL,
            amount_ngn                  NUMERIC(20, 6) NOT NULL CHECK (amount_ngn >= 0),
            fx_rate_snapshot_id         UUID
                REFERENCES silver_fx_rate_snapshots(id) ON DELETE RESTRICT,
            fx_rate_applied             NUMERIC(20, 8),

            -- Party Information (PII-masked)
            sender_account_masked       VARCHAR(50),
            sender_bank_code            VARCHAR(10),
            sender_bank_name            VARCHAR(200),
            beneficiary_account_masked  VARCHAR(50),
            beneficiary_bank_code       VARCHAR(10),
            beneficiary_bank_name       VARCHAR(200),
            beneficiary_name_masked     VARCHAR(200),

            -- Narrative
            narration                   TEXT,

            -- Timing
            initiated_at                TIMESTAMPTZ NOT NULL,
            settled_at                  TIMESTAMPTZ,
            expected_settlement_at      TIMESTAMPTZ,
            settlement_sla_breached     BOOLEAN
                GENERATED ALWAYS AS (
                    CASE
                        WHEN settled_at IS NOT NULL
                             AND expected_settlement_at IS NOT NULL
                             AND settled_at > expected_settlement_at
                        THEN TRUE
                        WHEN expected_settlement_at IS NOT NULL
                             AND settled_at IS NULL
                             AND NOW() > expected_settlement_at
                        THEN TRUE
                        ELSE FALSE
                    END
                ) STORED,

            -- Status
            settlement_status           settlement_status_enum NOT NULL DEFAULT 'pending',

            -- Metadata
            has_pii_masked              BOOLEAN NOT NULL DEFAULT FALSE,
            psp_metadata                JSONB DEFAULT '{}',

            -- Lineage
            processed_by_run_id         UUID NOT NULL
                REFERENCES system_pipeline_runs(id) ON DELETE RESTRICT,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

            -- Cross-field Constraints
            CONSTRAINT chk_silver_tx_fx_required
                CHECK (
                    (currency_raw = 'NGN' AND fx_rate_snapshot_id IS NULL)
                    OR
                    (currency_raw != 'NGN' AND fx_rate_snapshot_id IS NOT NULL)
                ),
            CONSTRAINT chk_silver_tx_pii_masked
                CHECK (has_pii_masked = TRUE),
            CONSTRAINT chk_silver_tx_settled_after_initiated
                CHECK (settled_at IS NULL OR settled_at >= initiated_at)
        )
    """)

    # Indexes
    op.execute("""
        CREATE INDEX idx_silver_tx_matching_primary
            ON silver_canonical_transactions (amount_ngn, initiated_at, settlement_status)
            WHERE settlement_status IN ('pending', 'settled')
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_psp_ref
            ON silver_canonical_transactions (psp_name, psp_transaction_ref)
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_initiated_at
            ON silver_canonical_transactions (initiated_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_settled_at
            ON silver_canonical_transactions (settled_at DESC)
            WHERE settled_at IS NOT NULL
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_beneficiary_trgm
            ON silver_canonical_transactions
            USING GIN (beneficiary_name_masked gin_trgm_ops)
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_status_psp
            ON silver_canonical_transactions (settlement_status, psp_name, created_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_silver_tx_sla_breached
            ON silver_canonical_transactions (expected_settlement_at)
            WHERE settlement_status = 'pending'
              AND expected_settlement_at IS NOT NULL
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS silver_canonical_transactions")
