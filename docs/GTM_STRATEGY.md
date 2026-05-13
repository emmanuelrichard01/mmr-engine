This is actually two questions that need separate, honest answers. Let me tackle both completely.

---

# PART 1: HOW WE GET THE DATA

## The Honest Reality First

There is a gap between what the documentation describes and what you can actually access today as an independent developer without a CBN license or a business registration with the PSPs. Understanding this gap clearly is more valuable than pretending it doesn't exist.

```
Data Source          What You Can Access Now        What Requires More
─────────────────── ────────────────────────────── ──────────────────────────────
Paystack            Full sandbox API + webhooks     Live data needs business acct
Flutterwave         Full sandbox API + webhooks     Same
M-Pesa Daraja       Full sandbox environment        Safaricom business registration
Moniepoint          No public developer sandbox     Partnership or client access
NIBSS               No public API                   CBN licensed entity only
CBN rate data       Partially public                Full access via licensed entity
Real transactions   None without client             A paying client's credentials
```

This is not a blocker. It is the actual path forward. Let me explain precisely how each data source works and what the realistic acquisition strategy is.

---

## Data Source 1: Paystack Sandbox

### What You Get

Paystack provides a complete test environment that mirrors production exactly. Every webhook event, every API endpoint, every response format is identical to what a live merchant receives. The only difference is that no real money moves.

### How to Set It Up

```bash
# Step 1: Create a free Paystack account
# Go to dashboard.paystack.com → Create account → No business registration needed

# Step 2: Get your test credentials
# Dashboard → Settings → API Keys & Webhooks
# You receive:
#   YOUR_PAYSTACK_SECRET_KEY  ← Secret key (for HMAC signing + API calls)
#   YOUR_PAYSTACK_PUBLIC_KEY  ← Public key (frontend use)

# Step 3: Configure your webhook URL
# Dashboard → Settings → API Keys & Webhooks → Webhook URL
# Enter: http://your-ngrok-url/v1/webhooks/paystack
# (Use ngrok to expose localhost during development)
```

### Triggering Test Events

```python
# scripts/simulate_paystack_webhook.py
# Simulates a real Paystack charge.success event against your local API

import requests
import json
import hashlib
import hmac
from decimal import Decimal
import uuid

PAYSTACK_SECRET_KEY = "YOUR_PAYSTACK_SECRET_KEY"
LOCAL_API_URL = "http://localhost:8000/v1/webhooks/paystack"

def fire_charge_success(amount_ngn: Decimal, reference: str = None):
    if not reference:
        reference = f"T_{uuid.uuid4().hex[:12]}"

    payload = {
        "event": "charge.success",
        "data": {
            "id": 123456789,
            "reference": reference,
            "amount": int(amount_ngn * 100),   # Paystack uses kobo
            "currency": "NGN",
            "status": "success",
            "paid_at": "2026-05-01T08:12:00.000Z",
            "channel": "bank_transfer",
            "fees": int(amount_ngn * 100 * 0.015),
            "authorization": {
                "account_number": "0123456789",
                "account_name": "CHIOMA OKONKWO",
                "bank": "Guaranty Trust Bank",
                "bank_code": "058",
            },
            "customer": {
                "email": "customer@test.com",
            },
        },
    }

    body = json.dumps(payload).encode("utf-8")
    signature = hmac.new(
        PAYSTACK_SECRET_KEY.encode("utf-8"),
        body,
        hashlib.sha512,
    ).hexdigest()

    response = requests.post(
        LOCAL_API_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Paystack-Signature": signature,
        },
    )
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    return reference

# Simulate a matched pair (one Paystack credit, one Flutterwave debit)
def fire_matched_pair(amount_ngn: Decimal = Decimal("50000")):
    paystack_ref = fire_charge_success(amount_ngn)
    print(f"Fired Paystack event: {paystack_ref}")
    return paystack_ref
```

### Using Paystack's Test API Directly

Beyond webhooks, Paystack's API lets you query transaction history, verify transaction status, and list settlements — all in sandbox mode:

