import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, getApi, postApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOrchestrationStream } from '../lib/OrchestrationStreamContext';
import { runStatusSemantic } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';
import { buildRunLabels } from '../lib/runGroups';
import { AGENTS } from '../lib/agents.jsx';
import { timeAgo } from '../lib/format';
import {
  Play, Zap, Layers, Search, Hash,
  ChevronDown, ChevronRight, ChevronUp, CheckCircle, Clock, RotateCcw,
} from 'lucide-react';
import './agent-activity-v2.css';

// ── Agent chip tone mapped to agent id — matches the "Clinical Calm" palette ──
const AGENT_CHIP = {
  compliance_agent:   { label: 'COMPLIANCE', tone: 'blue' },
  cold_storage_agent: { label: 'STORAGE',    tone: 'blue' },
  route_agent:        { label: 'ROUTE',      tone: 'blue' },
  notification_agent: { label: 'NOTIFY',     tone: 'blue' },
  scheduling_agent:   { label: 'SCHEDULE',   tone: 'blue' },
  insurance_agent:    { label: 'INSURE',     tone: 'green' },
  triage_agent:       { label: 'TRIAGE',     tone: 'red' },
  approval_workflow:  { label: 'ESCALATION', tone: 'amber' },
  _default:           { label: 'AGENT',      tone: 'blue' },
};
const TONE_VARS = {
  red:   { bg: 'var(--aav-red-soft)', color: 'var(--aav-red)' },
  amber: { bg: 'var(--aav-amber-soft)', color: 'var(--aav-amber)' },
  blue:  { bg: 'var(--aav-blue-soft)', color: 'var(--aav-blue)' },
  green: { bg: 'var(--aav-green-soft)', color: 'var(--aav-green)' },
};
function agentChip(toolId) {
  return AGENT_CHIP[toolId] || AGENT_CHIP._default;
}

const TIER_DOT = {
  CRITICAL: 'var(--aav-red)', HIGH: 'var(--aav-amber)', MEDIUM: 'var(--aav-yellow)', LOW: 'var(--aav-green)',
};
const SCORE_COLOR = TIER_DOT;

const STATUS_LABEL = { crit: 'Awaiting', warn: 'Corrections', ok: 'Resolved', info: 'No actions' };
const STATUS_TONE = { crit: 'amber', warn: 'amber', ok: 'green', info: null };

const FILTERS = [
  { id: 'all',      label: 'All',      predicate: () => true },
  { id: 'critical', label: 'Critical', predicate: d => d.risk_tier === 'CRITICAL' },
  { id: 'awaiting', label: 'Awaiting', predicate: d => runStatusSemantic(d) === 'crit' },
  { id: 'resolved', label: 'Resolved', predicate: d => runStatusSemantic(d) === 'ok' },
];

