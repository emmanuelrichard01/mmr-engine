"""Create bronze tables

Revision ID: 003
Revises: 002
Create Date: 2026-05-04

Reference: ERD §6.4 — Bronze Layer
"""
from typing import Sequence, Union

from alembic import op

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE bronze_ingestion_log (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            psp_name            psp_name_enum NOT NULL,
            source_type         source_type_enum NOT NULL,
            kafka_topic         VARCHAR(200) NOT NULL,
            kafka_partition     INTEGER NOT NULL CHECK (kafka_partition >= 0),
            kafka_offset        BIGINT NOT NULL CHECK (kafka_offset >= 0),
            content_hash        CHAR(64) NOT NULL,
            file_path           VARCHAR(1000) NOT NULL,
            event_count         INTEGER NOT NULL CHECK (event_count > 0),
            ingestion_run_id    UUID NOT NULL REFERENCES system_pipeline_runs(id),
            received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            status              ingestion_status_enum NOT NULL DEFAULT 'received',
            failure_reason      TEXT,

            CONSTRAINT uq_bronze_kafka_offset
                UNIQUE (kafka_topic, kafka_partition, kafka_offset),

            CONSTRAINT chk_bronze_failure_reason
                CHECK (
                    (status = 'failed' AND failure_reason IS NOT NULL)
                    OR status != 'failed'
                )
        )
    """)
    op.execute("""
        CREATE INDEX idx_bronze_log_psp_date
            ON bronze_ingestion_log (psp_name, received_at DESC)
    """)
    op.execute("""
        CREATE INDEX idx_bronze_log_hash
            ON bronze_ingestion_log (content_hash)
    """)
    op.execute("""
        CREATE INDEX idx_bronze_log_status
            ON bronze_ingestion_log (status)
            WHERE status IN ('received', 'failed')
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS bronze_ingestion_log")
