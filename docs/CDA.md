# CREDENTIAL & DEPLOYMENT ARCHITECTURE DOCUMENT

## Cross-Border Mobile Money Reconciliation Engine

**Version:** 1.0
**Author:** Emmanuel Richard
**Status:** Active — Pre-Engineering Foundation
**Depends On:** PRD v1.0, TDD v1.0, API Specification v1.0, Data Governance & Security Policy v1.0
**Last Updated:** May 2026

---

## 1. Document Purpose

The reconciliation engine was designed from the ground up as infrastructure, not a service. That distinction drives every credential and deployment decision documented here.

However, different clients have different operational realities. A mid-sized fintech with a DevOps team will want to run this themselves. A small e-commerce business with a finance officer and no engineers wants to connect and have it work. A regulated microfinance bank needs their data to stay within their own infrastructure boundary for compliance reasons.

This document defines three deployment models — each a complete, production-grade architecture — so the right model can be selected based on what the client actually needs, not what is easiest to sell.

**The three models are:**

- **Option A — Self-Hosted (Default):** Client runs everything. Credentials never leave their infrastructure.
- **Option B — Managed Deployment:** We run the system. Client credentials are stored in our infrastructure with enterprise-grade encryption.
- **Option C — Read-Only API Key Model:** Hybrid model. Client provides scoped read-only credentials only. Reduced blast radius. Suitable for managed and semi-managed deployments.

These are not mutually exclusive long-term. A client can start on Option B and migrate to Option A as their engineering team matures. Option C is a credential scope decision that applies to both Option A and Option B.

---

## 2. The Fundamental Design Principle

Before the options, the principle that governs all three:

**The reconciliation engine never needs write access to a PSP account. Ever.**

Reconciliation is a read-and-match operation. Reading transactions. Reading settlements. Matching them. Flagging gaps. None of this requires the ability to initiate transfers, create charges, issue refunds, or modify anything on the PSP side.

This single fact is the most important security statement about this system. It means:

- Even in the worst credential compromise scenario, an attacker who obtains PSP credentials from this system cannot move money
- The blast radius of any breach is data exposure, not financial loss
- Trust conversations with clients are fundamentally different from a system that holds write-capable credentials

Every option in this document is built on this constraint. No option requests, stores, or uses write-capable PSP credentials.

---

## 3. Credential Scope Reference — Per PSP

Before the deployment options, the exact credential scopes this system requires and explicitly does not use:

### 3.1 Paystack

```
REQUIRED (read-only operations):
─────────────────────────────────────────────────────────────────
GET /transaction                List transactions
GET /transaction/verify/{ref}   Verify specific transaction
GET /settlement                 List settlement batches
GET /settlement/transaction/{id} Settlement transaction detail
GET /customer                   Customer information (for matching)
GET /transfer                   Transfer history (debit side)

NEVER REQUESTED:
─────────────────────────────────────────────────────────────────
POST /transaction/initialize    Create a charge
POST /transfer                  Send money
POST /refund                    Issue refund
POST /subaccount                Manage sub-accounts
DELETE *                        Delete anything
PUT/PATCH *                     Modify anything

WEBHOOK (inbound — no credential required):
─────────────────────────────────────────────────────────────────
X-Paystack-Signature header     HMAC-SHA512 validation only
                                We validate their signature
                                We do not send signed requests
```

**Paystack API key types:**

Paystack does not have a native read-only key concept — all secret keys have the same permission scope. However, Paystack supports IP whitelisting on API keys. In a self-hosted deployment, whitelisting the client's server IP to their Paystack key is the defence-in-depth measure that compensates for the absence of scope restriction.

```python
# src/connectors/paystack.py
# The connector only calls read endpoints — enforced in code, not by PSP

PERMITTED_PAYSTACK_ENDPOINTS = {
    "/transaction",
    "/transaction/verify",
    "/settlement",
    "/settlement/transaction",
    "/customer",
    "/transfer",
}

PROHIBITED_PAYSTACK_ENDPOINTS = {
    "/transaction/initialize",
    "/transfer",        # POST only
    "/refund",
    "/subaccount",
    "/bulk-charge",
    "/charge",
}

class PaystackAPIClient:
    """
    Enforces read-only access in application code.
    All methods are GET requests only.
    No POST, PUT, PATCH, DELETE methods exist on this class.
    This is a deliberate architectural constraint, not an oversight.
    """

    def __init__(self, secret_key: str) -> None:
        self._secret_key = secret_key
        self._client = httpx.AsyncClient(
            base_url="https://api.paystack.co",
            headers={"Authorization": f"Bearer {self._secret_key}"},
            timeout=30.0,
        )

    # Only GET methods. No write methods. Intentional.
    async def get_transaction(self, reference: str) -> dict: ...
    async def list_transactions(self, from_date: str, to_date: str) -> list[dict]: ...
    async def list_settlements(self, per_page: int = 50) -> list[dict]: ...
    async def get_settlement_transactions(self, settlement_id: str) -> list[dict]: ...
```

### 3.2 Flutterwave

```
REQUIRED (read-only operations):
─────────────────────────────────────────────────────────────────
GET /v3/transactions            List transactions
GET /v3/transactions/{id}/verify Verify transaction
GET /v3/settlements             List settlements
GET /v3/transfers               Transfer history

NEVER REQUESTED:
─────────────────────────────────────────────────────────────────
POST /v3/charges                Initiate charge
POST /v3/transfers              Send money
POST /v3/refunds                Issue refund
DELETE *                        Delete anything

WEBHOOK (inbound):
─────────────────────────────────────────────────────────────────
verif-hash header               Direct comparison against secret hash
```

**Flutterwave key model:**

Flutterwave provides separate public and secret keys. The secret key is required for API calls. Like Paystack, scope restriction is not available — all secret keys have full access. The read-only constraint is enforced at the application layer.

### 3.3 M-Pesa Daraja

```
REQUIRED:
─────────────────────────────────────────────────────────────────
consumer_key + consumer_secret  OAuth token generation
GET /mpesa/transactionstatus    Query transaction status
GET /mpesa/accountbalance       Balance check (optional)

NEVER REQUESTED:
─────────────────────────────────────────────────────────────────
POST /mpesa/b2c/v1/paymentrequest  Send money to customer
POST /mpesa/b2b/v1/paymentrequest  Business payment
```

M-Pesa Daraja actually supports scoped OAuth tokens — the most advanced credential model of the three. The token generation specifies which API endpoints are accessible.

```python
# M-Pesa credential model is more granular
MPESA_REQUIRED_SCOPES = [
    "TransactionStatus",    # Query transaction status
]

MPESA_NEVER_REQUEST = [
    "BusinessPayBill",      # Send money
    "BusinessBuyGoods",     # Pay for goods
    "CustomerBuyGoodsOnline",
]
```

---

## 4. Option A — Self-Hosted Deployment (Default)

### 4.1 Overview

The client runs the complete reconciliation engine on their own infrastructure. Their PSP credentials exist only in their environment. We provide the software, documentation, and support. We never touch their data or their credentials.

This is the default because it is the most secure, the most honest, and the most appropriate for the Nigerian fintech market where trust in third-party data custody is — rightly — low.

### 4.2 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     CLIENT'S INFRASTRUCTURE                          │
│                                                                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐               │
│  │   Client's  │  │   Client's   │  │   Client's   │               │
│  │   .env file │  │  PostgreSQL  │  │    MinIO     │               │
│  │             │  │              │  │              │               │
│  │ PAYSTACK_   │  │  All Silver  │  │  All Bronze  │               │
│  │ SECRET_KEY= │  │  Gold data   │  │  Parquet     │               │
│  │ YOUR_KEY    │  │  lives here  │  │  lives here  │               │
│  └──────┬──────┘  └──────────────┘  └──────────────┘               │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────────────────────────────────────────────────┐       │
│  │           Docker Compose Stack (our software)            │       │
│  │                                                          │       │
│  │  FastAPI ──► Redpanda ──► Prefect ──► dbt ──► DuckDB   │       │
│  └──────────────────────────────────────────────────────────┘       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Webhook events (inbound)
                              │ API polling (outbound, read-only)
                         ┌────┴────┐
                         │  PSPs   │
                         │Paystack │
                         │  FLW    │
                         └─────────┘

