# src/engine/fx.py
"""
FX rate capture and conversion engine.

Manages the point-in-time FX rate snapshots used to normalise all
foreign-currency transactions to NGN.

Rate convention: 1 NGN = {rate} {foreign_currency}
    Example: 1 NGN = 0.00063291 USD (i.e., 1 USD ≈ 1,580 NGN)
    Convert: amount_ngn = amount_foreign / rate

Supported pairs: NGN/USD, NGN/GBP, NGN/EUR, NGN/KES

The FX engine maintains a "current rate" via partial unique index
(currency_pair WHERE valid_until IS NULL). Only one current rate
exists per pair at any time.

References:
    - TDD §9.3: FX Rate Engine
    - ERD §6.5: silver_fx_rate_snapshots
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional
from uuid import UUID

import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import get_settings

log = structlog.get_logger(__name__)

SUPPORTED_PAIRS = ["NGN/USD", "NGN/GBP", "NGN/EUR", "NGN/KES"]


async def capture_fx_rates(session: AsyncSession) -> list[dict]:
    """
    Fetch current FX rates for all supported pairs from the configured provider.
    Writes new snapshot records and marks previous current rates as expired.
    Called by the FX capture task on its configured interval.

    Returns list of snapshot metadata created.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    created_snapshots = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for pair in SUPPORTED_PAIRS:
            base, quote = pair.split("/")
            try:
                response = await client.get(
                    f"{settings.fx_provider_base_url}"
                    f"/{settings.fx_provider_api_key}"
                    f"/pair/{base}/{quote}"
                )
                response.raise_for_status()
                data = response.json()

                rate = Decimal(str(data["conversion_rate"]))

                # Expire the previous current rate for this pair
                await session.execute(
                    text("""
                        UPDATE silver_fx_rate_snapshots
                        SET valid_until = :now
                        WHERE currency_pair = :pair
                          AND valid_until IS NULL
                    """),
                    {"now": now, "pair": pair},
                )

                # Insert new current rate
                result = await session.execute(
                    text("""
                        INSERT INTO silver_fx_rate_snapshots
                            (currency_pair, rate, source_provider,
                             captured_at, valid_from)
                        VALUES
                            (:pair, :rate, :provider, :now, :now)
                        RETURNING id
                    """),
                    {
                        "pair": pair,
                        "rate": rate,
                        "provider": "exchangerate-api",
                        "now": now,
                    },
                )
                snapshot_id = result.scalar_one()
                created_snapshots.append({
                    "pair": pair,
                    "rate": float(rate),
                    "id": str(snapshot_id),
                })
                log.info("fx.rate_captured", pair=pair, rate=float(rate))

            except (httpx.HTTPError, KeyError) as e:
                log.error("fx.capture_failed", pair=pair, error=str(e))
                # Do not raise — a failed rate capture for one pair
                # should not block other pairs or the ingestion pipeline.
                # An alert is raised if the last captured rate is > 2 hours old.

    return created_snapshots


async def get_fx_rate_at(
    session: AsyncSession,
    currency_pair: str,
    at_time: datetime,
) -> Optional[tuple[UUID, Decimal]]:
    """
    Point-in-time FX rate lookup.
    Returns (snapshot_id, rate) for the most recent snapshot
    captured at or before at_time.
    Returns None if no rate exists for this pair before at_time.
    """
    result = await session.execute(
        text("""
            SELECT id, rate
            FROM silver_fx_rate_snapshots
            WHERE currency_pair = :pair
              AND captured_at <= :at_time
            ORDER BY captured_at DESC
            LIMIT 1
        """),
        {"pair": currency_pair, "at_time": at_time},
    )
    row = result.one_or_none()
    if row is None:
        log.warning(
            "fx.no_rate_found",
            pair=currency_pair,
            at_time=at_time.isoformat(),
        )
        return None
    return row.id, Decimal(str(row.rate))


async def get_current_rate(
    session: AsyncSession,
    currency_pair: str,
) -> Optional[tuple[UUID, Decimal]]:
    """
    Get the current active rate for a currency pair.
    Current = valid_until IS NULL (partial unique index enforced).
    """
    result = await session.execute(
        text("""
            SELECT id, rate
            FROM silver_fx_rate_snapshots
            WHERE currency_pair = :pair
              AND valid_until IS NULL
        """),
        {"pair": currency_pair},
    )
    row = result.one_or_none()
    if row is None:
        return None
    return row.id, Decimal(str(row.rate))


def convert_to_ngn(
    amount_raw: Decimal,
    currency_raw: str,
    fx_rate: Decimal,
) -> Decimal:
    """
    Convert a foreign currency amount to NGN.

    Rate convention: 1 NGN = {rate} {quote_currency}
    So: amount_ngn = amount_foreign / rate

    Example:
        amount_raw = 31.645 (USD)
        fx_rate    = 0.00063291 (1 NGN = 0.00063291 USD)
        amount_ngn = 31.645 / 0.00063291 = 50,000 NGN
    """
    if currency_raw.upper() == "NGN":
        return amount_raw
    if fx_rate <= 0:
        raise ValueError(f"FX rate must be positive, got {fx_rate}")
    return (amount_raw / fx_rate).quantize(Decimal("0.000001"))
