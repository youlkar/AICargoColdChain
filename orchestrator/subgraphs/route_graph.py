"""
Route specialist subgraph
"""

from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from orchestrator.subgraphs.base import AgentState, make_agent_result

logger = logging.getLogger(__name__)

AGENT_NAME = "route_agent"
WAVE = 1


def call_route(state: AgentState) -> dict:
    # Build tool input and invoke the route agent.
    from orchestrator.nodes import _build_tool_input, _enrich_tool_input
    from orchestrator.memory import get_route_history
    from tools import TOOL_MAP

    ri = state.get("risk_input", {})
    cascade = state.get("cascade_context", {})

    base_input = _build_tool_input(AGENT_NAME, ri, {"risk_input": ri,
                                                     "primary_issue": cascade.get("primary_issue", ""),
                                                     "cascade_context": cascade})
    tool_input = _enrich_tool_input(AGENT_NAME, base_input, cascade, ri)

    # Inject route history for smarter carrier selection
    try:
        facility = ri.get("facility", {})
        origin = facility.get("airport_code") or ri.get("transit_phase", "unknown")
        dest = ri.get("leg_id", "")
        history = get_route_history(origin, dest, limit=3)
        if history:
            tool_input = {**tool_input, "route_history": [
                {"carrier": h.get("carrier"), "success": h.get("success"),
                 "delay_mins": h.get("delay_mins")}
                for h in history
            ]}
            logger.info("ROUTE_AGENT  injected %d route history records", len(history))
    except Exception as exc:
        logger.debug("ROUTE_AGENT  memory read skipped: %s", exc)

    try:
        result = TOOL_MAP[AGENT_NAME].invoke(tool_input)
        logger.info("ROUTE_AGENT  routes_found=%d", len(result.get("alternative_routes", [])))
        return {"tool_input": tool_input, "tool_result": result, "success": True}
    except Exception as exc:
        logger.error("ROUTE_AGENT  failed: %s", exc)
        return {
            "tool_input": tool_input,
            "tool_result": {"error": str(exc), "status": "failed"},
            "success": False,
        }


def assess_route(state: AgentState) -> dict:
    result = state.get("tool_result", {})
    if not state.get("success", False):
        return {
            "confidence": 0.1, "reasoning": "Route agent failed",
            "needs_escalation": True,
            "escalation_reason": result.get("error", "route lookup failed"),
        }

    routes = result.get("alternative_routes") or result.get("routes") or []
    if routes:
        return {
            "confidence": 0.85,
            "reasoning": f"{len(routes)} alternative route(s) identified",
            "needs_escalation": False, "escalation_reason": None,
        }
    return {
        "confidence": 0.55,
        "reasoning": "No alternative routes found — original route maintained",
        "needs_escalation": False, "escalation_reason": None,
    }


def emit_route(state: AgentState) -> dict:
    result = make_agent_result(AGENT_NAME, AGENT_NAME, state, wave=WAVE)
    logger.info("ROUTE_AGENT  emit confidence=%.2f", result["confidence"])

    # persist route performance to memory
    try:
        from orchestrator.memory import record_route
        ri = state.get("risk_input", {})
        tool_result = state.get("tool_result", {})
        facility = ri.get("facility", {})
        origin = facility.get("airport_code") or ri.get("transit_phase", "unknown")
        dest = ri.get("leg_id", "")
        selected = tool_result.get("selected_route") or {}
        carrier = selected.get("carrier") or tool_result.get("carrier", "unknown")
        record_route(
            origin=origin, dest=dest,
            shipment_id=ri.get("shipment_id", ""),
            carrier=carrier,
            success=state.get("success", False),
            delay_mins=float(tool_result.get("eta_impact_min", 0) or 0),
        )
    except Exception as exc:
        logger.debug("ROUTE_AGENT  memory write skipped: %s", exc)

    return {"agent_results": [result]}


sg = StateGraph(AgentState)
sg.add_node("call_tool", call_route)
sg.add_node("assess",    assess_route)
sg.add_node("emit",      emit_route)

sg.set_entry_point("call_tool")
sg.add_edge("call_tool", "assess")
sg.add_edge("assess", "emit")
sg.add_edge("emit", END)

compiled = sg.compile()