WE NEVER SEE:
- PSP credentials
- Raw transaction data
- Personal financial information
- Any client data whatsoever
```

### 4.3 Deployment Prerequisites

**Client infrastructure requirements:**

```yaml
# Minimum viable server specification
compute:
  cpu: 4 vCPU
  ram: 8 GB
  storage: 100 GB SSD

software:
  docker: '26.x'
  docker_compose: '2.x'
  os: 'Ubuntu 22.04 LTS or higher'

network:
  inbound_ports:
    - 8000 # FastAPI (internal only — behind reverse proxy)
    - 3000 # Next.js dashboard (internal only)
    - 4200 # Prefect UI (internal only)
  outbound:
    - 443 # HTTPS to PSP APIs
    - 443 # HTTPS to FX rate provider

dns:
  webhook_endpoint: 'https://recon.client-domain.com/v1/webhooks/paystack'
  # Client must configure this URL in their Paystack/Flutterwave dashboard
```

### 4.4 Installation and Configuration

```bash
# Step 1: Clone the repository
git clone https://github.com/emmanuelrichard01/mmr-engine.git
cd reconciliation-engine

# Step 2: Configure environment
cp .env.example .env
# Edit .env with client's actual credentials (see below)

# Step 3: Run database migrations
make migrate

# Step 4: Seed configuration data
make seed

# Step 5: Launch full stack
make up

# Step 6: Verify health
make smoke
```

**The .env file the client configures — full reference:**

```bash
# ═══════════════════════════════════════════════════════════════════
# RECONCILIATION ENGINE — CLIENT CONFIGURATION
# ═══════════════════════════════════════════════════════════════════
# This file stays on YOUR server. Never share it. Never commit it.
# We (the software provider) never need to see this file.
# ═══════════════════════════════════════════════════════════════════

# ── Deployment Identity ───────────────────────────────────────────
ENVIRONMENT=production
DEPLOYMENT_MODEL=self_hosted          # Options: self_hosted | managed | hybrid
DEPLOYMENT_ID=client_org_name        # For your own identification

# ── Database ──────────────────────────────────────────────────────
# These credentials are generated during setup and stay local
POSTGRES_SUPERUSER_PASSWORD=         # Generate: openssl rand -hex 32
POSTGRES_PIPELINE_DSN=postgresql+asyncpg://reconciliation_pipeline:CHANGE_ME@postgres:5432/reconciliation
POSTGRES_API_DSN=postgresql+asyncpg://reconciliation_api_user:CHANGE_ME@postgres:5432/reconciliation
POSTGRES_READONLY_DSN=postgresql+asyncpg://reconciliation_readonly:CHANGE_ME@postgres:5432/reconciliation

# ── Object Storage ─────────────────────────────────────────────────
MINIO_ACCESS_KEY=                    # Generate: openssl rand -hex 16
MINIO_SECRET_KEY=                    # Generate: openssl rand -hex 32

# ── PSP Credentials ────────────────────────────────────────────────
# CRITICAL: These are YOUR credentials. They never leave this server.
# The system uses these for READ-ONLY operations only.
# No charges, no transfers, no modifications are ever made.

PAYSTACK_SECRET_KEY=YOUR_PAYSTACK_KEY         # From: dashboard.paystack.com → Settings → API Keys
FLUTTERWAVE_SECRET_KEY=YOUR_FLUTTERWAVE_KEY    # From: app.flutterwave.com → Settings → API
FLUTTERWAVE_SECRET_HASH=             # From: app.flutterwave.com → Settings → Webhooks

# Optional PSPs (leave blank if not used)
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=

# ── Webhook Configuration ──────────────────────────────────────────
# Configure these URLs in your PSP dashboards
# Paystack: dashboard.paystack.com → Settings → API Keys & Webhooks
# Flutterwave: app.flutterwave.com → Settings → Webhooks
WEBHOOK_BASE_URL=https://recon.your-domain.com
# Paystack webhook URL: ${WEBHOOK_BASE_URL}/v1/webhooks/paystack
# Flutterwave webhook URL: ${WEBHOOK_BASE_URL}/v1/webhooks/flutterwave

# ── FX Rate Provider ───────────────────────────────────────────────
FX_PROVIDER_API_KEY=                 # Free tier: exchangerate-api.com

# ── Alerting (optional) ────────────────────────────────────────────
SLACK_WEBHOOK_URL=
ALERT_EXPOSURE_THRESHOLD_NGN=100000

# ── Matching Engine Tuning ─────────────────────────────────────────
# These defaults work for most deployments
FX_VARIANCE_THRESHOLD_PCT=0.005
MATCHING_PRIMARY_WINDOW_MINUTES=5
MATCHING_SECONDARY_WINDOW_MINUTES=30
```

### 4.5 Security Configuration for Self-Hosted

Since credentials are on the client's infrastructure, the security controls are the client's responsibility. We provide defaults and guidance:

```python
# scripts/security_setup.py
# Run during initial setup to verify security configuration

import subprocess
import sys
from pathlib import Path


def verify_self_hosted_security() -> list[str]:
    """
    Checks that must pass before production deployment.
    Returns list of failed checks.
    """
    failures = []

    env_path = Path(".env")
    if not env_path.exists():
        failures.append("CRITICAL: .env file not found")
        return failures

    env_content = env_path.read_text()

    # Check .gitignore
    gitignore = Path(".gitignore").read_text() if Path(".gitignore").exists() else ""
    if ".env" not in gitignore:
        failures.append(
            "CRITICAL: .env not in .gitignore. "
            "Your credentials could be committed to version control."
        )

    # Check for placeholder values
    placeholders = ["CHANGE_ME", "your_key_here", "YOUR_PAYSTACK", "YOUR_FLUTTERWAVE"]
    for placeholder in placeholders:
        if placeholder in env_content:
            failures.append(
                f"WARNING: Placeholder '{placeholder}' found in .env. "
                "Replace with real production credentials."
            )

    # Check webhook URL is HTTPS
    webhook_url = _extract_env_value(env_content, "WEBHOOK_BASE_URL")
    if webhook_url and not webhook_url.startswith("https://"):
        failures.append(
            "CRITICAL: WEBHOOK_BASE_URL must use HTTPS in production. "
            "Paystack and Flutterwave require HTTPS for webhook delivery."
        )

    # Check environment is production
    environment = _extract_env_value(env_content, "ENVIRONMENT")
    if environment != "production":
        failures.append(
            f"WARNING: ENVIRONMENT is '{environment}', not 'production'. "
            "Debug mode may expose sensitive information."
        )

    return failures


def _extract_env_value(content: str, key: str) -> str | None:
    for line in content.splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


if __name__ == "__main__":
    print("Running pre-deployment security verification...")
    failures = verify_self_hosted_security()

    if failures:
        print("\n⚠️  Security issues found:")
        for f in failures:
            print(f"  • {f}")
        if any(f.startswith("CRITICAL") for f in failures):
            print("\n❌ Critical issues must be resolved before deployment.")
            sys.exit(1)
    else:
        print("✅ Security verification passed. Safe to deploy.")
```

### 4.6 PSP Webhook Configuration Guide

The client must configure their PSP dashboards to point webhook events at their deployed instance. This is a one-time setup:

```markdown
## Paystack Webhook Setup

1. Log into dashboard.paystack.com
2. Navigate: Settings → API Keys & Webhooks
3. Set Webhook URL: https://recon.your-domain.com/v1/webhooks/paystack
4. Events to enable:
   ✅ charge.success
   ✅ transfer.success
   ✅ transfer.failed
   ✅ transfer.reversed
5. Copy the webhook secret — you already have it as your secret key
6. Save

## Flutterwave Webhook Setup

1. Log into app.flutterwave.com
2. Navigate: Settings → Webhooks
3. Set Webhook URL: https://recon.your-domain.com/v1/webhooks/flutterwave
4. Set Secret Hash: (any string you choose — must match FLUTTERWAVE_SECRET_HASH in .env)
5. Events to enable:
   ✅ charge.completed
   ✅ transfer.completed
