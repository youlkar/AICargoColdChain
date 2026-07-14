import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from evals.golden_set import load_golden_set


def test_load_golden_set_returns_cases():
    cases = load_golden_set()
    assert len(cases) >= 4


def test_every_case_has_required_expected_keys():
    cases = load_golden_set()
    for case in cases:
        expected = case["expected"]
        assert "risk_tier" in expected
        assert "min_actions" in expected
        assert "forbidden_actions" in expected
        assert "expected_escalation" in expected


def test_covers_all_four_tiers():
    cases = load_golden_set()
    tiers = {c["expected"]["risk_tier"] for c in cases}
    assert tiers == {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
