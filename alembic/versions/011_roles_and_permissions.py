"""Apply role-based permissions

Revision ID: 011
Revises: 010
Create Date: 2026-05-04

Reference: ERD §7 — Database Role Permissions
"""

from collections.abc import Sequence

from alembic import op

revision: str = "011"
down_revision: str | None = "010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Roles are normally created (with LOGIN + passwords) by
    # scripts/init_postgres.sql. Create them here as NOLOGIN if absent so a
    # bare Postgres (CI, tests) can run every migration; credentials stay
    # an environment concern and never live in migrations.
    op.execute("""
        DO $$
        DECLARE r TEXT;
        BEGIN
            FOREACH r IN ARRAY ARRAY['reconciliation_pipeline', 'reconciliation_api_user',
                                     'reconciliation_readonly', 'reconciliation_dbt']
            LOOP
                IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = r) THEN
                    EXECUTE format('CREATE ROLE %I NOLOGIN', r);
                END IF;
            END LOOP;
        END
        $$
    """)

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
    for role in ["reconciliation_pipeline", "reconciliation_api_user", "reconciliation_dbt", "reconciliation_readonly"]:
        op.execute(f"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM {role}")
