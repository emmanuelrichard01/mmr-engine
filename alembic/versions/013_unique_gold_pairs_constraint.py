"""Add unique constraint to gold reconciliation pairs

Revision ID: 013
Revises: 012
Create Date: 2026-05-21
"""
from typing import Sequence, Union
from alembic import op

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Delete duplicate pairs if any exist
    op.execute("""
        DELETE FROM gold_reconciliation_pairs a
        USING gold_reconciliation_pairs b
        WHERE a.id > b.id
          AND a.transaction_a_id = b.transaction_a_id
          AND a.transaction_b_id = b.transaction_b_id
    """)
    # Add unique constraint on (transaction_a_id, transaction_b_id)
    op.execute("""
        ALTER TABLE gold_reconciliation_pairs
        ADD CONSTRAINT uq_pairs_transaction_a_b UNIQUE (transaction_a_id, transaction_b_id)
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE gold_reconciliation_pairs
        DROP CONSTRAINT IF EXISTS uq_pairs_transaction_a_b
    """)
