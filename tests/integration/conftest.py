# tests/integration/conftest.py
"""
Real-PostgreSQL fixtures for `@pytest.mark.db` tests.

Database source, in order:
    1. MMR_TEST_DATABASE_URL: a superuser DSN (CI uses a postgres:16 service)
    2. an embedded PostgreSQL 16 via `pgserver` (local runs, no Docker needed)

A fresh database is created per test session and migrated to head with
Alembic, so these tests exercise the real migrations, constraints and
triggers. Nothing here is mocked.
"""

import asyncio
import os
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
TEST_DB = "mmr_test"


def _admin_url() -> str:
    url = os.environ.get("MMR_TEST_DATABASE_URL")
    if url:
        return url.replace("postgresql+asyncpg://", "postgresql://")
    try:
        import pgserver
    except ImportError:  # pragma: no cover - environment dependent
        pytest.skip("No MMR_TEST_DATABASE_URL and pgserver not installed")
    server = pgserver.get_server(Path(tempfile.gettempdir()) / "mmr_pgserver", cleanup_mode="stop")
    return str(server.get_uri())


def _with_db(url: str, db: str) -> str:
    parts = urlsplit(url)
    return urlunsplit(parts._replace(path=f"/{db}"))


async def _recreate_database(admin_url: str) -> None:
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{TEST_DB}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def migrated_db_url() -> Iterator[str]:
    """asyncpg-style DSN of a freshly migrated test database (superuser)."""
    admin = _admin_url()
    asyncio.run(_recreate_database(admin))
    db_url = _with_db(admin, TEST_DB)

    from alembic.config import Config

    from alembic import command

    cfg = Config(str(REPO_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(REPO_ROOT / "alembic"))
    previous = os.environ.get("ALEMBIC_DATABASE_URL")
    os.environ["ALEMBIC_DATABASE_URL"] = db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    try:
        command.upgrade(cfg, "head")
    finally:
        if previous is None:
            os.environ.pop("ALEMBIC_DATABASE_URL", None)
        else:
            os.environ["ALEMBIC_DATABASE_URL"] = previous
    yield db_url


@pytest.fixture
def app_db(migrated_db_url: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """Point every application DSN at the test database and reset pools."""
    sa_url = migrated_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    for var in ("POSTGRES_PIPELINE_DSN", "POSTGRES_API_DSN", "POSTGRES_READONLY_DSN"):
        monkeypatch.setenv(var, sa_url)
    from src.config import get_settings
    from src.storage import postgres

    get_settings.cache_clear()
    postgres._db_manager = None
    yield migrated_db_url


@pytest.fixture
async def conn(app_db: str) -> AsyncIterator[asyncpg.Connection]:
    """A raw superuser connection for arranging and asserting state."""
    c = await asyncpg.connect(app_db)
    try:
        yield c
    finally:
        await c.close()


@pytest.fixture(autouse=True)
async def _dispose_pools() -> AsyncIterator[None]:
    """asyncpg pools are bound to the event loop that created them."""
    yield
    from src.storage import postgres

    if postgres._db_manager is not None:
        await postgres._db_manager.dispose()
        postgres._db_manager = None
