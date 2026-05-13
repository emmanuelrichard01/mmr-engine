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
from typing import Any, Optional

import httpx
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)


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
            "Authorization": f"Bearer {settings.paystack_secret_key}",
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
            return data["data"]

    async def list_transactions(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
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
            return data["data"]

    async def list_settlements(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
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
            return data["data"]

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
            return response.json()["data"]

    async def fetch_missing_transactions(
        self,
        known_references: set[str],
        from_date: str,
        to_date: str,
    ) -> list[dict[str, Any]]:
        """
        Gap detection: find transactions in Paystack's records
        that we don't have in our system (missed webhooks).

        Compares API-listed transactions against our known references.
        Returns transactions present in Paystack but missing locally.
        """
        missing = []
        page = 1

        while True:
            transactions = await self.list_transactions(
                from_date=from_date,
                to_date=to_date,
                per_page=100,
                page=page,
            )

            if not transactions:
                break

            for tx in transactions:
                ref = tx.get("reference", "")
                if ref and ref not in known_references:
                    missing.append(tx)

            if len(transactions) < 100:
                break
            page += 1

        if missing:
            log.warning(
                "paystack.api.missing_transactions_found",
                count=len(missing),
                from_date=from_date,
                to_date=to_date,
            )

        return missing
