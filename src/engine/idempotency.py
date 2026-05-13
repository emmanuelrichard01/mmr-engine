# src/engine/idempotency.py
"""
Idempotency key generation and registry lookup.

The idempotency key is the foundation of exactly-once processing semantics.
Every webhook event generates a key: {psp_name}:{psp_transaction_ref}:{event_type}

The key is checked atomically against silver_idempotency_keys using
INSERT ... ON CONFLICT DO UPDATE with RETURNING — making the check-and-register
a single atomic operation with no race condition window.

References:
    - TDD §9.1: Idempotency Engine
    - Data Dictionary XR-005: Idempotency Key
    - ERD §6.5: silver_idempotency_keys
"""
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog

log = structlog.get_logger(__name__)


def build_idempotency_key(
    psp_name: str,
    psp_transaction_ref: str,
    event_type: str,
) -> str:
    """
    Canonical idempotency key format.
    Must match the format documented in the Data Dictionary (XR-005).
    Format: {psp_name}:{psp_transaction_ref}:{event_type}
    Example: paystack:T_abc123xyz:charge.success

    All components are lowercased (except ref) for normalisation.
    A difference in case between two identical events must not produce
    two different keys.
    """
    return ":".join([
        psp_name.lower().strip(),
        psp_transaction_ref.strip(),
        event_type.lower().strip(),
    ])


async def check_and_register_idempotency_key(
    session: AsyncSession,
    idempotency_key: str,
) -> tuple[bool, int]:
    """
    Atomically check and register an idempotency key.

    Returns:
        (is_new, occurrence_count)
        is_new = True: first time this key is seen — proceed with processing
        is_new = False: duplicate — skip processing, return early

    Uses INSERT ... ON CONFLICT DO UPDATE with RETURNING to make
    the check-and-increment atomic. No separate SELECT + INSERT
    which would have a race condition under concurrent requests.
    """
    now = datetime.now(timezone.utc)

    result = await session.execute(
        text("""
            INSERT INTO silver_idempotency_keys
                (key, first_seen_at, occurrence_count, last_seen_at)
            VALUES
                (:key, :now, 1, :now)
            ON CONFLICT (key) DO UPDATE SET
                occurrence_count = silver_idempotency_keys.occurrence_count + 1,
                last_seen_at = :now
            RETURNING occurrence_count, (xmax = 0) AS is_insert
                -- xmax = 0 means this was an INSERT (not UPDATE)
                -- xmax != 0 means this was an UPDATE (conflict — duplicate)
        """),
        {"key": idempotency_key, "now": now},
    )
    row = result.one()
    occurrence_count: int = row.occurrence_count
    is_new: bool = row.is_insert

    if not is_new:
        log.warning(
            "idempotency.duplicate_detected",
            idempotency_key=idempotency_key,
            occurrence_count=occurrence_count,
        )
        if occurrence_count > 5:
            log.error(
                "idempotency.excessive_duplicates",
                idempotency_key=idempotency_key,
                occurrence_count=occurrence_count,
                message="PSP may have webhook retry misconfiguration",
            )

    return is_new, occurrence_count


async def link_idempotency_key_to_transaction(
    session: AsyncSession,
    idempotency_key: str,
    canonical_tx_id: str,
) -> None:
    """
    Link an idempotency key to its canonical transaction after Silver write.
    This enables tracing from key → transaction for debugging.
    """
    await session.execute(
        text("""
            UPDATE silver_idempotency_keys
            SET canonical_tx_id = :tx_id
            WHERE key = :key
        """),
        {"key": idempotency_key, "tx_id": canonical_tx_id},
    )
