# Cold-Chain Dashboard Redesign — Design Strategy

Status: in progress. Mockup file: `dashboard-redesign-mockup.html` (same folder).
Live artifact: https://claude.ai/code/artifact/8f41f390-71bc-4cba-939b-d586efaae395
(Always republish the Artifact from this exact repo file path — publishing from a different path,
e.g. a tmp scratch copy, mints a brand-new URL instead of updating this one.)
This is a **standalone, self-contained mockup** (dummy data, inline CSS/JS, no build step) — it does not touch the real React app in `dashboard/src`. It exists to prove out a visual direction before any real components are touched.

## Aesthetic direction: "Clinical Calm"

Requested pivot: the first pass ("cryo-telemetry") was too dark/neon/animated — glowing cyan, pulsing dots, glassy control-room look. User asked for something that reads like a **trustworthy medical/health product**: calm, easy on the eyes, clean, still handles dense operational data well.

Design tenets:
- No glow, no pulse animation, no gradient blobs. Flat panels, soft 1px borders, a subtle drop shadow (`--shadow`) instead of neon.
- Muted, desaturated accent palette — never saturated neon cyan/purple.
- Generous whitespace, calm information density; group related fields instead of stacking flat lists.
- Every page must support both light and dark themes via the same toggle (see Theming below) — this is a hard requirement carried across every new page.

### Typography
- Headings: `Charter, "Iowan Old Style", "Palatino Linotype", Georgia, serif` — gives a refined, editorial/clinical feel, deliberately not a generic sans (avoids "AI slop" look).
- Body/UI: system sans stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`).
- Data/numeric values (scores, IDs, timestamps): `ui-monospace, "SF Mono", Menlo, Consolas, monospace` — always monospace so numbers align and read as "instrument" data.

### Color system (CSS custom properties, defined per theme)
Defined once in `:root[data-theme="light"]` and `:root[data-theme="dark"]`, referenced everywhere via `var(--x)` — never hardcoded hex in component markup.

Core tokens: `--bg-0` (page bg), `--bg-1`/`--panel` (card bg), `--panel-border`, `--hair` (hairline dividers), `--ink-0/1/2` (text primary/secondary/tertiary), `--shadow`.

Semantic accent tokens (each with a `-soft` background variant at ~8-16% opacity for chips/badges):
- `--blue` (teal, `#2f6f6b` light / `#5fb8b0` dark) — primary action color, replaces the old neon cyan.
- `--red` — critical/danger.
- `--amber` — high/warning.
- `--yellow` — medium.
- `--green` — low/resolved/success.

Rule: status/tier colors always pair a `-soft` background with the solid color as text/icon color (e.g. `background:var(--red-soft); color:var(--red)`) — never solid-fill badges.

### Theming mechanism
`data-theme="light|dark"` attribute on `<html>` (technically the root element the script sets it on), toggled by a sun/moon icon button pair in the top bar (`#themeToggle`). Choice persisted to `localStorage` under key `cc-mockup-theme`, defaults to `prefers-color-scheme`. **Every new page must work in both themes out of the box** since it's all driven by the CSS variables — do not introduce page-specific hardcoded colors.

