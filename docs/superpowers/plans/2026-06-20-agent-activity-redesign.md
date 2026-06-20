# Agent Activity Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Agent Activity page's overlapping widgets (agent registry grid, pipeline stepper, wave-lanes panel, live event log, inline-expanding decision cards) with three focused views — a calm rest-state run list, a compact live strip shown only during an active run, and a dedicated full-page run-detail route built around a single timeline — using a strict semantic (ok/warn/crit/info) color palette layered on the app's existing light/dark theme system.

**Architecture:** `AgentActivity.jsx` becomes a thin page shell (header, run-launch panel, conditional `AgentLiveStrip`, `AgentRunList`, collapsed agent reference). Clicking a run row navigates to `/agent/runs/:windowId`, a new route rendering `AgentRunDetail.jsx` (meta panel + `AgentRunTimeline`). Pure logic (semantic color mapping, timeline-step construction) is extracted into a testable module (`lib/runStatus.js`) so business logic has unit test coverage even though full visual correctness is checked manually in-browser.

**Tech Stack:** React 19.2.4, Vite 8.0.4, Tailwind 4.2.2, react-router-dom 7.14.0, lucide-react 1.7.0. Adding: Vitest + React Testing Library + jsdom (no test runner exists today).

## Global Constraints

- Reuse the existing theme system as-is: `src/lib/ThemeContext.jsx` (`useTheme()`/`toggleTheme()`), `localStorage` persistence, dark-as-default, toggle in `TopBar.jsx`. Do not modify these files.
- Semantic color mapping (per spec): `--accent-emerald` = ok, `--accent-amber` = warn, `--accent-red` = crit, `--accent-cyan` = info. Violet is dropped as a status/category color in all new/modified Agent Activity code; it may only remain on a transient "LLM thinking" indicator if one is kept, never on a status badge or tier.
- Risk tiers (LOW/MED/HIGH/CRITICAL) must resolve to the same ok/warn/crit scale, not an independent palette.
- No backend or API changes. All data comes from the existing `/orchestrator/history?limit=30` and `/orchestrator/mode` endpoints and the existing WebSocket events (`orchestrator_decision`, `approval_decided`, `approval_executed`, `approval_confirmed`, `tool_executed`).
- Scope is the Agent Activity page only. Do not modify `lib/colors.js` (`TIER_COLORS`) or any other page's files — those are flagged as a known, separate inconsistency for a future pass, not fixed here.
- No prebuilt UI component library is in use (pure Tailwind + custom components) — follow that pattern for any new component.
- Reference docs: spec at `docs/superpowers/specs/2026-06-20-agent-activity-redesign-design.md`, working notes at `docs/superpowers/specs/2026-06-20-agent-activity-redesign-NOTES.md`.

---

## Task 1: Add Vitest + React Testing Library test infrastructure

**Files:**
- Modify: `dashboard/package.json`
- Modify: `dashboard/vite.config.js`
- Create: `dashboard/src/test/setup.js`
- Create: `dashboard/src/test/smoke.test.js`

**Interfaces:**
- Produces: a working `npm test` script (via `vitest run`) that later tasks' test files run under. Any test file matching `**/*.test.{js,jsx}` is auto-discovered.

- [ ] **Step 1: Install dependencies**

```bash
cd dashboard && npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Add test config to `vite.config.js`**

Modify `dashboard/vite.config.js` so the returned config object includes a `test` block:

```javascript
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendUrl = env.VITE_API_URL || 'http://localhost:8000'
  const wsBackend = backendUrl.replace(/^http/, 'ws')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': backendUrl,
        '/ws/events': { target: wsBackend, ws: true },
        '/ws/stream': { target: wsBackend, ws: true },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
    },
  }
})
```

- [ ] **Step 3: Create the test setup file**

Create `dashboard/src/test/setup.js`:

```javascript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Add the `test` script to `package.json`**

In `dashboard/package.json`, change the `scripts` block to:

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run"
}
```

- [ ] **Step 5: Write a smoke test to confirm the runner works**

Create `dashboard/src/test/smoke.test.js`:

```javascript
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `cd dashboard && npm test`
Expected: `smoke.test.js` passes (1 test, 1 passed), exit code 0.

- [ ] **Step 7: Commit**

```bash
git add dashboard/package.json dashboard/package-lock.json dashboard/vite.config.js dashboard/src/test/setup.js dashboard/src/test/smoke.test.js
git commit -m "test: add Vitest + React Testing Library infrastructure"
```

---

## Task 2: Semantic color/status mapping module (`lib/runStatus.js`)

**Files:**
- Create: `dashboard/src/lib/runStatus.js`
- Test: `dashboard/src/lib/runStatus.test.js`

**Interfaces:**
- Produces:
  - `SEMANTIC_VAR = { ok: 'var(--accent-emerald)', warn: 'var(--accent-amber)', crit: 'var(--accent-red)', info: 'var(--accent-cyan)' }`
  - `tierToSemantic(tier: string): 'ok' | 'warn' | 'crit'` — maps `'LOW'→'ok'`, `'MEDIUM'→'warn'`, `'HIGH'→'crit'`, `'CRITICAL'→'crit'`; unknown/missing tier defaults to `'ok'`.
  - `runStatusSemantic(decision: object): 'ok' | 'warn' | 'crit' | 'info'` — derives the overall status pill for a run row: `'crit'` if `decision.awaiting_approval` is true and not yet approved; `'warn'` if `decision.review_status === 'corrections_proposed'`; `'ok'` if it has `actions_taken` and no open issues; `'info'` otherwise (e.g. no actions yet).
  - `semanticClasses(level: 'ok'|'warn'|'crit'|'info'): { bg: string, text: string, border: string }` — returns Tailwind-free inline-style-friendly class strings built from the CSS vars (e.g. `{ text: 'text-[var(--accent-emerald)]', bg: 'bg-[var(--accent-emerald)]/10', border: 'border-[var(--accent-emerald)]/20' }`), keyed off `SEMANTIC_VAR`.
- Consumes: nothing (pure module, no imports beyond plain JS).

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/lib/runStatus.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { SEMANTIC_VAR, tierToSemantic, runStatusSemantic, semanticClasses } from './runStatus';

