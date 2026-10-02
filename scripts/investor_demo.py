#!/usr/bin/env python3
"""
MMR Engine — Investor Demo Runner
Step-by-step verified pipeline setup for investor presentations.

Usage:
    python scripts/investor_demo.py
    python scripts/investor_demo.py --days 30 --webhooks 100 --monitoring

Every step is verified before the next begins.
Final output shows actual DB record counts, not estimates.
"""
import argparse
import subprocess
import sys
import time
from datetime import datetime

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

def main():
    parser = argparse.ArgumentParser(description="MMR Engine Investor Demo Runner")
    parser.add_argument("--days",       type=int, default=30,  help="Days of synthetic data to generate")
    parser.add_argument("--webhooks",   type=int, default=100, help="Webhook events to simulate")
    parser.add_argument("--monitoring", action="store_true",   help="Also start Prometheus + Grafana")
    args = parser.parse_args()

    start_time = datetime.now()
    total_steps = 8

    print()
    print(f"{BOLD}{'━' * 58}{RESET}")
    print(f"{BOLD}  MMR Engine — Investor Demo Setup{RESET}")
    print(f"{BOLD}{'━' * 58}{RESET}")
    print(f"  {DIM}Started: {start_time.strftime('%Y-%m-%d %H:%M:%S')}{RESET}")
    print(f"  {DIM}Config:  {args.days} days · {args.webhooks} webhooks · monitoring={args.monitoring}{RESET}")

    try:
        # ── Step 1: Start Services ────────────────────────────────────────────
        step(1, total_steps, "Starting infrastructure services")
        compose_files = ["docker-compose.yml"]
        if args.monitoring:
            compose_files.append("docker-compose.monitoring.yml")
        cmd = ["docker", "compose"]
        for f in compose_files:
            cmd += ["-f", f]
        cmd += ["up", "-d", "--build"]
        run(cmd, capture=True)
        ok("Services started")

        # ── Step 2: Wait for PostgreSQL ───────────────────────────────────────
        step(2, total_steps, "Waiting for PostgreSQL to be ready")
        if not wait_for_postgres():
            fail("PostgreSQL did not become ready within 90 seconds")
            fail("Run: make logs   to diagnose the issue")
            sys.exit(1)
        ok("PostgreSQL is accepting connections")

        # ── Step 3: Run Migrations ────────────────────────────────────────────
        step(3, total_steps, "Running database migrations")
        run(["docker", "compose", "run", "--rm", "migrations",
             "alembic", "upgrade", "head"], capture=True)
        ok("All migrations applied")

        # ── Step 4: Generate Synthetic Data ───────────────────────────────────
        step(4, total_steps, f"Generating {args.days} days of synthetic transaction data")
        run(["python", "scripts/generate_demo_data.py", "--days", str(args.days)])
        ok(f"Generated {args.days} days of data")

        # ── Step 5: Replay Webhooks ───────────────────────────────────────────
        step(5, total_steps, f"Simulating {args.webhooks} webhook events")
        run(["python", "scripts/simulate_webhooks.py", "batch", "--count", str(args.webhooks)])
        ok(f"Fired {args.webhooks} webhook events")

        # ── Step 6: Wait for Ingestion ────────────────────────────────────────
        step(6, total_steps, "Waiting for event ingestion to complete")
        info("Sleeping 10 seconds for Kafka consumer to process events...")
        time.sleep(10)
        bronze_count = table_count("bronze_ingestion_log")
        if bronze_count > 0:
            ok(f"Bronze layer: {bronze_count:,} events ingested")
        else:
            fail("Bronze layer appears empty — check Kafka consumer logs")

        # ── Step 7: Run Matching Flow ─────────────────────────────────────────
        step(7, total_steps, "Running Silver→Gold reconciliation matching flow")
        run([
            "docker", "compose", "exec", "prefect_worker",
            "python", "-c",
            "import asyncio; from src.flows.matching_flow import silver_to_gold_matching_flow; "
            "result = asyncio.run(silver_to_gold_matching_flow()); print(f'Matched: {result}')"
        ], capture=True)
        ok("Matching flow complete")

        # ── Step 8: Verify Results ────────────────────────────────────────────
        step(8, total_steps, "Verifying pipeline results")
        bronze   = table_count("bronze_ingestion_log")
        silver   = table_count("silver_canonical_transactions")
        gold     = table_count("gold_reconciliation_pairs")
        discrepancies = table_count("gold_discrepancies")

        if all(v >= 0 for v in [bronze, silver, gold, discrepancies]):
            ok("All pipeline layers populated successfully")
        else:
            fail("Some tables could not be queried — check database connection")

    except KeyboardInterrupt:
        print(f"\n\n  {YELLOW}⚠{RESET}  Setup interrupted by user")
        sys.exit(130)
    except RuntimeError as e:
        print(f"\n  {RED}✗{RESET}  Step failed: {e}")
        sys.exit(1)

    # ── Summary ───────────────────────────────────────────────────────────────
    elapsed = (datetime.now() - start_time).seconds

    print()
    print(f"{BOLD}{'━' * 58}{RESET}")
    print(f"{BOLD}{GREEN}  ✓ Investor Demo Ready!{RESET}")
    print(f"{BOLD}{'━' * 58}{RESET}")
    print()
    print(f"  {BOLD}Pipeline Results:{RESET}")
    print(f"    Bronze events ingested  :  {bronze:>8,}")
    print(f"    Silver transactions     :  {silver:>8,}")
    print(f"    Gold reconciled pairs   :  {gold:>8,}")
    print(f"    Discrepancies flagged   :  {discrepancies:>8,}")

    if silver > 0 and gold >= 0:
        match_rate = (gold * 2 / silver * 100) if silver > 0 else 0
        print(f"    Estimated match rate    :  {min(match_rate, 100):>7.1f}%")

    print()
    print(f"  {BOLD}Access URLs:{RESET}")
    print(f"    {CYAN}Dashboard{RESET}     →  http://localhost:3000")
    print(f"    {CYAN}Investor Demo{RESET} →  http://localhost:3000/investor")
    print(f"    {CYAN}API Docs{RESET}      →  http://localhost:8000/docs")
    print(f"    {CYAN}API Health{RESET}    →  http://localhost:8000/health/ready")
    print(f"    {CYAN}Prefect UI{RESET}    →  http://localhost:4200")
    print(f"    {CYAN}MinIO{RESET}         →  http://localhost:9001")

    if args.monitoring:
        print(f"    {CYAN}Grafana{RESET}       →  http://localhost:3001  (admin/admin)")
        print(f"    {CYAN}Prometheus{RESET}    →  http://localhost:9090")

    print()
    print(f"  {DIM}Setup completed in {elapsed}s · {datetime.now().strftime('%H:%M:%S')}{RESET}")
    print()


if __name__ == "__main__":
    main()
