"""Create enum types

Revision ID: 001
Revises: 000
Create Date: 2026-05-04

Reference: ERD §6.2 — Enumerated Types
"""
from typing import Sequence, Union

from alembic import op

revision: str = "001"
down_revision: Union[str, None] = "000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TYPE psp_name_enum AS ENUM (
            'paystack', 'flutterwave', 'mpesa', 'moniepoint'
        )
    """)
    op.execute("""
        CREATE TYPE source_type_enum AS ENUM (
            'webhook', 'polling'
        )
    """)
    op.execute("""
        CREATE TYPE ingestion_status_enum AS ENUM (
            'received', 'written', 'failed'
        )
    """)
    op.execute("""
        CREATE TYPE settlement_status_enum AS ENUM (
            'pending', 'settled', 'failed', 'reversed', 'disputed'
        )
    """)
    op.execute("""
        CREATE TYPE transaction_type_enum AS ENUM (
            'credit', 'debit', 'reversal'
        )
    """)
    op.execute("""
        CREATE TYPE match_strategy_enum AS ENUM (
            'exact_primary', 'probabilistic_secondary', 'manual'
        )
    """)
    op.execute("""
        CREATE TYPE pair_status_enum AS ENUM (
            'matched', 'discrepancy', 'under_review', 'resolved', 'false_positive'
        )
    """)
    op.execute("""
        CREATE TYPE discrepancy_class_enum AS ENUM (
            'missing_settlement', 'amount_mismatch', 'fx_variance',
            'duplicate_credit', 'unmatched_credit', 'late_settlement'
        )
    """)
    op.execute("""
        CREATE TYPE discrepancy_status_enum AS ENUM (
            'open', 'under_review', 'resolved', 'false_positive', 'escalated'
        )
    """)
    op.execute("""
        CREATE TYPE cbn_submission_status_enum AS ENUM (
            'draft', 'approved', 'submitted', 'acknowledged'
        )
    """)
    op.execute("""
        CREATE TYPE alert_channel_enum AS ENUM (
            'slack', 'email', 'pagerduty', 'webhook'
        )
    """)
    op.execute("""
        CREATE TYPE alert_status_enum AS ENUM (
            'queued', 'sent', 'delivered', 'failed'
        )
    """)
    op.execute("""
        CREATE TYPE pipeline_status_enum AS ENUM (
            'running', 'completed', 'failed', 'cancelled'
        )
    """)


def downgrade() -> None:
    for enum_name in [
        "pipeline_status_enum", "alert_status_enum", "alert_channel_enum",
        "cbn_submission_status_enum", "discrepancy_status_enum",
        "discrepancy_class_enum", "pair_status_enum", "match_strategy_enum",
        "transaction_type_enum", "settlement_status_enum",
        "ingestion_status_enum", "source_type_enum", "psp_name_enum",
    ]:
        op.execute(f"DROP TYPE IF EXISTS {enum_name}")