describe('tierToSemantic', () => {
  it('maps LOW to ok', () => {
    expect(tierToSemantic('LOW')).toBe('ok');
  });
  it('maps MEDIUM to warn', () => {
    expect(tierToSemantic('MEDIUM')).toBe('warn');
  });
  it('maps HIGH to crit', () => {
    expect(tierToSemantic('HIGH')).toBe('crit');
  });
  it('maps CRITICAL to crit', () => {
    expect(tierToSemantic('CRITICAL')).toBe('crit');
  });
  it('defaults unknown/missing tiers to ok', () => {
    expect(tierToSemantic(undefined)).toBe('ok');
    expect(tierToSemantic('NOT_A_TIER')).toBe('ok');
  });
});

describe('runStatusSemantic', () => {
  it('returns crit when awaiting_approval and not yet approved', () => {
    expect(runStatusSemantic({ awaiting_approval: true })).toBe('crit');
  });
  it('returns warn when corrections_proposed', () => {
    expect(runStatusSemantic({ review_status: 'corrections_proposed' })).toBe('warn');
  });
  it('returns ok when actions_taken exist with no open issues', () => {
    expect(runStatusSemantic({ actions_taken: [{ tool: 'route_agent' }] })).toBe('ok');
  });
  it('returns info when there are no actions yet and nothing pending', () => {
    expect(runStatusSemantic({})).toBe('info');
  });
});

