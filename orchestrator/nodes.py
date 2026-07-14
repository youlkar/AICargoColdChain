# Node functions for the orchestration agent
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from orchestrator.guardrails import GuardrailFinding
from orchestrator.state import OrchestratorState, PlanStep, ToolResult
from tools import TOOL_MAP

logger = logging.getLogger(__name__)


# Interpret risk

def interpret_risk(state: OrchestratorState) -> dict:
    # Parse the risk engine output and classify severity.
    ri = state["risk_input"]
    tier = ri.get("risk_tier", "LOW")
    score = ri.get("fused_risk_score", 0.0)
    rules = ri.get("deterministic_rule_flags", [])
    ml_prob = ri.get("ml_spoilage_probability", 0.0)

    if tier == "CRITICAL":
        severity = "critical"
        urgency = "immediate"
        primary = _identify_primary_issue(rules, score, ml_prob)
    elif tier == "HIGH":
        severity = "high"
        urgency = "urgent"
        primary = _identify_primary_issue(rules, score, ml_prob)
    elif tier == "MEDIUM":
        severity = "elevated"
        urgency = "monitor"
        primary = "Elevated risk metrics detected; preparing contingency."
    else:
        severity = "normal"
        urgency = "routine"
        primary = "All metrics within acceptable range."

    logger.info("INTERPRET  tier=%s severity=%s urgency=%s", tier, severity, urgency)
    return {
        "severity": severity,
        "urgency": urgency,
        "primary_issue": primary,
    }


def _identify_primary_issue(rules: list, score: float, ml_prob: float) -> str:
    if "temp_critical_breach" in rules:
        return "Temperature has breached critical limits. Product integrity at immediate risk."
    if "temp_warning_breach" in rules:
        return "Temperature outside acceptable range. Excursion in progress."
    if "excursion_duration" in rules:
        return "Cumulative excursion duration exceeds product tolerance."
    if "delay_temp_stress" in rules:
        return "Extended delay combined with temperature stress near boundary."
    if ml_prob > 0.8:
        return f"ML model predicts {ml_prob:.0%} spoilage probability within 6 hours."
    if "battery_critical" in rules:
        return "Sensor battery critical. Risk of monitoring loss."
    return f"Multiple risk signals detected (score={score:.3f})."


# Plan

TIER_PLAN_TEMPLATES: Dict[str, List[Dict[str, str]]] = {
    "CRITICAL": [
        {"action": "Log compliance event for critical risk detection",
         "tool": "compliance_agent",
         "reason": "GDP/FDA requires immediate logging of critical excursions"},
        {"action": "Notify operations team and downstream stakeholders with revised ETA and spoilage probability",
         "tool": "notification_agent",
         "reason": "Critical risk requires immediate stakeholder awareness; alert includes facility and ETA"},
        {"action": "Identify backup cold-storage facility for temperature recovery",
         "tool": "cold_storage_agent",
         "reason": "Product integrity at risk; result feeds into notification and scheduling steps"},
        {"action": "Generate hospital reschedule recommendations based on revised ETA",
         "tool": "scheduling_agent",
         "reason": "Downstream appointments must be rescheduled; uses facility and ETA from cascade"},
        {"action": "Prepare insurance claim documentation with full leg excursion history",
         "tool": "insurance_agent",
         "reason": "Excursion at CRITICAL tier warrants claim preparation; loss computed from ML probability"},
        {"action": "Submit consolidated plan for human approval",
         "tool": "approval_workflow",
         "reason": "Critical actions are irreversible; approval queued after all prep steps are complete"},
    ],
    "HIGH": [
        {"action": "Log compliance event for high-risk detection",
         "tool": "compliance_agent",
         "reason": "Audit trail for elevated risk events"},
        {"action": "Send pre-alert to operations team with revised ETA",
         "tool": "notification_agent",
         "reason": "Ops team needs to prepare intervention; alert enriched with delay and facility context"},
        {"action": "Generate reschedule recommendations for affected facilities",
         "tool": "scheduling_agent",
         "reason": "HIGH risk warrants scheduling prep; revised ETA injected from delay computation"},
        {"action": "Request human approval for recommended mitigation",
         "tool": "approval_workflow",
         "reason": "HIGH-risk actions need operator confirmation before execution"},
    ],
    "MEDIUM": [
        {"action": "Log monitoring event",
         "tool": "compliance_agent",
         "reason": "Traceability for elevated monitoring state"},
        {"action": "Send soft notification to ops dashboard",
         "tool": "notification_agent",
         "reason": "Situational awareness without escalation"},
    ],
    "LOW": [],
}


