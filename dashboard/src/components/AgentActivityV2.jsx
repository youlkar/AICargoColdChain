import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, getApi, postApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOrchestrationStream } from '../lib/OrchestrationStreamContext';
import { runStatusSemantic } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';
import { buildRunLabels } from '../lib/runGroups';
import { getAgentMeta, AGENTS } from '../lib/agents.jsx';
import { timeAgo } from '../lib/format';
import TierBadge from './TierBadge';
import {
  Play, Zap, Layers, Search, Hash, Wifi, WifiOff,
  ChevronDown, ChevronRight, ChevronUp, CheckCircle, Clock, AlertTriangle,
  RotateCcw,
} from 'lucide-react';

// ── Agent chip styles mapped to agent id ──────────────────────────────────────
const AGENT_CHIP = {
  compliance_agent:  { label: 'COMPLIANCE', cls: 'bg-violet-500/12 text-violet-400 border-violet-500/20' },
  cold_storage_agent:{ label: 'STORAGE',    cls: 'bg-blue-500/12 text-blue-400 border-blue-500/20' },
  route_agent:       { label: 'ROUTE',      cls: 'bg-cyan-500/12 text-cyan-400 border-cyan-500/20' },
  notification_agent:{ label: 'NOTIFY',     cls: 'bg-amber-500/12 text-amber-400 border-amber-500/20' },
  scheduling_agent:  { label: 'SCHEDULE',   cls: 'bg-indigo-500/12 text-indigo-400 border-indigo-500/20' },
  insurance_agent:   { label: 'INSURE',     cls: 'bg-emerald-500/12 text-emerald-400 border-emerald-500/20' },
  triage_agent:      { label: 'TRIAGE',     cls: 'bg-rose-500/12 text-rose-400 border-rose-500/20' },
  approval_workflow: { label: 'ESCALATION', cls: 'bg-red-500/12 text-red-400 border-red-500/20' },
  _default:          { label: 'AGENT',      cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
};

function agentChip(toolId) {
  return AGENT_CHIP[toolId] || AGENT_CHIP._default;
}

const STATUS_LABEL = { crit: 'Awaiting', warn: 'Corrections', ok: 'Resolved', info: 'No actions' };
const STATUS_CLS   = {
  crit: 'bg-amber-500/10 text-[var(--accent-amber)]',
  warn: 'bg-amber-500/10 text-[var(--accent-amber)]',
  ok:   'bg-emerald-500/10 text-[var(--accent-green)]',
  info: 'bg-slate-500/10 text-[var(--text-secondary-2)]',
};

const TIER_DOT_CLS = {
  CRITICAL: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]',
  HIGH:     'bg-orange-500',
  MEDIUM:   'bg-yellow-500',
  LOW:      'bg-green-500',
};

const SCORE_CLS = { CRITICAL: 'text-red-400', HIGH: 'text-orange-400', MEDIUM: 'text-yellow-400', LOW: 'text-green-400' };

const FILTERS = [
  { id: 'all',      label: 'All',      predicate: () => true },
  { id: 'critical', label: 'Critical', predicate: d => d.risk_tier === 'CRITICAL' },
  { id: 'awaiting', label: 'Awaiting', predicate: d => runStatusSemantic(d) === 'crit' },
  { id: 'resolved', label: 'Resolved', predicate: d => runStatusSemantic(d) === 'ok' },
];

