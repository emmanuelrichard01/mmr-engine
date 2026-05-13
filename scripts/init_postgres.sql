-- init_postgres.sql
-- Creates application roles and databases on first boot.
-- Mounted into PostgreSQL's docker-entrypoint-initdb.d/
--
-- Reference: TDD §5, ERD §7

-- Create the Prefect database (separate from reconciliation data)
CREATE DATABASE prefect;

-- ── Application Roles ────────────────────────────────────────────────────────
-- Never use superuser (postgres) in application code.

DO $$
BEGIN
    -- Pipeline role: writes to Bronze, Silver, and Gold
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'reconciliation_pipeline') THEN
        CREATE ROLE reconciliation_pipeline LOGIN PASSWORD 'changeme';
    END IF;

    -- API role: reads all, writes resolution updates
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'reconciliation_api_user') THEN
        CREATE ROLE reconciliation_api_user LOGIN PASSWORD 'changeme';
    END IF;

    -- Readonly role: dashboards and DuckDB export
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'reconciliation_readonly') THEN
        CREATE ROLE reconciliation_readonly LOGIN PASSWORD 'changeme';
    END IF;

    -- dbt role: reads Silver, writes Gold
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'reconciliation_dbt') THEN
        CREATE ROLE reconciliation_dbt LOGIN PASSWORD 'changeme';
    END IF;
END
$$;

-- Grant connect to the reconciliation database
GRANT CONNECT ON DATABASE reconciliation TO reconciliation_pipeline;
GRANT CONNECT ON DATABASE reconciliation TO reconciliation_api_user;
GRANT CONNECT ON DATABASE reconciliation TO reconciliation_readonly;
GRANT CONNECT ON DATABASE reconciliation TO reconciliation_dbt;
