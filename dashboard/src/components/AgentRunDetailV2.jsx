import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, AlertTriangle, Brain, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import { EmptyState, ChartSkeleton } from './shared/States';
import { humanize } from '../lib/toolResults';
import { SEMANTIC_VAR, runStatusSemantic } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';
// buildTimelineSteps not used — we build richer steps locally
import { getAgentMeta } from '../lib/agents.jsx';
import { ToolResult } from '../lib/toolResultRenderers';
import { timeAgo, formatTimestamp } from '../lib/format';

// ── Human-readable formatter for raw decision/reflection text ────────────────
const AGENT_NAME_MAP = {
  compliance_agent:  'Compliance Agent',
  cold_storage_agent:'Cold Storage Agent',
  route_agent:       'Route Agent',
  insurance_agent:   'Insurance Agent',
  scheduling_agent:  'Scheduling Agent',
  notification_agent:'Notification Agent',
  triage_agent:      'Triage Agent',
  approval_workflow: 'Approval Workflow',
};

// Replace technical tokens with readable equivalents
function humanizeText(raw) {
  if (!raw) return '';
  let s = String(raw);

  // Strip leading prefixes like "QUALITY route_agent: " or "INFO compliance_agent: "
  s = s.replace(/^(QUALITY|INFO|WARN|ERROR|DEBUG)\s+\w+:\s*/i, '');

  // Replace agent tool IDs
  for (const [key, val] of Object.entries(AGENT_NAME_MAP)) {
    s = s.replace(new RegExp(key, 'g'), val);
  }

  // Technical field names → plain English
  s = s
    .replace(/spoilage_probability/g, 'spoilage probability')
    .replace(/route_evaluation/g, 'route evaluation')
    .replace(/primary_issue/g, 'primary issue')
    .replace(/risk_tier/g, 'risk tier')
    .replace(/temp_slope/g, 'temperature slope')
    .replace(/duration_hours/g, 'duration (hours)')
    .replace(/ml_score/g, 'ML score')
    .replace(/fused_risk_score/g, 'risk score')
    .replace(/\bN\/A\b/g, 'not available')
    // Remaining snake_case words → space-separated
    .replace(/_([a-z])/g, (_, c) => ' ' + c);

  // Clean up double spaces
  s = s.replace(/  +/g, ' ').trim();

  // Capitalise first letter
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);

  return s;
}



const STATUS_FIELDS = [
  { key: 'status', label: 'Status', humanize: true },
  { key: 'requires_approval', label: 'Requires approval', bool: true },
  { key: 'replan_count', label: 'Replans' },
];

const ID_FIELDS = [
  { key: 'approval_id', label: 'Approval ID' },
  { key: 'thread_id', label: 'Thread ID' },
];

// ── Circle color by step.level — mirrors mock's tc-ok/warn/info/crit classes ──
const TC = {
  ok:   { light: { bg: 'rgba(5,150,105,.12)',  border: 'rgba(5,150,105,.25)',  color: '#059669' },
          dark:  { bg: 'rgba(52,211,153,.10)', border: 'rgba(52,211,153,.22)', color: '#34d399' } },
  warn: { light: { bg: 'rgba(180,83,9,.12)',   border: 'rgba(180,83,9,.25)',   color: '#b45309' },
          dark:  { bg: 'rgba(251,191,36,.10)', border: 'rgba(251,191,36,.22)', color: '#fbbf24' } },
  info: { light: { bg: 'rgba(14,116,144,.12)', border: 'rgba(14,116,144,.25)', color: '#0e7490' },
          dark:  { bg: 'rgba(34,211,238,.10)', border: 'rgba(34,211,238,.22)', color: '#22d3ee' } },
  crit: { light: { bg: 'rgba(220,38,38,.12)',  border: 'rgba(220,38,38,.25)',  color: '#dc2626' },
          dark:  { bg: 'rgba(248,113,113,.10)', border: 'rgba(248,113,113,.22)', color: '#f87171' } },
};

