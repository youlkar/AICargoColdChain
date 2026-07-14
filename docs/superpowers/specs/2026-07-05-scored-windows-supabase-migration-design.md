# Design Spec: Migrate scored_windows.csv → Supabase `scored_windows` Table

**Date:** 2026-07-05  
**Status:** Approved  
**Goal:** Eliminate `artifacts/scored_windows.csv` as a production data source. All ML scores are written to and read from a new `scored_windows` Supabase table, making the data layer consistent across Cloud Run instances and consistent with the Overview page's Supabase-backed counts.

---

## Context

The app has two sources of truth for window scores:

- **Overview / Shipments pages** read from `orchestrator_runs` (Supabase) — escalated windows only (MEDIUM/HIGH/CRITICAL).
- **Monitoring charts, `/api/windows`, `/api/analytics`, `/api/auto-triage`** read from `scored_windows.csv` (a file baked into the Docker image) — all 31k windows including LOW.

This causes the Monitoring KPI cards (which use `/risk/overview` → Supabase) to disagree with the charts on the same page (which use `/api/analytics` → CSV). It also means Cloud Run restarts lose any live-streamed windows that were appended to the in-memory DataFrame but never persisted.

---

## Decision: Option B — New `scored_windows` Table

A separate table dedicated to ML outputs, with `window_id` as primary key. Raw telemetry stays in `window_features`; scored outputs live in `scored_windows`. Upserts are idempotent so pipeline re-runs are safe.

---

## Schema

Run once in Supabase SQL editor:

```sql
CREATE TABLE IF NOT EXISTS scored_windows (
    window_id               TEXT PRIMARY KEY,
    shipment_id             TEXT,
    container_id            TEXT,
    product_id              TEXT,
    leg_id                  TEXT,
    window_start            TIMESTAMPTZ,
    window_end              TIMESTAMPTZ,
    transit_phase           TEXT,
    avg_temp_c              FLOAT,
    det_score               FLOAT,
    ml_score                FLOAT,
    final_score             FLOAT,
    risk_tier               TEXT,
    det_rules_fired         TEXT,
    recommended_actions     TEXT,
    requires_human_approval BOOLEAN,
    scored_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scored_windows_shipment ON scored_windows(shipment_id);
CREATE INDEX IF NOT EXISTS idx_scored_windows_risk_tier ON scored_windows(risk_tier);
CREATE INDEX IF NOT EXISTS idx_scored_windows_final_score ON scored_windows(final_score DESC);
```

Columns mirror the CSV exactly. `scored_at` is new — set by the DB on insert, useful for ordering live windows.

---

## Data Flow

### Before (CSV-based)
```
pipeline.py → XGBoost scores 31k rows → scored_windows.csv (baked into image)
                                                    ↓
                                          _get_df() reads file into memory
                                                    ↓
                          /api/analytics, /api/windows, /api/auto-triage
```

Live stream: `/api/ingest` → scores window → `_append_scored_window_to_df()` (in-memory only, lost on restart)

### After (Supabase-backed)
```
pipeline.py → XGBoost scores 31k rows → upsert_scored_windows(df) → scored_windows (Supabase)
                                                    ↓
                                          _get_df() queries Supabase (cached in memory)
                                                    ↓
                          /api/analytics, /api/windows, /api/auto-triage
```

Live stream: `/api/ingest` → scores window → upsert single row to Supabase + update in-memory cache → consistent everywhere

---

## Touch Points (4 files)

### 1. `src/supabase_client.py` — add two functions

**`upsert_scored_windows(df: pd.DataFrame) -> bool`**
- Converts DataFrame to list of dicts, serialises timestamps to ISO strings
- Upserts in batches of 500 rows to avoid Supabase request size limits
- Returns `True` on success, `False` on failure (caller decides whether to fall back)

**`fetch_scored_windows(limit: int = 40000) -> Optional[pd.DataFrame]`**
- Paginates in 1,000-row batches (same pattern as `fetch_window_features`)
- Returns DataFrame with same column dtypes as the CSV
- Returns `None` on error so callers can fall back to CSV

### 2. `pipeline.py` → `node_compliance`

Replace:
```python
state["df_full"].to_csv(scored_path, index=False)
```

With:
```python
# Always write CSV for local dev fallback
state["df_full"].to_csv(scored_path, index=False)
# Upsert to Supabase if available
from src.supabase_client import upsert_scored_windows
upsert_scored_windows(state["df_full"])
```

The CSV write is kept so local development without Supabase credentials still works.

### 3. `backend/app.py` — update `_get_df()` and live ingest

**`_get_df()`** — try Supabase first, fall back to CSV:
```python
def _get_df() -> pd.DataFrame:
    global _df
    if _df is None:
        from src.supabase_client import fetch_scored_windows
        df = fetch_scored_windows()
        if df is not None and not df.empty:
            _df = df
        elif SCORED_CSV.exists():
            _df = pd.read_csv(SCORED_CSV)
        else:
            raise HTTPException(503, "No scored windows available")
    return _df
```

**`_append_scored_window_to_df(scored: dict)`** — persist to Supabase before appending to in-memory cache:
```python
def _append_scored_window_to_df(scored: dict) -> None:
    global _df
    # Persist to Supabase so the row survives restarts
    from src.supabase_client import upsert_scored_windows
    upsert_scored_windows(pd.DataFrame([scored]))
    # Update in-memory cache to keep /api/analytics current without a re-fetch
    if _df is not None:
        _df = pd.concat([_df, pd.DataFrame([scored])], ignore_index=True)
```

### 4. Supabase — one-time bulk insert of existing 31k rows

Re-run `python pipeline.py` after the schema migration. The pipeline will score the data and call `upsert_scored_windows()`, populating the table. No separate migration script needed.

---

## What Does Not Change

- All API route handlers (`/api/windows`, `/api/analytics`, `/api/auto-triage`, etc.)
- All Pydantic response models
- All frontend components — zero frontend changes
- `stream_listener.py` — unchanged, still POSTs to `/api/ingest`
- `orchestrator_runs` table and all Overview/Shipments page logic

---

## Fallback Strategy

| Scenario | Behaviour |
|---|---|
| Supabase unavailable at startup | Falls back to CSV if present; raises 503 if neither available |
| Supabase unavailable during live ingest | `upsert_scored_windows` logs a warning, in-memory cache still updated |
| Pipeline run without Supabase creds | CSV written locally as before; upsert skipped with a warning |

---

## Out of Scope

- Cache TTL / cross-instance cache invalidation (multiple Cloud Run instances may have slightly stale in-memory DFs — acceptable until request volume justifies a shared cache layer)
- Removing the CSV from the repo (keep as local dev artifact; add to `.dockerignore` to exclude from image)