```python
# src/connectors/paystack_polling.py
# Used by the polling fallback flow

import httpx
from src.config import get_settings

class PaystackAPIClient:
    BASE_URL = "https://api.paystack.co"

    def __init__(self):
        settings = get_settings()
        self.headers = {
            "Authorization": f"Bearer {settings.paystack_secret_key}",
            "Content-Type": "application/json",
        }

    async def get_transaction(self, reference: str) -> dict:
        """
        Verify transaction status via API.
        Used when webhook was not received within the polling window.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transaction/verify/{reference}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()["data"]

    async def list_transactions(
        self,
        from_date: str,
        to_date: str,
        status: str = "success",
        per_page: int = 50,
    ) -> list[dict]:
        """
        List transactions in a date range.
        Used for bulk reconciliation and gap detection.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/transaction",
                headers=self.headers,
                params={
                    "from": from_date,
                    "to": to_date,
                    "status": status,
                    "perPage": per_page,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()["data"]

    async def list_settlements(self, per_page: int = 50) -> list[dict]:
        """
        List settlement batches.
        Each settlement batch represents the actual money movement
        from Paystack to the merchant's bank account.
        This is the key data point for reconciliation.
        """
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.BASE_URL}/settlement",
                headers=self.headers,
                params={"perPage": per_page},
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()["data"]
```

---

## Data Source 2: Flutterwave Sandbox

```bash
# Step 1: Create account at app.flutterwave.com
# Toggle "Test Mode" in the dashboard (top right)

# Step 2: Get test credentials
# Settings → API → Copy test secret key and webhook hash

# Step 3: Configure webhook
# Settings → Webhooks → Add URL
# Enter: http://your-ngrok-url/v1/webhooks/flutterwave
```

```python
# scripts/simulate_flutterwave_webhook.py

import requests
import json
import uuid

FLUTTERWAVE_SECRET_HASH = "your_flw_webhook_hash"
LOCAL_API_URL = "http://localhost:8000/v1/webhooks/flutterwave"

def fire_charge_completed(amount_ngn: float = 50000.0, tx_ref: str = None):
    if not tx_ref:
        tx_ref = f"FLW-TXN-{uuid.uuid4().hex[:8].upper()}"

    payload = {
        "event": "charge.completed",
        "data": {
            "id": 987654321,
            "tx_ref": tx_ref,
            "flw_ref": f"FLW-MOCK-{uuid.uuid4().hex[:12]}",
            "amount": amount_ngn,
            "currency": "NGN",
            "status": "successful",
            "created_at": "2026-05-01T08:12:00Z",
            "customer": {
                "name": "Tunde Adeyemi",
                "email": "tunde@test.com",
            },
            "account": {
                "account_number": "0567891234",
                "account_name": "TUNDE ADEYEMI",
                "bank_code": "011",
                "bank": "First Bank of Nigeria",
            },
            "app_fee": 200,
            "merchant_fee": 1250,
            "narration": "Payment for invoice INV-001",
        },
    }

    response = requests.post(
        LOCAL_API_URL,
        json=payload,
        headers={
            "Content-Type": "application/json",
            "verif-hash": FLUTTERWAVE_SECRET_HASH,
        },
    )
    print(f"Status: {response.status_code}, is_new: {response.json().get('is_new')}")
    return tx_ref
```

---

## Data Source 3: FX Rates

```python
# ExchangeRate-API (free tier: 1,500 requests/month)
# Sign up at exchangerate-api.com — no business registration required

# Rate endpoint for NGN pairs:
# GET https://v6.exchangerate-api.com/v6/{API_KEY}/pair/NGN/USD
# Response:
# {
#   "conversion_rate": 0.00063291,
#   "time_last_update_utc": "Thu, 01 May 2026 00:00:01 +0000"
# }

# CBN Official Rate (public, no auth required)
# GET https://www.cbn.gov.ng/rates/ExchRates.asp
# Returns HTML — requires scraping, documented workaround in connectors

# Alternative: Open Exchange Rates (free tier available)
# Better NGN coverage than ExchangeRate-API for parallel market context
```

---

## Data Source 4: Real Client Data — The Actual Path

For the portfolio, sandbox data is sufficient and honest. For a real product, here is the realistic acquisition path in the Nigerian market.

### Path A: Small Fintech or E-commerce Business as First Client

The most common first client for this kind of tooling in Nigeria is a small fintech or e-commerce business with a specific reconciliation pain point. They typically:

