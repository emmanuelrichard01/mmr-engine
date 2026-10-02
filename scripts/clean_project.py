#!/usr/bin/env python3
# scripts/clean_project.py
"""
Cross-Platform Project Cleanup Utility.
Removes build caches, coverage reports, Python bytecode, and synthetic demo datasets.
Compatible with Windows, macOS, and Linux.
"""
import argparse
import os
import shutil
from pathlib import Path


def clean_project(clean_dashboard: bool = False):
    root = Path(__file__).resolve().parent.parent

    # 1. Clean __pycache__ directories
    print("🧹 Cleaning Python caches and files...")
    pycache_count = 0
    pyc_count = 0
    for p in root.rglob("*"):
        if p.is_dir() and p.name == "__pycache__":
            try:
                shutil.rmtree(p)
                pycache_count += 1
            except Exception as e:
                print(f"   ⚠️ Failed to remove {p.relative_to(root)}: {e}")
        elif p.is_file() and p.suffix == ".pyc":
            try:
                p.unlink()
                pyc_count += 1
            except Exception as e:
                print(f"   ⚠️ Failed to delete {p.relative_to(root)}: {e}")

    if pycache_count > 0:
        print(f"   Removed {pycache_count} __pycache__ directory/directories.")
    if pyc_count > 0:
        print(f"   Deleted {pyc_count} .pyc file(s).")

    # 2. Clean specific directories and files
    targets = [
        ".coverage",
        "htmlcov",
        ".pytest_cache",
        "scripts/demo_data",
        ".ruff_cache",
        ".mypy_cache",
    ]

    print("🧹 Removing test coverage and demo data directories...")
    for target_path in targets:
        full_path = root / target_path
        if full_path.exists():
            try:
                if full_path.is_dir():
                    shutil.rmtree(full_path)
                    print(f"   Removed directory: {target_path}/")
                else:
                    full_path.unlink()
                    print(f"   Removed file: {target_path}")
            except Exception as e:
                print(f"   ⚠️ Failed to remove {target_path}: {e}")

    # 3. Clean Dashboard (optional)
    if clean_dashboard:
        print("🧹 Cleaning Next.js dashboard build & dependencies...")
        dashboard_targets = [
            "dashboard/node_modules",
            "dashboard/.next",
        ]
        for target_path in dashboard_targets:
            full_path = root / target_path
            if full_path.exists() and full_path.is_dir():
                try:
                    shutil.rmtree(full_path)
                    print(f"   Removed directory: {target_path}/")
                except Exception as e:
                    print(f"   ⚠️ Failed to remove {target_path}: {e}")

    print("✨ Cleanup complete!")


def main():
    parser = argparse.ArgumentParser(description="Clean up project development caches and files.")
    parser.add_argument(
        "--dashboard",
        action="store_true",
        help="Also remove dashboard/node_modules and dashboard/.next directories",
    )
    args = parser.parse_args()
    clean_project(clean_dashboard=args.dashboard)


if __name__ == "__main__":
    main()
