"""Create gold reporting tables

Revision ID: 009
Revises: 008
Create Date: 2026-05-04

Reference: ERD §6.6
"""
from typing import Sequence, Union
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE gold_cbn_daily_returns (
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            return_date                 DATE NOT NULL UNIQUE,
            generated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            generated_by_run_id         UUID NOT NULL REFERENCES system_pipeline_runs(id) ON DELETE RESTRICT,
            total_transaction_count     INTEGER NOT NULL CHECK (total_transaction_count >= 0),
            total_credit_count          INTEGER NOT NULL CHECK (total_credit_count >= 0),
            total_debit_count           INTEGER NOT NULL CHECK (total_debit_count >= 0),
            total_credit_volume_ngn     NUMERIC(25, 2) NOT NULL CHECK (total_credit_volume_ngn >= 0),
            total_debit_volume_ngn      NUMERIC(25, 2) NOT NULL CHECK (total_debit_volume_ngn >= 0),
            cross_border_count          INTEGER NOT NULL DEFAULT 0,
            cross_border_volume_ngn     NUMERIC(25, 2) NOT NULL DEFAULT 0,
            suspicious_tx_count         INTEGER NOT NULL DEFAULT 0,
            unreconciled_count          INTEGER NOT NULL DEFAULT 0,
            unreconciled_exposure_ngn   NUMERIC(25, 2) NOT NULL DEFAULT 0,
            matched_count               INTEGER NOT NULL DEFAULT 0,
            match_rate_pct              NUMERIC(7, 4),
            open_discrepancy_count      INTEGER NOT NULL DEFAULT 0,
            report_payload              JSONB NOT NULL,
            submission_status           cbn_submission_status_enum NOT NULL DEFAULT 'draft',
            approved_by                 VARCHAR(200),
            approved_at                 TIMESTAMPTZ,
            submitted_at                TIMESTAMPTZ,
            cbn_acknowledgement_ref     VARCHAR(200),
            acknowledgement_received_at TIMESTAMPTZ,
            CONSTRAINT chk_cbn_credit_debit_sum
                CHECK (total_credit_count + total_debit_count <= total_transaction_count),
            CONSTRAINT chk_cbn_submission_approved
                CHECK (
                    submission_status NOT IN ('submitted', 'acknowledged')
                    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
                )
        )
    """)
    op.execute("CREATE INDEX idx_cbn_returns_status ON gold_cbn_daily_returns (submission_status, return_date DESC)")

    op.execute("""
        CREATE TABLE gold_exposure_tracker (
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            snapshot_date               DATE NOT NULL,
            psp_name                    psp_name_enum NOT NULL,
            classification              discrepancy_class_enum NOT NULL,
            open_discrepancy_count      INTEGER NOT NULL DEFAULT 0,
            total_exposure_ngn          NUMERIC(20, 6) NOT NULL DEFAULT 0,
            oldest_open_discrepancy_at  TIMESTAMPTZ,
            computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            computed_by_run_id          UUID REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,
            CONSTRAINT uq_exposure_snapshot
                UNIQUE (snapshot_date, psp_name, classification)
        )
    """)
    op.execute("CREATE INDEX idx_exposure_date ON gold_exposure_tracker (snapshot_date DESC, total_exposure_ngn DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS gold_exposure_tracker")
    op.execute("DROP TABLE IF EXISTS gold_cbn_daily_returns")
