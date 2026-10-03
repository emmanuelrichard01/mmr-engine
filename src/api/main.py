# src/api/main.py
"""
FastAPI application factory.

Middleware order matters. Starlette runs the LAST-added middleware FIRST, so
registration below is innermost → outermost:

    request → CORS → metrics → auth → rate limit → route

CORS is outermost so every response, including 401/429 errors, carries CORS
headers (otherwise browsers report auth errors as opaque CORS failures).
Auth runs before rate limiting so buckets are keyed by API key rather than IP.

References:
    - TDD §11.1: Application Factory
    - API Specification §2: Base Configuration
"""

import asyncio
import time
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import asynccontextmanager
from importlib.metadata import PackageNotFoundError, version
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from src.api.middleware.auth import APIKeyAuthMiddleware
from src.api.middleware.rate_limit import RateLimitMiddleware
from src.api.v1.routes import reconciliation, reports, system, transactions, webhooks
from src.config import get_settings
from src.observability.logging import configure_logging
from src.observability.metrics import HTTP_REQUEST_DURATION, METRICS_REGISTRY, refresh_state_gauges

try:
    APP_VERSION = version("mmr-engine")
except PackageNotFoundError:  # running from a source checkout
    APP_VERSION = "0.0.0+local"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()
    configure_logging(level=settings.log_level)
    log = structlog.get_logger()
    log.info(
        "api.starting", environment=settings.environment, version=APP_VERSION, auth_disabled=settings.api_auth_disabled
    )
    yield
    log.info("api.shutdown")
    from src.storage.postgres import get_db_manager

    try:
        await get_db_manager().dispose()
    except Exception as e:
        log.warning("api.db_dispose_error", error_type=type(e).__name__)


async def _check_postgres() -> dict[str, Any]:
    from src.storage.postgres import readonly_session

    async with readonly_session() as session:
        await session.execute(text("SELECT 1"))
    return {}


def _check_redpanda() -> dict[str, Any]:
    from confluent_kafka.admin import AdminClient

    admin = AdminClient({"bootstrap.servers": get_settings().kafka_bootstrap_servers})
    return {"topics": len(admin.list_topics(timeout=3).topics)}


def _check_minio() -> dict[str, Any]:
    from minio import Minio

    s = get_settings()
    client = Minio(
        s.minio_endpoint,
        access_key=s.minio_access_key.get_secret_value(),
        secret_key=s.minio_secret_key.get_secret_value(),
        secure=s.minio_use_ssl,
    )
    if not client.bucket_exists(s.minio_bronze_bucket):
        raise RuntimeError("bronze bucket missing")
    return {}


async def _timed(name: str, check: Callable[[], Awaitable[dict[str, Any]]]) -> tuple[str, dict[str, Any]]:
    start = time.monotonic()
    try:
        extra = await asyncio.wait_for(check(), timeout=5.0)
        return name, {"status": "healthy", "latency_ms": round((time.monotonic() - start) * 1000, 1), **extra}
    except Exception as e:
        # Report the failure class only: this endpoint is unauthenticated, and
        # driver error messages can contain hostnames, users or DSN fragments.
        structlog.get_logger().warning("readiness.check_failed", dependency=name, error=str(e))
        return name, {"status": "unhealthy", "error": type(e).__name__}


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="MMR — Money Movement Reconciliation Engine API",
        version=APP_VERSION,
        description="PSP-to-ledger reconciliation reference implementation for Nigerian payments.",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url="/redoc" if settings.environment != "production" else None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
        lifespan=lifespan,
    )

    # Innermost first (see module docstring).
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(APIKeyAuthMiddleware)

    @app.middleware("http")
    async def record_request_metrics(request: Request, call_next: Any) -> Response:
        start = time.perf_counter()
        response: Response = await call_next(request)
        route = request.scope.get("route")
        HTTP_REQUEST_DURATION.labels(
            method=request.method,
            route=getattr(route, "path", "unmatched"),
            status_class=f"{response.status_code // 100}xx",
        ).observe(time.perf_counter() - start)
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.api_cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["X-API-Key", "Content-Type", "X-Request-ID"],
    )

    app.include_router(reconciliation.router)
    app.include_router(transactions.router)
    app.include_router(system.router)
    app.include_router(reports.router)
    app.include_router(webhooks.router)

    @app.get("/health", tags=["system"], include_in_schema=False)
    async def health() -> dict[str, str]:
        """Liveness probe: the process is up. No dependency checks."""
        return {"status": "healthy", "version": APP_VERSION}

    @app.get("/health/ready", tags=["system"], include_in_schema=False)
    async def health_ready() -> JSONResponse:
        """Readiness probe: 200 when Postgres, Redpanda and MinIO all respond, else 503."""
        results = await asyncio.gather(
            _timed("postgres", _check_postgres),
            _timed("redpanda", lambda: asyncio.to_thread(_check_redpanda)),
            _timed("minio", lambda: asyncio.to_thread(_check_minio)),
        )
        checks = dict(results)
        healthy = all(c["status"] == "healthy" for c in checks.values())
        return JSONResponse(
            status_code=200 if healthy else 503,
            content={"status": "healthy" if healthy else "degraded", "version": APP_VERSION, "checks": checks},
        )

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        try:
            await refresh_state_gauges()
        except Exception as e:
            # Serve process metrics even when the database is unreachable.
            structlog.get_logger().warning("metrics.state_refresh_failed", error_type=type(e).__name__)
        return Response(content=generate_latest(METRICS_REGISTRY), media_type=CONTENT_TYPE_LATEST)

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        structlog.get_logger().error(
            "api.unhandled_exception",
            path=request.url.path,
            method=request.method,
            error_type=type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={"error": "internal_server_error", "message": "An unexpected error occurred."},
        )

    return app


app = create_app()