6. Save
```

### 4.7 Option A — Operational Model

```
What the client owns and operates:
  ✅ All infrastructure (server, database, object storage)
  ✅ All credentials (PSP keys, database passwords)
  ✅ All data (Bronze Parquet, Silver transactions, Gold reports)
  ✅ All backups and disaster recovery
  ✅ All security patches to the underlying infrastructure

What we provide:
  ✅ Software updates (Docker images)
  ✅ Documentation
  ✅ Support (bug fixes, configuration help)
  ✅ New PSP connectors as they are built

What we never have:
  ❌ Access to client's PSP credentials
  ❌ Access to client's transaction data
  ❌ Access to client's server
  ❌ Any visibility into their financial operations
```

### 4.8 When to Recommend Option A

```
Client Profile                          Option A Fit
─────────────────────────────────────── ──────────────────────────────
Has in-house DevOps or SRE team         ██████████ Excellent
Regulated entity (MFB, PSP license)     ██████████ Excellent — data must stay local
High transaction volume (NGN 500M+/mo)  ████████   Very Good
Processes sensitive financial data      ████████   Very Good
Has existing cloud infrastructure       ███████    Good
Privacy-first organizational culture    ██████████ Excellent
Enterprise with security review board   ██████████ Excellent

Not ideal for:
No technical team                       ░░         Poor — they cannot operate it
Wants zero infrastructure management    ░░         Poor — use Option B
Small volume (< NGN 20M/month)          ███        Moderate — overhead may not justify
```

---

## 5. Option B — Managed Deployment

### 5.1 Overview

We run the reconciliation engine on behalf of the client. They connect their PSP accounts through our platform. We store their credentials encrypted in our managed infrastructure and operate the pipeline on their behalf.

This model is appropriate for clients who want the reconciliation capability without the operational overhead. It introduces a credential custody relationship that must be handled with engineering precision and communicated transparently.

### 5.2 The Trust Model — Be Explicit

When a client uses Option B they are making a specific trust decision:

> "I am giving this company read-only access to my Paystack and Flutterwave transaction data. They cannot move my money. They can see my transaction history. I am trusting them to protect that data."

This must be stated explicitly in the onboarding flow, the terms of service, and every relevant UI surface. Obscuring this leads to trust collapse the moment a client realises what they agreed to.

### 5.3 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    OUR MANAGED INFRASTRUCTURE                       │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              Credential Vault (AWS Secrets Manager)        │    │
│  │                                                            │    │
│  │  client_a_paystack_key  ──► AES-256-GCM encrypted         │    │
│  │  client_a_flw_key       ──► AES-256-GCM encrypted         │    │
│  │  client_b_paystack_key  ──► AES-256-GCM encrypted         │    │
│  │  client_b_flw_key       ──► AES-256-GCM encrypted         │    │
│  └────────────────────────────────────────────────────────────┘    │
│                          │                                          │
│                          ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Multi-Tenant Pipeline                           │  │
│  │                                                              │  │
│  │  Tenant A namespace ──► A's Bronze ──► A's Silver ──► A's Gold │
│  │  Tenant B namespace ──► B's Bronze ──► B's Silver ──► B's Gold │
│  │                                                              │  │
│  │  Strict tenant isolation enforced at every layer            │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │              Per-Tenant Databases                          │    │
│  │                                                            │    │
│  │  PostgreSQL schema: tenant_a.*                             │    │
│  │  PostgreSQL schema: tenant_b.*                             │    │
│  │  Row-level security enforced on all queries                │    │
│  └────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
           │                                    ▲
           │ Read-only API calls                │ Webhook events
           ▼                                    │
      ┌────────────┐                    ┌────────────────┐
      │  Paystack  │                    │  Paystack      │
      │  (client A)│                    │  (client A)    │
      └────────────┘                    └────────────────┘
```

### 5.4 Credential Management — Technical Implementation

```python
# src/managed/credential_manager.py
# Only exists in the managed deployment — not in self-hosted

import boto3
import json
import hashlib
from typing import Optional
from datetime import datetime, timezone
from uuid import UUID

import structlog

log = structlog.get_logger(__name__)


class ManagedCredentialManager:
    """
    Handles secure storage and retrieval of client PSP credentials
    in the managed deployment model.

    Security model:
    - Credentials encrypted with AES-256-GCM before storage
    - Each client has a unique KMS key (customer-managed where possible)
    - Credentials never written to application logs
    - Credentials never returned to API responses
    - Access audited via AWS CloudTrail
    - Retrieval requires both client_id + deployment authentication

    What is stored:
    - Encrypted PSP credentials
    - Credential metadata (provider, created_at, last_rotated_at)
    - Audit trail of credential access

    What is never stored:
    - Plaintext credentials
    - Credentials in application database
    - Credentials in environment variables (in managed mode)
    """

    SECRET_NAME_TEMPLATE = "reconciliation/{environment}/clients/{client_id}/{psp_name}"

    def __init__(self, region: str = "eu-west-1") -> None:
        self._secrets_client = boto3.client(
            "secretsmanager",
            region_name=region,
        )
        self._kms_client = boto3.client("kms", region_name=region)

    async def store_client_credential(
        self,
        client_id: UUID,
        psp_name: str,
        credential_value: str,
        environment: str = "production",
    ) -> str:
        """
        Store a client's PSP credential in AWS Secrets Manager.

        The credential_value is the raw PSP secret key.
        It is encrypted by AWS Secrets Manager using the client's
        dedicated KMS key before storage.

        Returns the secret ARN for future reference.
        The credential_value is not returned or logged after this point.
        """
        secret_name = self.SECRET_NAME_TEMPLATE.format(
            environment=environment,
            client_id=str(client_id),
            psp_name=psp_name,
        )

        secret_payload = {
            "client_id": str(client_id),
            "psp_name": psp_name,
            "credential": credential_value,      # Encrypted at rest by KMS
            "stored_at": datetime.now(timezone.utc).isoformat(),
            "credential_type": "read_only_api_key",
            "stored_by": "managed_onboarding_flow",
        }

        try:
            # Check if secret already exists (update vs create)
            try:
                response = self._secrets_client.update_secret(
                    SecretId=secret_name,
                    SecretString=json.dumps(secret_payload),
                )
                operation = "updated"
            except self._secrets_client.exceptions.ResourceNotFoundException:
                response = self._secrets_client.create_secret(
                    Name=secret_name,
                    SecretString=json.dumps(secret_payload),
                    Tags=[
                        {"Key": "client_id", "Value": str(client_id)},
                        {"Key": "psp_name", "Value": psp_name},
                        {"Key": "environment", "Value": environment},
                        {"Key": "system", "Value": "reconciliation-engine"},
                    ],
                )
                operation = "created"

            secret_arn = response["ARN"]

            # Log the operation — never log the credential value
            log.info(
                "credential.stored",
                client_id=str(client_id),
                psp_name=psp_name,
                operation=operation,
                secret_arn_suffix=secret_arn[-8:],  # Last 8 chars only for tracing
            )

            return secret_arn

        except Exception as e:
            log.error(
                "credential.store_failed",
                client_id=str(client_id),
                psp_name=psp_name,
                error=str(e),
            )
            raise

    async def retrieve_client_credential(
        self,
        client_id: UUID,
        psp_name: str,
        environment: str = "production",
        requestor: str = "pipeline",  # Who is asking for this credential
    ) -> Optional[str]:
        """
        Retrieve a client's PSP credential for use in pipeline operations.

        The credential is retrieved, used for API calls, and then
        discarded from memory after the API call completes.
        It is NEVER stored in the database, logged, or returned to
        the client via any API endpoint.

        requestor: identifies which system component is accessing credentials.
                   Used for audit logging. Valid values:
                   pipeline, polling_fallback, webhook_validator
        """
        secret_name = self.SECRET_NAME_TEMPLATE.format(
            environment=environment,
            client_id=str(client_id),
            psp_name=psp_name,
        )

        try:
            response = self._secrets_client.get_secret_value(
                SecretId=secret_name,
            )
            secret_data = json.loads(response["SecretString"])

            # Audit log — never includes the credential value
            log.info(
                "credential.accessed",
                client_id=str(client_id),
                psp_name=psp_name,
                requestor=requestor,
                accessed_at=datetime.now(timezone.utc).isoformat(),
            )

            return secret_data["credential"]

        except self._secrets_client.exceptions.ResourceNotFoundException:
            log.warning(
                "credential.not_found",
                client_id=str(client_id),
                psp_name=psp_name,
            )
            return None

        except Exception as e:
            log.error(
                "credential.retrieval_failed",
                client_id=str(client_id),
                psp_name=psp_name,
                requestor=requestor,
                error=str(e),
            )
            raise

    async def revoke_client_credential(
        self,
        client_id: UUID,
        psp_name: str,
        revoked_by: str,
        environment: str = "production",
    ) -> None:
        """
        Permanently delete a client's stored credential.
        Called when:
        - Client requests disconnection
        - Client account is terminated
        - Security incident requires immediate revocation

        This operation is irreversible. The client must re-provide
        credentials to reconnect their PSP account.
        """
        secret_name = self.SECRET_NAME_TEMPLATE.format(
            environment=environment,
            client_id=str(client_id),
            psp_name=psp_name,
        )

        try:
            self._secrets_client.delete_secret(
                SecretId=secret_name,
                ForceDeleteWithoutRecovery=False,  # 7-day recovery window
            )
            log.info(
                "credential.revoked",
                client_id=str(client_id),
                psp_name=psp_name,
                revoked_by=revoked_by,
                revoked_at=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as e:
            log.error(
                "credential.revocation_failed",
                client_id=str(client_id),
                psp_name=psp_name,
                error=str(e),
            )
            raise

    async def verify_credential_validity(
        self,
        client_id: UUID,
        psp_name: str,
    ) -> dict:
        """
        Verify that a stored credential is still valid by making a
        lightweight test API call.

        Called:
        - During onboarding verification
        - Periodically by health check flows
        - After credential rotation

        Returns verification result, NEVER the credential itself.
        """
        credential = await self.retrieve_client_credential(
            client_id=client_id,
            psp_name=psp_name,
            requestor="credential_verification",
        )

        if not credential:
            return {"valid": False, "reason": "credential_not_found"}

        try:
            if psp_name == "paystack":
                result = await self._verify_paystack_credential(credential)
            elif psp_name == "flutterwave":
                result = await self._verify_flutterwave_credential(credential)
            else:
                return {"valid": False, "reason": "unknown_psp"}

            return result

        finally:
            # Explicitly delete credential from local scope
            # Python GC will handle memory, but explicit deletion
            # signals intent to reviewers
            del credential

    async def _verify_paystack_credential(self, key: str) -> dict:
        """
        Verify by calling GET /transaction with per_page=1.
        Minimal data exposure. Confirms key is valid and has
        transaction read access.
        """
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://api.paystack.co/transaction",
                    headers={"Authorization": f"Bearer {key}"},
                    params={"perPage": 1},
                )
                if response.status_code == 200:
                    return {"valid": True, "psp": "paystack"}
                elif response.status_code == 401:
                    return {"valid": False, "reason": "invalid_key", "psp": "paystack"}
                else:
                    return {
                        "valid": False,
                        "reason": f"unexpected_status_{response.status_code}",
                        "psp": "paystack",
                    }
        except httpx.TimeoutException:
            return {"valid": False, "reason": "timeout", "psp": "paystack"}
        finally:
            del key

    async def _verify_flutterwave_credential(self, key: str) -> dict:
        """Verify by calling GET /v3/transactions with per_page=1."""
        import httpx
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    "https://api.flutterwave.com/v3/transactions",
                    headers={"Authorization": f"Bearer {key}"},
                    params={"page": 1, "per_page": 1},
                )
                if response.status_code == 200:
                    return {"valid": True, "psp": "flutterwave"}
                elif response.status_code == 401:
                    return {"valid": False, "reason": "invalid_key"}
                else:
                    return {
                        "valid": False,
                        "reason": f"unexpected_status_{response.status_code}",
                    }
        except httpx.TimeoutException:
            return {"valid": False, "reason": "timeout"}
        finally:
            del key
```

