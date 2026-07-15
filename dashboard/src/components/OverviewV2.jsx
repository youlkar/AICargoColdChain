import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import {
  AlertTriangle, ShieldCheck, CheckCircle2, ChevronRight, DollarSign,
  Boxes, ClipboardCheck, Ship, Check,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { TIER_ORDER } from '../lib/colors';
import { getAgentHeadline } from '../lib/agentSummaries';
import { timeAgo, formatUsdCompact } from '../lib/format';
import { safeStr, humanize } from '../lib/toolResults';
import { runStatusSemantic } from '../lib/runStatus';
import './overview-v2.css';

// Tier -> ov2 palette token mapping (soft bg + solid text/dot color).
const TIER_STYLE = {
  CRITICAL: { bg: 'var(--ov2-red-soft)', color: 'var(--ov2-red)' },
  HIGH:     { bg: 'var(--ov2-amber-soft)', color: 'var(--ov2-amber)' },
  MEDIUM:   { bg: 'var(--ov2-yellow-soft)', color: 'var(--ov2-yellow)' },
  LOW:      { bg: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' },
};

// Agent feed chip styles, recolored to the ov2 palette (blue/red/amber/green only —
// keeps the feed calm instead of a chip per agent in a different neon hue).
const AGENT_FEED_CHIPS = {
  triage_agent:       { label: 'RISK',       tone: 'red' },
  risk_agent:         { label: 'RISK',       tone: 'red' },
  compliance_agent:   { label: 'COMPLIANCE', tone: 'blue' },
  notification_agent: { label: 'NOTIFY',     tone: 'blue' },
  approval_workflow:  { label: 'ESCALATION', tone: 'amber' },
  cold_storage_agent: { label: 'STORAGE',    tone: 'blue' },
  scheduling_agent:   { label: 'SCHEDULE',   tone: 'blue' },
  route_agent:        { label: 'ROUTE',      tone: 'blue' },
  insurance_agent:    { label: 'INSURE',     tone: 'green' },
  _default:           { label: 'AGENT',      tone: 'blue' },
};
const TONE_VARS = {
  red:   { bg: 'var(--ov2-red-soft)', color: 'var(--ov2-red)' },
  amber: { bg: 'var(--ov2-amber-soft)', color: 'var(--ov2-amber)' },
  blue:  { bg: 'var(--ov2-blue-soft)', color: 'var(--ov2-blue)' },
  green: { bg: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' },
};

// Best-effort real-data proxy for "value at risk averted" — sums the
// insurance agent's estimated loss figure for a run, when it ran one.
// Not a fabricated number: it's whatever the orchestrator's insurance_agent
// actually computed for that run, only aggregated here for the exec rollup.
function extractInsuranceLoss(run) {
  const actions = [...(run.actions_taken || []), ...(run.corrective_actions || [])];
  const result = actions.find(a => a?.tool === 'insurance_agent')?.result;
  if (!result) return 0;
  return result.loss_breakdown?.total_estimated_loss_usd ?? result.estimated_loss_usd ?? 0;
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="ov2-panel" style={{ padding: '8px 12px', boxShadow: 'var(--ov2-shadow)' }}>
      <p className="ov2-serif" style={{ fontWeight: 600, fontSize: 12, color: 'var(--ov2-ink-0)' }}>{d.shipment || d.name}</p>
      <p className="ov2-mono" style={{ fontSize: 11, color: 'var(--ov2-ink-2)', marginTop: 2 }}>
        {d.score != null ? `Score: ${d.score.toFixed(4)}` : `Count: ${d.value}`}
      </p>
    </div>
  );
}

// Self-contained sparkline for the highest-risk shipment's temperature trend —
// scoped locally instead of reusing the shared <ColdChainPulse/> so this page's
// restyle can't affect the original Overview page which still renders that component.
function PulseChart({ windows }) {
  const { path, fill, hasData } = useMemo(() => {
    const withTemp = (windows || []).filter(w => typeof w.avg_temp_c === 'number');
    if (withTemp.length < 2) return { hasData: false };
    const values = withTemp.map(w => w.avg_temp_c);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => ({
      x: (i / (values.length - 1)) * 600,
      y: 130 - ((v - min) / range) * 110,
    }));
    const line = pts.reduce((d, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }, '');
    return { path: line, fill: `${line} L${pts.at(-1).x},140 L0,140 Z`, hasData: true };
  }, [windows]);

  if (!hasData) {
    return (
      <div className="ov2-empty" style={{ height: 140 }}>
        <p style={{ fontSize: 12 }}>Not enough telemetry to chart a trend yet.</p>
      </div>
    );
  }

  return (
    <svg width="100%" height="140" viewBox="0 0 600 140" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ov2-pulse-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ov2-blue)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--ov2-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#ov2-pulse-grad)" />
      <path d={path} fill="none" stroke="var(--ov2-blue)" strokeWidth="2" />
    </svg>
  );
}

