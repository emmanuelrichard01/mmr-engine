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
from typing import Any, Optional

import httpx
import structlog

from src.config import get_settings

log = structlog.get_logger(__name__)


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
            "Authorization": f"Bearer {settings.flutterwave_secret_key}",
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
            return data["data"]

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
            return data["data"]

    async def list_transactions(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
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
            return data.get("data", [])

    async def list_settlements(
        self,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
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
            return data.get("data", {}).get("data", [])

    async def fetch_missing_transactions(
        self,
        known_tx_refs: set[str],
        from_date: str,
        to_date: str,
    ) -> list[dict[str, Any]]:
        """
        Gap detection: find transactions in Flutterwave's records
        that we don't have in our system.
        """
        missing = []
        page = 1

        while True:
            transactions = await self.list_transactions(
                from_date=from_date,
                to_date=to_date,
                page=page,
            )

            if not transactions:
                break

            for tx in transactions:
                tx_ref = tx.get("tx_ref", "")
                if tx_ref and tx_ref not in known_tx_refs:
                    missing.append(tx)

            if len(transactions) < 20:  # Flutterwave default page size
                break
            page += 1

        if missing:
            log.warning(
                "flutterwave.api.missing_transactions_found",
                count=len(missing),
                from_date=from_date,
                to_date=to_date,
            )

        return missing