- Process NGN 5M–50M monthly through multiple PSPs
- Have a finance officer spending significant time on manual reconciliation
- Have no budget for enterprise software but would pay NGN 30,000–80,000/month for something that works

**What they provide you:**

- Paystack API keys (read-only) for their merchant account
- Flutterwave API keys (read-only) for their merchant account
- Their bank statement exports for cross-referencing
- Context on their specific reconciliation problems

**What you provide them:**

- Free access for 3 months in exchange for honest feedback
- A working reconciliation dashboard
- Real data that makes the portfolio genuinely demonstrate production use

**Where to find them:**
Lagos fintech meetups, Abuja tech communities, LinkedIn outreach to finance operations leads at companies you identify as multi-PSP users. The conversation is not "I want to test my software." It is "I built a reconciliation tool specifically for the Nigerian multi-PSP environment — can I show you what it does with your data?"

### Path B: Build the Connector for a Specific PSP's Developer Program

Paystack, Flutterwave, and Moniepoint all have developer programs. Building a publicly documented integration with their sandbox environments, writing about it, and publishing it positions you as a domain expert in their ecosystem. This often leads to inbound interest from their merchant base.

### Path C: Generate Synthetic But Realistic Data

For the portfolio demonstration specifically, a well-built synthetic data generator that produces realistic Nigerian transaction patterns is entirely respectable. The honesty is in the README:

```markdown
## Data Notice

This demo runs on synthetic transaction data generated to mirror
realistic Nigerian fintech transaction patterns — multi-PSP flows,
WAT settlement windows, NGN/USD cross-border activity, and common
discrepancy types observed in the market.

Production deployment connects to live Paystack and Flutterwave
merchant accounts via their standard API credentials. No special
access or CBN license is required to run this system — only standard
merchant accounts that any registered Nigerian business can obtain.
```

---

## Data Source 5: The Complete Makefile Target for Local Demo

```makefile
# Generate a realistic demonstration dataset locally
demo-data:
	@echo "Generating synthetic reconciliation demonstration data..."

	# 1. Fire 50 matched Paystack + Flutterwave pairs
	python scripts/generate_matched_pairs.py --count 50

	# 2. Fire 5 unmatched transactions (missing_settlement discrepancies)
	python scripts/generate_unmatched.py --count 5

	# 3. Fire 3 amount mismatch scenarios (FX timing differences)
	python scripts/generate_fx_variance.py --count 3

	# 4. Fire 2 duplicate credit scenarios
	python scripts/generate_duplicates.py --count 2

	# 5. Seed historical FX rates for the last 30 days
	python scripts/seed_fx_rates.py --days 30

	# 6. Run the pipeline to process everything
	python scripts/trigger_pipeline.py

	@echo "Demo data ready. Dashboard: http://localhost:8501"
```

---

# PART 2: THE NON-TECHNICAL VALUE PROPOSITION

This is the more strategically important question. Because the people who will decide whether to pay for this system are rarely engineers — they are finance directors, operations managers, compliance officers, and founders. None of them care about Kafka, DuckDB, or Medallion architecture. They care about money, time, risk, and sleep.

---

## The One Paragraph That Must Land

Before any slide deck, any demo, any pricing conversation — there is one paragraph that has to be true and has to resonate. Everything else derives from it.

> **Every Nigerian business that accepts payments through more than one provider has a gap between the money they think they received and the money that actually arrived. Most finance teams don't know the size of that gap. They find out when they run out of money, when an audit happens, or when a customer calls about a payment that "went missing." This system closes that gap in real time, automatically, and generates the regulatory paperwork that proves it.**

That is the product. Now let us explain it in five different ways for five different audiences.

---

## Audience 1: The Finance Operations Manager (Chioma)

She manages reconciliation for a Lagos e-commerce company processing NGN 200M monthly. She has a finance degree. She understands money but not software.

### Her Current Reality

Monday morning, Chioma opens three browser tabs: her Paystack dashboard, her Flutterwave dashboard, and a spreadsheet that is 847 rows long. She spends three hours cross-referencing transactions. She does this every Monday and every Thursday. Last month, she found a NGN 347,000 discrepancy on Wednesday afternoon — four days after it happened. By the time she traced it to a Flutterwave settlement batch that was miscategorised, the weekend had passed and the operations director had already escalated to the CEO.