def plan(state: OrchestratorState) -> dict:
    # Generate a draft action plan based on risk tier and rules.
    ri = state["risk_input"]
    tier = ri.get("risk_tier", "LOW")
    templates = TIER_PLAN_TEMPLATES.get(tier, [])

    draft: List[PlanStep] = []
    for i, tmpl in enumerate(templates, 1):
        tool_input = _build_tool_input(tmpl["tool"], ri, state)
        draft.append(PlanStep(
            step=i,
            action=tmpl["action"],
            tool=tmpl["tool"],
            tool_input=tool_input,
            reason=tmpl["reason"],
        ))

    # For HIGH/CRITICAL at air_handoff or customs_clearance, rerouting may recover ETA
    if tier in ("CRITICAL", "HIGH") and ri.get("transit_phase") in ("air_handoff", "customs_clearance"):
        draft.append(PlanStep(
            step=len(draft) + 1,
            action="Evaluate alternative routing options",
            tool="route_agent",
            tool_input=_build_tool_input("route_agent", ri, state),
            reason=f"Shipment at {ri.get('transit_phase')} with {tier} risk; rerouting may recover ETA",
        ))

    logger.info("PLAN  %d steps for tier=%s", len(draft), tier)
    return {
        "draft_plan": draft,
        "plan_revised": False,
        "requires_approval": tier in ("CRITICAL", "HIGH"),
        "approval_reason": f"{tier} risk detected: {state.get('primary_issue', '')}",
    }


def _build_tool_input(tool_name: str, ri: dict, state: dict) -> dict:
    # Construct the baseline tool input payload from risk data. 
    base = {
        "shipment_id": ri.get("shipment_id", ""),
        "container_id": ri.get("container_id", ""),
    }

    # Contextual fields available from enriched risk_input (set by backend score_window)
    delay_class = ri.get("delay_class", "")
    hours_to_breach = ri.get("hours_to_breach")
    facility = ri.get("facility", {})
    product_cost = ri.get("product_cost", {})

    # Build a human-readable context suffix for reasons/messages
    htb_str = f" ~{hours_to_breach:.1f}h to breach." if hours_to_breach is not None else ""
    delay_str = f" Delay: {delay_class}." if delay_class else ""
    context_suffix = htb_str + delay_str

    if tool_name == "compliance_agent":
        return {
            **base,
            "window_id": ri.get("window_id", ""),
            "event_type": "risk_assessment",
            "risk_tier": ri.get("risk_tier", "LOW"),
            "details": {
                "fused_score": ri.get("fused_risk_score"),
                "ml_prob": ri.get("ml_spoilage_probability"),
                "spoilage_probability": ri.get("ml_spoilage_probability", 0.0),
                "rules": ri.get("deterministic_rule_flags", []),
                "primary_issue": state.get("primary_issue", ""),
                "delay_class": delay_class,
                "hours_to_breach": hours_to_breach,
                "product_category": ri.get("product_type", "standard_refrigerated"),
                "current_temp_c": ri.get("avg_temp_c", 0.0),
                "avg_temp_c": ri.get("avg_temp_c", 0.0),
                "minutes_outside_range": ri.get("minutes_outside_range", 0),
                "transit_phase": ri.get("transit_phase", "unknown"),
                "at_risk_value": float(product_cost.get("unit_cost_usd", 0))
                    * int(product_cost.get("units_per_shipment", 0)),
            },
            "regulatory_tags": ["GDP", "FDA_21CFR11"],
        }

    if tool_name == "notification_agent":
        tier = ri.get("risk_tier", "LOW")
        recipients = ["ops_team"]
        if tier == "CRITICAL":
            recipients.extend(["management", "clinic"])
        elif tier == "HIGH":
            recipients.append("management")
        facility_name = facility.get("name", "")
        return {
            **base,
            "risk_tier": tier,
            "recipients": recipients,
            "message": (
                f"[{tier}] Shipment {ri.get('shipment_id')} / {ri.get('container_id')}: "
                f"{state.get('primary_issue', 'Risk detected')}."
                f" Score={ri.get('fused_risk_score', 0):.3f},"
                f" Phase={ri.get('transit_phase', 'unknown')}."
                f"{context_suffix}"
            ),
            "channel": "dashboard",
            # spoilage_probability and facility_name enriched at execute time
            "spoilage_probability": ri.get("ml_spoilage_probability", 0.0),
            "facility_name": facility_name,
        }

    if tool_name == "cold_storage_agent":
        return {
            **base,
            "product_id":          ri.get("product_type", ""),
            "urgency":             "critical" if ri.get("risk_tier") == "CRITICAL" else "high",
            "location_hint":       (
                ri.get("facility", {}).get("airport_code")
                or ri.get("transit_phase", "")
            ),
            "hours_to_breach":     hours_to_breach,
            "avg_temp_c":          ri.get("avg_temp_c"),
            "temp_slope_c_per_hr": ri.get("temp_slope_c_per_hr"),
        }

    if tool_name == "route_agent":
        return {
            **base,
            "current_leg_id": ri.get("leg_id", ""),
            "reason": state.get("primary_issue", "Risk detected") + context_suffix,
            "product_id": ri.get("product_type", ""),
        }

    if tool_name == "insurance_agent":
        return {
            **base,
            "product_id": ri.get("product_type", ""),
            "risk_tier": ri.get("risk_tier", ""),
            "leg_id": ri.get("leg_id", ""),
            "spoilage_probability": ri.get("ml_spoilage_probability", 0.0),
            "incident_summary": state.get("primary_issue", "") + context_suffix,
        }

    if tool_name == "scheduling_agent":
        facility_name = facility.get("name", "")
        facility_loc = facility.get("location", "")
        resolved = f"{facility_name} ({facility_loc})" if facility_name else "facility_TBD"
        return {
            **base,
            "product_id": ri.get("product_type", ""),
            "affected_facilities": [resolved],
            "original_eta": str(ri.get("window_end", "TBD")),
            "reason": state.get("primary_issue", "") + context_suffix,
            # Risk context fields — used by extended scheduling logic
            "delay_class": delay_class,
            "hours_to_breach": hours_to_breach,
            "ml_spoilage_probability": ri.get("ml_spoilage_probability", 0.0),
            "risk_tier": ri.get("risk_tier", ""),
        }

    if tool_name == "approval_workflow":
        active = state.get("revised_plan") or state.get("draft_plan") or []
        return {
            "shipment_id": ri.get("shipment_id", ""),
            "action_description": (
                f"Execute {len(active)}-step mitigation plan for "
                f"{ri.get('risk_tier')} risk.{context_suffix}"
            ),
            "risk_tier": ri.get("risk_tier", "LOW"),
            "urgency": state.get("urgency", "high"),
            "proposed_actions": [s.get("action", "") for s in active if isinstance(s, dict)],
            "justification": state.get("primary_issue", "") + context_suffix,
        }

    if tool_name == "triage_agent":
        return {
            "shipments": [{
                "shipment_id": ri.get("shipment_id", ""),
                "container_id": ri.get("container_id", ""),
                "risk_tier": ri.get("risk_tier", "LOW"),
                "fused_risk_score": ri.get("fused_risk_score", 0.0),
                "product_id": ri.get("product_type", ""),
                "transit_phase": ri.get("transit_phase", ""),
            }],
            "enrich": True,
        }

    return base


