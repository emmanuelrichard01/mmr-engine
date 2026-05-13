# src/storage/postgres.py
"""
Async PostgreSQL session management with role-based connection pools.

Three separate connection pools enforce least-privilege access:
    - Pipeline: writes to Silver and Gold
    - API: reads all, resolves discrepancies
    - Readonly: dashboard and DuckDB export

References:
    - TDD §7.1: PostgreSQL — Async Session Factory
    - ERD §7: Database Role Permissions
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from src.config import get_settings

log = structlog.get_logger(__name__)


def _build_engine(dsn: str, pool_size: int = 10, max_overflow: int = 20) -> AsyncEngine:
    """Build an async engine with connection pooling and health checks."""
    settings = get_settings()
    return create_async_engine(
        str(dsn),
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=True,     # Verify connection health before checkout
        pool_recycle=3600,      # Recycle connections hourly (prevents stale connections)
        echo=settings.debug,    # SQL logging in debug mode only — never in production
    )


def _build_test_engine(dsn: str) -> AsyncEngine:
    """
    NullPool for test environments.
    Ensures connections are not shared between test cases,
    preventing state leakage between tests.
    """
    return create_async_engine(str(dsn), poolclass=NullPool)


class DatabaseManager:
    """
    Manages separate connection pools per database role.
    The pipeline role writes. The API role reads and resolves.
    The readonly role never writes.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._pipeline_engine = _build_engine(
            settings.postgres_pipeline_dsn,
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_max_overflow,
        )
        self._api_engine = _build_engine(
            settings.postgres_api_dsn,
            pool_size=settings.postgres_pool_size // 2,
        )
        self._readonly_engine = _build_engine(
            settings.postgres_readonly_dsn,
            pool_size=5,
        )

        self.pipeline_session = async_sessionmaker(
            self._pipeline_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.api_session = async_sessionmaker(
            self._api_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self.readonly_session = async_sessionmaker(
            self._readonly_engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )

    async def dispose(self) -> None:
        """Dispose all connection pools gracefully."""
        await self._pipeline_engine.dispose()
        await self._api_engine.dispose()
        await self._readonly_engine.dispose()


# Module-level singleton — initialised once at startup
_db_manager: DatabaseManager | None = None


def get_db_manager() -> DatabaseManager:
    """Get or create the database manager singleton."""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager


@asynccontextmanager
async def pipeline_session() -> AsyncGenerator[AsyncSession, None]:
    """Pipeline session — writes to Silver and Gold, auto-commit/rollback."""
    async with get_db_manager().pipeline_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def api_session() -> AsyncGenerator[AsyncSession, None]:
    """API session — reads + resolution updates, auto-commit/rollback."""
    async with get_db_manager().api_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def readonly_session() -> AsyncGenerator[AsyncSession, None]:
    """Read-only session. Commit is a no-op — included for consistency."""
    async with get_db_manager().readonly_session() as session:
        yield session