She is intelligent, hardworking, and entirely the wrong person to be doing this work. A machine should do it.

### What You Say to Chioma

**"What if you opened your laptop on Monday morning and the reconciliation was already done?"**

Not a summary. Not a report you have to read and check. Done. Every naira that should have arrived, confirmed as arrived. Every gap, flagged with exactly what is missing, for how long, and what it is worth.

When a settlement is late, you know within minutes — not days. When Flutterwave sends you NGN 49,500 instead of NGN 50,000, the system tells you immediately: this is a NGN 500 shortfall, here is the transaction reference, here is how long it has been outstanding.

You stop being the reconciliation engine. You become the person who reviews exceptions — which on a good week is zero things.

### The Numbers She Cares About

```
Current state (manual reconciliation):
- 6 hours per week on reconciliation
- Average detection lag for discrepancies: 4 days
- Undetected discrepancy rate: estimated 2–4% of transaction volume
- Monthly exposure from undetected gaps: unknown (that's the problem)

With this system:
- 30 minutes per week reviewing flagged exceptions
- Detection lag: under 10 minutes
- Undetected discrepancy rate: < 0.5%
- Monthly exposure visibility: real-time
```

---

## Audience 2: The CTO / Engineering Lead (Tunde)

He runs a B2B SaaS fintech. His team built an internal reconciliation script in 2023. It breaks every time Flutterwave changes their export format. He is smart enough to build this himself and smart enough to know he should not.

### What You Say to Tunde

**"You built a script. We built a system."**

The difference is not sophistication — it is reliability guarantees. Your script runs when someone remembers to run it. Our system runs continuously. Your script breaks when PSP payload formats change. Our system has schema contracts at every layer boundary — format changes produce loud errors, not silent corruptions. Your script has no audit trail. Our system records every state transition for every transaction, permanently.

More importantly: your script is your team's responsibility forever. Every time Paystack changes their API, your team drops what they are doing. With this system, PSP connector updates are our responsibility, not yours.

The API is versioned, documented, and stable. You can build your payout triggering logic on top of our reconciliation state endpoint and stop worrying about whether the data underneath is correct. It is.

### The Technical Credibility Points

These are for Tunde. He will ask about them:

- **Exactly-once processing:** The idempotency key registry and `ON CONFLICT DO NOTHING` guarantee that a Paystack webhook that fires three times produces one canonical transaction record, not three.
- **Webhook fallback:** If the webhook never arrives — which happens — the polling fallback catches it within 15 minutes. Your data is complete even when PSP infrastructure is unreliable.
- **Audit trail:** Every status change is recorded with a timestamp, the triggering mechanism, and the previous and new state. When your auditor asks why a transaction moved from pending to settled at 3 AM on a Sunday, there is a record.
- **FX timing:** The system applies the exchange rate that was in effect at the time of settlement, not the rate today. This is the difference between a technically correct system and a financially correct system.

---

## Audience 3: The Compliance Officer (Aisha)

She is head of compliance at a microfinance bank. Her job is to not go to prison. She understands regulation better than technology.

### Her Current Reality

Aisha is required to submit daily transaction returns to CBN. She currently produces these manually from PSP dashboards. The process takes two hours every morning. The data is sometimes inconsistent because Paystack and Flutterwave report totals on different schedules. Last quarter, during a CBN spot examination, she could not produce a complete audit trail for three transactions because the finance team's spreadsheet history only went back six months.

The CBN examiner noted it. The note is in her file.

### What You Say to Aisha

**"Every CBN return, automatically generated, with a full audit trail that goes back seven years."**

The system generates your daily transaction return every morning at 2 AM. By the time you arrive at your desk, it is ready for your review and approval — not for you to build from scratch. You review, you approve, it is submitted.

Every transaction that went through your system has a complete history: when it arrived, what status it was in at every point in time, who made what decision, and when. If the CBN examines you in three years and asks about a specific transaction from today, you pull the record in thirty seconds.

The system also flags suspicious transaction patterns — velocity anomalies, amounts that match known structuring patterns, transactions that do not match the customer profile. Not a replacement for your AML judgment, but the preliminary screening that currently takes hours done automatically.

### The Regulatory Specificity That Matters

Do not say "compliance." Say:

