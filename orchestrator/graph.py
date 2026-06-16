# Orchestrator agent using LangGraph StateGraph.
# act-first, always-review, self-correcting loop topology
from __future__ import annotations
from orchestrator.checkpointer import get_checkpointer

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
import asyncio

from langgraph.graph import END, StateGraph
from tools.approval_workflow import _PENDING_APPROVALS

from orchestrator import guardrails
from orchestrator.llm_provider import get_llm, get_provider_name, get_model_name
from langgraph.types import Send

from orchestrator.nodes import (
    build_fallback,
    compile_output,
    re_execute,
    interpret_risk,
    plan as plan_deterministic,
    reflect as reflect_deterministic,
    revise as revise_deterministic,
)
from orchestrator.supervisor import (
    prepare_execution,
    dispatch_wave1,
    merge_wave1,
    dispatch_wave2,
    merge_wave2,
)
from orchestrator.subgraphs.compliance_graph import compiled as compliance_compiled
from orchestrator.subgraphs.cold_storage_graph import compiled as cold_storage_compiled
from orchestrator.subgraphs.route_graph import compiled as route_compiled
from orchestrator.subgraphs.financial_graph import compiled as financial_compiled
from orchestrator.subgraphs.scheduling_graph import compiled as scheduling_compiled
from orchestrator.state import OrchestratorState

logger = logging.getLogger(__name__)


def get_plan_node():
    if get_llm() is not None:
        from orchestrator.llm_nodes import plan_llm
        logger.info("Plan node: AGENTIC (%s/%s)", get_provider_name(), get_model_name())
        return plan_llm
    logger.info("Plan node: DETERMINISTIC (no LLM available)")
    return plan_deterministic


def get_reflect_node():
    if get_llm() is not None:
        from orchestrator.llm_nodes import reflect_llm
        logger.info("Reflect node: AGENTIC (%s/%s)", get_provider_name(), get_model_name())
        return reflect_llm
    logger.info("Reflect node: DETERMINISTIC")
    return reflect_deterministic


def get_revise_node():
    if get_llm() is not None:
        from orchestrator.llm_nodes import revise_llm
        logger.info("Revise node: AGENTIC (%s/%s)", get_provider_name(), get_model_name())
        return revise_llm
    logger.info("Revise node: DETERMINISTIC")
    return revise_deterministic


def get_observe_node():
    if get_llm() is not None:
        from orchestrator.llm_nodes import observe_llm
        logger.info("Observe node: AGENTIC (%s/%s)", get_provider_name(), get_model_name())
        return observe_llm
    return observe_deterministic


def observe_deterministic(state: OrchestratorState) -> dict:
    # Deterministic post-execution summary.
    tool_results = state.get("tool_results", [])
    failed = [r["tool"] for r in tool_results if not r.get("success")]
    return {
        "observation": f"{len(tool_results)} tools ran, {len(failed)} failed"
                       if tool_results else "no tools executed",
    }


# Conditional routing

def skip_if_low(state: OrchestratorState) -> str:
    tier = state["risk_input"].get("risk_tier", "LOW")
    if tier == "LOW":
        return "output"
    return "execute"


def should_revise(state: OrchestratorState) -> str:
    # After reflect: route to human_review if a blocking guardrail finding exists.
    if guardrails.has_blocking_finding(state.get("guardrail_findings", [])):
        logger.info("GUARDRAIL  blocking finding → human_review (from should_revise)")
        return "human_review"
    return "revise"


def should_replan(state: OrchestratorState) -> str:
    # after revise: loop back through re_execute if there are corrective tools to run AND we have not yet hit the replan cap.
    if guardrails.has_blocking_finding(state.get("guardrail_findings", [])):
        logger.info("GUARDRAIL  blocking finding → human_review (from should_replan)")
        return "human_review"

    max_replans = int(os.getenv("CARGO_MAX_REPLANS", "2"))
    replan_count = state.get("replan_count", 0)

    if replan_count >= max_replans:
        logger.info(
            "REPLAN_GATE  replan_count=%d >= max=%d → human_review",
            replan_count, max_replans,
        )
        return "human_review"

    deferred = set(state.get("deferred_tools", []))
    revised_plan = state.get("revised_plan", [])

    # Corrective tools = anything in revised_plan that is NOT the deferred
    # notification and NOT the approval_workflow placeholder.
    corrective_tools = [
        s for s in revised_plan
        if isinstance(s, dict)
        and s.get("tool") not in deferred
        and s.get("tool") != "approval_workflow"
    ]

    if corrective_tools:
        logger.info(
            "REPLAN_GATE  %d corrective tool(s) found (replan %d/%d) → re_execute",
            len(corrective_tools), replan_count + 1, max_replans,
        )
        return "re_execute"

    logger.info(
        "REPLAN_GATE  no corrective tools (only deferred/notification) → human_review",
    )
    return "human_review"


