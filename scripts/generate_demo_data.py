#!/usr/bin/env python3
# scripts/generate_demo_data.py
"""
Synthetic Demo Data Generator.

Generates a realistic 30-day transaction history for portfolio demonstrations.
Produces JSON files that can be replayed through the webhook simulator or
loaded directly into the database.

Output: scripts/demo_data/

Distribution (per day, ~100 transactions):
    - 70 matched pairs (Paystack ↔ Flutterwave)
    - 10 unmatched Paystack (missing settlement)
    - 5 unmatched Flutterwave (missing counterpart)
    - 5 amount mismatches (FX variance 0.2–0.8%)
    - 3 late settlements (settled 48+ hours after initiation)
    - 2 duplicate events (idempotency test)
    - 5 cross-border (USD/GBP → NGN conversion)

Total: ~3,000 events over 30 days

Usage:
    python scripts/generate_demo_data.py
    python scripts/generate_demo_data.py --days 7 --output scripts/demo_data
"""
import argparse
import json
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

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
    "Chiamaka Nwosu", "Dauda Musa", "Folasade Ogun",
    "Ibrahim Yakubu", "Jumoke Fasola", "Kingsley Obi",
]

# Realistic amount distribution for a mid-market Nigerian business
AMOUNT_DISTRIBUTION = {
    "small": (1000, 10000, 0.30),       # 30% small transactions
    "medium": (10000, 100000, 0.45),     # 45% medium
    "large": (100000, 500000, 0.20),     # 20% large
    "enterprise": (500000, 5000000, 0.05),  # 5% enterprise
}

NARRATIONS = [
    "Monthly subscription", "Invoice payment", "Airtime purchase",
    "Utility bill payment", "Product purchase", "Service fee",
    "Marketplace settlement", "Vendor payment", "Salary advance",
    "Loan repayment", "Insurance premium", "School fees",
    "Rent payment", "Transportation fee", "Food delivery",
]

FX_RATES = {
    "NGN/USD": Decimal("0.00063"),   # ~1 USD = 1,587 NGN
    "NGN/GBP": Decimal("0.00050"),   # ~1 GBP = 2,000 NGN
    "NGN/EUR": Decimal("0.00058"),   # ~1 EUR = 1,724 NGN
    "NGN/KES": Decimal("0.082"),     # ~1 KES = 12.2 NGN
}


# ── Helper Functions ──────────────────────────────────────────────────────────

def _weighted_amount() -> int:
    """Pick a realistic amount based on the distribution."""
    r = random.random()
    cumulative = 0
    for _, (low, high, weight) in AMOUNT_DISTRIBUTION.items():
        cumulative += weight
        if r <= cumulative:
            # Round to "clean" amounts common in Nigerian transactions
            raw = random.randint(low, high)
            if raw < 5000:
                return round(raw / 100) * 100
            elif raw < 100000:
                return round(raw / 1000) * 1000
            else:
                return round(raw / 10000) * 10000
    return 50000  # Fallback


def _random_timestamp(base_date: datetime, business_hours: bool = True) -> datetime:
    """Generate a random timestamp within the given day."""
    if business_hours:
        # 80% during business hours (8am–6pm WAT)
        if random.random() < 0.80:
            hour = random.randint(8, 17)
        else:
            hour = random.choice([*range(0, 8), *range(18, 24)])
    else:
        hour = random.randint(0, 23)

    minute = random.randint(0, 59)
    second = random.randint(0, 59)
    return base_date.replace(hour=hour, minute=minute, second=second)


def _build_paystack_event(
    event_type: str,
    amount_ngn: int,
    timestamp: datetime,
    reference: str = None,
    currency: str = "NGN",
) -> dict:
    """Build a Paystack webhook event."""
    bank = random.choice(NIGERIAN_BANKS)
    name = random.choice(NIGERIAN_NAMES)
    ref = reference or f"T_{uuid.uuid4().hex[:12]}"

    return {
        "psp": "paystack",
        "event": event_type,
        "timestamp": timestamp.isoformat(),
        "payload": {
            "event": event_type,
            "data": {
                "id": random.randint(100000, 9999999),
                "reference": ref,
                "amount": amount_ngn * 100 if currency == "NGN" else int(amount_ngn * 100),
                "currency": currency,
                "status": "success",
                "paid_at": timestamp.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                "channel": random.choice(["card", "bank_transfer", "ussd"]),
                "fees": int(amount_ngn * 0.015) * 100,
                "authorization": {
                    "account_number": "".join([str(random.randint(0, 9)) for _ in range(10)]),
                    "account_name": name.upper(),
                    "bank": bank["name"],
                    "bank_code": bank["code"],
                },
                "customer": {"email": f"{name.split()[0].lower()}@example.com"},
                "metadata": {
                    "custom_fields": [{"value": random.choice(NARRATIONS)}],
                },
            },
        },
    }


