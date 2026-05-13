#!/usr/bin/env python3
# scripts/simulate_webhooks.py
"""
Webhook Simulator — fire realistic PSP events against the local API.

Usage:
    # Fire a single matched pair (Paystack credit + Flutterwave debit)
    python scripts/simulate_webhooks.py matched-pair --amount 50000

    # Fire an unmatched transaction (creates a discrepancy)
    python scripts/simulate_webhooks.py unmatched --psp paystack --amount 75000

    # Fire a duplicate event (tests idempotency)
    python scripts/simulate_webhooks.py duplicate --psp paystack --reference T_abc123

    # Fire an FX variance scenario (amount mismatch after conversion)
    python scripts/simulate_webhooks.py fx-variance --amount 50000

    # Fire a batch of random events
    python scripts/simulate_webhooks.py batch --count 20

This script serves two purposes:
    1. Developer tool — test the ingestion pipeline locally
    2. Demo tool — generate realistic activity for live demonstrations
"""
import argparse
import hashlib
import hmac
import json
import random
import sys
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import requests

# ── Configuration ─────────────────────────────────────────────────────────────

API_BASE_URL = "http://localhost:8000"
PAYSTACK_WEBHOOK_URL = f"{API_BASE_URL}/v1/webhooks/paystack"
FLUTTERWAVE_WEBHOOK_URL = f"{API_BASE_URL}/v1/webhooks/flutterwave"

# Default test credentials (override via environment)
import os

PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "sk_test_dummy_key")
FLUTTERWAVE_SECRET_HASH = os.environ.get("FLUTTERWAVE_SECRET_HASH", "test_flw_hash")

# ── Nigerian Bank Data ────────────────────────────────────────────────────────

NIGERIAN_BANKS = [
    {"code": "057", "name": "Zenith Bank"},
    {"code": "058", "name": "Guaranty Trust Bank"},
    {"code": "011", "name": "First Bank of Nigeria"},
    {"code": "044", "name": "Access Bank"},
    {"code": "033", "name": "United Bank for Africa"},
    {"code": "032", "name": "Union Bank"},
    {"code": "035", "name": "Wema Bank"},
    {"code": "050", "name": "Ecobank Nigeria"},
    {"code": "221", "name": "Stanbic IBTC"},
    {"code": "070", "name": "Fidelity Bank"},
]

NIGERIAN_NAMES = [
    "Chioma Okonkwo", "Tunde Adeyemi", "Amina Ibrahim",
    "Emeka Chukwu", "Folake Williams", "Oluwaseun Balogun",
    "Ngozi Eze", "Babatunde Osinbajo", "Adaeze Nwankwo",
    "Yusuf Mohammed", "Kemi Adeola", "Ifeanyi Okoro",
    "Aisha Bello", "Chidi Anyanwu", "Funke Akindele",
    "Obinna Ike", "Halima Suleiman", "Segun Ajayi",
]

COMMON_AMOUNTS_NGN = [
    5000, 10000, 15000, 20000, 25000, 30000, 50000,
    75000, 100000, 150000, 200000, 250000, 500000,
    1000000, 2500000, 5000000,
]


# ── Helper Functions ──────────────────────────────────────────────────────────

def _random_account():
    """Generate a random 10-digit NUBAN."""
    return "".join([str(random.randint(0, 9)) for _ in range(10)])


def _random_bank():
    return random.choice(NIGERIAN_BANKS)


def _random_name():
    return random.choice(NIGERIAN_NAMES)


def _random_amount():
    """Pick a realistic Nigerian transaction amount."""
    return random.choice(COMMON_AMOUNTS_NGN)


def _sign_paystack(body: bytes) -> str:
    """Compute Paystack HMAC-SHA512 signature."""
    return hmac.new(
        PAYSTACK_SECRET_KEY.encode("utf-8"),
        body,
        hashlib.sha512,
    ).hexdigest()


def _fire_paystack(payload: dict) -> dict:
    """Send a signed Paystack webhook to the local API."""
    body = json.dumps(payload).encode("utf-8")
    signature = _sign_paystack(body)

    try:
        response = requests.post(
            PAYSTACK_WEBHOOK_URL,
            data=body,
            headers={
                "Content-Type": "application/json",
                "X-Paystack-Signature": signature,
            },
            timeout=10,
        )
        return {"status": response.status_code, "body": response.json()}
    except requests.exceptions.ConnectionError:
        return {"status": 0, "body": {"error": "Connection refused — is the API running?"}}


def _fire_flutterwave(payload: dict) -> dict:
    """Send a Flutterwave webhook to the local API."""
    try:
        response = requests.post(
            FLUTTERWAVE_WEBHOOK_URL,
            json=payload,
            headers={
                "Content-Type": "application/json",
                "verif-hash": FLUTTERWAVE_SECRET_HASH,
            },
            timeout=10,
        )
        return {"status": response.status_code, "body": response.json()}
    except requests.exceptions.ConnectionError:
        return {"status": 0, "body": {"error": "Connection refused — is the API running?"}}


