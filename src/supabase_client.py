"""
Supabase client
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

_BASE = Path(__file__).resolve().parent.parent
load_dotenv(_BASE / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

_client_cache = None

# Connection

def _get_client():
    global _client_cache
    if _client_cache is not None:
        return _client_cache
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _client_cache = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase connected: %s", SUPABASE_URL[:50])
        return _client_cache
    except Exception as e:
        logger.error("Supabase init failed: %s", e)
        return None


def is_available() -> bool:
    return _get_client() is not None


# Window Features (telemetry)

def fetch_window_features(limit: int = 35000) -> Optional[pd.DataFrame]:
    # Fetch from Supabase window_features table → DataFrame (paginated).
    client = _get_client()
    if client is None:
        return None
    try:
        all_rows = []
        page_size = 1000
        offset = 0
        while offset < limit:
            batch = min(page_size, limit - offset)
            resp = (
                client.table("window_features")
                .select("*")
                .range(offset, offset + batch - 1)
                .execute()
            )
            if not resp.data:
                break
            all_rows.extend(resp.data)
            if len(resp.data) < batch:
                break
            offset += batch

        if not all_rows:
            return pd.DataFrame()
        df = pd.DataFrame(all_rows)
        drop_cols = [c for c in ("id", "ingested_at") if c in df.columns]
        if drop_cols:
            df = df.drop(columns=drop_cols)
        for col in ("window_start", "window_end"):
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
                df[col] = df[col].dt.tz_localize(None)
        logger.info("Supabase window_features: %d rows", len(df))
        return df
    except Exception as e:
        logger.error("window_features fetch failed: %s", e)
        return None


def fetch_window_by_id(window_id: str) -> Optional[dict]:
    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("window_features").select("*").eq("window_id", window_id).limit(1).execute()
        return resp.data[0] if resp.data else None
    except Exception as e:
        logger.error("window fetch failed: %s", e)
        return None


def fetch_window_features_by_shipment(shipment_id: str) -> Optional[pd.DataFrame]:
    # Fetch raw telemetry rows for a single shipment (full window history, no scores).
    client = _get_client()
    if client is None:
        return None
    try:
        resp = (
            client.table("window_features")
            .select("*")
            .eq("shipment_id", shipment_id)
            .execute()
        )
        if not resp.data:
            return pd.DataFrame()
        df = pd.DataFrame(resp.data)
        drop_cols = [c for c in ("id", "ingested_at") if c in df.columns]
        if drop_cols:
            df = df.drop(columns=drop_cols)
        for col in ("window_start", "window_end"):
            if col in df.columns:
                df[col] = pd.to_datetime(df[col], errors="coerce", utc=True)
                df[col] = df[col].dt.tz_localize(None)
        return df
    except Exception as e:
        logger.error("window_features fetch by shipment failed: %s", e)
        return None


def count_distinct_shipments() -> Optional[int]:
    # Count distinct shipment_id values in window_features (cheap population count).
    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("window_features").select("shipment_id").execute()
        if resp.data is None:
            return None
        return len({row["shipment_id"] for row in resp.data if row.get("shipment_id")})
    except Exception as e:
        logger.error("distinct shipment count failed: %s", e)
        return None


# Product Profiles

_profiles_cache: Optional[Dict[str, dict]] = None

def fetch_product_profiles() -> Optional[Dict[str, dict]]:
    # Fetch product_profiles → dict keyed by product_id (same shape as local JSON).
    global _profiles_cache
    if _profiles_cache is not None:
        return _profiles_cache

    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("product_profiles").select("*").execute()
        if not resp.data:
            return None
        result = {}
        for row in resp.data:
            pid = row.pop("product_id", None)
            if pid:
                result[pid] = row
        _profiles_cache = result
        logger.info("Supabase product_profiles: %d products", len(result))
        return result
    except Exception as e:
        logger.error("product_profiles fetch failed: %s", e)
        return None


# Product Costs

_costs_cache: Optional[Dict[str, dict]] = None

def fetch_product_costs() -> Optional[Dict[str, dict]]:
    # Fetch product_costs → dict keyed by product_id.
    global _costs_cache
    if _costs_cache is not None:
        return _costs_cache

    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("product_costs").select("*").execute()
        if not resp.data:
            return None
        result = {}
        for row in resp.data:
            pid = row.get("product_id", "")
            if pid:
                result[pid] = row
        _costs_cache = result
        logger.info("Supabase product_costs: %d products", len(result))
        return result
    except Exception as e:
        logger.error("product_costs fetch failed: %s", e)
        return None


# Facilities

_facilities_cache: Optional[Dict[str, dict]] = None

def fetch_facilities() -> Optional[Dict[str, dict]]:
    # Fetch facilities → dict keyed by product_id (same shape as local JSON).
    global _facilities_cache
    if _facilities_cache is not None:
        return _facilities_cache

    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("facilities").select("*").execute()
        if not resp.data:
            return None
        result: Dict[str, dict] = {}
        for row in resp.data:
            pid = row.get("product_id", "")
            if not pid:
                continue
            role = row.get("role", "primary")
            if role == "primary" or pid not in result:
                result[pid] = row
        _facilities_cache = result
        logger.info("Supabase facilities: %d products", len(result))
        return result
    except Exception as e:
        logger.error("facilities fetch failed: %s", e)
        return None


# Write-back

def write_risk_score(record: dict) -> bool:
    client = _get_client()
    if client is None:
        return False
    try:
        client.table("risk_scores").insert(record).execute()
        return True
    except Exception as e:
        logger.warning("risk_scores write failed: %s", e)
        return False


# Helpers for modules that load from local JSON

def load_profiles_with_fallback() -> Dict[str, dict]:
    # Try Supabase first, fall back to local data/product_profiles.json.
    profiles = fetch_product_profiles()
    if profiles:
        return profiles
    path = _BASE / "data" / "product_profiles.json"
    with open(path) as f:
        return json.load(f)


def load_costs_with_fallback() -> Dict[str, dict]:
    # Try Supabase first, fall back to local data/product_costs.json.
    costs = fetch_product_costs()
    if costs:
        return costs
    path = _BASE / "data" / "product_costs.json"
    with open(path) as f:
        return json.load(f)


def load_facilities_with_fallback() -> Dict[str, dict]:
    # Try Supabase first, fall back to local data/facilities.json.
    facs = fetch_facilities()
    if facs:
        return facs
    path = _BASE / "data" / "facilities.json"
    with open(path) as f:
        return json.load(f)


# Shipments

_shipments_cache: Dict[str, dict] = {}


def fetch_shipment_by_id(shipment_id: str) -> Optional[dict]:
    # Fetch a single shipment row by shipment_id (cached after first hit).
    if shipment_id in _shipments_cache:
        return _shipments_cache[shipment_id]

    client = _get_client()
    if client is None:
        return None
    try:
        resp = (
            client.table("shipments")
            .select("*")
            .eq("shipment_id", shipment_id)
            .limit(1)
            .execute()
        )
        if resp.data:
            _shipments_cache[shipment_id] = resp.data[0]
            return resp.data[0]
        return None
    except Exception as e:
        logger.warning("shipments fetch failed for %s: %s", shipment_id, e)
        return None


def fetch_all_shipments(limit: int = 500) -> Optional[Dict[str, dict]]:
    # Fetch all shipments → dict keyed by shipment_id.
    client = _get_client()
    if client is None:
        return None
    try:
        resp = client.table("shipments").select("*").limit(limit).execute()
        if not resp.data:
            return None
        result = {}
        for row in resp.data:
            sid = row.get("shipment_id", "")
            if sid:
                result[sid] = row
        logger.info("Supabase shipments: %d rows", len(result))
        return result
    except Exception as e:
        logger.error("shipments fetch failed: %s", e)
        return None


# Orchestrator run history

def write_orchestrator_run(record: dict) -> bool:
    # Upsert a run into orchestrator_runs, keyed on thread_id.
    client = _get_client()
    if client is None:
        return False
    try:
        from datetime import datetime, timezone
        row = {**record, "updated_at": datetime.now(timezone.utc).isoformat()}
        client.table("orchestrator_runs").upsert(row, on_conflict="thread_id").execute()
        return True
    except Exception as e:
        logger.warning("orchestrator_runs upsert failed: %s", e)
        return False


def fetch_orchestrator_runs(limit: int = 500) -> Optional[list]:
    # Fetch persisted run decisions, oldest first (matches in-memory history order).
    client = _get_client()
    if client is None:
        return None
    try:
        resp = (
            client.table("orchestrator_runs")
            .select("decision")
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        if not resp.data:
            return []
        return [row["decision"] for row in resp.data if row.get("decision")]
    except Exception as e:
        logger.error("orchestrator_runs fetch failed: %s", e)
        return None


def delete_all_orchestrator_runs() -> bool:
    client = _get_client()
    if client is None:
        return False
    try:
        client.table("orchestrator_runs").delete().neq("id", 0).execute()
        return True
    except Exception as e:
        logger.warning("orchestrator_runs delete failed: %s", e)
        return False


def count_recent_agent_actions(shipment_id: str, tool_name: str, hours: int = 1) -> int:
    # Count how many times `tool_name` appears in actions_taken/corrective_actions
    client = _get_client()
    if client is None or not shipment_id:
        return 0
    try:
        from datetime import datetime, timedelta, timezone
        since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        resp = (
            client.table("orchestrator_runs")
            .select("decision")
            .eq("shipment_id", shipment_id)
            .gte("created_at", since)
            .execute()
        )
        count = 0
        for row in resp.data or []:
            decision = row.get("decision") or {}
            for key in ("actions_taken", "corrective_actions"):
                for entry in decision.get(key, []):
                    if isinstance(entry, dict) and entry.get("tool") == tool_name:
                        count += 1
        return count
    except Exception as e:
        logger.warning("count_recent_agent_actions failed (non-fatal): %s", e)
        return 0


def write_agent_run_metrics(record: dict) -> bool:
    """Upsert one row to agent_run_metrics (PK = run_id)."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.table("agent_run_metrics").upsert(record).execute()
        return True
    except Exception as e:
        logger.warning("write_agent_run_metrics failed (non-fatal): %s", e)
        return False


