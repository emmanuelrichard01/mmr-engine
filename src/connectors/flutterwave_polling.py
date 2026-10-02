# src/connectors/flutterwave_polling.py
"""
Flutterwave REST API polling client.

Serves the same role as the Paystack polling client — webhook fallback
and bulk reconciliation — but adapted for Flutterwave's API conventions.

Key differences from Paystack:
    - Uses Bearer token authentication (not Basic)
    - Transaction reference field is 'tx_ref' (not 'reference')
    - Settlement API structure differs

References:
    - TDD §10.2: Polling Fallback Flow
    - Flutterwave API: https://developer.flutterwave.com/reference
"""

from datetime import datetime
from typing import Any, cast

import httpx
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)

MAX_PAGES = 200  # hard stop per call


class FlutterwaveAPIClient:
    """
    Async Flutterwave REST API client.
    Used for transaction verification, settlement listing,
    and webhook fallback polling.
    """

    BASE_URL = "https://api.flutterwave.com/v3"

    def __init__(self) -> None:
        settings = get_settings()
        self._headers = {
            "Authorization": f"Bearer {settings.flutterwave_secret_key.get_secret_value()}",
            "Content-Type": "application/json",
        }
        self._timeout = 10.0

    async def verify_transaction(self, transaction_id: int) -> dict[str, Any]:
        """
        Verify a single transaction by Flutterwave transaction ID.

        Flutterwave verifies by numeric ID, not by tx_ref.
        To verify by tx_ref, use verify_transaction_by_ref().
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transactions/{transaction_id}/verify",
                headers=self._headers,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "flutterwave.api.transaction_verified",
                transaction_id=transaction_id,
                status=data.get("data", {}).get("status"),
            )
            return cast(dict[str, Any], data["data"])

    async def verify_transaction_by_ref(self, tx_ref: str) -> dict[str, Any]:
        """
        Verify a transaction by merchant's tx_ref.
        Uses Flutterwave's transaction query endpoint.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transactions/verify_by_reference",
                headers=self._headers,
                params={"tx_ref": tx_ref},
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "flutterwave.api.transaction_verified_by_ref",
                tx_ref=tx_ref,
                status=data.get("data", {}).get("status"),
            )
            return cast(dict[str, Any], data["data"])

    async def list_transactions(
        self,
        from_date: str | None = None,
        to_date: str | None = None,
        status: str = "successful",
        page: int = 1,
    ) -> list[dict[str, Any]]:
        """
        List transactions in a date range.

        Date format: YYYY-MM-DD
        Status values: successful, failed, pending
        """
        params: dict[str, Any] = {
            "status": status,
            "page": page,
        }
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transactions",
                headers=self._headers,
                params=params,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "flutterwave.api.transactions_listed",
                count=len(data.get("data", [])),
                page=page,
            )
            return cast(list[dict[str, Any]], data.get("data", []))

    async def list_settlements(
        self,
        from_date: str | None = None,
        to_date: str | None = None,
        page: int = 1,
    ) -> list[dict[str, Any]]:
        """
        List settlement records.

        Flutterwave settlements include:
            - Settlement ID
            - Total amount
            - Number of transactions
            - Settlement date
            - Bank details
        """
        params: dict[str, Any] = {"page": page}
        if from_date:
            params["from"] = from_date
        if to_date:
            params["to"] = to_date

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/settlements",
                headers=self._headers,
                params=params,
                timeout=self._timeout,
            )
            response.raise_for_status()
            data = response.json()

            log.info(
                "flutterwave.api.settlements_listed",
                count=len(data.get("data", {}).get("data", [])),
            )
            return cast(list[dict[str, Any]], data.get("data", {}).get("data", []))

    async def list_all_successful(self, since: datetime, until: datetime) -> list[dict[str, Any]]:
        """
        Every successful transaction created in [since, until].

        The API filters by calendar date (YYYY-MM-DD) and paginates with
        meta.page_info, so pages are walked until total_pages and results
        are trimmed to the exact window client-side.
        """
        results: list[dict[str, Any]] = []
        page = 1
        while page <= MAX_PAGES:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.BASE_URL}/transactions",
                    headers=self._headers,
                    params={
                        "status": "successful",
                        "from": since.strftime("%Y-%m-%d"),
                        "to": until.strftime("%Y-%m-%d"),
                        "page": page,
                    },
                    timeout=self._timeout,
                )
            response.raise_for_status()
            body = response.json()
            for tx in body.get("data") or []:
                created = tx.get("created_at")
                if not created:
                    continue
                created_at = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
                if since <= created_at <= until:
                    results.append(tx)
            total_pages = int(((body.get("meta") or {}).get("page_info") or {}).get("total_pages") or 1)
            if page >= total_pages:
                return results
            page += 1
        log.warning("flutterwave.api.page_limit_reached", pages=MAX_PAGES)
        return results
