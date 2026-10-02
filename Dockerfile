# Dockerfile — MMR (Money Movement Reconciliation) engine
#
# One runtime image, several roles (selected by the compose `command`):
#   api        uvicorn src.api.main:app
#   consumer   python -m src.flows.consumer_worker
#   scheduler  python -m src.flows.scheduler
#   migrations alembic upgrade head
#
# The `api`, `worker` and `migrations` targets are kept as aliases of the
# same runtime stage so existing build commands keep working.
#
# Dashboard: see dashboard/Dockerfile.

FROM python:3.12-slim-bookworm AS build
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
RUN pip install --no-cache-dir "uv>=0.5,<1"
WORKDIR /build
COPY pyproject.toml README.md ./
COPY src/ ./src/
RUN uv venv /opt/venv && VIRTUAL_ENV=/opt/venv uv pip install --no-cache .


FROM python:3.12-slim-bookworm AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 mmr \
    && useradd --system --uid 10001 --gid mmr --home-dir /app --shell /usr/sbin/nologin mmr
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY --chown=mmr:mmr src/ ./src/
COPY --chown=mmr:mmr alembic/ ./alembic/
COPY --chown=mmr:mmr alembic.ini ./
COPY --chown=mmr:mmr scripts/ ./scripts/
USER mmr
EXPOSE 8000
CMD ["uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--proxy-headers"]


FROM runtime AS api
FROM runtime AS worker
FROM runtime AS migrations
