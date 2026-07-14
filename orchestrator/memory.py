"""
Cross-run agent memory
Every run reads from and writes to this store. Agents learn from history instead of starting fresh every time. Uses LangGraph's InMemoryStore 
Production swap: use AsyncPostgresStore(SUPABASE_URL) instead
in get_store() — one line change, same interface everywhere.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
# from langgraph.store.postgres import AsyncPostgresStore
# import os

try:
    from langgraph.store.memory import InMemoryStore as _InMemoryStore
    _LANGGRAPH_STORE_AVAILABLE = True
except ImportError:
    _LANGGRAPH_STORE_AVAILABLE = False
    logger.warning("langgraph.store not available — using dict-based fallback store")

# timestamp helper
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class _FallbackStore:
    # minimal dict-based store used when langgraph.store is not installed.

    def __init__(self):
        self._data: Dict[tuple, Dict[str, Any]] = {}

    def put(self, namespace: tuple, key: str, value: dict) -> None:
        ns = self._data.setdefault(namespace, {})
        ns[key] = {"key": key, "value": value, "namespace": namespace}

    def get(self, namespace: tuple, key: str) -> Optional[Any]:
        return self._data.get(namespace, {}).get(key)

    def search(self, namespace: tuple, *, limit: int = 10, **_kwargs) -> List[Any]:
        items = list(self._data.get(namespace, {}).values())
        # Sort newest-first by key (timestamps are used as keys)
        return sorted(items, key=lambda x: x["key"], reverse=True)[:limit]


_store = None


def get_store():
    # return the singleton memory store.

    global _store
    if _store is None:
        if _LANGGRAPH_STORE_AVAILABLE:
            _store = _InMemoryStore()
            logger.info("Memory store: InMemoryStore (in-process). Swap to Postgres for prod.")
        else:
            _store = _FallbackStore()
            logger.info("Memory store: FallbackStore (dict-based fallback)")
    return _store




# namespace: shipment run history

def record_run(
    shipment_id: str,
    thread_id: str,
    tier: str,
    tools_executed: List[str],
    outcome: str,          # "completed" | "escalated" | "awaiting_approval"
    replan_count: int = 0,
) -> None:
    # Write a run summary so the supervisor can detect repeat excursions.
    store = get_store()
    store.put(
        ("shipments", shipment_id),
        key=thread_id,
        value={
            "thread_id": thread_id,
            "tier": tier,
            "tools_executed": tools_executed,
            "outcome": outcome,
            "replan_count": replan_count,
            "timestamp": _now(),
        },
    )
    logger.debug("MEMORY  record_run shipment=%s tier=%s", shipment_id, tier)


def get_run_history(shipment_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    # Return past runs for a shipment, newest first.
    store = get_store()
    items = store.search(("shipments", shipment_id), limit=limit)
    # Normalise: LangGraph Item objects have .value; fallback dicts have ["value"]
    return [_extract_value(i) for i in items]


def count_repeat_excursions(shipment_id: str) -> int:
    # Count how many past HIGH/CRITICAL runs this shipment has had.
    history = get_run_history(shipment_id, limit=20)
    return sum(1 for r in history if r.get("tier") in ("HIGH", "CRITICAL"))


# namespace: compliance outcomes

def record_compliance(
    product_category: str,
    shipment_id: str,
    status: str,
    confidence: float,
    disposition: str,
) -> None:
    store = get_store()
    store.put(
        ("compliance", product_category),
        key=f"{shipment_id}_{_now()}",
        value={
            "shipment_id": shipment_id,
            "status": status,
            "confidence": confidence,
            "disposition": disposition,
            "timestamp": _now(),
        },
    )


def get_compliance_history(product_category: str, limit: int = 5) -> List[Dict[str, Any]]:
    # recent compliance outcomes for this product category.
    store = get_store()
    items = store.search(("compliance", product_category), limit=limit)
    return [_extract_value(i) for i in items]


# Namespace: facility performance

def record_facility(
    facility_id: str,
    shipment_id: str,
    suitability_score: float,
    product_type: str,
    outcome: str = "placed",
) -> None:
    store = get_store()
    store.put(
        ("facilities", facility_id),
        key=f"{shipment_id}_{_now()}",
        value={
            "shipment_id": shipment_id,
            "suitability_score": suitability_score,
            "product_type": product_type,
            "outcome": outcome,
            "timestamp": _now(),
        },
    )


def get_facility_history(facility_id: str, limit: int = 5) -> List[Dict[str, Any]]:
    store = get_store()
    items = store.search(("facilities", facility_id), limit=limit)
    return [_extract_value(i) for i in items]


# namespace: route / carrier performance

def record_route(
    origin: str,
    dest: str,
    shipment_id: str,
    carrier: str,
    success: bool,
    delay_mins: float = 0.0,
) -> None:
    ns_key = f"{origin}__{dest}".replace(" ", "_")
    store = get_store()
    store.put(
        ("routes", ns_key),
        key=f"{shipment_id}_{_now()}",
        value={
            "shipment_id": shipment_id,
            "carrier": carrier,
            "success": success,
            "delay_mins": delay_mins,
            "timestamp": _now(),
        },
    )


def get_route_history(origin: str, dest: str, limit: int = 5) -> List[Dict[str, Any]]:
    ns_key = f"{origin}__{dest}".replace(" ", "_")
    store = get_store()
    items = store.search(("routes", ns_key), limit=limit)
    return [_extract_value(i) for i in items]


# internal helpers

def _extract_value(item: Any) -> Dict[str, Any]:
    # Normalise across LangGraph Item objects and fallback dict records.
    if hasattr(item, "value"):
        return item.value          # LangGraph InMemoryStore Item
    if isinstance(item, dict) and "value" in item:
        return item["value"]       # FallbackStore record
    return item if isinstance(item, dict) else {}
