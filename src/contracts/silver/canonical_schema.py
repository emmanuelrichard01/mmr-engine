# src/contracts/silver/canonical_schema.py
"""
Silver Pandera schema for canonical transactions.

This is the strictest schema in the system — every Silver record
must pass this validation before being written to PostgreSQL.

Business rules enforced here:
    - Amount must be positive
    - Currency must be a recognised ISO 4217 code
    - has_pii_masked must be True (mirrors DB CHECK constraint)
    - Settlement status must be a valid enum value
    - Initiated_at must be timezone-aware
    - PSP name must match a supported connector

The Silver schema is the contract boundary between the ingestion
pipeline (which may be unreliable) and the canonical ledger
(which must be correct).

References:
    - TDD §9.5: Schema Contracts
    - Data Architecture §5: Silver Layer — "Trust but verify"
    - ERD §6.5: silver_canonical_transactions constraints
"""
import pandera as pa
from pandera import Column, DataFrameSchema, Check
import pandas as pd

SUPPORTED_PSPS = ["paystack", "flutterwave", "mpesa"]
SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "KES", "GHS", "ZAR"]
SETTLEMENT_STATUSES = ["pending", "settled", "failed", "reversed"]
TRANSACTION_TYPES = ["credit", "debit", "reversal"]

# ── Custom Checks ─────────────────────────────────────────────────────────────

def _check_no_raw_nuban(series: pd.Series) -> pd.Series:
    """
    Correctness property C-003: No raw 10-digit NUBAN in masked fields.

    A masked account like '01******89' is valid.
    A raw account like '0123456789' (10 consecutive digits) is a masking failure.
    None/NaN values pass (nullable fields).
    """
    return series.isna() | ~series.str.match(r"^\d{10}$", na=False)


_NO_RAW_NUBAN_CHECK = Check(
    _check_no_raw_nuban,
    element_wise=False,
    error="Raw 10-digit NUBAN detected in masked field — PII masking failure (C-003)",
    name="no_raw_nuban",
)


def _check_fx_rate_for_non_ngn(df: pd.DataFrame) -> bool:
    """
    Correctness property C-006: Non-NGN transactions must have FX rate reference.

    If currency_raw != 'NGN' and fx_rate_snapshot_id is present in the DataFrame,
    then fx_rate_snapshot_id must not be null for those rows.

    This check is lenient if fx_rate_snapshot_id is not in the DataFrame
    (it may be excluded from validation columns).
    """
    if "fx_rate_snapshot_id" not in df.columns:
        return True
    non_ngn = df[df["currency_raw"] != "NGN"]
    if non_ngn.empty:
        return True
    return non_ngn["fx_rate_snapshot_id"].notna().all()


# ── Schema Definition ─────────────────────────────────────────────────────────

SILVER_CANONICAL_SCHEMA = DataFrameSchema(
    columns={
        "idempotency_key": Column(
            str,
            nullable=False,
            checks=[
                # Format: {psp}:{ref}:{event_type}
                Check.str_matches(r"^[a-z]+:.+:.+$"),
                # Minimum length sanity check
                Check.str_length(min_value=10),
            ],
        ),
        "psp_name": Column(
            str,
            checks=Check.isin(SUPPORTED_PSPS),
            nullable=False,
        ),
        "psp_transaction_ref": Column(
            str,
            nullable=False,
            checks=Check.str_length(min_value=1),
        ),
        "psp_event_type": Column(
            str,
            nullable=False,
            checks=Check.str_length(min_value=1),
        ),
        "transaction_type": Column(
            str,
            checks=Check.isin(TRANSACTION_TYPES),
            nullable=False,
        ),
        "amount_raw": Column(
            float,
            checks=Check.greater_than(0),
            nullable=False,
            coerce=True,
        ),
        "currency_raw": Column(
            str,
            checks=Check.isin(SUPPORTED_CURRENCIES),
            nullable=False,
        ),
        "amount_ngn": Column(
            float,
            checks=Check.greater_than(0),
            nullable=False,
            coerce=True,
        ),
        "settlement_status": Column(
            str,
            checks=Check.isin(SETTLEMENT_STATUSES),
            nullable=False,
        ),
        "has_pii_masked": Column(
            bool,
            checks=Check.equal_to(True),
            nullable=False,
            description="Must always be True — mirrors the DB CHECK constraint. "
            "A False value means PII was not scrubbed and must not be stored in Silver.",
        ),
        # ── Nullable fields with PII guards ───────────────────────────────
        "beneficiary_account_masked": Column(
            str, nullable=True,
            checks=[_NO_RAW_NUBAN_CHECK],
            description="Must be masked format (e.g. '01******89'), never raw NUBAN.",
        ),
        "beneficiary_bank_code": Column(str, nullable=True),
        "beneficiary_bank_name": Column(str, nullable=True),
        "beneficiary_name_masked": Column(str, nullable=True),
        "sender_account_masked": Column(
            str, nullable=True,
            checks=[_NO_RAW_NUBAN_CHECK],
            description="Must be masked format, never raw NUBAN.",
        ),
        "sender_bank_code": Column(str, nullable=True),
        "sender_bank_name": Column(str, nullable=True),
        "narration": Column(str, nullable=True),
        "initiated_at": Column("datetime64[ns, UTC]", nullable=True, coerce=True),
        "settled_at": Column("datetime64[ns, UTC]", nullable=True, coerce=True),
        "expected_settlement_at": Column("datetime64[ns, UTC]", nullable=True, coerce=True),
    },
    checks=[
        # Cross-field: FX rate required for non-NGN (C-006)
        Check(_check_fx_rate_for_non_ngn, error=(
            "Non-NGN transaction missing fx_rate_snapshot_id — "
            "FX rate must be captured before Silver write (C-006)"
        )),
    ],
    strict=False,  # Allow extra columns (id, bronze_ingestion_id, etc.)
    coerce=True,
    name="silver_canonical",
    description="Validates business invariants for Silver canonical transactions. "
    "Every record must pass this before INSERT into silver_canonical_transactions.",
)