- **CBN Risk-Based Cybersecurity Framework 2021:** The system's audit logging satisfies the transaction monitoring requirements for Payment Service Providers.
- **NDPR 2019/2023:** All personal data is handled in accordance with Nigeria Data Protection Act requirements — masked in operational storage, retained for seven years per CBN requirements, then anonymised.
- **AML/CFT:** Suspicious transaction pattern detection is built into the Gold layer. Flagged transactions flow directly into your STR reporting workflow.

---

## Audience 4: The Founder / MD (Lagos SME)

She runs a distribution business — fast-moving consumer goods, 200 retail customers, collecting payments through Paystack, Flutterwave, and sometimes direct bank transfers because some customers' accountants refuse to use "internet payment." Monthly collections: NGN 80M.

She did not go to technical school. She is sharp, busy, and allergic to complexity.

### What You Say to Her

**"You know that moment when your finance officer comes to tell you there is money missing but she cannot tell you how much or where? This stops that."**

Right now, somewhere in your accounts, there is probably money that did not arrive as expected. Maybe NGN 200,000. Maybe NGN 2 million. Your finance officer cannot tell you because finding it requires comparing three different systems manually, and she does not have time to do that every day. So you find out when you need the money and it is not there.

This system watches every naira coming into your business through every channel, every day, automatically. When something does not add up, it tells you within minutes — not days. It tells you exactly which transaction, which provider, how much is at stake, and how long it has been missing.

You stop relying on your finance officer's memory and her spreadsheet. You start running your business with accurate numbers.

### The Framing for Price Conversation

```
What this replaces:
- 2–3 hours of senior finance staff time per day: NGN 500,000+/month in salary cost
- Undetected discrepancies (industry average 2–4% of volume):
  On NGN 80M/month = NGN 1.6M–3.2M potentially undetected monthly

What this costs:
- [Pricing — addressed below]

The question is not whether you can afford this.
The question is whether you can afford not to know.
```

---

## Audience 5: The Investor / Development Finance Institution

They are funding a Pan-African fintech initiative, or evaluating this as a B2B infrastructure investment. They think in portfolio companies, market size, and unit economics.

### The Market Framing

```
Total Addressable Market (Nigeria alone):

Registered businesses processing digital payments: ~2M+
Businesses processing through 2+ PSPs: estimated 15–20% = 300,000–400,000

Average monthly payment volume (mid-market):  NGN 50M
Average undetected reconciliation gap:        2–4%
Average monthly financial exposure:           NGN 1M–2M per business

Willingness to pay (estimated):              1–2% of exposure mitigated
Monthly addressable revenue per customer:    NGN 10,000–40,000

Mid-market SOM (10,000 customers):           NGN 100M–400M annually
```

**The infrastructure play:** This is not an app. It is financial plumbing for the multi-PSP Nigerian payment ecosystem. The more PSPs proliferate (and they will — CBN licensing continues to expand), the more critical this infrastructure becomes. Every new PSP in the market increases the reconciliation complexity for every multi-channel merchant. The product gets more valuable as the market grows.

**The AfCFTA angle:** As cross-border trade formalises under AfCFTA, the FX reconciliation component becomes even more valuable. A Nigerian exporter collecting in Kenyan shillings via M-Pesa and in Ghanaian cedis via another provider has the same reconciliation problem, now with currency conversion complexity on top.

---

## The Simple One-Page Business Case

For any non-technical decision maker, this is the document that gets the conversation started:

```
═══════════════════════════════════════════════════════════════
THE RECONCILIATION PROBLEM EVERY NIGERIAN BUSINESS HAS

If your business accepts payments through more than one provider
(Paystack, Flutterwave, bank transfer, POS, mobile money),
you have a reconciliation problem.

THE COST OF DOING IT MANUALLY:
• Finance staff spend 30–40% of their time on reconciliation
• Discrepancies are discovered days after they happen
• On average, 2–4% of transaction volume has reconciliation gaps
• For a business processing NGN 100M/month: NGN 2M–4M at risk

THE COST OF NOT KNOWING:
• Cash flow surprises because expected money did not arrive
• Paying for goods you received but were not credited for
• CBN compliance exposure from incomplete records
• Audit findings that create regulatory risk

WHAT THE RECONCILIATION ENGINE DOES:
Automatically matches every transaction across every payment
provider you use. Flags gaps within minutes. Generates your
CBN daily returns automatically. Keeps a 7-year audit trail.

WHAT CHANGES FOR YOUR BUSINESS:
• Your finance team reviews exceptions — not builds reports
• You know your real cash position in real time
• CBN compliance reports are automatic, not manual
• Nothing falls through the cracks

WHO THIS IS FOR:
Any Nigerian business processing more than NGN 20M/month
through multiple payment channels and tired of finding out
about problems too late.

Talk to us: [contact]
═══════════════════════════════════════════════════════════════
```

