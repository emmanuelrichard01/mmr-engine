# alembic/env.py
"""
Alembic environment configuration.

Reads the database DSN from ALEMBIC_DATABASE_URL (owner/superuser), which
DDL, CREATE EXTENSION and GRANT require. There is deliberately no fallback
to an application role.
"""

import asyncio
import os
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Alembic Config object
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Migrations run as the database owner (ALEMBIC_DATABASE_URL), never as an
# application role: the app roles must not own tables, or GRANT/REVOKE and
# the append-only triggers' privilege model would not apply to them.
alembic_url = os.environ.get("ALEMBIC_DATABASE_URL")
if not alembic_url:
    raise RuntimeError("ALEMBIC_DATABASE_URL must be set to an owner/superuser DSN to run migrations")
config.set_main_option("sqlalchemy.url", alembic_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — generates SQL without connecting."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=None,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """Run migrations against a live connection."""
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations in async mode using asyncpg."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connects to database."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
