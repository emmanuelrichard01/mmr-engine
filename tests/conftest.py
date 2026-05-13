# tests/conftest.py
"""
Shared pytest fixtures for the Reconciliation Engine test suite.

Provides:
    - Environment variable mocking for tests that import src.config
    - Reusable PSP payload fixtures
    - Common test data factories
"""
import os
from unittest.mock import patch

import pytest


@pytest.fixture(autouse=True)
def mock_env_vars(monkeypatch):
    """
    Set required environment variables for all tests.
    This prevents Settings validation errors during import.
    """
    env_vars = {
        "ENVIRONMENT": "development",
        "POSTGRES_PIPELINE_DSN": "postgresql+asyncpg://test:test@localhost:5432/test",
        "POSTGRES_API_DSN": "postgresql+asyncpg://test:test@localhost:5432/test",
        "POSTGRES_READONLY_DSN": "postgresql+asyncpg://test:test@localhost:5432/test",
        "MINIO_ACCESS_KEY": "testminio",
        "MINIO_SECRET_KEY": "testminiosecret",
        "PAYSTACK_SECRET_KEY": "sk_test_dummy",
        "FLUTTERWAVE_SECRET_KEY": "FLWSECK_TEST-dummy",
        "FLUTTERWAVE_SECRET_HASH": "test_flw_hash",
        "FX_PROVIDER_API_KEY": "test_fx_key",
        "KAFKA_BOOTSTRAP_SERVERS": "localhost:9092",
    }
    for key, value in env_vars.items():
        monkeypatch.setenv(key, value)

    # Clear the lru_cache so each test gets fresh settings
    from src.config import get_settings
    get_settings.cache_clear()


@pytest.fixture
def paystack_charge_payload():
    """Standard Paystack charge.success webhook payload."""
    return {
        "event": "charge.success",
        "data": {
            "id": 123456,
            "reference": "T_abc123xyz",
            "amount": 5000000,
            "currency": "NGN",
            "status": "success",
            "paid_at": "2026-05-01T08:12:00.000Z",
            "channel": "card",
            "fees": 145000,
            "authorization": {
                "account_number": "0123456789",
                "account_name": "Chioma Okonkwo",
                "bank_code": "057",
                "bank": "Zenith Bank",
            },
            "customer": {
                "email": "chioma@example.com",
            },
            "metadata": {
                "custom_fields": [{"value": "Monthly subscription"}],
            },
        },
    }


@pytest.fixture
def flutterwave_charge_payload():
    """Standard Flutterwave charge.completed webhook payload."""
    return {
        "event": "charge.completed",
        "data": {
            "id": 789012,
            "tx_ref": "FLW-TXN-99887",
            "flw_ref": "FLW-MOCK-abc123",
            "amount": 50000,
            "currency": "NGN",
            "status": "successful",
            "created_at": "2026-05-01T08:12:00.000Z",
            "customer": {
                "name": "Ade Johnson",
                "email": "ade@example.com",
            },
            "account": {
                "account_number": "9876543210",
                "account_name": "ADE JOHNSON",
                "bank_code": "058",
                "bank": "GTBank",
            },
            "app_fee": 200,
            "merchant_fee": 1250,
            "narration": "Payment for order #1234",
        },
    }
