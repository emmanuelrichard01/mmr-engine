# src/api/main.py
"""
FastAPI application factory.

Creates the application with middleware, routes, health/metrics endpoints,
and lifecycle management (startup/shutdown).

References:
    - TDD §11.1: Application Factory
    - API Specification §2: Base Configuration
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from src.config import get_settings
from src.observability.logging import configure_logging
from src.observability.metrics import METRICS_REGISTRY
from src.api.v1.routes import reconciliation, webhooks, onboarding, reports
from src.api.middleware.auth import APIKeyAuthMiddleware
from src.api.middleware.rate_limit import RateLimitMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: configure logging, validate settings.
    Shutdown: dispose DB connection pools.

    DB validation is deferred — we don't require DB connection
    at startup for the minimal API shell.
    """
    settings = get_settings()
    configure_logging(level=settings.log_level)
    log = structlog.get_logger()

    log.info(
        "api.starting",
        environment=settings.environment,
        version="1.0.0",
    )

    yield

    # Shutdown — dispose DB connection pools gracefully
    log.info("api.shutdown")
    try:
        from src.storage.postgres import get_db_manager
        await get_db_manager().dispose()
        log.info("api.db_pools_disposed")
    except Exception as e:
        log.warning("api.db_dispose_error", error=str(e))


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Cross-Border Reconciliation Engine API",
        version="1.0.0",
        description=(
            "Event-driven financial reconciliation API for multi-PSP "
            "Nigerian payment environments."
        ),
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url="/redoc" if settings.environment != "production" else None,
        lifespan=lifespan,
    )

    # ── CORS Middleware ───────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.api_cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type", "X-Request-ID"],
    )

    # ── Auth + Rate Limiting Middleware ────────────────────────────────────
    # Registration order: CORS (outermost) → Auth → RateLimit (innermost)
    # Starlette processes in reverse order, so rate limit runs first.
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(APIKeyAuthMiddleware)

    # ── Route Registration ────────────────────────────────────────────────
    app.include_router(reconciliation.router)
    app.include_router(webhooks.router)
    app.include_router(onboarding.router)
    app.include_router(reports.router)

    # ── Health: liveness (fast, no deps) ─────────────────────────────────
    @app.get("/health", tags=["system"], include_in_schema=False)
    async def health() -> dict:
        """Liveness probe — returns immediately. Used by Docker HEALTHCHECK."""
        return {"status": "healthy", "version": "1.0.0"}

    # ── Health: readiness (deep, checks all deps) ─────────────────────────
    @app.get("/health/ready", tags=["system"], include_in_schema=False)
    async def health_ready() -> JSONResponse:
        """
        Readiness probe — pings PostgreSQL, Redpanda, and MinIO.
        Returns 200 if all healthy, 503 if any dependency is down.
        Each component reports its own status and latency.
        """
        import time
        from sqlalchemy import text

        checks: dict[str, dict] = {}

        # ── PostgreSQL ────────────────────────────────────────────────
        try:
            from src.storage.postgres import get_db_manager
            start = time.monotonic()
            async with get_db_manager().readonly_session() as session:
                await session.execute(text("SELECT 1"))
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            checks["postgres"] = {"status": "healthy", "latency_ms": latency_ms}
        except Exception as e:
            checks["postgres"] = {"status": "unhealthy", "error": str(e)}

        # ── Redpanda (Kafka) ──────────────────────────────────────────
        try:
            from confluent_kafka.admin import AdminClient
            start = time.monotonic()
            admin = AdminClient({"bootstrap.servers": settings.kafka_bootstrap_servers})
            cluster_meta = admin.list_topics(timeout=5)
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            checks["redpanda"] = {
                "status": "healthy",
                "latency_ms": latency_ms,
                "topics": len(cluster_meta.topics),
            }
        except Exception as e:
            checks["redpanda"] = {"status": "unhealthy", "error": str(e)}

        # ── MinIO ─────────────────────────────────────────────────────
        try:
            from minio import Minio
            start = time.monotonic()
            client = Minio(
                settings.minio_endpoint,
                access_key=settings.minio_access_key,
                secret_key=settings.minio_secret_key,
                secure=settings.minio_use_ssl,
            )
            bucket_exists = client.bucket_exists(settings.minio_bronze_bucket)
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            checks["minio"] = {
                "status": "healthy",
                "latency_ms": latency_ms,
                "bronze_bucket_exists": bucket_exists,
            }
        except Exception as e:
            checks["minio"] = {"status": "unhealthy", "error": str(e)}

        # ── Overall status ────────────────────────────────────────────
        all_healthy = all(c["status"] == "healthy" for c in checks.values())

        return JSONResponse(
            status_code=200 if all_healthy else 503,
            content={
                "status": "healthy" if all_healthy else "degraded",
                "version": "1.0.0",
                "checks": checks,
            },
        )

    # ── Prometheus metrics endpoint ────────────────────────────────────────
    @app.get("/metrics", include_in_schema=False)
    async def metrics(request: Request) -> Response:
        return Response(
            content=generate_latest(METRICS_REGISTRY),
            media_type=CONTENT_TYPE_LATEST,
        )

    # ── Global exception handler ───────────────────────────────────────────
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        log = structlog.get_logger()
        log.error(
            "api.unhandled_exception",
            path=request.url.path,
            method=request.method,
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_server_error",
                "message": "An unexpected error occurred.",
            },
        )

    return app


app = create_app()
