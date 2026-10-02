#!/usr/bin/env bash
# init_postgres.sh — runs once, on first boot of an empty data directory
# (mounted into /docker-entrypoint-initdb.d/).
#
# Creates the Prefect database and the application login roles. Passwords
# come from the environment; nothing secret lives in this file. Table-level
# privileges are granted by the Alembic migrations (011, 015), never by
# ALTER DEFAULT PRIVILEGES: blanket defaults silently override the
# column-level grants that enforce least privilege.
set -euo pipefail

: "${RECON_PIPELINE_PASSWORD:?RECON_PIPELINE_PASSWORD must be set}"
: "${RECON_API_PASSWORD:?RECON_API_PASSWORD must be set}"
: "${RECON_READONLY_PASSWORD:?RECON_READONLY_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v pipeline_pw="$RECON_PIPELINE_PASSWORD" \
    -v api_pw="$RECON_API_PASSWORD" \
    -v readonly_pw="$RECON_READONLY_PASSWORD" <<'SQL'
CREATE DATABASE prefect;

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'reconciliation_pipeline', :'pipeline_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reconciliation_pipeline') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'reconciliation_api_user', :'api_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reconciliation_api_user') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'reconciliation_readonly', :'readonly_pw')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reconciliation_readonly') \gexec

GRANT CONNECT ON DATABASE reconciliation
    TO reconciliation_pipeline, reconciliation_api_user, reconciliation_readonly;
GRANT USAGE ON SCHEMA public
    TO reconciliation_pipeline, reconciliation_api_user, reconciliation_readonly;
SQL