def _build_paystack_charge(
    amount_ngn: int,
    reference: str = None,
    currency: str = "NGN",
) -> dict:
    """Build a Paystack charge.success payload."""
    bank = _random_bank()
    name = _random_name()
    ref = reference or f"T_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

    return {
        "event": "charge.success",
        "data": {
            "id": random.randint(100000, 999999),
            "reference": ref,
            "amount": amount_ngn * 100,  # Convert to kobo
            "currency": currency,
            "status": "success",
            "paid_at": now,
            "channel": random.choice(["card", "bank_transfer", "ussd"]),
            "fees": int(amount_ngn * 100 * 0.015),
            "authorization": {
                "account_number": _random_account(),
                "account_name": name.upper(),
                "bank": bank["name"],
                "bank_code": bank["code"],
            },
            "customer": {
                "email": f"{name.split()[0].lower()}@example.com",
            },
            "metadata": {
                "custom_fields": [
                    {"value": f"Payment #{random.randint(1000, 9999)}"}
                ],
            },
        },
    }


def _build_flutterwave_charge(
    amount_ngn: int,
    tx_ref: str = None,
    currency: str = "NGN",
) -> dict:
    """Build a Flutterwave charge.completed payload."""
    bank = _random_bank()
    name = _random_name()
    ref = tx_ref or f"FLW-TXN-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "event": "charge.completed",
        "data": {
            "id": random.randint(100000, 999999),
            "tx_ref": ref,
            "flw_ref": f"FLW-MOCK-{uuid.uuid4().hex[:12]}",
            "amount": amount_ngn,  # Flutterwave uses major units
            "currency": currency,
            "status": "successful",
            "created_at": now,
            "customer": {
                "name": name,
                "email": f"{name.split()[0].lower()}@example.com",
            },
            "account": {
                "account_number": _random_account(),
                "account_name": name.upper(),
                "bank_code": bank["code"],
                "bank": bank["name"],
            },
            "app_fee": random.choice([100, 150, 200, 250]),
            "merchant_fee": random.randint(500, 2000),
            "narration": f"Payment for order #{random.randint(1000, 9999)}",
        },
    }


# ── Scenario Functions ────────────────────────────────────────────────────────

def fire_matched_pair(amount_ngn: int = None):
    """
    Fire a matched pair: Paystack credit + Flutterwave debit for the same amount.
    This tests the matching engine's primary exact match strategy.
    """
    amount = amount_ngn or _random_amount()
    print(f"\n{'='*60}")
    print(f"🔄 MATCHED PAIR — NGN {amount:,}")
    print(f"{'='*60}")

    # Paystack credit
    ps_payload = _build_paystack_charge(amount)
    ps_result = _fire_paystack(ps_payload)
    print(f"  ✅ Paystack charge.success  ref={ps_payload['data']['reference']}")
    print(f"     → {ps_result['status']}: {ps_result['body']}")

    time.sleep(0.5)

    # Flutterwave debit (same amount, different PSP)
    flw_payload = _build_flutterwave_charge(amount)
    flw_payload["event"] = "transfer.completed"
    flw_payload["data"]["status"] = "successful"
    flw_result = _fire_flutterwave(flw_payload)
    print(f"  ✅ Flutterwave transfer.completed  ref={flw_payload['data']['tx_ref']}")
    print(f"     → {flw_result['status']}: {flw_result['body']}")


def fire_unmatched(psp: str = "paystack", amount_ngn: int = None):
    """
    Fire a single unmatched transaction.
    This creates a discrepancy (missing counterpart).
    """
    amount = amount_ngn or _random_amount()
    print(f"\n{'='*60}")
    print(f"⚠️  UNMATCHED — {psp.upper()} NGN {amount:,}")
    print(f"{'='*60}")

    if psp == "paystack":
        payload = _build_paystack_charge(amount)
        result = _fire_paystack(payload)
        print(f"  📤 Paystack charge.success  ref={payload['data']['reference']}")
    else:
        payload = _build_flutterwave_charge(amount)
        result = _fire_flutterwave(payload)
        print(f"  📤 Flutterwave charge.completed  ref={payload['data']['tx_ref']}")

    print(f"     → {result['status']}: {result['body']}")
    print(f"  ⏳ No counterpart fired — discrepancy expected")


def fire_duplicate(psp: str = "paystack", reference: str = None):
    """
    Fire the same event twice to test idempotency.
    Second event should be detected and skipped.
    """
    ref = reference or f"T_dup_{uuid.uuid4().hex[:8]}"
    print(f"\n{'='*60}")
    print(f"🔁 DUPLICATE TEST — {psp.upper()} ref={ref}")
    print(f"{'='*60}")

    if psp == "paystack":
        payload = _build_paystack_charge(50000, reference=ref)
        print(f"  📤 First  event...")
        r1 = _fire_paystack(payload)
        print(f"     → {r1['status']}: {r1['body']}")

        time.sleep(0.5)

        print(f"  📤 Second event (duplicate)...")
        r2 = _fire_paystack(payload)
        print(f"     → {r2['status']}: {r2['body']}")
    else:
        payload = _build_flutterwave_charge(50000, tx_ref=ref)
        print(f"  📤 First  event...")
        r1 = _fire_flutterwave(payload)
        print(f"     → {r1['status']}: {r1['body']}")

        time.sleep(0.5)

        print(f"  📤 Second event (duplicate)...")
        r2 = _fire_flutterwave(payload)
        print(f"     → {r2['status']}: {r2['body']}")


