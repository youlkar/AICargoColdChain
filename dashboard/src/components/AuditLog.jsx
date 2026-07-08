import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  ScrollText, ChevronDown, ChevronUp, Shield, AlertTriangle, FileCheck,
  CheckCircle, Clock, ArrowRight,
} from 'lucide-react';
import { TIER_COLORS } from '../lib/colors';
import { getAgentMeta } from '../lib/agents.jsx';
import { getRunKey } from '../lib/runKey';
import { runStatusSemantic } from '../lib/runStatus';
import { timeAgo } from '../lib/format';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card-sm px-3 py-2 text-xs shadow-xl">
      {label && <p className="font-semibold text-white">{label}</p>}
      {payload.map((p, i) => <p key={i} style={{ color: p.color || p.fill }}>{p.name}: {p.value}</p>)}
    </div>
  );
}

const RUN_STATUS_LABEL = { crit: 'Awaiting', warn: 'Corrections', ok: 'Resolved', info: 'No actions' };
const RUN_STATUS_CLS = {
  crit: 'bg-amber-500/10 text-amber-400',
  warn: 'bg-amber-500/10 text-amber-400',
  ok: 'bg-emerald-500/10 text-emerald-400',
  info: 'bg-slate-500/10 text-slate-400',
};

function RunCard({ run }) {
  const windowId = run.window_id || run._window_id;
  const level = runStatusSemantic(run);
  const uniqueTools = [...new Set((run.actions_taken || []).map(a => a?.tool).filter(Boolean))];
  const runKey = getRunKey(run);

  return (
    <div className="glass-card-sm overflow-hidden animate-fade-in px-5 py-3 flex items-center gap-3">
      <TierBadge tier={run.risk_tier} />
      <span className="font-mono text-xs font-semibold text-white">{windowId}</span>
      <span className="text-[11px] text-slate-500">{run.shipment_id}{run.container_id ? ` / ${run.container_id}` : ''}</span>

      <div className="flex flex-wrap gap-[3px]">
        {uniqueTools.slice(0, 5).map(t => {
          const meta = getAgentMeta(t);
          return (
            <span key={t} className={`px-[7px] py-[2px] rounded-full text-[10px] font-bold border ${meta.color.bg} ${meta.color.text} ${meta.color.border}`}>
              {meta.name}
            </span>
          );
        })}
        {uniqueTools.length > 5 && (
          <span className="text-[10px] text-slate-500 self-center">+{uniqueTools.length - 5}</span>
        )}
      </div>

      <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-[10px] py-[3px] rounded-md ml-2 ${RUN_STATUS_CLS[level]}`}>
        {level === 'ok' ? <CheckCircle className="w-[10px] h-[10px]" /> : <Clock className="w-[10px] h-[10px]" />}
        {RUN_STATUS_LABEL[level]}
      </span>

      <span className="text-[10px] text-slate-600 ml-auto shrink-0">{timeAgo(run.timestamp)}</span>

      <Link
        to={`/agent-v2/runs/${encodeURIComponent(runKey)}`}
        className="flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition shrink-0"
      >
        View run <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
}

export default function AuditLog() {
  const [viewMode, setViewMode] = useState('compliance'); // 'compliance' | 'runs'
  const [tierFilter, setTierFilter] = useState('');

  const [expanded, setExpanded] = useState(null);

  const compliancePath = tierFilter ? `/audit-logs?limit=200&risk_tier=${tierFilter}` : '/audit-logs?limit=200';
  const path = viewMode === 'runs' ? '/orchestrator/history?limit=30' : compliancePath;
  const { data, loading, error } = useApi(path, [viewMode, tierFilter]);

  const complianceStats = useMemo(() => {
    if (viewMode !== 'compliance' || !data || !data.length) return null;
    const tierCounts = {};
    const ruleCounts = {};
    let needsApproval = 0;
    for (const rec of data) {
      const t = rec.risk_tier || 'UNKNOWN';
      tierCounts[t] = (tierCounts[t] || 0) + 1;
      if (rec.requires_human_approval) needsApproval++;
      for (const r of (rec.deterministic_rules_fired || [])) {
        ruleCounts[r] = (ruleCounts[r] || 0) + 1;
      }
    }
    const pieData = Object.entries(tierCounts).map(([k, v]) => ({ name: k, value: v }));
    const ruleData = Object.entries(ruleCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([k, v]) => ({ rule: k.replace(/_/g, ' '), count: v }));
    return { total: data.length, tierCounts, pieData, ruleData, needsApproval };
  }, [data, viewMode]);

  const runStats = useMemo(() => {
    if (viewMode !== 'runs' || !data || !data.length) return null;
    const awaiting = data.filter(d => runStatusSemantic(d) === 'crit').length;
    const resolved = data.filter(d => runStatusSemantic(d) === 'ok').length;
    return { total: data.length, awaiting, resolved };
  }, [data, viewMode]);

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Audit Log</h1>
          <p className="text-sm text-slate-500 mt-0.5">GDP / FDA 21 CFR 11 compliant assessment records</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={viewMode} onChange={e => setViewMode(e.target.value)}
            className="bg-slate-800/60 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/40 transition">
            <option value="compliance">Compliance Records</option>
            <option value="runs">Latest Shipment Runs</option>
          </select>
          {viewMode === 'compliance' && (
            <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
              className="bg-slate-800/60 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/40 transition">
              <option value="">All tiers</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
            </select>
          )}
        </div>
      </div>

      {/* Compliance Metrics */}
      {viewMode === 'compliance' && complianceStats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="glass-card-sm p-4 animate-slide-up">
            <div className="flex items-center gap-2 mb-2">
              <FileCheck className="w-4 h-4 text-cyan-400" />
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Total Records</p>
            </div>
            <p className="text-2xl font-bold text-white">{complianceStats.total}</p>
            {complianceStats.needsApproval > 0 && <p className="text-[10px] text-amber-400 mt-1">{complianceStats.needsApproval} require approval</p>}
          </div>

          <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '60ms' }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Tier Distribution</p>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={complianceStats.pieData} dataKey="value" cx="50%" cy="50%" innerRadius={16} outerRadius={26} strokeWidth={0}>
                    {complianceStats.pieData.map(d => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#64748b'} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-0.5">
                {complianceStats.pieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
                    <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLORS[d.name] || '#64748b' }} />
                    <span className="text-slate-400">{d.name}</span>
                    <span className="text-white font-mono">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="col-span-2 glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '120ms' }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Most Triggered Rules</p>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={complianceStats.ruleData} layout="vertical" margin={{ left: 0, right: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="rule" tick={{ fontSize: 9, fill: '#94a3b8' }} width={120} stroke="transparent" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="#f97316" fillOpacity={0.6} radius={[0, 4, 4, 0]} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Runs Metrics */}
      {viewMode === 'runs' && runStats && (
        <div className="grid grid-cols-3 gap-4">
          <div className="glass-card-sm p-4 animate-slide-up">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Total Runs</p>
            <p className="text-2xl font-bold text-white">{runStats.total}</p>
          </div>
          <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '60ms' }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Awaiting Approval</p>
            <p className="text-2xl font-bold text-amber-400">{runStats.awaiting}</p>
          </div>
          <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '120ms' }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-1">Resolved</p>
            <p className="text-2xl font-bold text-emerald-400">{runStats.resolved}</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-slate-500 py-8">
          <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          Loading {viewMode === 'runs' ? 'shipment runs' : 'audit log'}...
        </div>
      )}
      {error && <p className="text-red-400">Error: {error}</p>}

      {data && data.length === 0 && (
        <div className="glass-card p-10 text-center">
          <ScrollText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">{viewMode === 'runs' ? 'No shipment runs found.' : 'No audit records found.'}</p>
        </div>
      )}

      {/* Runs view */}
      {viewMode === 'runs' && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((run, i) => (
            <div key={getRunKey(run)} style={{ animationDelay: `${Math.min(i * 15, 500)}ms` }}>
              <RunCard run={run} />
            </div>
          ))}
        </div>
      )}

      {/* Compliance view */}
      {viewMode === 'compliance' && data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((rec, i) => {
            if (rec.entry_type === 'guardrail_finding') {
              return (
                <div key={i} className="glass-card-sm overflow-hidden animate-fade-in px-5 py-3 flex items-center gap-3"
                  style={{ animationDelay: `${Math.min(i * 15, 500)}ms` }}>
                  <AlertTriangle className={`w-4 h-4 shrink-0 ${rec.severity === 'critical' ? 'text-red-400' : 'text-amber-400'}`} />
                  <span className="font-mono text-xs font-semibold text-white">{rec.check}</span>
                  <span className="text-[11px] text-slate-500">{rec.agent}</span>
                  <span className="text-xs text-slate-400 truncate">{rec.message}</span>
                  <span className="text-[10px] text-slate-600 ml-auto shrink-0">{rec.timestamp}</span>
                </div>
              );
            }
            return (
            <div key={i} className="glass-card-sm overflow-hidden animate-fade-in" style={{ animationDelay: `${Math.min(i * 15, 500)}ms` }}>
              <div className="px-5 py-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition"
                   onClick={() => setExpanded(expanded === i ? null : i)}>
                <TierBadge tier={rec.risk_tier} />
                <span className="font-mono text-xs font-semibold text-white">{rec.window_id}</span>
                <span className="text-[11px] text-slate-500">{rec.shipment_id} / {rec.container_id}</span>
                <span className="text-xs text-slate-400 font-mono ml-2">{rec.final_score?.toFixed(4)}</span>
                {rec.requires_human_approval && <Shield className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                <span className="text-[10px] text-slate-600 ml-auto">{rec.assessment_timestamp}</span>
                {expanded === i ? <ChevronUp className="w-4 h-4 text-slate-600" /> : <ChevronDown className="w-4 h-4 text-slate-600" />}
              </div>

              {expanded === i && (
                <div className="px-5 pb-4 border-t border-white/[0.06] pt-3 grid grid-cols-4 gap-4 text-xs animate-fade-in">
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider mb-1.5 font-medium text-[10px]">Scores</p>
                    <p className="text-slate-400">Det: <span className="font-mono text-orange-400">{rec.deterministic_score?.toFixed(4)}</span></p>
                    <p className="text-slate-400">ML: <span className="font-mono text-emerald-400">{rec.ml_score?.toFixed(4)}</span></p>
                    <p className="text-slate-400">Final: <span className="font-mono font-semibold text-white">{rec.final_score?.toFixed(4)}</span></p>
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider mb-1.5 font-medium text-[10px]">Rules Fired</p>
                    {rec.deterministic_rules_fired?.length > 0
                      ? rec.deterministic_rules_fired.map((r, j) => <p key={j} className="text-orange-400/80">{r}</p>)
                      : <p className="text-slate-600">none</p>}
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider mb-1.5 font-medium text-[10px]">Top ML Features</p>
                    {(rec.ml_top_features || []).slice(0, 3).map((f, j) => (
                      <p key={j} className="text-slate-400">{f.feature}: <span className="font-mono text-violet-400">{f.shap_value?.toFixed(3)}</span></p>
                    ))}
                  </div>
                  <div>
                    <p className="text-slate-500 uppercase tracking-wider mb-1.5 font-medium text-[10px]">Actions</p>
                    {rec.recommended_actions?.map((a, j) => <p key={j} className="text-cyan-400/80">{a}</p>)}
                    {rec.requires_human_approval && <p className="text-red-400 font-semibold mt-1">Requires human approval</p>}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
