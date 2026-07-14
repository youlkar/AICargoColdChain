"""
Compliance specialist subgraph
"""

from __future__ import annotations

import logging
from typing import Any

from langgraph.graph import END, StateGraph

from orchestrator.subgraphs.base import AgentState, increment_retry, make_agent_result

logger = logging.getLogger(__name__)

AGENT_NAME = "compliance_agent"
WAVE = 1


# ── Nodes ────────────────────────────────────────────────────────────

def call_compliance(state: AgentState) -> dict:
    # Build tool input and invoke the compliance tool.
    from orchestrator.nodes import _build_tool_input, _enrich_tool_input
    from orchestrator.memory import get_compliance_history
    from tools import TOOL_MAP

    ri = state.get("risk_input", {})
    cascade = state.get("cascade_context", {})
    retry_count = state.get("retry_count", 0)
    product_category = ri.get("product_type", ri.get("product_id", "standard_refrigerated"))

    base_input = _build_tool_input(AGENT_NAME, ri, {"risk_input": ri, "cascade_context": cascade,
                                                     "primary_issue": cascade.get("primary_issue", "")})
    tool_input = _enrich_tool_input(AGENT_NAME, base_input, cascade, ri)

    # Inject past compliance history into tool details
    try:
        history = get_compliance_history(product_category, limit=3)
        if history:
            details = dict(tool_input.get("details", {}))
            details["prior_outcomes"] = [
                {"status": h.get("status"), "disposition": h.get("disposition"),
                 "confidence": h.get("confidence")}
                for h in history
            ]
            tool_input = {**tool_input, "details": details}
            logger.info("COMPLIANCE_AGENT  injected %d prior outcomes", len(history))
    except Exception as exc:
        logger.debug("COMPLIANCE_AGENT  memory read skipped: %s", exc)

    # On retry: broaden the regulatory search context so RAG can find edge cases.
    if retry_count > 0:
        details = dict(tool_input.get("details", {}))
        details["search_broader"] = True
        details["retry_attempt"] = retry_count
        tool_input = {**tool_input, "details": details}
        logger.info("COMPLIANCE_AGENT  retry=%d (broadened search)", retry_count)

    try:
        result = TOOL_MAP[AGENT_NAME].invoke(tool_input)
        logger.info("COMPLIANCE_AGENT  status=%s log_id=%s",
                    result.get("compliance_status"), result.get("log_id"))
        return {"tool_input": tool_input, "tool_result": result, "success": True}
    except Exception as exc:
        logger.error("COMPLIANCE_AGENT  failed: %s", exc)
        return {
            "tool_input": tool_input,
            "tool_result": {"error": str(exc), "status": "failed"},
            "success": False,
        }


def assess_compliance(state: AgentState) -> dict:
    # Quality-gate: deterministic heuristic with optional LLM upgrade
    result = state.get("tool_result", {})
    success = state.get("success", False)

    if not success:
        return {
            "confidence": 0.1,
            "reasoning": f"Tool call failed: {result.get('error', 'unknown')}",
            "needs_escalation": True,
            "escalation_reason": result.get("error", "compliance tool failed"),
        }

    status = (result.get("compliance_status") or result.get("status") or "").lower()
    log_id = result.get("log_id") or result.get("audit_log_id")
    disposition = (result.get("product_disposition") or "").lower()

    # Deterministic quality judgement
    if status in ("violation", "non_compliant"):
        confidence = 0.90 if log_id else 0.65
        needs_escalation = disposition in ("quarantine", "destroy")
        reasoning = f"Non-compliance: status='{status}' disposition='{disposition}'"
    elif status in ("compliant",):
        confidence = 0.92 if log_id else 0.72
        needs_escalation = False
        reasoning = f"Compliant. Log id: {log_id}"
    elif status in ("borderline",):
        confidence = 0.70
        needs_escalation = False
        reasoning = f"Borderline compliance — monitoring required"
    else:
        # Ambiguous / no status returned — low confidence, trigger retry
        confidence = 0.30
        needs_escalation = False
        reasoning = f"Ambiguous compliance status '{status}' — retry with broader search"

    # Optional LLM upgrade: short quality assessment
    try:
        from orchestrator.llm_provider import get_llm
        llm = get_llm()
        if llm is not None and confidence < 0.6:
            prompt = (
                f"Compliance result: status={status}, disposition={disposition}, "
                f"log_id={'present' if log_id else 'missing'}.\n"
                f"Rate confidence 0.0–1.0 that this is adequate for a {state.get('risk_input', {}).get('risk_tier', '')} "
                f"risk event. Reply with only a number."
            )
            try:
                llm_conf = float(llm.invoke(prompt).content.strip())
                confidence = max(0.0, min(1.0, llm_conf))
                reasoning += f" [LLM confidence override: {confidence:.2f}]"
            except Exception:
                pass  # keep deterministic score
    except Exception:
        pass

    return {
        "confidence": confidence,
        "reasoning": reasoning,
        "needs_escalation": needs_escalation,
        "escalation_reason": reasoning if needs_escalation else None,
    }


def should_retry_compliance(state: AgentState) -> str:
    if state.get("confidence", 0.0) < 0.45 and state.get("retry_count", 0) < 1:
        return "retry"
    return "done"


def emit_compliance(state: AgentState) -> dict:
    result = make_agent_result(AGENT_NAME, AGENT_NAME, state, wave=WAVE)
    logger.info("COMPLIANCE_AGENT  emit confidence=%.2f escalation=%s",
                result["confidence"], result["needs_escalation"])

    # Persist outcome to memory for future runs
    try:
        from orchestrator.memory import record_compliance
        ri = state.get("risk_input", {})
        product_category = ri.get("product_type", ri.get("product_id", "standard_refrigerated"))
        shipment_id = ri.get("shipment_id", "")
        tool_result = state.get("tool_result", {})
        record_compliance(
            product_category=product_category,
            shipment_id=shipment_id,
            status=(tool_result.get("compliance_status") or "unknown").lower(),
            confidence=state.get("confidence", 0.0),
            disposition=(tool_result.get("product_disposition") or "").lower(),
        )
    except Exception as exc:
        logger.debug("COMPLIANCE_AGENT  memory write skipped: %s", exc)

    return {"agent_results": [result]}


# Subgraph assembly

sg = StateGraph(AgentState)
sg.add_node("call_tool",       call_compliance)
sg.add_node("assess",          assess_compliance)
sg.add_node("increment_retry", increment_retry)
sg.add_node("emit",            emit_compliance)

sg.set_entry_point("call_tool")
sg.add_edge("call_tool", "assess")
sg.add_conditional_edges(
    "assess",
    should_retry_compliance,
    {"retry": "increment_retry", "done": "emit"},
)
sg.add_edge("increment_retry", "call_tool")
sg.add_edge("emit", END)

compiled = sg.compile()
