"""Create silver supporting tables

Revision ID: 006
Revises: 005
Create Date: 2026-05-04

Reference: ERD §6.5
"""
from typing import Sequence, Union
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE silver_idempotency_keys (
            key                 VARCHAR(200) PRIMARY KEY,
            first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            occurrence_count    INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
            last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            canonical_tx_id     UUID REFERENCES silver_canonical_transactions(id) ON DELETE SET NULL
        )
    """)
    op.execute("CREATE INDEX idx_idempotency_tx_id ON silver_idempotency_keys (canonical_tx_id)")

    op.execute("""
        CREATE TABLE silver_psp_settlement_windows (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            psp_name                psp_name_enum NOT NULL,
            transaction_type        transaction_type_enum NOT NULL,
            account_tier            VARCHAR(50) NOT NULL DEFAULT 'standard',
            settlement_lag_hours    NUMERIC(5, 2) NOT NULL CHECK (settlement_lag_hours > 0),
            settlement_days         VARCHAR(20) NOT NULL DEFAULT 'business'
                CHECK (settlement_days IN ('business', 'calendar')),
            cutoff_time_wat         TIME,
            effective_from          DATE NOT NULL,
            effective_until         DATE,
            notes                   TEXT,
            CONSTRAINT uq_settlement_window
                UNIQUE (psp_name, transaction_type, account_tier, effective_from),
            CONSTRAINT chk_settlement_window_dates
                CHECK (effective_until IS NULL OR effective_until > effective_from)
        )
    """)
    op.execute("""
        CREATE INDEX idx_settlement_windows_active
            ON silver_psp_settlement_windows (psp_name, transaction_type, effective_from DESC)
            WHERE effective_until IS NULL
    """)

    op.execute("""
        CREATE TABLE silver_transaction_audit_log (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            transaction_id  UUID NOT NULL
                REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
            event_type      VARCHAR(100) NOT NULL,
            previous_state  JSONB,
            new_state       JSONB NOT NULL,
            triggered_by    VARCHAR(200) NOT NULL,
            occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            run_id          UUID REFERENCES system_pipeline_runs(id),
            notes           TEXT
        )
    """)
    op.execute("CREATE INDEX idx_audit_log_transaction ON silver_transaction_audit_log (transaction_id, occurred_at DESC)")
    op.execute("CREATE INDEX idx_audit_log_event_type ON silver_transaction_audit_log (event_type, occurred_at DESC)")
    op.execute("CREATE INDEX idx_audit_log_run ON silver_transaction_audit_log (run_id) WHERE run_id IS NOT NULL")

    # Audit trigger
    op.execute("""
        CREATE OR REPLACE FUNCTION fn_silver_tx_audit_trigger()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
            IF OLD.settlement_status IS DISTINCT FROM NEW.settlement_status THEN
                INSERT INTO silver_transaction_audit_log (
                    transaction_id, event_type, previous_state, new_state, triggered_by, run_id
                ) VALUES (
                    NEW.id, 'STATUS_CHANGED',
                    jsonb_build_object('settlement_status', OLD.settlement_status),
                    jsonb_build_object('settlement_status', NEW.settlement_status),
                    'system:trigger', NEW.processed_by_run_id
                );
            END IF;
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER trg_silver_tx_audit
            BEFORE UPDATE ON silver_canonical_transactions
            FOR EACH ROW EXECUTE FUNCTION fn_silver_tx_audit_trigger()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_silver_tx_audit ON silver_canonical_transactions")
    op.execute("DROP FUNCTION IF EXISTS fn_silver_tx_audit_trigger()")
    op.execute("DROP TABLE IF EXISTS silver_transaction_audit_log")
    op.execute("DROP TABLE IF EXISTS silver_psp_settlement_windows")
    op.execute("DROP TABLE IF EXISTS silver_idempotency_keys")
