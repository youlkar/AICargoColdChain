import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from tools.cold_storage_agent import _score_facility

FACILITY = {
    "airport_code": "LHR",
    "city": "London",
    "location": "London Heathrow (LHR)",
    "current_occupancy_pct": 50,
    "min_advance_notice_hours": 0,
    "certifications": ["GDP"],
    "temp_range_supported": "-25C to -15C",
    "accepts_emergency_delivery": True,
}

PROFILES = {"frozen-pharma": {"temp_low": -25.0, "temp_high": -15.0}}


def _score(location_hint):
    return _score_facility(
        facility_record=FACILITY,
        product_id="frozen-pharma",
        location_hint=location_hint,
        hours_to_breach=None,
        urgency="normal",
        profiles=PROFILES,
    )


def test_exact_airport_code_match_scores_high():
    result = _score("LHR")
    assert "Proximity=1.00" in result["suitability_reason"]


def test_different_airport_code_scores_zero():
    result = _score("JFK")
    assert "Proximity=0.00" in result["suitability_reason"]


def test_non_geo_transit_phase_hint_is_neutral_not_penalized():
    """Regression: transit_phase strings like 'air_handoff' used to be treated
    as a proximity mismatch (0.0), unfairly tanking confidence on runs that
    simply hadn't assigned a facility yet."""
    result = _score("air_handoff")
    assert "Proximity=0.50" in result["suitability_reason"]


def test_missing_hint_is_neutral_not_penalized():
    result = _score(None)
    assert "Proximity=0.50" in result["suitability_reason"]


def test_non_airport_shaped_hint_is_neutral():
    """location_hint is only ever a 3-letter airport code or a transit_phase
    string upstream — never a city name — so anything else (e.g. a 6-letter
    word) gets the same neutral treatment as a missing hint."""
    result = _score("LONDON")
    assert "Proximity=0.50" in result["suitability_reason"]