# Reflect (self-critique)

REFLECTION_CHECKLIST = [
    ("compliance_covered", lambda plan: any(s["tool"] == "compliance_agent" for s in plan),
     "Plan missing compliance logging. Must add for audit trail."),
    ("notification_included", lambda plan: any(s["tool"] == "notification_agent" for s in plan),
     "Plan missing stakeholder notification."),
    ("approval_for_irreversible", lambda plan: any(s["tool"] == "approval_workflow" for s in plan),
     "Plan lacks human approval step for potentially irreversible actions."),
    ("has_fallback", lambda plan: len(plan) > 1,
     "Plan has only one step; should include fallback."),
    ("no_empty_steps", lambda plan: all(s.get("tool") in TOOL_MAP for s in plan),
     "Plan references a tool that does not exist."),
]


def reflect(state: OrchestratorState) -> dict:
    # Post-execution reflection: check tool results against requirements AND quality.
    ri = state["risk_input"]
    tier = ri.get("risk_tier", "LOW")
    if tier == "LOW":
        return {"reflection_notes": ["LOW risk: monitoring only."], "needs_revision": False}

    tool_results = state.get("tool_results", [])
    deferred = set(state.get("deferred_tools", []))
    executed = {r["tool"] for r in tool_results}
    failed = {r["tool"] for r in tool_results if not r.get("success")}
    result_map = {r["tool"]: r.get("result", {}) for r in tool_results}
    notes: List[str] = []

    required_tools = {
        "CRITICAL": ["compliance_agent", "cold_storage_agent", "insurance_agent"],
        "HIGH": ["compliance_agent"],
        "MEDIUM": ["compliance_agent"],
    }
    for tool_name in required_tools.get(tier, []):
        if tool_name in deferred:
            continue
        if tool_name not in executed:
            notes.append(f"GAP [{tool_name}]: Required for {tier} but was not executed")
        elif tool_name in failed:
            notes.append(f"GAP [{tool_name}]: Executed but FAILED — needs retry")

    # --- Quality checks: context-dependent tool recommendations ---
    transit_phase = ri.get("transit_phase", "")
    delay_class = ri.get("delay_class", "")
    spoilage = ri.get("ml_spoilage_probability", 0) or 0

    comp = result_map.get("compliance_agent", {})
    comp_status = (comp.get("compliance_status") or comp.get("status") or "").lower()
    disposition = (comp.get("product_disposition") or "").lower()

    if comp_status in ("violation", "non_compliant") and "cold_storage_agent" not in executed and tier in ("HIGH", "CRITICAL"):
        notes.append(f"QUALITY [cold_storage_agent]: compliance found '{comp_status}' with disposition '{disposition}' — cold storage transfer needed")

    if transit_phase in ("air_handoff", "customs_clearance") and "route_agent" not in executed and tier in ("HIGH", "CRITICAL"):
        notes.append(f"QUALITY [route_agent]: transit_phase='{transit_phase}' requires rerouting evaluation")

    if delay_class in ("critical", "developing") and "scheduling_agent" not in executed:
        notes.append(f"QUALITY [scheduling_agent]: delay_class='{delay_class}' requires downstream scheduling")

    if spoilage > 0.6 and tier in ("HIGH", "CRITICAL") and "insurance_agent" not in executed:
        notes.append(f"QUALITY [insurance_agent]: spoilage_probability={spoilage:.2f} — financial protection needed")

    cs = result_map.get("cold_storage_agent", {})
    suit_score = cs.get("suitability_score", 100)
    suit_tier = (cs.get("suitability_tier") or "").lower()
    if isinstance(suit_score, (int, float)):
        normalized_score = suit_score * 100 if suit_score <= 1.5 else suit_score
    else:
        normalized_score = 100
    if "cold_storage_agent" in executed and (
        normalized_score < 50
        or suit_tier in ("marginal", "poor", "disqualified")
    ):
        notes.append(f"QUALITY [cold_storage_agent]: suitability_score={suit_score} tier='{suit_tier}' — facility inadequate, retry with wider search")

    notif = result_map.get("notification_agent", {})
    if "notification_agent" in executed and tier in ("HIGH", "CRITICAL"):
        if not notif.get("agentic_workflow", True):
            notes.append("QUALITY [notification_agent]: fell back to non-agentic mode — stakeholder delivery incomplete")

    if spoilage > 0.5 and tier == "CRITICAL" and "route_agent" not in executed:
        notes.append(f"QUALITY [route_agent]: CRITICAL event with spoilage={spoilage:.2f} — rerouting may reduce transit time and prevent loss")

    if comp_status == "violation" and disposition in ("quarantine", "destroy") and tier == "CRITICAL":
        if "scheduling_agent" in executed:
            sched = result_map.get("scheduling_agent", {})
            if not sched.get("facility_recommendations"):
                notes.append("QUALITY [scheduling_agent]: compliance mandates quarantine but no facility reschedule recommendations generated")

    has_quality_issues = any("GAP" in n or "QUALITY" in n for n in notes)

    if deferred:
        notes.append(f"DEFERRED: {', '.join(deferred)} held for post-approval execution")

    if not any("GAP" in n or "QUALITY" in n or "DEFERRED" in n for n in notes):
        notes.append("OK: All required tools executed with adequate results.")

    logger.info("REFLECT  %d notes, quality_issues=%s, deferred=%s",
                len(notes), has_quality_issues, list(deferred))
    return {"reflection_notes": notes, "needs_revision": True}


