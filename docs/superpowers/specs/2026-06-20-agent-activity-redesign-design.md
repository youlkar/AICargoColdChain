# Agent Activity Page Redesign — Design Spec

## Background

The Agent Activity page (`dashboard/src/components/AgentActivity.jsx`, ~999 lines) is the
primary view into the LangGraph multi-agent orchestration pipeline. It currently tries to
serve two jobs at once — a live monitoring console and a historical run browser — by
stacking an agent registry grid, a pipeline stepper, a wave-lanes panel, a live event
stream, and inline-expanding "Decision Card" history rows all on one screen. This is the
first page being redesigned; the patterns established here (timeline-as-spine, semantic
color, light/dark via existing tokens) are meant to generalize to the rest of the app
(Monitoring, Shipments, Audit Log, Approvals, etc.) in later passes — but this spec covers
**only** Agent Activity.

Goals: easier on the eyes, intuitive, beautiful, while still surfacing all the information
currently shown (agent reasoning, tool execution results, telemetry/audit fields, approval
state).

## Information architecture

Split the page into two states instead of one dense screen:

1. **Rest state (list view)** — when no run is actively executing, the page is a calm,
   scannable list of past runs (newest first), each row showing: risk tier, shipment/window
   IDs + timestamp, current status, tool count. This replaces the always-expanded "Decision
   Card" rows. Clicking a row navigates to a dedicated detail route — it does not expand
   inline.
2. **Live strip (conditional)** — when a run is actively executing, a single compact strip
   appears above the list showing the active window ID, current wave, and a row of
   per-agent status chips (idle/running/done). It disappears entirely when nothing is
   running, so it never permanently occupies space. This replaces the standing "Live Stream
   Panel" + "Wave Lanes Panel" combination.
3. **Run detail (own route, e.g. `/agent/runs/:windowId`)** — replaces the combination of
   pipeline stepper + wave lanes + agent registry + inline decision detail. A single
   vertical timeline is the canonical representation of a run: one entry per pipeline
   stage (Interpret & Plan, Wave 1 Execute, Reflect, Wave 2 / Revise, Approval, Output).
   Each entry is collapsed to a one-line summary by default and expands on click to show
   its detail (LLM reasoning, tool results, reflection notes) — this satisfies "add more
   detail later as needed" without changing the page structure. A left-hand meta panel
   shows audit/telemetry fields (avg/min/max temp, delay, risk score, confidence, tools
   run, approval status) at a glance, sourced from the same `audit_logs` /
   `/orchestrator/history` fields already used today.
   A "← Back to Agent Activity" link returns to the list. Direct navigation to a detail
   URL must work (no client-only state dependency on having come from the list), since
   deep-linking a specific run is a goal (e.g. for compliance/audit sharing).

The agent registry (the static list of all ~10 agents and what they do) is **not part of
the run detail timeline** — it's reference material, not run data. It moves to a small
collapsible "What agents exist" reference section, retained but de-emphasized, rather than
being a primary fixture of the page.

## Visual design language

- **Theme:** No new theming infrastructure. The app already has a complete, working
  light/dark system: `ThemeContext.jsx` (`useTheme()`/`toggleTheme()`, persists to
  `localStorage`, defaults to dark) and a fully symmetric set of CSS variables in
  `index.css`, toggled via the existing control in `TopBar.jsx`'s user menu. The redesign
  must consume these existing tokens, not introduce parallel ones.
- **Color — semantic only:** Redefine the meaning of the existing accent tokens instead of
  adding new ones:
  - `--accent-emerald` → ok / success / resolved / done
  - `--accent-amber` → warn / pending / needs attention
  - `--accent-red` → crit / high risk / blocking / error
  - `--accent-cyan` → info / neutral highlight / active state / links
  - Violet is dropped as a fifth "category" color across the UI. It is retained only as
    the accent for the live "LLM thinking" stream indicator (a transient, non-status use),
    not as a status or category color anywhere else.
  - Risk tiers (LOW/MED/HIGH) map onto this same ok/warn/crit scale rather than having
    their own independent color set.
- **Reduce competing elevation/glow effects:** the current `.glass-card` blur +
  `.gradient-border` + pulse/glow animations are each acceptable alone but currently get
  stacked. Standardize on one elevation technique for panels (flat fill + 1px border using
  `--card-border`), and reserve animation (pulse dot) strictly for the one thing that is
  genuinely live right now (the active agent in the live strip).
- **Typography:** keep the existing Sora (headings) / Inter (body) / Roboto Mono (data,
  IDs, timestamps) system as-is — no change, just stricter/more consistent application of
  the existing scale for hierarchy instead of leaning on color for hierarchy.

## Components affected

- `AgentActivity.jsx` — restructured into: page header (with view state), conditional live
  strip, run list (rest state).
- New: a run detail route/component (e.g. `AgentRunDetail.jsx`) rendering the timeline +
  meta panel, reachable at `/agent/runs/:windowId`.
- `App.jsx` — add the new route.
- Existing shared components (`AgentChip.jsx`, `StatCard.jsx`, `States.jsx`,
  `ColdChainPulse.jsx`) — reused where they fit (e.g. `AgentChip` for the live strip's
  per-agent chips); no shared component is being redesigned in this pass unless it
  conflicts with the semantic color rule above (e.g. if `AgentChip` hardcodes a non-
  semantic color today, fix it).
- `OrchestrationStreamContext` — reused as-is for live event/WS state; the live strip
  consumes the same wave/agent status data the current Wave Lanes panel uses, just
  rendered more compactly.

## Data flow

No backend or API changes. Existing data sources are sufficient:
- `/orchestrator/history?limit=30` — run list (rest state) and detail lookups.
- `/orchestrator/mode` — unchanged.
- WebSocket events (`orchestrator_decision`, `approval_decided`, `approval_executed`,
  `approval_confirmed`, `tool_executed`) — unchanged, drive the live strip instead of the
  old Live Stream Panel.
- Run detail route resolves a single run by `windowId` from the same history payload (or a
  dedicated fetch if not present in the last 30) — exact fetch strategy (filter from
  existing `/orchestrator/history` list vs. a new single-run endpoint) is an implementation
  detail to resolve during planning, not a design constraint.

## Explicitly out of scope for this spec

- Any other page (Monitoring, Shipments, Audit Log, Approvals, System Graph) — this spec
  covers Agent Activity only, though its patterns (semantic color, timeline structure) are
  intended as the template for those follow-up passes.
- Any new theming mechanism — explicitly reusing what exists.
- New backend endpoints, unless implementation reveals the existing history payload is
  insufficient for single-run detail lookups (to be confirmed during implementation
  planning).

## Open items for implementation planning (not blocking spec approval)

- Exact fetch strategy for the run detail route (reuse list payload vs. new endpoint).
- Whether "What agents exist" reference section lives on the Agent Activity page itself or
  moves elsewhere (e.g. a help/docs panel) — default to keeping it on this page,
  collapsed, unless implementation reveals a better home.
