#!/usr/bin/env python3
"""
MMR Engine — full local demo.

Starts the stack, generates synthetic data, replays it through the real
webhook endpoints, runs matching, and verifies every layer actually holds
data. Exits non-zero if any verification fails. All data is synthetic.

Usage:
    python scripts/demo_full.py
    python scripts/demo_full.py --days 30 --webhooks 100 --monitoring

Every step is verified before the next begins.
Final output shows actual DB record counts, not estimates.
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime
from decimal import Decimal
from pathlib import Path

# ── ANSI ──────────────────────────────────────────────────────────────────────

GREEN   = "\033[92m"
RED     = "\033[91m"
YELLOW  = "\033[93m"
BLUE    = "\033[94m"
CYAN    = "\033[96m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
RESET   = "\033[0m"

# ── Helpers ───────────────────────────────────────────────────────────────────

def header(msg: str):
    print(f"\n{BOLD}{BLUE}{'─' * 56}{RESET}")
    print(f"{BOLD}{BLUE}  {msg}{RESET}")
    print(f"{BOLD}{BLUE}{'─' * 56}{RESET}")

def step(n: int, total: int, msg: str):
    print(f"\n  {CYAN}{BOLD}[{n}/{total}]{RESET} {msg}")

def ok(msg: str):    print(f"         {GREEN}✓{RESET}  {msg}")
def fail(msg: str):  print(f"         {RED}✗{RESET}  {msg}")
def info(msg: str):  print(f"         {DIM}·{RESET}  {msg}")

def run(cmd: list[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    result = subprocess.run(cmd, capture_output=capture, text=True)
    if check and result.returncode != 0:
        stderr = result.stderr.strip() if capture else ""
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{stderr}")
    return result


def pg_query(sql: str) -> str:
    result = run(
        ["docker", "compose", "exec", "-T", "postgres",
         "psql", "-U", "postgres", "-d", "reconciliation", "-t", "-c", sql],
        check=False, capture=True
    )
    return result.stdout.strip()


def table_count(table: str) -> int:
    raw = pg_query(f"SELECT count(*) FROM {table};")
    try:
        return int(raw.split("\n")[0].strip())
    except (ValueError, IndexError):
        return -1


def wait_for_postgres(timeout: int = 90) -> bool:
    info("Waiting for PostgreSQL...")
    start = time.time()
    while time.time() - start < timeout:
        result = run(
            ["docker", "compose", "exec", "-T", "postgres",
             "pg_isready", "-U", "postgres", "-d", "reconciliation"],
            check=False, capture=True
        )
        if result.returncode == 0:
            return True
        time.sleep(2)
        print(".", end="", flush=True)
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def load_fx_snapshots(path: Path) -> None:
    """
    Load the generator's FX history into silver_fx_rate_snapshots so non-NGN
    events convert at a point-in-time rate (as FX capture would in production).
    Each snapshot is valid until the next one for its pair; the last is current.
    """
    snapshots = json.loads(path.read_text(encoding="utf-8"))
    by_pair: dict[str, list[dict]] = {}
    for snap in snapshots:
        by_pair.setdefault(snap["currency_pair"], []).append(snap)
    values = []
    for pair, snaps in by_pair.items():
        snaps.sort(key=lambda s: s["captured_at"])
        for i, snap in enumerate(snaps):
            until = f"'{snaps[i + 1]['captured_at']}'" if i + 1 < len(snaps) else "NULL"
            values.append(
                f"('{pair}', {Decimal(snap['rate'])}, 'demo-synthetic', "
                f"'{snap['captured_at']}', '{snap['captured_at']}', {until})"
            )
    sql = (
        "BEGIN; DELETE FROM silver_fx_rate_snapshots WHERE source_provider = 'demo-synthetic' "
        "AND id NOT IN (SELECT fx_rate_snapshot_id FROM silver_canonical_transactions "
        "WHERE fx_rate_snapshot_id IS NOT NULL); "
        "UPDATE silver_fx_rate_snapshots SET valid_until = NOW() WHERE valid_until IS NULL; "
        "INSERT INTO silver_fx_rate_snapshots (currency_pair, rate, source_provider, captured_at, valid_from, valid_until) "
        f"VALUES {', '.join(values)}; COMMIT;"
    )
    result = run(["docker", "compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1",
                  "-U", "postgres", "-d", "reconciliation", "-c", sql], check=False, capture=True)
    if result.returncode != 0:
        raise RuntimeError(f"Loading FX snapshots failed: {result.stderr.strip()[:300]}")


def main():
    parser = argparse.ArgumentParser(description="MMR Engine full local demo")
    parser.add_argument("--days", type=int, default=7, help="Days of synthetic data to generate and replay")
    parser.add_argument("--monitoring", action="store_true", help="Also start Prometheus + Grafana")
    args = parser.parse_args()

    start_time = datetime.now()
    total_steps = 6
    print(f"\n{BOLD}  MMR Engine — full demo (synthetic data){RESET}")
    print(f"  {DIM}{args.days} days · monitoring={args.monitoring}{RESET}")

    try:
        step(1, total_steps, "Starting services (migrations run automatically)")
        cmd = ["docker", "compose", "-f", "docker-compose.yml"]
        if args.monitoring:
            cmd += ["-f", "docker-compose.monitoring.yml"]
        run(cmd + ["up", "-d", "--build", "--wait"], capture=True)
        ok("Services healthy")

        step(2, total_steps, f"Generating {args.days} days of synthetic events")
        run([sys.executable, "scripts/generate_demo_data.py", "--days", str(args.days)])
        ok("Synthetic events written to scripts/demo_data/")

        load_fx_snapshots(Path("scripts/demo_data/fx_rates.json"))
        ok("FX snapshots loaded (synthetic rates for the demo period)")

        step(3, total_steps, "Replaying events through the signed webhook endpoints")
        run([sys.executable, "scripts/replay_demo_data.py", "--delay", "0"])
        ok("Replay finished")

        step(4, total_steps, "Waiting for the consumer to drain Kafka into Silver")
        previous, stable_for = -1, 0
        for _ in range(60):
            current = table_count("silver_canonical_transactions")
            stable_for = stable_for + 1 if current == previous and current > 0 else 0
            if stable_for >= 3:
                break
            previous = current
            time.sleep(2)
        info(f"Silver rows: {current:,}")

        step(5, total_steps, "Running the matching flow")
        run(["docker", "compose", "exec", "-T", "scheduler", "python", "-c",
             "import asyncio; from src.flows.matching_flow import silver_to_gold_matching_flow; "
             "print(asyncio.run(silver_to_gold_matching_flow()))"], capture=True)
        ok("Matching complete")

        step(6, total_steps, "Verifying every layer holds data")
        counts = {t: table_count(t) for t in (
            "bronze_ingestion_log", "silver_canonical_transactions",
            "gold_reconciliation_pairs", "gold_matched_transactions", "gold_discrepancies")}
        failures = [t for t in ("bronze_ingestion_log", "silver_canonical_transactions", "gold_reconciliation_pairs")
                    if counts[t] <= 0]
        for table, n in counts.items():
            (ok if n > 0 else info)(f"{table}: {n:,}" if n >= 0 else f"{table}: query failed")
        if failures:
            fail(f"Empty or unreadable: {', '.join(failures)}. Run 'make logs-errors'.")
            sys.exit(1)
    except KeyboardInterrupt:
        print(f"\n  {YELLOW}⚠{RESET}  Interrupted")
        sys.exit(130)
    except RuntimeError as e:
        fail(f"Step failed: {e}")
        sys.exit(1)

    silver, matched = counts["silver_canonical_transactions"], counts["gold_matched_transactions"]
    print(f"\n{BOLD}{GREEN}  ✓ Demo ready{RESET} in {(datetime.now() - start_time).seconds}s")
    print(f"    Match rate (all time): {matched / silver * 100:.1f}% of {silver:,} transactions")
    print(f"    Dashboard   http://localhost:3000")
    print(f"    API docs    http://127.0.0.1:8000/docs")
    print(f"    Prefect UI  http://localhost:4200")
    if args.monitoring:
        print(f"    Grafana     http://localhost:3001")
    print()


if __name__ == "__main__":
    main()