# Revise

def revise(state: OrchestratorState) -> dict:
    # Propose CORRECTIVE steps: tools that are missing, failed, quality-flagged, OR deferred.
    ri = state["risk_input"]
    tool_results = state.get("tool_results", [])
    notes = state.get("reflection_notes", [])
    tier = ri.get("risk_tier", "LOW")
    deferred = set(state.get("deferred_tools", []))

    succeeded = {r["tool"] for r in tool_results if r.get("success")}
    failed = {r["tool"] for r in tool_results if not r.get("success")}
    note_blob = " ".join(notes).upper()

    corrective_tools = [
        "compliance_agent", "insurance_agent",
        "cold_storage_agent", "scheduling_agent", "route_agent",
    ]

    corrective: List[PlanStep] = []

    for tool_name in corrective_tools:
        short_key = tool_name.upper()
        has_gap = f"GAP [{short_key}]" in note_blob or f"GAP [{tool_name}]" in note_blob
        has_quality = f"QUALITY [{short_key}]" in note_blob or f"QUALITY [{tool_name}]" in note_blob
        is_failed = tool_name in failed

        if has_quality and tool_name in succeeded:
            reason = "Quality issue: reflection flagged output as inadequate"
        elif tool_name in succeeded and not has_quality:
            continue
        elif has_gap or has_quality or is_failed:
            reason = f"{'Retry: failed' if is_failed else 'Quality: context-needed' if has_quality else 'Gap: missing'} in first execution"
        else:
            continue

        corrective.append(PlanStep(
            step=len(corrective) + 1,
            action=f"Corrective: run {tool_name} (identified by post-execution reflection)",
            tool=tool_name,
            tool_input=_build_tool_input(tool_name, ri, state),
            reason=reason,
        ))

    if "notification_agent" in deferred:
        corrective.append(PlanStep(
            step=len(corrective) + 1,
            action="Send stakeholder notification (deferred to post-approval)",
            tool="notification_agent",
            tool_input=_build_tool_input("notification_agent", ri, state),
            reason="Notification deferred: stakeholders must not be alerted before human validates the response",
        ))

    logger.info("REVISE  %d steps (%d corrective + deferred)", len(corrective), len(corrective))
    return {"revised_plan": corrective, "plan_revised": True, "active_plan": corrective}


# Cascade enrichment

def _compute_revised_eta(ri: dict) -> Optional[str]:
    # Compute a revised ETA string by adding current_delay_min to window_end.
    window_end = ri.get("window_end", "")
    delay_min = float(ri.get("current_delay_min", 0.0))
    if not window_end or delay_min == 0:
        return None
    try:
        base = datetime.fromisoformat(str(window_end).replace("Z", "+00:00"))
        revised = base + timedelta(minutes=delay_min)
        return revised.isoformat()
    except (ValueError, TypeError):
        return None