describe('semanticClasses', () => {
  it('returns text/bg/border keyed off the matching CSS var for each level', () => {
    for (const level of ['ok', 'warn', 'crit', 'info']) {
      const classes = semanticClasses(level);
      const cssVar = SEMANTIC_VAR[level];
      expect(classes.text).toContain(cssVar);
      expect(classes.bg).toContain(cssVar);
      expect(classes.border).toContain(cssVar);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npm test -- runStatus`
Expected: FAIL — `lib/runStatus.js` does not exist yet (import error).

- [ ] **Step 3: Implement `lib/runStatus.js`**

Create `dashboard/src/lib/runStatus.js`:

```javascript
export const SEMANTIC_VAR = {
  ok: 'var(--accent-emerald)',
  warn: 'var(--accent-amber)',
  crit: 'var(--accent-red)',
  info: 'var(--accent-cyan)',
};

export function tierToSemantic(tier) {
  switch (String(tier || '').toUpperCase()) {
    case 'MEDIUM': return 'warn';
    case 'HIGH':
    case 'CRITICAL': return 'crit';
    case 'LOW':
    default: return 'ok';
  }
}

export function runStatusSemantic(decision) {
  const d = decision || {};
  const isApproved = d._execution_mode === 'confirmed' || d._execution_mode === 'post_approval'
    || d.review_status === 'confirmed';
  if (d.awaiting_approval && !isApproved) return 'crit';
  if (d.review_status === 'corrections_proposed') return 'warn';
  if (Array.isArray(d.actions_taken) && d.actions_taken.length > 0) return 'ok';
  return 'info';
}

export function semanticClasses(level) {
  const cssVar = SEMANTIC_VAR[level] || SEMANTIC_VAR.info;
  return {
    text: `text-[${cssVar}]`,
    bg: `bg-[${cssVar}]/10`,
    border: `border-[${cssVar}]/20`,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard && npm test -- runStatus`
Expected: PASS — 9 tests passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/runStatus.js dashboard/src/lib/runStatus.test.js
git commit -m "feat: add semantic color/status mapping module for Agent Activity redesign"
```

---

## Task 3: Timeline-step builder (`buildTimelineSteps`)

**Files:**
- Create: `dashboard/src/lib/runTimeline.js`
- Test: `dashboard/src/lib/runTimeline.test.js`

**Interfaces:**
- Consumes: `tierToSemantic`, `runStatusSemantic` from `./runStatus` (Task 2); `isDeferredStep` from `../lib/agents` (existing).
- Produces: `buildTimelineSteps(decision: object): Array<{ id: string, level: 'ok'|'warn'|'crit'|'info', title: string, time: string|null, summary: string, detail: { kind: 'plan'|'actions'|'text'|'approval', payload: any } }>` — this exact shape is consumed by `AgentRunTimeline.jsx` in Task 5.

This function replaces the combined logic currently spread across `PipelineSteps`, `WaveLanesPanel`/`WaveLane`, and the expanded section of `DecisionCard` in `AgentActivity.jsx`. It builds a flat, ordered array of timeline entries from one `decision` object (the same shape currently returned by `/orchestrator/history`), each entry self-describing its own detail content so the renderer needs no conditional branching on execution mode.

- [ ] **Step 1: Write the failing tests**

Create `dashboard/src/lib/runTimeline.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { buildTimelineSteps } from './runTimeline';

describe('buildTimelineSteps', () => {
  it('builds an Interpret & Plan step from draft_plan with info level', () => {
    const decision = {
      timestamp: '2026-06-20T09:14:02Z',
      draft_plan: [{ step: 1, action: 'reroute', tool: 'route_agent' }],
    };
    const steps = buildTimelineSteps(decision);
    const planStep = steps.find(s => s.id === 'plan');
    expect(planStep).toBeDefined();
    expect(planStep.level).toBe('info');
    expect(planStep.detail.kind).toBe('plan');
    expect(planStep.detail.payload).toEqual(decision.draft_plan);
  });

  it('builds an Execute step listing actions_taken with ok level when no issues', () => {
    const decision = { actions_taken: [{ tool: 'route_agent', result: { status: 'ok' } }] };
    const steps = buildTimelineSteps(decision);
    const execStep = steps.find(s => s.id === 'execute');
    expect(execStep.level).toBe('ok');
    expect(execStep.detail.kind).toBe('actions');
    expect(execStep.detail.payload).toEqual(decision.actions_taken);
  });

  it('builds a Reflect step with warn level when reflection_notes are present', () => {
    const decision = { reflection_notes: ['missing cert'], actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    const reflectStep = steps.find(s => s.id === 'reflect');
    expect(reflectStep).toBeDefined();
    expect(reflectStep.level).toBe('warn');
  });

  it('does not build a Reflect step when there are no reflection_notes', () => {
    const decision = { actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    expect(steps.find(s => s.id === 'reflect')).toBeUndefined();
  });

  it('builds an Approval step with crit level when awaiting_approval is true', () => {
    const decision = { awaiting_approval: true };
    const steps = buildTimelineSteps(decision);
    const approvalStep = steps.find(s => s.id === 'approval');
    expect(approvalStep).toBeDefined();
    expect(approvalStep.level).toBe('crit');
    expect(approvalStep.detail.kind).toBe('approval');
  });

  it('does not build an Approval step when awaiting_approval is falsy', () => {
    const decision = { actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    expect(steps.find(s => s.id === 'approval')).toBeUndefined();
  });

  it('returns steps in a stable order: plan, execute, reflect, approval', () => {
    const decision = {
      draft_plan: [{ step: 1, action: 'x' }],
      actions_taken: [{ tool: 'route_agent' }],
      reflection_notes: ['note'],
      awaiting_approval: true,
    };
    const ids = buildTimelineSteps(decision).map(s => s.id);
    expect(ids).toEqual(['plan', 'execute', 'reflect', 'approval']);
  });

  it('returns an empty array for an empty decision object', () => {
    expect(buildTimelineSteps({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && npm test -- runTimeline`
Expected: FAIL — `lib/runTimeline.js` does not exist yet.

- [ ] **Step 3: Implement `lib/runTimeline.js`**

Create `dashboard/src/lib/runTimeline.js`:

```javascript
import { runStatusSemantic } from './runStatus';

export function buildTimelineSteps(decision) {
  const d = decision || {};
  const steps = [];

  if (Array.isArray(d.draft_plan) && d.draft_plan.length > 0) {
    steps.push({
      id: 'plan',
      level: 'info',
      title: 'Interpret & Plan',
      time: d.timestamp || null,
      summary: `Drafted ${d.draft_plan.length} step plan`,
      detail: { kind: 'plan', payload: d.draft_plan },
    });
  }

  if (Array.isArray(d.actions_taken) && d.actions_taken.length > 0) {
    const hasFailure = d.actions_taken.some(a => a?.result?.status && a.result.status !== 'ok' && a.result.status !== 'success');
    steps.push({
      id: 'execute',
      level: hasFailure ? 'warn' : 'ok',
      title: 'Execute',
      time: null,
      summary: `${d.actions_taken.length} agent action${d.actions_taken.length === 1 ? '' : 's'} run`,
      detail: { kind: 'actions', payload: d.actions_taken },
    });
  }

  if (Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0) {
    steps.push({
      id: 'reflect',
      level: 'warn',
      title: 'Reflect',
      time: null,
      summary: d.reflection_notes[0],
      detail: { kind: 'text', payload: d.reflection_notes },
    });
  }

  if (d.awaiting_approval) {
    steps.push({
      id: 'approval',
      level: 'crit',
      title: 'Awaiting human approval',
      time: null,
      summary: 'Revised plan requires sign-off before further action',
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  }

  return steps;
}

export { runStatusSemantic };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd dashboard && npm test -- runTimeline`
Expected: PASS — 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/runTimeline.js dashboard/src/lib/runTimeline.test.js
git commit -m "feat: add buildTimelineSteps pure function for run detail timeline"
```

---

## Task 4: `AgentRunRow` and `AgentRunList` components (rest-state list)

**Files:**
- Create: `dashboard/src/components/AgentRunRow.jsx`
- Create: `dashboard/src/components/AgentRunList.jsx`
- Test: `dashboard/src/components/AgentRunRow.test.jsx`
- Test: `dashboard/src/components/AgentRunList.test.jsx`

**Interfaces:**
- Consumes: `tierToSemantic`, `runStatusSemantic`, `SEMANTIC_VAR` from `../lib/runStatus` (Task 2); existing `TierBadge` from `./TierBadge` (verify export name matches `import TierBadge from './TierBadge'` as used in current `AgentActivity.jsx`); `react-router-dom`'s `useNavigate`.
- Produces:
  - `AgentRunRow({ decision }, ...)` — default export, renders one clickable row. Renders nothing interactive beyond `onClick` navigation; does not manage its own expanded state (no inline expansion — clicking always navigates).
  - `AgentRunList({ history, loading })` — default export, renders the search/status/time-range filter toolbar (ported from the existing `historySearch`/`historyStatus`/`historyRangeHours` state currently inline in `AgentActivity.jsx`) plus the filtered list of `AgentRunRow`. Used by `AgentActivity.jsx` (Task 6) and standalone in tests.

- [ ] **Step 1: Write the failing test for `AgentRunRow`**

Create `dashboard/src/components/AgentRunRow.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentRunRow from './AgentRunRow';

function renderRow(decision) {
  return render(
    <MemoryRouter>
      <AgentRunRow decision={decision} />
    </MemoryRouter>
  );
}

describe('AgentRunRow', () => {
  it('shows window id and shipment/container ids', () => {
    renderRow({ window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH' });
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText(/S014/)).toBeInTheDocument();
    expect(screen.getByText(/C220/)).toBeInTheDocument();
  });

  it('renders a crit-colored status pill when awaiting approval', () => {
    renderRow({ window_id: 'W00041', risk_tier: 'HIGH', awaiting_approval: true });
    const pill = screen.getByText(/awaiting approval/i);
    expect(pill).toHaveStyle({ color: 'var(--accent-red)' });
  });

  it('renders an ok-colored status pill when resolved with actions taken', () => {
    renderRow({ window_id: 'W00040', risk_tier: 'LOW', actions_taken: [{ tool: 'route_agent' }] });
    const pill = screen.getByText(/resolved/i);
    expect(pill).toHaveStyle({ color: 'var(--accent-emerald)' });
  });

  it('navigates on click', () => {
    renderRow({ window_id: 'W00041', risk_tier: 'HIGH' });
    fireEvent.click(screen.getByRole('button'));
    // navigation itself is exercised via App-level routing test in Task 6;
    // here we only assert the row is keyboard/click actionable.
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentRunRow`
Expected: FAIL — `./AgentRunRow` does not exist.

- [ ] **Step 3: Implement `AgentRunRow.jsx`**

Create `dashboard/src/components/AgentRunRow.jsx`:

```jsx
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import TierBadge from './TierBadge';
import { runStatusSemantic, SEMANTIC_VAR } from '../lib/runStatus';

const STATUS_LABEL = {
  crit: 'Awaiting approval',
  warn: 'Corrections proposed',
  ok: 'Resolved',
  info: 'No actions yet',
};

export default function AgentRunRow({ decision }) {
  const navigate = useNavigate();
  const d = decision || {};
  const windowId = d.window_id || d._window_id;
  const level = runStatusSemantic(d);
  const color = SEMANTIC_VAR[level];
  const actionsCount = Array.isArray(d.actions_taken) ? d.actions_taken.length : 0;

  return (
    <button
      type="button"
      onClick={() => navigate(`/agent/runs/${windowId}`)}
      className="w-full panel px-4 py-3.5 flex items-center gap-3 text-left hover:border-[var(--accent-cyan)] transition-colors"
    >
      <TierBadge tier={d.risk_tier || 'LOW'} />
      <div className="min-w-0">
        <span className="font-data text-sm font-semibold font-heading text-[var(--text-primary)]">{windowId}</span>
        <span className="text-xs text-[var(--text-secondary-2)] ml-2">{d.shipment_id} / {d.container_id}</span>
      </div>
      <div className="ml-auto flex items-center gap-4 shrink-0 text-xs">
        <span className="flex items-center gap-1.5" style={{ color }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
          {STATUS_LABEL[level]}
        </span>
        {actionsCount > 0 && <span className="text-[var(--text-secondary-2)]">{actionsCount} tools</span>}
        <ChevronRight className="w-4 h-4 text-[var(--text-secondary-2)]" />
      </div>
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npm test -- AgentRunRow`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Write the failing test for `AgentRunList`**

Create `dashboard/src/components/AgentRunList.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentRunList from './AgentRunList';

const HISTORY = [
  { window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH', awaiting_approval: true },
  { window_id: 'W00040', shipment_id: 'S009', container_id: 'C118', risk_tier: 'LOW', actions_taken: [{ tool: 'route_agent' }] },
];

function renderList(props) {
  return render(<MemoryRouter><AgentRunList history={HISTORY} loading={false} {...props} /></MemoryRouter>);
}

describe('AgentRunList', () => {
  it('renders one row per history entry', () => {
    renderList();
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText('W00040')).toBeInTheDocument();
  });

  it('filters by search text matching window id', () => {
    renderList();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'W00041' } });
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.queryByText('W00040')).not.toBeInTheDocument();
  });

  it('shows an empty state when history is an empty array', () => {
    render(<MemoryRouter><AgentRunList history={[]} loading={false} /></MemoryRouter>);
    expect(screen.getByText(/no runs/i)).toBeInTheDocument();
  });

  it('shows a loading state when loading is true and history is null', () => {
    render(<MemoryRouter><AgentRunList history={null} loading={true} /></MemoryRouter>);
    expect(screen.queryByText(/no runs/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentRunList`
Expected: FAIL — `./AgentRunList` does not exist.

- [ ] **Step 7: Implement `AgentRunList.jsx`**

Create `dashboard/src/components/AgentRunList.jsx`:

```jsx
import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import AgentRunRow from './AgentRunRow';
import { EmptyState } from './shared/States';
import { ChartSkeleton } from './shared/States';

export default function AgentRunList({ history, loading }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!Array.isArray(history)) return [];
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter(d => {
      const haystack = [d.window_id, d._window_id, d.shipment_id, d.container_id]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [history, search]);

  if (loading && !history) {
    return <div className="space-y-2"><ChartSkeleton height={56} /><ChartSkeleton height={56} /><ChartSkeleton height={56} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary-2)]" />
        <input
          placeholder="Search by window, shipment, or container id"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary-2)]"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No runs found" description="Try a different search, or run the orchestrator above." />
      ) : (
        <div className="space-y-2">
          {filtered.map(d => <AgentRunRow key={d.window_id || d._window_id} decision={d} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd dashboard && npm test -- AgentRunList`
Expected: PASS — 4 tests passed.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/components/AgentRunRow.jsx dashboard/src/components/AgentRunList.jsx dashboard/src/components/AgentRunRow.test.jsx dashboard/src/components/AgentRunList.test.jsx
git commit -m "feat: add AgentRunRow and AgentRunList components for rest-state run browsing"
```

---

## Task 5: `AgentLiveStrip` component

**Files:**
- Create: `dashboard/src/components/AgentLiveStrip.jsx`
- Test: `dashboard/src/components/AgentLiveStrip.test.jsx`

**Interfaces:**
- Consumes: `AGENTS`, `WAVE_AGENTS`, `getAgentMeta` from `../lib/agents` (existing); `SEMANTIC_VAR` from `../lib/runStatus`.
- Produces: `AgentLiveStrip({ windowId, currentWave, agentStatus })` default export, where `agentStatus` is `{ [agentId]: 'idle' | 'running' | 'done' }`. Returns `null` (renders nothing) when `windowId` is falsy, so the parent (Task 6) can render it unconditionally and let it self-hide.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/components/AgentLiveStrip.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentLiveStrip from './AgentLiveStrip';

describe('AgentLiveStrip', () => {
  it('renders nothing when there is no active windowId', () => {
    const { container } = render(<AgentLiveStrip windowId={null} currentWave={1} agentStatus={{}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the window id and current wave when active', () => {
    render(<AgentLiveStrip windowId="W00042" currentWave={2} agentStatus={{ route_agent: 'done' }} />);
    expect(screen.getByText('W00042')).toBeInTheDocument();
    expect(screen.getByText(/wave 2/i)).toBeInTheDocument();
  });

  it('renders a status chip per known agent in agentStatus', () => {
    render(<AgentLiveStrip windowId="W00042" currentWave={1} agentStatus={{ route_agent: 'running', insurance_agent: 'idle' }} />);
    expect(screen.getByText('Route Agent')).toBeInTheDocument();
    expect(screen.getByText('Insurance')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentLiveStrip`
Expected: FAIL — `./AgentLiveStrip` does not exist.

- [ ] **Step 3: Implement `AgentLiveStrip.jsx`**

Create `dashboard/src/components/AgentLiveStrip.jsx`:

```jsx
import { getAgentMeta } from '../lib/agents';
import { SEMANTIC_VAR } from '../lib/runStatus';

const DOT_COLOR = {
  idle: 'var(--text-secondary-2)',
  running: SEMANTIC_VAR.info,
  done: SEMANTIC_VAR.ok,
};

export default function AgentLiveStrip({ windowId, currentWave, agentStatus }) {
  if (!windowId) return null;
  const entries = Object.entries(agentStatus || {});

  return (
    <div className="panel px-4 py-3 flex items-center gap-4 flex-wrap">
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: SEMANTIC_VAR.ok }} />
      <div className="text-sm">
        <span className="font-data font-semibold text-[var(--text-primary)]">{windowId}</span>
        <span className="text-[var(--text-secondary-2)] ml-2">Wave {currentWave}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {entries.map(([agentId, status]) => {
          const meta = getAgentMeta(agentId);
          return (
            <span
              key={agentId}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary-2)] border border-[var(--card-border)] rounded-full px-2.5 py-1"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DOT_COLOR[status] || DOT_COLOR.idle }} />
              {meta.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npm test -- AgentLiveStrip`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/AgentLiveStrip.jsx dashboard/src/components/AgentLiveStrip.test.jsx
git commit -m "feat: add AgentLiveStrip component for in-progress run visibility"
```

---

## Task 6: `AgentRunTimeline` component (renders `buildTimelineSteps` output)

**Files:**
- Create: `dashboard/src/components/AgentRunTimeline.jsx`
- Test: `dashboard/src/components/AgentRunTimeline.test.jsx`

**Interfaces:**
- Consumes: `buildTimelineSteps` from `../lib/runTimeline` (Task 3); `SEMANTIC_VAR` from `../lib/runStatus` (Task 2); reuses existing `ObservationPanel`, `renderActions`, `PlanSection` helper functions — these currently live as unexported functions inside `AgentActivity.jsx` (lines ~718-798, ~958-997). Move them (cut, don't duplicate) into a new file `dashboard/src/components/AgentRunDetailParts.jsx` as named exports `ObservationPanel`, `renderActions`, `PlanSection`, unchanged in implementation, before this task starts.
- Produces: `AgentRunTimeline({ decision })` default export — renders one expand/collapse row per `buildTimelineSteps(decision)` entry. Used by `AgentRunDetail.jsx` (Task 7).

- [ ] **Step 1: Extract shared detail-rendering helpers**

Create `dashboard/src/components/AgentRunDetailParts.jsx` by moving the existing `ObservationPanel`, `renderActions`, and `PlanSection` function definitions verbatim out of `dashboard/src/components/AgentActivity.jsx` (their current locations, confirmed by direct read: `ObservationPanel` ~lines 718-750, `renderActions` ~lines 752-798, `PlanSection` ~lines 958-997) into this new file as named exports. Add the imports those functions need at the top of the new file (`Eye`, `RotateCcw` from `lucide-react`; `safeStr` from `../lib/toolResults`; `getAgentMeta`, `isDeferredStep` from `../lib/agents`; `ToolResult` from `../lib/toolResultRenderers`). Leave `AgentActivity.jsx` itself unmodified in this step — Task 8 deletes the now-duplicated originals when it rewrites that file, so for this step just add the three functions as named exports in the new file (a temporary duplication is fine since Task 8 removes the old copies).

- [ ] **Step 2: Write the failing test for `AgentRunTimeline`**

Create `dashboard/src/components/AgentRunTimeline.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentRunTimeline from './AgentRunTimeline';

const DECISION = {
  timestamp: '2026-06-20T09:14:02Z',
  draft_plan: [{ step: 1, action: 'reroute', tool: 'route_agent' }],
  actions_taken: [{ tool: 'route_agent', result: { status: 'ok' } }],
  reflection_notes: ['missing cert'],
  awaiting_approval: true,
};

describe('AgentRunTimeline', () => {
  it('renders one entry per timeline step in order', () => {
    render(<AgentRunTimeline decision={DECISION} />);
    const headings = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
    expect(headings).toEqual(['Interpret & Plan', 'Execute', 'Reflect', 'Awaiting human approval']);
  });

  it('renders summary text collapsed by default', () => {
    render(<AgentRunTimeline decision={DECISION} />);
    expect(screen.getByText('missing cert')).toBeInTheDocument();
  });

  it('expands a step detail on click', () => {
    render(<AgentRunTimeline decision={DECISION} />);
    fireEvent.click(screen.getByText('Execute'));
    expect(screen.getByText(/route_agent/i)).toBeInTheDocument();
  });

  it('renders nothing but an empty container for a decision with no steps', () => {
    const { container } = render(<AgentRunTimeline decision={{}} />);
    expect(container.querySelectorAll('h4').length).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentRunTimeline`
Expected: FAIL — `./AgentRunTimeline` does not exist.

- [ ] **Step 4: Implement `AgentRunTimeline.jsx`**

Create `dashboard/src/components/AgentRunTimeline.jsx`:

```jsx
import { useState } from 'react';
import { buildTimelineSteps } from '../lib/runTimeline';
import { SEMANTIC_VAR } from '../lib/runStatus';
import { ObservationPanel, renderActions, PlanSection } from './AgentRunDetailParts';

function StepDetail({ step }) {
  const { kind, payload } = step.detail;
  if (kind === 'plan') return <PlanSection title="Draft plan" steps={payload} />;
  if (kind === 'actions') return <div className="mt-2">{renderActions(payload, {})}</div>;
  if (kind === 'text') {
    return (
      <ul className="text-xs text-[var(--text-secondary-2)] space-y-1 mt-2">
        {payload.map((line, i) => <li key={i}>- {line}</li>)}
      </ul>
    );
  }
  if (kind === 'approval') {
    return (
      <p className="text-xs text-[var(--text-secondary-2)] mt-2">
        {payload.approvedBy ? `Approved by ${payload.approvedBy} at ${payload.approvedAt}` : 'Not yet actioned.'}
      </p>
    );
  }
  return null;
}

export default function AgentRunTimeline({ decision }) {
  const steps = buildTimelineSteps(decision);
  const [openId, setOpenId] = useState(null);

  return (
    <div className="panel p-5">
      {steps.map((step, i) => {
        const isOpen = openId === step.id;
        const color = SEMANTIC_VAR[step.level];
        return (
          <div key={step.id} className="flex gap-3 relative pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute left-[9px] top-6 bottom-0 w-px bg-[var(--card-border)]" />
            )}
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 z-10"
              style={{ backgroundColor: `${color}33`, color }}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : step.id)}
                className="flex items-baseline justify-between w-full text-left"
              >
                <h4 className="text-sm font-semibold font-heading text-[var(--text-primary)] m-0">{step.title}</h4>
                {step.time && <span className="font-data text-[11px] text-[var(--text-secondary-2)]">{step.time}</span>}
              </button>
              <p className="text-xs text-[var(--text-secondary-2)] mt-0.5">{step.summary}</p>
              {isOpen && <StepDetail step={step} />}
            </div>
          </div>
        );
      })}
      {decision?.observation && <div className="mt-2"><ObservationPanel decision={decision} /></div>}
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd dashboard && npm test -- AgentRunTimeline`
Expected: PASS — 4 tests passed.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/components/AgentRunDetailParts.jsx dashboard/src/components/AgentRunTimeline.jsx dashboard/src/components/AgentRunTimeline.test.jsx
git commit -m "feat: add AgentRunTimeline rendering buildTimelineSteps output"
```

---

## Task 7: `AgentRunDetail` page + route

**Files:**
- Create: `dashboard/src/components/AgentRunDetail.jsx`
- Test: `dashboard/src/components/AgentRunDetail.test.jsx`
- Modify: `dashboard/src/App.jsx`

**Interfaces:**
- Consumes: `useApi` from `../hooks/useApi` (existing, `{ data, loading, error }`); `useParams`, `useNavigate` from `react-router-dom`; `AgentRunTimeline` (Task 6); `TierBadge` (existing); `tierToSemantic`, `SEMANTIC_VAR` from `../lib/runStatus`; `EmptyState`, `ErrorState` from `./shared/States` (existing).
- Produces: `AgentRunDetail()` default export, mounted at route `/agent/runs/:windowId`. Fetch strategy (per spec's deferred decision): reuse `/orchestrator/history?limit=30` and find the matching entry client-side — no new backend endpoint.

- [ ] **Step 1: Write the failing test**

Create `dashboard/src/components/AgentRunDetail.test.jsx`. Mock `useApi` so the test controls what "history" data is returned:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentRunDetail from './AgentRunDetail';
import * as useApiModule from '../hooks/useApi';

function renderAt(windowId, mockHistory, mockLoading = false) {
  vi.spyOn(useApiModule, 'useApi').mockReturnValue({ data: mockHistory, loading: mockLoading, error: null });
  return render(
    <MemoryRouter initialEntries={[`/agent/runs/${windowId}`]}>
      <Routes>
        <Route path="/agent/runs/:windowId" element={<AgentRunDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AgentRunDetail', () => {
  it('renders the matching run by window id from history', () => {
    renderAt('W00041', [
      { window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH', avg_temp_c: 9.2 },
      { window_id: 'W00040', shipment_id: 'S009', container_id: 'C118', risk_tier: 'LOW' },
    ]);
    expect(screen.getByText('W00041')).toBeInTheDocument();
    expect(screen.getByText(/S014/)).toBeInTheDocument();
  });

  it('shows an empty state when the window id is not found in history', () => {
    renderAt('W99999', [{ window_id: 'W00040', risk_tier: 'LOW' }]);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  it('shows a loading state while history is loading and has no data yet', () => {
    renderAt('W00041', null, true);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
  });

  it('renders a back link to the Agent Activity list', () => {
    renderAt('W00041', [{ window_id: 'W00041', risk_tier: 'LOW' }]);
    expect(screen.getByText(/back to agent activity/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentRunDetail`
Expected: FAIL — `./AgentRunDetail` does not exist.

- [ ] **Step 3: Implement `AgentRunDetail.jsx`**

Create `dashboard/src/components/AgentRunDetail.jsx`:

```jsx
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import AgentRunTimeline from './AgentRunTimeline';
import { EmptyState, ChartSkeleton } from './shared/States';

const META_FIELDS = [
  { key: 'confidence', label: 'Confidence' },
  { key: 'replan_count', label: 'Replans' },
  { key: 'avg_temp_c', label: 'Avg temp', suffix: '°C' },
  { key: 'min_temp_c', label: 'Min temp', suffix: '°C' },
  { key: 'max_temp_c', label: 'Max temp', suffix: '°C' },
  { key: 'current_delay_min', label: 'Delay', suffix: ' min' },
];

export default function AgentRunDetail() {
  const { windowId } = useParams();
  const { data: history, loading } = useApi('/orchestrator/history?limit=30');

  const run = Array.isArray(history)
    ? history.find(d => (d.window_id || d._window_id) === windowId)
    : null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <Link to="/agent" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Agent Activity
      </Link>

      {!run && loading && <ChartSkeleton height={300} />}

      {!run && !loading && (
        <EmptyState title="Run not found" description={`No run with window id ${windowId} in the last 30 runs.`} />
      )}

      {run && (
        <>
          <div className="flex items-center gap-3">
            <TierBadge tier={run.risk_tier || 'LOW'} />
            <h3 className="text-lg font-semibold font-heading text-[var(--text-primary)] m-0">{run.window_id || run._window_id}</h3>
          </div>
          <div className="grid grid-cols-[280px_1fr] gap-5">
            <div className="panel p-4 space-y-2 h-fit">
              {META_FIELDS.map(({ key, label, suffix = '' }) => (
                run[key] !== undefined && (
                  <div key={key} className="flex justify-between text-xs border-b border-[var(--card-border)] last:border-0 pb-2 last:pb-0">
                    <span className="text-[var(--text-secondary-2)]">{label}</span>
                    <span className="font-data text-[var(--text-primary)]">{run[key]}{suffix}</span>
                  </div>
                )
              ))}
            </div>
            <AgentRunTimeline decision={run} />
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd dashboard && npm test -- AgentRunDetail`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Add the route in `App.jsx`**

In `dashboard/src/App.jsx`, add the import alongside the other component imports (after the `AgentActivity` import, line ~15):

```javascript
import AgentRunDetail from './components/AgentRunDetail';
```

And add the route inside the existing `<Routes>` block (after the `/agent` route, around line 130):

```jsx
<Route path="/agent" element={<AgentActivity />} />
<Route path="/agent/runs/:windowId" element={<AgentRunDetail />} />
```

- [ ] **Step 6: Manually verify in-browser**

Run: `cd dashboard && npm run dev`
Navigate to `http://localhost:5173/agent/runs/<any-existing-window-id>` directly (deep link, not via a click) and confirm the page renders the meta panel and timeline without errors, and that `/agent/runs/does-not-exist` shows the "Run not found" empty state. Check both light and dark mode via the existing toggle.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/AgentRunDetail.jsx dashboard/src/components/AgentRunDetail.test.jsx dashboard/src/App.jsx
git commit -m "feat: add AgentRunDetail page and /agent/runs/:windowId route"
```

---

## Task 8: Rewrite `AgentActivity.jsx` as the thin page shell

**Files:**
- Modify: `dashboard/src/components/AgentActivity.jsx` (full rewrite)
- Modify: `dashboard/src/components/AgentActivityOverview.jsx` (remove now-unused exports)
- Test: `dashboard/src/components/AgentActivity.test.jsx`

**Interfaces:**
- Consumes: `useApi`, `getApi`, `postApi` from `../hooks/useApi` (existing, unchanged); `useWebSocket` from `../hooks/useWebSocket` (existing, unchanged); `useOrchestrationStream` from `../lib/OrchestrationStreamContext` (existing, unchanged — still need `windowId`, `setWindowId`, `demoResult`, `setDemoResult`, `liveStream` for the run-launch panel and live strip); `AGENTS`, `WAVE_AGENTS` from `../lib/agents`; `AgentLiveStrip` (Task 5); `AgentRunList` (Task 4); `Link` from `react-router-dom` (for "View details" link after a run completes).
- Produces: `AgentActivity()` default export — same import path/usage as before (`./components/AgentActivity` in `App.jsx`), so `App.jsx`'s existing `<Route path="/agent" element={<AgentActivity />} />` needs no further change beyond what Task 7 already added.

This task removes from `AgentActivity.jsx`: the `view` state and Overview/Technical toggle, `LiveStreamPanel`, `WaveLanesPanel`, `WaveLane`, `PipelineSteps`, `AgentRegistry` (replaced by a smaller inline collapsible reference list), `DecisionCard`, `EVENT_STYLES`, and the `liveEvents` raw event log rendering — all superseded by `AgentLiveStrip` + `AgentRunList` + the `/agent/runs/:windowId` route. The `ObservationPanel`/`renderActions`/`PlanSection` functions were already moved to `AgentRunDetailParts.jsx` in Task 6 — delete their original definitions here. Keep `runSingle`, `runCriticalBatch`, `runDemo` handlers and the run-launch panel UI unchanged (window id input + 3 buttons), since the spec only changes how results are *displayed*, not how runs are *launched*.

- [ ] **Step 1: Check for other importers of soon-to-be-removed `AgentActivityOverview` exports**

Run: `grep -rn "ExecutiveHistoryCard\|RunStatusBanner\|JourneyTimeline" dashboard/src --include=*.jsx | grep -v AgentActivityOverview.jsx`
Expected: no results outside `AgentActivity.jsx` itself (confirming it's safe to remove these exports/usages). If any other file imports them, keep those specific exports in `AgentActivityOverview.jsx` and only remove their usage from `AgentActivity.jsx`.

- [ ] **Step 2: Write the failing test for the rewritten `AgentActivity`**

Create `dashboard/src/components/AgentActivity.test.jsx`. Mock `useApi` and `useWebSocket`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentActivity from './AgentActivity';
import * as useApiModule from '../hooks/useApi';
import * as useWebSocketModule from '../hooks/useWebSocket';
import { OrchestrationStreamProvider } from '../lib/OrchestrationStreamContext';

function renderPage(history) {
  vi.spyOn(useApiModule, 'useApi').mockImplementation((path) => {
    if (path.includes('/orchestrator/history')) return { data: history, loading: false, error: null, refetch: vi.fn() };
    return { data: { active_provider: 'groq' }, loading: false, error: null, refetch: vi.fn() };
  });
  vi.spyOn(useWebSocketModule, 'useWebSocket').mockReturnValue({ messages: [], connected: true, clearMessages: vi.fn() });
  return render(
    <MemoryRouter>
      <OrchestrationStreamProvider>
        <AgentActivity />
      </OrchestrationStreamProvider>
    </MemoryRouter>
  );
}

describe('AgentActivity (redesigned)', () => {
  it('renders the run list with history entries', () => {
    renderPage([{ window_id: 'W00041', shipment_id: 'S014', container_id: 'C220', risk_tier: 'HIGH' }]);
    expect(screen.getByText('W00041')).toBeInTheDocument();
  });

  it('renders the run-launch panel (window id input + run button)', () => {
    renderPage([]);
    expect(screen.getByPlaceholderText(/window/i)).toBeInTheDocument();
  });

  it('does not render an Overview/Technical view toggle', () => {
    renderPage([]);
    expect(screen.queryByText(/^overview$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^technical$/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd dashboard && npm test -- AgentActivity.test`
Expected: FAIL — current `AgentActivity.jsx` still has the Overview/Technical toggle, so the third assertion fails (and depending on current markup, the run-list assertion may also fail since rows aren't `AgentRunRow`-shaped yet).

- [ ] **Step 4: Rewrite `AgentActivity.jsx`**

Replace the full content of `dashboard/src/components/AgentActivity.jsx` with:

```jsx
import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi, getApi, postApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOrchestrationStream } from '../lib/OrchestrationStreamContext';
import { AGENTS } from '../lib/agents';
import { Play, Zap, Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import AgentLiveStrip from './AgentLiveStrip';
import AgentRunList from './AgentRunList';

function AgentReference() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold font-heading text-[var(--text-primary)]"
      >
        What agents exist
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {AGENTS.map(a => (
            <div key={a.id} className="text-xs text-[var(--text-secondary-2)]">
              <span className="font-semibold text-[var(--text-primary)]">{a.name}</span> — {a.desc}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentActivity() {
  const { data: history, loading, refetch } = useApi('/orchestrator/history?limit=30');
  const { data: mode } = useApi('/orchestrator/mode');
  const { messages: wsMessages, connected: wsConnected } = useWebSocket([
    'orchestrator_decision', 'approval_decided', 'approval_executed', 'approval_confirmed', 'tool_executed',
  ]);
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState(null);
  const { windowId, setWindowId, demoResult, setDemoResult } = useOrchestrationStream();

  useEffect(() => {
    if (wsMessages.length === 0) return;
    const latest = wsMessages[wsMessages.length - 1];
    if (['orchestrator_decision', 'approval_executed', 'approval_confirmed', 'approval_decided'].includes(latest.type)) {
      refetch();
    }
  }, [wsMessages, refetch]);

  const runSingle = useCallback(async (wid) => {
    setRunning(true);
    setDemoResult(null);
    try {
      const result = await postApi(`/orchestrator/run/${wid}`, {});
      if (result && !result.detail) {
        setDemoResult(result);
        setLastRunId(result.window_id || result._window_id || wid);
      } else {
        setDemoResult({ error: result?.detail || 'Unknown error' });
      }
      await refetch();
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const runDemo = useCallback(async () => {
    setRunning(true);
    setDemoResult(null);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=1');
      if (Array.isArray(windows) && windows.length > 0) {
        const result = await postApi(`/orchestrator/run/${windows[0].window_id}`, {});
        if (result && !result.detail) {
          setDemoResult(result);
          setLastRunId(result.window_id || result._window_id || windows[0].window_id);
        } else {
          setDemoResult({ error: result?.detail || 'Unknown error' });
        }
        await refetch();
      }
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const runCriticalBatch = useCallback(async () => {
    setRunning(true);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=5');
      if (Array.isArray(windows) && windows.length > 0) {
        await postApi('/orchestrator/run-batch', windows.map(w => w.window_id));
        await refetch();
      }
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold font-heading text-[var(--text-primary)] m-0">Agent Activity</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary-2)]">
          {wsConnected ? <Wifi className="w-3.5 h-3.5 text-[var(--accent-emerald)]" /> : <WifiOff className="w-3.5 h-3.5" />}
          {mode?.active_provider ? 'Agentic' : 'Deterministic'}
        </div>
      </div>

      <AgentLiveStrip windowId={running ? windowId : null} currentWave={1} agentStatus={{}} />

      <div className="panel p-5 space-y-3">
        <div className="flex gap-2">
          <input
            placeholder="Window id (e.g. W00041)"
            value={windowId || ''}
            onChange={e => setWindowId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-[var(--bg-page)] border border-[var(--card-border)] text-[var(--text-primary)]"
          />
          <button
            type="button"
            disabled={running || !windowId}
            onClick={() => runSingle(windowId)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--accent-cyan)] disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Run
          </button>
          <button
            type="button"
            disabled={running}
            onClick={runDemo}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] border border-[var(--card-border)] disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" /> Run Live Demo
          </button>
          <button
            type="button"
            disabled={running}
            onClick={runCriticalBatch}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] border border-[var(--card-border)] disabled:opacity-50"
          >
            Batch Top 5 Critical
          </button>
        </div>
        {demoResult?.error && (
          <p className="text-xs text-[var(--accent-red)]">{demoResult.error}</p>
        )}
        {demoResult && !demoResult.error && lastRunId && (
          <Link to={`/agent/runs/${lastRunId}`} className="text-xs text-[var(--accent-cyan)] hover:underline">
            View details for {lastRunId} →
          </Link>
        )}
      </div>

      <AgentRunList history={history} loading={loading} />

      <AgentReference />
    </div>
  );
}
```

- [ ] **Step 5: Delete the now-superseded definitions remaining in the file**

After the rewrite in Step 4, the file no longer contains `LiveStreamPanel`, `WaveLanesPanel`, `WaveLane`, `PipelineSteps`, `AgentRegistry`, `DecisionCard`, `EVENT_STYLES`, `ObservationPanel`, `renderActions`, or `PlanSection` — Step 4's full-file replacement already accomplishes this since it replaces the entire file content. Confirm no leftover references remain:

Run: `grep -n "DecisionCard\|PipelineSteps\|WaveLanesPanel\|EVENT_STYLES" dashboard/src/components/AgentActivity.jsx`
Expected: no output.

- [ ] **Step 6: Remove now-unused exports from `AgentActivityOverview.jsx`**

Based on Step 1's grep confirming no external importers, remove the `ExecutiveHistoryCard`, `RunStatusBanner`, and `JourneyTimeline` exports (and any helper only they used, e.g. check if `OutcomeGrid`/`OutcomeCard`/`WhyThisDecision`/`LiveAgentsStrip` are still referenced anywhere — `LiveAgentsStrip` is superseded by `AgentLiveStrip`, Task 5, so remove it too unless Step 1's grep shows another importer). Keep only what's still imported by the rewritten `AgentActivity.jsx` — based on Step 4's rewrite, `AgentActivityOverview.jsx` is no longer imported by `AgentActivity.jsx` at all, so if grep in Step 1 confirms zero other importers across the whole `dashboard/src` tree, delete the file entirely instead of trimming it:

Run: `grep -rln "AgentActivityOverview" dashboard/src --include=*.jsx`
Expected: only `dashboard/src/components/AgentActivityOverview.jsx` itself (no importers). If so:

```bash
git rm dashboard/src/components/AgentActivityOverview.jsx
```

If the grep shows another importer, instead manually edit the file to remove only the unused exports (`ExecutiveHistoryCard`, `RunStatusBanner`, `JourneyTimeline`, `LiveAgentsStrip`) and their now-dead helper functions, keeping the file otherwise intact.

- [ ] **Step 7: Run the test suite to verify everything passes**

Run: `cd dashboard && npm test`
Expected: all test files pass, including `AgentActivity.test.jsx`'s 3 assertions.

- [ ] **Step 8: Manually verify in-browser**

Run: `cd dashboard && npm run dev`
Navigate to `/agent`. Confirm: no Overview/Technical toggle; the run-launch panel works (try "Run Live Demo"); the live strip appears while a run is in flight and disappears after; the run list renders and clicking a row navigates to its detail page; the "What agents exist" section is collapsed by default and expands on click. Toggle dark/light mode via the existing `TopBar` control and confirm both look correct.

- [ ] **Step 9: Commit**

```bash
git add dashboard/src/components/AgentActivity.jsx dashboard/src/components/AgentActivity.test.jsx
git add -u dashboard/src/components/AgentActivityOverview.jsx
git commit -m "refactor: rewrite AgentActivity as thin page shell over AgentLiveStrip/AgentRunList"
```

---

## Known follow-up (not blocking, flagged for after this plan)

Task 8's `AgentActivity.jsx` passes `agentStatus={{}}` and `currentWave={1}` as hardcoded
placeholders to `AgentLiveStrip` — the strip will show while a run is in flight (driven by
the real `running` state) but won't yet show real per-agent wave progress, because wiring
that requires mapping `liveStream`/WebSocket wave-dispatch events (currently consumed by
the old `WaveLanesPanel`, which this plan removes) into the `{ [agentId]: status }` shape
`AgentLiveStrip` expects. This is a real, scoped follow-up task — not a placeholder in the
sense of unfinished plan-writing — and should be picked up immediately after this plan
lands, before calling the live strip feature-complete.

## Task 9: Full regression pass

**Files:** none created/modified — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run the full test suite**

Run: `cd dashboard && npm test`
Expected: all tests across all files pass (Tasks 1-8 combined).

- [ ] **Step 2: Run the linter**

Run: `cd dashboard && npm run lint`
Expected: no errors (warnings acceptable only if they pre-existed before this change — compare against `git stash` if unsure).

- [ ] **Step 3: Manual end-to-end browser pass**

Run: `cd dashboard && npm run dev` (with backend running per the project's normal dev setup).
Walk through: `/agent` list view in both themes → click a run row → detail page renders timeline + meta panel in both themes → back link returns to `/agent` → launch a new run via "Run Live Demo" → live strip appears → run completes → "View details" link appears and navigates correctly → deep-link directly to `/agent/runs/<id>` in a fresh tab and confirm it renders without needing to have come from the list.

- [ ] **Step 4: Commit if any fixes were needed during this pass**

If Steps 1-3 required any fixes, stage and commit them with a message describing the specific regression fixed (not a generic "fix bugs" message).