// SVG area chart for the "Value Saved Over Time" trend — built the same way as
// PulseChart, driven by real per-day sums computed from orchestrator history.
function TrendChart({ values }) {
  const path = useMemo(() => {
    if (!values || values.length < 2) return null;
    const max = Math.max(...values, 1);
    const pts = values.map((v, i) => ({
      x: (i / (values.length - 1)) * 560,
      y: 130 - (v / max) * 110,
    }));
    const line = pts.reduce((d, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }, '');
    return `${line} L${pts.at(-1).x},140 L0,140 Z`;
  }, [values]);

  if (!path) {
    return (
      <div className="ov2-empty" style={{ height: 140 }}>
        <p style={{ fontSize: 12 }}>Not enough resolved runs yet to chart a trend.</p>
      </div>
    );
  }

  return (
    <svg width="100%" height="140" viewBox="0 0 560 140" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ov2-trend-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ov2-green)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--ov2-green)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path} fill="url(#ov2-trend-grad)" stroke="var(--ov2-green)" strokeWidth="2.2" />
    </svg>
  );
}

// Executive View range options — mapped to real hours so the backend can
// actually filter by date instead of just handing back "however many records
// happen to fit under a fixed limit."
const EXEC_RANGE_OPTIONS = ['30d', '90d', 'YTD'];
function execRangeHours(rangeKey) {
  if (rangeKey === '30d') return 24 * 30;
  if (rangeKey === '90d') return 24 * 90;
  // YTD: hours since Jan 1 of the current year, computed client-side since
  // it isn't a fixed duration.
  const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
  return Math.max(1, Math.ceil((Date.now() - startOfYear) / 3600000));
}

