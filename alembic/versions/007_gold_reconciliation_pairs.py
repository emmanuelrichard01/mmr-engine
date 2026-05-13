"""Create gold reconciliation pairs

Revision ID: 007
Revises: 006
Create Date: 2026-05-04

Reference: ERD §6.6
"""
from typing import Sequence, Union
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE gold_reconciliation_pairs (
            id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_a_id                UUID NOT NULL
                REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
            transaction_b_id                UUID
                REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
            match_strategy                  match_strategy_enum,
            confidence_score                NUMERIC(5, 4) CHECK (confidence_score BETWEEN 0 AND 1),
            match_evidence                  JSONB,
            amount_a_ngn                    NUMERIC(20, 6) NOT NULL CHECK (amount_a_ngn >= 0),
            amount_b_ngn                    NUMERIC(20, 6) CHECK (amount_b_ngn >= 0),
            amount_delta_ngn                NUMERIC(20, 6),
            fx_variance_pct                 NUMERIC(10, 6),
            is_within_fx_threshold          BOOLEAN,
            settlement_lag_actual_minutes   NUMERIC(10, 2),
            settlement_lag_expected_minutes NUMERIC(10, 2),
            is_settlement_on_time           BOOLEAN,
            status                          pair_status_enum NOT NULL DEFAULT 'matched',
            matched_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at                     TIMESTAMPTZ,
            resolved_at                     TIMESTAMPTZ,
            resolved_by                     VARCHAR(200),
            resolution_note                 TEXT,
            dbt_run_id                      UUID REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_pairs_different_transactions
                CHECK (transaction_a_id != transaction_b_id),
            CONSTRAINT chk_pairs_resolution_complete
                CHECK (
                    status != 'resolved'
                    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_note IS NOT NULL)
                )
        )
    """)
    op.execute("CREATE INDEX idx_gold_pairs_status ON gold_reconciliation_pairs (status, matched_at DESC)")
    op.execute("CREATE INDEX idx_gold_pairs_tx_a ON gold_reconciliation_pairs (transaction_a_id)")
    op.execute("CREATE INDEX idx_gold_pairs_tx_b ON gold_reconciliation_pairs (transaction_b_id) WHERE transaction_b_id IS NOT NULL")
    op.execute("CREATE INDEX idx_gold_pairs_confidence ON gold_reconciliation_pairs (confidence_score DESC) WHERE status = 'matched'")
    op.execute("CREATE INDEX idx_gold_pairs_open ON gold_reconciliation_pairs (matched_at DESC) WHERE status IN ('discrepancy', 'under_review')")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS gold_reconciliation_pairs")
