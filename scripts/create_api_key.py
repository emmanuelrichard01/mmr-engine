"""
Issue an API key.

Generates a random key, stores only its SHA-256 hash in system_api_keys, and
prints the raw key once. Run as the database owner, since application roles
cannot create keys:

    python scripts/create_api_key.py --name ops-dashboard --scope read --scope write \
        --dsn postgresql://postgres:...@localhost:5432/reconciliation

    # inside the compose stack:
    docker compose run --rm migrations python scripts/create_api_key.py --name dashboard --scope write

Scopes: read (readonly), write (analyst: can resolve discrepancies), admin.
"""

import argparse
import asyncio
import hashlib
import os
import secrets
import sys
from datetime import UTC, datetime, timedelta

import asyncpg

VALID_SCOPES = ("read", "write", "admin")


async def create(dsn: str, name: str, scopes: list[str], expires_in_days: int | None) -> str:
    raw = "mmr_" + secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(days=expires_in_days) if expires_in_days else None
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(
            """
            INSERT INTO system_api_keys (key_hash, key_prefix, client_name, scopes, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            """,
            hashlib.sha256(raw.encode()).hexdigest(),
            raw[:8],
            name,
            sorted(set(scopes) | {"read"}),
            expires_at,
        )
    finally:
        await conn.close()
    return raw


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", required=True, help="Who/what uses this key")
    parser.add_argument("--scope", action="append", choices=VALID_SCOPES, default=[], help="Repeatable")
    parser.add_argument("--expires-in-days", type=int, default=None)
    parser.add_argument(
        "--dsn",
        default=os.environ.get("ALEMBIC_DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://"),
        help="Owner DSN (defaults to ALEMBIC_DATABASE_URL)",
    )
    args = parser.parse_args()
    if not args.dsn:
        sys.exit("Provide --dsn or set ALEMBIC_DATABASE_URL")

    raw = asyncio.run(create(args.dsn, args.name, args.scope, args.expires_in_days))
    print("API key (shown once, store it in a secret manager):")
    print(raw)


if __name__ == "__main__":
    main()
