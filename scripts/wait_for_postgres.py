#!/usr/bin/env python3
"""
MMR Engine — Wait for PostgreSQL
Replaces the brittle Python one-liner in the Makefile.
Polls pg_isready until the database is accepting connections or times out.
"""
import subprocess
import sys
import time

TIMEOUT_SECONDS = 60
POLL_INTERVAL   = 2
PG_USER = "postgres"
PG_DB   = "reconciliation"

GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"


def pg_is_ready() -> bool:
    result = subprocess.run(
        [
            "docker", "compose", "exec", "-T", "postgres",
            "pg_isready", "-U", PG_USER, "-d", PG_DB,
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def main():
    print(f"  {YELLOW}⏳{RESET} Waiting for PostgreSQL to be ready", end="", flush=True)

    start = time.time()
    while time.time() - start < TIMEOUT_SECONDS:
        if pg_is_ready():
            elapsed = time.time() - start
            print(f"\r  {GREEN}✓{RESET}  PostgreSQL is ready ({elapsed:.1f}s)              ")
            sys.exit(0)
        print(".", end="", flush=True)
        time.sleep(POLL_INTERVAL)

    print(f"\n  {RED}✗{RESET}  PostgreSQL did not become ready within {TIMEOUT_SECONDS}s")
    print("     Run 'make logs' to see what went wrong.")
    sys.exit(1)


if __name__ == "__main__":
    main()