// Agent card status labels + color variants by tool
const ARC_STATUS = {
  compliance_agent:  { label: 'Completed',           cls: 'arc-status-ok'   },
  cold_storage_agent:{ label: 'Facility identified', cls: 'arc-status-cyan' },
  insurance_agent:   { label: 'Claim prepared',      cls: 'arc-status-warn' },
  scheduling_agent:  { label: 'Pending approval',    cls: 'arc-status-warn' },
  route_agent:       { label: 'Route selected',      cls: 'arc-status-cyan' },
  notification_agent:{ label: 'Sent',                cls: 'arc-status-ok'   },
  triage_agent:      { label: 'Scored',              cls: 'arc-status-ok'   },
  approval_workflow: { label: 'Escalated',           cls: 'arc-status-warn' },
  _default:          { label: 'Completed',           cls: 'arc-status-ok'   },
};

const ARC_STATUS_STYLE = {
  'arc-status-ok':   { bg: 'rgba(5,150,105,.08)',  color: 'var(--accent-emerald,#059669)', border: 'rgba(5,150,105,.20)'  },
  'arc-status-cyan': { bg: 'rgba(14,116,144,.08)', color: 'var(--accent-cyan)',             border: 'rgba(14,116,144,.20)' },
  'arc-status-warn': { bg: 'rgba(180,83,9,.08)',   color: 'var(--accent-amber)',             border: 'rgba(180,83,9,.20)'  },
};
const ARC_STATUS_STYLE_DARK = {
  'arc-status-ok':   { bg: 'rgba(52,211,153,.10)',  color: '#34d399', border: 'rgba(52,211,153,.22)' },
  'arc-status-cyan': { bg: 'rgba(34,211,238,.10)',  color: '#22d3ee', border: 'rgba(34,211,238,.20)' },
  'arc-status-warn': { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.20)' },
};

// ── Agent result card (inside execute expand) ─────────────────────────────────
function AgentCard({ action, decisionMeta, isDark }) {
  const meta = getAgentMeta(action?.tool);
  const Icon = meta.icon;
  const statusMeta = ARC_STATUS[action?.tool] || ARC_STATUS._default;
  const statusStyle = (isDark ? ARC_STATUS_STYLE_DARK : ARC_STATUS_STYLE)[statusMeta.cls];

  // arc-icon bg color — extract hue from meta.color
  const arcIconBg = {
    violet:  isDark ? 'rgba(139,92,246,.15)'  : 'rgba(139,92,246,.12)',
    cyan:    isDark ? 'rgba(34,211,238,.12)'  : 'rgba(34,211,238,.12)',
    indigo:  isDark ? 'rgba(99,102,241,.15)'  : 'rgba(99,102,241,.12)',
    emerald: isDark ? 'rgba(52,211,153,.12)'  : 'rgba(52,211,153,.12)',
    amber:   isDark ? 'rgba(251,191,36,.12)'  : 'rgba(251,191,36,.10)',
    blue:    isDark ? 'rgba(59,130,246,.15)'  : 'rgba(59,130,246,.12)',
    rose:    isDark ? 'rgba(244,63,94,.15)'   : 'rgba(244,63,94,.12)',
    red:     isDark ? 'rgba(248,113,113,.15)' : 'rgba(220,38,38,.12)',
  };
  const iconColorKey = Object.keys(arcIconBg).find(k => meta.color.bg.includes(k)) || 'violet';
  const cardBorder = isDark ? 'rgba(148,163,184,0.10)' : '#e8edf3';
  const cardBg     = isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc';

  return (
    <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: 12, overflow: 'hidden' }}>
      {/* arc-header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px 10px', borderBottom: `1px solid ${cardBorder}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: arcIconBg[iconColorKey], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon style={{ width: 14, height: 14 }} className={meta.color.text} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{meta.name}</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 6, border: `1px solid ${statusStyle.border}`, background: statusStyle.bg, color: statusStyle.color, whiteSpace: 'nowrap' }}>
          {statusMeta.label}
        </span>
      </div>

      {/* arc-body — ToolResult renders the actual result content */}
      {action?.result != null && (
        <div style={{ padding: '12px 14px' }}>
          <ToolResult tool={action.tool} result={action.result} decisionMeta={decisionMeta} />
        </div>
      )}
      {action?.result == null && (
        <div style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text-secondary-2)', fontStyle: 'italic' }}>No result captured</div>
      )}
    </div>
  );
}