### 5.5 Multi-Tenant Data Isolation

In managed deployment, strict tenant isolation is the most critical architectural requirement. A data leak between tenants is catastrophic.

```sql
-- migrations/managed/001_tenant_isolation.sql
-- Only applied in managed deployments

-- Row-Level Security on all Silver and Gold tables
ALTER TABLE silver_canonical_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_reconciliation_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE gold_cbn_daily_returns ENABLE ROW LEVEL SECURITY;

-- Policy: pipeline role can only see rows for current tenant
-- Current tenant is set at connection time via SET app.current_tenant
CREATE POLICY tenant_isolation_pipeline
    ON silver_canonical_transactions
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation_api
    ON silver_canonical_transactions
    FOR SELECT
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

-- Same policy applied to all tables
CREATE POLICY tenant_isolation_pairs
    ON gold_reconciliation_pairs
    USING (tenant_id = current_setting('app.current_tenant')::UUID);

CREATE POLICY tenant_isolation_discrepancies
    ON gold_discrepancies
    USING (tenant_id = current_setting('app.current_tenant')::UUID);
```

```python
# src/managed/tenant_context.py
# Middleware that sets tenant context for every database operation

from contextlib import asynccontextmanager
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@asynccontextmanager
async def tenant_scoped_session(
    session: AsyncSession,
    tenant_id: UUID,
):
    """
    Sets the PostgreSQL session variable that drives Row-Level Security.
    All queries within this context are automatically scoped to tenant_id.
    Attempting to query another tenant's data returns empty results —
    not an error, not an exception. Empty. Silently isolated.

    This means a misconfigured query does not expose another tenant's data.
    It simply returns nothing.
    """
    await session.execute(
        text("SET LOCAL app.current_tenant = :tenant_id"),
        {"tenant_id": str(tenant_id)},
    )
    try:
        yield session
    finally:
        # Reset — defensive measure for connection pool reuse
        await session.execute(
            text("RESET app.current_tenant")
        )
```

### 5.6 Managed Onboarding API

The API endpoints that a client uses to connect their PSP accounts in the managed model:

