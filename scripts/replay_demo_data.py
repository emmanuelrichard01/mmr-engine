#!/usr/bin/env python3
# scripts/replay_demo_data.py
"""
Replay Synthetic Demo Data to API gateway.

Loads the generated daily JSON files from scripts/demo_data/ and posts them
chronologically with valid HMAC/secret signatures.
"""
import os
import sys
import json
import hmac
import hashlib
import time
import argparse
from pathlib import Path
import requests

# Configure stdout for UTF-8 encoding (especially on Windows)
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# API Configuration
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8000")
PAYSTACK_WEBHOOK_URL = f"{API_BASE_URL}/v1/webhooks/paystack"
FLUTTERWAVE_WEBHOOK_URL = f"{API_BASE_URL}/v1/webhooks/flutterwave"
MPESA_WEBHOOK_URL = f"{API_BASE_URL}/v1/webhooks/mpesa"

# Secret keys for signing
PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "sk_test_dummy_key")
FLUTTERWAVE_SECRET_HASH = os.environ.get("FLUTTERWAVE_SECRET_HASH", "test_flw_hash")

def sign_paystack(body: bytes) -> str:
    """Compute Paystack HMAC-SHA512 signature."""
    return hmac.new(
        PAYSTACK_SECRET_KEY.encode("utf-8"),
        body,
        hashlib.sha512,
    ).hexdigest()

def replay_event(event: dict) -> bool:
    """Send a single event to the API gateway with valid credentials."""
    psp = event["psp"]
    payload = event["payload"]
    body = json.dumps(payload).encode("utf-8")

    try:
        if psp == "paystack":
            signature = sign_paystack(body)
            resp = requests.post(
                PAYSTACK_WEBHOOK_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Paystack-Signature": signature,
                },
                timeout=5,
            )
        elif psp == "flutterwave":
            resp = requests.post(
                FLUTTERWAVE_WEBHOOK_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "verif-hash": FLUTTERWAVE_SECRET_HASH,
                },
                timeout=5,
            )
        elif psp == "mpesa":
            resp = requests.post(
                MPESA_WEBHOOK_URL,
                data=body,
                headers={
                    "Content-Type": "application/json",
                },
                timeout=5,
            )
        else:
            print(f"Unknown PSP: {psp}")
            return False

        if resp.status_code in (200, 201, 202):
            return True
        else:
            print(f"Failed to replay {psp} event. Status: {resp.status_code}, Response: {resp.text}")
            return False
    except Exception as e:
        print(f"Error replaying {psp} event: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description="Replay generated synthetic demo data to the MMR Gateway")
    parser.add_argument("--dir", type=str, default="scripts/demo_data", help="Directory containing day_*.json files")
    parser.add_argument("--delay", type=float, default=0.01, help="Delay between requests in seconds")
    args = parser.parse_args()

    data_dir = Path(args.dir)
    if not data_dir.exists():
        print(f"Data directory {data_dir.absolute()} does not exist. Run generate_demo_data.py first.")
        sys.exit(1)

    # Find and sort all daily JSON files chronologically
    day_files = sorted(list(data_dir.glob("day_*.json")))
    if not day_files:
        print(f"No daily files (day_*.json) found in {data_dir.absolute()}")
        sys.exit(1)

    print(f"Found {len(day_files)} days of transaction history to replay.")
    
    total_replayed = 0
    total_failed = 0
    start_time = time.time()

    for idx, day_file in enumerate(day_files):
        print(f"[{idx+1}/{len(day_files)}] Replaying {day_file.name}...")
        try:
            with open(day_file, "r") as f:
                events = json.load(f)
        except Exception as e:
            print(f"  Error reading {day_file.name}: {e}")
            continue

        day_replayed = 0
        day_failed = 0
        for event in events:
            success = replay_event(event)
            if success:
                day_replayed += 1
            else:
                day_failed += 1
            
            if args.delay > 0:
                time.sleep(args.delay)
        
        print(f"  → Finished {day_file.name}: {day_replayed} succeeded, {day_failed} failed.")
        total_replayed += day_replayed
        total_failed += day_failed

    elapsed = time.time() - start_time
    print(f"\nReplay Complete!")
    print(f"Total time: {elapsed:.2f}s")
    print(f"Successfully replayed: {total_replayed} events")
    print(f"Failed to replay: {total_failed} events")

if __name__ == "__main__":
    main()
