# src/engine/normaliser.py
"""
Silver normaliser — transforms PSP-specific payloads into canonical schema.

Each PSP has its own:
    - Amount convention (Paystack: kobo, Flutterwave: major units)
    - Timestamp format
    - Field naming
    - PII field locations

The normaliser produces a dict ready for INSERT into silver_canonical_transactions.
PII masking is applied here — raw values never reach Silver.

References:
    - TDD §9.4: Silver Normaliser
    - Data Dictionary: Field Transformation Rules
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from src.engine.idempotency import build_idempotency_key
from src.engine.pii import (
    mask_account_number,
    mask_name,
    scrub_narration,
)

# PSP event type → canonical transaction_type mapping
PAYSTACK_EVENT_TYPE_MAP: dict[str, str] = {
    "charge.success": "credit",
    "transfer.success": "debit",
    "transfer.failed": "debit",       # Failed debit still a debit attempt
    "transfer.reversed": "reversal",
}

FLUTTERWAVE_EVENT_TYPE_MAP: dict[str, str] = {
    "charge.completed": "credit",
    "transfer.completed": "debit",
}


def normalise_paystack_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: Optional[UUID],
    fx_rate_applied: Optional[Decimal],
    expected_settlement_at: Optional[datetime],
) -> dict[str, Any]:
    """
    Transform a Paystack webhook payload into a canonical Silver record.

    Key Paystack-specific behaviour:
        - Amounts are in kobo (1/100 NGN) → divide by 100
        - Reference field: data.reference
        - Timestamp field: data.paid_at or data.created_at
        - PII location: data.authorization.account_number, .account_name
    """
    data = payload["data"]
    event_type = payload["event"]

    # Paystack amounts are in kobo (subunit). Convert to NGN.
    amount_kobo = Decimal(str(data["amount"]))
    amount_raw = amount_kobo / Decimal("100")

    currency_raw = data.get("currency", "NGN").upper()
    if currency_raw == "NGN":
        amount_ngn = amount_raw
        fx_rate_snapshot_id = None
        fx_rate_applied = None
    else:
        if fx_rate_applied is None:
            raise ValueError(
                f"FX rate required for non-NGN currency: {currency_raw}"
            )
        from src.engine.fx import convert_to_ngn
        amount_ngn = convert_to_ngn(amount_raw, currency_raw, fx_rate_applied)

    initiated_at = _parse_timestamp(data.get("paid_at") or data.get("created_at"))
    settled_at = (
        _parse_timestamp(data.get("paid_at"))
        if event_type == "charge.success"
        else None
    )

    # Extract settlement status from event type
    status_map = {
        "charge.success": "settled",
        "transfer.success": "settled",
        "transfer.failed": "failed",
        "transfer.reversed": "reversed",
    }

    # PSP-specific metadata — no PII
    psp_metadata = {
        "channel": data.get("channel"),
        "fees_ngn": float(Decimal(str(data.get("fees", 0))) / Decimal("100")),
        "paystack_id": data.get("id"),
        "status": data.get("status"),
    }

    auth = data.get("authorization", {})

    return {
        "id": uuid4(),
        "idempotency_key": build_idempotency_key(
            "paystack", data["reference"], event_type
        ),
        "bronze_ingestion_id": bronze_ingestion_id,
        "psp_name": "paystack",
        "psp_transaction_ref": data["reference"],
        "psp_event_type": event_type,
        "psp_event_received_at": datetime.now(timezone.utc),
        "transaction_type": PAYSTACK_EVENT_TYPE_MAP.get(event_type, "credit"),
        "amount_raw": amount_raw,
        "currency_raw": currency_raw,
        "amount_ngn": amount_ngn,
        "fx_rate_snapshot_id": fx_rate_snapshot_id,
        "fx_rate_applied": fx_rate_applied,
        # PII masking applied here — raw values never stored in Silver
        "sender_account_masked": None,  # Paystack charges don't expose sender NUBAN
        "sender_bank_code": None,
        "sender_bank_name": None,
        "beneficiary_account_masked": mask_account_number(
            auth.get("account_number")
        ),
        "beneficiary_bank_code": auth.get("bank_code"),
        "beneficiary_bank_name": auth.get("bank"),
        "beneficiary_name_masked": mask_name(
            auth.get("account_name")
        ),
        "narration": scrub_narration(
            _extract_paystack_narration(data)
        ),
        "initiated_at": initiated_at,
        "settled_at": settled_at,
        "expected_settlement_at": expected_settlement_at,
        "settlement_status": status_map.get(event_type, "pending"),
        "has_pii_masked": True,  # Explicit flag — required by CHECK constraint
        "psp_metadata": psp_metadata,
        "processed_by_run_id": run_id,
    }


def normalise_flutterwave_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: Optional[UUID],
    fx_rate_applied: Optional[Decimal],
    expected_settlement_at: Optional[datetime],
) -> dict[str, Any]:
    """
    Transform a Flutterwave webhook payload into canonical Silver record.

    Key Flutterwave-specific behaviour:
        - Amounts are in major currency units (NGN, not kobo)
        - Reference field: data.tx_ref
        - Internal reference: data.flw_ref
        - PII location: data.account.account_number, .account_name
    """
    data = payload["data"]
    event_type = payload["event"]

    # Flutterwave amounts are already in major currency units
    amount_raw = Decimal(str(data["amount"]))
    currency_raw = data.get("currency", "NGN").upper()

    if currency_raw == "NGN":
        amount_ngn = amount_raw
        fx_rate_snapshot_id = None
        fx_rate_applied = None
    else:
        if fx_rate_applied is None:
            raise ValueError(
                f"FX rate required for non-NGN currency: {currency_raw}"
            )
        from src.engine.fx import convert_to_ngn
        amount_ngn = convert_to_ngn(amount_raw, currency_raw, fx_rate_applied)

    initiated_at = _parse_timestamp(data.get("created_at"))
    account = data.get("account", {})

    psp_metadata = {
        "flw_ref": data.get("flw_ref"),
        "app_fee_ngn": float(data.get("app_fee", 0)),
        "merchant_fee_ngn": float(data.get("merchant_fee", 0)),
        "flutterwave_id": data.get("id"),
        "status": data.get("status"),
    }

    return {
        "id": uuid4(),
        "idempotency_key": build_idempotency_key(
            "flutterwave", data["tx_ref"], event_type
        ),
        "bronze_ingestion_id": bronze_ingestion_id,
        "psp_name": "flutterwave",
        "psp_transaction_ref": data["tx_ref"],
        "psp_event_type": event_type,
        "psp_event_received_at": datetime.now(timezone.utc),
        "transaction_type": FLUTTERWAVE_EVENT_TYPE_MAP.get(event_type, "credit"),
        "amount_raw": amount_raw,
        "currency_raw": currency_raw,
        "amount_ngn": amount_ngn,
        "fx_rate_snapshot_id": fx_rate_snapshot_id,
        "fx_rate_applied": fx_rate_applied,
        "sender_account_masked": None,
        "sender_bank_code": None,
        "sender_bank_name": None,
        "beneficiary_account_masked": mask_account_number(
            account.get("account_number")
        ),
        "beneficiary_bank_code": account.get("bank_code"),
        "beneficiary_bank_name": account.get("bank"),
        "beneficiary_name_masked": mask_name(account.get("account_name")),
        "narration": scrub_narration(data.get("narration")),
        "initiated_at": initiated_at,
        "settled_at": initiated_at if event_type == "charge.completed" else None,
        "expected_settlement_at": expected_settlement_at,
        "settlement_status": "settled" if event_type == "charge.completed" else "pending",
        "has_pii_masked": True,
        "psp_metadata": psp_metadata,
        "processed_by_run_id": run_id,
    }


def _parse_timestamp(ts_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO 8601 timestamp, handling Z suffix."""
    if not ts_str:
        return None
    dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc)


def _extract_paystack_narration(data: dict[str, Any]) -> Optional[str]:
    """Extract narration from Paystack custom_fields metadata if present."""
    metadata = data.get("metadata", {})
    if not metadata:
        return None
    custom_fields = metadata.get("custom_fields", [])
    if custom_fields and isinstance(custom_fields, list) and len(custom_fields) > 0:
        return custom_fields[0].get("value")
    return None
