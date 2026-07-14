"""
Minimal FastAPI wrapper around the trained XGBoost spoilage model.
Deployed as an Azure Container App (scale-to-zero). The pipeline calls this
remotely when AZURE_ML_ENDPOINT_URL is set, falling back to the local joblib
file on any failure — this service is never a hard dependency.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import List

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

MODEL_PATH = Path(os.environ.get("MODEL_PATH", "/app/model/xgb_spoilage.joblib"))

app = FastAPI(title="Spoilage Model Serving")
_model = None


@app.on_event("startup")
def load_model() -> None:
    global _model
    _model = joblib.load(MODEL_PATH)


class PredictRequest(BaseModel):
    columns: List[str]
    rows: List[List[float]]


class PredictResponse(BaseModel):
    scores: List[float]


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": _model is not None}


@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    if _model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    try:
        X = pd.DataFrame(req.rows, columns=req.columns)
        scores = _model.predict_proba(X)[:, 1].tolist()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"scores": scores}
