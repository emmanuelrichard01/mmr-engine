"""Setup extensions and schemas

Revision ID: 000
Revises: None
Create Date: 2026-05-04

Reference: ERD §6.1 — Database Setup and Extensions
"""

from collections.abc import Sequence

revision: str = "000"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # No extensions are required:
    #   - gen_random_uuid() is built into PostgreSQL 13+ (pgcrypto not needed)
    #   - name matching runs in Python on keyed tokens (pg_trgm is unused)
    #   - no exclusion constraints use btree_gist
    # Earlier revisions created all three; requiring unused contrib modules
    # only made the schema harder to install (e.g. on minimal Postgres builds).
    # pgaudit is a deployment choice (custom image + shared_preload_libraries),
    # not something a migration can enable; see README limitations.
    pass


def downgrade() -> None:
    pass