// ── Collapsible Execute section — matches mock execute-toggle + execute-expand ─
function ExecuteSection({ payload, decisionMeta, isDark }) {
  const [open, setOpen] = useState(false);
  const actions = Array.isArray(payload) ? payload : [];
  if (actions.length === 0) return null;

  const uniqueTools = [...new Set(actions.map(a => a?.tool).filter(Boolean))];
  const agentNames = uniqueTools.map(t => getAgentMeta(t).name);
  const expandBg = isDark ? 'rgba(255,255,255,0.03)' : '#f8fafc';

  return (
    <div style={{ marginTop: 8 }}>
      {/* execute-toggle */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '7px 10px', borderRadius: 9,
          cursor: 'pointer', border: '1px solid var(--card-border)',
          background: expandBg, userSelect: 'none',
          transition: 'border-color .15s, background .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-cyan)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--card-border)'; }}
      >
        {/* execute-toggle-label */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--text-secondary-2)' }}>
          {/* grid icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <span style={{ color: 'var(--accent-cyan)' }}>{actions.length} agent result{actions.length !== 1 ? 's' : ''}</span>
          <span style={{ color: 'var(--text-secondary-2)', fontWeight: 500 }}>· {agentNames.join(' · ')}</span>
        </div>
        {/* chevron */}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ color: 'var(--text-secondary-2)', transition: 'transform .22s cubic-bezier(.4,0,.2,1)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}
        >
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </div>

      {/* execute-expand */}
      <div
        style={{
          maxHeight: open ? '3000px' : '0px',
          opacity: open ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height .35s cubic-bezier(.4,0,.2,1), opacity .25s ease, margin-top .25s ease',
          marginTop: open ? 10 : 0,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        {actions.map((a, i) => (
          <AgentCard key={`${a?.tool}_${i}`} action={a} decisionMeta={decisionMeta} isDark={isDark} />
        ))}
      </div>
    </div>
  );
}

// ── Single timeline item — mirrors mock's .tl-item structure exactly ──────────
function TimelineStep({ step, decisionMeta, index, isLast, isDark }) {
  const kind = step.detail?.kind || 'text';
  const level = step.level || 'info';
  const tc = (isDark ? TC[level]?.dark : TC[level]?.light) || TC.info.light;

  const timeLabel = step.time
    ? new Date(step.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : null;

  return (
    // .tl-item — flex, gap:14, position:relative, padding-bottom:22 (or 0 for last)
    <div style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 22 }}>
      {/* .tl-line — absolute vertical connector (omit for last item) */}
      {!isLast && (
        <div style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 1, background: 'var(--card-border)' }} />
      )}

      {/* .tc number circle */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 800, position: 'relative', zIndex: 1,
        background: tc.bg, color: tc.color, border: `1.5px solid ${tc.border}`,
      }}>
        {index + 1}
      </div>

      {/* Content — flex-1 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title row with time */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{step.title}</div>
            {/* .tl-sub — for execute step show agent names */}
            {kind === 'actions' && step.summary && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary-2)', marginTop: 1 }}>{step.summary}</div>
            )}
          </div>
          {timeLabel && (
            <div style={{ fontSize: 10, color: 'var(--text-secondary-2)', whiteSpace: 'nowrap', marginTop: 1 }}>{timeLabel}</div>
          )}
        </div>

        {/* .tl-summary — non-execute steps only */}
        {kind !== 'actions' && step.summary && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary-2)', marginTop: 3, lineHeight: 1.55 }}>{step.summary}</div>
        )}

        {/* Plan step — summary only, no expanded list (matches mock) */}

        {/* Execute collapsible */}
        {kind === 'actions' && (
          <ExecuteSection payload={step.detail?.payload} decisionMeta={decisionMeta} isDark={isDark} />
        )}

        {/* Reflection text — payload is array of notes; summary already shows [0], show rest here */}
        {kind === 'text' && Array.isArray(step.detail?.payload) && step.detail.payload.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
            {step.detail.payload.slice(1).map((note, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--text-secondary-2)', lineHeight: 1.55, fontStyle: 'italic' }}>{note}</div>
            ))}
          </div>
        )}

        {/* Approval */}
        {kind === 'approval' && (
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {step.detail?.payload?.approvedBy && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary-2)' }}>
                By: <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{step.detail.payload.approvedBy}</strong>
              </div>
            )}
            {step.detail?.payload?.approvedAt && (
              <div style={{ fontSize: 11, color: 'var(--text-secondary-2)' }}>At: {new Date(step.detail.payload.approvedAt).toLocaleString()}</div>
            )}
            <Link
              to="/approvals"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginTop: 4, padding: '6px 14px', borderRadius: 8,
                background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.25)',
                color: '#fbbf24', fontSize: 12, fontWeight: 700,
                textDecoration: 'none', alignSelf: 'flex-start',
                transition: 'background .15s, border-color .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.18)'; e.currentTarget.style.borderColor = 'rgba(251,191,36,0.45)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.10)'; e.currentTarget.style.borderColor = 'rgba(251,191,36,0.25)'; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
              Go to Approvals
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rich timeline step builder (replaces buildTimelineSteps for V2) ──────────
function buildRichSteps(run) {
  const d = run || {};
  const steps = [];
  const windowId = d.window_id || d._window_id || '';

  // ── Step 1: Risk Triage — always shown ──────────────────────────────────────
  const score = d.fused_risk_score ?? d.max_fused_score ?? d.risk_score ?? d.final_score;
  const drivers = (d.key_drivers || d.ml_top_features || []).slice(0, 3);
  let triageSummary = '';
  if (score != null) {
    triageSummary = `ML scored ${windowId} at ${Number(score).toFixed(4)} — ${d.risk_tier || 'UNKNOWN'} tier triggered.`;
    if (drivers.length > 0) {
      triageSummary += ` Top features: ${drivers.map(f => humanizeText(f)).join(', ')}.`;
    }
  } else {
    triageSummary = `Risk tier: ${d.risk_tier || 'UNKNOWN'}.${d.decision_summary ? ' ' + humanizeText(d.decision_summary) : ''}`;
  }
  steps.push({
    id: 'triage',
    level: d.risk_tier === 'CRITICAL' ? 'crit' : d.risk_tier === 'HIGH' ? 'warn' : 'info',
    title: 'Risk Triage',
    time: d.timestamp || null,
    summary: triageSummary,
    detail: { kind: 'text', payload: null },
  });

  // ── Step 2: LLM Planning (from draft_plan) ───────────────────────────────────
  if (Array.isArray(d.draft_plan) && d.draft_plan.length > 0) {
    const planTools = d.draft_plan
      .map(s => getAgentMeta(s?.tool)?.name || s?.tool || s?.action)
      .filter(Boolean);
    let planningSummary = `Draft plan: ${planTools.join(' → ')}.`;
    if (d.replan_count > 0) {
      planningSummary += ` Replan #${d.replan_count} triggered${d.approval_reason ? ': ' + d.approval_reason : ''}.`;
    }
    steps.push({
      id: 'plan',
      level: 'warn',
      title: d.replan_count > 0
        ? `LLM Planning — Wave 1 (${d.replan_count} replan${d.replan_count > 1 ? 's' : ''})`
        : 'LLM Planning — Wave 1',
      time: null,
      summary: planningSummary,
      detail: { kind: 'plan', payload: d.draft_plan },
    });
  }

  // ── Step 3: Execute (actions_taken + corrective_actions) — before Reflect ────
  const allActions = [
    ...(Array.isArray(d.actions_taken) ? d.actions_taken : []),
    ...(Array.isArray(d.corrective_actions) ? d.corrective_actions : []),
  ];
  if (allActions.length > 0) {
    const agentNames = [...new Set(allActions.map(a => getAgentMeta(a?.tool)?.name).filter(Boolean))];
    const hasFailure = allActions.some(a => a?.result?.status && !['ok', 'success'].includes(a.result.status));
    const waveLabel = d.replan_count > 0 ? `Wave ${d.replan_count + 1}` : 'Wave 1';
    steps.push({
      id: 'execute',
      level: hasFailure ? 'warn' : 'ok',
      title: `Execute — ${waveLabel}`,
      time: null,
      summary: `Ran: ${agentNames.join(', ')}`,
      detail: { kind: 'actions', payload: allActions },
    });
  }

  // ── Step 4: Compliance Hold / Reflect (from reflection_notes) — after Execute
  if (Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0) {
    const noteText = d.reflection_notes.join(' ').toLowerCase();
    const isHold = noteText.includes('hold') || noteText.includes('violation') || noteText.includes('compliance') || noteText.includes('depot') || d.replan_count > 0;
    steps.push({
      id: 'reflect',
      level: 'crit',
      title: isHold ? 'Compliance Hold Applied' : 'Reflect',
      time: null,
      summary: humanizeText(d.reflection_notes[0]),
      detail: { kind: 'text', payload: d.reflection_notes.map(humanizeText) },
    });
  }

  // ── Step 5: Escalation / Awaiting approval ───────────────────────────────────
  if (d.awaiting_approval) {
    steps.push({
      id: 'approval',
      level: 'warn',
      title: 'Escalation — Human Review',
      time: null,
      summary: humanizeText(d.approval_reason || 'Awaiting ops team confirmation before proceeding.'),
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  } else if (d._approved_by || d._approved_at) {
    steps.push({
      id: 'approved',
      level: 'ok',
      title: 'Approved',
      time: d._approved_at || null,
      summary: `Approved by ${d._approved_by || 'operator'}.`,
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  }

  return steps;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentRunDetailV2() {
  const BASE = '/agent-v2';
  const { runKey } = useParams();
  const { data: history, loading } = useApi('/orchestrator/history?limit=30');
  const [isDark, setIsDark] = useState(() => !document.documentElement.classList.contains('light'));
  useEffect(() => {
    const el = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(!el.classList.contains('light')));
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const run = Array.isArray(history)
    ? history.find(d => getRunKey(d) === runKey)
    : null;

  const steps = run ? buildRichSteps(run) : [];
  const level = run ? runStatusSemantic(run) : 'info';
  const tier = run?.risk_tier || 'LOW';
  const windowId = run?.window_id || run?._window_id;
  const decisionMeta = run ? {
    risk_tier: run.risk_tier,
    window_id: windowId,
    shipment_id: run.shipment_id,
    container_id: run.container_id,
  } : {};

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-4">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary-2)]">
        <Link to={BASE} className="hover:text-[var(--text-primary)] transition-colors flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> Agent Activity
        </Link>
        <ArrowRight className="w-3 h-3 opacity-40" />
        <span className="text-[var(--text-primary)] font-semibold font-mono">{windowId || runKey}</span>
      </div>

      {!run && loading && <ChartSkeleton height={300} />}
      {!run && !loading && (
        <EmptyState title="Run not found" description={`No run matching this key in the last 30 runs.`} />
      )}

      {run && (
        <>
          {/* Hero card — always dark navy, matches mock .hero-card */}
          {(() => {
            const riskScore = run.fused_risk_score ?? run.max_fused_score ?? run.risk_score ?? run.final_score;
            const agentsUsed = [...new Set([
              ...(run.actions_taken || []),
              ...(run.corrective_actions || []),
            ].map(a => a?.tool).filter(Boolean))].length;

            // Insurance result — peak temp lives in excursion_summary, value at risk in estimated_loss_usd
            const insResult = [...(run.actions_taken || []), ...(run.corrective_actions || [])]
              .find(a => a?.tool === 'insurance_agent')?.result;
            const peakTemp   = insResult?.excursion_summary?.peak_temp_c
              ?? run.telemetry_snapshot?.max_temp_c
              ?? run.telemetry_snapshot?.peak_temp_c
              ?? null;
            const valueAtRisk = insResult?.estimated_loss_usd
              ?? insResult?.loss_breakdown?.total_estimated_loss_usd
              ?? insResult?.total_estimated_loss_usd
              ?? null;

            // Status label + color
            const statusLabel = run.awaiting_approval ? 'Awaiting Approval'
              : run._approved_by ? 'Approved'
              : level === 'ok' ? 'Resolved'
              : level === 'warn' ? 'Needs Review'
              : 'Completed';
            const statusStyle = run.awaiting_approval
              ? { bg: 'rgba(180,83,9,.15)', border: 'rgba(180,83,9,.25)', lbl: 'rgba(251,191,36,.75)', val: '#fbbf24' }
              : run._approved_by
              ? { bg: 'rgba(5,150,105,.12)',  border: 'rgba(5,150,105,.25)',  lbl: 'rgba(52,211,153,.75)',  val: '#34d399' }
              : { bg: 'rgba(34,211,238,.10)', border: 'rgba(34,211,238,.22)', lbl: 'rgba(34,211,238,.75)',  val: '#22d3ee' };

            // Tier badge colours
            const TIER_BADGE = {
              CRITICAL: { bg: 'rgba(239,68,68,.20)',  border: 'rgba(239,68,68,.35)',  color: '#f87171' },
              HIGH:     { bg: 'rgba(249,115,22,.20)', border: 'rgba(249,115,22,.35)', color: '#fb923c' },
              MEDIUM:   { bg: 'rgba(234,179,8,.20)',  border: 'rgba(234,179,8,.35)',  color: '#fbbf24' },
              LOW:      { bg: 'rgba(52,211,153,.20)', border: 'rgba(52,211,153,.35)', color: '#34d399' },
            };
            const tb = TIER_BADGE[tier] || TIER_BADGE.LOW;

            const heroDiv = 'rgba(148,163,184,0.12)';
            const heroSub = 'rgba(148,163,184,0.8)';

            // Format timestamp like mock: "2026-07-07 14:32 UTC"
            const dispTime = run.timestamp
              ? new Date(run.timestamp).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
              : null;

            const statsRow = [
              { label: 'Risk Score',    value: riskScore != null ? Number(riskScore).toFixed(4) : '—', color: '#f87171' },
              { label: 'Peak Temp',     value: peakTemp  != null ? `${Number(peakTemp).toFixed(1)}°C` : '—', color: '#22d3ee' },
              { label: 'Agents Used',   value: agentsUsed || '—', color: '#f1f5f9' },
              { label: 'Replans',       value: run.replan_count ?? 0, color: '#f1f5f9' },
              { label: 'Value at Risk', value: valueAtRisk != null ? (valueAtRisk >= 1000 ? `$${(valueAtRisk/1000).toFixed(0)}K` : `$${valueAtRisk}`) : '—', color: '#fbbf24' },
            ];

            return (
              <div style={{
                background: 'linear-gradient(135deg,#0c1f3a 0%,#0e3a4f 60%,#0d2b44 100%)',
                borderRadius: 16, padding: '22px 26px',
                border: '1px solid rgba(34,211,238,0.15)',
                color: '#f1f5f9', boxShadow: '0 4px 20px rgba(0,0,0,.20)',
              }}>
                {/* Top row: badge + run info  |  status box */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
                  <div>
                    {/* Tier badge + divider + run info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: '.07em', textTransform: 'uppercase', background: tb.bg, border: `1px solid ${tb.border}`, color: tb.color }}>
                        <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor"><circle cx="5" cy="5" r="5"/></svg>
                        {tier}
                      </span>
                      <div style={{ width: 1, height: 16, background: heroDiv }} />
                      <span style={{ fontSize: 11, color: heroSub }}>
                        {windowId}{run.shipment_id ? ` · ${run.shipment_id}` : ''}
                      </span>
                    </div>
                    {/* Main ID: shipment / container */}
                    <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-.02em', fontFamily: "'SF Mono','Fira Code',monospace" }}>
                      {run.shipment_id && run.container_id
                        ? `${run.shipment_id} / ${run.container_id}`
                        : run.shipment_id || run.container_id || windowId}
                    </div>
                    {/* Subtitle */}
                    <div style={{ fontSize: 12, color: heroSub, marginTop: 4 }}>
                      Multi-wave agentic orchestration
                      {agentsUsed ? ` · ${agentsUsed} agent${agentsUsed !== 1 ? 's' : ''} dispatched` : ''}
                      {dispTime ? ` · ${dispTime}` : ''}
                    </div>
                  </div>

                  {/* Status box */}
                  <div style={{ padding: '8px 16px', borderRadius: 10, background: statusStyle.bg, border: `1px solid ${statusStyle.border}`, textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: statusStyle.lbl, marginBottom: 3 }}>Status</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: statusStyle.val }}>{statusLabel}</div>
                  </div>
                </div>

                {/* Stats row */}
                <div style={{ display: 'flex', marginTop: 18, borderTop: `1px solid ${heroDiv}`, paddingTop: 16 }}>
                  {statsRow.map((s, i) => (
                    <div key={s.label} style={{ flex: 1, textAlign: 'center', borderRight: i < statsRow.length - 1 ? `1px solid ${heroDiv}` : 'none', padding: '0 14px' }}>
                      <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.01em', color: s.color, fontFamily: "'SF Mono','Fira Code',monospace" }}>{s.value}</div>
                      <div style={{ fontSize: 10, color: heroSub, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 3 }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Decision summary */}
          {run.decision_summary && (
            <div className="panel flex items-start gap-3 p-4">
              <AlertTriangle className="w-[18px] h-[18px] text-[var(--accent-amber)] flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary-2)] mb-1">Decision Summary</p>
                <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-snug">{humanizeText(run.decision_summary)}</p>
              </div>
            </div>
          )}

          {/* LLM Reasoning */}
          {run.llm_reasoning && (
            <div className="panel flex items-start gap-3 p-4">
              <Brain className="w-[18px] h-[18px] text-violet-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary-2)] mb-1">LLM Reasoning</p>
                <p className="text-[12px] text-[var(--text-secondary-2)] leading-relaxed italic">{humanizeText(run.llm_reasoning)}</p>
              </div>
            </div>
          )}

          {/* 2-col layout: sidebar + timeline */}
          <div className="grid grid-cols-[220px_1fr] gap-4 items-start">

            {/* Sidebar */}
            <div className="panel p-4 space-y-0.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)] mb-2">Status</p>
              {STATUS_FIELDS.map(({ key, label, humanize: sh, bool }) => {
                const val = run[key];
                if (val === undefined || val === null) return null;
                const display = bool ? (val ? 'Yes' : 'No') : (sh ? humanize(val) : val);
                const color = key === 'status' ? SEMANTIC_VAR[level] : undefined;
                return (
                  <div key={key} className="flex justify-between items-center text-[12px] border-b border-[var(--card-border)] last:border-0 py-1.5 gap-2">
                    <span className="text-[var(--text-secondary-2)]">{label}</span>
                    <span className="font-data text-right font-semibold" style={color ? { color } : { color: 'var(--text-primary)' }}>{String(display)}</span>
                  </div>
                );
              })}
              <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)] mt-3 mb-1">Identifiers</p>
              {ID_FIELDS.map(({ key, label }) =>
                run[key] != null ? (
                  <div key={key} className="flex justify-between items-start text-[12px] border-b border-[var(--card-border)] last:border-0 py-1.5 gap-2">
                    <span className="text-[var(--text-secondary-2)] flex-shrink-0">{label}</span>
                    <span className="font-data text-[var(--text-primary)] text-right break-all text-[11px]">{run[key]}</span>
                  </div>
                ) : null
              )}
              {run.max_fused_score != null && (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)] mt-3 mb-1">Risk</p>
                  <div className="flex justify-between items-center text-[12px] py-1.5 gap-2">
                    <span className="text-[var(--text-secondary-2)]">Fused Score</span>
                    <span className="font-data font-bold text-[var(--text-primary)]">{run.max_fused_score.toFixed(4)}</span>
                  </div>
                  <div className="mt-1">
                    <div className="h-1.5 rounded-full bg-[var(--card-border)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, run.max_fused_score * 100).toFixed(0)}%`, background: TIER_GRAD[tier] || TIER_GRAD.LOW }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Timeline — .timeline-card */}
            <div className="panel" style={{ padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Decision Timeline</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--bg-page)', color: 'var(--text-secondary-2)', border: '1px solid var(--card-border)' }}>
                  {steps.length} step{steps.length !== 1 ? 's' : ''}
                </span>
              </div>
              {steps.length === 0 ? (
                <p className="text-[12px] text-[var(--text-secondary-2)]">No timeline data available.</p>
              ) : (
                steps.map((step, i) => (
                  <TimelineStep
                    key={step.id || i}
                    step={step}
                    decisionMeta={decisionMeta}
                    index={i}
                    isLast={i === steps.length - 1}
                    isDark={isDark}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
