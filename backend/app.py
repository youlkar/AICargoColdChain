"""
FastAPI backend for AI Cargo Monitoring.
Serves the risk-scored data to the React dashboard and provides tool-execution endpoints that the orchestrator will call.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import orchestrator.llm_provider as prov


from backend.models import (
    ApprovalDecision,
    ApprovalRequest,
    AuditRecord,
    RiskOverview,
    ShipmentSummary,
    WindowRisk,
)
from tools.approval_workflow import _PENDING_APPROVALS, decide as approve_decide, get_pending, get_all as get_all_approvals
from tools.triage_agent import _execute as triage_execute, _enrich_shipment
from tools import TOOL_MAP
from orchestrator.graph import (
    run_orchestrator,
    run_orchestrator_async,
    resume_orchestrator,
    get_orchestrator_state,
    stream_orchestration,
    get_graph_mermaid,
    get_mode,
)
from orchestrator.llm_provider import get_llm, get_provider_name, get_model_name
from src.context_assembler import build_window_context
from src.data_loader import load_product_profiles

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# LangSmith tracing enabled automatically 
if os.environ.get("LANGCHAIN_TRACING_V2") == "true":
    logger.info("LangSmith tracing enabled (project: %s)",
                os.environ.get("LANGCHAIN_PROJECT", "default"))

BASE = Path(__file__).resolve().parent.parent
SCORED_CSV = BASE / "artifacts" / "scored_windows.csv"
AUDIT_DIR = BASE / "audit_logs"


# Embedded Supabase stream listener

_TIERS_TO_ORCHESTRATE = {"MEDIUM", "HIGH", "CRITICAL"}
_stream_stats = {"ingested": 0, "orchestrated": 0, "errors": 0}

# Leg window cache: stores the last 3 raw window records per leg_id.
_leg_window_cache: dict = {} 
_LEG_CACHE_SIZE = 3          


def _get_ml_model():
    # Load (and cache) the XGBoost model for real-time inference.
    from src.predictive_model import load_model
    if not hasattr(_get_ml_model, "_model"):
        try:
            _get_ml_model._model = load_model()
            logger.info("ML model loaded for real-time inference")
        except Exception as exc:
            logger.warning("ML model not available: %s", exc)
            _get_ml_model._model = None
    return _get_ml_model._model


def _ml_score_from_model(engineered_row: "pd.Series") -> float:
    import pandas as pd
    from src.feature_engineering import LEAKY_COLS, REFERENCE_COLS, ID_COLS, TARGET

    model = _get_ml_model()
    if model is None:
        return None  # signal caller to use deterministic fallback

    row_df = pd.DataFrame([engineered_row])

    # One-hot encode categoricals (same logic as prepare_ml_arrays)
    phase_dummies = pd.get_dummies(row_df["transit_phase"], prefix="phase", dtype=int)
    prod_dummies  = pd.get_dummies(row_df["product_id"],   prefix="prod",  dtype=int)

    exclude = set(ID_COLS + LEAKY_COLS + REFERENCE_COLS + [TARGET])
    numeric_cols = [c for c in row_df.select_dtypes(include="number").columns
                    if c not in exclude]
    X = pd.concat([row_df[numeric_cols], phase_dummies, prod_dummies], axis=1)

    # Align to the exact feature set the model was trained on
    X = X.reindex(columns=model.feature_names_in_, fill_value=0)

    return float(model.predict_proba(X)[:, 1][0])


async def _process_stream_record(record: dict):
    # Score a streamed row and trigger orchestration if risky.
    from src.feature_engineering import engineer_features
    from src.deterministic_engine import score_row
    from src.risk_fusion import fuse_scores

    window_id = record.get("window_id", "?")
    leg_id    = record.get("leg_id", "")
    try:
        profiles = _get_profiles()

        prior = _leg_window_cache.get(leg_id, [])
        all_records = prior + [record]
        row_df = pd.DataFrame(all_records)
        for col in ("window_start", "window_end"):
            if col in row_df.columns:
                row_df[col] = pd.to_datetime(row_df[col], errors="coerce")
        row_df = engineer_features(row_df, profiles)
        row = row_df.iloc[-1]  # current window is always the last row

        # Keep only the last _LEG_CACHE_SIZE raw records for this leg
        _leg_window_cache[leg_id] = all_records[-_LEG_CACHE_SIZE:]

        det_score, det_results = score_row(row, profiles)
        rules_fired = [r.rule_name for r in det_results if r.fired]

        # Call the actual XGBoost model instead of det_score * 0.8
        ml_score_computed = _ml_score_from_model(row)
        if ml_score_computed is not None:
            ml_score = ml_score_computed
            logger.debug("STREAM_ML  %s ml_score=%.4f (from XGBoost)", window_id, ml_score)
        else:
            # Model not loaded — fall back to deterministic proxy
            ml_score = float(det_score * 0.8)
            logger.debug("STREAM_ML  %s ml_score=%.4f (det fallback)", window_id, ml_score)

        final_score, risk_tier, actions, requires_human = fuse_scores(det_score, ml_score)

        scored = {
            "window_id": window_id,
            "shipment_id": record.get("shipment_id"),
            "risk_score": round(final_score, 4),
            "risk_tier": risk_tier,
            "rules_fired": rules_fired,
        }
        await _broadcast({"type": "ingest_scored", "result": scored})
        _stream_stats["ingested"] += 1

        logger.info("STREAM_SCORED  %s tier=%s score=%.4f", window_id, risk_tier, final_score)

        if risk_tier in _TIERS_TO_ORCHESTRATE:
            try:
                risk_data = score_window(window_id)
            except HTTPException:
                risk_data = _build_risk_input_from_record(record, final_score, risk_tier, rules_fired, ml_score)

            decision = await run_orchestrator_async(risk_data)
            decision["_window_id"] = window_id
            await _append_history(decision)
            await _broadcast({"type": "orchestrator_decision", "decision": decision})
            _stream_stats["orchestrated"] += 1
            logger.info("STREAM_ORCH   %s tier=%s awaiting=%s actions=%d",
                        window_id, risk_tier,
                        decision.get("awaiting_approval", False),
                        len(decision.get("actions_taken", [])))

    except Exception as e:
        _stream_stats["errors"] += 1
        logger.warning("Stream processing failed for %s: %s", window_id, e)


def _build_risk_input_from_record(record, final_score, risk_tier, rules_fired, ml_score):
    # Build a minimal risk_input when the window isn't in the scored CSV.
    return {
        "window_id": record.get("window_id"),
        "shipment_id": record.get("shipment_id"),
        "container_id": record.get("container_id"),
        "product_id": record.get("product_id"),
        "leg_id": record.get("leg_id", ""),
        "product_type": record.get("product_id", ""),
        "transit_phase": record.get("transit_phase", ""),
        "risk_tier": risk_tier,
        "fused_risk_score": final_score,
        "ml_spoilage_probability": ml_score * 0.7,
        "deterministic_rule_flags": rules_fired,
        "avg_temp_c": record.get("avg_temp_c"),
        "temp_slope_c_per_hr": record.get("temp_slope_c_per_hr"),
        "current_delay_min": record.get("current_delay_min", 0),
        "delay_class": "developing" if record.get("current_delay_min", 0) > 30 else "stable",
        "key_drivers": [],
        "facility": {},
        "product_cost": {},
    }


async def _stream_listener_loop():
    # Background task: subscribe to Supabase Realtime and process INSERTs.
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        logger.info("Stream listener disabled — no Supabase credentials")
        return

    try:
        from supabase._async.client import AsyncClient, create_client as acreate
    except ImportError:
        logger.warning("Stream listener disabled — supabase async client not installed")
        return

    await asyncio.sleep(2)

    try:
        sb: AsyncClient = await acreate(url, key)

        def _on_insert(payload: dict):
            record = (
                payload.get("data", {}).get("record")
                or payload.get("record")
                or {}
            )
            if not record.get("window_id"):
                return
            logger.info("STREAM  new row: %s | shipment=%s",
                        record.get("window_id"), record.get("shipment_id"))
            asyncio.get_running_loop().create_task(_process_stream_record(record))

        channel = sb.channel("window-stream")
        channel.on_postgres_changes(
            event="INSERT",
            schema="public",
            table="window_features",
            callback=_on_insert,
        )
        await channel.subscribe()
        logger.info("Stream listener active — subscribed to window_features INSERT")

        while True:
            await asyncio.sleep(60)
            logger.info("STREAM_STATS  ingested=%d orchestrated=%d errors=%d",
                        _stream_stats["ingested"], _stream_stats["orchestrated"],
                        _stream_stats["errors"])

    except asyncio.CancelledError:
        logger.info("Stream listener shutting down")
    except Exception as e:
        logger.error("Stream listener error: %s", e)


@asynccontextmanager
async def lifespan(app_instance):
    _get_ml_model()  # load eagerly so failures surface at startup, not on first request

    try:
        from src.supabase_client import fetch_orchestrator_runs
        rows = await asyncio.to_thread(fetch_orchestrator_runs, _MAX_HISTORY)
        if rows:
            _orchestrator_history.extend(rows)
            logger.info("Loaded %d orchestrator runs from Supabase", len(rows))
    except Exception as exc:
        logger.warning("orchestrator_runs load failed: %s", exc)

    task = asyncio.create_task(_stream_listener_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="AI Cargo Monitor", version="1.0.0", lifespan=lifespan)

_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
if os.environ.get("FRONTEND_URL"):
    _cors_origins.append(os.environ["FRONTEND_URL"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check

@app.get("/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


# In-memory caches

_df: Optional[pd.DataFrame] = None
_profiles: Optional[dict] = None


def _get_df() -> pd.DataFrame:
    global _df
    if _df is None:
        if not SCORED_CSV.exists():
            raise HTTPException(503, "Run `python pipeline.py train` first")
        _df = pd.read_csv(SCORED_CSV)
    return _df


def _get_profiles() -> dict:
    global _profiles
    if _profiles is None:
        _profiles = load_product_profiles()
    return _profiles


# WebSocket connections

_ws_clients: List[WebSocket] = []


async def _broadcast(event: dict):
    for ws in list(_ws_clients):
        try:
            await ws.send_json(event)
        except Exception:
            _ws_clients.remove(ws)


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    """Broadcast channel — all clients receive all system events."""
    await websocket.accept()
    _ws_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        _ws_clients.remove(websocket)


@app.websocket("/ws/stream/{window_id}")
async def ws_stream_orchestration(websocket: WebSocket, window_id: str):
    await websocket.accept()
    try:
        risk_data = score_window(window_id)
    except HTTPException as exc:
        await websocket.send_json({"type": "stream_error",
                                   "error": f"Window {window_id} not found: {exc.detail}"})
        await websocket.close()
        return

    try:
        decision = await stream_orchestration(risk_data, websocket.send_json)
        if decision:
            decision["_window_id"] = window_id
            await _append_history(decision)
            await _broadcast({"type": "orchestrator_decision", "decision": decision})
    except WebSocketDisconnect:
        logger.info("Stream client disconnected mid-run for window %s", window_id)
    except Exception as exc:
        logger.error("ws_stream_orchestration error: %s", exc)
        try:
            await websocket.send_json({"type": "stream_error", "error": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# Risk overview

@app.get("/api/risk/overview", response_model=RiskOverview)
def risk_overview():
    df = _get_df()
    tier_counts = df["risk_tier"].value_counts().to_dict()
    total = len(df)
    tier_pcts = {k: round(v / total * 100, 1) for k, v in tier_counts.items()}

    top = _build_shipment_summaries(df, top_n=10)
    return RiskOverview(
        total_windows=total,
        total_shipments=df["shipment_id"].nunique(),
        tier_counts=tier_counts,
        tier_pcts=tier_pcts,
        top_risky_shipments=top,
    )


# Shipments

@app.get("/api/shipments", response_model=List[ShipmentSummary])
def list_shipments(risk_tier: Optional[str] = Query(None)):
    df = _get_df()
    summaries = _build_shipment_summaries(df, top_n=None)
    if risk_tier:
        summaries = [s for s in summaries if s.latest_risk_tier == risk_tier]
    return summaries


@app.get("/api/shipments/{shipment_id}/windows", response_model=List[WindowRisk])
def shipment_windows(shipment_id: str):
    df = _get_df()
    sub = df[df["shipment_id"] == shipment_id]
    if sub.empty:
        raise HTTPException(404, f"Shipment {shipment_id} not found")
    return [_row_to_window(row) for _, row in sub.iterrows()]


# Windows

@app.get("/api/windows", response_model=List[WindowRisk])
def list_windows(
    risk_tier: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    limit: int = Query(200, le=2000),
    offset: int = Query(0),
):
    df = _get_df()
    if risk_tier:
        df = df[df["risk_tier"] == risk_tier]
    if product_id:
        df = df[df["product_id"] == product_id]
    df = df.sort_values("final_score", ascending=False)
    page = df.iloc[offset : offset + limit]
    return [_row_to_window(row) for _, row in page.iterrows()]


@app.get("/api/windows/{window_id}", response_model=WindowRisk)
def get_window(window_id: str):
    df = _get_df()
    row = df[df["window_id"] == window_id]
    if row.empty:
        raise HTTPException(404, f"Window {window_id} not found")
    return _row_to_window(row.iloc[0])


# Risk engine output (for orchestrator)

@app.get("/api/risk/score-window/{window_id}")
def score_window(window_id: str):
    # Return the enriched risk engine output for a single window in the format

    df = _get_df()
    profiles = _get_profiles()

    try:
        ctx = build_window_context(window_id, df, profiles)
    except KeyError:
        raise HTTPException(404, f"Window {window_id} not found")

    return {
        # Core identity
        "shipment_id": ctx["shipment_id"],
        "container_id": ctx["container_id"],
        "window_id": ctx["window_id"],
        "leg_id": ctx["leg_id"],
        "product_type": ctx["product_id"],
        "transit_phase": ctx["transit_phase"],
        "window_end": ctx["window_end"],

        # Risk scores
        "risk_tier": ctx["risk_tier"],
        "fused_risk_score": ctx["final_score"],
        "ml_spoilage_probability": ctx["ml_score"],
        "deterministic_rule_flags": ctx["det_rules_fired"],
        "key_drivers": [],
        "recommended_actions_from_risk_engine": ctx["recommended_actions"],
        "confidence_score": round(1.0 - abs(ctx["det_score"] - ctx["ml_score"]), 4),

        # Cascade context fields
        "delay_ratio": ctx["delay_ratio"],
        "delay_class": ctx["delay_class"],
        "hours_to_breach": ctx["hours_to_breach"],
        "current_delay_min": ctx["current_delay_min"],
        "facility": ctx["facility"],
        "product_cost": ctx["product_cost"],

        # Telemetry fields used by cold_storage_agent (temp trend context)
        "avg_temp_c": ctx["avg_temp_c"],
        "temp_slope_c_per_hr": ctx["temp_slope_c_per_hr"],

        "operational_constraints": [],
        "available_tools": list(TOOL_MAP.keys()),
    }


# Audit logs
@app.get("/api/audit-logs")
def list_audit_logs(
    shipment_id: Optional[str] = Query(None),
    risk_tier: Optional[str] = Query(None),
    limit: int = Query(100, le=1000),
):
    records = _load_audit_records()
    if shipment_id:
        records = [r for r in records if r.get("shipment_id") == shipment_id]
    if risk_tier:
        records = [r for r in records if r.get("risk_tier") == risk_tier]
    return records[:limit]


# Tool execution

@app.post("/api/tools/{tool_name}/execute")
async def execute_tool(tool_name: str, payload: Dict[str, Any]):
    if tool_name not in TOOL_MAP:
        raise HTTPException(404, f"Tool '{tool_name}' not found. Available: {list(TOOL_MAP.keys())}")
    tool = TOOL_MAP[tool_name]
    result = tool.invoke(payload)
    await _broadcast({"type": "tool_executed", "tool": tool_name, "result": result})
    return result


# Approval workflow

@app.get("/api/approvals/pending", response_model=List[ApprovalRequest])
def pending_approvals():
    return get_pending()


@app.get("/api/approvals/all")
def all_approvals():
    # Return ALL approvals (pending, approved, rejected, executed).
    return get_all_approvals()


@app.delete("/api/approvals")
def clear_approvals():
    # Clear all approval records.
    from tools.approval_workflow import _PENDING_APPROVALS
    count = len(_PENDING_APPROVALS)
    _PENDING_APPROVALS.clear()
    return {"cleared": count}


@app.post("/api/approvals/{approval_id}/decide")
async def decide_approval(approval_id: str, body: ApprovalDecision):
    result = approve_decide(approval_id, body.decision, body.decided_by)
    if "error" in result:
        raise HTTPException(404, result["error"])

    window_id = result.get("window_id") or result.get("shipment_id", "")
    for entry in _orchestrator_history:
        entry_wid = entry.get("_window_id") or entry.get("window_id", "")
        if entry_wid == window_id and entry.get("requires_approval"):
            entry["_approval_status"] = body.decision
            entry["_approved_by"] = body.decided_by
            break

    await _broadcast({"type": "approval_decided", "result": result})
    return result


@app.post("/api/approvals/{approval_id}/confirm")
async def confirm_approved(approval_id: str, body: Dict[str, Any] = None):
    # Confirm that first-pass execution was sufficient — no additional tools needed.
    from tools.approval_workflow import _PENDING_APPROVALS
    record = _PENDING_APPROVALS.get(approval_id)
    if not record:
        raise HTTPException(404, f"Approval {approval_id} not found")
    if record.get("status") not in ("pending", "approved"):
        raise HTTPException(400, f"Approval {approval_id} cannot be confirmed (status={record.get('status')})")

    body = body or {}
    decided_by = body.get("decided_by", "operator")

    final_output = await resume_orchestrator(approval_id, "confirmed", decided_by)

    final_output["_window_id"] = record.get("window_id", "")
    final_output["_approval_id"] = approval_id
    final_output["_execution_mode"] = "confirmed"
    final_output["awaiting_approval"] = False
    final_output["review_status"] = "confirmed"

    await _replace_or_append_history(approval_id, record.get("window_id", ""), final_output)
    await _broadcast({"type": "approval_confirmed", "approval_id": approval_id, "record": final_output})
    return final_output


@app.post("/api/approvals/{approval_id}/execute")
async def execute_approved(approval_id: str, body: Dict[str, Any] = None):
    # Execute post-approval: resume graph from checkpoint, then run deferred tools.
    from tools.approval_workflow import _PENDING_APPROVALS
    record = _PENDING_APPROVALS.get(approval_id)
    if not record:
        raise HTTPException(404, f"Approval {approval_id} not found")
    if record.get("status") not in ("pending", "approved"):
        raise HTTPException(400, f"Approval {approval_id} is not pending/approved (status={record.get('status')})")

    body = body or {}
    decided_by = body.get("decided_by", "operator")
    selected_tools = [t for t in (body.get("selected_tools") or []) if t != "approval_workflow"]

    # If no tools explicitly selected, fall back to the proposed deferred set.
    if not selected_tools:
        selected_tools = [
            t for t in (record.get("proposed_corrections", []) + record.get("proposed_deferred", []))
            if t != "approval_workflow"
        ]

    # 1. Resume the graph from checkpoint.
    final_output = await resume_orchestrator(approval_id, "approved", decided_by)

    # 2. Run any deferred tools (e.g. notification_agent) the operator selected
    #    that weren't executed inside the graph loop.
    post_approval_results: List[Dict[str, Any]] = []
    if selected_tools:
        # Pull the full state from checkpoint so tool inputs have cascade context.
        ckpt = await get_orchestrator_state(approval_id)
        already_run = {r["tool"] for r in ckpt.get("tool_results", [])}
        from orchestrator.nodes import _build_tool_input

        for tool_name in selected_tools:
            if tool_name not in TOOL_MAP or tool_name in already_run:
                continue
            try:
                ri = ckpt.get("risk_input", record)
                tool_input = _build_tool_input(tool_name, ri, ckpt)
                result = TOOL_MAP[tool_name].invoke(tool_input)
                post_approval_results.append({
                    "tool": tool_name, "result": result,
                    "success": True, "_pass": "post_approval",
                })
                logger.info("POST_APPROVAL_TOOL  %s → success", tool_name)
            except Exception as exc:
                logger.error("POST_APPROVAL_TOOL  %s failed: %s", tool_name, exc)
                post_approval_results.append({
                    "tool": tool_name, "result": {"error": str(exc)},
                    "success": False, "_pass": "post_approval",
                })

    record["status"] = "executed"
    record["executed_at"] = datetime.now(timezone.utc).isoformat()
    record["executed_tools"] = selected_tools
    record["post_approval_actions"] = post_approval_results

    final_output["_window_id"] = record.get("window_id", "")
    final_output["_approval_id"] = approval_id
    final_output["_execution_mode"] = "post_approval_checkpoint_resume"
    final_output["awaiting_approval"] = False
    final_output["review_status"] = "executed"

    if post_approval_results:
        existing = list(final_output.get("actions_taken") or [])
        final_output["actions_taken"] = existing + post_approval_results
        final_output["post_approval_actions"] = post_approval_results

    await _replace_or_append_history(approval_id, record.get("window_id", ""), final_output)
    await _broadcast({"type": "approval_executed", "approval_id": approval_id, "decision": final_output})
    return final_output


@app.get("/api/approvals/{approval_id}/state")
async def approval_checkpoint_state(approval_id: str):
    """Return the full LangGraph checkpoint state for an approval.

    Phase 1B: the dashboard calls this to show tool results, LLM reasoning,
    cascade context, and plans — all of which live in the checkpoint rather
    than _PENDING_APPROVALS.
    """
    state = await get_orchestrator_state(approval_id)
    if not state:
        raise HTTPException(404, f"No checkpoint found for approval {approval_id}")
    # Strip large binary / non-serialisable values before returning.
    return {k: v for k, v in state.items() if k != "risk_input" or True}


@app.post("/api/orchestrator/run-selective/{window_id}")
async def orchestrate_selective(window_id: str, body: Dict[str, Any]):
    """Run orchestration with human-selected tools only."""
    selected_tools = body.get("selected_tools", [])
    if not selected_tools:
        raise HTTPException(400, "selected_tools list is required")

    from orchestrator.graph import run_orchestrator_selective
    risk_data = score_window(window_id)
    decision = run_orchestrator_selective(risk_data, selected_tools)
    decision["_window_id"] = window_id
    decision["_execution_mode"] = "human_selective"
    await _append_history(decision)
    await _broadcast({"type": "orchestrator_decision", "decision": decision})
    return decision


# Orchestrator

_MAX_HISTORY = 500
_orchestrator_history: List[Dict[str, Any]] = []


def _decision_to_run_record(entry: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    # Map an orchestration decision dict to an orchestrator_runs row.
    thread_id = entry.get("thread_id") or entry.get("approval_id") or entry.get("_approval_id")
    if not thread_id:
        # Completed runs (no approval pause) don't carry a thread_id in final_output.
        window_id = entry.get("_window_id") or entry.get("window_id") or "UNKNOWN"
        ts = entry.get("timestamp") or datetime.now(timezone.utc).isoformat()
        thread_id = f"{window_id}_{ts}"
    # Sanitize numpy/datetime types that supabase-py's json encoder can't handle.
    safe_decision = json.loads(json.dumps(entry, default=str))
    return {
        "thread_id": thread_id,
        "window_id": entry.get("_window_id") or entry.get("window_id"),
        "shipment_id": entry.get("shipment_id"),
        "container_id": entry.get("container_id"),
        "risk_tier": entry.get("risk_tier"),
        "awaiting_approval": bool(entry.get("awaiting_approval")),
        "execution_mode": entry.get("_execution_mode") or entry.get("review_status"),
        "decision": safe_decision,
    }


def _persist_history_entry(entry: Dict[str, Any]) -> None:
    record = _decision_to_run_record(entry)
    if record is None:
        return
    try:
        from src.supabase_client import write_orchestrator_run
        write_orchestrator_run(record)
    except Exception as exc:
        logger.warning("orchestrator_runs persist failed: %s", exc)


async def _append_history(entry: Dict[str, Any]) -> None:
    # Append a decision to in-memory history and persist it to Supabase.
    _orchestrator_history.append(entry)
    if len(_orchestrator_history) > _MAX_HISTORY:
        _orchestrator_history[:] = _orchestrator_history[-_MAX_HISTORY:]
    await asyncio.to_thread(_persist_history_entry, entry)


async def _replace_or_append_history(approval_id: str, window_id: str, entry: Dict[str, Any]) -> None:
    # Replace an existing history entry matching approval_id or window_id, else append.
    for i, old in enumerate(_orchestrator_history):
        if old.get("approval_id") == approval_id or old.get("_approval_id") == approval_id:
            _orchestrator_history[i] = entry
            await asyncio.to_thread(_persist_history_entry, entry)
            return
        old_wid = old.get("_window_id") or old.get("window_id", "")
        if old_wid == window_id and old.get("awaiting_approval"):
            _orchestrator_history[i] = entry
            await asyncio.to_thread(_persist_history_entry, entry)
            return
    await _append_history(entry)


@app.post("/api/orchestrator/run/{window_id}")
async def orchestrate_window(window_id: str):
    # Feed a window's risk output through the full orchestration agent.
    risk_data = score_window(window_id)
    decision = await run_orchestrator_async(risk_data)
    decision["_window_id"] = window_id
    await _append_history(decision)
    await _broadcast({"type": "orchestrator_decision", "decision": decision})
    return decision


@app.post("/api/orchestrator/run-batch")
async def orchestrate_batch(window_ids: List[str]):
    # Orchestrate multiple windows (e.g. all CRITICAL windows).
    results = []
    for wid in window_ids[:20]:
        try:
            risk_data = score_window(wid)
            decision = run_orchestrator(risk_data)
            decision["_window_id"] = wid
            await _append_history(decision)
            results.append(decision)
        except Exception as exc:
            results.append({"_window_id": wid, "error": str(exc)})
    await _broadcast({"type": "orchestrator_batch", "count": len(results)})
    return results


@app.get("/api/orchestrator/history")
def orchestrator_history(limit: int = Query(50, le=200)):
    return list(reversed(_orchestrator_history[-limit:]))


@app.delete("/api/orchestrator/history")
def clear_orchestrator_history():
    # Clear all orchestration history from memory and Supabase.
    count = len(_orchestrator_history)
    _orchestrator_history.clear()
    try:
        from src.supabase_client import delete_all_orchestrator_runs
        delete_all_orchestrator_runs()
    except Exception as exc:
        logger.warning("orchestrator_runs delete failed: %s", exc)
    return {"cleared": count}


@app.get("/api/graph/mermaid")
def graph_mermaid():
    # Return the Mermaid diagram of the orchestration graph.
    return {"mermaid": get_graph_mermaid()}


@app.get("/api/orchestrator/mode")
def orchestrator_mode():
    # Return the orchestrator's active LLM provider, model, and mode.
    return get_mode()


@app.get("/api/llm/status")
def llm_status():
    # Full LLM provider status: active provider, available providers, and config.
    import orchestrator.llm_provider as prov
    available = []
    for name in ["groq", "ollama", "openai", "anthropic"]:
        factory = prov._PROVIDERS.get(name)
        if factory:
            try:
                result = factory()
                available.append({"provider": name, "available": result is not None})
            except Exception:
                available.append({"provider": name, "available": False})

    return {
        "active_provider": get_provider_name(),
        "active_model": get_model_name(),
        "mode": "agentic" if get_llm() is not None else "deterministic",
        "priority": os.environ.get("CARGO_LLM_PRIORITY", "groq,ollama,openai,anthropic"),
        "providers": available,
        "keys_configured": {
            "groq": bool(os.environ.get("GROQ_API_KEY", "")),
            "openai": bool(os.environ.get("OPENAI_API_KEY", "")),
            "anthropic": bool(os.environ.get("ANTHROPIC_API_KEY", "")),
        },
    }


@app.post("/api/llm/configure")
async def configure_llm(config: Dict[str, Any]):
    # Hot-configure LLM provider settings without restart.


    changed = []
    if "groq_api_key" in config:
        os.environ["GROQ_API_KEY"] = config["groq_api_key"]
        changed.append("GROQ_API_KEY")
    if "openai_api_key" in config:
        os.environ["OPENAI_API_KEY"] = config["openai_api_key"]
        changed.append("OPENAI_API_KEY")
    if "anthropic_api_key" in config:
        os.environ["ANTHROPIC_API_KEY"] = config["anthropic_api_key"]
        changed.append("ANTHROPIC_API_KEY")
    if "priority" in config:
        os.environ["CARGO_LLM_PRIORITY"] = config["priority"]
        changed.append("CARGO_LLM_PRIORITY")
    if "groq_model" in config:
        os.environ["CARGO_GROQ_MODEL"] = config["groq_model"]
        changed.append("CARGO_GROQ_MODEL")
    if "ollama_model" in config:
        os.environ["CARGO_OLLAMA_MODEL"] = config["ollama_model"]
        changed.append("CARGO_OLLAMA_MODEL")
    if "openai_model" in config:
        os.environ["CARGO_OPENAI_MODEL"] = config["openai_model"]
        changed.append("CARGO_OPENAI_MODEL")
    if "anthropic_model" in config:
        os.environ["CARGO_ANTHROPIC_MODEL"] = config["anthropic_model"]
        changed.append("CARGO_ANTHROPIC_MODEL")

    prov.get_llm(force_refresh=True)

    return {
        "status": "ok",
        "changed": changed,
        "active_provider": prov.get_provider_name(),
        "active_model": prov.get_model_name(),
    }


@app.get("/api/graph/topology")
def graph_topology():
    # Return a JSON description of the full system graph topology.
    return {
        "layers": [
            {
                "id": "L1", "name": "Data & Ingestion",
                "nodes": [
                    {"id": "sensors", "label": "Smart Containers"},
                    {"id": "ingest", "label": "Window Aggregation"},
                ],
                "edges": [{"from": "sensors", "to": "ingest"}],
            },
            {
                "id": "L2", "name": "Risk Scoring Engine",
                "nodes": [
                    {"id": "features", "label": "Feature Engineering"},
                    {"id": "det", "label": "Deterministic Rules"},
                    {"id": "ml", "label": "XGBoost Predictor"},
                    {"id": "fusion", "label": "Risk Fusion"},
                ],
                "edges": [
                    {"from": "features", "to": "det"},
                    {"from": "features", "to": "ml"},
                    {"from": "det", "to": "fusion"},
                    {"from": "ml", "to": "fusion"},
                ],
            },
            {
                "id": "L3", "name": "Orchestration Agent",
                "nodes": [
                    {"id": "interpret", "label": "Interpret Risk"},
                    {"id": "plan", "label": "Generate Plan"},
                    {"id": "reflect", "label": "Self-Critique"},
                    {"id": "revise", "label": "Revise Plan"},
                    {"id": "execute", "label": "Execute Tools"},
                    {"id": "output", "label": "Compile Decision"},
                ],
                "edges": [
                    {"from": "interpret", "to": "plan"},
                    {"from": "plan", "to": "reflect"},
                    {"from": "reflect", "to": "revise", "label": "has gaps"},
                    {"from": "reflect", "to": "execute", "label": "plan OK"},
                    {"from": "revise", "to": "execute"},
                    {"from": "execute", "to": "output"},
                ],
            },
            {
                "id": "L4", "name": "Agent Tools",
                "nodes": [
                    {"id": "t_route", "label": "Route Agent"},
                    {"id": "t_cold", "label": "Cold Storage"},
                    {"id": "t_notify", "label": "Notification"},
                    {"id": "t_compliance", "label": "Compliance"},
                    {"id": "t_schedule", "label": "Scheduling"},
                    {"id": "t_insurance", "label": "Insurance"},
                    {"id": "t_triage", "label": "Triage"},
                    {"id": "t_approval", "label": "Approval"},
                ],
                "edges": [],
            },
            {
                "id": "L5", "name": "Human-in-the-Loop",
                "nodes": [
                    {"id": "dashboard", "label": "Ops Dashboard"},
                    {"id": "approve", "label": "Approval Queue"},
                ],
                "edges": [{"from": "approve", "to": "dashboard"}],
            },
        ],
        "cross_layer_edges": [
            {"from": "ingest", "to": "features"},
            {"from": "fusion", "to": "interpret"},
            {"from": "execute", "to": "t_route"},
            {"from": "execute", "to": "t_cold"},
            {"from": "execute", "to": "t_notify"},
            {"from": "execute", "to": "t_compliance"},
            {"from": "execute", "to": "t_insurance"},
            {"from": "execute", "to": "t_approval"},
            {"from": "t_approval", "to": "approve"},
            {"from": "output", "to": "dashboard"},
        ],
    }


# ── Triage ────────────────────────────────────────────────────────────

@app.get("/api/triage/critical-shipments")
async def triage_critical_shipments(limit: int = Query(20, le=100)):
    # Auto-triage: pull all CRITICAL+HIGH windows, find worst per shipment, rank with enrichment, return priority list.
    df = _get_df()
    critical = df[df["risk_tier"].isin(["CRITICAL", "HIGH"])]
    if critical.empty:
        return {"priority_list": [], "total_shipments": 0}

    worst = critical.sort_values("final_score", ascending=False).groupby("shipment_id").first().reset_index()
    shipments = [
        {
            "shipment_id": row["shipment_id"],
            "risk_tier": row["risk_tier"],
            "fused_risk_score": float(row["final_score"]),
            "product_id": row["product_id"],
            "container_id": row.get("container_id", ""),
            "transit_phase": str(row.get("transit_phase", "")),
        }
        for _, row in worst.head(limit).iterrows()
    ]
    result = triage_execute(shipments=shipments, enrich=True)
    await _broadcast({"type": "triage_ranked", "count": len(shipments)})
    return result


@app.post("/api/triage/rank")
async def triage_rank(payload: Dict[str, Any]):
    # Rank a caller-supplied list of shipment dicts.
    shipments = payload.get("shipments", [])
    enrich = payload.get("enrich", True)
    result = triage_execute(shipments=shipments, enrich=enrich)
    await _broadcast({"type": "triage_ranked", "count": len(shipments)})
    return result


# ── Data Ingest (Karthik's Supabase pipeline) ────────────────────────

@app.post("/api/ingest")
async def ingest_window(payload: Dict[str, Any]):
    # Receive a single window_features row (from Supabase stream_listener or direct POST) and score it through the risk engine in real time.
    from src.feature_engineering import engineer_features
    from src.deterministic_engine import score_row
    from src.risk_fusion import fuse_scores

    profiles = _get_profiles()
    row_df = pd.DataFrame([payload])
    for col in ("window_start", "window_end"):
        if col in row_df.columns:
            row_df[col] = pd.to_datetime(row_df[col], errors="coerce")
    row_df = engineer_features(row_df, profiles)
    row = row_df.iloc[0]

    det_score, det_results = score_row(row, profiles)
    rules_fired = [r.rule_name for r in det_results if r.fired]

    ml_score = float(payload.get("ml_score", det_score * 0.8))

    final_score, risk_tier, actions, requires_human = fuse_scores(det_score, ml_score)

    result = {
        "window_id": payload.get("window_id"),
        "shipment_id": payload.get("shipment_id"),
        "risk_score": round(final_score, 4),
        "risk_tier": risk_tier,
        "det_score": round(det_score, 4),
        "ml_score": round(ml_score, 4),
        "rules_fired": rules_fired,
        "recommended_actions": actions,
        "requires_human_approval": requires_human,
    }

    await _broadcast({"type": "ingest_scored", "result": result})
    return result


# Analytics (chart-ready aggregations)

@app.get("/api/agent-quality/overview")
def agent_quality_overview(hours: int = Query(24, ge=1, le=168)):
    # Aggregate guardrail/cost/latency metrics for the Agent Quality dashboard.
    from src.supabase_client import fetch_agent_run_metrics_overview, fetch_recent_eval_runs
    metrics = fetch_agent_run_metrics_overview(hours=hours)
    eval_runs = fetch_recent_eval_runs(limit=10)
    return {**metrics, "recent_eval_runs": eval_runs, "hours": hours}


@app.get("/api/analytics")
def analytics():
    # Pre-computed distributions for dashboard charts.
    import numpy as np

    df = _get_df()

    # 1. Tier counts by transit phase
    tier_by_phase = (
        df.groupby(["transit_phase", "risk_tier"])
        .size()
        .reset_index(name="count")
        .to_dict(orient="records")
    )

    # 2. Score distribution (histogram bins)
    bins = np.linspace(0, 1, 21)
    hist_vals, _ = np.histogram(df["final_score"].dropna(), bins=bins)
    score_histogram = [
        {"bin_start": round(bins[i], 2), "bin_end": round(bins[i + 1], 2), "count": int(hist_vals[i])}
        for i in range(len(hist_vals))
    ]

    # 3. Temperature stats by product
    temp_by_product = []
    for pid, grp in df.groupby("product_id"):
        temp_by_product.append({
            "product_id": pid,
            "avg_temp": round(float(grp["avg_temp_c"].mean()), 2),
            "min_temp": round(float(grp["avg_temp_c"].min()), 2),
            "max_temp": round(float(grp["avg_temp_c"].max()), 2),
            "std_temp": round(float(grp["avg_temp_c"].std()), 2),
            "windows": len(grp),
            "critical_pct": round(float((grp["risk_tier"] == "CRITICAL").sum() / len(grp) * 100), 1),
        })

    # 4. Phase distribution with risk breakdown
    phase_stats = []
    for phase, grp in df.groupby("transit_phase"):
        tier_counts = grp["risk_tier"].value_counts().to_dict()
        phase_stats.append({
            "phase": str(phase),
            "total": len(grp),
            "critical": tier_counts.get("CRITICAL", 0),
            "high": tier_counts.get("HIGH", 0),
            "medium": tier_counts.get("MEDIUM", 0),
            "low": tier_counts.get("LOW", 0),
            "avg_score": round(float(grp["final_score"].mean()), 4),
        })

    # 5. Container-level aggregations
    container_stats = []
    for (sid, cid), grp in df.groupby(["shipment_id", "container_id"]):
        container_stats.append({
            "shipment_id": sid,
            "container_id": cid,
            "product_id": grp["product_id"].iloc[0],
            "windows": len(grp),
            "max_score": round(float(grp["final_score"].max()), 4),
            "avg_score": round(float(grp["final_score"].mean()), 4),
            "avg_temp": round(float(grp["avg_temp_c"].mean()), 2),
            "risk_tier": grp.sort_values("final_score", ascending=False).iloc[0]["risk_tier"],
            "critical_windows": int((grp["risk_tier"] == "CRITICAL").sum()),
            "high_windows": int((grp["risk_tier"] == "HIGH").sum()),
            "phases": grp["transit_phase"].unique().tolist(),
        })
    container_stats.sort(key=lambda c: c["max_score"], reverse=True)

    return {
        "tier_by_phase": tier_by_phase,
        "score_histogram": score_histogram,
        "temp_by_product": temp_by_product,
        "phase_stats": phase_stats,
        "container_stats": container_stats[:200],
    }


# Helpers

def _build_shipment_summaries(
    df: pd.DataFrame, top_n: Optional[int] = 10,
) -> List[ShipmentSummary]:
    groups = df.groupby("shipment_id")
    summaries = []
    for sid, grp in groups:
        tier_vc = grp["risk_tier"].value_counts()
        total = len(grp)
        summaries.append(ShipmentSummary(
            shipment_id=sid,
            containers=grp["container_id"].unique().tolist(),
            products=grp["product_id"].unique().tolist(),
            total_windows=total,
            latest_risk_tier=grp.sort_values("window_start" if "window_start" in grp.columns else "window_id").iloc[-1]["risk_tier"],
            max_fused_score=round(float(grp["final_score"].max()), 4),
            pct_critical=round(tier_vc.get("CRITICAL", 0) / total * 100, 1),
            pct_high=round(tier_vc.get("HIGH", 0) / total * 100, 1),
        ))
    summaries.sort(key=lambda s: s.max_fused_score, reverse=True)
    if top_n:
        return summaries[:top_n]
    return summaries


def _row_to_window(row) -> WindowRisk:
    return WindowRisk(
        window_id=row["window_id"],
        shipment_id=row["shipment_id"],
        container_id=row["container_id"],
        product_id=row["product_id"],
        leg_id=row["leg_id"],
        window_start=str(row.get("window_start", "")),
        window_end=str(row.get("window_end", "")),
        transit_phase=str(row.get("transit_phase", "")),
        avg_temp_c=round(float(row.get("avg_temp_c", 0)), 2),
        det_score=round(float(row.get("det_score", 0)), 4),
        ml_score=round(float(row.get("ml_score", 0)), 4),
        final_score=round(float(row.get("final_score", 0)), 4),
        risk_tier=row.get("risk_tier", "LOW"),
        det_rules_fired=str(row.get("det_rules_fired", "")),
        recommended_actions=str(row.get("recommended_actions", "")),
        requires_human_approval=bool(row.get("requires_human_approval", False)),
    )


def _load_audit_records() -> List[dict]:
    records = []
    all_paths = (
        sorted(AUDIT_DIR.glob("audit_*.jsonl"))
        + sorted(AUDIT_DIR.glob("compliance_events.jsonl"))
        + sorted(AUDIT_DIR.glob("guardrail_findings.jsonl"))
    )
    for path in all_paths:
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if line:
                        records.append(json.loads(line))
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not read audit file %s: %s", path, exc)
    return records
