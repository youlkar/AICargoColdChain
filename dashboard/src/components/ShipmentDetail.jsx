import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, BarChart, Bar, Cell, PieChart, Pie,
} from 'recharts';
import { ArrowLeft, Thermometer, TrendingUp, Package, AlertTriangle } from 'lucide-react';
import TierBadge from './TierBadge';
import { TIER_COLORS } from '../lib/colors';

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-card-sm px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-white">{d.wid}</p>
      <p className="text-slate-400">Phase: {d.phase}</p>
      {d.temp != null && <p className="text-cyan-400">Temp: {d.temp.toFixed(2)}°C</p>}
      {d.final != null && <p className="text-violet-400">Score: {d.final.toFixed(4)} ({d.tier})</p>}
    </div>
  );
}

export default function ShipmentDetail() {
  const { id } = useParams();
  const { data: windows, loading, error } = useApi(`/shipments/${id}/windows`);
  const [activeContainer, setActiveContainer] = useState(null);

  const containers = useMemo(() => {
    if (!windows) return [];
    const map = {};
    for (const w of windows) {
      if (!map[w.container_id]) map[w.container_id] = { id: w.container_id, product: w.product_id, windows: [] };
      map[w.container_id].windows.push(w);
    }
    return Object.values(map).sort((a, b) => {
      const maxA = Math.max(...a.windows.map(w => w.final_score));
      const maxB = Math.max(...b.windows.map(w => w.final_score));
      return maxB - maxA;
    });
  }, [windows]);

  const displayWindows = useMemo(() => {
    if (!windows) return [];
    if (!activeContainer) return windows;
    return windows.filter(w => w.container_id === activeContainer);
  }, [windows, activeContainer]);

  if (loading) return (
    <div className="p-8 flex items-center gap-3 text-slate-500">
      <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
      Loading shipment...
    </div>
  );
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;

  const chartData = displayWindows.map((w, i) => ({
    idx: i, temp: w.avg_temp_c, final: w.final_score,
    det: w.det_score, ml: w.ml_score, tier: w.risk_tier,
    wid: w.window_id, phase: w.transit_phase,
  }));

  const tierCounts = {};
  for (const w of displayWindows) tierCounts[w.risk_tier] = (tierCounts[w.risk_tier] || 0) + 1;
  const pieData = Object.entries(tierCounts).map(([k, v]) => ({ name: k, value: v }));

  const phaseCounts = {};
  for (const w of displayWindows) {
    const p = w.transit_phase || 'unknown';
    if (!phaseCounts[p]) phaseCounts[p] = { phase: p, count: 0, crit: 0, avgScore: 0, sumScore: 0 };
    phaseCounts[p].count++;
    phaseCounts[p].sumScore += w.final_score;
    if (w.risk_tier === 'CRITICAL') phaseCounts[p].crit++;
  }
  const phaseData = Object.values(phaseCounts).map(p => ({
    ...p, avgScore: p.count > 0 ? p.sumScore / p.count : 0,
  })).sort((a, b) => b.avgScore - a.avgScore);

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/shipments" className="text-slate-500 hover:text-slate-300 transition"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-2xl font-bold text-white">{id}</h1>
        <span className="text-sm text-slate-500">{displayWindows.length} windows{activeContainer ? ` in ${activeContainer}` : ''}</span>
        {tierCounts.CRITICAL > 0 && <TierBadge tier="CRITICAL" size="lg" />}
        {tierCounts.HIGH > 0 && <TierBadge tier="HIGH" size="lg" />}
      </div>

      {/* Container tabs */}
      {containers.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setActiveContainer(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !activeContainer ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white' : 'glass-card-sm text-slate-400 hover:text-slate-300'
            }`}>
            All ({windows.length})
          </button>
          {containers.map(c => {
            const maxScore = Math.max(...c.windows.map(w => w.final_score));
            const worst = c.windows.reduce((w, x) => x.final_score > w.final_score ? x : w).risk_tier;
            return (
              <button key={c.id} onClick={() => setActiveContainer(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-2 ${
                  activeContainer === c.id ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white' : 'glass-card-sm text-slate-400 hover:text-slate-300'
                }`}>
                <Package className="w-3 h-3" />
                {c.id}
                <span className="text-[10px] opacity-70">{c.product}</span>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: TIER_COLORS[worst] || '#64748b' }} />
                <span className="text-[10px] font-mono">{c.windows.length}w</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card-sm p-4 animate-slide-up">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Tier Breakdown</p>
          <div className="flex items-center gap-3 mt-2">
            <div className="w-14 h-14">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={16} outerRadius={26} strokeWidth={0}>
                  {pieData.map(d => <Cell key={d.name} fill={TIER_COLORS[d.name]} />)}
                </Pie></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-0.5 text-[11px]">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: TIER_COLORS[d.name] }} />
                  <span className="text-slate-400">{d.name}</span>
                  <span className="text-white font-mono ml-auto">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '80ms' }}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Risk by Phase</p>
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={60}>
              <BarChart data={phaseData.slice(0, 5)} layout="vertical" margin={{ left: 0, right: 0 }}>
                <XAxis type="number" hide domain={[0, 1]} />
                <YAxis type="category" dataKey="phase" hide />
                <Bar dataKey="avgScore" radius={[0, 4, 4, 0]}>
                  {phaseData.slice(0, 5).map((d, i) => <Cell key={i} fill={d.avgScore > 0.6 ? '#ef4444' : d.avgScore > 0.3 ? '#eab308' : '#22c55e'} fillOpacity={0.7} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            {phaseData.slice(0, 3).map(d => (
              <div key={d.phase} className="flex items-center justify-between text-[10px] text-slate-400">
                <span className="truncate">{d.phase}</span>
                <span className="font-mono">{d.avgScore.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '160ms' }}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Temperature Range</p>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Min</span>
              <span className="text-cyan-400 font-mono">{Math.min(...displayWindows.map(w => w.avg_temp_c)).toFixed(1)}°C</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Mean</span>
              <span className="text-white font-mono font-semibold">
                {(displayWindows.reduce((s, w) => s + w.avg_temp_c, 0) / displayWindows.length).toFixed(1)}°C
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Max</span>
              <span className="text-red-400 font-mono">{Math.max(...displayWindows.map(w => w.avg_temp_c)).toFixed(1)}°C</span>
            </div>
          </div>
        </div>

        <div className="glass-card-sm p-4 animate-slide-up" style={{ animationDelay: '240ms' }}>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Risk Score Stats</p>
          <div className="mt-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Max Score</span>
              <span className="text-red-400 font-mono font-bold">{Math.max(...displayWindows.map(w => w.final_score)).toFixed(4)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Mean Score</span>
              <span className="text-white font-mono">
                {(displayWindows.reduce((s, w) => s + w.final_score, 0) / displayWindows.length).toFixed(4)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Containers</span>
              <span className="text-slate-300 font-mono">{containers.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-6">
        <div className="glass-card p-6 animate-slide-up" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <Thermometer className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-300">Temperature Timeline</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="temp" stroke="#06b6d4" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-6 animate-slide-up" style={{ animationDelay: '380ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold text-slate-300">Risk Score Timeline</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
              <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
              <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0.8} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={0.6} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={0.3} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.4} />
              <Line type="monotone" dataKey="final" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Fused" />
              <Line type="monotone" dataKey="det" stroke="#f97316" strokeWidth={1} dot={false} opacity={0.4} name="Det" />
              <Line type="monotone" dataKey="ml" stroke="#10b981" strokeWidth={1} dot={false} opacity={0.4} name="ML" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Window table */}
      <div className="glass-card overflow-hidden animate-slide-up" style={{ animationDelay: '460ms' }}>
        <div className="px-5 py-3.5 border-b border-white/[0.06]">
          <h2 className="text-sm font-semibold text-slate-300">Window Details</h2>
        </div>
        <div className="overflow-x-auto max-h-[400px] overflow-y-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#1e293b] z-10">
              <tr className="text-left text-[10px] text-slate-500 uppercase tracking-wider border-b border-white/[0.06]">
                <th className="px-4 py-2.5 font-medium">Window</th>
                <th className="px-4 py-2.5 font-medium">Container</th>
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-4 py-2.5 font-medium">Phase</th>
                <th className="px-4 py-2.5 font-medium">Temp</th>
                <th className="px-4 py-2.5 font-medium">Det</th>
                <th className="px-4 py-2.5 font-medium">ML</th>
                <th className="px-4 py-2.5 font-medium">Final</th>
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="px-4 py-2.5 font-medium">Rules</th>
              </tr>
            </thead>
            <tbody>
              {displayWindows.map(w => (
                <tr key={w.window_id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition">
                  <td className="px-4 py-2 font-mono text-slate-300">{w.window_id}</td>
                  <td className="px-4 py-2 text-slate-400 font-mono">{w.container_id}</td>
                  <td className="px-4 py-2 text-slate-400">{w.product_id}</td>
                  <td className="px-4 py-2 text-slate-400">{w.transit_phase}</td>
                  <td className="px-4 py-2 font-mono text-slate-300">{w.avg_temp_c?.toFixed(1)}°C</td>
                  <td className="px-4 py-2 font-mono text-orange-400/70">{w.det_score?.toFixed(3)}</td>
                  <td className="px-4 py-2 font-mono text-emerald-400/70">{w.ml_score?.toFixed(3)}</td>
                  <td className="px-4 py-2 font-mono font-semibold text-white">{w.final_score?.toFixed(4)}</td>
                  <td className="px-4 py-2"><TierBadge tier={w.risk_tier} /></td>
                  <td className="px-4 py-2 text-slate-500 max-w-[160px] truncate">{w.det_rules_fired || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