def fetch_agent_run_metrics_overview(hours: int = 24) -> dict:
    """Aggregate agent_run_metrics rows from the last `hours` into summary stats."""
    client = _get_client()
    if client is None:
        return {}
    try:
        from datetime import datetime, timedelta, timezone
        since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        resp = (
            client.table("agent_run_metrics")
            .select("*")
            .gte("completed_at", since)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return {"total_runs": 0, "rows": []}

        total_runs = len(rows)
        severity_counts: dict = {"warning": 0, "critical": 0}
        check_counts: dict = {}
        latency_sums: dict = {}
        latency_counts: dict = {}
        total_tokens = 0
        total_cost = 0.0
        escalations = 0

        for row in rows:
            for f in row.get("guardrail_findings", []) or []:
                if not isinstance(f, dict):
                    continue
                sev = f.get("severity", "warning")
                if sev in severity_counts:
                    severity_counts[sev] += 1
                check = f.get("check", "unknown")
                check_counts[check] = check_counts.get(check, 0) + 1

            for node, latency in (row.get("node_latencies") or {}).items():
                latency_sums[node] = latency_sums.get(node, 0) + latency
                latency_counts[node] = latency_counts.get(node, 0) + 1

            total_tokens += row.get("total_tokens", 0) or 0
            total_cost += float(row.get("total_cost_usd", 0) or 0)
            if row.get("guardrail_escalated"):
                escalations += 1

        top_checks = sorted(check_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        avg_latencies = {
            node: latency_sums[node] / latency_counts[node]
            for node in latency_sums
        }

        return {
            "total_runs": total_runs,
            "severity_counts": severity_counts,
            "top_checks": [{"check": c, "count": n} for c, n in top_checks],
            "avg_node_latencies": avg_latencies,
            "total_tokens": total_tokens,
            "total_cost_usd": round(total_cost, 4),
            "guardrail_escalation_rate": round(escalations / total_runs, 3) if total_runs else 0,
        }
    except Exception as e:
        logger.warning("fetch_agent_run_metrics_overview failed (non-fatal): %s", e)
        return {}


def write_eval_run(record: dict) -> bool:
    """Upsert one row to eval_runs (PK = eval_run_id)."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.table("eval_runs").upsert(record).execute()
        return True
    except Exception as e:
        logger.warning("write_eval_run failed (non-fatal): %s", e)
        return False


def write_eval_run_cases(records: list) -> bool:
    """Insert rows into eval_run_cases."""
    client = _get_client()
    if client is None:
        return False
    try:
        client.table("eval_run_cases").insert(records).execute()
        return True
    except Exception as e:
        logger.warning("write_eval_run_cases failed (non-fatal): %s", e)
        return False


def fetch_recent_eval_runs(limit: int = 10) -> list:
    """Fetch the most recent eval_runs rows."""
    client = _get_client()
    if client is None:
        return []
    try:
        resp = (
            client.table("eval_runs")
            .select("*")
            .order("run_at", desc=True)
            .limit(limit)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.warning("fetch_recent_eval_runs failed (non-fatal): %s", e)
        return []
