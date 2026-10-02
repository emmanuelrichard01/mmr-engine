# src/connectors/paystack_polling.py
"""
Paystack REST API polling client.

This is the webhook fallback mechanism. When webhooks are not received
within the polling window (default: 15 minutes), this client fetches
transaction data directly from the Paystack API.

Also used for:
    - Bulk reconciliation (fetching historical transactions)
    - Settlement batch verification
    - Gap detection (comparing webhook-received vs API-listed transactions)

Sandbox vs Production:
    - Same base URL (https://api.paystack.co)
    - Same endpoints, same response format
    - Sandbox uses sk_test_* keys, production uses sk_live_* keys
    - No business registration required for sandbox access

References:
    - TDD §10.2: Polling Fallback Flow
    - Paystack API: https://paystack.com/docs/api
"""

from datetime import datetime
from typing import Any, cast

import httpx
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)

MAX_PAGES = 200  # hard stop per call


class PaystackAPIClient:
    """
    Async Paystack REST API client.
    Used for transaction verification, settlement listing,
    and webhook fallback polling.
    """

    BASE_URL = "https://api.paystack.co"

    def __init__(self) -> None:
        settings = get_settings()
        self._headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key.get_secret_value()}",
            "Content-Type": "application/json",
        }
        self._timeout = 10.0

    async def verify_transaction(self, reference: str) -> dict[str, Any]:
        """
        Verify a single transaction by reference.

        Used when:
            1. Webhook was not received within the polling window
            2. Webhook arrived but payload was malformed
            3. Manual reconciliation trigger

        Returns the full transaction data from Paystack's perspective.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transaction/verify/{reference}",
                headers=self._headers,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "paystack.api.transaction_verified",
                reference=reference,
                status=data.get("data", {}).get("status"),
            )
            return cast(dict[str, Any], data["data"])

    async def list_transactions(
        self,
        from_date: str | None = None,
        to_date: str | None = None,
        status: str = "success",
        per_page: int = 50,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        """
        List transactions in a date range.

        Used for:
            - Bulk reconciliation and gap detection
            - Comparing webhook-received vs API-listed transactions
            - Historical data backfill

        Date format: ISO 8601 (2026-05-01T00:00:00.000Z)
        """
        params: dict[str, Any] = {
            "status": status,
            "perPage": per_page,
            "page": page,
        }
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transaction",
                headers=self._headers,
                params=params,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "paystack.api.transactions_listed",
                count=len(data.get("data", [])),
                page=page,
                status=status,
            )
            return cast(list[dict[str, Any]], data["data"])

    async def list_settlements(
        self,
        from_date: str | None = None,
        to_date: str | None = None,
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        """
        List settlement batches.

        Each settlement batch represents the actual money movement
        from Paystack to the merchant's bank account. This is the
        key data point for settlement reconciliation.

        Settlement batches include:
            - Total amount settled
            - Number of transactions in the batch
            - Settlement date
            - Bank account credited
        """
        params: dict[str, Any] = {"perPage": per_page}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/settlement",
                headers=self._headers,
                params=params,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "paystack.api.settlements_listed",
                count=len(data.get("data", [])),
            )
            return cast(list[dict[str, Any]], data["data"])

    async def list_settlement_transactions(
        self,
        settlement_id: int,
        per_page: int = 50,
    ) -> list[dict[str, Any]]:
        """
        List transactions within a specific settlement batch.

        This is the link between "money Paystack says it sent"
        and "individual transactions that make up that money."
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/settlement/{settlement_id}/transactions",
                headers=self._headers,
                params={"perPage": per_page},
                timeout=self._timeout,
            )
            response.raise_for_status()
            return cast(list[dict[str, Any]], response.json()["data"])

    async def list_all_successful(self, since: datetime, until: datetime) -> list[dict[str, Any]]:
        """Every successful transaction in [since, until], across all pages."""
        page_size = 100
        results: list[dict[str, Any]] = []
        for page in range(1, MAX_PAGES + 1):
            batch = await self.list_transactions(
                from_date=since.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                to_date=until.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                status="success",
                per_page=page_size,
                page=page,
            )
            results.extend(batch)
            if len(batch) < page_size:
                return results
        log.warning("paystack.api.page_limit_reached", pages=MAX_PAGES)
        return results