# approval record creation (fires at interrupt time, not inside the node)

def _register_approval_from_checkpoint(state: dict, thread_id: str) -> None:
    # Create a slim approval record in _PENDING_APPROVALS when the graph pauses.

    ri = state.get("risk_input", {})
    tier = ri.get("risk_tier", "MEDIUM")
    deferred = set(state.get("deferred_tools", []))
    tool_results = state.get("tool_results", [])
    revised_plan = state.get("revised_plan", [])

    succeeded = [r["tool"] for r in tool_results if r.get("success")]
    failed_tools = [r["tool"] for r in tool_results if not r.get("success")]

    proposed_corrections = [
        s["tool"] for s in revised_plan
        if isinstance(s, dict)
        and s.get("tool") not in deferred
        and s.get("tool") != "approval_workflow"
    ]
    proposed_deferred = [
        s["tool"] for s in revised_plan
        if isinstance(s, dict) and s.get("tool") in deferred
    ]

    has_corrections = bool(proposed_corrections)
    review_status = "corrections_proposed" if has_corrections else "notification_pending"

    if has_corrections:
        description = (
            f"{tier} risk: {len(tool_results)} tools executed "
            f"({len(succeeded)} OK, {len(failed_tools)} failed). "
            f"Reflection identified {len(proposed_corrections)} corrective action(s): "
            f"{', '.join(proposed_corrections)}. Notification pending approval."
        )
    else:
        description = (
            f"{tier} risk: {len(tool_results)} tools executed "
            f"({len(succeeded)} OK, {len(failed_tools)} failed). "
            f"No corrective actions needed — notification pending approval."
        )

    record = {
        # thread_id IS the approval_id.
        "approval_id": thread_id,
        "thread_id": thread_id,
        "shipment_id": ri.get("shipment_id", ""),
        "window_id": ri.get("window_id"),
        "container_id": ri.get("container_id"),
        "action_description": description,
        "risk_tier": tier,
        "urgency": "immediate" if tier == "CRITICAL" else (
            "urgent" if tier == "HIGH" else "standard"
        ),
        "proposed_actions": [
            s.get("tool") for s in revised_plan
            if isinstance(s, dict) and s.get("tool") != "approval_workflow"
        ],
        "proposed_corrections": proposed_corrections,
        "proposed_deferred": proposed_deferred,
        "first_pass_tools": succeeded + failed_tools,
        "review_status": review_status,
        "justification": state.get("llm_reasoning", "Post-execution review required"),
        "requested_by": "orchestrator",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "decided_at": None,
        "decided_by": None,
        "decision": None,
        # NOTE: full state lives in the LangGraph checkpoint.
        # Call get_orchestrator_state(thread_id) to read it.
    }
    _PENDING_APPROVALS[thread_id] = record
    logger.info(
        "CHECKPOINT_APPROVAL  thread=%s tier=%s corrections=%d deferred=%d",
        thread_id, tier, len(proposed_corrections), len(proposed_deferred),
    )


# human review node

def human_review(state: OrchestratorState) -> dict:
    # runs after the human has decided and the graph resumes from checkpoint.
    thread_id = state.get("thread_id", "")
    human_decision = state.get("human_decision", "approved")
    decided_by = state.get("human_decided_by", "operator")

    from tools.approval_workflow import _PENDING_APPROVALS
    record = _PENDING_APPROVALS.get(thread_id, {})
    review_status = record.get("review_status", "approved")

    if record:
        record["status"] = human_decision
        record["decided_at"] = datetime.now(timezone.utc).isoformat()
        record["decided_by"] = decided_by
        record["decision"] = human_decision

    ri = state.get("risk_input", {})
    tier = ri.get("risk_tier", "MEDIUM")

    logger.info(
        "HUMAN_REVIEW  tier=%s decision=%s decided_by=%s thread=%s",
        tier, human_decision, decided_by, thread_id,
    )
    return {
        "requires_approval": True,
        "awaiting_approval": False,      
        "approval_reason": record.get("action_description", ""),
        "approval_id": thread_id,
        "review_status": review_status,
    }


# build graph

