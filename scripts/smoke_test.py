#!/usr/bin/env python3
# scripts/smoke_test.py
"""
Cross-platform Smoke Test Utility.
Checks application shallow and deep health status without external library dependencies.
"""
import urllib.request
import json
import sys


def check_endpoint(url: str) -> bool:
    print(f"Checking {url} ...")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as response:
            status_code = response.getcode()
            body = response.read().decode("utf-8")
            if status_code == 200:
                print("  ✅ Status 200 OK")
                try:
                    data = json.loads(body)
                    print(json.dumps(data, indent=2))
                except json.JSONDecodeError:
                    print(body[:200])
                return True
            else:
                print(f"  ❌ Status {status_code}")
                return False
    except Exception as e:
        print(f"  ❌ Connection failed: {e}")
        return False


def main():
    # Force UTF-8 stdout encoding on Windows to prevent UnicodeEncodeError with emojis
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    success = True
    # Test simple health check
    if not check_endpoint("http://localhost:8000/health"):
        success = False

    print()

    # Test deep health check (which checks PG, Kafka, MinIO connectivity)
    if not check_endpoint("http://localhost:8000/health/ready"):
        success = False

    if success:
        print("\n🎉 Smoke test passed successfully! ✅")
        sys.exit(0)
    else:
        print("\n❌ Smoke test failed! 🛑")
        sys.exit(1)


if __name__ == "__main__":
    main()
