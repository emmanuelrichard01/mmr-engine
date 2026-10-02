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
    # NOTE: pgaudit (CBN audit trail) is NOT included here because:
    #   1. It's not bundled with the stock postgres:16 Docker image
    #   2. PostgreSQL aborts the whole transaction if CREATE EXTENSION fails
    # For production: use a custom image with pgaudit, then run:
    #   CREATE EXTENSION IF NOT EXISTS "pgaudit";
    #   SET pgaudit.log = 'write, ddl';


def downgrade() -> None:
    op.execute('DROP EXTENSION IF EXISTS "btree_gist"')
    op.execute('DROP EXTENSION IF EXISTS "pg_trgm"')
    op.execute('DROP EXTENSION IF EXISTS "pgcrypto"')
