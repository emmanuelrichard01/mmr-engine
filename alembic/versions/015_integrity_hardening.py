"""Integrity hardening: one-to-one matches, name tokens, real audit trail, least privilege

Revision ID: 015
Revises: 014
Create Date: 2026-10-02

1. silver_canonical_transactions.counterparty_name_tokens: keyed HMAC name
   tokens used for matching (masked names cannot be matched; ADR 0001).
2. gold_matched_transactions: one row per matched transaction, primary key on
   transaction_id. The database itself guarantees a transaction is matched at
   most once, even under concurrent matching runs. UNIQUE (a, b) on the pairs
   table (013) does not: it allows (A,B) and (A,C), or (A,B) and (B,A).
3. gold_discrepancy_events: append-only log of every discrepancy state change
   (who, what, when, why). UPDATE/DELETE/TRUNCATE are blocked by trigger, for
   the table owner too.
4. Append-only enforcement on silver_transaction_audit_log as well.
5. gold_reconciliation_summary materialized view rebuilt: it joined pairs on
   transaction_a_id only (B-side transactions counted as unmatched) and fanned
   out discrepancy sums. A SECURITY DEFINER function lets the pipeline role
   refresh it without owning it.
6. Least privilege restored: scripts/init_postgres.sql's ALTER DEFAULT
   PRIVILEGES granted table-wide UPDATE to the API and dbt roles on every
   table, silently overriding the column-level grants in 011.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "015"
down_revision: str | None = "014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BLOCK_MUTATION_FN = """
    CREATE OR REPLACE FUNCTION fn_block_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
        RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
            USING ERRCODE = 'insufficient_privilege';
    END;
    $$
"""

_SUMMARY_VIEW = """
    CREATE MATERIALIZED VIEW gold_reconciliation_summary AS
    WITH tx AS (
        SELECT
            ct.id,
            DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos') AS summary_date,
            ct.psp_name,
            ct.amount_ngn,
            ct.settled_at,
            ct.expected_settlement_at,
            (mt.transaction_id IS NOT NULL) AS is_matched
        FROM silver_canonical_transactions ct
        LEFT JOIN gold_matched_transactions mt ON mt.transaction_id = ct.id
        WHERE ct.transaction_type IN ('credit', 'debit')
    ),
    disc AS (
        SELECT
            d.transaction_id,
            COUNT(*) FILTER (WHERE d.status IN ('open', 'under_review', 'escalated')) AS open_count,
            COUNT(*) FILTER (WHERE d.status IN ('resolved', 'false_positive')) AS resolved_count,
            COALESCE(SUM(d.estimated_exposure_ngn)
                FILTER (WHERE d.status IN ('open', 'under_review', 'escalated')), 0) AS open_exposure
        FROM gold_discrepancies d
        GROUP BY d.transaction_id
    )
    SELECT
        tx.summary_date,
        tx.psp_name,
        COUNT(*) AS total_transactions,
        SUM(tx.amount_ngn) AS total_volume_ngn,
        COUNT(*) FILTER (WHERE tx.is_matched) AS total_matched,
        COALESCE(SUM(tx.amount_ngn) FILTER (WHERE tx.is_matched), 0) AS matched_volume_ngn,
        ROUND(COUNT(*) FILTER (WHERE tx.is_matched) * 100.0 / NULLIF(COUNT(*), 0), 4) AS match_rate_pct,
        COALESCE(SUM(disc.open_count), 0) AS open_discrepancy_count,
        COALESCE(SUM(disc.resolved_count), 0) AS resolved_discrepancy_count,
        COALESCE(SUM(disc.open_exposure), 0) AS open_exposure_ngn,
        COUNT(*) FILTER (
            WHERE tx.expected_settlement_at IS NOT NULL
              AND COALESCE(tx.settled_at, NOW()) > tx.expected_settlement_at
        ) AS sla_breach_count,
        NOW() AS last_refreshed_at
    FROM tx
    LEFT JOIN disc ON disc.transaction_id = tx.id
    GROUP BY tx.summary_date, tx.psp_name
