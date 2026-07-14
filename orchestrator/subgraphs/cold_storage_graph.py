"""
Cold-storage specialist subgraph 
"""

from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from orchestrator.subgraphs.base import AgentState, increment_retry, make_agent_result

logger = logging.getLogger(__name__)

AGENT_NAME = "cold_storage_agent"
WAVE = 1


def call_cold_storage(state: AgentState) -> dict:
    from orchestrator.nodes import _build_tool_input, _enrich_tool_input
    from tools import TOOL_MAP

    ri = state.get("risk_input", {})
    cascade = state.get("cascade_context", {})
    retry_count = state.get("retry_count", 0)

    base_input = _build_tool_input(AGENT_NAME, ri, {"risk_input": ri, "cascade_context": cascade})
    tool_input = _enrich_tool_input(AGENT_NAME, base_input, cascade, ri)

    # On retry: relax temperature constraints to widen the facility search.
    if retry_count > 0:
        tool_input = {**tool_input, "flexible_requirements": True}
        logger.info("COLD_STORAGE_AGENT  retry=%d (flexible requirements)", retry_count)

    try:
        result = TOOL_MAP[AGENT_NAME].invoke(tool_input)
        logger.info("COLD_STORAGE_AGENT  status=%s facility=%s",
                    result.get("status"), result.get("facility_name"))
        return {"tool_input": tool_input, "tool_result": result, "success": True}
    except Exception as exc:
        logger.error("COLD_STORAGE_AGENT  failed: %s", exc)
        return {
            "tool_input": tool_input,
            "tool_result": {"error": str(exc), "status": "failed"},
            "success": False,
        }


def assess_cold_storage(state: AgentState) -> dict:
    result = state.get("tool_result", {})
    success = state.get("success", False)

    if not success:
        return {
            "confidence": 0.1, "reasoning": "Tool call failed",
            "needs_escalation": True, "escalation_reason": result.get("error"),
        }

    status = (result.get("status") or "").lower()
    suit_score = result.get("suitability_score", 0)
    suit_tier  = (result.get("suitability_tier") or "").lower()

    # Normalize 0–1 vs 0–100 scores
    normalized = suit_score * 100 if isinstance(suit_score, float) and suit_score <= 1.5 else suit_score

    if status == "facility_found" and normalized >= 70:
        return {
            "confidence": 0.88, "reasoning": f"Facility found score={normalized:.0f}",
            "needs_escalation": False, "escalation_reason": None,
        }
    elif status == "facility_found" and normalized >= 40:
        return {
            "confidence": 0.60, "reasoning": f"Marginal facility score={normalized:.0f}",
            "needs_escalation": False, "escalation_reason": None,
        }
    elif status == "facility_found":
        return {
            "confidence": 0.35,
            "reasoning": f"Facility suitability too low: score={normalized:.0f} tier='{suit_tier}'",
            "needs_escalation": True,
            "escalation_reason": f"Facility suitability score {normalized:.0f} below threshold",
        }
    else:
        # No facility found — retry with relaxed constraints
        return {
            "confidence": 0.20,
            "reasoning": "No facility found — retrying with flexible requirements",
            "needs_escalation": False, "escalation_reason": None,
        }


def should_retry_cold_storage(state: AgentState) -> str:
    if state.get("confidence", 0.0) < 0.45 and state.get("retry_count", 0) < 1:
        return "retry"
    return "done"


def emit_cold_storage(state: AgentState) -> dict:
    result = make_agent_result(AGENT_NAME, AGENT_NAME, state, wave=WAVE)
    logger.info("COLD_STORAGE_AGENT  emit confidence=%.2f", result["confidence"])

    # Persist facility performance to memory
    try:
        from orchestrator.memory import record_facility
        ri = state.get("risk_input", {})
        tool_result = state.get("tool_result", {})
        facility_id = (tool_result.get("facility_id") or tool_result.get("facility_name") or "")
        if facility_id:
            score = tool_result.get("suitability_score", 0)
            record_facility(
                facility_id=str(facility_id),
                shipment_id=ri.get("shipment_id", ""),
                suitability_score=float(score) if isinstance(score, (int, float)) else 0.0,
                product_type=ri.get("product_type", ri.get("product_id", "")),
                outcome="placed" if state.get("success") else "failed",
            )
    except Exception as exc:
        logger.debug("COLD_STORAGE_AGENT  memory write skipped: %s", exc)

    return {"agent_results": [result]}


sg = StateGraph(AgentState)
sg.add_node("call_tool",       call_cold_storage)
sg.add_node("assess",          assess_cold_storage)
sg.add_node("increment_retry", increment_retry)
sg.add_node("emit",            emit_cold_storage)

sg.set_entry_point("call_tool")
sg.add_edge("call_tool", "assess")
sg.add_conditional_edges("assess", should_retry_cold_storage,
                           {"retry": "increment_retry", "done": "emit"})
sg.add_edge("increment_retry", "call_tool")
sg.add_edge("emit", END)

compiled = sg.compile()