def fire_fx_variance(amount_ngn: int = None):
    """
    Fire a pair with a slight amount difference simulating FX timing variance.
    One side sees the rate at T, the other at T+5min — creating a small discrepancy.
    """
    amount = amount_ngn or 50000
    variance_pct = random.uniform(0.002, 0.008)  # 0.2% to 0.8% variance
    varied_amount = int(amount * (1 + variance_pct))

    print(f"\n{'='*60}")
    print(f"💱 FX VARIANCE — NGN {amount:,} vs NGN {varied_amount:,} ({variance_pct:.2%})")
    print(f"{'='*60}")

    ps_payload = _build_paystack_charge(amount)
    ps_result = _fire_paystack(ps_payload)
    print(f"  ✅ Paystack:     NGN {amount:,}")
    print(f"     → {ps_result['status']}")

    time.sleep(0.5)

    flw_payload = _build_flutterwave_charge(varied_amount)
    flw_result = _fire_flutterwave(flw_payload)
    print(f"  ✅ Flutterwave:  NGN {varied_amount:,} (variance: {variance_pct:.2%})")
    print(f"     → {flw_result['status']}")


def fire_batch(count: int = 20):
    """
    Fire a batch of mixed events — realistic daily activity simulation.
    Distribution: 70% matched pairs, 15% unmatched, 10% duplicates, 5% FX variance.
    """
    print(f"\n{'='*60}")
    print(f"📦 BATCH — {count} scenarios")
    print(f"{'='*60}")

    matched = int(count * 0.70)
    unmatched = int(count * 0.15)
    duplicates = int(count * 0.10)
    fx_var = count - matched - unmatched - duplicates

    for i in range(matched):
        print(f"\n[{i+1}/{count}] ", end="")
        fire_matched_pair()
        time.sleep(0.3)

    for i in range(unmatched):
        print(f"\n[{matched+i+1}/{count}] ", end="")
        psp = random.choice(["paystack", "flutterwave"])
        fire_unmatched(psp=psp)
        time.sleep(0.3)

    for i in range(duplicates):
        print(f"\n[{matched+unmatched+i+1}/{count}] ", end="")
        fire_duplicate(psp=random.choice(["paystack", "flutterwave"]))
        time.sleep(0.3)

    for i in range(fx_var):
        print(f"\n[{matched+unmatched+duplicates+i+1}/{count}] ", end="")
        fire_fx_variance()
        time.sleep(0.3)

    print(f"\n\n{'='*60}")
    print(f"✅ BATCH COMPLETE: {matched} matched, {unmatched} unmatched, "
          f"{duplicates} duplicates, {fx_var} FX variance")
    print(f"{'='*60}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MMR Engine — Webhook Simulator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Scenarios:
  matched-pair   Fire a Paystack credit + Flutterwave debit (same amount)
  unmatched      Fire a single transaction with no counterpart
  duplicate      Fire the same event twice (tests idempotency)
  fx-variance    Fire a pair with slight amount difference (FX timing)
  batch          Fire a mixed batch of all scenario types
        """,
    )
    subparsers = parser.add_subparsers(dest="scenario", required=True)

    # matched-pair
    mp = subparsers.add_parser("matched-pair", help="Fire a matched transaction pair")
    mp.add_argument("--amount", type=int, help="Amount in NGN")

    # unmatched
    um = subparsers.add_parser("unmatched", help="Fire an unmatched transaction")
    um.add_argument("--psp", choices=["paystack", "flutterwave"], default="paystack")
    um.add_argument("--amount", type=int, help="Amount in NGN")

    # duplicate
    dup = subparsers.add_parser("duplicate", help="Fire duplicate events")
    dup.add_argument("--psp", choices=["paystack", "flutterwave"], default="paystack")
    dup.add_argument("--reference", type=str, help="Specific reference to duplicate")

    # fx-variance
    fxv = subparsers.add_parser("fx-variance", help="Fire FX variance pair")
    fxv.add_argument("--amount", type=int, default=50000)

    # batch
    bat = subparsers.add_parser("batch", help="Fire a mixed batch")
    bat.add_argument("--count", type=int, default=20, help="Number of scenarios")

    args = parser.parse_args()

    if args.scenario == "matched-pair":
        fire_matched_pair(args.amount)
    elif args.scenario == "unmatched":
        fire_unmatched(args.psp, args.amount)
    elif args.scenario == "duplicate":
        fire_duplicate(args.psp, args.reference)
    elif args.scenario == "fx-variance":
        fire_fx_variance(args.amount)
    elif args.scenario == "batch":
        fire_batch(args.count)


if __name__ == "__main__":
    main()
