"""
AI Cargo Monitoring -- Hybrid Risk Scoring Pipeline

LangGraph StateGraph orchestrator.  Each processing step is a graph node;
state flows through:  ingest -> engineer -> deterministic -> ml_train/predict
-> fuse -> log_compliance.

Run modes:
  python pipeline.py train          # train ML model + score full dataset
  python pipeline.py score          # score using saved model (no training)
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, TypedDict

import numpy as np
import pandas as pd
from langgraph.graph import END, StateGraph

from src.compliance_logger import write_audit_log
from src.data_loader import load_and_split, load_product_profiles, load_raw, validate
from src.deterministic_engine import score_dataframe as det_score_df
from src.feature_engineering import engineer_features, prepare_ml_arrays
from src.predictive_model import (
    explain,
    load_model,
    predict,
    predict_with_fallback,
    save_model,
    train_model,
)
from src.risk_fusion import fuse_dataframe

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger("pipeline")


# ── LangGraph State ──────────────────────────────────────────────────

class PipelineState(TypedDict, total=False):
    mode: str                              # "train" or "score"
    profiles: Dict[str, dict]
    df_train: pd.DataFrame
    df_val: pd.DataFrame
    df_test: pd.DataFrame
    df_full: pd.DataFrame                  # all data for scoring pass
    X_train: pd.DataFrame
    y_train: pd.Series
    X_val: pd.DataFrame
    y_val: pd.Series
    X_full: pd.DataFrame
    y_full: pd.Series
    feature_names: List[str]
    model: Any                             # XGBClassifier
    val_metrics: Dict[str, float]
    test_metrics: Dict[str, float]
    shap_explanations: List[List[Dict[str, Any]]]
    scored_df: pd.DataFrame
    audit_log_path: str


# ── Node functions ───────────────────────────────────────────────────

def node_ingest(state: PipelineState) -> dict:
    """Load data, validate, split (train mode) or load full (score mode)."""
    logger.info("NODE  ingest")
    profiles = load_product_profiles()

    if state["mode"] == "train":
        train, val, test, _ = load_and_split()
        return {
            "profiles": profiles,
            "df_train": train,
            "df_val": val,
            "df_test": test,
        }
    else:
        df = load_raw()
        df = validate(df)
        return {"profiles": profiles, "df_full": df}


def node_engineer(state: PipelineState) -> dict:
    """Run feature engineering on all relevant splits."""
    logger.info("NODE  engineer_features")
    profiles = state["profiles"]
    updates: dict = {}

    if state["mode"] == "train":
        for key in ("df_train", "df_val", "df_test"):
            updates[key] = engineer_features(state[key], profiles)
    else:
        updates["df_full"] = engineer_features(state["df_full"], profiles)

    return updates


def node_deterministic(state: PipelineState) -> dict:
    """Run deterministic rule engine on every row."""
    logger.info("NODE  deterministic_scoring")
    profiles = state["profiles"]
    updates: dict = {}

    if state["mode"] == "train":
        for key in ("df_train", "df_val", "df_test"):
            updates[key] = det_score_df(state[key], profiles)
    else:
        updates["df_full"] = det_score_df(state["df_full"], profiles)

    return updates


def node_ml_train(state: PipelineState) -> dict:
    """Prepare ML arrays, train with Optuna, evaluate on val + test."""
    logger.info("NODE  ml_train")
    X_train, y_train, feat_names = prepare_ml_arrays(state["df_train"])
    X_val, y_val, _ = prepare_ml_arrays(state["df_val"])
    X_test, y_test, _ = prepare_ml_arrays(state["df_test"])

    X_val = X_val.reindex(columns=feat_names, fill_value=0)
    X_test = X_test.reindex(columns=feat_names, fill_value=0)

    model, val_metrics = train_model(X_train, y_train, X_val, y_val, n_optuna_trials=30)
    save_model(model)

    y_test_prob = predict(model, X_test)
    from src.predictive_model import _compute_metrics
    test_metrics = _compute_metrics(y_test.values, y_test_prob)
    logger.info("Test metrics: %s", test_metrics)

    return {
        "model": model,
        "feature_names": feat_names,
        "val_metrics": val_metrics,
        "test_metrics": test_metrics,
    }


def node_ml_score(state: PipelineState) -> dict:
    """Score all data with the trained (or loaded) model."""
    logger.info("NODE  ml_score")
    model = state.get("model")
    if model is None:
        model = load_model()

    feat_names = state.get("feature_names")

    if state["mode"] == "train":
        dfs = []
        for key in ("df_train", "df_val", "df_test"):
            part = state[key].copy()
            X, _, _ = prepare_ml_arrays(part)
            if feat_names:
                X = X.reindex(columns=feat_names, fill_value=0)
            part["ml_score"] = predict_with_fallback(model, X)
            dfs.append(part)
        df_all = pd.concat(dfs, ignore_index=True)
    else:
        df_all = state["df_full"].copy()
        X, _, _ = prepare_ml_arrays(df_all)
        if feat_names:
            X = X.reindex(columns=feat_names, fill_value=0)
        df_all["ml_score"] = predict_with_fallback(model, X)

    return {"df_full": df_all, "model": model}


def node_fuse(state: PipelineState) -> dict:
    """Combine deterministic + ML scores, assign tiers."""
    logger.info("NODE  fuse_scores")
    df = fuse_dataframe(state["df_full"])
    return {"df_full": df}


def node_explain(state: PipelineState) -> dict:
    """Compute SHAP explanations for the scored data."""
    logger.info("NODE  shap_explain")
    model = state["model"]
    feat_names = state.get("feature_names")
    df = state["df_full"]

    X, _, _ = prepare_ml_arrays(df)
    if feat_names:
        X = X.reindex(columns=feat_names, fill_value=0)

    explanations = explain(model, X, top_k=5)
    return {"shap_explanations": explanations}


def node_compliance(state: PipelineState) -> dict:
    """Write audit log."""
    logger.info("NODE  compliance_log")
    path = write_audit_log(
        state["df_full"],
        shap_explanations=state.get("shap_explanations"),
    )

    scored_path = Path(__file__).resolve().parent / "artifacts" / "scored_windows.csv"
    scored_path.parent.mkdir(exist_ok=True)
    state["df_full"].to_csv(scored_path, index=False)
    logger.info("Scored DataFrame saved to %s", scored_path)

    return {"audit_log_path": str(path), "scored_df": state["df_full"]}


def node_summary(state: PipelineState) -> dict:
    """Print a summary of the pipeline run."""
    logger.info("NODE  summary")
    df = state["df_full"]
    tier_counts = df["risk_tier"].value_counts()

    print("\n" + "=" * 60)
    print("  PIPELINE COMPLETE -- Risk Scoring Summary")
    print("=" * 60)
    print(f"  Windows scored:  {len(df):,}")
    print(f"  Shipments:       {df['shipment_id'].nunique()}")
    print(f"  Containers:      {df['container_id'].nunique()}")
    print()
    print("  Risk tier distribution:")
    for tier in ["CRITICAL", "HIGH", "MEDIUM", "LOW"]:
        cnt = tier_counts.get(tier, 0)
        pct = cnt / len(df) * 100
        print(f"    {tier:10s}  {cnt:5d}  ({pct:5.1f}%)")
    print()

    if "val_metrics" in state and state["val_metrics"]:
        print("  ML Validation metrics:", state["val_metrics"])
    if "test_metrics" in state and state["test_metrics"]:
        print("  ML Test metrics:      ", state["test_metrics"])

    print(f"\n  Audit log: {state.get('audit_log_path', 'N/A')}")
    print("=" * 60 + "\n")
    return {}


# ── Graph construction ───────────────────────────────────────────────

def _route_after_deterministic(state: PipelineState) -> str:
    """After deterministic scoring, train ML or just score."""
    if state["mode"] == "train":
        return "ml_train"
    return "ml_score"


def build_graph() -> StateGraph:
    graph = StateGraph(PipelineState)

    graph.add_node("ingest", node_ingest)
    graph.add_node("engineer", node_engineer)
    graph.add_node("deterministic", node_deterministic)
    graph.add_node("ml_train", node_ml_train)
    graph.add_node("ml_score", node_ml_score)
    graph.add_node("fuse", node_fuse)
    graph.add_node("explain", node_explain)
    graph.add_node("compliance", node_compliance)
    graph.add_node("summary", node_summary)

    graph.set_entry_point("ingest")
    graph.add_edge("ingest", "engineer")
    graph.add_edge("engineer", "deterministic")
    graph.add_conditional_edges(
        "deterministic",
        _route_after_deterministic,
        {"ml_train": "ml_train", "ml_score": "ml_score"},
    )
    graph.add_edge("ml_train", "ml_score")
    graph.add_edge("ml_score", "fuse")
    graph.add_edge("fuse", "explain")
    graph.add_edge("explain", "compliance")
    graph.add_edge("compliance", "summary")
    graph.add_edge("summary", END)

    return graph


def run_pipeline(mode: str = "train") -> PipelineState:
    graph = build_graph()
    app = graph.compile()
    initial_state: PipelineState = {"mode": mode}
    final_state = app.invoke(initial_state)
    return final_state


# ── CLI ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="AI Cargo Risk Scoring Pipeline")
    parser.add_argument(
        "mode",
        choices=["train", "score"],
        nargs="?",
        default="train",
        help="'train' = train ML model + score all data; 'score' = use saved model",
    )
    args = parser.parse_args()
    run_pipeline(args.mode)


if __name__ == "__main__":
    main()