def _timed(node_name: str, fn):
    # Wrap a top-level LangGraph node function to record its wall-clock
    def wrapper(state: OrchestratorState) -> dict:
        t0 = time.perf_counter()
        result = fn(state)
        latency_ms = (time.perf_counter() - t0) * 1000
        if result is None:
            result = {}
        result["node_latencies"] = {node_name: round(latency_ms, 1)}
        return result
    wrapper.__name__ = fn.__name__ if hasattr(fn, "__name__") else node_name
    return wrapper


def build_orchestrator() -> StateGraph:
    # multi-agent, self-correcting, always-review orchestration graph.

    graph = StateGraph(OrchestratorState)

    plan_node    = get_plan_node()
    reflect_node = get_reflect_node()
    revise_node  = get_revise_node()

    # core pipeline nodes
    graph.add_node("interpret",           _timed("interpret", interpret_risk))
    graph.add_node("plan",                _timed("plan", plan_node))

    # multi-agent execution layer
    graph.add_node("prepare_execution",   _timed("prepare_execution", prepare_execution))

    # wave-1 specialist subgraphs (run in parallel via Send()) — NOT timed (subgraphs)
    graph.add_node("compliance_subgraph",    compliance_compiled)
    graph.add_node("cold_storage_subgraph",  cold_storage_compiled)
    graph.add_node("route_subgraph",         route_compiled)
    graph.add_node("merge_wave1",            _timed("merge_wave1", merge_wave1))

    # Wave-2 specialist subgraphs (run in parallel via Send(), enriched inputs)
    graph.add_node("financial_subgraph",     financial_compiled)
    graph.add_node("scheduling_subgraph",    scheduling_compiled)
    graph.add_node("merge_wave2",            _timed("merge_wave2", merge_wave2))

    # reflection / correction loop
    graph.add_node("reflect",      _timed("reflect", reflect_node))
    graph.add_node("revise",       _timed("revise", revise_node))
    graph.add_node("re_execute",   _timed("re_execute", re_execute))

    # HITL gate
    graph.add_node("human_review", _timed("human_review", human_review))
    graph.add_node("fallback",     _timed("fallback", build_fallback))
    graph.add_node("output",       _timed("output", compile_output))

    # entry + tier routing
    graph.set_entry_point("interpret")
    graph.add_edge("interpret", "plan")
    graph.add_conditional_edges(
        "plan",
        skip_if_low,
        {"output": "output", "execute": "prepare_execution"},
    )

    # wave-1 fan-out -> fan-in
    graph.add_conditional_edges("prepare_execution", dispatch_wave1)
    # Static fan-in edges: each wave-1 subgraph flows into merge_wave1
    # LangGraph waits for ALL dispatched branches before firing merge_wave1.
    graph.add_edge("compliance_subgraph",   "merge_wave1")
    graph.add_edge("cold_storage_subgraph", "merge_wave1")
    graph.add_edge("route_subgraph",        "merge_wave1")

    # wave-2 fan-out -> fan-in
    graph.add_conditional_edges("merge_wave1", dispatch_wave2)
    graph.add_edge("financial_subgraph",    "merge_wave2")
    graph.add_edge("scheduling_subgraph",   "merge_wave2")

    # reflection / self-correction loop
    graph.add_edge("merge_wave2", "reflect")
    graph.add_conditional_edges(
        "reflect", should_revise,
        {"revise": "revise", "human_review": "human_review"},
    )
    graph.add_conditional_edges(
        "revise", should_replan,
        {"re_execute": "re_execute", "human_review": "human_review"},
    )
    graph.add_edge("re_execute", "reflect")

    # HITL -> output
    graph.add_edge("human_review", "fallback")
    graph.add_edge("fallback",     "output")
    graph.add_edge("output",       END)

    return graph


_compiled = None
_last_provider = None


def get_compiled():
    # compiled graph with checkpointer and HITL interrupt


    global _compiled, _last_provider
    current = get_provider_name()
    if _compiled is None or current != _last_provider:
        _compiled = build_orchestrator().compile(
            checkpointer=get_checkpointer(),
            interrupt_before=["human_review"],
        )
        _last_provider = current
    return _compiled


# async orchestrator (primary path, used by FastAPI endpoints)