def _enrich_tool_input(
    tool_name: str,
    base_input: dict,
    cascade_ctx: Dict[str, Any],
    ri: dict,
) -> dict:
    # Dynamically patch a tool's pre-baked input using results accumulated from earlier tools in the cascade.
    enriched = dict(base_input)

    if tool_name == "compliance_agent":
        details = enriched.get("details", {})
        if not isinstance(details, dict):
            details = {}
        details.setdefault("product_category", ri.get("product_type", "standard_refrigerated"))
        details.setdefault("current_temp_c", ri.get("avg_temp_c", 0.0))
        details.setdefault("avg_temp_c", ri.get("avg_temp_c", 0.0))
        details.setdefault("minutes_outside_range", ri.get("minutes_outside_range", 0))
        details.setdefault("transit_phase", ri.get("transit_phase", "unknown"))
        details.setdefault("spoilage_probability", ri.get("ml_spoilage_probability", 0.0))
        details.setdefault("ml_prob", ri.get("ml_spoilage_probability", 0.0))
        cost = ri.get("product_cost", {})
        details.setdefault(
            "at_risk_value",
            float(cost.get("unit_cost_usd", 0)) * int(cost.get("units_per_shipment", 0)),
        )
        enriched["details"] = details

    elif tool_name == "notification_agent":
        # Inject revised ETA
        revised_eta = _compute_revised_eta(ri)
        if revised_eta:
            enriched["revised_eta"] = revised_eta

        # Inject spoilage probability
        enriched["spoilage_probability"] = ri.get("ml_spoilage_probability", 0.0)

        # Inject facility name from cold_storage result if available
        cs = cascade_ctx.get("cold_storage_agent", {})
        facility_name = cs.get("recommended_facility") or ri.get("facility", {}).get("name", "")
        if facility_name:
            enriched["facility_name"] = facility_name
            enriched["message"] = (
                enriched.get("message", "") +
                f" Backup facility identified: {facility_name}"
                + (f" ({cs.get('location', '')})" if cs.get("location") else "") + "."
            )
        cs_advance_notice = cs.get("advance_notice_required_hours")
        cs_temp_range = cs.get("temp_range_supported", "")
        if cs_advance_notice is not None:
            enriched["message"] = enriched.get("message", "") + f" Advance notice required: {cs_advance_notice}h."
        if cs_temp_range:
            enriched["message"] = enriched.get("message", "") + f" Storage range: {cs_temp_range}."

    elif tool_name == "scheduling_agent":
        # Revised ETA
        revised_eta = _compute_revised_eta(ri)
        if revised_eta:
            enriched["revised_eta"] = revised_eta

        # Real facility from cold_storage or ri context
        cs = cascade_ctx.get("cold_storage_agent", {})
        facility_record = ri.get("facility", {})
        facility_loc = cs.get("location") or facility_record.get("location") or "TBD"
        facility_name = cs.get("recommended_facility") or facility_record.get("name") or "TBD"

        enriched["affected_facilities"] = [f"{facility_name} ({facility_loc})"]
        enriched["original_eta"] = str(ri.get("window_end", "TBD"))

        # Pass advance notice and temp range from cold_storage result (audit context)
        cs_advance_notice = cs.get("advance_notice_required_hours")
        if cs_advance_notice is not None and "advance_notice_required_hours" not in enriched:
            enriched["advance_notice_required_hours"] = cs_advance_notice
        cs_temp_range = cs.get("temp_range_supported", "")
        if cs_temp_range and "temp_range_supported" not in enriched:
            enriched["temp_range_supported"] = cs_temp_range

        # Defensive fill: risk context fields (already set by _build_tool_input; guard prevents overwrite)
        if "delay_class" not in enriched:
            enriched["delay_class"] = ri.get("delay_class", "")
        if "hours_to_breach" not in enriched:
            enriched["hours_to_breach"] = ri.get("hours_to_breach")
        if "ml_spoilage_probability" not in enriched:
            enriched["ml_spoilage_probability"] = ri.get("ml_spoilage_probability", 0.0)
        if "risk_tier" not in enriched:
            enriched["risk_tier"] = ri.get("risk_tier", "")

    elif tool_name == "insurance_agent":
        # Supporting evidence: compliance log ID from earlier in the chain
        compliance_result = cascade_ctx.get("compliance_agent", {})
        log_id = compliance_result.get("log_id")
        if log_id:
            enriched["supporting_evidence"] = [log_id]

        # Computed loss — use richer cost components from product_costs.json if available
        cost_record = ri.get("product_cost", {})
        components = cost_record.get("cost_components", {})
        product_chars = cost_record.get("product_characteristics", {})
        unit_cost = float(cost_record.get("unit_cost_usd", 0.0))
        units = int(cost_record.get("units_per_shipment", 0))
        disposal = float(components.get("disposal_cost_per_unit_usd", 0.0))
        handling = float(components.get("handling_cost_per_shipment_usd", 0.0))
        multiplier = float(product_chars.get("cold_chain_risk_multiplier", 1.0))
        spoilage_prob = float(ri.get("ml_spoilage_probability", 0.0))
        if unit_cost > 0 and units > 0:
            base = (unit_cost * units + disposal * units + handling) * spoilage_prob
            enriched["estimated_loss_usd"] = round(base * multiplier, 2)

        # Incident summary already has context_suffix from _build_tool_input;
        # only append leg excursion total if available from the leg history
        pass

    elif tool_name == "cold_storage_agent":
        if "location_hint" not in enriched or not enriched["location_hint"]:
            enriched["location_hint"] = ri.get("facility", {}).get("airport_code", "")
        if "hours_to_breach" not in enriched:
            enriched["hours_to_breach"] = ri.get("hours_to_breach")
        if "avg_temp_c" not in enriched:
            enriched["avg_temp_c"] = ri.get("avg_temp_c")
        if "temp_slope_c_per_hr" not in enriched:
            enriched["temp_slope_c_per_hr"] = ri.get("temp_slope_c_per_hr")

    elif tool_name == "approval_workflow":
        enriched.setdefault("window_id", ri.get("window_id"))
        enriched.setdefault("container_id", ri.get("container_id"))
        action_summaries = []
        for tname, tresult in cascade_ctx.items():
            if isinstance(tresult, dict):
                status = tresult.get("status", "executed")
                action_summaries.append(f"{tname}: {status}")
        if action_summaries:
            enriched["proposed_actions"] = action_summaries

    return enriched