def _build_flutterwave_event(
    event_type: str,
    amount_ngn: int,
    timestamp: datetime,
    tx_ref: str = None,
    currency: str = "NGN",
) -> dict:
    """Build a Flutterwave webhook event."""
    bank = random.choice(NIGERIAN_BANKS)
    name = random.choice(NIGERIAN_NAMES)
    ref = tx_ref or f"FLW-TXN-{uuid.uuid4().hex[:8].upper()}"

    return {
        "psp": "flutterwave",
        "event": event_type,
        "timestamp": timestamp.isoformat(),
        "payload": {
            "event": event_type,
            "data": {
                "id": random.randint(100000, 9999999),
                "tx_ref": ref,
                "flw_ref": f"FLW-MOCK-{uuid.uuid4().hex[:12]}",
                "amount": amount_ngn,
                "currency": currency,
                "status": "successful",
                "created_at": timestamp.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "customer": {
                    "name": name,
                    "email": f"{name.split()[0].lower()}@example.com",
                },
                "account": {
                    "account_number": "".join([str(random.randint(0, 9)) for _ in range(10)]),
                    "account_name": name.upper(),
                    "bank_code": bank["code"],
                    "bank": bank["name"],
                },
                "app_fee": random.choice([100, 150, 200, 250]),
                "merchant_fee": random.randint(500, 2000),
                "narration": random.choice(NARRATIONS),
            },
        },
    }


# ── Scenario Generators ──────────────────────────────────────────────────────

def generate_matched_pair(base_date: datetime) -> list[dict]:
    """Matched pair: Paystack credit + Flutterwave debit, same amount."""
    amount = _weighted_amount()
    ts1 = _random_timestamp(base_date)
    ts2 = ts1 + timedelta(seconds=random.randint(30, 300))  # 30s to 5min later

    return [
        _build_paystack_event("charge.success", amount, ts1),
        _build_flutterwave_event("transfer.completed", amount, ts2),
    ]


def generate_unmatched(base_date: datetime, psp: str = "paystack") -> list[dict]:
    """Single event with no counterpart — creates a discrepancy."""
    amount = _weighted_amount()
    ts = _random_timestamp(base_date)

    if psp == "paystack":
        return [_build_paystack_event("charge.success", amount, ts)]
    else:
        return [_build_flutterwave_event("charge.completed", amount, ts)]


def generate_fx_variance(base_date: datetime) -> list[dict]:
    """Pair with slight amount difference — simulates FX timing."""
    amount = _weighted_amount()
    variance = random.uniform(0.002, 0.008)
    varied_amount = int(amount * (1 + variance))
    ts1 = _random_timestamp(base_date)
    ts2 = ts1 + timedelta(seconds=random.randint(60, 600))

    return [
        _build_paystack_event("charge.success", amount, ts1),
        _build_flutterwave_event("transfer.completed", varied_amount, ts2),
    ]


def generate_duplicate(base_date: datetime) -> list[dict]:
    """Same event fired twice — tests idempotency."""
    amount = _weighted_amount()
    ts = _random_timestamp(base_date)
    ref = f"T_{uuid.uuid4().hex[:12]}"

    event = _build_paystack_event("charge.success", amount, ts, reference=ref)
    return [event, event]  # Exact duplicate


def generate_cross_border(base_date: datetime) -> list[dict]:
    """Cross-border transaction in foreign currency."""
    currency = random.choice(["USD", "GBP", "EUR"])
    # Amount in foreign currency (smaller numbers)
    if currency == "USD":
        amount_foreign = random.choice([10, 25, 50, 100, 250, 500])
    elif currency == "GBP":
        amount_foreign = random.choice([10, 20, 50, 100, 200])
    else:
        amount_foreign = random.choice([10, 25, 50, 100, 250])

    ts = _random_timestamp(base_date)
    return [_build_paystack_event("charge.success", amount_foreign, ts, currency=currency)]


