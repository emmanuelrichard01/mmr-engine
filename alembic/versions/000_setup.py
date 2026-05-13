"""Setup extensions and schemas

Revision ID: 000
Revises: None
Create Date: 2026-05-04

Reference: ERD §6.1 — Database Setup and Extensions
"""
from typing import Sequence, Union

from alembic import op

revision: str = "000"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # pgcrypto — gen_random_uuid()
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
    # pg_trgm — trigram indexes for fuzzy name matching
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_trgm"')
    # btree_gist — range overlap indexes for time windows
    op.execute('CREATE EXTENSION IF NOT EXISTS "btree_gist"')
    # pgaudit — CBN audit trail requirement
    op.execute('CREATE EXTENSION IF NOT EXISTS "pgaudit"')


def downgrade() -> None:
    op.execute('DROP EXTENSION IF EXISTS "btree_gist"')
    op.execute('DROP EXTENSION IF EXISTS "pg_trgm"')
    op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
