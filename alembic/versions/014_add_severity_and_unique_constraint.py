"""Add severity and unique constraint to gold discrepancies

Revision ID: 014
Revises: 013
Create Date: 2026-05-21
"""

from collections.abc import Sequence

from alembic import op

revision: str = "014"
down_revision: str | None = "013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add severity column to gold_discrepancies
    op.execute("""
        ALTER TABLE gold_discrepancies
        ADD COLUMN severity VARCHAR(50) CHECK (severity IN ('low', 'medium', 'high', 'critical'))
    """)
    # 2. Remove duplicates (keep the earliest) so the constraint can be added
    #    to databases that already accumulated them, then add the constraint.
    #    One discrepancy per (transaction, classification) ever: resolving
    #    one is final and must not be re-raised by the next pipeline run.
    op.execute("""
        DELETE FROM gold_discrepancies a
        USING gold_discrepancies b
        WHERE a.transaction_id = b.transaction_id
          AND a.classification = b.classification
          AND (a.raised_at, a.id) > (b.raised_at, b.id)
    """)
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