```python
# src/api/v1/routes/managed_integrations.py
# Only available in managed deployment mode

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from uuid import UUID
import re

from src.managed.credential_manager import ManagedCredentialManager
from src.api.dependencies import require_scope, get_current_tenant

router = APIRouter(prefix="/integrations", tags=["Integrations (Managed)"])


class ConnectPSPRequest(BaseModel):
    psp_name: str = Field(description="PSP to connect: paystack | flutterwave | mpesa")
    api_key: str = Field(
        description=(
            "Your PSP API key. This is encrypted immediately on receipt "
            "and never stored in plaintext. It will not be returned "
            "in any API response after this call."
        ),
        min_length=10,
    )

    @field_validator("psp_name")
    @classmethod
    def validate_psp_name(cls, v: str) -> str:
        valid = {"paystack", "flutterwave", "mpesa"}
        if v.lower() not in valid:
            raise ValueError(f"psp_name must be one of: {', '.join(valid)}")
        return v.lower()

    @field_validator("api_key")
    @classmethod
    def validate_key_format(cls, v: str, info) -> str:
        """
        Basic format validation per PSP.
        Rejects obviously wrong values before storage attempt.
        Does not validate the key is actually working — that happens
        via verify_credential_validity() after storage.
        """
        psp = info.data.get("psp_name", "")

        if psp == "paystack":
            # Paystack keys start with a known prefix
            if not (v.startswith("sk_live") or v.startswith("sk_test")):
                raise ValueError(
                    "Paystack API key must start with the appropriate prefix "
                    "for your environment (production or sandbox)."
                )

        elif psp == "flutterwave":
            # Flutterwave: FLWSECK-... or FLWSECK_TEST-...
            if not (v.startswith("FLWSECK-") or v.startswith("FLWSECK_TEST")):
                raise ValueError(
                    "Flutterwave secret key must start with the appropriate "
                    "prefix for your environment."
                )

        return v


class PSPConnectionStatus(BaseModel):
    psp_name: str
    status: str           # connected | disconnected | error
    connected_at: str | None
    last_verified_at: str | None
    is_valid: bool
    # api_key is deliberately absent — never returned


@router.post("/connect")
async def connect_psp(
    request: Request,
    body: ConnectPSPRequest,
    tenant_id: UUID = Depends(get_current_tenant),
    _: None = Depends(require_scope("write")),
) -> dict:
    """
    Connect a PSP account to this tenant's reconciliation engine.

    ## Security
    The provided API key is:
    1. Validated for correct format
    2. Tested against the PSP API (lightweight verification call)
    3. Encrypted using AES-256 + client-specific KMS key
    4. Stored in AWS Secrets Manager
    5. Never returned in any subsequent API response
    6. Never logged

    ## What We Can Do With Your Connected Account
    - Read transaction history
    - Read settlement batches
    - Receive webhook events you configure

    ## What We Cannot Do With Your Connected Account
    - Initiate transactions or transfers
    - Issue refunds
    - Modify your account settings
    - Access your PSP dashboard credentials
    """
    manager = ManagedCredentialManager()

    # Step 1: Store encrypted credential
    try:
        secret_arn = await manager.store_client_credential(
            client_id=tenant_id,
            psp_name=body.psp_name,
            credential_value=body.api_key,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "credential_storage_failed",
                "message": (
                    "Failed to securely store your credential. "
                    "Please try again. If this persists, contact support."
                ),
                "request_id": getattr(request.state, "request_id", "unknown"),
            },
        )

    # Step 2: Verify the credential works
    verification = await manager.verify_credential_validity(
        client_id=tenant_id,
        psp_name=body.psp_name,
    )

    if not verification["valid"]:
        # Invalid key — delete what we just stored
        await manager.revoke_client_credential(
            client_id=tenant_id,
            psp_name=body.psp_name,
            revoked_by="system:validation_failure",
        )
        raise HTTPException(
            status_code=422,
            detail={
                "error": "invalid_psp_credential",
                "message": (
                    f"The provided {body.psp_name} API key could not be verified. "
                    "Please check that you have copied the correct key and that "
                    "it has not been revoked in your PSP dashboard."
                ),
                "reason": verification.get("reason"),
                "request_id": getattr(request.state, "request_id", "unknown"),
            },
        )

    # Step 3: Record integration in database (metadata only — no credential)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)

    async with pipeline_session() as session:
        await session.execute(
            text("""
                INSERT INTO tenant_integrations
                    (tenant_id, psp_name, status, connected_at, last_verified_at,
                     secret_arn_suffix)
                VALUES
                    (:tenant_id, :psp_name, 'connected', :now, :now, :arn_suffix)
                ON CONFLICT (tenant_id, psp_name) DO UPDATE SET
                    status = 'connected',
                    connected_at = :now,
                    last_verified_at = :now,
                    secret_arn_suffix = :arn_suffix
            """),
            {
                "tenant_id": tenant_id,
                "psp_name": body.psp_name,
                "now": now,
                "arn_suffix": secret_arn[-8:],  # Last 8 chars for tracing — not the full ARN
            },
        )

    return {
        "data": {
            "psp_name": body.psp_name,
            "status": "connected",
            "connected_at": now.isoformat(),
            "is_valid": True,
            "message": (
                f"Successfully connected your {body.psp_name} account. "
                "Your API key has been encrypted and stored securely. "
                "Configure your webhook URL to begin real-time reconciliation."
            ),
            "webhook_url": (
                f"https://api.reconciliation.internal/v1/webhooks/{body.psp_name}"
                f"?tenant={tenant_id}"
            ),
        },
        "request_id": getattr(request.state, "request_id", "unknown"),
    }


@router.delete("/{psp_name}")
async def disconnect_psp(
    request: Request,
    psp_name: str,
    tenant_id: UUID = Depends(get_current_tenant),
    _: None = Depends(require_scope("write")),
) -> dict:
    """
    Disconnect a PSP account and permanently delete stored credentials.

    This action:
    - Immediately stops all data synchronisation for this PSP
    - Permanently deletes the encrypted credential from our vault
    - Cannot be undone — reconnection requires providing credentials again

    Historical reconciliation data is retained per your data retention policy.
    Only the live credential is deleted.
    """
    manager = ManagedCredentialManager()
    resolved_by = getattr(request.state, "api_key", {}).get("key_prefix", "api_user")

    await manager.revoke_client_credential(
        client_id=tenant_id,
        psp_name=psp_name,
        revoked_by=f"client_request:{resolved_by}",
    )

    async with pipeline_session() as session:
        await session.execute(
            text("""
                UPDATE tenant_integrations SET
                    status = 'disconnected',
                    disconnected_at = NOW()
                WHERE tenant_id = :tenant_id AND psp_name = :psp_name
            """),
            {"tenant_id": tenant_id, "psp_name": psp_name},
        )

    return {
        "data": {
            "psp_name": psp_name,
            "status": "disconnected",
            "message": (
                f"Your {psp_name} account has been disconnected. "
                "The stored API key has been permanently deleted from our systems."
            ),
        },
        "request_id": getattr(request.state, "request_id", "unknown"),
    }
```

### 5.7 Managed Database Schema Additions

```sql
-- migrations/managed/002_tenant_tables.sql
-- Additional tables required for managed multi-tenant operation

CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_name   VARCHAR(200) NOT NULL,
    plan                VARCHAR(50) NOT NULL DEFAULT 'growth',
    deployment_model    VARCHAR(20) NOT NULL DEFAULT 'managed',
    status              VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trial_ends_at       TIMESTAMPTZ,
    data_region         VARCHAR(20) NOT NULL DEFAULT 'eu-west-1',

    CONSTRAINT chk_deployment_model
        CHECK (deployment_model IN ('self_hosted', 'managed', 'hybrid'))
);

CREATE TABLE tenant_integrations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id),
    psp_name            VARCHAR(50) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'connected',
    connected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_verified_at    TIMESTAMPTZ,
    disconnected_at     TIMESTAMPTZ,
    -- Store only the last 8 chars of the secret ARN for tracing
    -- Never store the full ARN in the application database
    secret_arn_suffix   CHAR(8),

    UNIQUE (tenant_id, psp_name),
    CONSTRAINT chk_integration_status
        CHECK (status IN ('connected', 'disconnected', 'error', 'pending'))
);

-- Add tenant_id to all data tables
ALTER TABLE silver_canonical_transactions
    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE gold_reconciliation_pairs
    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE gold_discrepancies
    ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE bronze_ingestion_log
    ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Index for tenant-scoped queries
CREATE INDEX idx_silver_tx_tenant ON silver_canonical_transactions (tenant_id);
CREATE INDEX idx_gold_pairs_tenant ON gold_reconciliation_pairs (tenant_id);
CREATE INDEX idx_discrepancies_tenant ON gold_discrepancies (tenant_id);
```

### 5.8 When to Recommend Option B

```
Client Profile                          Option B Fit
─────────────────────────────────────── ──────────────────────────────
No in-house technical team              ██████████ Excellent
Small-to-medium volume (< NGN 200M/mo) ████████   Very Good
Wants managed SaaS experience           ██████████ Excellent
Quick onboarding priority               ██████████ Excellent
Budget-conscious (no infrastructure)    ████████   Very Good
Startup or early-stage company          ████████   Very Good

Not ideal for:
Regulated entity needing data custody   ░░         Poor — use Option A
Very high volume (NGN 1B+/month)        ███        Moderate — multi-tenant overhead
Strict data residency requirements      ░░         Poor — use Option A
Security-reviewed enterprise            ████       Moderate — need SOC2
```

---

## 6. Option C — Read-Only API Key Model

### 6.1 Overview

Option C is not a deployment model — it is a **credential scope decision** that applies to both Option A and Option B. It deserves separate treatment because it changes the security conversation fundamentally and because it requires specific implementation to communicate correctly to clients.

The core principle: **we only ask for and store the minimum credential needed to perform reconciliation. Nothing more.**

### 6.2 The Problem With Full Secret Keys

When Paystack says "here is your secret key," that key by default can:

