# Audit Log — Shipment Runs Toggle

## Problem

`AuditLog.jsx` shows compliance/guardrail records from local JSONL files
(`audit_*.jsonl`, `compliance_events.jsonl`, `guardrail_findings.jsonl`).
These files are not durable — they live on the container's ephemeral disk and
are lost on restart or invisible across replicas.

Separately, `AgentActivityV2.jsx` already shows a durable, richer view of
orchestrator runs via `/api/orchestrator/history` (persisted to Supabase's
`orchestrator_runs` table). The user wants a way to see "latest shipment
runs" — runs manually triggered from the frontend — directly from the Audit
Log page, sorted by date, linked to the existing run-detail page, without
adding a new page/tab.

## Design

**Single toggle control**, added next to the existing tier `<select>` in
`AuditLog.jsx`:

```
<select> Compliance Records (default) | Latest Shipment Runs </select>
```

- **Compliance Records** (default): unchanged current behavior — fetches
  `/audit-logs`, tier filter active, existing stats panel and record cards.
- **Latest Shipment Runs**: fetches `/orchestrator/history?limit=30` instead.
  Tier filter is hidden (doesn't apply to this data shape). Stats panel and
  list rendering switch to a runs-oriented layout.

No backend changes — both endpoints already exist and already return the
data needed.

### Runs view — stats panel

Reuse the `kpiCounts` pattern already proven in `AgentActivityV2.jsx`:
total runs, awaiting-approval count, resolved count. Same 3-tile layout
style as the existing compliance stats panel, swapped in when the toggle is
on `runs` mode.

### Runs view — list cards

One row per history entry, matching `AgentActivityV2.jsx`'s `RunRow`
information density (not a full duplicate implementation — shared visual
language, adapted to `AuditLog.jsx`'s existing card container style):

- Tier badge (reuse `TierBadge`)
- Window ID + shipment/container ID
- Agent chips (which tools ran) — reuse the same `AGENT_CHIP` mapping
- Status (Awaiting / Resolved) — reuse `runStatusSemantic`
- Timestamp (reuse `timeAgo`)
- "View full run →" link to `/agent-v2/runs/{runKey}` (reuse `getRunKey`)

Sort: most-recent-first. The backend already returns
`/orchestrator/history` in reverse-chronological order, so no client sort
control is needed for this view.

### Out of scope

- No changes to the compliance-records view or its data source.
- No backend changes (both endpoints already exist).
- No de-duplication/cross-referencing between compliance records and
  orchestrator runs — the two views are independent data sources, switched
  by the toggle, not merged.
- Not fixing the underlying non-durability of the JSONL-backed compliance
  view — that's a separate, previously-flagged issue.

## Testing

- Toggle switches data source and layout correctly, no console errors.
- Runs view renders real data from a live `backend-orchestrator` deployment,
  links navigate to the correct run-detail page.
- Compliance-records view (default) is visually/functionally unchanged.
