#!/usr/bin/env python3
"""
Security Check Script — CI Prohibited Pattern Scanner.

Scans the codebase for patterns that represent security violations.
Run as part of the CI pipeline — fails build if any violation is found.

This is NOT a comprehensive security audit. It catches the most common
accidental security regressions specific to this system:
    - TLS disabled (verify=False, ssl=False)
    - Hardcoded credentials
    - Debug mode in non-dev contexts
    - PII leakage patterns in logging

References:
    - Data Governance & Security §4.3: Transport Security
    - Threat Model T-006: Dependency Compromise
    - Threat Model T-009: Log-Based PII Leakage
"""
import re
import sys
from pathlib import Path
from dataclasses import dataclass


@dataclass
class Violation:
    """A single security violation found in the codebase."""
    file: str
    line_number: int
    line_content: str
    rule_name: str
    severity: str
    explanation: str


# ── Prohibited Patterns ───────────────────────────────────────────────────────
# Each rule: (regex_pattern, rule_name, severity, explanation)

RULES: list[tuple[str, str, str, str]] = [
    # Transport security
    (
        r"ssl\s*=\s*False",
        "TLS_DISABLED",
        "HIGH",
        "TLS disabled — not permitted outside local dev config. "
        "Reference: Data Governance §4.3",
    ),
    (
        r"verify\s*=\s*False",
        "CERT_VERIFY_DISABLED",
        "CRITICAL",
        "Certificate verification disabled — never permitted in any context. "
        "Reference: Data Governance §4.3",
    ),
    (
        r'MINIO_USE_SSL\s*=\s*["\']?false',
        "MINIO_SSL_DISABLED",
        "HIGH",
        "MinIO SSL disabled — not permitted in staging or production. "
        "Reference: Data Governance §4.6",
    ),
    # Credential patterns
    (
        r'sk_live_[a-zA-Z0-9]{20,}',
        "LIVE_PAYSTACK_KEY",
        "CRITICAL",
        "Live Paystack secret key detected in source code. "
        "Reference: Threat Model T-002",
    ),
    (
        r'FLWSECK-[a-zA-Z0-9]{20,}',
        "LIVE_FLUTTERWAVE_KEY",
        "CRITICAL",
        "Live Flutterwave secret key detected in source code. "
        "Reference: Threat Model T-002",
    ),
    (
        r'(?:password|secret|api_key)\s*=\s*["\'][^"\']{8,}["\']',
        "HARDCODED_SECRET",
        "HIGH",
        "Possible hardcoded credential detected. Secrets must be loaded from "
        "environment variables or secrets manager. Reference: Data Governance §4.4",
    ),
    # Debug / development-only settings in non-dev files
    (
        r'LOG_LEVEL\s*=\s*["\']?DEBUG',
        "DEBUG_LOG_LEVEL",
        "MEDIUM",
        "DEBUG log level should not be committed to non-dev configuration. "
        "Reference: Threat Model T-009",
    ),
    # PII leakage in logging
    (
        r'log(?:ger)?\.(?:info|debug|warning|error)\(.*account_number',
        "PII_IN_LOG_ACCOUNT",
        "HIGH",
        "Raw account number may be logged — PII leakage risk. "
        "Reference: Threat Model T-009, Correctness Property C-003",
    ),
    (
        r'log(?:ger)?\.(?:info|debug|warning|error)\(.*\bbvn\b',
        "PII_IN_LOG_BVN",
        "CRITICAL",
        "BVN reference in log statement — PII leakage risk. "
        "Reference: Threat Model T-009",
    ),
]

# Files and directories to skip
SKIP_DIRS = {
    ".git", ".venv", "venv", "__pycache__", "node_modules",
    ".mypy_cache", ".pytest_cache", ".ruff_cache", "htmlcov",
    ".gemini", "docs",
}
SKIP_FILES = {
    "security_check.py",  # This file contains the patterns as strings
}
SCAN_EXTENSIONS = {".py", ".yml", ".yaml", ".toml", ".cfg", ".ini", ".env"}


def scan_file(file_path: Path) -> list[Violation]:
    """Scan a single file for prohibited patterns."""
    violations = []

    try:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
    except (OSError, PermissionError):
        return violations

    for line_number, line in enumerate(content.splitlines(), start=1):
        stripped = line.strip()
        # Skip comments
        if stripped.startswith("#") or stripped.startswith("//"):
            continue

        for pattern, rule_name, severity, explanation in RULES:
            if re.search(pattern, line, re.IGNORECASE):
                violations.append(Violation(
                    file=str(file_path),
                    line_number=line_number,
                    line_content=stripped[:120],  # Truncate long lines
                    rule_name=rule_name,
                    severity=severity,
                    explanation=explanation,
                ))

    return violations


def scan_directory(root: Path) -> list[Violation]:
    """Recursively scan a directory for security violations."""
    all_violations = []

    for path in sorted(root.rglob("*")):
        # Skip directories
        if any(skip in path.parts for skip in SKIP_DIRS):
            continue
        if path.name in SKIP_FILES:
            continue
        if path.suffix not in SCAN_EXTENSIONS:
            continue
        if not path.is_file():
            continue

        all_violations.extend(scan_file(path))

    return all_violations


def main() -> int:
    """Entry point. Returns exit code (0=clean, 1=violations found)."""
    project_root = Path(__file__).parent.parent

    print("=" * 72)
    print("  MMR Security Check — Prohibited Pattern Scanner")
    print("  Reference: Data Governance & Security Policy §4, §7")
    print("=" * 72)
    print()

    violations = scan_directory(project_root)

    if not violations:
        print("[PASS] No security violations detected.")
        print(f"   Scanned: {project_root}")
        print(f"   Rules checked: {len(RULES)}")
        return 0

    # Group by severity
    critical = [v for v in violations if v.severity == "CRITICAL"]
    high = [v for v in violations if v.severity == "HIGH"]
    medium = [v for v in violations if v.severity == "MEDIUM"]

    print(f"[FAIL] {len(violations)} security violation(s) detected!")
    print()

    for severity_label, severity_list in [
        ("[CRITICAL]", critical),
        ("[HIGH]", high),
        ("[MEDIUM]", medium),
    ]:
        if not severity_list:
            continue
        print(f"  {severity_label} ({len(severity_list)}):")
        print()
        for v in severity_list:
            rel_path = Path(v.file).relative_to(project_root)
            print(f"    [{v.rule_name}] {rel_path}:{v.line_number}")
            print(f"      Line: {v.line_content}")
            print(f"      Why:  {v.explanation}")
            print()

    # CRITICAL and HIGH fail the build
    blocking = len(critical) + len(high)
    if blocking > 0:
        print(f"[FAIL] BUILD FAILED: {blocking} blocking violation(s).")
        print("   Fix all CRITICAL and HIGH violations before merging.")
        return 1

    print(f"[WARN] {len(medium)} non-blocking warning(s). Consider fixing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
