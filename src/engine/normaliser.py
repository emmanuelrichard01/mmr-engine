# src/engine/normaliser.py
"""
Silver normaliser — transforms PSP-specific payloads into the canonical schema.

Each PSP has its own:
    - Amount convention (Paystack: kobo, Flutterwave: major units)
    - Timestamp format and field naming
    - Event vocabulary, and where the *outcome* lives (event name vs data.status)
    - PII field locations

Only events the engine understands become Silver rows. Everything else is
kept in Bronze (raw, immutable) and reported as skipped. Unknown event types
must never be guessed into "credit": a guessed credit is a fabricated money
movement.

The counterparty is the external party in each event: the payer on a charge,
the recipient on a transfer. Its name is stored masked (for display) and as
keyed HMAC tokens (for matching). See src/engine/pii.py.

References:
    - TDD §9.4: Silver Normaliser
    - Data Dictionary: Field Transformation Rules
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID, uuid4

from src.engine.idempotency import build_idempotency_key
from src.engine.pii import mask_account_number, mask_name, scrub_narration, tokenize_name


class PermanentEventError(ValueError):
    """The event can never be processed as-is (bad shape, missing data).
    Retrying is pointless; the message belongs in the dead-letter topic."""


@dataclass(frozen=True)
class EventDisposition:
    """Whether an event should become a Silver row, and how to classify it."""

    process: bool
    transaction_type: str | None = None
    settlement_status: str | None = None
    reason: str | None = None


# ── Event vocabularies ──────────────────────────────────────────────────────

# Paystack encodes the outcome in the event name.
PAYSTACK_EVENTS: dict[str, tuple[str, str]] = {
    # event: (transaction_type, settlement_status)
    "charge.success": ("credit", "settled"),
    "transfer.success": ("debit", "settled"),
    "transfer.failed": ("debit", "failed"),
    "transfer.reversed": ("reversal", "reversed"),
}

# Flutterwave sends one event per object type; the outcome is in data.status.
FLUTTERWAVE_EVENTS: dict[str, str] = {
    "charge.completed": "credit",
    "transfer.completed": "debit",
}
_FLUTTERWAVE_STATUS: dict[str, str] = {
    "successful": "settled",
    "success": "settled",
    "failed": "failed",
    "pending": "pending",
    "new": "pending",
}

# Backwards-compatible names used by the transform flow and tests.
PAYSTACK_EVENT_TYPE_MAP: dict[str, str] = {k: v[0] for k, v in PAYSTACK_EVENTS.items()}
FLUTTERWAVE_EVENT_TYPE_MAP: dict[str, str] = dict(FLUTTERWAVE_EVENTS)


def classify_event(psp_name: str, event_type: str, payload: dict[str, Any]) -> EventDisposition:
    """Decide whether an event becomes a canonical transaction, and as what."""
    data = payload.get("data")
    if not isinstance(data, dict):
        return EventDisposition(process=False, reason="payload has no data object")

    if psp_name == "paystack":
        mapping = PAYSTACK_EVENTS.get(event_type)
        if mapping is None:
            return EventDisposition(process=False, reason=f"unhandled paystack event {event_type!r}")
        return EventDisposition(process=True, transaction_type=mapping[0], settlement_status=mapping[1])

    if psp_name == "flutterwave":
        tx_type = FLUTTERWAVE_EVENTS.get(event_type)
        if tx_type is None:
            return EventDisposition(process=False, reason=f"unhandled flutterwave event {event_type!r}")
        status = str(data.get("status", "")).lower()
        settlement = _FLUTTERWAVE_STATUS.get(status)
        if settlement is None:
            return EventDisposition(process=False, reason=f"unrecognised flutterwave status {status!r}")
        if tx_type == "credit" and settlement != "settled":
            # A failed or pending charge never moved money in. Recording it as
            # a credit would invent a receivable.
            return EventDisposition(process=False, reason=f"flutterwave charge not successful ({status})")
        return EventDisposition(process=True, transaction_type=tx_type, settlement_status=settlement)

    return EventDisposition(process=False, reason=f"no normaliser for PSP {psp_name!r}")


# ── Normalisers ─────────────────────────────────────────────────────────────


def normalise_paystack_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: UUID | None,
    fx_rate_applied: Decimal | None,
    expected_settlement_at: datetime | None,
) -> dict[str, Any]:
    """
    Transform a Paystack webhook payload into a canonical Silver record.

    Paystack specifics:
        - Amounts are integers in kobo (1/100 NGN)
        - Reference: data.reference
        - Charge counterparty (payer): data.authorization (dedicated virtual
          accounts carry sender_name/sender_bank), else data.customer
        - Transfer counterparty (recipient): data.recipient.details
    """
    event_type = payload["event"]
    disposition = classify_event("paystack", event_type, payload)
    if not disposition.process:
        raise PermanentEventError(disposition.reason or "event not processable")
    data = payload["data"]
    reference = _require_str(data, "reference")

    amount_raw = _decimal(data.get("amount"), "data.amount") / Decimal(100)
    currency_raw = str(data.get("currency") or "NGN").upper()
    amount_ngn, fx_rate_snapshot_id, fx_rate_applied = _to_ngn(
        amount_raw, currency_raw, fx_rate_snapshot_id, fx_rate_applied
    )

    initiated_at = parse_timestamp(data.get("paid_at") or data.get("created_at") or data.get("createdAt"))
    settled_at = initiated_at if disposition.settlement_status == "settled" else None

    if disposition.transaction_type == "credit":
        auth = data.get("authorization") or {}
        customer = data.get("customer") or {}
        customer_name = " ".join(p for p in (customer.get("first_name"), customer.get("last_name")) if p) or None
        counterparty_name = auth.get("sender_name") or auth.get("account_name") or customer_name
        counterparty_account = auth.get("sender_bank_account_number") or auth.get("account_number")
        counterparty_bank_code = auth.get("bank_code")
        counterparty_bank_name = auth.get("sender_bank") or auth.get("bank")
    else:
        recipient = data.get("recipient") or {}
        details = recipient.get("details") or {}
        counterparty_name = details.get("account_name") or recipient.get("name")
        counterparty_account = details.get("account_number")
        counterparty_bank_code = details.get("bank_code")
        counterparty_bank_name = details.get("bank_name")

    fees = data.get("fees")
    psp_metadata = {
        "channel": data.get("channel"),
        "fees_kobo": int(fees) if isinstance(fees, int) else None,
        "paystack_id": data.get("id"),
        "status": data.get("status"),
    }

    return _canonical_record(
        psp_name="paystack",
        reference=reference,
        event_type=event_type,
        disposition=disposition,
        bronze_ingestion_id=bronze_ingestion_id,
        run_id=run_id,
        amount_raw=amount_raw,
        currency_raw=currency_raw,
        amount_ngn=amount_ngn,
        fx_rate_snapshot_id=fx_rate_snapshot_id,
        fx_rate_applied=fx_rate_applied,
        counterparty_name=counterparty_name,
        counterparty_account=counterparty_account,
        counterparty_bank_code=counterparty_bank_code,
        counterparty_bank_name=counterparty_bank_name,
        narration=_extract_paystack_narration(data),
        initiated_at=initiated_at,
        settled_at=settled_at,
        expected_settlement_at=expected_settlement_at,
        psp_metadata=psp_metadata,
    )


def normalise_flutterwave_event(
    payload: dict[str, Any],
    bronze_ingestion_id: UUID,
    run_id: UUID,
    fx_rate_snapshot_id: UUID | None,
    fx_rate_applied: Decimal | None,
    expected_settlement_at: datetime | None,
) -> dict[str, Any]:
    """
    Transform a Flutterwave webhook payload into a canonical Silver record.

    Flutterwave specifics:
        - Amounts are in major currency units (NGN, not kobo)
        - Reference: data.tx_ref (charges) or data.reference (transfers)
        - Outcome: data.status (successful / failed / pending)
        - Counterparty: data.account / data.customer (charges), data.full_name +
          data.account_number (transfers)
    """
    event_type = payload["event"]
    disposition = classify_event("flutterwave", event_type, payload)
    if not disposition.process:
        raise PermanentEventError(disposition.reason or "event not processable")
    data = payload["data"]
    reference = str(data.get("tx_ref") or data.get("reference") or "").strip()
    if not reference:
        raise PermanentEventError("flutterwave event has no tx_ref/reference")

    amount_raw = _decimal(data.get("amount"), "data.amount")
    currency_raw = str(data.get("currency") or "NGN").upper()
    amount_ngn, fx_rate_snapshot_id, fx_rate_applied = _to_ngn(
        amount_raw, currency_raw, fx_rate_snapshot_id, fx_rate_applied
    )

    initiated_at = parse_timestamp(data.get("created_at"))
    settled_at = initiated_at if disposition.settlement_status == "settled" else None

    account = data.get("account") or {}
    customer = data.get("customer") or {}
    counterparty_name = account.get("account_name") or data.get("full_name") or customer.get("name")
    counterparty_account = account.get("account_number") or data.get("account_number")
    counterparty_bank_code = account.get("bank_code") or data.get("bank_code")
    counterparty_bank_name = account.get("bank") or data.get("bank_name")

    psp_metadata = {
        "flw_ref": data.get("flw_ref"),
        "app_fee": str(data["app_fee"]) if data.get("app_fee") is not None else None,
        "merchant_fee": str(data["merchant_fee"]) if data.get("merchant_fee") is not None else None,
        "flutterwave_id": data.get("id"),
        "status": data.get("status"),
    }

    return _canonical_record(
        psp_name="flutterwave",
        reference=reference,
        event_type=event_type,
        disposition=disposition,
        bronze_ingestion_id=bronze_ingestion_id,
        run_id=run_id,
        amount_raw=amount_raw,
        currency_raw=currency_raw,
        amount_ngn=amount_ngn,
        fx_rate_snapshot_id=fx_rate_snapshot_id,
        fx_rate_applied=fx_rate_applied,
        counterparty_name=counterparty_name,
        counterparty_account=counterparty_account,
        counterparty_bank_code=counterparty_bank_code,
        counterparty_bank_name=counterparty_bank_name,
        narration=data.get("narration"),
        initiated_at=initiated_at,
        settled_at=settled_at,
        expected_settlement_at=expected_settlement_at,
        psp_metadata=psp_metadata,
    )


NORMALISERS = {
    "paystack": normalise_paystack_event,
    "flutterwave": normalise_flutterwave_event,
}


# ── Helpers ─────────────────────────────────────────────────────────────────


def _canonical_record(
    *,
    psp_name: str,
    reference: str,
    event_type: str,
    disposition: EventDisposition,
    bronze_ingestion_id: UUID,
    run_id: UUID,
    amount_raw: Decimal,
    currency_raw: str,
    amount_ngn: Decimal,
    fx_rate_snapshot_id: UUID | None,
    fx_rate_applied: Decimal | None,
    counterparty_name: str | None,
    counterparty_account: str | None,
    counterparty_bank_code: str | None,
    counterparty_bank_name: str | None,
    narration: str | None,
    initiated_at: datetime,
    settled_at: datetime | None,
    expected_settlement_at: datetime | None,
    psp_metadata: dict[str, Any],
) -> dict[str, Any]:
    if amount_raw <= 0:
        raise PermanentEventError(f"non-positive amount {amount_raw}")
    return {
        "id": uuid4(),
        "idempotency_key": build_idempotency_key(psp_name, reference, event_type),
        "bronze_ingestion_id": bronze_ingestion_id,
        "psp_name": psp_name,
        "psp_transaction_ref": reference,
        "psp_event_type": event_type,
        "psp_event_received_at": datetime.now(UTC),
        "transaction_type": disposition.transaction_type,
        "amount_raw": amount_raw,
        "currency_raw": currency_raw,
        "amount_ngn": amount_ngn,
        "fx_rate_snapshot_id": fx_rate_snapshot_id,
        "fx_rate_applied": fx_rate_applied,
        # Only the counterparty's details are known; the canonical schema
        # stores them in the beneficiary_* columns, masked for display.
        "sender_account_masked": None,
        "sender_bank_code": None,
        "sender_bank_name": None,
        "beneficiary_account_masked": mask_account_number(counterparty_account),
        "beneficiary_bank_code": counterparty_bank_code,
        "beneficiary_bank_name": counterparty_bank_name,
        "beneficiary_name_masked": mask_name(counterparty_name),
        "counterparty_name_tokens": tokenize_name(counterparty_name),
        "narration": scrub_narration(narration),
        "initiated_at": initiated_at,
        "settled_at": settled_at,
        "expected_settlement_at": expected_settlement_at,
        "settlement_status": disposition.settlement_status,
        "has_pii_masked": True,  # Explicit flag — required by CHECK constraint
        "psp_metadata": psp_metadata,
        "processed_by_run_id": run_id,
    }


def _to_ngn(
    amount_raw: Decimal,
    currency_raw: str,
    fx_rate_snapshot_id: UUID | None,
    fx_rate_applied: Decimal | None,
) -> tuple[Decimal, UUID | None, Decimal | None]:
    if currency_raw == "NGN":
        return amount_raw, None, None
    if fx_rate_applied is None:
        raise PermanentEventError(f"FX rate required for non-NGN currency: {currency_raw}")
    from src.engine.fx import convert_to_ngn

    return convert_to_ngn(amount_raw, currency_raw, fx_rate_applied), fx_rate_snapshot_id, fx_rate_applied


def _decimal(value: Any, field: str) -> Decimal:
    if value is None or isinstance(value, bool):
        raise PermanentEventError(f"{field} missing or not numeric")
    try:
        # repr() of a JSON float is its shortest round-trip form ("50000.5"),
        # so this never inherits binary floating-point noise.
        result = Decimal(repr(value) if isinstance(value, float) else str(value))
    except InvalidOperation as e:
        raise PermanentEventError(f"{field} is not a number: {value!r}") from e
    if not result.is_finite():
        raise PermanentEventError(f"{field} is not finite")
    return result


def _require_str(data: dict[str, Any], field: str) -> str:
    value = data.get(field)
    if not value or not str(value).strip():
        raise PermanentEventError(f"data.{field} is required")
    return str(value).strip()


def parse_timestamp(ts_str: str | None) -> datetime:
    """Parse an ISO-8601 timestamp (handling the Z suffix) into aware UTC."""
    if not ts_str:
        raise PermanentEventError("event has no timestamp")
    try:
        dt = datetime.fromisoformat(str(ts_str).replace("Z", "+00:00"))
    except ValueError as e:
        raise PermanentEventError(f"unparseable timestamp {ts_str!r}") from e
    if dt.tzinfo is None:
        raise PermanentEventError(f"timestamp without timezone {ts_str!r}")
    return dt.astimezone(UTC)


def _extract_paystack_narration(data: dict[str, Any]) -> str | None:
    """Extract narration from Paystack custom_fields metadata if present."""
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        return None
    custom_fields = metadata.get("custom_fields")
    if isinstance(custom_fields, list) and custom_fields and isinstance(custom_fields[0], dict):
        value = custom_fields[0].get("value")
        return str(value) if value is not None else None
    return None
