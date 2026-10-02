# src/engine/settlement.py
"""
Expected settlement time calculator.

Uses silver_psp_settlement_windows to compute when a transaction
should settle based on:
    - PSP name
    - Transaction type (credit/debit)
    - Account tier (standard/growth/enterprise)
    - Effective date range
    - Business vs calendar day logic
    - Intraday cutoff time (WAT timezone)

References:
    - TDD §9.4 (referenced by normaliser)
    - ERD §6.5: silver_psp_settlement_windows
    - Data Dictionary: Settlement SLA Fields
"""

from datetime import UTC, datetime, timedelta, timezone

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

log = structlog.get_logger(__name__)

# WAT (West Africa Time) = UTC+1
WAT = timezone(timedelta(hours=1))


async def compute_expected_settlement(
    session: AsyncSession,
    psp_name: str,
    transaction_type: str,
    initiated_at: datetime,
    account_tier: str = "standard",
) -> datetime | None:
    """
    Compute expected settlement time for a transaction.

    Logic:
        1. Look up active settlement window for PSP/type/tier
        2. If business days only, skip weekends
        3. If cutoff_time_wat is set and initiated_at is after cutoff,
           add one extra business day

    Returns None if no settlement window is configured for this PSP/type/tier.
    """
    result = await session.execute(
        text("""
            SELECT settlement_lag_hours, settlement_days, cutoff_time_wat
            FROM silver_psp_settlement_windows
            WHERE psp_name = :psp_name
              AND transaction_type = :tx_type
              AND account_tier = :tier
              AND effective_from <= :tx_date
              AND (effective_until IS NULL OR effective_until > :tx_date)
            ORDER BY effective_from DESC
            LIMIT 1
        """),
        {
            "psp_name": psp_name,
            "tx_type": transaction_type,
            "tier": account_tier,
            "tx_date": initiated_at.date(),
        },
    )
    row = result.one_or_none()

    if row is None:
        log.warning(
            "settlement.no_window_found",
            psp_name=psp_name,
            transaction_type=transaction_type,
            account_tier=account_tier,
        )
        return None

    lag_hours = float(row.settlement_lag_hours)
    settlement_days = row.settlement_days
    cutoff_time_wat = row.cutoff_time_wat

    # Cutoff is a WAT wall-clock time: initiated after it → next cycle.
    initiated_wat = initiated_at.astimezone(WAT)
    cutoff_extra_hours = 0.0
    if cutoff_time_wat is not None and initiated_wat.time() > cutoff_time_wat:
        cutoff_extra_hours = 24.0
        log.debug(
            "settlement.after_cutoff",
            psp_name=psp_name,
            initiated_wat=initiated_wat.isoformat(),
            cutoff=str(cutoff_time_wat),
        )

    expected_at = initiated_at + timedelta(hours=lag_hours + cutoff_extra_hours)

    if settlement_days == "business":
        expected_at = _skip_weekends(expected_at)

    return expected_at


def _skip_weekends(dt: datetime) -> datetime:
    """
    If dt falls on a Saturday or Sunday in WAT, move it to the following
    Monday at 09:00 WAT. Public holidays are not modelled (see README
    limitations).
    """
    local = dt.astimezone(WAT)
    weekday = local.weekday()
    if weekday < 5:
        return dt
    days_ahead = 7 - weekday  # Saturday (5) → 2, Sunday (6) → 1
    monday = (local + timedelta(days=days_ahead)).replace(hour=9, minute=0, second=0, microsecond=0)
    return monday.astimezone(dt.tzinfo or UTC)
