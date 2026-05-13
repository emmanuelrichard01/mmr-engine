# src/contracts/bronze/flutterwave_schema.py
"""
Bronze Pandera schema for Flutterwave webhook payloads.

Identical structure to Paystack Bronze — the Bronze layer standardises
metadata columns regardless of PSP. The raw payload (data column)
remains PSP-specific and is validated during Silver normalisation.

References:
    - TDD §9.5: Schema Contracts
    - Data Architecture §5: Bronze Layer
"""
import pandera as pa
from pandera import Column, DataFrameSchema, Check


FLUTTERWAVE_BRONZE_SCHEMA = DataFrameSchema(
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
        "data": Column(str, nullable=False),
    },
    strict=False,
    coerce=True,
    name="flutterwave_bronze",
    description="Validates minimum structural requirements for Flutterwave "
    "Bronze records before Silver promotion.",
)