### Layout conventions
- **Navigation is a collapsible left sidebar (`.sidebar` inside `.appshell`), not a top tab bar.** This replaced the original horizontal `.pagenav` underline-tabs after the user asked for each page to be a proper standalone destination reachable via a sidebar rather than sub-tabs of one screen.
  - `.appshell` is a flex row: `.sidebar` (fixed width, `position:sticky; top:0; height:100vh`) + `.main` (flex:1, holds the page content, same `padding:30px 28px 80px` the old `.wrap` used).
  - Sidebar has 3 sections: `.sidebar-top` (brand mark + wordmark + `.sidebar-collapse-btn`), `.sidebar-nav` (the `.sbitem` buttons, one per page, each `<svg icon><span>Label</span>`), `.sidebar-bottom` (the light/dark theme toggle — moved here from the old top bar since there's no longer a persistent top bar).
  - Collapse behavior: `.sidebar.collapsed` shrinks width to 60px via CSS transition; a `.sidebar.collapsed` rule hides all `<span>` labels, the wordmark, and the "Detail Views" section entirely (icon-only rail, primary destinations only) — toggled by `#sidebarCollapseBtn` via plain class toggle in JS, no animation library needed.
  - Two sidebar items — **Run Detail** and **Shipment Detail** — are visually demoted under a `.sidebar-section-lbl` "Detail Views" heading with smaller dot icons (`.sbitem.sub`), since in the real app these are drill-down pages reached by clicking a row, not top-level destinations. They still get their own sidebar entry per the user's request that every mocked page be individually reachable, but the visual hierarchy signals they're secondary.
  - Since there's no more shared top bar, **every page now carries its own in-page header** (title + subtitle + page-specific controls) using the `.apprtop` flex-row pattern that was already established on the Approvals/Agent Activity/Shipments pages — Overview's old shared-topbar content (title, range toggle, GDP pill) was moved inside `#page-overview` using this same pattern for consistency.
  - `showPage(name)` (in the script block) now toggles `.active` on `.sbitem[data-page=name]` instead of the old `#pageNav` buttons — same function name/signature, just re-targeted. Row click-throughs (e.g. clicking a run row to reach Run Detail) still call `showPage('rundetail')` directly.
- A dashed "DESIGN MOCKUP" flag pinned at the very top, above `.appshell` (`.mockup-flag`) — never remove; it's the guardrail that stops this file from being confused with the real app.
- `.panel` is the base card component: white/dark surface, 1px border, border-radius 14px, `box-shadow:var(--shadow)`. Used for every card-like block (KPIs, tables, timeline, etc).
- KPI cards (`.kpi`, `.kpi2`): icon chip top-left or tag top-right, big serif numeral, small caption label.

## Pages built so far (in the single mockup file, switched via top nav)

1. **Overview** (`#page-overview`) — hero stat strip (fleet size / value at risk / escalated windows / CTAs), alert banner, 4 KPI cards, 3-col row (tier distribution donut, cold-chain pulse line chart, live agent activity feed), searchable/filterable shipment risk table. Mirrors `dashboard/src/components/Overview.jsx`.
2. **Agent Activity** (`#page-agent`) — mirrors `AgentActivityV2.jsx`: live/mode status chips, 4 KPI banners, "Run Orchestrator" trigger card, filterable+sortable Recent Runs list, collapsible Agent Roster.
3. **Run Detail** (`#page-rundetail`) — mirrors `AgentRunDetailV2.jsx`: breadcrumb, hero card (tier pill + 5-stat row), decision summary / LLM reasoning info panels, sidebar (status/identifiers/risk bar) + numbered decision timeline with an expandable "Execute" step showing per-agent result cards.
4. **Approvals** (`#page-approvals`) — mirrors `Approvals.jsx`, **with structural UX improvements over the original** (see below), since the original page was identified as confusing.

### Approvals page — specific improvements over the real page (important, carry forward)
The real `Approvals.jsx` renders every card (pending, confirmed, executed, rejected) fully expanded, all at the same visual weight, with three separate flat tag-rows (first-pass / corrections / deferred) and no page-level summary. This gets worse the more history accumulates. Fixes made in the mockup:
- **KPI summary strip** added at the top (Pending Review count, Value at Risk pending, Resolved Today, Avg Response Time) — did not exist in the original.
- **Search box** next to status filter tabs.
- **Collapsed-by-default rows for already-decided approvals** (confirmed/executed/rejected) — one-line summary (tier, ID, outcome, status, time), expandable on click. Only items still needing a decision stay fully expanded. This was the single biggest change.
- **Pending cards restructured into 3 numbered sections** (this was a follow-up refinement after user feedback that the info was "confusing all put together"):
  1. **"What happened"** — action description + the "why" (justification) merged into one `.reasoncard` box, instead of two disconnected paragraphs.
  2. **"Agent activity so far"** — a compact `.toolstable` (colored dot + role label + chips per row: "Already ran" green, "Proposed correction" amber) replacing the old three separate unlabeled-feeling tag rows.
  3. **"Your decision"** — the tool-selection chips sit directly above their own action buttons (Approve & Execute / Skip Corrections / Reject), so the picker and the action are visually and physically tied together.
  - Each section has a small numbered circular badge (`.asection-lbl .num`) to reinforce top-to-bottom read order.

## Interaction patterns established (reuse, don't reinvent per page)
- Segmented pill toggle (`.segtabs`) for time-range style controls.
- Filter chip row (`.fchip` / `.atab`) with an active state in `--blue-soft` + count badges.
- `.searchbox` — icon + input, used identically on every page that needs search.
- Sort/segmented toggle (`.sorttoggle`) for two-way sort controls.
- Score bar (`.score-track` + `.score-fill`) — thin horizontal bar colored by tier, paired with the numeric score in mono font. Reused everywhere a 0–1 score needs a visual + numeric read.
- Accordion pattern (roster, collapsed approval cards, execute-step expansion) — chevron rotates 180°, body toggles via a `.open`/`display:none` class, all vanilla JS (`toggleAppr`, `execToggle`, `rosterToggle` listeners at bottom of file).
- Tier badges (`.tier-badge`, `.tierpill`) always `-soft` background + solid text color per the CRITICAL/HIGH/MEDIUM/LOW palette.

5. **Shipments** (`#page-shipments`) — mirrors `ShipmentList.jsx`, **with additions over the original**: a KPI summary strip (Total Shipments, Critical count, Total Value at Risk, Avg Max Score — none existed before), tier filter tabs with counts, a Risk/Recent sort toggle, and a search box — the original had only the tier filter buttons and no search/sort/summary. Each shipment card keeps the original's always-expanded container breakdown (mini tier donut, per-container score bars, phase/temp metadata) since container counts are typically small; clicking a card header navigates to Shipment Detail.
6. **Shipment Detail** (`#page-shipmentdetail`) — mirrors `ShipmentDetail.jsx`: breadcrumb back to Shipments, container filter tabs, 4-card stats row (tier breakdown donut, risk-by-phase bars **shown as label+bar+value rows via `.phaserow`, not a separate chart-then-list**, temperature range, risk score stats), two timeline charts (temperature; fused/det/ML risk score with tier reference lines), and the window details table. Functionally unchanged from the original — restyled only, since the original's structure (stats → charts → table) was already sound.
7. **Audit Log** (`#page-audit`) — mirrors `AuditLog.jsx`, **with UX improvements**: the original's native `<select>` for "Compliance Records vs. Shipment Runs" was replaced with a segmented tab pair (`#auditViewTabs`, `.atab`) matching the visual language used everywhere else, toggling two pre-built view containers (`#auditCompliance` / `#auditRuns`) via JS instead of conditionally rendering — consistent with how the rest of the mockup avoids raw form selects for primary navigation. Kept the original's KPI stats, most-triggered-rules bar list (restyled as `.barrow` label+bar+count rows, same pattern as Shipment Detail's phase bars), and expandable record rows (`.recrow` + `.recdetail`, 4-column detail grid on expand — same collapsed-by-default philosophy established on the Approvals page). Guardrail-finding rows get their own flagged row style (red-soft background) rather than blending into the regular record list.
8. **Agent Quality** (`#page-agentquality`) — mirrors `AgentQuality.jsx`: range toggle, critical-findings alert banner, 4 KPI cards (Runs / Critical / Warning / Guardrail Escalated %), slim cost+token stat row, "Most-Triggered Guardrail Checks" and "Per-Node Latency" — both re-rendered as `.barrow` rows instead of the original's recharts bar charts, for visual consistency with the rest of the mockup (which uses inline SVG/CSS bars everywhere rather than a charting library) — and an Eval Trend panel (5 mini stats + an SVG line chart of pass-rate history).

## Still to do / natural next candidates
- Any other real page not yet mirrored (e.g. settings) if requested.

## How to resume this work in a fresh conversation
1. Read this file for the design system rules above.
2. Open `dashboard-redesign-mockup.html` in this folder — it's the source of truth, single file, viewable directly in a browser or re-published as a Claude artifact.
3. To extend: add a new `<button data-page="x">` to `#pageNav`, a new `<div class="page" id="page-x">…</div>` before the closing `</div>` of `.wrap`, and reuse the CSS classes documented above rather than inventing new visual language.
4. When publishing/updating the Claude artifact, always target the same file path so it redeploys to the existing URL above rather than minting a new one.
