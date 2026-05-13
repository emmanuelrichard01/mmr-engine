# src/alerting/slack.py
"""
Slack Alert Dispatcher.

Sends structured alerts to a Slack channel via webhook.
Triggered by the reconciliation pipeline when:
    - Critical/High severity discrepancy detected
    - Open exposure exceeds configurable threshold
    - Gap detection finds missing transactions
    - Settlement is overdue by >24 hours

All alerts are logged to system_alert_events for audit compliance.

References:
    - TDD §12: Alerting Subsystem
    - Data Governance §8: Incident Response
    - API Specification §6: Alert Events
"""
import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import httpx
import structlog

from src.config import get_settings
from src.storage.postgres import pipeline_session

from sqlalchemy import text

log = structlog.get_logger(__name__)


class SlackAlertDispatcher:
    """
    Sends alerts to Slack and logs them to the audit trail.

    Usage:
        dispatcher = SlackAlertDispatcher()
        await dispatcher.send_discrepancy_alert(discrepancy)
        await dispatcher.send_exposure_alert(psp_name, exposure_ngn)
    """

    def __init__(self):
        settings = get_settings()
        self._webhook_url = settings.slack_webhook_url
        self._channel = getattr(settings, "slack_channel", "#reconciliation-alerts")
        self._enabled = bool(self._webhook_url)

    async def send_discrepancy_alert(
        self,
        discrepancy_type: str,
        severity: str,
        psp_name: str,
        amount_ngn: Decimal,
        transaction_ref: str,
        evidence: dict[str, Any],
    ) -> bool:
        """Send alert for a new discrepancy."""
        severity_emoji = {
            "critical": ":rotating_light:",
            "high": ":warning:",
            "medium": ":large_yellow_circle:",
            "low": ":information_source:",
        }

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{severity_emoji.get(severity, ':bell:')} Discrepancy Detected — {severity.upper()}",
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*Type:*\n{discrepancy_type}"},
                    {"type": "mrkdwn", "text": f"*PSP:*\n{psp_name}"},
                    {"type": "mrkdwn", "text": f"*Amount:*\nNGN {amount_ngn:,.2f}"},
                    {"type": "mrkdwn", "text": f"*Ref:*\n`{transaction_ref}`"},
                ],
            },
            {
                "type": "context",
                "elements": [
                    {
                        "type": "mrkdwn",
                        "text": f"Detected at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
                    },
                ],
            },
        ]

        sent = await self._send_to_slack(blocks)

        # Log to audit trail
        await self._log_alert_event(
            alert_type="discrepancy",
            severity=severity,
            payload={
                "discrepancy_type": discrepancy_type,
                "psp_name": psp_name,
                "amount_ngn": str(amount_ngn),
                "transaction_ref": transaction_ref,
            },
            delivered=sent,
        )

        return sent

    async def send_exposure_alert(
        self,
        psp_name: str,
        total_exposure_ngn: Decimal,
        open_discrepancy_count: int,
        threshold_ngn: Decimal,
    ) -> bool:
        """Send alert when open exposure exceeds threshold."""
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": ":chart_with_upwards_trend: Exposure Threshold Breached",
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*PSP:*\n{psp_name}"},
                    {"type": "mrkdwn", "text": f"*Open Exposure:*\nNGN {total_exposure_ngn:,.2f}"},
                    {"type": "mrkdwn", "text": f"*Threshold:*\nNGN {threshold_ngn:,.2f}"},
                    {"type": "mrkdwn", "text": f"*Open Items:*\n{open_discrepancy_count}"},
                ],
            },
        ]

        sent = await self._send_to_slack(blocks)
        await self._log_alert_event(
            alert_type="exposure_threshold",
            severity="high",
            payload={
                "psp_name": psp_name,
                "total_exposure_ngn": str(total_exposure_ngn),
                "threshold_ngn": str(threshold_ngn),
            },
            delivered=sent,
        )
        return sent

    async def send_gap_detection_alert(
        self,
        psp_name: str,
        gaps_found: int,
        gap_rate_pct: float,
        auto_backfilled: int,
    ) -> bool:
        """Send alert when gap detection finds missing transactions."""
        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": ":mag: Webhook Gap Detected",
                },
            },
            {
                "type": "section",
                "fields": [
                    {"type": "mrkdwn", "text": f"*PSP:*\n{psp_name}"},
                    {"type": "mrkdwn", "text": f"*Gaps Found:*\n{gaps_found}"},
                    {"type": "mrkdwn", "text": f"*Gap Rate:*\n{gap_rate_pct:.2f}%"},
                    {"type": "mrkdwn", "text": f"*Auto-Backfilled:*\n{auto_backfilled}"},
                ],
            },
        ]

        sent = await self._send_to_slack(blocks)
        await self._log_alert_event(
            alert_type="gap_detection",
            severity="high" if gap_rate_pct > 1.0 else "medium",
            payload={
                "psp_name": psp_name,
                "gaps_found": gaps_found,
                "gap_rate_pct": gap_rate_pct,
            },
            delivered=sent,
        )
        return sent

    async def _send_to_slack(self, blocks: list[dict]) -> bool:
        """Send a message to Slack via webhook."""
        if not self._enabled:
            log.info("slack.disabled", reason="No webhook URL configured")
            return False

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self._webhook_url,
                    json={"channel": self._channel, "blocks": blocks},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    log.info("slack.alert_sent")
                    return True
                else:
                    log.error("slack.send_failed", status=response.status_code)
                    return False
        except Exception as e:
            log.error("slack.send_error", error=str(e))
            return False

    async def _log_alert_event(
        self,
        alert_type: str,
        severity: str,
        payload: dict,
        delivered: bool,
    ) -> None:
        """Log alert to system_alert_events for audit compliance."""
        try:
            async with pipeline_session() as session:
                await session.execute(
                    text("""
                        INSERT INTO system_alert_events
                            (alert_type, severity, channel, payload, delivered_at)
                        VALUES
                            (:alert_type, :severity, :channel,
                             :payload::jsonb,
                             CASE WHEN :delivered THEN NOW() ELSE NULL END)
                    """),
                    {
                        "alert_type": alert_type,
                        "severity": severity,
                        "channel": "slack",
                        "payload": json.dumps(payload),
                        "delivered": delivered,
                    },
                )
        except Exception as e:
            log.error("alert.audit_log_failed", error=str(e))
