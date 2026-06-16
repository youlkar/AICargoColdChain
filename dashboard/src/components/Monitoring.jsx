import { useState, useEffect, useCallback } from 'react';
import { useApi, getApi } from '../hooks/useApi';
import { Link } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie, RadarChart, PolarGrid, PolarAngleAxis, Radar,
  AreaChart, Area,
} from 'recharts';
import { Activity, AlertTriangle, ThermometerSun, Zap, Shield, TrendingUp } from 'lucide-react';
import TierBadge from './TierBadge';
import { TIER_COLORS } from '../lib/colors';

const TIER_BORDER = {
  CRITICAL: 'border-l-red-500 bg-red-500/[0.04]',
  HIGH: 'border-l-orange-500 bg-orange-500/[0.03]',
  MEDIUM: 'border-l-yellow-500 bg-yellow-500/[0.02]',
  LOW: 'border-l-transparent',
};

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card-sm px-3 py-2 text-xs shadow-xl">
      {label && <p className="font-semibold text-white mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || p.fill }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
        </p>
      ))}
    </div>
  );
}

export default function Monitoring() {
  const [feed, setFeed] = useState([]);
  const [page, setPage] = useState(0);
  const { data: analytics } = useApi('/analytics');
  const { data: overview } = useApi('/risk/overview');

  const loadMore = useCallback(async () => {
    const rows = await getApi(`/windows?limit=30&offset=${page * 30}`);
    setFeed(prev => page === 0 ? rows : [...prev, ...rows]);
  }, [page]);

  useEffect(() => { loadMore(); }, [loadMore]);

  const criticals = feed.filter(w => w.risk_tier === 'CRITICAL');

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Live Monitoring</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time risk analytics across all shipments, containers, and windows</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
          </span>
          <span className="text-xs text-emerald-400 font-medium">Live</span>
        </div>
      </div>

      {/* KPI strip */}
      {overview && (
        <div className="grid grid-cols-5 gap-3">
          <KPI icon={Activity} label="Windows" value={overview.total_windows.toLocaleString()} gradient="from-cyan-500 to-blue-600" />
          <KPI icon={AlertTriangle} label="Critical" value={overview.tier_counts.CRITICAL || 0} gradient="from-red-500 to-rose-600" />
          <KPI icon={Zap} label="High" value={overview.tier_counts.HIGH || 0} gradient="from-orange-500 to-amber-600" />
          <KPI icon={ThermometerSun} label="Medium" value={overview.tier_counts.MEDIUM || 0} gradient="from-yellow-500 to-amber-500" />
          <KPI icon={Shield} label="Low" value={overview.tier_counts.LOW || 0} gradient="from-emerald-500 to-green-600" />
        </div>
      )}

      {/* Critical banner */}
      {criticals.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-500/10 via-red-600/5 to-transparent p-4">
          <div className="relative flex items-center gap-3">
            <div className="rounded-full bg-red-500/20 p-2">
              <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse" />
            </div>
            <div>
              <p className="font-semibold text-red-300">{criticals.length} CRITICAL windows in view</p>
              <p className="text-sm text-red-400/70">Immediate action required — go to Agent Activity to orchestrate</p>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Charts */}
      {analytics && (
        <div className="grid grid-cols-3 gap-5">
          {/* Risk by Transit Phase */}
          <div className="glass-card p-5 animate-slide-up">
            <h2 className="text-sm font-semibold text-slate-300 mb-1">Risk by Transit Phase</h2>
            <p className="text-[10px] text-slate-500 mb-3">Window counts per phase, stacked by tier</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={analytics.phase_stats} margin={{ bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
                <XAxis dataKey="phase" tick={{ fontSize: 9, fill: '#64748b' }} stroke="transparent" angle={-25} textAnchor="end" />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="critical" stackId="a" fill="#ef4444" name="Critical" radius={[0, 0, 0, 0]} />
                <Bar dataKey="high" stackId="a" fill="#f97316" name="High" />
                <Bar dataKey="medium" stackId="a" fill="#eab308" name="Medium" />
                <Bar dataKey="low" stackId="a" fill="#22c55e" name="Low" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Score Distribution */}
          <div className="glass-card p-5 animate-slide-up" style={{ animationDelay: '80ms' }}>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">Score Distribution</h2>
            <p className="text-[10px] text-slate-500 mb-3">Histogram of fused risk scores (0–1)</p>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={analytics.score_histogram} margin={{ bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
                <XAxis dataKey="bin_start" tick={{ fontSize: 9, fill: '#64748b' }} stroke="transparent" />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
                <Tooltip content={<ChartTooltip />} />
                <defs>
                  <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="count" stroke="#8b5cf6" fill="url(#scoreGrad)" strokeWidth={2} name="Windows" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Temperature by Product */}
          <div className="glass-card p-5 animate-slide-up" style={{ animationDelay: '160ms' }}>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">Temperature by Product</h2>
            <p className="text-[10px] text-slate-500 mb-3">Average temp and critical % per product type</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={analytics.temp_by_product} layout="vertical" margin={{ left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.06)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} stroke="transparent" />
                <YAxis type="category" dataKey="product_id" tick={{ fontSize: 10, fill: '#94a3b8' }} width={35} stroke="transparent" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="avg_temp" fill="#06b6d4" name="Avg Temp (°C)" radius={[0, 4, 4, 0]}>
                  {analytics.temp_by_product.map((d, i) => (
                    <Cell key={i} fill={d.critical_pct > 20 ? '#ef4444' : d.critical_pct > 5 ? '#f97316' : '#06b6d4'} fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Container-level view + Risk Feed side by side */}
      <div className="grid grid-cols-5 gap-5">
        {/* Container Heat Map */}
        {analytics && (
          <div className="col-span-2 glass-card overflow-hidden animate-slide-up" style={{ animationDelay: '240ms' }}>
            <div className="px-5 py-3.5 border-b border-white/[0.06]">
              <h2 className="text-sm font-semibold text-slate-300">Top-Risk Containers</h2>
              <p className="text-[10px] text-slate-500">Shipment → Container → Window breakdown</p>
            </div>
            <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto scrollbar-thin">
              {analytics.container_stats.slice(0, 30).map((c, i) => (
                <div key={`${c.shipment_id}-${c.container_id}`}
                     className={`px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition animate-fade-in`}
                     style={{ animationDelay: `${i * 15}ms` }}>
                  <TierBadge tier={c.risk_tier} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link to={`/shipments/${c.shipment_id}`} className="text-xs text-cyan-400 hover:text-cyan-300 font-medium">{c.shipment_id}</Link>
                      <span className="text-[11px] text-slate-400 font-mono">{c.container_id}</span>
                      <span className="text-[10px] text-slate-600">{c.product_id}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
                      <span>{c.windows} wins</span>
                      {c.critical_windows > 0 && <span className="text-red-400">{c.critical_windows} crit</span>}
                      {c.high_windows > 0 && <span className="text-orange-400">{c.high_windows} high</span>}
                      <span>Avg: {c.avg_temp}°C</span>
                    </div>
                  </div>
                  {/* Mini score bar */}
                  <div className="w-16 shrink-0">
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{
                        width: `${Math.min(c.max_score * 100, 100)}%`,
                        backgroundColor: TIER_COLORS[c.risk_tier] || '#64748b',
                      }} />
                    </div>
                    <p className="text-[10px] font-mono text-slate-400 text-center mt-0.5">{c.max_score.toFixed(3)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Window Risk Feed */}
        <div className="col-span-3 glass-card overflow-hidden animate-slide-up" style={{ animationDelay: '300ms' }}>
          <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-300">Window Risk Feed</h2>
              <p className="text-[10px] text-slate-500">{feed.length} windows loaded, sorted by risk score</p>
            </div>
            <TrendingUp className="w-4 h-4 text-slate-600" />
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[500px] overflow-y-auto scrollbar-thin">
            {feed.map((w, i) => (
              <div key={w.window_id}
                className={`px-5 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition border-l-4 ${TIER_BORDER[w.risk_tier] || 'border-l-transparent'}`}>
                <TierBadge tier={w.risk_tier} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white">{w.window_id}</span>
                    <Link to={`/shipments/${w.shipment_id}`} className="text-[10px] text-cyan-400 hover:text-cyan-300">{w.shipment_id}</Link>
                    <span className="text-[10px] text-slate-500">{w.container_id}</span>
                    <span className="text-[10px] text-slate-600">{w.product_id}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
                    <span>Temp: <span className="text-slate-300 font-mono">{w.avg_temp_c?.toFixed(1)}°C</span></span>
                    <span>Phase: <span className="text-slate-400">{w.transit_phase}</span></span>
                    {w.det_rules_fired && <span className="text-orange-400/80 truncate max-w-[180px]">{w.det_rules_fired}</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 w-20">
                  <p className="font-mono text-xs font-bold text-white">{w.final_score?.toFixed(4)}</p>
                  <p className="text-[9px] text-slate-500 font-mono">D:{w.det_score?.toFixed(2)} ML:{w.ml_score?.toFixed(2)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3 border-t border-white/[0.06] text-center">
            <button onClick={() => setPage(p => p + 1)} className="text-sm text-cyan-400 hover:text-cyan-300 font-medium transition">Load more</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value, gradient }) {
  return (
    <div className="glass-card-sm p-3 flex items-center gap-3">
      <div className={`rounded-lg p-2 bg-gradient-to-br ${gradient} shrink-0`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] text-slate-500 uppercase tracking-wide leading-tight truncate">{label}</p>
        <p className="text-lg font-bold text-white leading-tight tabular-nums">{value}</p>
      </div>
    </div>
  );
}
