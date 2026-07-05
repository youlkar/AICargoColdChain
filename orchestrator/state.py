"""
Orchestrator state schema for the act-first, reflect-on-results loop
"""

from __future__ import annotations

import operator
from typing import Annotated, Any, Dict, List, Optional, TypedDict

from orchestrator.guardrails import GuardrailFinding


def _take_last(left: Any, right: Any) -> Any:
    # Reducer: last write wins.
    return right


def _merge_dicts(left: Any, right: Any) -> Any:
    # Reducer: shallow-merge two dicts, right overrides left on key conflicts.
    if not isinstance(left, dict):
        left = {}
    if not isinstance(right, dict):
        return left
    merged = dict(left)
    merged.update(right)
    return merged


class PlanStep(TypedDict):
    step: int
    action: str
    tool: str
    tool_input: Dict[str, Any]
    reason: str


class ToolResult(TypedDict):
    tool: str
    input: Dict[str, Any]
    result: Dict[str, Any]
    success: bool


class OrchestratorState(TypedDict, total=False):
    # Input from risk engine
    risk_input: Annotated[Dict[str, Any], _take_last]

    # Interpretation
    severity: str
    primary_issue: str
    urgency: str

    # Planning
    draft_plan: List[PlanStep]
    llm_reasoning: str

    # First Execution (act-first)
    tool_results: List[ToolResult]
    execution_errors: List[str]
    # Annotated _take_last: see risk_input above -- same parallel-Send issue.
    cascade_context: Annotated[Dict[str, Any], _take_last]
    deferred_tools: List[str]  # tools skipped in first pass (e.g. notification_agent)

    # Post-Execution Reflection
    observation: str
    reflection_notes: List[str]
    needs_revision: bool
    observation_issues: List[str]
    observation_actions: List[str]

    # Revision (corrective plan based on real results)
    revised_plan: List[PlanStep]
    plan_revised: bool
    active_plan: List[PlanStep]

    # Re-Execution
    revised_tool_results: List[ToolResult]
    revised_execution_errors: List[str]

    # Human Review
    requires_approval: bool
    approval_reason: str
    approval_id: Optional[str]
    awaiting_approval: bool
    review_status: str 

    # Fallback
    fallback_plan: List[PlanStep]

    # Populated by prepare_execution from the memory store.
    shipment_run_history: List[Dict[str, Any]]   
    repeat_excursion_count: int                   

    # Multi-agent results
    agent_results: Annotated[List[Dict[str, Any]], operator.add]

    # Agent communication log (Phase 4D)
    agent_message_log: Annotated[List[Dict[str, Any]], operator.add]

    # Loop control
    replan_count: int

    # Checkpoint / HITL 
    thread_id: str
    human_decision: Optional[str]   
    human_decided_by: Optional[str]
    execution_history: List[Dict[str, Any]]

    # Output
    decision_summary: str
    audit_log_summary: str
    confidence: Annotated[float, _take_last]
    final_output: Dict[str, Any]

    # Agent Quality Platform: guardrails & observability
    rate_limited_tools: List[str]
    guardrail_findings: Annotated[List[GuardrailFinding], operator.add]
    node_latencies: Annotated[Dict[str, Any], _merge_dicts]
    token_breakdown: Annotated[Dict[str, Any], _merge_dicts]
    run_started_at: str

    # LangSmith observability — run_id ties this state to the LangSmith trace
    # so human-approval feedback and eval scores can be posted to the same run.
    ls_run_id: Optional[str]
