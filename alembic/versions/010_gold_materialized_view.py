"""Create gold materialized view

Revision ID: 010
Revises: 009
Create Date: 2026-05-04

Reference: ERD §6.6
"""
from typing import Sequence, Union
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE MATERIALIZED VIEW gold_reconciliation_summary AS
        SELECT
            DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos') AS summary_date,
            ct.psp_name,
            COUNT(DISTINCT ct.id) AS total_transactions,
            SUM(ct.amount_ngn) AS total_volume_ngn,
            COUNT(DISTINCT rp.id)
                FILTER (WHERE rp.status = 'matched') AS total_matched,
            SUM(ct.amount_ngn)
                FILTER (WHERE rp.status = 'matched') AS matched_volume_ngn,
            ROUND(
                COUNT(DISTINCT rp.id) FILTER (WHERE rp.status = 'matched') * 100.0
                / NULLIF(COUNT(DISTINCT ct.id), 0), 4
            ) AS match_rate_pct,
            COUNT(DISTINCT d.id)
                FILTER (WHERE d.status = 'open') AS open_discrepancy_count,
            COUNT(DISTINCT d.id)
                FILTER (WHERE d.status = 'resolved') AS resolved_discrepancy_count,
            COALESCE(
                SUM(d.estimated_exposure_ngn)
                FILTER (WHERE d.status = 'open'), 0
            ) AS open_exposure_ngn,
            ROUND(AVG(rp.settlement_lag_actual_minutes), 2) AS avg_settlement_lag_minutes,
            COUNT(DISTINCT ct.id)
                FILTER (WHERE ct.settlement_sla_breached = TRUE) AS sla_breach_count,
            NOW() AS last_refreshed_at
        FROM silver_canonical_transactions ct
        LEFT JOIN gold_reconciliation_pairs rp ON ct.id = rp.transaction_a_id
        LEFT JOIN gold_discrepancies d ON ct.id = d.transaction_id
        GROUP BY DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos'), ct.psp_name
    """)
    op.execute("CREATE UNIQUE INDEX idx_summary_date_psp ON gold_reconciliation_summary (summary_date, psp_name)")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS gold_reconciliation_summary")
