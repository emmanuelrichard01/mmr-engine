"""Create system tables

Revision ID: 002
Revises: 001
Create Date: 2026-05-04

Reference: ERD §6.3 — System Layer Tables
"""
from typing import Sequence, Union

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE system_pipeline_runs (
            id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            flow_name               VARCHAR(200) NOT NULL,
            flow_version            VARCHAR(50),
            prefect_flow_run_id     VARCHAR(200) UNIQUE,
            status                  pipeline_status_enum NOT NULL DEFAULT 'running',
            triggered_by            VARCHAR(100) NOT NULL,
            started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at            TIMESTAMPTZ,
            duration_seconds        NUMERIC(10, 3)
                GENERATED ALWAYS AS (
                    EXTRACT(EPOCH FROM (completed_at - started_at))
                ) STORED,
            records_processed       INTEGER DEFAULT 0,
            records_failed          INTEGER DEFAULT 0,
            error_message           TEXT,
            error_traceback         TEXT,
            metadata                JSONB DEFAULT '{}'
        )
    """)
    op.execute("""
        CREATE INDEX idx_pipeline_runs_status
            ON system_pipeline_runs (status, started_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_pipeline_runs_flow
            ON system_pipeline_runs (flow_name, started_at DESC)
    """)

    op.execute("""
        CREATE TABLE system_api_keys (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            key_hash            VARCHAR(64) NOT NULL UNIQUE,
            key_prefix          VARCHAR(8) NOT NULL,
            client_name         VARCHAR(200) NOT NULL,
            client_description  TEXT,
            scopes              TEXT[] NOT NULL DEFAULT ARRAY['read'],
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at          TIMESTAMPTZ,
            last_used_at        TIMESTAMPTZ,
            usage_count         BIGINT NOT NULL DEFAULT 0,

            CONSTRAINT chk_api_key_scopes
                CHECK (scopes <@ ARRAY['read', 'write', 'admin']::TEXT[])
        )
    """)
    op.execute("""
        CREATE INDEX idx_api_keys_hash
            ON system_api_keys (key_hash)
            WHERE is_active = TRUE
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS system_api_keys")
    op.execute("DROP TABLE IF EXISTS system_pipeline_runs")