// ── Individual row ────────────────────────────────────────────────────────────
function RunRow({ decision, runLabel, basePath }) {
  const navigate = useNavigate();
  const d = decision || {};
  const windowId = d.window_id || d._window_id;
  const level = runStatusSemantic(d);
  const tier = d.risk_tier || 'LOW';
  const uniqueTools = [...new Set((d.actions_taken || []).map(a => a?.tool).filter(Boolean))];
  const maxFused = typeof d.max_fused_score === 'number' ? d.max_fused_score
    : typeof d.risk_score === 'number' ? d.risk_score : null;

  return (
    <div
      className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[var(--card-border-subtle,rgba(148,163,184,0.07))] cursor-pointer transition-colors hover:bg-white/[0.03]"
      onClick={() => navigate(`${basePath}/runs/${encodeURIComponent(getRunKey(d))}`)}
    >
      {/* tier dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TIER_DOT_CLS[tier] || TIER_DOT_CLS.LOW}`} />

      {/* id + ship */}
      <div style={{ flex: '0 0 132px', minWidth: 0 }}>
        <div className="text-[13px] font-bold text-[var(--text-primary)] font-mono leading-tight">{windowId}</div>
        <div className="text-[11px] text-[var(--text-secondary-2)] mt-0.5">
          {d.shipment_id}{d.container_id ? ` / ${d.container_id}` : ''}
          {runLabel && <span className="ml-2 text-[10px] opacity-60">#{runLabel.index}/{runLabel.total}</span>}
        </div>
      </div>

      {/* agent chips */}
      <div className="flex flex-wrap gap-[3px] flex-1 min-w-0">
        {uniqueTools.slice(0, 5).map(t => {
          const chip = agentChip(t);
          return (
            <span key={t} className={`px-[7px] py-[2px] rounded-[20px] text-[10px] font-bold border ${chip.cls}`}>
              {chip.label}
            </span>
          );
        })}
        {uniqueTools.length > 5 && (
          <span className="text-[10px] text-[var(--text-secondary-2)] self-center">+{uniqueTools.length - 5}</span>
        )}
        {d.replan_count > 0 && (
          <span className="flex items-center gap-1 px-[7px] py-[2px] rounded-[20px] text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <RotateCcw className="w-2.5 h-2.5" />{d.replan_count}×
          </span>
        )}
      </div>

      {/* risk score */}
      <div style={{ width: 84 }}>
        {maxFused != null ? (
          <>
            <div className={`text-[13px] font-bold font-mono ${SCORE_CLS[tier] || ''}`}>{maxFused.toFixed(4)}</div>
            <div className="text-[10px] text-[var(--text-secondary-2)]">{tier}</div>
          </>
        ) : (
          <div className="text-[11px] text-[var(--text-secondary-2)]">—</div>
        )}
      </div>

      {/* status */}
      <div style={{ width: 100 }}>
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-[10px] py-[3px] rounded-[6px] ${STATUS_CLS[level]}`}>
          {level === 'ok' ? <CheckCircle className="w-[10px] h-[10px]" /> : <Clock className="w-[10px] h-[10px]" />}
          {STATUS_LABEL[level]}
        </span>
      </div>

      {/* time */}
      <div className="text-[11px] text-[var(--text-secondary-2)] whitespace-nowrap" style={{ width: 60, textAlign: 'right' }}>
        {timeAgo(d.timestamp)}
      </div>

      <ChevronRight className="w-[14px] h-[14px] text-[var(--text-secondary-2)] flex-shrink-0" />
    </div>
  );
}

// ── Agent roster accordion ────────────────────────────────────────────────────
function AgentRoster() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-[18px] py-[13px] text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-[13px] font-bold text-[var(--text-primary)]">Agent Roster</span>
        <div className="flex items-center gap-[6px]">
          {['COMPLIANCE','STORAGE','NOTIFY','SCHEDULE','INSURE'].map(l => (
            <span key={l} className={`px-[8px] py-[2px] rounded-[20px] text-[10px] font-bold border ${Object.values(AGENT_CHIP).find(c => c.label === l)?.cls || ''}`}>{l}</span>
          ))}
          {open ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary-2)] ml-1" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary-2)] ml-1" />}
        </div>
      </button>
      {open && (
        <div className="px-[18px] pb-4 grid grid-cols-2 gap-2 border-t border-[var(--card-border)]">
          {AGENTS.map(a => {
            const Icon = a.icon;
            const chip = agentChip(a.id);
            return (
              <div key={a.id} className="flex items-start gap-2 py-1">
                <span className={`mt-0.5 px-[7px] py-[2px] rounded-[20px] text-[10px] font-bold border flex-shrink-0 ${chip.cls}`}>{chip.label}</span>
                <span className="text-[11px] text-[var(--text-secondary-2)]">{a.desc}</span>
              </div>
            );
          })}
        </div>
      )}
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
    return [...r].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [safeHistory, activeFilter, search]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-4">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-extrabold text-[var(--text-primary)] tracking-tight">Agent Activity</h1>
          <p className="text-[12px] text-[var(--text-secondary-2)] mt-0.5">Multi-agent orchestration runs · last 30 decisions</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border ${wsConnected ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400' : 'border-[var(--card-border)] text-[var(--text-secondary-2)]'}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-[var(--text-secondary-2)]'}`} />
            {wsConnected ? 'WebSocket Live' : 'Offline'}
          </div>
          <div className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-[var(--card-border)] text-[var(--text-secondary-2)] bg-[var(--bg-page)]">
            {mode?.active_provider ? 'Agentic Mode' : 'Deterministic'}
          </div>
        </div>
      </div>

      {/* KPI Banners */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Runs',       value: kpiCounts.total,    grad: 'linear-gradient(135deg,#1e40af,#3b82f6)', badge: 'ALL' },
          { label: 'Critical',         value: kpiCounts.critical,  grad: 'linear-gradient(135deg,#991b1b,#ef4444)', badge: `+${kpiCounts.critical}` },
          { label: 'Awaiting Approval',value: kpiCounts.awaiting,  grad: 'linear-gradient(135deg,#92400e,#f59e0b)', badge: 'ACTION' },
          { label: 'Resolved',         value: kpiCounts.resolved,  grad: 'linear-gradient(135deg,#065f46,#10b981)', badge: 'DONE' },
        ].map(({ label, value, grad, badge }) => (
          <div key={label} className="rounded-2xl p-[18px] relative overflow-hidden text-white" style={{ background: grad, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
            <div className="text-[10px] font-bold uppercase tracking-[0.07em] opacity-75 mb-1.5">{label}</div>
            <div className="text-[30px] font-extrabold leading-none tracking-tight">{value}</div>
            <div className="absolute top-[14px] right-[16px] px-2 py-0.5 rounded-[6px] text-[10px] font-bold" style={{ background: 'rgba(255,255,255,0.18)' }}>{badge}</div>
            <div className="pointer-events-none absolute -bottom-5 -right-5 w-20 h-20 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />
          </div>
        ))}
      </div>

      {/* Live strip — only shown while running */}
      {running && windowId && (
        <div className="rounded-2xl px-[18px] py-[13px] flex items-center gap-3 border" style={{ background: 'linear-gradient(135deg,#0c1f3a,#0e3a4f)', borderColor: 'rgba(34,211,238,0.15)' }}>
          <div className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: '#22d3ee' }} />
          <div>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.07em]" style={{ color: '#22d3ee' }}>Live · {windowId}</div>
            <div className="text-[12px] mt-0.5" style={{ color: 'rgba(148,163,184,0.85)' }}>Orchestrating window — agents dispatching…</div>
          </div>
          <div className="flex gap-1.5 ml-auto">
            {['RISK','COMPLIANCE','STORAGE','NOTIFY'].map(l => (
              <span key={l} className={`px-[8px] py-[2px] rounded-[20px] text-[10px] font-bold border ${Object.values(AGENT_CHIP).find(c => c.label === l)?.cls || ''}`}>{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* Run Orchestrator card */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between px-[18px] py-[13px] border-b border-[var(--card-border)]">
          <span className="text-[13px] font-bold text-[var(--text-primary)]">Run Orchestrator</span>
          <span className="text-[11px] text-[var(--text-secondary-2)]">Trigger a single window or batch critical shipments</span>
        </div>
        <div className="p-[18px] space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Hash className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[var(--text-secondary-2)]" />
              <input
                placeholder="Window ID (e.g. W00041)…"
                value={windowId || ''}
                onChange={e => setWindowId(e.target.value)}
                className="w-full pl-8 pr-3 py-[9px] rounded-[10px] border border-[var(--card-border)] text-[13px] text-[var(--text-primary)] bg-[var(--bg-page)] outline-none focus:border-[var(--accent-cyan)] transition-colors"
              />
            </div>
            <button
              type="button"
              disabled={running || !windowId}
              onClick={() => runSingle(windowId)}
              className="flex items-center gap-1.5 px-4 py-[9px] rounded-[10px] text-[12px] font-bold text-white disabled:opacity-50 transition-opacity"
              style={{ background: 'var(--accent-cyan)' }}
            >
              <Play className="w-[13px] h-[13px] fill-current" /> Run Window
            </button>
            <button
              type="button"
              disabled={running}
              onClick={runDemo}
              className="flex items-center gap-1.5 px-4 py-[9px] rounded-[10px] text-[12px] font-semibold border border-[var(--card-border)] text-[var(--text-primary)] disabled:opacity-50 transition-colors hover:border-[var(--accent-cyan)]"
            >
              <Zap className="w-[13px] h-[13px]" /> Live Demo
            </button>
            <button
              type="button"
              disabled={running}
              onClick={runCriticalBatch}
              className="flex items-center gap-1.5 px-4 py-[9px] rounded-[10px] text-[12px] font-semibold border border-[var(--card-border)] text-[var(--text-primary)] disabled:opacity-50 transition-colors hover:border-[var(--accent-cyan)]"
            >
              <Layers className="w-[13px] h-[13px]" /> Batch Top 5
            </button>
          </div>
          {demoResult?.error && <p className="text-[12px] text-[var(--accent-red)]">{demoResult.error}</p>}
          {demoResult && !demoResult.error && lastRunId && (
            <Link to={`${BASE}/runs/${encodeURIComponent(lastRunId)}`} className="text-[12px] text-[var(--accent-cyan)] hover:underline">
              View details for {demoResult.window_id || demoResult._window_id} →
            </Link>
          )}
        </div>
      </div>

      {/* Run list */}
      <div className="panel overflow-hidden">
        {/* Header: title + filters + sort */}
        <div className="flex items-center justify-between flex-wrap gap-3 px-[18px] py-[13px] border-b border-[var(--card-border)]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-bold text-[var(--text-primary)]">Recent Runs</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-[6px] border border-[var(--card-border)] bg-[var(--bg-page)] text-[var(--text-secondary-2)]">{safeHistory.length}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1.5">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setActiveFilter(f.id)}
                  className={`px-3 py-1 rounded-[20px] text-[11px] font-semibold border transition-colors ${activeFilter === f.id ? 'bg-[var(--accent-cyan)]/10 text-[var(--accent-cyan)] border-[var(--accent-cyan)]/25' : 'border-[var(--card-border)] text-[var(--text-secondary-2)]'}`}
                >
                  {f.label} <strong className="ml-0.5 font-data">{chipCounts[f.id]}</strong>
                </button>
              ))}
            </div>
            <div className="flex border border-[var(--card-border)] rounded-[8px] overflow-hidden">
              <button type="button" onClick={() => setSort('recent')} className={`px-3 py-1 text-[11px] font-semibold transition-colors ${sort === 'recent' ? 'bg-[var(--accent-cyan)] text-white' : 'text-[var(--text-secondary-2)]'}`}>Recent</button>
              <button type="button" onClick={() => setSort('risk')}   className={`px-3 py-1 text-[11px] font-semibold transition-colors ${sort === 'risk'   ? 'bg-[var(--accent-cyan)] text-white' : 'text-[var(--text-secondary-2)]'}`}>Risk</button>
            </div>
          </div>
        </div>

        {/* Table head */}
        <div className="flex items-center gap-3 px-[18px] py-[8px] border-b border-[var(--card-border)] bg-[var(--bg-page)]">
          <div style={{ width: 8 }} />
          <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)]" style={{ flex: '0 0 132px' }}>Window / Ship.</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)] flex-1">Agents</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)]" style={{ width: 84 }}>Risk Score</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)]" style={{ width: 100 }}>Status</div>
          <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary-2)]" style={{ width: 60, textAlign: 'right' }}>Time</div>
          <div style={{ width: 14 }} />
        </div>

        {/* Rows */}
        {loading && !history ? (
          <div className="px-[18px] py-8 flex items-center gap-3 text-[var(--text-secondary-2)]">
            <div className="w-4 h-4 border-2 border-[var(--accent-cyan)]/30 border-t-[var(--accent-cyan)] rounded-full animate-spin" />
            Loading runs…
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-[18px] py-8 text-[13px] text-[var(--text-secondary-2)] text-center">No runs match this filter.</div>
        ) : (
          filtered.map(d => (
            <RunRow key={getRunKey(d)} decision={d} runLabel={runLabels.get(getRunKey(d))} basePath={BASE} />
          ))
        )}

        {/* Footer: search */}
        <div className="flex items-center justify-between px-[18px] py-3 border-t border-[var(--card-border)]">
          <div className="relative" style={{ width: 280 }}>
            <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[13px] h-[13px] text-[var(--text-secondary-2)]" />
            <input
              placeholder="Search window, shipment, container…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-[6px] rounded-[8px] border border-[var(--card-border)] text-[12px] text-[var(--text-primary)] bg-[var(--bg-page)] outline-none"
            />
          </div>
          <span className="text-[12px] font-semibold text-[var(--accent-cyan)] flex items-center gap-1 cursor-default">
            {filtered.length} of {safeHistory.length} runs <ChevronRight className="w-3 h-3" />
          </span>
        </div>
      </div>

      {/* Agent roster */}
      <AgentRoster />
    </div>
  );
}
