# src/alerting/slack.py
"""
Slack alerting for discrepancies that need a human.

`dispatch_pending_alerts()` runs at the end of every matching run. It picks
open discrepancies not yet alerted whose severity is critical, or whose
estimated exposure is at or above ALERT_EXPOSURE_THRESHOLD_NGN, posts one
Slack message per discrepancy, and records each attempt in
system_alert_events. A discrepancy is marked alerted only after Slack
accepted the message, so failed sends are retried on the next run.

When SLACK_WEBHOOK_URL is not configured, nothing is sent and nothing is
marked: the alerts remain pending and visible in the dashboard.

References:
    - TDD §12: Alerting Subsystem
"""

import json
from decimal import Decimal
from typing import Any

import httpx
import structlog
from sqlalchemy import text

from src.config import get_settings
from src.observability.metrics import ALERTS_DISPATCHED_COUNTER
from src.storage.postgres import pipeline_session

log = structlog.get_logger(__name__)

MAX_ALERTS_PER_RUN = 20

_SEVERITY_EMOJI = {
    "critical": ":rotating_light:",
    "high": ":warning:",
    "medium": ":large_yellow_circle:",
    "low": ":information_source:",
}


def build_discrepancy_message(d: dict[str, Any]) -> dict[str, Any]:
    """Slack Block Kit payload for one discrepancy. Contains no PII: only
    the PSP reference, amount and classification."""
    severity = str(d.get("severity") or "unknown")
    amount = Decimal(d["estimated_exposure_ngn"]).quantize(Decimal("0.01"))
    return {
        "text": f"{severity.upper()} {d['classification']} on {d['psp_name']}: NGN {amount:,}",
        "blocks": [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{_SEVERITY_EMOJI.get(severity, ':bell:')} Discrepancy — {severity.upper()}",
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Type:*\n{d['classification']}"},
                    {"type": "mrkdwn", "text": f"*PSP:*\n{d['psp_name']}"},
                    {"type": "mrkdwn", "text": f"*Exposure:*\nNGN {amount:,}"},
                    {"type": "mrkdwn", "text": f"*Ref:*\n`{d['psp_transaction_ref']}`"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {"type": "mrkdwn", "text": f"Discrepancy `{d['id']}` raised {d['raised_at']:%Y-%m-%d %H:%M} UTC"}
                ],
            },
        ],
    }


async def dispatch_pending_alerts() -> int:
    """Send Slack alerts for qualifying, not-yet-alerted discrepancies. Returns the number sent."""
    settings = get_settings()
    if settings.slack_webhook_url is None:
        log.debug("alerts.skipped", reason="SLACK_WEBHOOK_URL not configured")
        return 0
    webhook_url = settings.slack_webhook_url.get_secret_value()

    async with pipeline_session() as session:
        rows = (
            (
                await session.execute(
                    text("""
                SELECT d.id, d.classification::text AS classification, d.severity,
                       d.estimated_exposure_ngn, d.raised_at,
                       s.psp_name::text AS psp_name, s.psp_transaction_ref
                FROM gold_discrepancies d
                JOIN silver_canonical_transactions s ON s.id = d.transaction_id
                WHERE d.status = 'open'
                  AND d.has_alert_sent = FALSE
                  AND (d.severity = 'critical' OR d.estimated_exposure_ngn >= :threshold)
                ORDER BY d.estimated_exposure_ngn DESC
                LIMIT :limit
            """),
                    {"threshold": Decimal(str(settings.alert_exposure_threshold_ngn)), "limit": MAX_ALERTS_PER_RUN},
                )
            )
            .mappings()
            .all()
        )

    sent = 0
    async with httpx.AsyncClient(timeout=10.0) as client:
        for row in rows:
            d = dict(row)
            message = build_discrepancy_message(d)
            failure: str | None = None
            try:
                response = await client.post(webhook_url, json=message)
                if response.status_code != 200:
                    failure = f"slack responded {response.status_code}"
            except httpx.HTTPError as e:
                # The webhook URL is a secret: log the error type only.
                failure = type(e).__name__

            async with pipeline_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO system_alert_events
                            (discrepancy_id, alert_channel, alert_type, recipient, payload,
                             status, sent_at, failure_reason)
                        VALUES
                            (:id, 'slack', :alert_type, 'slack-webhook', CAST(:payload AS JSONB),
                             CAST(:status AS alert_status_enum),
                             CASE WHEN :failed THEN NULL ELSE NOW() END, :failure)
                    """),
                    {
                        "id": d["id"],
                        "alert_type": d["classification"],
                        "payload": json.dumps(message),
                        "status": "failed" if failure else "sent",
                        "failed": failure is not None,
                        "failure": failure,
                    },
                )
                if failure is None:
                    await session.execute(
                        text("""
                            UPDATE gold_discrepancies
                            SET has_alert_sent = TRUE, alert_sent_at = NOW(), updated_at = NOW()
                            WHERE id = :id
                        """),
                        {"id": d["id"]},
                    )

            outcome = "failed" if failure else "sent"
            ALERTS_DISPATCHED_COUNTER.labels(channel="slack", outcome=outcome).inc()
            if failure:
                log.warning("alerts.send_failed", discrepancy_id=str(d["id"]), reason=failure)
            else:
                sent += 1
    return sent