# Execute

_DEPENDS_ON = {
    "notification_agent": ["cold_storage_agent"],
    "scheduling_agent": ["cold_storage_agent"],
    "insurance_agent": ["compliance_agent"],
    "approval_workflow": [],
}


DEFERRED_FIRST_PASS = {"notification_agent"}


def execute(state: OrchestratorState) -> dict:
    # Run each tool in the active plan sequentially with result-awareness.
    
    active = state.get("active_plan") or state.get("draft_plan", [])
    ri = state.get("risk_input", {})
    results: List[ToolResult] = []
    errors: List[str] = []
    cascade_ctx: Dict[str, Any] = {}
    failed_tools: set = set()
    approval_id: Optional[str] = None
    deferred: List[str] = []

    for step in active:
        if not isinstance(step, dict):
            errors.append(f"Invalid step format: {type(step)}")
            continue
        tool_name = step.get("tool", "")
        if not tool_name:
            errors.append("Step missing 'tool' key")
            continue
        if tool_name == "approval_workflow":
            continue
        if tool_name in DEFERRED_FIRST_PASS:
            deferred.append(tool_name)
            logger.info("EXECUTE  deferring %s to post-approval", tool_name)
            continue
        base_input = step.get("tool_input", {})

        if tool_name not in TOOL_MAP:
            errors.append(f"Tool '{tool_name}' not available")
            continue

        upstream_failures = [
            dep for dep in _DEPENDS_ON.get(tool_name, [])
            if dep in failed_tools
        ]
        if upstream_failures:
            logger.warning("EXECUTE  %s: upstream %s failed, running with degraded context",
                           tool_name, upstream_failures)

        tool_input = _enrich_tool_input(tool_name, base_input, cascade_ctx, ri)

        if tool_name == "notification_agent":
            cs = cascade_ctx.get("cold_storage_agent", {})
            cs_status = cs.get("status", "") if isinstance(cs, dict) else ""
            if "cold_storage_agent" in failed_tools or cs_status == "no_facility_found":
                tool_input["message"] = tool_input.get("message", "") + \
                    " WARNING: No backup cold-storage facility could be identified."

        try:
            tool = TOOL_MAP[tool_name]
            result = tool.invoke(tool_input)
            cascade_ctx[tool_name] = result
            results.append(ToolResult(
                tool=tool_name, input=tool_input,
                result=result, success=True,
            ))

            if tool_name == "approval_workflow" and isinstance(result, dict):
                approval_id = result.get("approval_id")
                logger.info("EXECUTE  approval queued id=%s", approval_id)

        except Exception as exc:
            logger.error("EXECUTE  tool=%s failed: %s", tool_name, exc)
            errors.append(f"{tool_name}: {exc}")
            failed_tools.add(tool_name)
            results.append(ToolResult(
                tool=tool_name, input=tool_input,
                result={"error": str(exc), "status": "failed"}, success=False,
            ))

    logger.info("EXECUTE  %d tools run, %d errors, %d failed, %d deferred",
                len(results), len(errors), len(failed_tools), len(deferred))
    return {
        "tool_results": results,
        "execution_errors": errors,
        "cascade_context": cascade_ctx,
        "approval_id": approval_id,
        "deferred_tools": deferred,
    }


# Re-Execute (corrective actions from revise)

