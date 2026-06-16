import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from evals.metrics import score_case, aggregate_metrics


# score_case

def _expected(tier="HIGH", min_actions=None, forbidden=None, escalation=True):
    return {
        "risk_tier": tier,
        "min_actions": min_actions or [],
        "forbidden_actions": forbidden or [],
        "expected_escalation": escalation,
    }


def test_score_case_perfect_pass():
    expected = _expected(tier="CRITICAL", min_actions=["compliance_agent"], escalation=True)
    actual = {
        "risk_tier": "CRITICAL",
        "actions_taken": [{"tool": "compliance_agent"}],
        "awaiting_approval": True,
        "guardrail_findings": [],
    }
    result = score_case(expected, actual)
    assert result["passed"] is True
    assert result["tier_correct"] is True
    assert result["action_recall_ok"] is True
    assert result["action_precision_ok"] is True
    assert result["escalation_correct"] is True
    assert result["failure_reasons"] == []


def test_score_case_wrong_tier():
    expected = _expected(tier="HIGH", escalation=False)
    actual = {"risk_tier": "MEDIUM", "actions_taken": [], "guardrail_findings": []}
    result = score_case(expected, actual)
    assert result["passed"] is False
    assert result["tier_correct"] is False
    assert any("risk_tier" in r for r in result["failure_reasons"])


def test_score_case_missing_required_action():
    expected = _expected(tier="HIGH", min_actions=["compliance_agent", "cold_storage_agent"], escalation=True)
    actual = {
        "risk_tier": "HIGH",
        "actions_taken": [{"tool": "compliance_agent"}],
        "awaiting_approval": True,
        "guardrail_findings": [],
    }
    result = score_case(expected, actual)
    assert result["action_recall_ok"] is False
    assert result["passed"] is False
    assert any("cold_storage_agent" in r for r in result["failure_reasons"])


def test_score_case_forbidden_action_present():
    expected = _expected(tier="LOW", forbidden=["cold_storage_agent"], escalation=False)
    actual = {
        "risk_tier": "LOW",
        "actions_taken": [{"tool": "cold_storage_agent"}],
        "guardrail_findings": [],
    }
    result = score_case(expected, actual)
    assert result["action_precision_ok"] is False
    assert result["passed"] is False


def test_score_case_escalation_via_critical_guardrail():
    expected = _expected(tier="CRITICAL", escalation=True)
    actual = {
        "risk_tier": "CRITICAL",
        "actions_taken": [],
        "guardrail_findings": [{"check": "low_confidence", "severity": "critical", "passed": False}],
    }
    result = score_case(expected, actual)
    assert result["escalation_correct"] is True


def test_score_case_unexpected_escalation_fails():
    expected = _expected(tier="LOW", escalation=False)
    actual = {
        "risk_tier": "LOW",
        "actions_taken": [],
        "awaiting_approval": True,
        "guardrail_findings": [],
    }
    result = score_case(expected, actual)
    assert result["escalation_correct"] is False


# aggregate_metrics

def test_aggregate_metrics_all_pass():
    scores = [
        {"passed": True, "tier_correct": True, "action_precision_ok": True, "action_recall_ok": True},
        {"passed": True, "tier_correct": True, "action_precision_ok": True, "action_recall_ok": True},
    ]
    agg = aggregate_metrics(scores)
    assert agg["pass_rate"] == 1.0
    assert agg["tier_accuracy"] == 1.0


def test_aggregate_metrics_partial():
    scores = [
        {"passed": True, "tier_correct": True, "action_precision_ok": True, "action_recall_ok": True},
        {"passed": False, "tier_correct": False, "action_precision_ok": True, "action_recall_ok": False},
        {"passed": False, "tier_correct": True, "action_precision_ok": False, "action_recall_ok": True},
        {"passed": False, "tier_correct": True, "action_precision_ok": True, "action_recall_ok": True},
    ]
    agg = aggregate_metrics(scores)
    assert agg["pass_rate"] == 0.25
    assert agg["tier_accuracy"] == 0.75
    assert agg["action_precision"] == 0.75
    assert agg["action_recall"] == 0.75


def test_aggregate_metrics_empty():
    agg = aggregate_metrics([])
    assert agg["pass_rate"] == 0.0
    assert agg["tier_accuracy"] == 0.0
