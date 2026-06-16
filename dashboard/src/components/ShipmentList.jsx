import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar,
} from 'recharts';
import { Ship, Package, ChevronRight, AlertTriangle, Thermometer } from 'lucide-react';
import { TIER_COLORS } from '../lib/colors';

const TIERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function ShipmentList() {
  const [filter, setFilter] = useState('ALL');
  const { data: shipments, loading, error } = useApi(filter === 'ALL' ? '/shipments' : `/shipments?risk_tier=${filter}`, [filter]);
  const { data: analytics } = useApi('/analytics');

  const containersByShipment = {};
  if (analytics?.container_stats) {
    for (const c of analytics.container_stats) {
      if (!containersByShipment[c.shipment_id]) containersByShipment[c.shipment_id] = [];
      containersByShipment[c.shipment_id].push(c);
    }
  }

  return (
    <div className="p-6 max-w-[1440px] mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Shipments & Containers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Shipment → Container → Window hierarchy with risk breakdown</p>
        </div>
        <div className="flex gap-1.5">
          {TIERS.map(t => (
            <button key={t} onClick={() => setFilter(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filter === t
                  ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-lg'
                  : 'bg-white/[0.04] border border-white/[0.06] text-slate-400 hover:bg-white/[0.06]'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-slate-500 py-8">
          <div className="w-5 h-5 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
          Loading shipments...
        </div>
      )}
      {error && <p className="text-red-400">Error: {error}</p>}

      {shipments && shipments.length === 0 && (
        <div className="glass-card p-10 text-center">
          <Ship className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No shipments match this filter.</p>
        </div>
      )}

      {shipments && shipments.length > 0 && (
        <div className="space-y-4">
          {shipments.map((s, i) => {
            const containers = containersByShipment[s.shipment_id] || [];
            const pieData = [];
            if (s.pct_critical > 0) pieData.push({ name: 'CRITICAL', value: s.pct_critical });
            if (s.pct_high > 0) pieData.push({ name: 'HIGH', value: s.pct_high });
            const pctLowMed = 100 - (s.pct_critical || 0) - (s.pct_high || 0);
            if (pctLowMed > 0) pieData.push({ name: 'LOW', value: pctLowMed });

            return (
              <div key={s.shipment_id} className="glass-card overflow-hidden animate-slide-up" style={{ animationDelay: `${i * 40}ms` }}>
                {/* Shipment header */}
                <div className="px-5 py-4 flex items-center gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <Ship className="w-5 h-5 text-cyan-400 shrink-0" />
                    <div>
                      <Link to={`/shipments/${s.shipment_id}`} className="text-base font-bold text-cyan-400 hover:text-cyan-300 transition">
                        {s.shipment_id}
                      </Link>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                        <span>{s.total_windows} windows</span>
                        <span>{s.containers.length} container{s.containers.length > 1 ? 's' : ''}</span>
                        <span>{s.products.join(', ')}</span>
                      </div>
                    </div>
                  </div>
                  <TierBadge tier={s.latest_risk_tier} size="lg" />
                  {/* Mini risk donut */}
                  <div className="w-14 h-14 shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={16} outerRadius={26} strokeWidth={0}>
                          {pieData.map(d => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#22c55e'} />)}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono text-lg font-bold text-white">{s.max_fused_score.toFixed(3)}</p>
                    <p className="text-[10px] text-slate-500">max score</p>
                  </div>
                  <Link to={`/shipments/${s.shipment_id}`} className="text-slate-500 hover:text-cyan-400 transition">
                    <ChevronRight className="w-5 h-5" />
                  </Link>
                </div>

                {/* Container breakdown */}
                {containers.length > 0 && (
                  <div className="border-t border-white/[0.06] px-5 py-3">
                    <div className="grid grid-cols-1 gap-2">
                      {containers.map(c => (
                        <div key={c.container_id} className="flex items-center gap-4 py-2 px-3 rounded-lg bg-white/[0.02] hover:bg-white/[0.03] transition">
                          <Package className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-semibold text-slate-300">{c.container_id}</span>
                              <span className="text-[10px] text-slate-500">{c.product_id}</span>
                              <TierBadge tier={c.risk_tier} />
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-500">
                              <span>{c.windows} windows</span>
                              {c.critical_windows > 0 && <span className="text-red-400">{c.critical_windows} critical</span>}
                              {c.high_windows > 0 && <span className="text-orange-400">{c.high_windows} high</span>}
                              <span className="flex items-center gap-1"><Thermometer className="w-3 h-3" />{c.avg_temp}°C avg</span>
                              <span>Phases: {c.phases?.join(', ')}</span>
                            </div>
                          </div>
                          {/* Score bar */}
                          <div className="w-24 shrink-0">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all" style={{
                                  width: `${Math.min(c.max_score * 100, 100)}%`,
                                  backgroundColor: TIER_COLORS[c.risk_tier] || '#64748b',
                                }} />
                              </div>
                              <span className="text-[10px] font-mono text-slate-400 w-10 text-right">{c.max_score.toFixed(3)}</span>
                            </div>
                          </div>
                        </div>
                      ))}
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
