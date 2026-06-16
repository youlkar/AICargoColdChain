# Agent Quality Platform - guardrails.
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, TypedDict

from pydantic import BaseModel, ConfigDict, ValidationError

logger = logging.getLogger(__name__)


class GuardrailFinding(TypedDict):
    check: str           
    severity: str         
    passed: bool          
    agent: Optional[str]
    message: str
    details: Dict[str, Any]
    timestamp: str


def _finding(
    check: str,
    severity: str,
    passed: bool,
    message: str,
    agent: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> GuardrailFinding:
    # Build a GuardrailFinding with a timestamp.
    return GuardrailFinding(
        check=check,
        severity=severity,
        passed=passed,
        agent=agent,
        message=message,
        details=details or {},
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def _extract_json(text: str) -> dict:
    # Extract JSON from LLM response that may contain markdown fences.
    text = text.strip()
    m = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    start = -1
    return {}


# Structured output models
# Extra="allow" so unrecognized fields the LLM adds don't fail validation.

class PlanStepModel(BaseModel):
    model_config = ConfigDict(extra="allow")
    step: int = 0
    action: str = ""
    tool: str
    tool_input: Dict[str, Any] = {}
    reason: str = ""


class AssessmentOutput(BaseModel):
    model_config = ConfigDict(extra="allow")
    reasoning: str = ""
    steps: List[PlanStepModel] = []
    requires_approval: bool = False
    approval_reason: str = ""


class ReflectionOutput(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: List[str] = []
    has_gaps: bool = False
    overall_assessment: str = ""


class RevisionOutput(BaseModel):
    model_config = ConfigDict(extra="allow")
    corrective_reasoning: str = ""
    steps: List[PlanStepModel] = []


# Structured output validation

def validate_structured_output(
    parsed: dict,
    model_cls: type[BaseModel],
    llm: Any,
    messages: List[Dict[str, str]],
    node_name: str,
) -> Tuple[Optional[BaseModel], List[GuardrailFinding]]:
    # Validate `parsed` (a dict from _extract_json) against `model_cls`. 
    try:
        return model_cls.model_validate(parsed), []
    except ValidationError as exc:
        logger.warning(
            "GUARDRAIL  %s: structured output failed validation (attempt 1): %s",
            node_name, exc,
        )

    # Retry once with a corrective follow-up message.
    schema_fields = list(model_cls.model_fields.keys())
    retry_messages = messages + [
        {"role": "assistant", "content": json.dumps(parsed)},
        {
            "role": "user",
            "content": (
                f"Your last response was not valid JSON matching the required "
                f"schema (fields: {schema_fields}). Respond again with ONLY "
                f"corrected JSON matching that schema."
            ),
        },
    ]

    try:
        retry_response = llm.invoke(retry_messages)
        retry_parsed = _extract_json(retry_response.content)
        return model_cls.model_validate(retry_parsed), []
    except (ValidationError, Exception) as exc:
        logger.warning(
            "GUARDRAIL  %s: structured output failed validation (attempt 2, falling back): %s",
            node_name, exc,
        )
        finding = _finding(
            check="structured_output_invalid",
            severity="warning",
            passed=False,
            agent=node_name,
            message=f"LLM output for {node_name} failed schema validation after retry; using deterministic fallback.",
            details={"raw": str(parsed)[:500]},
        )
        return None, [finding]


# Confidence-gated autonomy

CARGO_MIN_CONFIDENCE = float(os.environ.get("CARGO_MIN_CONFIDENCE", "0.6"))


def check_confidence_gate(agent_result: Dict[str, Any]) -> List[GuardrailFinding]:
    # If AgentResult.confidence < CARGO_MIN_CONFIDENCE, emit a low_confidence
    confidence = agent_result.get("confidence", 1.0)
    if confidence is None or confidence >= CARGO_MIN_CONFIDENCE:
        return []

    agent_name = agent_result.get("agent_name", "unknown")
    agent_result["needs_escalation"] = True
    existing_reason = agent_result.get("escalation_reason") or ""
    low_conf_reason = f"confidence {confidence:.2f} below threshold {CARGO_MIN_CONFIDENCE:.2f}"
    agent_result["escalation_reason"] = (
        f"{existing_reason}; {low_conf_reason}" if existing_reason else low_conf_reason
    )

    return [_finding(
        check="low_confidence",
        severity="critical",
        passed=False,
        agent=agent_name,
        message=f"{agent_name} returned confidence {confidence:.2f}, below CARGO_MIN_CONFIDENCE={CARGO_MIN_CONFIDENCE:.2f}.",
        details={"confidence": confidence, "threshold": CARGO_MIN_CONFIDENCE},
    )]


# Reasoning / consistency checks

_FACILITY_CLAIM_RE = re.compile(r"\b(facility found|reassign(?:ed|ment)?|relocat(?:e|ed|ion))\b", re.IGNORECASE)
_ROUTE_CLAIM_RE = re.compile(r"\b(route|carrier)\s+(?:was\s+)?(?:selected|chosen|reassigned|rerouted)\b", re.IGNORECASE)
_NO_MATCH_CLAIM_RE = re.compile(r"\bno\s+(?:regulatory\s+)?match(?:es)?\b", re.IGNORECASE)
_MATCH_CLAIM_RE = re.compile(r"\bregulator(?:y|ies)?\s+match(?:es)?\b|\bmatched\b", re.IGNORECASE)


def _check_cold_storage(reasoning: str, tool_result: Dict[str, Any]) -> Optional[str]:
    facility = tool_result.get("recommended_facility") or tool_result.get("facility_name")
    if _FACILITY_CLAIM_RE.search(reasoning) and not facility:
        return "reasoning claims a facility was found/reassigned, but tool_result has no facility_name/recommended_facility"
    return None


def _check_route(reasoning: str, tool_result: Dict[str, Any]) -> Optional[str]:
    route = tool_result.get("selected_route") or tool_result.get("recommended_route")
    if _ROUTE_CLAIM_RE.search(reasoning) and not route:
        return "reasoning claims a route/carrier was selected, but tool_result has no selected_route/recommended_route"
    return None


def _check_compliance(reasoning: str, tool_result: Dict[str, Any]) -> Optional[str]:
    matches = tool_result.get("matches") or tool_result.get("regulations_checked")
    if _MATCH_CLAIM_RE.search(reasoning) and not matches:
        return "reasoning claims a regulatory match, but tool_result has no matches/regulations_checked"
    if _NO_MATCH_CLAIM_RE.search(reasoning) and matches:
        return "reasoning claims no regulatory match, but tool_result.matches/regulations_checked is non-empty"
    return None


def _check_insurance(reasoning: str, tool_result: Dict[str, Any]) -> Optional[str]:
    estimated = tool_result.get("estimated_loss")
    if estimated is None:
        estimated = tool_result.get("estimated_loss_usd")
    if estimated is None:
        return None
    amounts = re.findall(r"\$?([\d,]+(?:\.\d+)?)", reasoning)
    for raw in amounts:
        try:
            cited = float(raw.replace(",", ""))
        except ValueError:
            continue
        if cited == 0:
            continue
        # tolerance: 1%
        if abs(cited - float(estimated)) / max(abs(float(estimated)), 1e-9) > 0.01:
            return (
                f"reasoning cites amount {cited}, which does not match "
                f"tool_result.estimated_loss(_usd)={estimated} (tolerance 1%)"
            )
    return None


_CONSISTENCY_CHECKS = {
    "cold_storage_agent": _check_cold_storage,
    "route_agent": _check_route,
    "compliance_agent": _check_compliance,
    "insurance_agent": _check_insurance,
}


def check_reasoning_consistency(agent_result: Dict[str, Any]) -> List[GuardrailFinding]:
    # Run the per-agent-type consistency check, if one is registered.
    agent_name = agent_result.get("agent_name", "")
    check_fn = _CONSISTENCY_CHECKS.get(agent_name)
    if check_fn is None:
        return []

    reasoning = agent_result.get("reasoning") or ""
    tool_result = agent_result.get("tool_result") or {}
    if not reasoning or not isinstance(tool_result, dict):
        return []

    issue = check_fn(reasoning, tool_result)
    if issue is None:
        return []

    return [_finding(
        check="reasoning_inconsistency",
        severity="warning",
        passed=False,
        agent=agent_name,
        message=f"{agent_name}: {issue}",
        details={"reasoning": reasoning[:300], "tool_result_keys": list(tool_result.keys())},
    )]


# Routing helper

def has_blocking_finding(findings: List[GuardrailFinding]) -> bool:
    # True if any finding is severity=critical or check=low_confidence and not yet passed. Used by graph.py routing functions to force human_review regardless of risk tier.
    for f in findings or []:
        if not isinstance(f, dict):
            continue
        if f.get("passed"):
            continue
        if f.get("severity") == "critical" or f.get("check") == "low_confidence":
            return True
    return False


# Action rate limiting

CARGO_MAX_ACTIONS_PER_HOUR = int(os.environ.get("CARGO_MAX_ACTIONS_PER_HOUR", "3"))


def check_action_rate(shipment_id: str, tool_name: str) -> List[GuardrailFinding]:
    # If `tool_name` has fired >= CARGO_MAX_ACTIONS_PER_HOUR times for `shipment_id` in the last hour, return a critical rate_limit_exceeded finding. 
    from src.supabase_client import count_recent_agent_actions

    count = count_recent_agent_actions(shipment_id, tool_name, hours=1)
    if count < CARGO_MAX_ACTIONS_PER_HOUR:
        return []

    return [_finding(
        check="rate_limit_exceeded",
        severity="critical",
        passed=False,
        agent=tool_name,
        message=(
            f"{tool_name} has run {count} times for shipment {shipment_id} in the "
            f"last hour (limit {CARGO_MAX_ACTIONS_PER_HOUR}); skipping and escalating."
        ),
        details={"shipment_id": shipment_id, "tool": tool_name, "count": count,
                 "limit": CARGO_MAX_ACTIONS_PER_HOUR},
    )]


# Input / PII safety checks

_INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions", re.IGNORECASE),
    re.compile(r"disregard\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts?)", re.IGNORECASE),
    re.compile(r"system\s+prompt", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+", re.IGNORECASE),
    re.compile(r"new\s+instructions?\s*:", re.IGNORECASE),
]

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\b(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
_SSN_RE = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")


def check_prompt_injection(text: str) -> bool:
    # True if `text` matches a known prompt-injection pattern.
    if not text:
        return False
    return any(p.search(text) for p in _INJECTION_PATTERNS)


def redact_pii(text: str) -> Tuple[str, bool]:
    # Replace email/phone/SSN-like substrings with [REDACTED].
    if not text:
        return text, False
    redacted = _SSN_RE.sub("[REDACTED]", text)
    redacted = _EMAIL_RE.sub("[REDACTED]", redacted)
    redacted = _PHONE_RE.sub("[REDACTED]", redacted)
    return redacted, redacted != text