def re_execute(state: OrchestratorState) -> dict:
    # Run the corrective steps from the revised plan.
    revised = state.get("revised_plan") or state.get("active_plan", [])
    ri = state.get("risk_input", {})
    first_results = state.get("tool_results", [])
    cascade_ctx = dict(state.get("cascade_context", {}))
    deferred = set(state.get("deferred_tools", [])) | DEFERRED_FIRST_PASS

    results: List[ToolResult] = list(first_results)
    errors: List[str] = list(state.get("execution_errors", []))
    revised_results: List[ToolResult] = []

    if not revised:
        logger.info("RE_EXECUTE  no corrective steps to run")
        return {}

    for step in revised:
        if not isinstance(step, dict):
            continue
        tool_name = step.get("tool", "")
        if not tool_name or tool_name == "approval_workflow":
            continue
        if tool_name in deferred:
            logger.info("RE_EXECUTE  deferring %s to post-approval", tool_name)
            continue
        if tool_name not in TOOL_MAP:
            errors.append(f"Corrective: tool '{tool_name}' not available")
            continue

        base_input = step.get("tool_input", {})
        tool_input = _enrich_tool_input(tool_name, base_input, cascade_ctx, ri)

        try:
            tool = TOOL_MAP[tool_name]
            result = tool.invoke(tool_input)
            cascade_ctx[tool_name] = result
            tr = ToolResult(tool=tool_name, input=tool_input, result=result, success=True)
            results.append(tr)
            revised_results.append(tr)
            logger.info("RE_EXECUTE  corrective %s → success", tool_name)
        except Exception as exc:
            logger.error("RE_EXECUTE  corrective %s failed: %s", tool_name, exc)
            errors.append(f"corrective {tool_name}: {exc}")
            tr = ToolResult(
                tool=tool_name, input=tool_input,
                result={"error": str(exc), "status": "failed"}, success=False,
            )
            results.append(tr)
            revised_results.append(tr)

    new_replan_count = state.get("replan_count", 0) + 1
    # Append this pass's results to the cross-pass history so reflect always
    # has the full picture on every loop iteration.
    history: List[Dict[str, Any]] = list(state.get("execution_history") or [])
    history.extend([dict(r) for r in revised_results])

    logger.info("RE_EXECUTE  %d corrective tools run (replan_count now %d)",
                len(revised_results), new_replan_count)
    return {
        "tool_results": results,
        "execution_errors": errors,
        "cascade_context": cascade_ctx,
        "revised_tool_results": revised_results,
        "replan_count": new_replan_count,
        "execution_history": history,
    }


# Build fallback

def build_fallback(state: OrchestratorState) -> dict:
    # Create a minimal fallback plan in case primary plan fails.
    ri = state["risk_input"]
    tier = ri.get("risk_tier", "LOW")
    if tier == "LOW":
        return {"fallback_plan": []}

    fallback = [
        PlanStep(step=1, action="Escalate to on-call operations manager",
                 tool="notification_agent",
                 tool_input=_build_tool_input("notification_agent", ri, state),
                 reason="Primary plan failed; manual intervention required"),
        PlanStep(step=2, action="Log escalation event for audit trail",
                 tool="compliance_agent",
                 tool_input=_build_tool_input("compliance_agent", ri, state),
                 reason="Compliance: all escalations must be logged"),
    ]
    return {"fallback_plan": fallback}


# Compile output

