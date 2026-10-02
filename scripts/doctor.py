#!/usr/bin/env python3
"""
MMR Engine — Pre-flight Doctor Script
Validates the environment before running any make target.
"""
import subprocess
import sys
import os
import socket
from pathlib import Path

# ── ANSI colours ─────────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg: str):    print(f"  {GREEN}✓{RESET}  {msg}")
def fail(msg: str):  print(f"  {RED}✗{RESET}  {msg}")
def warn(msg: str):  print(f"  {YELLOW}⚠{RESET}  {msg}")
def info(msg: str):  print(f"  {BLUE}i{RESET}  {msg}")

# ── Checks ────────────────────────────────────────────────────────────────────

def check_docker() -> bool:
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            ok("Docker daemon is running")
            return True
        else:
            fail("Docker daemon is NOT running — start Docker Desktop first")
            return False
    except FileNotFoundError:
        fail("Docker not found — install Docker Desktop from https://docker.com")
        return False
    except subprocess.TimeoutExpired:
        fail("Docker daemon timed out — it may be starting up, try again")
        return False


def check_docker_compose() -> bool:
    try:
        result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            version = result.stdout.strip().split("version")[-1].strip()
            ok(f"Docker Compose available (v{version})")
            return True
        else:
            fail("Docker Compose plugin not found")
            return False
    except Exception:
        fail("Could not check Docker Compose version")
        return False


def check_env_file() -> bool:
    env_path = Path(".env")
    env_example = Path(".env.example")

    if not env_path.exists():
        if env_example.exists():
            fail(".env not found — copy .env.example and fill in values:")
            info("  cp .env.example .env")
        else:
            fail(".env file not found in project root")
        return False

    # Check for placeholder values
    content = env_path.read_text()
    placeholder_patterns = [
        "your-secret-here", "changeme", "xxx", "REPLACE_ME",
        "your_password", "secret_key_here",
    ]
    found_placeholders = [p for p in placeholder_patterns if p.lower() in content.lower()]
    if found_placeholders:
        warn(f".env exists but contains placeholder values: {found_placeholders}")
        warn("  Update .env with real values before running in production")
        return True  # Warning only, don't block

    ok(".env exists and looks configured")
    return True


def check_python() -> bool:
    version = sys.version_info
    if version >= (3, 11):
        ok(f"Python {version.major}.{version.minor}.{version.micro}")
        return True
    elif version >= (3, 9):
        warn(f"Python {version.major}.{version.minor} (3.11+ recommended)")
        return True
    else:
        fail(f"Python {version.major}.{version.minor} is too old — install Python 3.11+")
        return False


def check_node() -> bool:
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            major = int(version.lstrip("v").split(".")[0])
            if major >= 18:
                ok(f"Node.js {version}")
                return True
            else:
                warn(f"Node.js {version} is outdated — v18+ recommended for dashboard")
                return True
    except FileNotFoundError:
        warn("Node.js not found — required for `make dashboard`")
        return True  # Non-blocking for backend-only usage


def check_ports() -> bool:
    required_ports = {
        3000: "Dashboard (Next.js)",
        8000: "API (FastAPI)",
        5432: "PostgreSQL",
        9092: "Redpanda (Kafka)",
        4200: "Prefect UI",
    }

    all_free = True
    for port, service in required_ports.items():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.3)
            in_use = s.connect_ex(("localhost", port)) == 0

        if in_use:
            # Check if it's our own service or something else
            warn(f"Port {port} ({service}) is in use — may be a running MMR service")
        # We don't fail on ports already in use; they could be our own services

    ok("Port availability checked")
    return True


def check_scripts() -> bool:
    required = [
        "scripts/generate_demo_data.py",
        "scripts/simulate_webhooks.py",
        "scripts/demo_full.py",
        "scripts/wait_for_postgres.py",
        "docker-compose.yml",
    ]
    missing = [f for f in required if not Path(f).exists()]
    if missing:
        fail(f"Missing required files: {', '.join(missing)}")
        return False
    ok("Required scripts and config files present")
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"\n{BOLD}MMR Engine — Pre-flight Check{RESET}")
    print("─" * 50)

    checks = [
        ("Docker daemon",       check_docker),
        ("Docker Compose",      check_docker_compose),
        ("Environment file",    check_env_file),
        ("Python version",      check_python),
        ("Node.js",             check_node),
        ("Port availability",   check_ports),
        ("Required files",      check_scripts),
    ]

    results = []
    for label, fn in checks:
        passed = fn()
        results.append((label, passed))

    print()
    failures = [(l, p) for l, p in results if not p]

    if not failures:
        print(f"  {GREEN}{BOLD}All checks passed.{RESET} Ready to run: make demo\n")
        sys.exit(0)
    else:
        print(f"  {RED}{BOLD}{len(failures)} check(s) failed:{RESET}")
        for label, _ in failures:
            print(f"    {RED}✗{RESET} {label}")
        print()
        sys.exit(1)


if __name__ == "__main__":
    main()
