
# Shared state type and emit helper for all specialist subgraphs.
# Each specialist follows the same 3-node loop: call tool, assess, retry or done.

from __future__ import annotations

from typing import Any, Dict, List, Optional
from typing_extensions import TypedDict

from orchestrator.protocol import AgentResult


class AgentState(TypedDict, total=False):
    # State passed to each specialist subgraph using Send(). 
    # Injected by dispatcher.
    risk_input: Dict[str, Any]
    cascade_context: Dict[str, Any]   # wave-1 results available to wave-2 agents.

    # Internal agent state.
    tool_input: Dict[str, Any]
    tool_result: Dict[str, Any]
    success: bool
    retry_count: int
    confidence: float
    reasoning: str
    needs_escalation: bool
    escalation_reason: Optional[str]

    # Output collected by parent using Annotated reducer.
    agent_results: List[Dict[str, Any]]


def make_agent_result(
    agent_name: str,
    tool: str,
    state: AgentState,
    wave: int = 1,
) -> AgentResult:
    # Package the final subgraph state into an AgentResult for the parent graph.
    return AgentResult(
        agent_name=agent_name,
        tool=tool,
        tool_input=state.get("tool_input", {}),
        tool_result=state.get("tool_result", {}),
        success=state.get("success", False),
        confidence=state.get("confidence", 0.0),
        reasoning=state.get("reasoning", ""),
        retry_count=state.get("retry_count", 0),
        needs_escalation=state.get("needs_escalation", False),
        escalation_reason=state.get("escalation_reason"),
        wave=wave,
    )


def increment_retry(state: AgentState) -> dict:
    # Shared retry-counter node — wired between assess and call_tool on retry path.
    return {"retry_count": state.get("retry_count", 0) + 1}
