import { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts';
import { ScrollText, ChevronDown, ChevronUp, Shield, AlertTriangle, FileCheck } from 'lucide-react';
import { TIER_COLORS } from '../lib/colors';

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card-sm px-3 py-2 text-xs shadow-xl">
      {label && <p className="font-semibold text-white">{label}</p>}
      {payload.map((p, i) => <p key={i} style={{ color: p.color || p.fill }}>{p.name}: {p.value}</p>)}
    </div>
  );
}

export default function AuditLog() {
  const [tierFilter, setTierFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const path = tierFilter ? `/audit-logs?limit=200&risk_tier=${tierFilter}` : '/audit-logs?limit=200';
  const { data, loading, error } = useApi(path, [tierFilter]);

  const stats = useMemo(() => {
    if (!data || !data.length) return null;
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
  }, [data]);

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Audit Log</h1>
          <p className="text-sm text-slate-500 mt-0.5">GDP / FDA 21 CFR 11 compliant assessment records</p>
        </div>
        <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
          className="bg-slate-800/60 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-cyan-500/40 transition">
          <option value="">All tiers</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
      </div>

      {/* Compliance Metrics */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="glass-card-sm p-4 animate-slide-up">
            <div className="flex items-center gap-2 mb-2">
              <FileCheck className="w-4 h-4 text-cyan-400" />
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Total Records</p>
            </div>
            <p className="text-2xl font-bold text-white">{stats.total}</p>
            {stats.needsApproval > 0 && <p className="text-[10px] text-amber-400 mt-1">{stats.needsApproval} require approval</p>}
          </div>

          <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '60ms' }}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium mb-2">Tier Distribution</p>
            <div className="flex items-center gap-3">
              <div className="w-14 h-14">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={stats.pieData} dataKey="value" cx="50%" cy="50%" innerRadius={16} outerRadius={26} strokeWidth={0}>
                    {stats.pieData.map(d => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#64748b'} />)}
                  </Pie></PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-0.5">
                {stats.pieData.map(d => (
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
              <BarChart data={stats.ruleData} layout="vertical" margin={{ left: 0, right: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="rule" tick={{ fontSize: 9, fill: '#94a3b8' }} width={120} stroke="transparent" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" fill="#f97316" fillOpacity={0.6} radius={[0, 4, 4, 0]} name="Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-slate-500 py-8">
          <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          Loading audit log...
        </div>
      )}
      {error && <p className="text-red-400">Error: {error}</p>}

      {data && data.length === 0 && (
        <div className="glass-card p-10 text-center">
          <ScrollText className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No audit records found.</p>
        </div>
      )}

      {data && data.length > 0 && (
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
