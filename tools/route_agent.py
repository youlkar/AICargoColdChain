"""
Route Agent — context-aware route recommendation.

Selects an alternative route based on:
  - product temperature class (frozen / refrigerated / CRT)
  - preferred_mode if specified
  - reason/urgency signal
  - real origin/destination from Supabase shipments table

Reads real product data from product_profiles.json to determine the
appropriate carrier certification class.  When a shipments table row
is available in Supabase, the route agent uses the actual origin and
destination to generate context-aware LLM recommendations.

Author: Mukul Ray (ray/agents-final), integrated by Rahul
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from orchestrator.llm_provider import get_llm

logger = logging.getLogger(__name__)

_BASE = Path(__file__).resolve().parent.parent
_PROFILES_PATH = _BASE / "data" / "product_profiles.json"

_profiles_cache: Optional[dict] = None

_WEATHER_CACHE_TTL_S = 600  # 10 minutes
_weather_cache: Dict[tuple, tuple] = {}  # (lat, lon) -> (fetched_at, data)


def _load_profiles() -> dict:
    global _profiles_cache
    if _profiles_cache is None:
        try:
            from src.supabase_client import load_profiles_with_fallback
            _profiles_cache = load_profiles_with_fallback()
        except Exception:
            with open(_PROFILES_PATH) as f:
                _profiles_cache = json.load(f)
    return _profiles_cache


def _fetch_shipment_route(shipment_id: str) -> Optional[Dict[str, Any]]:
    """Fetch origin, destination, mode, carrier from the Supabase shipments table."""
    try:
        from src.supabase_client import fetch_shipment_by_id
        row = fetch_shipment_by_id(shipment_id)
        if row and row.get("origin"):
            return {
                "origin": row.get("origin", ""),
                "destination": row.get("destination", ""),
                "transport_mode": row.get("transport_mode", ""),
                "carrier": row.get("carrier", ""),
                "ambient_temp_c": row.get("ambient_temp_c"),
                "weather_condition": row.get("weather_condition"),
                "flight_delay_prob": row.get("flight_delay_prob"),
                "origin_lat": row.get("origin_lat"),
                "origin_lon": row.get("origin_lon"),
            }
    except Exception as e:
        logger.debug("shipment route lookup failed for %s: %s", shipment_id, e)
    return None


def _fetch_live_weather(lat: float, lon: float) -> Optional[Dict[str, Any]]:
    """
    Live current-weather lookup from OpenWeatherMap for (lat, lon).
    Returns None on any failure (missing key, timeout, bad response) —
    never raises. Caller falls back to the shipment's static weather field.
    """
    api_key = os.environ.get("OPENWEATHERMAP_API_KEY")
    if not api_key:
        return None

    cache_key = (round(lat, 1), round(lon, 1))
    cached = _weather_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < _WEATHER_CACHE_TTL_S:
        return cached[1]

    try:
        resp = httpx.get(
            "https://api.openweathermap.org/data/2.5/weather",
            params={"lat": lat, "lon": lon, "appid": api_key, "units": "metric"},
            timeout=4.0,
        )
        resp.raise_for_status()
        payload = resp.json()
        data = {
            "weather_condition": (payload.get("weather") or [{}])[0].get("main", "").lower(),
            "ambient_temp_c": payload.get("main", {}).get("temp"),
            "wind_speed_ms": payload.get("wind", {}).get("speed"),
        }
        _weather_cache[cache_key] = (time.time(), data)
        return data
    except Exception as exc:
        logger.warning("Live weather fetch failed for (%s, %s): %s", lat, lon, exc)
        return None


def _get_temp_class(product_id: str) -> str:
    """
    Returns one of: 'frozen', 'refrigerated', 'crt'
    based on the product's safe temp range from product_profiles.json.
    """
    profiles = _load_profiles()
    profile = profiles.get(product_id, {})
    temp_high = float(profile.get("temp_high", 8))

    if temp_high <= 0:
        return "frozen"
    if temp_high <= 15:
        return "refrigerated"
    return "crt"


_ROUTE_TABLE = {
    "frozen": {
        "air": [
            ("ANC→ORD (air, ultra-cold certified)", "Atlas Air Cold Chain", -5),
            ("FRA→JFK (air, dry-ice certified)", "Cargolux CoolChain", -4),
        ],
        "road": [
            ("Chicago→NYC (cryogenic road freight)", "Cold Chain Direct", 2),
        ],
        "default": [
            ("ANC→ORD (air, ultra-cold certified)", "Atlas Air Cold Chain", -5),
            ("FRA→JFK (air, dry-ice certified)", "Cargolux CoolChain", -4),
        ],
    },
    "refrigerated": {
        "air": [
            ("LHR→JFK (air, 2-8C certified)", "British Airways World Cargo", -3),
            ("AMS→ORD (air, pharma lane)", "KLM Cargo CoolCenter", -2),
            ("FRA→MIA (air, GDP-certified)", "Lufthansa Cargo td.Pharma", -4),
        ],
        "road": [
            ("Hub→Destination (GDP road, active reefer)", "DHL Life Sciences", 1),
            ("Regional depot relay (passive PCM box)", "Marken Road", 3),
        ],
        "default": [
            ("LHR→JFK (air, 2-8C certified)", "British Airways World Cargo", -3),
            ("AMS→ORD (air, pharma lane)", "KLM Cargo CoolCenter", -2),
        ],
    },
    "crt": {
        "air": [
            ("CDG→MIA (air standard)", "Air France Cargo", -1),
            ("LHR→ORD (air standard)", "Virgin Atlantic Cargo", -2),
        ],
        "road": [
            ("Hub→Destination (insulated road freight)", "UPS Healthcare", 2),
            ("Regional relay (ambient controlled)", "FedEx Custom Critical", 1),
        ],
        "default": [
            ("CDG→MIA (air standard)", "Air France Cargo", -1),
            ("LHR→ORD (air standard)", "Virgin Atlantic Cargo", -2),
        ],
    },
}


def _candidate_options(temp_class: str, preferred_mode: Optional[str]) -> List[tuple[str, str, int]]:
    class_routes = _ROUTE_TABLE.get(temp_class, _ROUTE_TABLE["refrigerated"])

    mode_key = "default"
    if preferred_mode and preferred_mode.lower() in class_routes:
        mode_key = preferred_mode.lower()

    return list(class_routes[mode_key])


def _select_route_rule_based(temp_class: str, preferred_mode: Optional[str], reason: str) -> dict:
    options = _candidate_options(temp_class, preferred_mode)

    reason_lower = reason.lower()
    if any(word in reason_lower for word in ("urgent", "critical", "immediate", "emergency")):
        options = sorted(options, key=lambda x: x[2])

    route_str, carrier, eta_delta = options[0]
    return {
        "recommended_route": route_str,
        "carrier": carrier,
        "eta_change_hours": eta_delta,
    }


def _response_text(resp: Any) -> str:
    content = getattr(resp, "content", resp)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                parts.append(str(item.get("text", "")))
            else:
                parts.append(str(getattr(item, "text", item)))
        return "\n".join(p for p in parts if p)
    return str(content)


def _extract_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fenced:
        text = fenced.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return {}


def _select_route_llm(
    temp_class: str,
    preferred_mode: Optional[str],
    reason: str,
    product_id: Optional[str],
    shipment_route: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    llm = get_llm()
    if llm is None:
        return None

    options = _candidate_options(temp_class, preferred_mode)
    if not options:
        return None

    option_rows = [
        {
            "index": i,
            "route": route,
            "carrier": carrier,
            "eta_change_hours": eta_delta,
        }
        for i, (route, carrier, eta_delta) in enumerate(options)
    ]

    route_context = ""
    if shipment_route:
        route_context = (
            f"\nActual shipment route from Supabase:\n"
            f"  Origin: {shipment_route.get('origin', 'unknown')}\n"
            f"  Destination: {shipment_route.get('destination', 'unknown')}\n"
            f"  Current mode: {shipment_route.get('transport_mode', 'unknown')}\n"
            f"  Current carrier: {shipment_route.get('carrier', 'unknown')}\n"
            f"  Ambient temp at origin: {shipment_route.get('ambient_temp_c', 'N/A')} C\n"
            f"  Weather: {shipment_route.get('weather_condition', 'N/A')}\n"
            f"  Flight delay probability: {shipment_route.get('flight_delay_prob', 'N/A')}\n"
            f"Consider this real context when selecting the best reroute option.\n"
        )

    prompt = (
        "You are choosing a pharmaceutical cold-chain reroute.\n"
        "Choose exactly one option from the provided candidates only.\n"
        "Prioritize in this order:\n"
        "  1. Product temperature safety (never compromise this)\n"
        "  2. Whether the option's route actually serves the shipment's real destination "
        "(match the destination city/airport given below against each option's route string)\n"
        "  3. Urgency/ETA impact\n"
        "  4. Preferred transport mode\n"
        "Return JSON only: {\"selected_index\": <int>, \"rationale\": \"<1 sentence>\"}\n\n"
        f"Product ID: {product_id or 'unknown'}\n"
        f"Temperature class: {temp_class}\n"
        f"Preferred mode: {preferred_mode or 'auto'}\n"
        f"Reason: {reason}\n"
        f"{route_context}"
        f"Options: {json.dumps(option_rows)}"
    )

    for attempt in range(2):
        try:
            resp = llm.invoke(prompt)
            raw = _response_text(resp)
            payload = _extract_json(raw)
            idx = int(payload.get("selected_index", -1))
            if idx < 0 or idx >= len(option_rows):
                raise ValueError(f"selected_index {idx} out of range for {len(option_rows)} options (raw: {raw[:200]!r})")
            chosen = option_rows[idx]
            return {
                "recommended_route": chosen["route"],
                "carrier": chosen["carrier"],
                "eta_change_hours": chosen["eta_change_hours"],
                "selection_method": "llm",
                "selection_rationale": str(payload.get("rationale", "")).strip(),
            }
        except Exception as exc:
            if attempt == 0:
                logger.info("route_agent LLM selection attempt 1 failed (%s) — retrying with correction", exc)
                prompt = (
                    prompt
                    + "\n\nYour previous response was not valid — it must be exactly "
                    "{\"selected_index\": <int 0 to " + str(len(option_rows) - 1) + ">, \"rationale\": \"<1 sentence>\"} "
                    "with no other text. Respond again, correctly this time."
                )
                continue
            logger.warning("route_agent LLM selection failed after retry: %s", exc)
            return None
    return None


class RouteInput(BaseModel):
    shipment_id: str = Field(description="Shipment to reroute")
    container_id: str = Field(description="Container within the shipment")
    current_leg_id: str = Field(description="Current transport leg")
    reason: str = Field(description="Why rerouting is requested")
    product_id: Optional[str] = Field(
        default=None,
        description="Product ID (e.g. P01, P04) — used to select temp-class appropriate route",
    )
    preferred_mode: Optional[str] = Field(
        default=None,
        description="Preferred transport mode: air, road, or None for auto",
    )


def _execute(
    shipment_id: str,
    container_id: str,
    current_leg_id: str,
    reason: str,
    product_id: Optional[str] = None,
    preferred_mode: Optional[str] = None,
) -> dict:
    temp_class = _get_temp_class(product_id) if product_id else "refrigerated"

    shipment_route = _fetch_shipment_route(shipment_id)
    weather_source = "unavailable"
    if shipment_route:
        logger.info(
            "route_agent: real route %s → %s (mode=%s, carrier=%s)",
            shipment_route["origin"], shipment_route["destination"],
            shipment_route["transport_mode"], shipment_route["carrier"],
        )
        if not preferred_mode and shipment_route.get("transport_mode"):
            preferred_mode = shipment_route["transport_mode"]

        lat, lon = shipment_route.get("origin_lat"), shipment_route.get("origin_lon")
        if lat is not None and lon is not None:
            live_weather = _fetch_live_weather(float(lat), float(lon))
            if live_weather:
                shipment_route["weather_condition"] = live_weather["weather_condition"]
                shipment_route["ambient_temp_c"] = live_weather["ambient_temp_c"]
                weather_source = "live"
            elif shipment_route.get("weather_condition"):
                weather_source = "static"
        elif shipment_route.get("weather_condition"):
            weather_source = "static"

    route = _select_route_llm(temp_class, preferred_mode, reason, product_id, shipment_route)
    if route is None:
        route = {
            **_select_route_rule_based(temp_class, preferred_mode, reason),
            "selection_method": "rule_based",
            "selection_rationale": "Deterministic fallback selected the best candidate from the route table.",
        }

    logger.info(
        "route_agent: shipment=%s product=%s temp_class=%s method=%s -> %s",
        shipment_id, product_id, temp_class, route.get("selection_method"), route["recommended_route"],
    )

    result = {
        "tool": "route_agent",
        "status": "recommendation_generated",
        "shipment_id": shipment_id,
        "container_id": container_id,
        "original_leg": current_leg_id,
        "recommended_route": route["recommended_route"],
        "carrier": route["carrier"],
        "eta_change_hours": route["eta_change_hours"],
        "temp_class": temp_class,
        "reason": reason,
        "selection_method": route.get("selection_method", "rule_based"),
        "selection_rationale": route.get("selection_rationale", ""),
        "requires_approval": True,
        "weather_source": weather_source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    if shipment_route:
        result["actual_origin"] = shipment_route["origin"]
        result["actual_destination"] = shipment_route["destination"]
        result["current_carrier"] = shipment_route["carrier"]
        result["ambient_temp_c"] = shipment_route.get("ambient_temp_c")
        result["weather_condition"] = shipment_route.get("weather_condition")

    return result


route_tool = StructuredTool.from_function(
    func=_execute,
    name="route_agent",
    description=(
        "Recommend an alternative route or carrier for a shipment. "
        "Selects route based on product temperature class (frozen/refrigerated/CRT) "
        "and preferred transport mode. Uses the configured LLM to choose among "
        "safe candidate options, with deterministic fallback. Returns a route option with ETA impact. "
        "Does NOT auto-execute; requires human approval."
    ),
    args_schema=RouteInput,
)

# Phase 3C — register with dynamic tool registry
from tools.registry import REGISTRY, ToolMetadata
REGISTRY.register(route_tool, ToolMetadata(
    name="route_agent",
    wave=1,
    category="logistics",
    applicable_tiers=["HIGH", "CRITICAL"],
    applicable_phases=["air_handoff", "customs_clearance"],
    applicable_products=["*"],
    always_deferred=False,
    description="Alternative route and carrier selection",
))
