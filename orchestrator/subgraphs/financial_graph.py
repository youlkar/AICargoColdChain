"""
Financial specialist subgraph
"""

from __future__ import annotations

import logging

from langgraph.graph import END, StateGraph

from orchestrator.subgraphs.base import AgentState, make_agent_result

logger = logging.getLogger(__name__)

AGENT_NAME = "insurance_agent"
WAVE = 2


def call_financial(state: AgentState) -> dict:
    from orchestrator.nodes import _build_tool_input, _enrich_tool_input
    from tools import TOOL_MAP

    ri = state.get("risk_input", {})
    # cascade_context now includes wave-1 compliance result → supporting_evidence injection
    cascade = state.get("cascade_context", {})

    base_input = _build_tool_input(AGENT_NAME, ri, {"risk_input": ri,
                                                     "primary_issue": cascade.get("primary_issue", ""),
                                                     "cascade_context": cascade})
    tool_input = _enrich_tool_input(AGENT_NAME, base_input, cascade, ri)

    try:
        result = TOOL_MAP[AGENT_NAME].invoke(tool_input)
        logger.info("FINANCIAL_AGENT  estimated_loss=%s", result.get("estimated_loss_usd"))
        return {"tool_input": tool_input, "tool_result": result, "success": True}
    except Exception as exc:
        logger.error("FINANCIAL_AGENT  failed: %s", exc)
        return {
            "tool_input": tool_input,
            "tool_result": {"error": str(exc), "status": "failed"},
            "success": False,
        }


def assess_financial(state: AgentState) -> dict:
    result = state.get("tool_result", {})
    if not state.get("success", False):
        return {
            "confidence": 0.1, "reasoning": "Insurance tool failed",
            "needs_escalation": True,
            "escalation_reason": result.get("error", "financial calc failed"),
        }

    loss = result.get("estimated_loss_usd") or result.get("total_estimated_loss") or 0
    claim_ref = result.get("claim_reference") or result.get("claim_id")

    if loss and claim_ref:
        return {
            "confidence": 0.90,
            "reasoning": f"Claim prepared: loss=${loss:,.0f} ref={claim_ref}",
            "needs_escalation": False, "escalation_reason": None,
        }
    return {
        "confidence": 0.65,
        "reasoning": "Claim prepared but missing reference or loss estimate",
        "needs_escalation": False, "escalation_reason": None,
    }


def emit_financial(state: AgentState) -> dict:
    result = make_agent_result(AGENT_NAME, AGENT_NAME, state, wave=WAVE)
    logger.info("FINANCIAL_AGENT  emit confidence=%.2f", result["confidence"])
    return {"agent_results": [result]}


sg = StateGraph(AgentState)
sg.add_node("call_tool", call_financial)
sg.add_node("assess",    assess_financial)
sg.add_node("emit",      emit_financial)

sg.set_entry_point("call_tool")
sg.add_edge("call_tool", "assess")
sg.add_edge("assess", "emit")
sg.add_edge("emit", END)

compiled = sg.compile()