def generate_late_settlement(base_date: datetime) -> list[dict]:
    """Transaction with delayed settlement (48+ hours)."""
    amount = _weighted_amount()
    ts1 = _random_timestamp(base_date)
    # Settlement comes 2-5 days later
    delay_hours = random.randint(48, 120)
    ts2 = ts1 + timedelta(hours=delay_hours)

    event = _build_paystack_event("transfer.success", amount, ts1)
    event["late_settlement_hours"] = delay_hours
    return [event]


# ── Main Generator ────────────────────────────────────────────────────────────

def generate_day(date: datetime) -> list[dict]:
    """Generate all events for a single day."""
    events = []

    # Skip weekends (lower volume)
    is_weekend = date.weekday() >= 5
    multiplier = 0.3 if is_weekend else 1.0

    # Matched pairs (70%)
    for _ in range(int(70 * multiplier)):
        events.extend(generate_matched_pair(date))

    # Unmatched Paystack (10%)
    for _ in range(int(10 * multiplier)):
        events.extend(generate_unmatched(date, "paystack"))

    # Unmatched Flutterwave (5%)
    for _ in range(int(5 * multiplier)):
        events.extend(generate_unmatched(date, "flutterwave"))

    # FX variance (5%)
    for _ in range(int(5 * multiplier)):
        events.extend(generate_fx_variance(date))

    # Late settlements (3%)
    for _ in range(int(3 * multiplier)):
        events.extend(generate_late_settlement(date))

    # Duplicates (2%)
    for _ in range(int(2 * multiplier)):
        events.extend(generate_duplicate(date))

    # Cross-border (5%)
    for _ in range(int(5 * multiplier)):
        events.extend(generate_cross_border(date))

    # Sort by timestamp
    events.sort(key=lambda e: e["timestamp"])
    return events


def generate_fx_history(days: int) -> list[dict]:
    """Generate FX rate snapshots for the demo period."""
    snapshots = []
    base_rates = dict(FX_RATES)

    for day_offset in range(days, -1, -1):
        date = datetime.now(timezone.utc) - timedelta(days=day_offset)

        for pair, base_rate in base_rates.items():
            # Add realistic daily variance (±0.5%)
            variance = Decimal(str(random.uniform(-0.005, 0.005)))
            rate = base_rate * (1 + variance)

            snapshots.append({
                "currency_pair": pair,
                "rate": str(rate.quantize(Decimal("0.0000001"))),
                "source_provider": "exchangerate-api",
                "captured_at": date.replace(hour=2, minute=0).isoformat(),
            })

    return snapshots


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic demo data")
    parser.add_argument("--days", type=int, default=30, help="Number of days")
    parser.add_argument("--output", type=str, default="scripts/demo_data")
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    all_events = []
    now = datetime.now(timezone.utc)

    print(f"Generating {args.days} days of synthetic data...")

    for day_offset in range(args.days, -1, -1):
        date = now - timedelta(days=day_offset)
        date = date.replace(hour=0, minute=0, second=0, microsecond=0)
        day_events = generate_day(date)
        all_events.extend(day_events)

        day_file = output_dir / f"day_{date.strftime('%Y-%m-%d')}.json"
        with open(day_file, "w") as f:
            json.dump(day_events, f, indent=2, default=str)

        print(f"  📅 {date.strftime('%Y-%m-%d')}: {len(day_events)} events")

    # Generate FX rate history
    fx_snapshots = generate_fx_history(args.days)
    fx_file = output_dir / "fx_rates.json"
    with open(fx_file, "w") as f:
        json.dump(fx_snapshots, f, indent=2, default=str)

    # Summary file
    summary = {
        "generated_at": now.isoformat(),
        "days": args.days,
        "total_events": len(all_events),
        "fx_snapshots": len(fx_snapshots),
        "breakdown": {
            "paystack_events": len([e for e in all_events if e["psp"] == "paystack"]),
            "flutterwave_events": len([e for e in all_events if e["psp"] == "flutterwave"]),
        },
    }
    with open(output_dir / "summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    print(f"\n{'='*60}")
    print(f"✅ Generated {len(all_events)} events over {args.days} days")
    print(f"   📊 FX snapshots: {len(fx_snapshots)}")
    print(f"   📁 Output: {output_dir.absolute()}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
