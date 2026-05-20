# src/observability/logging.py
"""
Structured logging configuration using structlog.

Development: coloured, human-readable console output.
Production: JSON output, one line per event — optimised for log aggregation.

Every log event includes:
    - timestamp (ISO 8601 UTC)
    - level
    - logger name
    - event message
    - request_id (if bound to context)
    - All additional key=value fields passed to the logger

References:
    - TDD §12.2: Structured Logging
"""
import logging
import sys
from typing import Literal

import structlog


def configure_logging(
    level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = "INFO",
) -> None:
    """
    Configure structlog for structured JSON logging in production
    and human-readable console logging in development.
    """
    log_level = getattr(logging, level)

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]

    if sys.stdout.isatty():
        # Development: coloured, readable output
        processors: list[structlog.types.Processor] = [
            *shared_processors,
            structlog.dev.ConsoleRenderer(colors=True),
        ]
    else:
        # Production: JSON output, one line per event
        processors = [
            *shared_processors,
            structlog.processors.dict_tracebacks,
            structlog.processors.JSONRenderer(),
        ]

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    # Redirect standard library logging through structlog
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
