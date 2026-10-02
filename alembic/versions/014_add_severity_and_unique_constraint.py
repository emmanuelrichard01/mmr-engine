"""Add severity and unique constraint to gold discrepancies

Revision ID: 014
Revises: 013
Create Date: 2026-05-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add severity column to gold_discrepancies
    op.execute("""
        ALTER TABLE gold_discrepancies
        ADD COLUMN severity VARCHAR(50) CHECK (severity IN ('low', 'medium', 'high', 'critical'))
    """)
    # 2. Add unique constraint on (transaction_id, classification)
    op.execute("""
        ALTER TABLE gold_discrepancies
        ADD CONSTRAINT uq_discrepancies_tx_class UNIQUE (transaction_id, classification)
    """)


def downgrade() -> None:
    # 1. Drop unique constraint
    op.execute("""
        ALTER TABLE gold_discrepancies
        DROP CONSTRAINT IF EXISTS uq_discrepancies_tx_class
    """)
    # 2. Drop severity column
    op.execute("""
        ALTER TABLE gold_discrepancies
        DROP COLUMN IF EXISTS severity
    """)
