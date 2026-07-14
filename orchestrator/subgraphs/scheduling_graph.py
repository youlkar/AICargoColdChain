"""
Scheduling specialist subgraph
"""

from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from orchestrator.subgraphs.base import AgentState, make_agent_result

logger = logging.getLogger(__name__)

AGENT_NAME = "scheduling_agent"
WAVE = 2


def call_scheduling(state: AgentState) -> dict:
    from orchestrator.nodes import _build_tool_input, _enrich_tool_input
    from tools import TOOL_MAP

    ri = state.get("risk_input", {})
    cascade = state.get("cascade_context", {})

    base_input = _build_tool_input(AGENT_NAME, ri, {"risk_input": ri,
                                                     "primary_issue": cascade.get("primary_issue", ""),
                                                     "cascade_context": cascade})
    tool_input = _enrich_tool_input(AGENT_NAME, base_input, cascade, ri)

    try:
        result = TOOL_MAP[AGENT_NAME].invoke(tool_input)
        recs = result.get("facility_recommendations") or result.get("recommendations") or []
        logger.info("SCHEDULING_AGENT  recommendations=%d", len(recs))
        return {"tool_input": tool_input, "tool_result": result, "success": True}
    except Exception as exc:
        logger.error("SCHEDULING_AGENT  failed: %s", exc)
        return {
            "tool_input": tool_input,
            "tool_result": {"error": str(exc), "status": "failed"},
            "success": False,
        }


def assess_scheduling(state: AgentState) -> dict:
    result = state.get("tool_result", {})
    if not state.get("success", False):
        return {
            "confidence": 0.1, "reasoning": "Scheduling tool failed",
            "needs_escalation": True,
            "escalation_reason": result.get("error", "scheduling failed"),
        }

    recs = result.get("facility_recommendations") or result.get("recommendations") or []
    priority = (result.get("priority_tier") or result.get("priority") or "").lower()

    if recs:
        conf = 0.90 if priority in ("critical", "high") else 0.80
        return {
            "confidence": conf,
            "reasoning": f"{len(recs)} reschedule recommendation(s), priority={priority}",
            "needs_escalation": False, "escalation_reason": None,
        }
    return {
        "confidence": 0.60,
        "reasoning": "No facility recommendations generated",
        "needs_escalation": False, "escalation_reason": None,
    }


def emit_scheduling(state: AgentState) -> dict:
    result = make_agent_result(AGENT_NAME, AGENT_NAME, state, wave=WAVE)
    logger.info("SCHEDULING_AGENT  emit confidence=%.2f", result["confidence"])
    return {"agent_results": [result]}


sg = StateGraph(AgentState)
sg.add_node("call_tool", call_scheduling)
sg.add_node("assess",    assess_scheduling)
sg.add_node("emit",      emit_scheduling)

sg.set_entry_point("call_tool")
sg.add_edge("call_tool", "assess")
sg.add_edge("assess", "emit")
sg.add_edge("emit", END)

compiled = sg.compile()