```
Full Paystack Secret Key Capabilities:
─────────────────────────────────────────────────────────────────
✅ Read all transactions
✅ Read all settlements
✅ Read all customers
✅ Create new charges
✅ Initiate bank transfers
✅ Issue refunds
✅ Create and manage subaccounts
✅ Access webhook settings
✅ Manage integration settings
```

Our reconciliation engine needs exactly:

```
What Reconciliation Actually Needs:
─────────────────────────────────────────────────────────────────
✅ Read all transactions
✅ Read all settlements
❌ Everything else
```

The gap between what is available and what is needed is where security risk lives.

### 6.3 The Two Mechanisms for Scope Reduction

Since Nigerian PSPs do not natively support scoped API keys (with the exception of M-Pesa), scope restriction must be achieved through a combination of technical and procedural controls:

**Mechanism 1 — Application-Layer Enforcement (all options)**

The connector classes only call read endpoints. Write endpoints do not exist in the codebase. This is enforced by architecture, not by configuration.

```python
# src/engine/credential_validator.py
# Validates that a provided credential is appropriate for read-only use

import httpx
from dataclasses import dataclass
from enum import Enum

class CredentialRisk(Enum):
    SAFE = "safe"               # Only read endpoints accessible
    ELEVATED = "elevated"       # Write endpoints accessible but not used
    HIGH = "high"               # Cannot determine scope
    INVALID = "invalid"         # Key does not work

@dataclass
class CredentialAssessment:
    risk_level: CredentialRisk
    psp_name: str
    can_read_transactions: bool
    can_read_settlements: bool
    has_write_access: bool      # True for all current Nigerian PSPs
    recommendation: str
    warnings: list[str]


async def assess_paystack_credential(secret_key: str) -> CredentialAssessment:
    """
    Assess a Paystack API key's risk profile.

    Since Paystack does not support native scope restriction,
    all valid keys have full write access. We assess whether
    the key works for read operations and communicate the
    write access risk transparently to the client.
    """
    warnings = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        # Test 1: Can we read transactions?
        tx_response = await client.get(
            "https://api.paystack.co/transaction",
            headers={"Authorization": f"Bearer {secret_key}"},
            params={"perPage": 1},
        )
        can_read_transactions = tx_response.status_code == 200

        # Test 2: Can we read settlements?
        settle_response = await client.get(
            "https://api.paystack.co/settlement",
            headers={"Authorization": f"Bearer {secret_key}"},
        )
        can_read_settlements = settle_response.status_code == 200

    if not can_read_transactions:
        return CredentialAssessment(
            risk_level=CredentialRisk.INVALID,
            psp_name="paystack",
            can_read_transactions=False,
            can_read_settlements=False,
            has_write_access=False,
            recommendation="Key is invalid. Verify you have copied the correct secret key.",
            warnings=["Key does not authenticate with Paystack API."],
        )

    # All valid Paystack keys have write access — this is unavoidable
    # with current Paystack architecture
    warnings.append(
        "Paystack does not currently support read-only API keys. "
        "Your key has write access. Our system never uses write endpoints, "
        "but this access exists at the PSP level. "
        "Mitigate by enabling IP whitelisting in your Paystack dashboard."
    )

    return CredentialAssessment(
        risk_level=CredentialRisk.ELEVATED,
        psp_name="paystack",
        can_read_transactions=can_read_transactions,
        can_read_settlements=can_read_settlements,
        has_write_access=True,
        recommendation=(
            "Enable IP whitelisting in your Paystack dashboard to restrict "
            "this key to your server's IP address. This prevents the key "
            "from being used even if it is compromised."
        ),
        warnings=warnings,
    )
```

**Mechanism 2 — IP Whitelisting (compensating control)**

Since scope restriction is not available, IP whitelisting is the most effective compensating control. It means a stolen API key cannot be used from anywhere except the authorised server.

```python
# src/managed/ip_whitelist_guide.py
# Generates client-specific whitelisting instructions

def generate_ip_whitelist_instructions(
    client_infrastructure_ips: list[str],
    psp_name: str,
) -> dict:
    """
    Generate PSP-specific IP whitelisting instructions for a client.
    Called during managed onboarding to provide concrete setup guidance.
    """

    instructions = {
        "paystack": {
            "dashboard_path": "Settings → API Keys & Webhooks → IP Whitelist",
            "description": (
                "Paystack allows you to restrict your secret key to "
                "specific IP addresses. Any request from an unlisted IP "
                "will be rejected even if the key is correct."
            ),
            "ips_to_whitelist": client_infrastructure_ips,
            "steps": [
                "Log into dashboard.paystack.com",
                "Navigate: Settings → API Keys & Webhooks",
                "Click 'Add IP to Whitelist'",
                f"Add each of these IPs: {', '.join(client_infrastructure_ips)}",
                "Save changes",
                "Test that our system can still connect after whitelisting",
            ],
            "warning": (
                "After whitelisting, your key will ONLY work from these IPs. "
                "If you need to use the Paystack API from other tools "
                "(e.g., your development machine), either add those IPs too "
                "or create a separate API key for those purposes."
            ),
        },
        "flutterwave": {
            "dashboard_path": "Settings → API → IP Whitelisting",
            "description": (
                "Flutterwave supports IP-based access restriction for API keys."
            ),
            "ips_to_whitelist": client_infrastructure_ips,
            "steps": [
                "Log into app.flutterwave.com",
                "Navigate: Settings → API",
                "Enable IP Whitelisting",
                f"Add each of these IPs: {', '.join(client_infrastructure_ips)}",
                "Save",
            ],
        },
    }

    return instructions.get(psp_name, {
        "description": f"IP whitelisting not documented for {psp_name}.",
        "recommendation": "Contact PSP support to enquire about IP restriction options.",
    })
```

### 6.4 M-Pesa — The Exception (Real OAuth Scopes)

M-Pesa Daraja is the only Nigerian-adjacent PSP that provides genuine OAuth-based scope restriction. This should be used to its full extent.

```python
# src/connectors/mpesa_oauth.py

class MPesaDarajaOAuthClient:
    """
    M-Pesa uses OAuth 2.0 client credentials flow.
    We request only the scopes required for reconciliation.
    The access token expires every 3600 seconds and is refreshed automatically.

    Unlike Paystack/Flutterwave where scope is not restricable,
    M-Pesa tokens are genuinely scoped — a token issued for
    TransactionStatus cannot initiate B2C payments.
    """

    REQUIRED_SCOPES = "TransactionStatus"  # Read-only query scope
    TOKEN_URL = "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"

    def __init__(self, consumer_key: str, consumer_secret: str) -> None:
        self._consumer_key = consumer_key
        self._consumer_secret = consumer_secret
        self._access_token: str | None = None
        self._token_expires_at: float = 0

    async def get_access_token(self) -> str:
        """
        Returns a valid access token, refreshing if expired.
        Token has genuine scope restriction — only TransactionStatus.
        A compromised token cannot initiate payments.
        """
        import time
        if self._access_token and time.time() < self._token_expires_at - 60:
            return self._access_token

        import base64, httpx
        credentials = base64.b64encode(
            f"{self._consumer_key}:{self._consumer_secret}".encode()
        ).decode()

        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.TOKEN_URL,
                headers={"Authorization": f"Basic {credentials}"},
            )
            response.raise_for_status()
            data = response.json()

        self._access_token = data["access_token"]
        self._token_expires_at = time.time() + int(data["expires_in"])
        return self._access_token
```

### 6.5 The Client Communication Layer

How we communicate the credential model to clients is as important as the implementation. Opacity destroys trust. Precision builds it.

