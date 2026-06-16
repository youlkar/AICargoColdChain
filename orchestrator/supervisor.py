"""
Supervisor
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List

from langgraph.types import Send

from orchestrator import guardrails
from orchestrator.protocol import AgentResult, AgentMessageType, make_message
from orchestrator.state import OrchestratorState, ToolResult

logger = logging.getLogger(__name__)

# Tools held back until post-approval human review.
DEFERRED_FIRST_PASS = {"notification_agent"}

# How many past HIGH/CRITICAL runs trigger an auto-escalation (3B).
_REPEAT_ESCALATION_THRESHOLD = int(os.getenv("CARGO_REPEAT_ESCALATION_THRESHOLD", "3"))


# Prepare execution

def prepare_execution(state: OrchestratorState) -> dict:
    # Identify deferred tools, detect repeat excursions, lock in active plan.
    from orchestrator.memory import count_repeat_excursions, get_run_history
    from tools.registry import REGISTRY

    active = state.get("active_plan") or state.get("draft_plan", [])
    planned_tools = {s["tool"] for s in active if isinstance(s, dict) and s.get("tool")}

    # derive deferred set from registry metadata
    deferred = [
        t for t in planned_tools
        if t in REGISTRY and REGISTRY.get_meta(t) and REGISTRY.get_meta(t).always_deferred
    ]
    # fallback to hardcoded set for tools not yet in registry
    for t in planned_tools:
        if t in DEFERRED_FIRST_PASS and t not in deferred:
            deferred.append(t)

    for t in deferred:
        logger.info("SUPERVISOR  deferring %s to post-approval", t)

    ri = state.get("risk_input", {})
    shipment_id = ri.get("shipment_id", "")
    tier = ri.get("risk_tier", "LOW")

    # read recent run history for this shipment
    history = get_run_history(shipment_id, limit=10) if shipment_id else []
    history_summary = [
        {"tier": r.get("tier"), "outcome": r.get("outcome"), "timestamp": r.get("timestamp")}
        for r in history
    ]

    # escalation pattern detection
    repeat_count = count_repeat_excursions(shipment_id) if shipment_id else 0
    escalation_context = {}

    if repeat_count >= _REPEAT_ESCALATION_THRESHOLD and tier not in ("CRITICAL",):
        escalation_context = {
            "severity": "critical",          # override interpret node's assessment
            "urgency": "immediate",
            "primary_issue": (
                f"AUTO-ESCALATED: Repeat excursion #{repeat_count + 1} for shipment "
                f"{shipment_id}. Original tier={tier} upgraded to CRITICAL."
            ),
        }
        logger.warning(
            "SUPERVISOR  3B escalation: shipment=%s repeat_count=%d → upgrading to CRITICAL",
            shipment_id, repeat_count,
        )

    messages = []

    # log repeat-escalation event if triggered
    if escalation_context:
        messages.append(make_message(
            sender="supervisor",
            recipient="orchestrator",
            message_type=AgentMessageType.REPEAT_ESCALATION,
            payload={
                "shipment_id": shipment_id,
                "repeat_count": repeat_count,
                "original_tier": tier,
                "upgraded_to": "CRITICAL",
            },
            reasoning=escalation_context.get("primary_issue", ""),
        ))

    # Rate-limit check per planned tool
    rate_limited: list = []
    rate_findings: list = []
    for t in planned_tools:
        findings = guardrails.check_action_rate(shipment_id, t)
        if findings:
            rate_limited.append(t)
            rate_findings.extend(findings)
            logger.warning("SUPERVISOR  rate-limit: skipping %s for shipment %s", t, shipment_id)

    updates: Dict[str, Any] = {
        "active_plan": active,
        "deferred_tools": deferred,
        "agent_results": [],        # reset accumulator for this run
        "agent_message_log": messages,
        "shipment_run_history": history_summary,
        "repeat_excursion_count": repeat_count,
        "rate_limited_tools": rate_limited,
        "guardrail_findings": rate_findings,
    }
    updates.update(escalation_context)
    return updates


# Wave 1 dispatch

def dispatch_wave1(state: OrchestratorState) -> List[Send]:
    # Fan out to independent wave-1 agents in parallel.
    from tools.registry import REGISTRY

    active = state.get("active_plan") or state.get("draft_plan", [])
    planned = {s["tool"] for s in active if isinstance(s, dict) and s.get("tool")}
    deferred = set(state.get("deferred_tools", []))
    ri = state.get("risk_input", {})
    tier = ri.get("risk_tier", "LOW")
    phase = ri.get("transit_phase", "")
    product_type = ri.get("product_type", ri.get("product_id", "*"))

    # query registry for applicable wave-1 tools given current context
    registry_wave1 = {
        t.name for t in REGISTRY.query(tier=tier, phase=phase,
                                        product_type=product_type, wave=1)
    }

    base = {
        "risk_input": ri,
        "cascade_context": {},
        "retry_count": 0,
        "success": False,
        "confidence": 0.0,
        "reasoning": "",
        "needs_escalation": False,
        "escalation_reason": None,
        "agent_results": [],
    }

    dispatches: List[Send] = []
    rate_limited = set(state.get("rate_limited_tools", []))

    for tool_name, node_name in [
        ("compliance_agent",   "compliance_subgraph"),
        ("cold_storage_agent", "cold_storage_subgraph"),
        ("route_agent",        "route_subgraph"),
    ]:
        if tool_name not in planned or tool_name in deferred or tool_name in rate_limited:
            continue
        # registry gate
        if tool_name not in registry_wave1:
            logger.info("SUPERVISOR  wave1: skipping %s (registry: not applicable for "
                        "tier=%s phase=%s)", tool_name, tier, phase)
            continue
        dispatches.append(Send(node_name, dict(base)))

    if not dispatches:
        logger.info("SUPERVISOR  wave1: no agents to dispatch, passthrough")
        return [Send("merge_wave1", {**base, "agent_results": []})]

    dispatched_names = [d.node for d in dispatches]
    logger.info("SUPERVISOR  wave1: dispatching %d agent(s) in parallel: %s",
                len(dispatches), dispatched_names)
    return dispatches


# Wave 1 merge

def merge_wave1(state: OrchestratorState) -> dict:
    # Collect wave-1 results and build cascade_context for wave-2 inputs.
    results: List[AgentResult] = state.get("agent_results", [])
    wave1 = [r for r in results if isinstance(r, dict) and r.get("wave", 1) == 1]

    cascade: Dict[str, Any] = dict(state.get("cascade_context") or {})

    for r in wave1:
        agent = r.get("agent_name", "")
        cascade[agent] = r.get("tool_result", {})
        if r.get("needs_escalation"):
            logger.warning("SUPERVISOR  wave1 agent=%s escalation: %s",
                           agent, r.get("escalation_reason"))

    # log wave-1 completion
    msg = make_message(
        sender="supervisor",
        recipient="orchestrator",
        message_type=AgentMessageType.WAVE_COMPLETE,
        payload={
            "wave": 1,
            "agents_completed": [r.get("agent_name") for r in wave1],
            "cascade_keys": list(cascade.keys()),
            "escalations": [r.get("agent_name") for r in wave1 if r.get("needs_escalation")],
        },
        reasoning=f"Wave 1 complete — {len(wave1)} agent(s) merged into cascade_context",
    )
    findings: list = []
    for r in wave1:
        findings += guardrails.check_confidence_gate(r)
        findings += guardrails.check_reasoning_consistency(r)

    logger.info("SUPERVISOR  merge_wave1: %d results, cascade=%s, findings=%d",
                len(wave1), list(cascade.keys()), len(findings))
    return {"cascade_context": cascade, "agent_message_log": [msg], "guardrail_findings": findings}


# Wave 2 dispatch

def dispatch_wave2(state: OrchestratorState) -> List[Send]:
    # Fan out to cascade-dependent wave-2 agents in parallel.
    from tools.registry import REGISTRY

    active = state.get("active_plan") or state.get("draft_plan", [])
    planned = {s["tool"] for s in active if isinstance(s, dict) and s.get("tool")}
    deferred = set(state.get("deferred_tools", []))
    ri = state.get("risk_input", {})
    tier = ri.get("risk_tier", "LOW")
    phase = ri.get("transit_phase", "")
    product_type = ri.get("product_type", ri.get("product_id", "*"))
    cascade = dict(state.get("cascade_context", {}))

    registry_wave2 = {
        t.name for t in REGISTRY.query(tier=tier, phase=phase,
                                        product_type=product_type, wave=2)
    }

    base = {
        "risk_input": ri,
        "cascade_context": cascade,
        "retry_count": 0,
        "success": False,
        "confidence": 0.0,
        "reasoning": "",
        "needs_escalation": False,
        "escalation_reason": None,
        "agent_results": [],
    }

    dispatches: List[Send] = []
    rate_limited = set(state.get("rate_limited_tools", []))

    for tool_name, node_name in [
        ("insurance_agent",   "financial_subgraph"),
        ("scheduling_agent",  "scheduling_subgraph"),
    ]:
        if tool_name not in planned or tool_name in deferred or tool_name in rate_limited:
            continue
        if tool_name not in registry_wave2:
            logger.info("SUPERVISOR  wave2: skipping %s (registry: not applicable for "
                        "tier=%s)", tool_name, tier)
            continue
        dispatches.append(Send(node_name, dict(base)))

    if not dispatches:
        logger.info("SUPERVISOR  wave2: no agents to dispatch, passthrough")
        return [Send("merge_wave2", {**base, "agent_results": []})]

    logger.info("SUPERVISOR  wave2: dispatching %d agent(s) in parallel: %s",
                len(dispatches), [d.node for d in dispatches])
    return dispatches


# Wave 2 merge

def merge_wave2(state: OrchestratorState) -> dict:
    # Final merge: convert AgentResults → tool_results + write run to memory.
    from orchestrator.memory import record_run

    all_results: List[AgentResult] = state.get("agent_results", [])
    ri = state.get("risk_input", {})
    shipment_id = ri.get("shipment_id", "")
    tier = ri.get("risk_tier", "LOW")
    thread_id = state.get("thread_id", "")

    tool_results: List[ToolResult] = []
    cascade: Dict[str, Any] = dict(state.get("cascade_context") or {})

    for r in all_results:
        if not isinstance(r, dict):
            continue
        agent = r.get("agent_name", "")
        tool_results.append(ToolResult(
            tool=agent,
            input=r.get("tool_input", {}),
            result=r.get("tool_result", {}),
            success=r.get("success", False),
        ))
        cascade[agent] = r.get("tool_result", {})

    succeeded  = [r["tool"] for r in tool_results if r["success"]]
    failed     = [r["tool"] for r in tool_results if not r["success"]]
    escalations = [r for r in all_results if isinstance(r, dict) and r.get("needs_escalation")]

    observation = (
        f"{len(tool_results)} agents ran across 2 parallel waves "
        f"({len(succeeded)} succeeded, {len(failed)} failed). "
        + (f"Escalations flagged by: {[e['agent_name'] for e in escalations]}."
           if escalations else "")
    )

    # write this run to memory so the supervisor can detect patterns later
    if shipment_id and thread_id:
        outcome = "escalated" if escalations else "completed"
        try:
            record_run(
                shipment_id=shipment_id,
                thread_id=thread_id,
                tier=tier,
                tools_executed=succeeded,
                outcome=outcome,
                replan_count=state.get("replan_count", 0),
            )
        except Exception as exc:
            logger.warning("MEMORY  record_run failed (non-fatal): %s", exc)

    # log wave-2 / full-run completion
    completion_msg = make_message(
        sender="supervisor",
        recipient="orchestrator",
        message_type=AgentMessageType.WAVE_COMPLETE,
        payload={
            "wave": 2,
            "agents_completed": [r["tool"] for r in tool_results],
            "succeeded": succeeded,
            "failed": failed,
            "escalations": [e["agent_name"] for e in escalations],
        },
        reasoning=observation,
    )

    # one RESULT_REPORT per agent for the message log
    result_msgs = [
        make_message(
            sender=r.get("agent_name", r["tool"]),
            recipient="supervisor",
            message_type=AgentMessageType.RESULT_REPORT,
            payload={"tool": r["tool"], "success": r["success"]},
            confidence=next(
                (ar.get("confidence", 0.8) for ar in all_results
                 if isinstance(ar, dict) and ar.get("agent_name") == r["tool"]),
                0.8,
            ),
            reasoning=next(
                (ar.get("reasoning", "") for ar in all_results
                 if isinstance(ar, dict) and ar.get("agent_name") == r["tool"]),
                "",
            ),
        )
        for r in tool_results
    ]

    wave2 = [r for r in all_results if isinstance(r, dict) and r.get("wave", 1) == 2]
    findings: list = []
    for r in wave2:
        findings += guardrails.check_confidence_gate(r)
        findings += guardrails.check_reasoning_consistency(r)

    logger.info("SUPERVISOR  merge_wave2: %d results succeeded=%s failed=%s findings=%d",
                len(tool_results), succeeded, failed, len(findings))

    return {
        "tool_results": tool_results,
        "cascade_context": cascade,
        "observation": observation,
        "deferred_tools": list(state.get("deferred_tools", [])),
        "agent_message_log": [completion_msg] + result_msgs,
        "guardrail_findings": findings,
    }
