"""
Agentic Notification Agent
Intelligent multi-channel stakeholder notification with LLM-driven decision making
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import List, Optional

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from tools.registry import REGISTRY, ToolMetadata


from orchestrator.guardrails import _finding, redact_pii

load_dotenv()

_notification_agent = None
_AGENTIC_AVAILABLE = False

try:
    from tools.helper.notification.agent import AgenticNotificationAgent
    from tools.helper.notification.models import NotificationInput as AgenticNotificationInput
    _AGENTIC_AVAILABLE = True
except ImportError:
    try:
        from .helper.notification.agent import AgenticNotificationAgent
        from .helper.notification.models import NotificationInput as AgenticNotificationInput
        _AGENTIC_AVAILABLE = True
    except ImportError:
        _AGENTIC_AVAILABLE = False


def get_notification_agent():
    global _notification_agent
    if _notification_agent is None and _AGENTIC_AVAILABLE:
        try:
            _notification_agent = AgenticNotificationAgent()
        except Exception as e:
            print(f"[NOTIFICATION] Agentic agent init failed: {e}")
    return _notification_agent


class NotificationInput(BaseModel):
    """Input schema for notification tool (orchestrator interface)"""
    shipment_id: str
    container_id: str
    risk_tier: str = Field(description="LOW, MEDIUM, HIGH, or CRITICAL")
    recipients: List[str] = Field(
        description="Recipient roles: ops_team, clinic, hospital, management, regulatory"
    )
    message: str = Field(description="Notification body text")
    channel: str = Field(
        default="dashboard", description="Delivery channel: email, sms, dashboard, webhook"
    )
    revised_eta: Optional[str] = Field(
        default=None,
        description="Revised arrival ETA (ISO datetime) computed from current_delay_min",
    )
    spoilage_probability: Optional[float] = Field(
        default=None,
        description="ML spoilage probability (0-1) for this window",
    )
    facility_name: Optional[str] = Field(
        default=None,
        description="Destination or backup facility name, injected from cold_storage result",
    )


def _run_async_safely(coro):
    # Run coroutine from sync code safely regardless of event-loop state.
    try:
        asyncio.get_running_loop()
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(asyncio.run, coro)
            return future.result()
    except RuntimeError:
        return asyncio.run(coro)


def _map_to_agentic_input(
    shipment_id: str,
    container_id: str,
    risk_tier: str,
    recipients: List[str],
    message: str,
    channel: str,
    revised_eta: Optional[str] = None,
    spoilage_probability: Optional[float] = None,
    facility_name: Optional[str] = None,
) -> "AgenticNotificationInput":
    # Map orchestrator-level input to the rich AgenticNotificationInput model.
    affected_facilities = []
    if facility_name:
        affected_facilities.append(facility_name)
    if "hospital" in recipients or "clinic" in recipients:
        if not affected_facilities:
            affected_facilities = ["General Hospital", "City Medical Center"]

    compliance_status = "compliant"
    violations = []
    if risk_tier in ("HIGH", "CRITICAL"):
        compliance_status = (
            "violation"
            if "violation" in message.lower() or "breach" in message.lower()
            else "borderline"
        )
        if compliance_status == "violation":
            violations = [{"type": "temperature_excursion", "severity": risk_tier}]

    product_category = "standard_refrigerated"
    if "biologic" in message.lower() or "vaccine" in message.lower():
        product_category = "biologics"
    elif "insulin" in message.lower():
        product_category = "insulin"

    tier_defaults = {
        "CRITICAL": (12.0, 120, 250_000, 25),
        "HIGH":     (9.0,  60,  150_000, 10),
        "MEDIUM":   (7.0,  30,   75_000,  5),
        "LOW":      (4.0,   0,        0,  0),
    }
    temp, mins_out, value, patients = tier_defaults.get(risk_tier, tier_defaults["MEDIUM"])

    estimated_arrival = None
    if revised_eta:
        try:
            estimated_arrival = datetime.fromisoformat(revised_eta.replace("Z", "+00:00"))
        except Exception:
            pass

    return AgenticNotificationInput(
        shipment_id=shipment_id,
        container_id=container_id,
        window_id=f"WIN-{shipment_id.split('-')[-1]}" if "-" in shipment_id else f"WIN-{shipment_id}",
        product_category=product_category,
        current_temp_c=temp,
        minutes_outside_range=mins_out,
        transit_phase="air_transport",
        risk_score={"LOW": 25, "MEDIUM": 50, "HIGH": 75, "CRITICAL": 95}.get(risk_tier, 50),
        risk_tier=risk_tier,
        spoilage_probability=spoilage_probability or (0.8 if risk_tier == "CRITICAL" else 0.4 if risk_tier == "HIGH" else 0.1),
        compliance_status=compliance_status,
        violations=violations,
        human_approval_required=risk_tier in ("HIGH", "CRITICAL"),
        approval_level="director" if risk_tier == "CRITICAL" else "qa_manager" if risk_tier == "HIGH" else None,
        product_disposition="quarantine" if compliance_status == "violation" else "investigate" if risk_tier in ("HIGH", "CRITICAL") else "release",
        affected_facilities=affected_facilities,
        critical_patients_affected=patients,
        at_risk_value=float(value),
        backup_available=False,
        estimated_arrival=estimated_arrival,
        current_delay_min=30.0 if risk_tier in ("HIGH", "CRITICAL") else 0.0,
        regulatory_tags=["GDP", "FDA_21CFR11"] if product_category == "biologics" else ["GDP"],
        event_type="risk_assessment",
    )


def _execute(
    shipment_id: str,
    container_id: str,
    risk_tier: str,
    recipients: List[str],
    message: str,
    channel: str = "dashboard",
    revised_eta: Optional[str] = None,
    spoilage_probability: Optional[float] = None,
    facility_name: Optional[str] = None,
) -> dict:
    # Execute agentic notification or fall back to simple payload.

    agent = get_notification_agent()

    if agent is not None:
        try:
            agentic_input = _map_to_agentic_input(
                shipment_id, container_id, risk_tier, recipients,
                message, channel, revised_eta, spoilage_probability, facility_name,
            )
            result = _run_async_safely(agent.send_notifications(agentic_input))

            print(f"[NOTIFICATION] Agentic workflow: sent={result.successful_deliveries} failed={result.failed_deliveries}")

            return {
                "tool": "notification_agent",
                "status": "notifications_sent",
                "shipment_id": shipment_id,
                "container_id": container_id,
                "risk_tier": risk_tier,
                "recipients": recipients,
                "channel": channel,
                "notification_batch_id": result.notification_batch_id,
                "total_notifications": result.total_notifications,
                "successful_deliveries": result.successful_deliveries,
                "failed_deliveries": result.failed_deliveries,
                "escalation_required": result.escalation_required,
                "escalation_deadline": result.escalation_deadline.isoformat() if result.escalation_deadline else None,
                "notifications_sent": [
                    {
                        "notification_id": n.notification_id,
                        "recipient_role": n.recipient.role.value,
                        "recipient_name": n.recipient.name,
                        "channel": n.channel.value,
                        "subject": n.content.subject,
                        "status": n.status.value,
                        "sent_at": n.sent_at.isoformat(),
                    }
                    for n in result.notifications_sent
                ],
                "regulatory_notifications_sent": result.regulatory_notifications_sent,
                "audit_trail_entries": len(result.notification_audit_trail),
                "follow_up_scheduled": result.follow_up_scheduled,
                "agent_version": result.agent_version,
                "processing_duration_ms": result.processing_duration_ms,
                "agentic_workflow": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            print(f"[NOTIFICATION] Agentic workflow failed, falling back: {e}")

    # Fallback: structured payload without LLM
    redacted_message, message_had_pii = redact_pii(message)
    pii_finding = None
    if message_had_pii:
        pii_finding = _finding(
            check="pii_detected",
            severity="warning",
            passed=False,
            agent="notification_agent",
            message="PII (email/phone/SSN) detected and redacted from notification message.",
            details={"original_length": len(message), "redacted_length": len(redacted_message)},
        )

    alert_payload: dict = {
        "shipment_id": shipment_id,
        "container_id": container_id,
        "risk_tier": risk_tier,
        "message": redacted_message,
    }
    if revised_eta:
        alert_payload["revised_eta"] = revised_eta
    if spoilage_probability is not None:
        alert_payload["spoilage_probability_pct"] = round(spoilage_probability * 100, 1)
    if facility_name:
        alert_payload["destination_facility"] = facility_name

    result = {
        "tool": "notification_agent",
        "status": "notification_queued",
        "shipment_id": shipment_id,
        "container_id": container_id,
        "risk_tier": risk_tier,
        "recipients": recipients,
        "channel": channel,
        "alert_payload": alert_payload,
        "message_preview": redacted_message[:200],
        "delivered": False,
        "agentic_workflow": False,
        "requires_approval": risk_tier in ("HIGH", "CRITICAL"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if pii_finding is not None:
        result["guardrail_finding"] = pii_finding
    return result


notification_tool = StructuredTool.from_function(
    func=_execute,
    name="notification_agent",
    description=(
        "Send intelligent, context-aware notifications to stakeholders using "
        "AI-powered decision making. Uses LLM to determine optimal notification "
        "strategy, stakeholder selection, channel optimization, and message "
        "composition. Supports multi-channel delivery (email, SMS, Slack, "
        "dashboard) with regulatory compliance and audit trails. Falls back to "
        "a simple structured payload when the agentic subsystem is unavailable."
    ),
    args_schema=NotificationInput,
)

# register with dynamic tool registry
REGISTRY.register(notification_tool, ToolMetadata(
    name="notification_agent",
    wave=1,
    category="stakeholder",
    applicable_tiers=["MEDIUM", "HIGH", "CRITICAL"],
    applicable_phases=["*"],
    applicable_products=["*"],
    always_deferred=True,   # always held for post-approval
    description="Multi-channel stakeholder notification with LLM message composition",
))
