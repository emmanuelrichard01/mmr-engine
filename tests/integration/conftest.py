# tests/integration/conftest.py
"""
Shared fixtures for integration tests.

Provides a TestClient with mocked database connections
so integration tests can validate API behavior without
requiring a running PostgreSQL instance.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def client():
    """
    Create a TestClient for the FastAPI app with mocked DB.

    The database manager is mocked to avoid real DB connections,
    allowing tests to focus on route registration, middleware,
    and response structure.
    """
    from fastapi.testclient import TestClient

    with patch("src.storage.postgres.get_db_manager") as mock_db:
        mock_manager = MagicMock()
        mock_db.return_value = mock_manager

        # Mock the session context managers
        mock_session = AsyncMock()
        mock_manager.pipeline_session.return_value.__aenter__ = AsyncMock(
            return_value=mock_session
        )
        mock_manager.api_session.return_value.__aenter__ = AsyncMock(
            return_value=mock_session
        )
        mock_manager.readonly_session.return_value.__aenter__ = AsyncMock(
            return_value=mock_session
        )

        from src.api.main import app
        with TestClient(app) as c:
            yield c