export default function OverviewV2() {
  const navigate = useNavigate();
  const [view, setView] = useState('exec');
  const [rangeHours, setRangeHours] = useState(24);
  const [execRange, setExecRange] = useState('90d');
  const execHours = execRangeHours(execRange);
  const { data, loading, error, refetch } = useApi(
    `/risk/overview${rangeHours ? `?hours=${rangeHours}` : ''}`, [rangeHours]
  );
  const { data: history } = useApi('/orchestrator/history?limit=200');
  const { data: pendingApprovals } = useApi('/approvals/pending');
  // Executive View is scoped to its own range control (30d/90d/YTD) rather
  // than sharing Operational's 24h/7d/All — these are separate fetches, both
  // filtered server-side by `hours` so the numbers are date-bounded, not just
  // "the last N records regardless of how far back they go."
  const { data: execHistory } = useApi(`/orchestrator/history?limit=200&hours=${execHours}`, [execHours]);
  const { data: execApprovalsAll } = useApi(`/approvals/all?hours=${execHours}`, [execHours]);
  const { data: execAuditRecords } = useApi(`/audit-logs?limit=200&hours=${execHours}`, [execHours]);
  const topShipment = data?.top_risky_shipments?.[0];
  const topShipmentId = topShipment?.shipment_id;
  const { data: pulseWindows } = useApi(`/shipments/${topShipmentId || 'none'}/windows`);

  if (error) {
    return (
      <div className="ov2">
        <div className="ov2-empty">
          <AlertTriangle style={{ width: 28, height: 28, color: 'var(--ov2-red)' }} />
          <p style={{ fontWeight: 600, color: 'var(--ov2-ink-0)', marginTop: 8 }}>Something went wrong</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>{error}</p>
          <button onClick={refetch} className="ov2-btn ov2-btn-primary" style={{ marginTop: 14 }}>Retry</button>
        </div>
      </div>
    );
  }

  const topApproval = (pendingApprovals || []).find(a => a.risk_tier === 'CRITICAL') || (pendingApprovals || [])[0] || null;

  if (loading || !data) {
    return (
      <div className="ov2">
        <div className="ov2-skel" style={{ height: 32, width: 260, marginBottom: 20 }} />
        <div className="ov2-kpis">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="ov2-skel" style={{ height: 100 }} />)}
        </div>
        <div className="ov2-skel" style={{ height: 140, marginBottom: 16 }} />
        <div className="ov2-trio">
          <div className="ov2-skel" style={{ height: 260 }} />
          <div className="ov2-skel" style={{ height: 260 }} />
          <div className="ov2-skel" style={{ height: 260 }} />
        </div>
      </div>
    );
  }

  const pieData = TIER_ORDER.filter(t => data.tier_counts[t]).map(t => ({ name: t, value: data.tier_counts[t] }));
  const totalWindows = pieData.reduce((s, d) => s + d.value, 0);

  const cutoff = rangeHours > 0 ? Date.now() - rangeHours * 3600 * 1000 : 0;
  const recentActions = (history || [])
    .filter(d => !cutoff || new Date(d.timestamp || 0).getTime() >= cutoff)
    .flatMap(d => (Array.isArray(d.actions_taken) ? d.actions_taken : [])
      .filter(a => a && typeof a === 'object')
      .map(a => ({ action: a, timestamp: d.timestamp, windowId: d.window_id || d._window_id, shipmentId: d.shipment_id })))
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 6);

  // Top 3 by risk — the full sortable/filterable list already lives on the
  // dedicated Shipments page, so this stays a glanceable summary + a link
  // across instead of a second copy of the same search/filter UI.
  const topShipments = [...(data.top_risky_shipments || [])]
    .sort((a, b) => (b.max_fused_score || 0) - (a.max_fused_score || 0))
    .slice(0, 3);

  const lastUpdated = (history && history[0]?.timestamp) ? timeAgo(history[0].timestamp) : 'just now';
  const statValues = {
    shipments: data.total_shipments,
    escalated: data.escalated_shipments || 0,
    monitored: data.monitored_shipments || 0,
    critical: data.tier_counts.CRITICAL || 0,
    valueAtRisk: formatUsdCompact(data.total_value_at_risk_usd),
    pendingApprovals: (pendingApprovals || []).length,
  };

  // ── Executive view metrics — scoped to the execRange (30d/90d/YTD) control,
  // filtered server-side by real timestamps (see execHours), then
  // aggregated/reframed in business language. ─────────────────────────────
  const safeExecHistory = Array.isArray(execHistory) ? execHistory : [];
  const resolvedRuns = safeExecHistory.filter(d => runStatusSemantic(d) === 'ok');
  const autoResolvedRate = safeExecHistory.length ? Math.round((resolvedRuns.length / safeExecHistory.length) * 100) : null;
  const valueSaved = resolvedRuns.reduce((s, r) => s + extractInsuranceLoss(r), 0);

  const safeExecApprovalsAll = Array.isArray(execApprovalsAll) ? execApprovalsAll : [];
  const decidedApprovals = safeExecApprovalsAll.filter(a => a.created_at && a.decided_at);
  const avgResolutionMin = decidedApprovals.length
    ? decidedApprovals.reduce((s, a) => s + (new Date(a.decided_at) - new Date(a.created_at)) / 60000, 0) / decidedApprovals.length
    : null;

  const complianceRecords = (Array.isArray(execAuditRecords) ? execAuditRecords : []).filter(r => r.entry_type !== 'guardrail_finding');
  const needsApprovalCount = complianceRecords.filter(r => r.requires_human_approval).length;
  const complianceRate = complianceRecords.length
    ? Math.round(((complianceRecords.length - needsApprovalCount) / complianceRecords.length) * 100)
    : null;

  const ruleCounts = {};
  for (const rec of complianceRecords) {
    for (const rule of (rec.deterministic_rules_fired || [])) ruleCounts[rule] = (ruleCounts[rule] || 0) + 1;
  }
  const topRiskCategories = Object.entries(ruleCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([rule, count]) => ({ label: humanize(rule), count }));
  const maxRuleCount = topRiskCategories.length ? Math.max(...topRiskCategories.map(c => c.count), 1) : 1;

  const dayBuckets = {};
  for (const r of resolvedRuns) {
    const day = (r.timestamp || '').slice(0, 10);
    if (!day) continue;
    dayBuckets[day] = (dayBuckets[day] || 0) + extractInsuranceLoss(r);
  }
  const trendValues = Object.keys(dayBuckets).sort().slice(-10).map(d => dayBuckets[d]);

  const recentWins = [...resolvedRuns]
    .map(r => ({ run: r, loss: extractInsuranceLoss(r) }))
    .sort((a, b) => (b.loss - a.loss) || (new Date(b.run.timestamp) - new Date(a.run.timestamp)))
    .slice(0, 3);

  return (
    <div className="ov2">

      {/* Header — single Overview page now covers both audiences via the view
          toggle below, instead of a separate Executive Summary page/route. */}
      <div className="ov2-topbar">
        <div>
          <h1 className="ov2-title">Cold-Chain Overview</h1>
          <p className="ov2-sub"><span className="ov2-livedot" />{data.total_shipments} active shipments &middot; last updated {lastUpdated}</p>
        </div>
        <div className="ov2-controls">
          <div className="ov2-viewtabs">
            <button className={`ov2-viewtab${view === 'exec' ? ' ov2-active' : ''}`} onClick={() => setView('exec')}>Executive View</button>
            <button className={`ov2-viewtab${view === 'ops' ? ' ov2-active' : ''}`} onClick={() => setView('ops')}>Operational View</button>
          </div>
          {view === 'exec' && (
            <div className="ov2-segtabs">
              {EXEC_RANGE_OPTIONS.map(opt => (
                <button key={opt} onClick={() => setExecRange(opt)} className={execRange === opt ? 'ov2-active' : ''}>{opt}</button>
              ))}
            </div>
          )}
          {view === 'ops' && (
            <div className="ov2-segtabs">
              {[[24, '24h'], [168, '7d'], [0, 'All']].map(([h, label]) => (
                <button key={h} onClick={() => setRangeHours(h)} className={rangeHours === h ? 'ov2-active' : ''}>{label}</button>
              ))}
            </div>
          )}
          <div className="ov2-pill">
            <ShieldCheck style={{ width: 14, height: 14 }} />
            GDP Compliant
          </div>
        </div>
      </div>

      {/* ================= EXECUTIVE VIEW ================= */}
      {view === 'exec' && (
        <div>
          <div className="ov2-panel ov2-narrative">
            <div className="ic"><CheckCircle2 style={{ width: 19, height: 19 }} /></div>
            <div>
              <p className="txt">
                {autoResolvedRate != null
                  ? <>Over the last <b>{execRange === 'YTD' ? 'year to date' : execRange}</b>, the AI system resolved <b>{autoResolvedRate}% of {safeExecHistory.length} orchestrated runs</b> automatically{safeExecHistory.length - resolvedRuns.length > 0 ? ` — your team only needed to step in on ${safeExecHistory.length - resolvedRuns.length}` : ''}.</>
                  : `No orchestrated runs in the last ${execRange === 'YTD' ? 'year to date' : execRange} — resolve some windows to see this summary fill in.`}
              </p>
              <p className="sub">
                Based on {statValues.shipments} monitored shipments and {safeExecHistory.length} orchestrated interventions in this period.
              </p>
            </div>
          </div>

          <div className="ov2-kpis">
            <div className="ov2-kpi">
              <div className="ov2-kpi-top"><div className="ov2-kpi-icon" style={{ background: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' }}><DollarSign style={{ width: 16, height: 16 }} /></div></div>
              <div className="ov2-kpi-value" style={{ color: 'var(--ov2-green)' }}>{formatUsdCompact(valueSaved)}</div>
              <div className="ov2-kpi-label">Value at Risk Averted</div>
            </div>
            <div className="ov2-kpi">
              <div className="ov2-kpi-top"><div className="ov2-kpi-icon" style={{ background: 'var(--ov2-blue-soft)', color: 'var(--ov2-blue)' }}><Check style={{ width: 16, height: 16 }} /></div></div>
              <div className="ov2-kpi-value" style={{ color: 'var(--ov2-blue)' }}>{autoResolvedRate != null ? `${autoResolvedRate}%` : '—'}</div>
              <div className="ov2-kpi-label">Auto-Resolved Rate</div>
            </div>
            <div className="ov2-kpi">
              <div className="ov2-kpi-top"><div className="ov2-kpi-icon" style={{ background: 'var(--ov2-blue-soft)', color: 'var(--ov2-blue)' }}><ClipboardCheck style={{ width: 16, height: 16 }} /></div></div>
              <div className="ov2-kpi-value">{avgResolutionMin != null ? `${avgResolutionMin.toFixed(1)}m` : '—'}</div>
              <div className="ov2-kpi-label">Avg. Time to Resolution</div>
            </div>
            <div className="ov2-kpi">
              <div className="ov2-kpi-top"><div className="ov2-kpi-icon" style={{ background: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' }}><ShieldCheck style={{ width: 16, height: 16 }} /></div></div>
              <div className="ov2-kpi-value" style={{ color: 'var(--ov2-green)' }}>{complianceRate != null ? `${complianceRate}%` : '—'}</div>
              <div className="ov2-kpi-label">Compliance Rate</div>
            </div>
          </div>

          <div className="ov2-trio" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="ov2-panel" style={{ padding: '18px 20px' }}>
              <div className="ov2-trendrow">
                <div>
                  <h2 className="ov2-serif" style={{ fontWeight: 600, fontSize: 13.5, margin: 0, color: 'var(--ov2-ink-0)' }}>Value Saved Over Time</h2>
                  <p style={{ fontSize: 10.5, color: 'var(--ov2-ink-2)', margin: '3px 0 0' }}>Per-day sum of resolved runs' estimated loss avoided</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="figure">{formatUsdCompact(valueSaved)}</div>
                </div>
              </div>
              <TrendChart values={trendValues} />
            </div>

            <div className="ov2-panel" style={{ padding: '18px 20px' }}>
              <h2 className="ov2-serif" style={{ fontWeight: 600, fontSize: 13.5, margin: '0 0 3px', color: 'var(--ov2-ink-0)' }}>Top Risk Categories</h2>
              <p style={{ fontSize: 10.5, color: 'var(--ov2-ink-2)', margin: '0 0 12px' }}>Most-triggered compliance rules this window</p>
              {topRiskCategories.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--ov2-ink-2)' }}>No rules triggered in the fetched audit records.</p>
              ) : topRiskCategories.map(c => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                  <span style={{ width: 170, flex: 'none', fontSize: 11, color: 'var(--ov2-ink-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                  <div className="ov2-score-track" style={{ flex: 1, width: 'auto' }}><div className="ov2-score-fill" style={{ width: `${(c.count / maxRuleCount) * 100}%`, background: 'var(--ov2-amber)' }} /></div>
                  <span className="ov2-mono" style={{ width: 30, flex: 'none', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'var(--ov2-ink-0)' }}>{c.count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ov2-panel" style={{ padding: '6px 20px 8px' }}>
            <h2 className="ov2-serif" style={{ fontWeight: 600, fontSize: 13.5, margin: '14px 0 2px', color: 'var(--ov2-ink-0)' }}>Recent Wins</h2>
            <p style={{ fontSize: 10.5, color: 'var(--ov2-ink-2)', margin: '0 0 4px' }}>What the system caught and handled on your behalf</p>
            {recentWins.length === 0 ? (
              <div className="ov2-empty" style={{ padding: '24px 0' }}>
                <p style={{ fontSize: 11.5 }}>No resolved runs yet — orchestrate a pipeline to see wins here.</p>
              </div>
            ) : recentWins.map(({ run, loss }, i) => {
              const shipmentId = run.shipment_id || run.window_id || run._window_id;
              return (
                <div key={i} className="ov2-winrow">
                  <div className="ov2-winicon"><CheckCircle2 style={{ width: 15, height: 15 }} /></div>
                  <div className="body">
                    <div className="headline">
                      {run.decision_summary
                        ? <>{run.decision_summary}{loss > 0 ? <> — avoided an estimated <b>{formatUsdCompact(loss)}</b> loss.</> : '.'}</>
                        : <>Resolved <b>{shipmentId}</b> automatically{loss > 0 ? <> — avoided an estimated <b>{formatUsdCompact(loss)}</b> loss.</> : ' — no approval needed.'}</>}
                    </div>
                    <div className="meta">{timeAgo(run.timestamp)} · {run.risk_tier || 'UNKNOWN'} · resolved automatically</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* ================= /EXECUTIVE VIEW ================= */}

      {/* ================= OPERATIONAL VIEW ================= */}
      {view === 'ops' && (
      <div>

      {/* Hero strip */}
      <div className="ov2-hero">
        <div className="ov2-hero-grid">
          <div className="ov2-hero-cell">
            <p className="ov2-hero-label">Fleet Size</p>
            <p className="ov2-hero-value">{statValues.shipments}</p>
            <p className="ov2-hero-foot">Active shipments in transit</p>
          </div>
          <div className="ov2-hero-cell">
            <p className="ov2-hero-label">Value at Risk</p>
            <p className="ov2-hero-value" style={{ color: 'var(--ov2-amber)' }}>{statValues.valueAtRisk}</p>
            <p className="ov2-hero-foot" style={{ color: statValues.escalated > 0 ? 'var(--ov2-red)' : undefined }}>
              {statValues.escalated} escalated
            </p>
          </div>
          <div className="ov2-hero-cell">
            <p className="ov2-hero-label">Escalated Windows</p>
            <p className="ov2-hero-value" style={{ color: totalWindows > 0 ? 'var(--ov2-yellow)' : undefined }}>{totalWindows}</p>
            <p className="ov2-hero-foot">Across all risk tiers</p>
          </div>
          <div className="ov2-hero-cell">
            {statValues.pendingApprovals > 0 && (
              <Link to="/approvals" className="ov2-btn ov2-btn-danger">
                Review {statValues.pendingApprovals} Approval{statValues.pendingApprovals === 1 ? '' : 's'}
              </Link>
            )}
            <Link to="/agent-v2" className="ov2-btn ov2-btn-primary">Run Orchestrator</Link>
          </div>
        </div>
      </div>

      {/* Alert / all-clear banner */}
      {topApproval ? (
        <div className="ov2-alertbar">
          <div className="ov2-l">
            <div className="ov2-alerticon"><AlertTriangle style={{ width: 16, height: 16 }} /></div>
            <div>
              <p className="ov2-t1">
                {pendingApprovals.length} shipment{pendingApprovals.length === 1 ? '' : 's'} need{pendingApprovals.length === 1 ? 's' : ''} attention
              </p>
              <p className="ov2-t2">{topApproval.shipment_id} {safeStr(topApproval.window_id)} &middot; {topApproval.action_description}</p>
            </div>
          </div>
          <Link to="/approvals" className="ov2-btn ov2-btn-danger">Review →</Link>
        </div>
      ) : (
        <div className="ov2-alertbar ov2-alertbar-ok">
          <div className="ov2-l">
            <CheckCircle2 style={{ width: 18, height: 18, color: 'var(--ov2-green)' }} />
            <p className="ov2-t1" style={{ fontWeight: 500 }}>No shipments need attention right now.</p>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="ov2-kpis">
        <div className="ov2-kpi">
          <div className="ov2-kpi-top">
            <div className="ov2-kpi-icon" style={{ background: 'var(--ov2-blue-soft)', color: 'var(--ov2-blue)' }}><Boxes style={{ width: 16, height: 16 }} /></div>
            {statValues.escalated > 0 && <span className="ov2-kpi-trend" style={{ background: 'var(--ov2-blue-soft)', color: 'var(--ov2-blue)' }}>{statValues.escalated} escalated</span>}
          </div>
          <div className="ov2-kpi-value">{statValues.shipments}</div>
          <div className="ov2-kpi-label">Active Shipments</div>
        </div>
        <div className="ov2-kpi">
          <div className="ov2-kpi-top">
            <div className="ov2-kpi-icon" style={{ background: 'var(--ov2-red-soft)', color: 'var(--ov2-red)' }}><AlertTriangle style={{ width: 16, height: 16 }} /></div>
            {statValues.critical > 0 && <span className="ov2-kpi-trend" style={{ background: 'var(--ov2-red-soft)', color: 'var(--ov2-red)' }}>{statValues.critical} active</span>}
          </div>
          <div className="ov2-kpi-value">{String(statValues.critical).padStart(3, '0')}</div>
          <div className="ov2-kpi-label">Critical Alerts</div>
        </div>
        <div className="ov2-kpi">
          <div className="ov2-kpi-top">
            <div className="ov2-kpi-icon" style={{ background: 'var(--ov2-amber-soft)', color: 'var(--ov2-amber)' }}><DollarSign style={{ width: 16, height: 16 }} /></div>
          </div>
          <div className="ov2-kpi-value">{statValues.valueAtRisk}</div>
          <div className="ov2-kpi-label">Value at Risk</div>
        </div>
        <div className="ov2-kpi">
          <div className="ov2-kpi-top">
            <div className="ov2-kpi-icon" style={{ background: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' }}><ClipboardCheck style={{ width: 16, height: 16 }} /></div>
            {statValues.pendingApprovals > 0 && <span className="ov2-kpi-trend" style={{ background: 'var(--ov2-green-soft)', color: 'var(--ov2-green)' }}>{statValues.pendingApprovals} pending</span>}
          </div>
          <div className="ov2-kpi-value">{statValues.pendingApprovals}</div>
          <div className="ov2-kpi-label">Pending Approvals</div>
        </div>
      </div>

      {/* Three-column row */}
      <div className="ov2-trio">
        {/* Tier distribution */}
        <div className="ov2-panel">
          <div className="ov2-panel-head"><h2>Tier Distribution</h2><p>Escalated windows only</p></div>
          <div className="ov2-panel-body">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={46} outerRadius={72} paddingAngle={3} strokeWidth={0}>
                  {pieData.map(d => <Cell key={d.name} fill={TIER_STYLE[d.name]?.color} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <text x="50%" y="46%" textAnchor="middle" style={{ fill: 'var(--ov2-ink-0)', fontSize: 20, fontWeight: 700 }}>{totalWindows}</text>
                <text x="50%" y="58%" textAnchor="middle" style={{ fill: 'var(--ov2-ink-2)', fontSize: 10 }}>escalated</text>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ marginTop: 4 }}>
              {pieData.map(d => (
                <div key={d.name} className="ov2-legend-row">
                  <span className="ov2-l"><span className="ov2-dot" style={{ background: TIER_STYLE[d.name]?.color }} />{d.name.charAt(0) + d.name.slice(1).toLowerCase()}</span>
                  <span style={{ fontWeight: 600, fontFamily: 'ui-monospace,monospace', color: TIER_STYLE[d.name]?.color }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cold-Chain Pulse */}
        <div className="ov2-panel">
          <div className="ov2-panel-head" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <h2>Cold-Chain Pulse</h2>
              <p>Highest-risk shipment · live telemetry</p>
            </div>
          </div>
          <div className="ov2-panel-body">
            {topShipmentId ? (
              <>
                <div className="ov2-pulse-top">
                  <div className="ov2-pulse-ship ov2-serif">
                    {topShipmentId} <span style={{ color: 'var(--ov2-ink-2)', fontWeight: 400, fontSize: 13 }}>· {safeStr(pulseWindows?.[0]?.window_id)}</span>
                  </div>
                  {topShipment?.latest_risk_tier && (
                    <span className="ov2-tier-badge" style={{ background: TIER_STYLE[topShipment.latest_risk_tier]?.bg, color: TIER_STYLE[topShipment.latest_risk_tier]?.color }}>
                      {topShipment.latest_risk_tier}
                    </span>
                  )}
                </div>
                <div className="ov2-pulse-stats">
                  <div className="ov2-pulse-stat"><div className="ov2-k">Fused Score</div><div className="ov2-v" style={{ color: 'var(--ov2-red)' }}>{typeof topShipment?.max_fused_score === 'number' ? topShipment.max_fused_score.toFixed(4) : '—'}</div></div>
                  <div className="ov2-pulse-stat"><div className="ov2-k">Value at Risk</div><div className="ov2-v" style={{ color: 'var(--ov2-amber)' }}>{typeof topShipment?.value_at_risk_usd === 'number' ? formatUsdCompact(topShipment.value_at_risk_usd) : '—'}</div></div>
                  <div className="ov2-pulse-stat"><div className="ov2-k">Windows</div><div className="ov2-v">{pulseWindows?.length ?? '—'}</div></div>
                </div>
                <div className="ov2-pulse-chart">
                  <PulseChart windows={pulseWindows} />
                </div>
              </>
            ) : (
              <div className="ov2-empty" style={{ height: 200 }}>
                <p style={{ fontSize: 12 }}>No escalated shipments in this range.</p>
              </div>
            )}
          </div>
        </div>

        {/* Live agent activity */}
        <div className="ov2-panel">
          <div className="ov2-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div><h2>Live Agent Activity</h2><p>Last 6 actions</p></div>
            <Link to="/agent-v2" style={{ fontSize: 11, color: 'var(--ov2-blue)', textDecoration: 'none', fontWeight: 600 }}>View all →</Link>
          </div>
          <div className="ov2-panel-body" style={{ paddingTop: 6 }}>
            {recentActions.length === 0 ? (
              <div className="ov2-empty" style={{ padding: '24px 0' }}>
                <p style={{ fontSize: 11.5 }}>No agent runs yet — orchestrate a pipeline to see actions here.</p>
              </div>
            ) : (
              recentActions.map((item, i) => {
                const headline = getAgentHeadline(item.action.tool, item.action);
                const chip = AGENT_FEED_CHIPS[item.action.tool] || AGENT_FEED_CHIPS._default;
                const tone = TONE_VARS[chip.tone];
                return (
                  <div key={i} className="ov2-feed-item">
                    <span className="ov2-chip" style={{ background: tone.bg, color: tone.color }}>{chip.label}</span>
                    <span className="ov2-feed-text">{headline.title}</span>
                    <span className="ov2-feed-time">{timeAgo(item.timestamp)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Top At-Risk Shipments — trimmed from the old full Shipment Risk
          Summary table. The full sortable/filterable/searchable version
          already lives on the dedicated Shipments page. */}
      <div className="ov2-tablecard">
        <div className="ov2-table-head">
          <div>
            <h2 className="ov2-serif" style={{ fontWeight: 600, fontSize: 14.5, margin: 0, color: 'var(--ov2-ink-0)' }}>Top At-Risk Shipments</h2>
            <p style={{ fontSize: 11, color: 'var(--ov2-ink-2)', margin: '3px 0 0' }}>Full list and filters live on Shipments</p>
          </div>
          <Link to="/shipments" style={{ fontSize: 12, fontWeight: 600, color: 'var(--ov2-blue)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
            View all shipments <ChevronRight style={{ width: 13, height: 13 }} />
          </Link>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="ov2-table">
            <thead>
              <tr>
                <th>Shipment</th><th>Products</th><th>Latest Tier</th><th>Max Score</th><th>Value at Risk</th>
              </tr>
            </thead>
            <tbody>
              {topShipments.length === 0 ? (
                <tr><td colSpan={5}>
                  <div className="ov2-empty">
                    <Ship style={{ width: 20, height: 20 }} />
                    <p style={{ fontWeight: 600, color: 'var(--ov2-ink-0)', marginTop: 8 }}>No escalated shipments right now</p>
                  </div>
                </td></tr>
              ) : topShipments.map(s => {
                const tone = TIER_STYLE[s.latest_risk_tier];
                return (
                  <tr key={s.shipment_id} onClick={() => navigate(`/shipments/${s.shipment_id}`)}>
                    <td><span className="ov2-ship-id">{s.shipment_id}<ChevronRight style={{ width: 13, height: 13, opacity: 0.5 }} /></span></td>
                    <td>{s.products.join(', ')}</td>
                    <td><span className="ov2-tier-badge" style={{ background: tone?.bg, color: tone?.color }}>{s.latest_risk_tier}</span></td>
                    <td>
                      <div className="ov2-score-bar-wrap">
                        <div className="ov2-score-track"><div className="ov2-score-fill" style={{ width: `${Math.min(s.max_fused_score * 100, 100)}%`, background: tone?.color }} /></div>
                        <span className="ov2-mono" style={{ color: 'var(--ov2-ink-0)' }}>{s.max_fused_score.toFixed(4)}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: 'right' }}><span className="ov2-vrisk">{formatUsdCompact(s.value_at_risk_usd)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      </div>
      )}
      {/* ================= /OPERATIONAL VIEW ================= */}

    </div>
  );
}