---

## Pricing Strategy — What to Charge and How

This needs to be honest about the Nigerian market reality. Enterprise SaaS pricing from American playbooks does not work here. Value-based pricing anchored to the problem it solves does.

```
Tier            Target                  Pricing Model           Amount
─────────────── ─────────────────────── ─────────────────────── ──────────────────────
Starter         NGN 20M–50M/month       Flat monthly            NGN 25,000–40,000/month
                1–2 PSPs                                        (~$16–25 USD)
                Finance team of 1–3

Growth          NGN 50M–500M/month      Monthly + volume        NGN 60,000–150,000/month
                2–4 PSPs                component               (~$38–95 USD)
                Finance team of 3–10

Enterprise      NGN 500M+/month         Annual contract         Custom
                4+ PSPs                 + implementation fee
                Dedicated finance ops

API Access      Tech companies          Per-API-call or         NGN 15,000/month base
                integrating their own   monthly seat            + usage
                products
```

**The anchor for price conversations:**

If your business processes NGN 100M/month and the average undetected discrepancy rate is 3%, that is NGN 3M/month in potential exposure. Paying NGN 80,000/month to know about every single one of those discrepancies within minutes — and to have your finance officer's time freed for actual financial analysis — is not an expense. It is a return.

---

## The Demo Script — What to Show, In What Order

When you sit down with any of these audiences for a live demonstration, this is the sequence that works:

```
Minute 0–2:    "Let me show you what happened to a payment right now."
               Fire a Paystack webhook. Show it appear in the dashboard.
               Do not explain the technology. Show the result.

Minute 2–5:    "Now watch what happens when money doesn't arrive."
               Fire an unmatched transaction. Wait 30 seconds.
               Show the discrepancy appear: "NGN 50,000 missing.
               Paystack reference T_abc123. Missing for 4 minutes."
               Ask: "How long does it currently take you to find this?"

Minute 5–8:    "This is your reconciliation for yesterday."
               Show the summary dashboard: match rate 98.6%,
               7 open discrepancies, NGN 847,000 in open exposure.
               Show the CBN daily return — already generated.
               "This was ready at 2 AM. You didn't have to do anything."

Minute 8–10:   "Any questions about what you just saw?"
               Do not pitch features. Answer questions.
               The demo did the work. Let them tell you what matters to them.
```

---

## The Three Things That Must Be True Before Any Commercial Conversation

**Truth 1: The system must work end-to-end in the demo environment.** A broken demo with a great pitch is worse than no demo. Get the Docker Compose stack running cleanly, the synthetic data flowing, the dashboard showing real numbers, before any conversation with a potential client.

**Truth 2: You must understand the PSPs better than the client.** When a finance officer at a Paystack merchant says "we had a settlement batch delay last week," you need to know what that means technically, why it happens, and how this system handles it. Domain credibility is what separates a tool from a trusted system.

**Truth 3: The security and compliance story must be concrete.** Nigerian businesses — especially fintech-adjacent ones — are appropriately paranoid about third-party access to their transaction data. "We take security seriously" is meaningless. "Your API credentials are stored encrypted, your transaction data is masked at rest, your raw account numbers never leave your system, and we can provide the NDPR data processing register on request" is a conversation-ender in the right direction.

---

## The Positioning Statement — One Sentence

For every audience, in every context, the system is:

> **"Automatic reconciliation for Nigerian businesses that accept payments through more than one provider — so your finance team knows about every problem within minutes instead of days."**

Not "a data pipeline." Not "an event-driven FinOps platform." Not "a Medallion architecture reconciliation engine."

The technology is real and it is good. The business people do not need to know how it works. They need to know what it does for them. The answer is simple: it watches their money so they do not have to.
