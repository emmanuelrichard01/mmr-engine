"""Apply role-based permissions

Revision ID: 011
Revises: 010
Create Date: 2026-05-04

Reference: ERD §7 — Database Role Permissions
"""
from typing import Sequence, Union
from alembic import op

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Pipeline role: reads all, writes Bronze/Silver/Gold/System
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_pipeline")
    op.execute("""
        GRANT INSERT, UPDATE ON
            bronze_ingestion_log,
            silver_canonical_transactions,
            silver_fx_rate_snapshots,
            silver_idempotency_keys,
            silver_psp_settlement_windows,
            silver_transaction_audit_log,
            gold_reconciliation_pairs,
            gold_discrepancies,
            gold_cbn_daily_returns,
            gold_exposure_tracker,
            system_pipeline_runs,
            system_alert_events
        TO reconciliation_pipeline
    """)

    # API role: reads all, writes only resolution columns
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_api_user")
    op.execute("""
        GRANT UPDATE (status, resolved_by, resolved_at, resolution_note,
                      resolution_type, reviewed_at, updated_at)
            ON gold_discrepancies TO reconciliation_api_user
    """)
    op.execute("""
        GRANT UPDATE (status, reviewed_at, resolved_by, resolved_at,
                      resolution_note, updated_at)
            ON gold_reconciliation_pairs TO reconciliation_api_user
    """)

    # dbt role: reads Silver, writes Gold
    op.execute("""
        GRANT SELECT ON
            silver_canonical_transactions,
            silver_fx_rate_snapshots,
            silver_psp_settlement_windows
        TO reconciliation_dbt
    """)
    op.execute("""
        GRANT INSERT, UPDATE ON
            gold_reconciliation_pairs,
            gold_discrepancies,
            gold_cbn_daily_returns,
            gold_exposure_tracker
        TO reconciliation_dbt
    """)

    # Readonly role: no writes anywhere
    op.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO reconciliation_readonly")

    # Audit log is insert-only — no UPDATE, no DELETE
    op.execute("REVOKE UPDATE, DELETE ON silver_transaction_audit_log FROM PUBLIC")
    op.execute("REVOKE UPDATE, DELETE ON bronze_ingestion_log FROM PUBLIC")


def downgrade() -> None:
    for role in ["reconciliation_pipeline", "reconciliation_api_user",
                 "reconciliation_dbt", "reconciliation_readonly"]:
        op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}")