// ── Individual run row ────────────────────────────────────────────────────────
function RunRow({ decision, runLabel, basePath }) {
  const navigate = useNavigate();
  const d = decision || {};
  const windowId = d.window_id || d._window_id;
  const level = runStatusSemantic(d);
  const tier = d.risk_tier || 'LOW';
  const uniqueTools = [...new Set((d.actions_taken || []).map(a => a?.tool).filter(Boolean))];
  const maxFused = typeof d.max_fused_score === 'number' ? d.max_fused_score
    : typeof d.risk_score === 'number' ? d.risk_score : null;
  const statusTone = STATUS_TONE[level] ? TONE_VARS[STATUS_TONE[level]] : { bg: 'var(--aav-panel-border)', color: 'var(--aav-ink-2)' };

  return (
    <div className="aav-runrow" onClick={() => navigate(`${basePath}/runs/${encodeURIComponent(getRunKey(d))}`)}>
      <div className="aav-tierdot" style={{ background: TIER_DOT[tier] || TIER_DOT.LOW }} />
      <div className="rid">
        <div className="w">{windowId}</div>
        <div className="s">
          {d.shipment_id}{d.container_id ? ` / ${d.container_id}` : ''}
          {runLabel && <span style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>#{runLabel.index}/{runLabel.total}</span>}
        </div>
      </div>
      <div className="agents">
        {uniqueTools.slice(0, 5).map(t => {
          const chip = agentChip(t);
          const tone = TONE_VARS[chip.tone];
          return <span key={t} className="aav-agentchip" style={{ background: tone.bg, color: tone.color }}>{chip.label}</span>;
        })}
        {uniqueTools.length > 5 && <span style={{ fontSize: 10, color: 'var(--aav-ink-2)', alignSelf: 'center' }}>+{uniqueTools.length - 5}</span>}
        {d.replan_count > 0 && (
          <span className="aav-agentchip" style={{ background: 'var(--aav-amber-soft)', color: 'var(--aav-amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <RotateCcw style={{ width: 9, height: 9 }} />{d.replan_count}×
          </span>
        )}
      </div>
      <div className="score">
        {maxFused != null ? (
          <>
            <div className="v" style={{ color: SCORE_COLOR[tier] }}>{maxFused.toFixed(4)}</div>
            <div className="t">{tier}</div>
          </>
        ) : <div style={{ fontSize: 11, color: 'var(--aav-ink-2)' }}>—</div>}
      </div>
      <div style={{ width: 100, flex: 'none' }}>
        <span className="aav-statusbadge" style={{ background: statusTone.bg, color: statusTone.color }}>
          {level === 'ok' ? <CheckCircle style={{ width: 10, height: 10 }} /> : <Clock style={{ width: 10, height: 10 }} />}
          {STATUS_LABEL[level]}
        </span>
      </div>
      <div className="time">{timeAgo(d.timestamp)}</div>
      <ChevronRight className="aav-chev" />
    </div>
  );
}

// ── Agent roster accordion ────────────────────────────────────────────────────
function AgentRoster() {
  const [open, setOpen] = useState(false);
  return (
    <div className="aav-panel" style={{ marginBottom: 0 }}>
      <div className="aav-roster-head" onClick={() => setOpen(o => !o)}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--aav-ink-0)' }}>Agent Roster</span>
        <div className="aav-roster-chips">
          {['COMPLIANCE', 'STORAGE', 'NOTIFY', 'SCHEDULE', 'INSURE'].map(l => {
            const tone = TONE_VARS[Object.values(AGENT_CHIP).find(c => c.label === l)?.tone || 'blue'];
            return <span key={l} className="aav-agentchip" style={{ background: tone.bg, color: tone.color }}>{l}</span>;
          })}
          {open ? <ChevronUp style={{ width: 16, height: 16, color: 'var(--aav-ink-2)' }} /> : <ChevronDown style={{ width: 16, height: 16, color: 'var(--aav-ink-2)' }} />}
        </div>
      </div>
      <div className={`aav-roster-body${open ? ' open' : ''}`}>
        {AGENTS.map(a => {
          const chip = agentChip(a.id);
          const tone = TONE_VARS[chip.tone];
          return (
            <div key={a.id} className="aav-roster-item">
              <span className="aav-agentchip" style={{ background: tone.bg, color: tone.color, marginTop: 2, flex: 'none' }}>{chip.label}</span>
              <span>{a.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentActivityV2() {
  const BASE = '/agent-v2';
  const { data: history, loading, refetch } = useApi('/orchestrator/history?limit=30');
  const { data: mode } = useApi('/orchestrator/mode');
  const { messages: wsMessages, connected: wsConnected } = useWebSocket([
    'orchestrator_decision', 'approval_decided', 'approval_executed', 'approval_confirmed', 'tool_executed',
  ]);
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState(null);
  const { windowId, setWindowId, demoResult, setDemoResult } = useOrchestrationStream();
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sort, setSort] = useState('recent');

  useEffect(() => {
    if (!wsMessages.length) return;
    const latest = wsMessages[wsMessages.length - 1];
    if (['orchestrator_decision', 'approval_executed', 'approval_confirmed', 'approval_decided'].includes(latest.type)) {
      refetch();
    }
  }, [wsMessages, refetch]);

  const runSingle = useCallback(async (wid) => {
    setRunning(true); setDemoResult(null);
    try {
      const result = await postApi(`/orchestrator/run/${wid}`, {});
      if (result && !result.detail) {
        setDemoResult(result);
        setLastRunId(getRunKey(result));
      } else {
        setDemoResult({ error: result?.detail || 'Unknown error' });
      }
      await refetch();
    } catch (e) { setDemoResult({ error: e.message }); }
    finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const runDemo = useCallback(async () => {
    setRunning(true); setDemoResult(null);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=1');
      if (Array.isArray(windows) && windows.length > 0) {
        const result = await postApi(`/orchestrator/run/${windows[0].window_id}`, {});
        if (result && !result.detail) { setDemoResult(result); setLastRunId(getRunKey(result)); }
        else { setDemoResult({ error: result?.detail || 'Unknown error' }); }
        await refetch();
      }
    } catch (e) { setDemoResult({ error: e.message }); }
    finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const runCriticalBatch = useCallback(async () => {
    setRunning(true);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=5');
      if (Array.isArray(windows) && windows.length > 0) {
        await postApi('/orchestrator/run-batch', windows.map(w => w.window_id));
        await refetch();
      }
    } catch (e) { setDemoResult({ error: e.message }); }
    finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const safeHistory = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const runLabels = useMemo(() => buildRunLabels(safeHistory), [safeHistory]);

  const kpiCounts = useMemo(() => ({
    total:    safeHistory.length,
    critical: safeHistory.filter(d => d.risk_tier === 'CRITICAL').length,
    awaiting: safeHistory.filter(d => runStatusSemantic(d) === 'crit').length,
    resolved: safeHistory.filter(d => runStatusSemantic(d) === 'ok').length,
  }), [safeHistory]);

  const chipCounts = useMemo(() => {
    const c = {};
    for (const f of FILTERS) c[f.id] = safeHistory.filter(f.predicate).length;
    return c;
  }, [safeHistory]);

  const filtered = useMemo(() => {
    const def = FILTERS.find(f => f.id === activeFilter) || FILTERS[0];
    let r = safeHistory.filter(def.predicate);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter(d => [d.window_id, d._window_id, d.shipment_id, d.container_id].filter(Boolean).join(' ').toLowerCase().includes(q));
    return [...r].sort((a, b) => sort === 'risk'
      ? (b.max_fused_score ?? b.risk_score ?? 0) - (a.max_fused_score ?? a.risk_score ?? 0)
      : new Date(b.timestamp) - new Date(a.timestamp));
  }, [safeHistory, activeFilter, search, sort]);

  return (
    <div className="aav">

      {/* Header */}
      <div className="aav-top">
        <div>
          <h1 className="aav-title">Agent Activity</h1>
          <p className="aav-sub">Multi-agent orchestration runs · last 30 decisions</p>
        </div>
        <div className="aav-statusrow">
          <div className={`aav-chip ${wsConnected ? 'live' : ''}`}>
            <span className="aav-dot" style={wsConnected ? { animation: 'aav-ping 2s infinite' } : undefined} />
            {wsConnected ? 'WebSocket Live' : 'Offline'}
          </div>
          <div className="aav-chip">{mode?.active_provider ? 'Agentic Mode' : 'Deterministic'}</div>
        </div>
      </div>

      {/* KPI banners */}
      <div className="aav-kpis">
        <div className="aav-kpi">
          <div className="aav-kpi-tag" style={{ background: 'var(--aav-blue-soft)', color: 'var(--aav-blue)' }}>ALL</div>
          <div className="aav-kpi-label">Total Runs</div>
          <div className="aav-kpi-value">{kpiCounts.total}</div>
        </div>
        <div className="aav-kpi">
          <div className="aav-kpi-tag" style={{ background: 'var(--aav-red-soft)', color: 'var(--aav-red)' }}>+{kpiCounts.critical}</div>
          <div className="aav-kpi-label">Critical</div>
          <div className="aav-kpi-value" style={{ color: 'var(--aav-red)' }}>{kpiCounts.critical}</div>
        </div>
        <div className="aav-kpi">
          <div className="aav-kpi-tag" style={{ background: 'var(--aav-amber-soft)', color: 'var(--aav-amber)' }}>ACTION</div>
          <div className="aav-kpi-label">Awaiting Approval</div>
          <div className="aav-kpi-value" style={{ color: 'var(--aav-amber)' }}>{kpiCounts.awaiting}</div>
        </div>
        <div className="aav-kpi">
          <div className="aav-kpi-tag" style={{ background: 'var(--aav-green-soft)', color: 'var(--aav-green)' }}>DONE</div>
          <div className="aav-kpi-label">Resolved</div>
          <div className="aav-kpi-value" style={{ color: 'var(--aav-green)' }}>{kpiCounts.resolved}</div>
        </div>
      </div>

      {/* Live strip — only while running */}
      {running && windowId && (
        <div className="aav-livestrip">
          <span className="aav-pulsedot"><span className="ping" /><span className="core" /></span>
          <div>
            <div className="t1">Live · {windowId}</div>
            <div className="t2">Orchestrating window — agents dispatching…</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            {['RISK', 'COMPLIANCE', 'STORAGE', 'NOTIFY'].map(l => {
              const tone = TONE_VARS[Object.values(AGENT_CHIP).find(c => c.label === l)?.tone || 'blue'];
              return <span key={l} className="aav-agentchip" style={{ background: tone.bg, color: tone.color }}>{l}</span>;
            })}
          </div>
        </div>
      )}

      {/* Run Orchestrator */}
      <div className="aav-panel">
        <div className="aav-panel-head">
          <h2 className="aav-panel-h">Run Orchestrator</h2>
          <p className="aav-panel-sub">Trigger a single window or batch critical shipments</p>
        </div>
        <div className="aav-runcard-body">
          <div className="aav-inputbox">
            <Hash />
            <input placeholder="Window ID (e.g. W00041)…" value={windowId || ''} onChange={e => setWindowId(e.target.value)} />
          </div>
          <button type="button" className="aav-btn aav-btn-primary" disabled={running || !windowId} onClick={() => runSingle(windowId)}>
            <Play style={{ width: 13, height: 13 }} /> Run Window
          </button>
          <button type="button" className="aav-btn aav-btn-outline" disabled={running} onClick={runDemo}>
            <Zap style={{ width: 13, height: 13 }} /> Live Demo
          </button>
          <button type="button" className="aav-btn aav-btn-outline" disabled={running} onClick={runCriticalBatch}>
            <Layers style={{ width: 13, height: 13 }} /> Batch Top 5
          </button>
        </div>
        {demoResult?.error && <p className="aav-errtext">{demoResult.error}</p>}
        {demoResult && !demoResult.error && lastRunId && (
          <p style={{ padding: '0 18px 14px' }}>
            <Link to={`${BASE}/runs/${encodeURIComponent(lastRunId)}`} className="aav-runlink">
              View details for {demoResult.window_id || demoResult._window_id} →
            </Link>
          </p>
        )}
      </div>

      {/* Recent runs */}
      <div className="aav-panel">
        <div className="aav-listhead">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="aav-panel-h">Recent Runs</span>
            <span className="aav-countbadge">{safeHistory.length}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div className="aav-fchips">
              {FILTERS.map(f => (
                <button key={f.id} type="button" className={`aav-fchip${activeFilter === f.id ? ' active' : ''}`} onClick={() => setActiveFilter(f.id)}>
                  {f.label} <strong>{chipCounts[f.id]}</strong>
                </button>
              ))}
            </div>
            <div className="aav-sorttoggle">
              <button type="button" className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>Recent</button>
              <button type="button" className={sort === 'risk' ? 'active' : ''} onClick={() => setSort('risk')}>Risk</button>
            </div>
          </div>
        </div>

        <div className="aav-tablehead">
          <div style={{ width: 8 }} />
          <span style={{ flex: '0 0 150px' }}>Window / Ship.</span>
          <span style={{ flex: 1 }}>Agents</span>
          <span style={{ width: 80 }}>Risk Score</span>
          <span style={{ width: 100 }}>Status</span>
          <span style={{ width: 56, textAlign: 'right' }}>Time</span>
          <div style={{ width: 14 }} />
        </div>

        {loading && !history ? (
          <div className="aav-loading"><span className="aav-spinner" /> Loading runs…</div>
        ) : filtered.length === 0 ? (
          <div className="aav-empty">No runs match this filter.</div>
        ) : (
          filtered.map(d => (
            <RunRow key={getRunKey(d)} decision={d} runLabel={runLabels.get(getRunKey(d))} basePath={BASE} />
          ))
        )}

        <div className="aav-listfoot">
          <div className="aav-search">
            <Search />
            <input placeholder="Search window, shipment, container…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--aav-blue)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {filtered.length} of {safeHistory.length} runs <ChevronRight style={{ width: 12, height: 12 }} />
          </span>
        </div>
      </div>

      {/* Agent roster */}
      <AgentRoster />
    </div>
  );
}
