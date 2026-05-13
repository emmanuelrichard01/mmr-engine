"""Create gold discrepancies and system alert events

Revision ID: 008
Revises: 007
Create Date: 2026-05-04

Reference: ERD §6.6 + §6.3 (alert events deferred here due to FK on gold_discrepancies)
"""
from typing import Sequence, Union
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE gold_discrepancies (
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            reconciliation_pair_id      UUID REFERENCES gold_reconciliation_pairs(id) ON DELETE SET NULL,
            transaction_id              UUID NOT NULL
                REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
            classification              discrepancy_class_enum NOT NULL,
            confidence_score            NUMERIC(5, 4) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
            evidence                    JSONB NOT NULL,
            estimated_exposure_ngn      NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (estimated_exposure_ngn >= 0),
            status                      discrepancy_status_enum NOT NULL DEFAULT 'open',
            raised_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at                 TIMESTAMPTZ,
            resolved_at                 TIMESTAMPTZ,
            resolved_by                 VARCHAR(200),
            resolution_note             TEXT,
            resolution_type             VARCHAR(100),
            has_alert_sent              BOOLEAN NOT NULL DEFAULT FALSE,
            alert_sent_at               TIMESTAMPTZ,
            escalated_at                TIMESTAMPTZ,
            dbt_run_id                  UUID REFERENCES system_pipeline_runs(id) ON DELETE SET NULL,
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT chk_discrepancy_resolution_complete
                CHECK (
                    status NOT IN ('resolved', 'false_positive')
                    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
                ),
            CONSTRAINT chk_discrepancy_escalation_sequence
                CHECK (escalated_at IS NULL OR escalated_at >= raised_at)
        )
    """)
    op.execute("CREATE INDEX idx_discrepancy_status_raised ON gold_discrepancies (status, raised_at DESC)")
    op.execute("CREATE INDEX idx_discrepancy_classification ON gold_discrepancies (classification, status)")
    op.execute("CREATE INDEX idx_discrepancy_exposure ON gold_discrepancies (estimated_exposure_ngn DESC) WHERE status = 'open'")
    op.execute("CREATE INDEX idx_discrepancy_alert_pending ON gold_discrepancies (raised_at) WHERE has_alert_sent = FALSE AND status = 'open'")
    op.execute("CREATE INDEX idx_discrepancy_transaction ON gold_discrepancies (transaction_id)")

    # System alert events (deferred from 002 due to FK on gold_discrepancies)
    op.execute("""
        CREATE TABLE system_alert_events (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            discrepancy_id          UUID REFERENCES gold_discrepancies(id) ON DELETE SET NULL,
            alert_channel           alert_channel_enum NOT NULL,
            alert_type              VARCHAR(100) NOT NULL,
            recipient               VARCHAR(200) NOT NULL,
            payload                 JSONB NOT NULL,
            status                  alert_status_enum NOT NULL DEFAULT 'queued',
            queued_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at                 TIMESTAMPTZ,
            delivery_confirmed_at   TIMESTAMPTZ,
            failure_reason          TEXT,
            retry_count             INTEGER NOT NULL DEFAULT 0
        )
    """)
    op.execute("CREATE INDEX idx_alert_events_discrepancy ON system_alert_events (discrepancy_id, sent_at DESC)")
    op.execute("CREATE INDEX idx_alert_events_status ON system_alert_events (status, queued_at) WHERE status IN ('queued', 'failed')")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS system_alert_events")
    op.execute("DROP TABLE IF EXISTS gold_discrepancies")
