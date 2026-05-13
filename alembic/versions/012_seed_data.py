"""Seed settlement windows

Revision ID: 012
Revises: 011
Create Date: 2026-05-04

Reference: ERD §8, Data Dictionary — PSP settlement SLA defaults
"""
from typing import Sequence, Union
from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO silver_psp_settlement_windows
            (psp_name, transaction_type, account_tier, settlement_lag_hours,
             settlement_days, cutoff_time_wat, effective_from, notes)
        VALUES
            ('paystack', 'credit', 'standard', 24.0, 'business', '23:59',
             '2026-01-01', 'Paystack standard: T+1 business day'),
            ('paystack', 'debit', 'standard', 24.0, 'business', '23:59',
             '2026-01-01', 'Paystack transfers: T+1 business day'),
            ('paystack', 'credit', 'growth', 12.0, 'calendar', NULL,
             '2026-01-01', 'Paystack growth tier: same day (12h max)'),
            ('flutterwave', 'credit', 'standard', 24.0, 'business', '18:00',
             '2026-01-01', 'Flutterwave standard: T+1, 6PM WAT cutoff'),
            ('flutterwave', 'debit', 'standard', 24.0, 'business', '18:00',
             '2026-01-01', 'Flutterwave transfers: T+1, 6PM WAT cutoff'),
            ('mpesa', 'credit', 'standard', 1.5, 'calendar', NULL,
             '2026-01-01', 'M-Pesa real-time: ~90 minutes max'),
            ('mpesa', 'debit', 'standard', 1.5, 'calendar', NULL,
             '2026-01-01', 'M-Pesa real-time: ~90 minutes max')
        ON CONFLICT (psp_name, transaction_type, account_tier, effective_from) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM silver_psp_settlement_windows WHERE effective_from = '2026-01-01'")