async def run_orchestrator_async(risk_input: Dict[str, Any]) -> Dict[str, Any]:
    # async entry point with checkpoint-based HITL.
    
    thread_id = (
        f"{risk_input.get('shipment_id', 'SHP')}"
        f"_{risk_input.get('window_id', 'WIN')}"
        f"_{int(time.time() * 1000)}"
    )
    config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    app = get_compiled()

    initial: OrchestratorState = {
        "risk_input": risk_input,
        "replan_count": 0,
        "thread_id": thread_id,
        "run_started_at": datetime.now(timezone.utc).isoformat(),
    }

    await app.ainvoke(initial, config=config)

    # Read back the checkpoint to determine whether we paused or finished.
    state = await app.aget_state(config)

    if state.next and "human_review" in state.next:
        # Graph is paused —> register the approval and return a summary.
        _register_approval_from_checkpoint(state.values, thread_id)
        return _build_paused_decision(state, thread_id)

    return state.values.get("final_output", {})


def _build_paused_decision(state, thread_id: str) -> Dict[str, Any]:
    # Build a decision summary dict for a run paused at human_review.
    ri = state.values.get("risk_input", {})
    tool_results = state.values.get("tool_results", [])
    return {
        "shipment_id": ri.get("shipment_id"),
        "window_id": ri.get("window_id"),
        "container_id": ri.get("container_id"),
        "risk_tier": ri.get("risk_tier"),
        "thread_id": thread_id,
        "approval_id": thread_id,
        "awaiting_approval": True,
        "requires_approval": True,
        "status": "awaiting_human_review",
        "actions_taken": tool_results,
        "reflection_notes": state.values.get("reflection_notes", []),
        "revised_plan": state.values.get("revised_plan", []),
        "draft_plan": state.values.get("draft_plan", []),
        "llm_reasoning": state.values.get("llm_reasoning", ""),
        "cascade_context": state.values.get("cascade_context", {}),
        "replan_count": state.values.get("replan_count", 0),
        "decision_summary": (
            f"Graph paused at human_review — "
            f"{len(tool_results)} tool(s) executed. "
            f"Awaiting operator decision."
        ),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


async def resume_orchestrator(
    thread_id: str,
    human_decision: str = "approved",
    decided_by: str = "operator",
) -> Dict[str, Any]:
    # resume the paused graph after human review. Human decision injected directly into checkpoint

    config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    app = get_compiled()

    # patch the checkpoint with the operator's decision before resuming.
    await app.aupdate_state(
        config,
        {"human_decision": human_decision, "human_decided_by": decided_by},
    )

    # resume —> None input means "pick up from the saved checkpoint".
    await app.ainvoke(None, config=config)

    state = await app.aget_state(config)
    return state.values.get("final_output", {})



# Maps wave-1/wave-2 specialist subgraph node names to their agent_name,
_SUBGRAPH_AGENT_NAMES = {
    "compliance_subgraph":   "compliance_agent",
    "cold_storage_subgraph": "cold_storage_agent",
    "route_subgraph":        "route_agent",
    "financial_subgraph":    "insurance_agent",
    "scheduling_subgraph":   "scheduling_agent",
}

# Top-level orchestrator nodes whose start/end we surface as node_start/node_end.
_TOP_LEVEL_NODES = {
    "interpret", "plan", "prepare_execution", "merge_wave1", "merge_wave2",
    "reflect", "revise", "re_execute", "human_review", "fallback", "output",
}


async def stream_orchestration(risk_input: Dict[str, Any], send) -> Dict[str, Any]:
    # Run one orchestration and stream every event to `send` as it happens.
    thread_id = (
        f"{risk_input.get('shipment_id', 'SHP')}"
        f"_{risk_input.get('window_id', 'WIN')}"
        f"_{int(time.time() * 1000)}"
    )
    config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    app = get_compiled()

    initial: OrchestratorState = {
        "risk_input": risk_input,
        "replan_count": 0,
        "thread_id": thread_id,
        "run_started_at": datetime.now(timezone.utc).isoformat(),
    }

    async for event in app.astream_events(initial, config=config, version="v2"):
        kind = event.get("event")
        name = event.get("name", "")
        data = event.get("data", {})

        try:
            if kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                token = getattr(chunk, "content", "") if chunk is not None else ""
                if token:
                    await send({"type": "agent_thinking", "node": name, "token": token})

            elif kind == "on_chain_start" and name in _SUBGRAPH_AGENT_NAMES:
                await send({
                    "type": "agent_dispatch",
                    "agent": _SUBGRAPH_AGENT_NAMES[name],
                    "node": name,
                })

            elif kind == "on_chain_start" and name in _TOP_LEVEL_NODES:
                await send({"type": "node_start", "node": name})

            elif kind == "on_chain_end" and name in _SUBGRAPH_AGENT_NAMES:
                output = data.get("output") or {}
                results = output.get("agent_results", []) if isinstance(output, dict) else []
                result = results[-1] if results else {}
                await send({
                    "type": "tool_result",
                    "agent": _SUBGRAPH_AGENT_NAMES[name],
                    "node": name,
                    "success": result.get("success"),
                    "confidence": result.get("confidence"),
                    "reasoning": result.get("reasoning"),
                    "tool_result": result.get("tool_result"),
                })

            elif kind == "on_chain_end" and name in _TOP_LEVEL_NODES:
                output = data.get("output") or {}
                if isinstance(output, dict):
                    for msg in output.get("agent_message_log", []):
                        await send({"type": "agent_message", **msg})
                    await send({
                        "type": "node_end",
                        "node": name,
                        "keys": list(output.keys()),
                    })
                else:
                    await send({"type": "node_end", "node": name, "keys": []})
        except Exception as exc:
            logger.warning("stream_orchestration: error handling event %s/%s: %s",
                           kind, name, exc)

    # Run finished — distinguish "awaiting human review" from "completed".
    state = await app.aget_state(config)

    if state.next and "human_review" in state.next:
        _register_approval_from_checkpoint(state.values, thread_id)
        decision = _build_paused_decision(state, thread_id)
        ri = state.values.get("risk_input", {})
        await send({
            "type": "run_complete",
            "status": "awaiting_human_review",
            "thread_id": thread_id,
            "approval_id": thread_id,
            "shipment_id": ri.get("shipment_id"),
            "window_id": ri.get("window_id"),
            "risk_tier": ri.get("risk_tier"),
            "decision": decision,
        })
    else:
        decision = state.values.get("final_output", {})
        await send({
            "type": "run_complete",
            "status": "completed",
            "thread_id": thread_id,
            "final_output": decision,
            "decision": decision,
        })

    return decision


async def get_orchestrator_state(thread_id: str) -> Dict[str, Any]:
    # read the full checkpoint state for a thread_id.

    config: Dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    app = get_compiled()
    try:
        state = await app.aget_state(config)
        return dict(state.values) if state and state.values else {}
    except Exception as exc:
        logger.warning("get_orchestrator_state(%s) failed: %s", thread_id, exc)
        return {}


# sync run_orchestrator kept for backwards compatibility

def run_orchestrator(risk_input: Dict[str, Any]) -> Dict[str, Any]:
    # synchronous entry point: runs graph without checkpointing. Kept for backwards compatibility (pipeline.py, notebooks, tests).

    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Inside an async context (e.g. called from a sync endpoint in
            # FastAPI's threadpool) — use run_in_executor to avoid nest_asyncio.
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(asyncio.run, run_orchestrator_async(risk_input))
                return future.result()
        return loop.run_until_complete(run_orchestrator_async(risk_input))
    except RuntimeError:
        return asyncio.run(run_orchestrator_async(risk_input))


def run_orchestrator_selective(
    risk_input: Dict[str, Any],
    selected_tools: list[str],
) -> Dict[str, Any]:
    # Execute only the human-selected tools -- bypasses plan/reflect/revise.
    from orchestrator.nodes import (
        interpret_risk, execute, build_fallback, compile_output, _build_tool_input,
    )
    from orchestrator.state import PlanStep

    plan_steps = []
    for i, tool_name in enumerate(selected_tools, 1):
        if tool_name in TOOL_MAP:
            plan_steps.append(PlanStep(
                step=i, action=f"Execute {tool_name} (human-selected)",
                tool=tool_name,
                tool_input=_build_tool_input(tool_name, risk_input, {"risk_input": risk_input}),
                reason="Selected by human operator",
            ))

    state: OrchestratorState = {
        "risk_input": risk_input,
        "replan_count": 0,
        "draft_plan": plan_steps,
        "active_plan": plan_steps,
        "plan_revised": True,
        "reflection_notes": ["Human-selected tools."],
        "llm_reasoning": "Plan constructed by human operator via tool selection UI.",
        "deferred_tools": [],
    }

    state.update(interpret_risk(state))
    state.update(execute(state))

    observe_node = get_observe_node()
    state.update(observe_node(state))

    state.update(build_fallback(state))
    state.update(compile_output(state))

    return state.get("final_output", {})


def get_graph_mermaid() -> str:
    # Compile without checkpointer for diagram only — avoids async setup.
    return build_orchestrator().compile().get_graph().draw_mermaid()


def get_mode() -> Dict[str, str]:
    return {
        "mode": "agentic" if get_llm() is not None else "deterministic",
        "provider": get_provider_name(),
        "model": get_model_name(),
    }


from tools import TOOL_MAP

# LangGraph Cloud entry point — must be a module-level callable that returns a CompiledGraph. 
compiled = get_compiled
