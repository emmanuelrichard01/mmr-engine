# Dockerfile — Multi-Stage Build
# Cross-Border Mobile Money Reconciliation Engine
#
# Stages:
#   base       → Python 3.12 + dependencies
#   api        → FastAPI + uvicorn
#   worker     → Prefect + dbt
#   migrations → Alembic
#
# Dashboard: see dashboard/Dockerfile (Next.js 15, standalone build)
#
# Reference: TDD §6

FROM python:3.12-slim AS base

WORKDIR /app

# Ensure src/ is importable as a Python package from /app
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# System dependencies shared across all stages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv for faster dependency resolution
RUN pip install --no-cache-dir uv

COPY pyproject.toml .
RUN uv pip install --system --no-cache .


# ── API stage ─────────────────────────────────────────────────────────────────
FROM base AS api
COPY src/ ./src/
EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2"]


# ── Worker stage ──────────────────────────────────────────────────────────────
FROM base AS worker
# dbt requires git for package resolution
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
RUN uv pip install --system --no-cache "dbt-postgres>=1.8,<2.0"
COPY src/ ./src/
COPY dbt_project/ ./dbt_project/
# No CMD — Prefect worker command provided by compose


# ── Migrations stage ─────────────────────────────────────────────────────────
FROM base AS migrations
COPY alembic/ ./alembic/
COPY alembic.ini .
COPY src/ ./src/
# CMD provided by compose: alembic upgrade head