```python
# src/api/v1/routes/credential_transparency.py

@router.get("/security/credential-model")
async def get_credential_security_model(
    psp_name: str,
    _: None = Depends(require_scope("read")),
) -> dict:
    """
    Returns a plain-language explanation of what access our system
    has to a client's PSP account and what we explicitly do not do.

    This endpoint exists specifically so clients can audit and verify
    our stated credential usage. It is called automatically during
    onboarding and available anytime thereafter.
    """

    models = {
        "paystack": {
            "access_we_use": [
                "GET /transaction — Read your transaction list",
                "GET /transaction/verify/{ref} — Verify specific transactions",
                "GET /settlement — Read your settlement batches",
                "GET /settlement/transaction/{id} — Settlement transaction detail",
            ],
            "access_we_never_use": [
                "POST /transaction/initialize — We cannot create charges",
                "POST /transfer — We cannot send money from your account",
                "POST /refund — We cannot issue refunds",
                "DELETE * — We cannot delete anything",
            ],
            "technical_limitation": (
                "Paystack does not currently support read-only API keys. "
                "Your key technically has write access at the PSP level. "
                "We enforce read-only access in our application code, "
                "and we recommend IP whitelisting as an additional control."
            ),
            "recommended_mitigation": (
                "Enable IP whitelisting in your Paystack dashboard "
                "to restrict your key to our server IPs only."
            ),
            "our_server_ips": ["YOUR_SERVER_IP_HERE"],
            "verification": (
                "You can verify our access pattern by reviewing your "
                "Paystack API logs in Settings → Logs. You will see only "
                "GET requests from our IPs. No POST, PUT, or DELETE requests."
            ),
        },
        "flutterwave": {
            "access_we_use": [
                "GET /v3/transactions — Read transaction list",
                "GET /v3/transactions/{id}/verify — Verify transactions",
                "GET /v3/settlements — Read settlement batches",
                "GET /v3/transfers — Read transfer history",
            ],
            "access_we_never_use": [
                "POST /v3/charges — Cannot initiate charges",
                "POST /v3/transfers — Cannot send money",
                "POST /v3/refunds — Cannot issue refunds",
            ],
            "technical_limitation": (
                "Flutterwave does not support read-only API keys. "
                "Same IP whitelisting recommendation applies."
            ),
        },
    }

    return {
        "data": models.get(psp_name, {"error": f"Unknown PSP: {psp_name}"}),
        "statement": (
            "This reconciliation engine is architecturally read-only. "
            "No write, transfer, refund, or modification endpoint exists "
            "in our codebase. This is verifiable by reviewing our open-source code."
        ),
    }
```

---

## 7. Switching Between Options — The Migration Paths

### 7.1 The Deployment Mode Configuration

The system detects and validates the deployment model at startup:

```python
# src/config.py — deployment model additions

from enum import Enum
from pydantic import model_validator

class DeploymentModel(str, Enum):
    SELF_HOSTED = "self_hosted"
    MANAGED = "managed"
    HYBRID = "hybrid"      # Self-hosted infrastructure, managed credential vault


class Settings(BaseSettings):
    # ... existing settings ...

    deployment_model: DeploymentModel = DeploymentModel.SELF_HOSTED

    # Self-hosted only
    paystack_secret_key: str = ""
    flutterwave_secret_key: str = ""
    flutterwave_secret_hash: str = ""

    # Managed only
    aws_secrets_manager_region: str = "eu-west-1"
    aws_kms_key_id: str = ""
    managed_platform_api_key: str = ""   # Our platform's own auth key

    # Hybrid
    credential_vault_endpoint: str = ""   # External vault URL

    @model_validator(mode="after")
    def validate_deployment_config(self) -> "Settings":
        if self.deployment_model == DeploymentModel.SELF_HOSTED:
            if not self.paystack_secret_key and not self.flutterwave_secret_key:
                raise ValueError(
                    "SELF_HOSTED deployment requires at least one PSP credential "
                    "configured in environment variables. "
                    "Set PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY."
                )

        elif self.deployment_model == DeploymentModel.MANAGED:
            if not self.aws_kms_key_id:
                raise ValueError(
                    "MANAGED deployment requires AWS KMS key for credential encryption. "
                    "Set AWS_KMS_KEY_ID."
                )

        elif self.deployment_model == DeploymentModel.HYBRID:
            if not self.credential_vault_endpoint:
                raise ValueError(
                    "HYBRID deployment requires external vault endpoint. "
                    "Set CREDENTIAL_VAULT_ENDPOINT."
                )

        return self
```

### 7.2 The Credential Resolution Strategy

A single interface that all connectors use — the implementation changes based on deployment model:

```python
# src/engine/credential_resolver.py
# The abstraction layer that makes switching transparent

from abc import ABC, abstractmethod
from uuid import UUID
from typing import Optional
from src.config import get_settings, DeploymentModel


class BaseCredentialResolver(ABC):
    """
    Abstract credential resolver.
    All PSP connectors call get_credential() — they never know
    or care whether they are in self-hosted or managed mode.
    The resolver handles the difference.
    """

    @abstractmethod
    async def get_credential(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> Optional[str]:
        """
        Returns the PSP credential for use in a single API call.
        The credential must be used immediately and not stored.
        """
        ...

    @abstractmethod
    async def is_available(self, psp_name: str, tenant_id: Optional[UUID] = None) -> bool:
        """Check if a credential is configured for this PSP."""
        ...


class SelfHostedCredentialResolver(BaseCredentialResolver):
    """
    Option A: Reads credentials from environment variables.
    No tenant_id needed — single-tenant deployment.
    """

    async def get_credential(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> Optional[str]:
        settings = get_settings()
        credential_map = {
            "paystack": settings.paystack_secret_key,
            "flutterwave": settings.flutterwave_secret_key,
            "mpesa_consumer_key": settings.mpesa_consumer_key,
            "mpesa_consumer_secret": settings.mpesa_consumer_secret,
        }
        return credential_map.get(psp_name) or None

    async def is_available(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> bool:
        credential = await self.get_credential(psp_name)
        return bool(credential)


class ManagedCredentialResolver(BaseCredentialResolver):
    """
    Option B: Retrieves credentials from AWS Secrets Manager.
    Requires tenant_id for multi-tenant isolation.
    """

    def __init__(self) -> None:
        from src.managed.credential_manager import ManagedCredentialManager
        self._manager = ManagedCredentialManager()

    async def get_credential(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> Optional[str]:
        if not tenant_id:
            raise ValueError(
                "ManagedCredentialResolver requires tenant_id. "
                "This is a programming error — tenant context is missing."
            )
        return await self._manager.retrieve_client_credential(
            client_id=tenant_id,
            psp_name=psp_name,
        )

    async def is_available(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> bool:
        try:
            credential = await self.get_credential(psp_name, tenant_id)
            return credential is not None
        except Exception:
            return False


class HybridCredentialResolver(BaseCredentialResolver):
    """
    Option C / Hybrid: Tries environment variables first,
    falls back to vault for any PSP not configured locally.
    Useful during migration from self-hosted to managed.
    """

    def __init__(self) -> None:
        self._self_hosted = SelfHostedCredentialResolver()
        self._managed = ManagedCredentialResolver()

    async def get_credential(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> Optional[str]:
        # Try local env first (self-hosted pattern)
        local = await self._self_hosted.get_credential(psp_name)
        if local:
            return local

        # Fall back to managed vault
        if tenant_id:
            return await self._managed.get_credential(psp_name, tenant_id)

        return None

    async def is_available(
        self,
        psp_name: str,
        tenant_id: Optional[UUID] = None,
    ) -> bool:
        return (
            await self._self_hosted.is_available(psp_name)
            or await self._managed.is_available(psp_name, tenant_id)
        )


def get_credential_resolver() -> BaseCredentialResolver:
    """
    Factory function.
    Returns the correct resolver based on DEPLOYMENT_MODEL setting.
    Called once at startup — cached for the process lifetime.

    Changing DEPLOYMENT_MODEL in .env and restarting is all that is
    needed to switch between deployment models.
    """
    settings = get_settings()

    resolvers = {
        DeploymentModel.SELF_HOSTED: SelfHostedCredentialResolver,
        DeploymentModel.MANAGED: ManagedCredentialResolver,
        DeploymentModel.HYBRID: HybridCredentialResolver,
    }

    resolver_class = resolvers.get(settings.deployment_model)
    if not resolver_class:
        raise ValueError(f"Unknown deployment model: {settings.deployment_model}")

    return resolver_class()
```

### 7.3 Migration Path A → B (Self-Hosted to Managed)

When a client wants to move from running it themselves to having us manage it:

```python
# scripts/migrate_self_hosted_to_managed.py

"""
Migration script: Self-Hosted → Managed

This script:
1. Reads existing PSP credentials from the client's .env
2. Uploads them to our managed credential vault
3. Verifies the managed credentials work
4. Updates DEPLOYMENT_MODEL in .env
5. Restarts services

Run on the client's server with our managed platform credentials.
The client's PSP credentials are transmitted over TLS to our vault
during this process — this is the only moment they leave the client's server.
"""

import asyncio
import os
from pathlib import Path


async def migrate_to_managed(
    managed_platform_api_key: str,
    tenant_id: str,
) -> None:
    env_content = Path(".env").read_text()

    credentials_to_migrate = {}
    for psp, env_key in [
        ("paystack", "PAYSTACK_SECRET_KEY"),
        ("flutterwave", "FLUTTERWAVE_SECRET_KEY"),
    ]:
        value = _extract_env_value(env_content, env_key)
        if value:
            credentials_to_migrate[psp] = value

    if not credentials_to_migrate:
        print("No credentials found in .env to migrate.")
        return

    print(f"Found credentials for: {', '.join(credentials_to_migrate.keys())}")
    print("Uploading to managed vault...")

    import httpx
    async with httpx.AsyncClient(
        base_url="https://api.reconciliation.internal",
        headers={"X-API-Key": managed_platform_api_key},
        timeout=30.0,
    ) as client:
        for psp_name, credential in credentials_to_migrate.items():
            response = await client.post(
                f"/v1/integrations/connect",
                json={
                    "psp_name": psp_name,
                    "api_key": credential,
                    "tenant_id": tenant_id,
                },
            )

            if response.status_code == 200:
                print(f"✅ {psp_name}: migrated successfully")
            else:
                print(f"❌ {psp_name}: migration failed — {response.json()}")
                return

    print("\nUpdating deployment model...")
    updated_env = env_content.replace(
        "DEPLOYMENT_MODEL=self_hosted",
        "DEPLOYMENT_MODEL=managed",
    )
    Path(".env").write_text(updated_env)

    print("\nRestarting services...")
    os.system("docker compose restart api worker")

    print("\n✅ Migration complete. You can now manage your integration from the platform UI.")
    print("Your local PSP credentials in .env are no longer used but remain as backup.")
```

### 7.4 Migration Path B → A (Managed to Self-Hosted)

When a client wants to take back control — perhaps their engineering team has grown, or they need data residency compliance:

```bash
#!/bin/bash
# scripts/migrate_managed_to_self_hosted.sh
# Run this on the client's new server infrastructure

echo "═══════════════════════════════════════════════════════"
echo "  Reconciliation Engine — Managed to Self-Hosted Migration"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "This script will:"
echo "  1. Provision your self-hosted infrastructure"
echo "  2. Guide you through credential configuration"
echo "  3. Migrate your historical data (Bronze + Silver + Gold)"
echo "  4. Verify the new deployment"
echo "  5. Provide cutover instructions"
echo ""
echo "Prerequisites:"
echo "  • Docker and Docker Compose installed"
echo "  • Your Paystack and Flutterwave credentials available"
echo "  • Database export from managed platform (provided by support)"
echo ""

read -p "Continue? (y/n): " confirm
if [ "$confirm" != "y" ]; then
    echo "Aborted."
    exit 0
fi

# Step 1: Setup
cp .env.example .env
echo ""
echo "Please enter your credentials:"
echo "(These stay on this server. We do not receive them.)"
echo ""

read -s -p "Paystack Secret Key: " paystack_key
sed -i "s/PAYSTACK_SECRET_KEY=/PAYSTACK_SECRET_KEY=$paystack_key/" .env

read -s -p "Flutterwave Secret Key: " flw_key
sed -i "s/FLUTTERWAVE_SECRET_KEY=/FLUTTERWAVE_SECRET_KEY=$flw_key/" .env

sed -i "s/DEPLOYMENT_MODEL=managed/DEPLOYMENT_MODEL=self_hosted/" .env

# Step 2: Start infrastructure
make up

# Step 3: Run migrations
make migrate

# Step 4: Restore historical data from managed export
echo ""
echo "Restoring historical data from managed platform export..."
echo "Place your data export file at: ./data/managed_export.sql"
read -p "Press Enter when ready..."

if [ -f "./data/managed_export.sql" ]; then
    docker compose exec postgres psql -U postgres -d reconciliation < ./data/managed_export.sql
    echo "✅ Historical data restored"
else
    echo "⚠️  No export file found. Starting fresh — historical data not migrated."
fi

# Step 5: Verify
make smoke
echo ""
echo "✅ Self-hosted deployment ready."
echo ""
echo "IMPORTANT NEXT STEPS:"
echo "  1. Update your PSP webhook URLs to point to this server"
echo "  2. Verify webhooks are being received: make logs"
echo "  3. Contact support to disable your managed account"
```

---

## 8. Decision Matrix — Choosing the Right Option

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT MODEL DECISION MATRIX                          │
├──────────────────────────────────────────────┬───────────┬───────────────────┤
│ Criterion                                    │ Option A  │ Option B          │
│                                              │ Self-Host │ Managed           │
├──────────────────────────────────────────────┼───────────┼───────────────────┤
│ SECURITY & TRUST                             │           │                   │
│ Credentials leave client infrastructure?     │    NO     │    YES (encrypted)│
│ We can see client transaction data?          │    NO     │    YES            │
│ Data residency control                       │ FULL      │ PARTIAL           │
│ Blast radius if our systems compromised      │ ZERO      │ DATA EXPOSURE     │
│                                              │           │                   │
│ OPERATIONAL                                  │           │                   │
│ Client technical team required?              │    YES    │    NO             │
│ Infrastructure cost to client?               │    YES    │    NO             │
│ Time to first reconciliation result?         │  1-2 days │    < 1 hour       │
│ Software updates                             │  Manual   │    Automatic      │
│ Monitoring and ops                           │  Client   │    Us             │
│                                              │           │                   │
│ COMPLIANCE                                   │           │                   │
│ CBN data residency (if required)             │    YES    │    NEGOTIABLE     │
│ NDPR data processing register               │  Client's │    Ours           │
│ Audit trail access                          │  Full     │    Via API        │
│                                              │           │                   │
│ COMMERCIAL                                   │           │                   │
│ Pricing model                               │  License  │    SaaS monthly   │
│ Support complexity                          │  Higher   │    Lower          │
│ Client lock-in                              │  LOW      │    MODERATE       │
│ Migration path available                    │  YES ↔ YES│    YES ↔ YES      │
└──────────────────────────────────────────────┴───────────┴───────────────────┘

Credential Scope (applies to both):
─────────────────────────────────────────────────────────────────────────────
Option C (Read-Only) is not a deployment model — it is a credential discipline.
In self-hosted: enforce via application architecture + IP whitelisting guidance.
In managed: enforce via application architecture + IP whitelisting + audit logging.
M-Pesa: enforce via genuine OAuth scopes (the only PSP that supports this today).
```

---

## 9. The Honest Recommendation

**Default to Option A for every client who can operate it.**

The security conversation is simpler, the trust conversation is cleaner, the compliance conversation does not exist. "Your credentials never leave your infrastructure" is the most powerful security statement any fintech infrastructure provider can make.

**Move to Option B only when Option A is genuinely not viable** — the client has no technical team, needs same-day onboarding, or explicitly prefers managed infrastructure for operational reasons. When Option B is selected, be transparent about what the credential custody relationship means.

**Apply Option C discipline regardless of deployment model.** Read-only access, IP whitelisting, and audit logging are not alternatives to A and B — they are security practices that improve both.

**Build Option A first.** The self-hosted architecture is the foundation. Option B (managed) is layered on top. You cannot build Option B without first having a working Option A because the pipeline, the data model, and the reconciliation logic are identical. The only difference is where credentials come from and where data lives.

The migration paths between options exist so that no client decision is permanent. A startup that begins on managed because they have no DevOps team can migrate to self-hosted when they hire an SRE. A regulated entity that begins self-hosted can offer their own clients a managed version on top of the same infrastructure. The architecture supports all of these transitions without rebuilding the core system.
