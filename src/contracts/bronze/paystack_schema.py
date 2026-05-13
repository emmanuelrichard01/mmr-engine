# src/contracts/bronze/paystack_schema.py
"""
Bronze Pandera schema for Paystack webhook payloads.

This is a schema-on-read contract — the Bronze layer stores raw data
as Parquet, and this schema validates structure before Silver promotion.

The Bronze schema is intentionally lenient: it checks that required
columns exist and have the right type, but does NOT enforce business
rules (amounts must be positive, currencies must be valid, etc.).
Those rules belong in the Silver schema.

References:
    - TDD §9.5: Schema Contracts
    - Data Architecture §5: Bronze Layer — "Accept everything, validate nothing"
"""
import pandera as pa
from pandera import Column, DataFrameSchema, Check


PAYSTACK_BRONZE_SCHEMA = DataFrameSchema(
    columns={
        "_ingestion_id": Column(str, nullable=False, coerce=True),
        "_received_at": Column("datetime64[ns, UTC]", nullable=False, coerce=True),
        "_source_type": Column(
            str,
            checks=Check.isin(["webhook", "polling", "manual"]),
            nullable=False,
        ),
        "_content_hash": Column(str, nullable=False),
        "_kafka_offset": Column("Int64", nullable=True, coerce=True),
        "event": Column(str, nullable=False),
        "data": Column(str, nullable=False),  # Raw JSON as string
    },
    strict=False,  # Allow extra columns — Bronze is schema-on-read
    coerce=True,
    name="paystack_bronze",
    description="Validates minimum structural requirements for Paystack "
    "Bronze records before Silver promotion.",
)