"""

# Verbatim from 010, used only by downgrade().
_LEGACY_SUMMARY_VIEW = """
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
                FILTER (WHERE 
                    (ct.settled_at IS NOT NULL AND ct.expected_settlement_at IS NOT NULL AND ct.settled_at > ct.expected_settlement_at)
                    OR
                    (ct.settled_at IS NULL AND ct.expected_settlement_at IS NOT NULL AND NOW() > ct.expected_settlement_at)
                ) AS sla_breach_count,
            NOW() AS last_refreshed_at
        FROM silver_canonical_transactions ct
        LEFT JOIN gold_reconciliation_pairs rp ON ct.id = rp.transaction_a_id
        LEFT JOIN gold_discrepancies d ON ct.id = d.transaction_id
        GROUP BY DATE(ct.initiated_at AT TIME ZONE 'Africa/Lagos'), ct.psp_name
    """


def upgrade() -> None:
    # ── 1. Counterparty name tokens ──────────────────────────────────────
    # The trigram index on *masked* names served no query (matching never
    # used it) and could not have helped: masked names are not matchable.
    op.execute("DROP INDEX IF EXISTS idx_silver_tx_beneficiary_trgm")
    op.execute("""
        ALTER TABLE silver_canonical_transactions
        ADD COLUMN counterparty_name_tokens TEXT[] NOT NULL DEFAULT '{}'
    """)

    # M-Pesa was never implemented; drop its seeded settlement windows (012).
    # The 'mpesa' value stays in psp_name_enum: PostgreSQL cannot drop enum
    # values, and no code path accepts it (see canonical_schema.SUPPORTED_PSPS).
    op.execute("DELETE FROM silver_psp_settlement_windows WHERE psp_name = 'mpesa'")

    # ── 2. One-to-one match guarantee ────────────────────────────────────
    op.execute("""
        CREATE TABLE gold_matched_transactions (
            transaction_id  UUID PRIMARY KEY
                REFERENCES silver_canonical_transactions(id) ON DELETE RESTRICT,
            pair_id         UUID NOT NULL
                REFERENCES gold_reconciliation_pairs(id) ON DELETE CASCADE,
            matched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_matched_tx_pair ON gold_matched_transactions (pair_id)")
    # Backfill from existing pairs. Where history already double-matched a
    # transaction, the earliest pair keeps it; later conflicting pairs are
    # flagged for review rather than silently deleted.
    op.execute("""
        INSERT INTO gold_matched_transactions (transaction_id, pair_id, matched_at)
        SELECT tx_id, pair_id, matched_at FROM (
            SELECT p.transaction_a_id AS tx_id, p.id AS pair_id, p.matched_at FROM gold_reconciliation_pairs p
            UNION ALL
            SELECT p.transaction_b_id, p.id, p.matched_at FROM gold_reconciliation_pairs p
            WHERE p.transaction_b_id IS NOT NULL
        ) s
        ORDER BY matched_at, pair_id
        ON CONFLICT (transaction_id) DO NOTHING
    """)
    op.execute("""
        UPDATE gold_reconciliation_pairs p
        SET status = 'under_review',
            match_evidence = COALESCE(p.match_evidence, '{}'::jsonb)
                || '{"review_reason": "transaction matched in more than one pair"}'::jsonb
        WHERE EXISTS (
            SELECT 1 FROM gold_matched_transactions m
            WHERE m.transaction_id IN (p.transaction_a_id, p.transaction_b_id)
              AND m.pair_id <> p.id
        )
    """)

    # ── 3/4. Append-only audit trail ─────────────────────────────────────
    op.execute(_BLOCK_MUTATION_FN)
    op.execute("""
        CREATE TABLE gold_discrepancy_events (
            id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            discrepancy_id  UUID NOT NULL REFERENCES gold_discrepancies(id) ON DELETE RESTRICT,
            action          VARCHAR(50) NOT NULL
                CHECK (action IN ('raised', 'severity_changed', 'resolved', 'marked_false_positive', 'escalated', 'reopened')),
            from_status     discrepancy_status_enum,
            to_status       discrepancy_status_enum NOT NULL,
            actor           VARCHAR(200) NOT NULL,
            note            TEXT,
            occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX idx_discrepancy_events_disc ON gold_discrepancy_events (discrepancy_id, occurred_at)")
    for table in ("gold_discrepancy_events", "silver_transaction_audit_log"):
        op.execute(f"""
            CREATE TRIGGER trg_{table}_append_only
                BEFORE UPDATE OR DELETE ON {table}
                FOR EACH ROW EXECUTE FUNCTION fn_block_mutation()
        """)
        op.execute(f"""
            CREATE TRIGGER trg_{table}_no_truncate
                BEFORE TRUNCATE ON {table}
                FOR EACH STATEMENT EXECUTE FUNCTION fn_block_mutation()
        """)
    # Backfill a 'raised' event for every existing discrepancy so each one
    # has a complete history from here on.
    op.execute("""
        INSERT INTO gold_discrepancy_events (discrepancy_id, action, from_status, to_status, actor, occurred_at)
        SELECT id, 'raised', NULL, 'open', 'system:backfill-015', raised_at FROM gold_discrepancies
    """)

    # ── 5. Correct summary view + refresh function ───────────────────────
    op.execute("DROP MATERIALIZED VIEW IF EXISTS gold_reconciliation_summary")
    op.execute(_SUMMARY_VIEW)
    op.execute("CREATE UNIQUE INDEX idx_summary_date_psp ON gold_reconciliation_summary (summary_date, psp_name)")
    op.execute("""
        CREATE OR REPLACE FUNCTION refresh_reconciliation_summary()
        RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
            REFRESH MATERIALIZED VIEW CONCURRENTLY gold_reconciliation_summary;
        $$
    """)
    op.execute("REVOKE ALL ON FUNCTION refresh_reconciliation_summary() FROM PUBLIC")

    # ── 6. Least privilege ───────────────────────────────────────────────
    # Revoking table-level UPDATE also drops column-level grants, so the
    # intended column grants from 011 are re-applied afterwards.
    op.execute("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM reconciliation_api_user")
    op.execute("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM reconciliation_readonly")
    op.execute("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM reconciliation_dbt")
    op.execute("REVOKE UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM reconciliation_pipeline")
    for role in ("reconciliation_pipeline", "reconciliation_api_user", "reconciliation_readonly"):
        op.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {role}")
    op.execute("""
        GRANT INSERT ON
            bronze_ingestion_log, silver_canonical_transactions, silver_fx_rate_snapshots,
            silver_idempotency_keys, silver_transaction_audit_log, gold_reconciliation_pairs,
            gold_matched_transactions, gold_discrepancies, gold_discrepancy_events,
            gold_cbn_daily_returns, gold_exposure_tracker, system_pipeline_runs, system_alert_events
        TO reconciliation_pipeline
    """)
    # Pipeline UPDATEs, column by column, for the state it legitimately owns.
    op.execute(
        "GRANT UPDATE (occurrence_count, last_seen_at, canonical_tx_id) ON silver_idempotency_keys TO reconciliation_pipeline"
    )
    op.execute("GRANT UPDATE (valid_until) ON silver_fx_rate_snapshots TO reconciliation_pipeline")
    op.execute("""
        GRANT UPDATE (status, completed_at, records_processed, records_failed, error_message, error_traceback, metadata)
        ON system_pipeline_runs TO reconciliation_pipeline
    """)
    op.execute("""
        GRANT UPDATE (severity, estimated_exposure_ngn, evidence, updated_at, has_alert_sent, alert_sent_at)
        ON gold_discrepancies TO reconciliation_pipeline
    """)
    op.execute(
        "GRANT UPDATE (status, sent_at, delivery_confirmed_at, failure_reason, retry_count) ON system_alert_events TO reconciliation_pipeline"
    )
    op.execute("GRANT UPDATE (status, updated_at) ON gold_reconciliation_pairs TO reconciliation_pipeline")
    # Derived reporting tables are regenerated (upserted) by their flows.
    op.execute("GRANT UPDATE ON gold_cbn_daily_returns, gold_exposure_tracker TO reconciliation_pipeline")
    op.execute("GRANT EXECUTE ON FUNCTION refresh_reconciliation_summary() TO reconciliation_pipeline")
    # API: resolution columns + audit events + last-used bookkeeping on keys.
    op.execute("""
        GRANT UPDATE (status, resolved_by, resolved_at, resolution_note,
                      resolution_type, reviewed_at, updated_at)
            ON gold_discrepancies TO reconciliation_api_user
    """)
    op.execute("GRANT INSERT ON gold_discrepancy_events TO reconciliation_api_user")
    op.execute("GRANT UPDATE (last_used_at, usage_count) ON system_api_keys TO reconciliation_api_user")


def downgrade() -> None:
    op.execute("REVOKE UPDATE (last_used_at, usage_count) ON system_api_keys FROM reconciliation_api_user")
    op.execute("DROP FUNCTION IF EXISTS refresh_reconciliation_summary()")
    op.execute("DROP MATERIALIZED VIEW IF EXISTS gold_reconciliation_summary")
    for table in ("gold_discrepancy_events", "silver_transaction_audit_log"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_append_only ON {table}")
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_truncate ON {table}")
    op.execute("DROP TABLE IF EXISTS gold_discrepancy_events")
    op.execute("DROP FUNCTION IF EXISTS fn_block_mutation()")
    op.execute("DROP TABLE IF EXISTS gold_matched_transactions")
    op.execute("ALTER TABLE silver_canonical_transactions DROP COLUMN IF EXISTS counterparty_name_tokens")
    op.execute("""
        INSERT INTO silver_psp_settlement_windows
            (psp_name, transaction_type, account_tier, settlement_lag_hours, settlement_days,
             cutoff_time_wat, effective_from, notes)
        VALUES
            ('mpesa', 'credit', 'standard', 1.5, 'calendar', NULL, '2026-01-01', 'M-Pesa real-time: ~90 minutes max'),
            ('mpesa', 'debit', 'standard', 1.5, 'calendar', NULL, '2026-01-01', 'M-Pesa real-time: ~90 minutes max')
        ON CONFLICT DO NOTHING
    """)
    # Restore the pre-015 view exactly as 010 defined it.
    op.execute(_LEGACY_SUMMARY_VIEW)
    op.execute("CREATE UNIQUE INDEX idx_summary_date_psp ON gold_reconciliation_summary (summary_date, psp_name)")