def compile_output(state: OrchestratorState) -> dict:
    # Assemble the final structured output for the always-review pipeline.
    ri = state["risk_input"]
    tier = ri.get("risk_tier", "LOW")

    tool_results = state.get("tool_results", [])
    revised_results = state.get("revised_tool_results", [])
    errors = state.get("execution_errors", [])
    success_count = sum(1 for r in tool_results if r.get("success"))
    total_count = len(tool_results)
    corrective_count = len(revised_results)

    awaiting = state.get("awaiting_approval", False)
    revised_plan = state.get("revised_plan", [])
    review_status = state.get("review_status", "")

    if tier == "LOW":
        summary = "Monitoring only. All metrics within acceptable range."
        confidence = 0.95
    elif review_status == "corrections_proposed":
        first_tools = [r["tool"] for r in tool_results if r.get("success")]
        corrective_tools = [s.get("tool", "?") for s in revised_plan if isinstance(s, dict)]
        summary = (
            f"{tier} risk: executed {len(first_tools)} tools ({', '.join(first_tools)}). "
            f"Reflection identified gaps. {len(corrective_tools)} corrective actions proposed. "
            f"Awaiting human review."
        )
        confidence = 0.70
    elif review_status in ("adequate_pending_confirmation", "notification_pending"):
        first_tools = [r["tool"] for r in tool_results if r.get("success")]
        deferred = state.get("deferred_tools", [])
        summary = (
            f"{tier} risk: executed {len(first_tools)} tools ({', '.join(first_tools)}). "
            f"Response adequate. {'Notification' if deferred else 'Confirmation'} pending human approval."
        )
        confidence = 0.80
    elif total_count == 0:
        summary = f"{tier} risk detected but no tools executed. Manual intervention required."
        confidence = 0.3
    elif corrective_count > 0:
        summary = (
            f"Executed {total_count}-step response for {tier} risk "
            f"(including {corrective_count} corrective). "
            f"Primary issue: {state.get('primary_issue', 'N/A')}."
        )
        confidence = 0.85 if not errors else 0.65
    elif errors:
        summary = f"Partial execution: {success_count}/{total_count} tools succeeded."
        confidence = 0.5
    else:
        summary = (
            f"Executed {total_count}-step mitigation plan for {tier} risk. "
            f"Primary issue: {state.get('primary_issue', 'N/A')}."
        )
        confidence = 0.85

    def _steps_to_dicts(steps):
        return [{"step": s.get("step", i+1), "action": s.get("action", ""),
                 "tool": s.get("tool", ""), "reason": s.get("reason", "")}
                for i, s in enumerate(steps or []) if isinstance(s, dict)]

    output = {
        "shipment_id": ri.get("shipment_id"),
        "container_id": ri.get("container_id"),
        "window_id": ri.get("window_id"),
        "leg_id": ri.get("leg_id"),
        "risk_tier": tier,
        "fused_risk_score": ri.get("fused_risk_score", 0),
        "ml_spoilage_probability": ri.get("ml_spoilage_probability", 0),
        "decision_summary": summary,
        "key_drivers": [d.get("feature", str(d)) for d in ri.get("key_drivers", [])],
        "draft_plan": _steps_to_dicts(state.get("draft_plan")),
        "reflection_notes": state.get("reflection_notes", []),
        "revised_plan": _steps_to_dicts(revised_plan),
        "actions_taken": [
            {"tool": r["tool"], "input": r["input"], "result": r["result"]}
            for r in tool_results
        ],
        "corrective_actions": [
            {"tool": r["tool"], "input": r["input"], "result": r["result"]}
            for r in revised_results
        ],
        "fallback_plan": _steps_to_dicts(state.get("fallback_plan")),
        "requires_approval": state.get("requires_approval", False),
        "awaiting_approval": awaiting,
        "approval_reason": state.get("approval_reason", ""),
        "approval_id": state.get("approval_id"),
        "review_status": review_status,
        "proposed_tools": [s.get("tool", "") for s in revised_plan
                           if isinstance(s, dict) and s.get("tool") != "approval_workflow"],
        "llm_reasoning": state.get("llm_reasoning", ""),
        "cascade_context": state.get("cascade_context", {}),
        "cascade_summary": {k: str(v)[:200] for k, v in state.get("cascade_context", {}).items()},
        "observation": state.get("observation", ""),
        "observation_issues": state.get("observation_issues", []),
        "replan_count": state.get("replan_count", 0),
        "execution_history": state.get("execution_history", []),
        "audit_log_summary": (
            f"{total_count} tools executed, {len(errors)} errors, tier={tier}"
        ),
        "confidence": confidence,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    # Collect tool-level guardrail findings (e.g. prompt injection, content safety from compliance_agent)
    tool_level_findings: list[GuardrailFinding] = []
    for r in tool_results + revised_results:
        result = r.get("result") or {}
        finding = result.get("guardrail_finding")
        if finding and isinstance(finding, dict):
            tool_level_findings.append(finding)
        extra_findings = result.get("guardrail_findings")
        if isinstance(extra_findings, list):
            tool_level_findings.extend(f for f in extra_findings if isinstance(f, dict))

    all_findings = state.get("guardrail_findings", []) + tool_level_findings
    output["guardrail_findings"] = all_findings

    # Persist non-passed findings to audit JSONL for dashboard surfacing
    non_passed = [f for f in all_findings if isinstance(f, dict) and not f.get("passed", True)]
    if non_passed:
        from pathlib import Path
        audit_dir = Path("audit_logs")
        audit_dir.mkdir(exist_ok=True)
        with open(audit_dir / "guardrail_findings.jsonl", "a") as gf:
            for f in non_passed:
                import json as _json
                gf.write(_json.dumps({
                    **f,
                    "entry_type": "guardrail_finding",
                    "shipment_id": ri.get("shipment_id"),
                    "window_id": ri.get("window_id"),
                }) + "\n")

    node_latencies = state.get("node_latencies") or {}
    token_breakdown = state.get("token_breakdown") or {}
    total_latency_ms = sum(v for v in node_latencies.values() if isinstance(v, (int, float)))
    total_tokens = sum(
        v.get("tokens", 0) for v in token_breakdown.values() if isinstance(v, dict)
    )
    total_cost_usd = sum(
        v.get("cost_usd", 0.0) for v in token_breakdown.values() if isinstance(v, dict)
    )

    output["node_latencies"] = node_latencies
    output["token_breakdown"] = token_breakdown
    output["total_latency_ms"] = round(total_latency_ms, 1)
    output["total_tokens"] = total_tokens
    output["total_cost_usd"] = round(total_cost_usd, 6)

    # Persist to Supabase (best-effort, non-fatal)
    try:
        from src.supabase_client import write_agent_run_metrics
        write_agent_run_metrics({
            "run_id": state.get("thread_id", ""),
            "shipment_id": ri.get("shipment_id"),
            "window_id": ri.get("window_id"),
            "risk_tier": tier,
            "started_at": state.get("run_started_at"),
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "total_latency_ms": round(total_latency_ms, 1),
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost_usd, 6),
            "node_latencies": node_latencies,
            "token_breakdown": token_breakdown,
            "guardrail_findings": all_findings,
            "guardrail_escalated": any(
                not f.get("passed", True) and f.get("severity") == "critical"
                for f in all_findings if isinstance(f, dict)
            ),
        })
    except Exception as exc:
        logger.warning("write_agent_run_metrics failed (non-fatal): %s", exc)

    logger.info("OUTPUT  tier=%s confidence=%.2f tools=%d review=%s guardrail_findings=%d latency=%.0fms",
                tier, confidence, total_count, review_status, len(all_findings), total_latency_ms)
    return {
        "final_output": output,
        "decision_summary": summary,
        "confidence": confidence,
        "guardrail_findings": tool_level_findings,
    }
