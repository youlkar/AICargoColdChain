# Agent Activity Redesign — Working Notes (context tracker)

Reference doc for resuming this work if the session disconnects. Companion to the spec
at `docs/superpowers/specs/2026-06-20-agent-activity-redesign-design.md` and the plan at
`docs/superpowers/plans/2026-06-20-agent-activity-redesign.md`.

## Conversation history / decisions made

1. **Trigger:** User wants to redesign the whole app UI (easier on the eyes, intuitive,
   beautiful, info-dense where needed). Starting with Agent Activity page since it's the
   most complex/cluttered.
2. **Pain points identified:** all of: too much on screen at once, hard to follow a live
   run, generic/dated visual style, hard to find past runs.
3. **No specific product reference** (not Linear/Grafana/Stripe) — went with a from-
   -scratch recommendation instead.
4. **Page architecture decision:** hybrid of "drill-down" (calm list at rest) + "live ops"
   (compact strip only while running) + dedicated full-page run detail route (not inline
   card expansion, not a side drawer) — full page chosen because detail content is heavy
   (compliance/audit fields) and deep-linking a run matters for this domain.
5. **Visual language decision:** keep dark theme as base aesthetic, but cut accent palette
   down to **semantic-only** colors (ok/warn/crit/info), remove competing
   glow/blur/gradient-border effects stacked together, keep Sora/Inter/Roboto Mono type
   system as-is.
6. **Visual companion used:** approved two mockups (browser-based, via
   `.superpowers/brainstorm/` — gitignored, not in this repo's tracked files):
   - `agent-activity-v1.html` — rest-state run list + conditional live strip + light/dark
     toggle demo. **Approved, liked it.**
   - `run-detail-v1.html` — single timeline replacing pipeline-stepper + wave-lanes +
     registry, with a left meta panel for audit/telemetry fields, expand-on-click per
     timeline step. **Approved, liked it**, with explicit note: "we can add more details
     later as needed" — i.e. the timeline-step expansion is the extensibility point, not a
     reason to add new top-level widgets.
7. **Theme infra discovery:** light/dark toggle **already exists** and is production-ready
   — `ThemeContext.jsx` (`useTheme()`/`toggleTheme()`), persists to `localStorage`,
   defaults to dark, toggle UI lives in `TopBar.jsx`'s user menu. Confirmed via code read,
   not assumption. **Decision: reuse as-is, do not build new theme plumbing.**
8. **Color token decision:** redefine the *meaning* of existing tokens rather than adding
   new ones:
   - `--accent-emerald` → ok / success / resolved / done
   - `--accent-amber` → warn / pending / needs attention
   - `--accent-red` → crit / high risk / blocking / error
   - `--accent-cyan` → info / neutral highlight / active state / links
   - Violet (`--accent-violet` / hardcoded `#8b5cf6` / Tailwind `violet-*` classes) is
     **dropped as a status/category color** within Agent Activity. The one exception: kept
     for the "LLM thinking" live-stream indicator only (a transient state, not a status).
   - Risk tiers (LOW/MED/HIGH/CRITICAL) should map onto the same ok/warn/crit scale rather
     than their own independent palette. **Note:** `lib/colors.js` currently defines
     `TIER_COLORS` with its own hex values (`#ef4444/#f97316/#eab308/#22c55e`) completely
     independent of the CSS variable tokens — this is a real inconsistency the redesign
     fixes (tier colors should resolve to the same `--accent-*` tokens).
9. **Theme defaults decision:** keep dark as first-load default (existing behavior
   unchanged), persist in localStorage (existing behavior unchanged), toggle stays in
   header/sidebar (existing location unchanged) — **no work needed here**, just don't
   break it.
10. **Scope boundary:** this spec/plan covers **Agent Activity only**. Other pages
    (Monitoring, Shipments, Audit Log, Approvals, System Graph) are explicitly out of
    scope but should eventually inherit the same patterns (semantic color, timeline
    structure) in later passes — noted in the spec as future work, not started.
11. **Testing infra decision:** dashboard has **zero test runner today** (no
    vitest/jest, no existing `*.test.jsx` files anywhere). Decision: add Vitest + React
    Testing Library, write real unit tests for pure logic (status/color/tier mapping
    functions, timeline-step-building logic) and component render tests; **visual/layout
    correctness is checked manually in-browser per task**, not via snapshot tests.
12. **Detail view navigation decision:** full-page route (`/agent/runs/:windowId`), not a
    slide-in drawer — recommended for compliance/deep-link reasons, user deferred to this
    recommendation explicitly.

## Key existing code facts (verified by direct file reads, not assumed)

- Frontend: React 19.2.4, Vite 8.0.4, Tailwind 4.2.2, react-router-dom 7.14.0,
  lucide-react 1.7.0, recharts 3.8.1. No prebuilt UI component library.
- `AgentActivity.jsx` is ~999 lines, single file, contains: `AgentRegistry`,
  `PipelineSteps`, `WaveLane`, `WaveLanesPanel`, `LiveStreamPanel`, `DecisionCard`,
  `EVENT_STYLES` dict, and the top-level `AgentActivity` default export.
- `useApi('/orchestrator/history?limit=30')` → `{ data, loading, error, refetch }`.
- `useWebSocket([...eventNames])` → `{ messages, connected, clearMessages }`, subscribes
  to: `orchestrator_decision`, `approval_decided`, `approval_executed`,
  `approval_confirmed`, `tool_executed`.
- `ThemeContext.jsx` — full content captured in spec/plan; do not modify.
- `index.css` dark tokens (`:root`) and light tokens (`html.light`) — both blocks exist,
  symmetric, lines ~3-30 and ~137-157 respectively (line numbers approximate, re-verify
  before editing since file may have shifted).
- `lib/agents.js` — `AGENTS` array (8 agents, each with `id/name/icon/color/desc/wave`),
  `WAVE_AGENTS` (`{1: [...], 2: [...]}`), `WAVE_BADGE`, `COLOR_MAP` (Tailwind class
  strings per named color, e.g. `violet/cyan/indigo/amber/blue/emerald/rose/red`),
  `getAgentMeta(toolId)`, `isDeferredStep(s)`, `getPlanCoverage(d)`.
- `lib/colors.js` — `TIER_COLORS` (hex, independent of CSS vars — flagged as
  inconsistency above), `TIER_ORDER`.
- Shared components (`components/shared/`): `AgentChip.jsx`, `StatCard.jsx`,
  `States.jsx` (Skeleton/EmptyState/ErrorState/etc.), `ColdChainPulse.jsx`. All reusable
  as-is.
- `App.jsx` — `NAV` array (lines ~21-30) and `<Routes>` block (lines ~127-137); adding the
  new route means adding one `<Route path="/agent/runs/:windowId" element={...} />` line;
  NAV itself doesn't need a new entry (it's reached by clicking a list row, not top-level
  nav).
- No backend changes needed — `/orchestrator/history` already carries every field the
  detail view needs (window_id, risk_tier, timestamp, draft_plan, revised_plan,
  reflection_notes, observation, observation_issues, confidence, replan_count, etc.)

## Open questions intentionally deferred to implementation time (per spec)

- Exact fetch strategy for `/agent/runs/:windowId` (filter from the already-fetched
  `/orchestrator/history` list in client state vs. a dedicated single-run fetch) — to be
  decided in the plan/implementation, not blocking.
- Final home for the static "agent registry" reference content (kept on Agent Activity
  page, collapsed, by default).
