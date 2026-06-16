import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Link } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { AlertTriangle, Thermometer, Activity, ShieldCheck, ArrowUpRight, CheckCircle2, Search, Bot } from 'lucide-react';
import TierBadge from './TierBadge';
import { TIER_COLORS, TIER_ORDER } from '../lib/colors';
import StatCard from './shared/StatCard';
import ColdChainPulse from './shared/ColdChainPulse';
import { StatCardSkeleton, ChartSkeleton, ErrorState, EmptyState } from './shared/States';
import AgentChip from './shared/AgentChip';
import { getAgentHeadline } from '../lib/agentSummaries';
import { timeAgo } from '../lib/format';
import { safeStr } from '../lib/toolResults';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="panel-sm px-3 py-2 text-xs">
      <p className="font-semibold font-heading text-[var(--text-primary)]">{d.shipment || d.name}</p>
      <p className="text-[var(--text-secondary-2)] mt-0.5 font-data">
        {d.score != null ? `Score: ${d.score.toFixed(4)}` : `Count: ${d.value}`}
      </p>
    </div>
  );
}

export default function Overview() {
  const { data, loading, error, refetch } = useApi('/risk/overview');
  const { data: history } = useApi('/orchestrator/history?limit=200');
  const { data: pendingApprovals } = useApi('/approvals/pending');
  const topShipmentId = data?.top_risky_shipments?.[0]?.shipment_id;
  const { data: pulseWindows } = useApi(`/shipments/${topShipmentId || 'none'}/windows`);

  const [rangeHours, setRangeHours] = useState(24);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('ALL');
  const [productFilter, setProductFilter] = useState('ALL');

  if (error) return (
    <div className="p-6 max-w-7xl mx-auto">
      <ErrorState message={error} onRetry={refetch} />
    </div>
  );

  // Highest-priority pending approval (CRITICAL first, else first item)
  const topApproval = (pendingApprovals || []).find(a => a.risk_tier === 'CRITICAL') || (pendingApprovals || [])[0] || null;

  if (loading || !data) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="h-8 w-64 rounded bg-slate-500/15 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
        <ChartSkeleton height={140} />
        <div className="grid grid-cols-2 gap-6">
          <ChartSkeleton />
          <ChartSkeleton />
        </div>
      </div>
    );
  }

  const pieData = TIER_ORDER.filter(t => data.tier_counts[t]).map(t => ({ name: t, value: data.tier_counts[t] }));
  const totalWindows = pieData.reduce((s, d) => s + d.value, 0);
  const barData = (data.top_risky_shipments || []).slice(0, 8).map(s => ({
    shipment: s.shipment_id,
    score: s.max_fused_score,
    tier: s.latest_risk_tier,
  }));

  const cutoff = rangeHours > 0 ? Date.now() - rangeHours * 3600 * 1000 : 0;
  const recentActions = (history || [])
    .filter(d => !cutoff || new Date(d.timestamp || 0).getTime() >= cutoff)
    .flatMap(d => (Array.isArray(d.actions_taken) ? d.actions_taken : [])
      .filter(a => a && typeof a === 'object' && a.tool !== 'approval_workflow')
      .map(a => ({ action: a, timestamp: d.timestamp, windowId: d.window_id || d._window_id, shipmentId: d.shipment_id })))
    .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
    .slice(0, 6);

  const allProducts = [...new Set((data.top_risky_shipments || []).flatMap(s => s.products))].sort();
  const filteredShipments = (data.top_risky_shipments || []).filter(s => {
    if (tierFilter !== 'ALL' && s.latest_risk_tier !== tierFilter) return false;
    if (productFilter !== 'ALL' && !s.products.includes(productFilter)) return false;
    if (search.trim() && !s.shipment_id.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const lastUpdated = (history && history[0]?.timestamp) ? timeAgo(history[0].timestamp) : 'just now';
  const statValues = {
    shipments: data.total_shipments,
    critical: data.tier_counts.CRITICAL || 0,
    avgScore: (data.top_risky_shipments || []).length > 0
      ? ((data.top_risky_shipments.reduce((s, x) => s + x.max_fused_score, 0)) / data.top_risky_shipments.length).toFixed(2)
      : '—',
    agentsOnline: '5/5',
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-heading text-[var(--text-primary)]">Cold-Chain Overview</h1>
          <p className="text-sm text-[var(--text-secondary-2)] mt-0.5">
            {data.total_shipments} active shipments &middot; last updated {lastUpdated}
          </p>
        </div>
        <select value={rangeHours} onChange={e => setRangeHours(Number(e.target.value))}
          className="panel-sm px-3 py-2 text-xs font-heading text-[var(--text-primary)] bg-transparent outline-none cursor-pointer">
          <option value={24}>Last 24h</option>
          <option value={168}>Last 7d</option>
          <option value={0}>All time</option>
        </select>
        <div className="flex items-center gap-2 panel-sm px-3 py-2">
          <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent-emerald)' }} />
          <span className="text-xs font-heading font-medium" style={{ color: 'var(--accent-emerald)' }}>GDP Compliant</span>
        </div>
      </div>

      {topApproval ? (
        <div className="panel p-4 flex items-center justify-between gap-4 flex-wrap" style={{ borderLeft: '4px solid var(--accent-red)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in oklab, var(--accent-red) 15%, transparent)' }}>
              <AlertTriangle className="w-4.5 h-4.5" style={{ color: 'var(--accent-red)' }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold font-heading text-[var(--text-primary)]">
                {pendingApprovals.length} shipment{pendingApprovals.length === 1 ? '' : 's'} need{pendingApprovals.length === 1 ? 's' : ''} attention
              </p>
              <p className="text-xs text-[var(--text-secondary-2)] mt-0.5 truncate">
                {topApproval.shipment_id} {safeStr(topApproval.window_id)} &middot; {topApproval.action_description}
              </p>
            </div>
          </div>
          <Link to="/approvals" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold font-heading shrink-0"
            style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-page)' }}>
            Review <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      ) : (
        <div className="panel p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--accent-emerald)' }} />
          <p className="text-sm font-heading text-[var(--text-secondary-2)]">No shipments need attention right now.</p>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Active Shipments" value={statValues.shipments} accent="cyan" delay={0} />
        <StatCard icon={AlertTriangle} label="Critical Alerts" value={String(statValues.critical).padStart(3, '0')} accent="red" delay={60} />
        <StatCard icon={Thermometer} label="Avg Risk Score" value={statValues.avgScore} accent="amber" delay={120} />
        <StatCard icon={ShieldCheck} label="Agents Online" value={statValues.agentsOnline} accent="emerald" delay={180} />
      </div>

      <ColdChainPulse shipmentId={topShipmentId} windows={pulseWindows} />

      <div className="grid grid-cols-2 gap-6">
        <div className="panel p-6 animate-slide-up" style={{ animationDelay: '480ms' }}>
          <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)] mb-1">Tier Distribution</h2>
          <p className="text-[11px] text-[var(--text-secondary-2)] mb-4">Risk classification breakdown across all windows</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                innerRadius={65} outerRadius={100} paddingAngle={3} strokeWidth={0}>
                {pieData.map(d => (
                  <Cell key={d.name} fill={TIER_COLORS[d.name]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <text x="50%" y="46%" textAnchor="middle" className="fill-[var(--text-primary)] text-2xl font-bold font-data">{totalWindows}</text>
              <text x="50%" y="56%" textAnchor="middle" className="fill-[var(--text-secondary-2)] text-[11px]">total</text>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-5 mt-3">
            {pieData.map(d => (
              <span key={d.name} className="flex items-center gap-1.5 text-xs text-[var(--text-secondary-2)] font-heading">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLORS[d.name] }} />
                {d.name} <span className="font-data">{d.value}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="panel p-6 animate-slide-up" style={{ animationDelay: '560ms' }}>
          <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)] mb-1">Top Risky Shipments</h2>
          <p className="text-[11px] text-[var(--text-secondary-2)] mb-4">Highest fused risk scores across active shipments</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
              <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 10, fill: 'var(--text-secondary-2)' }} stroke="transparent" />
              <YAxis type="category" dataKey="shipment" tick={{ fontSize: 10, fill: 'var(--text-secondary-2)' }} width={60} stroke="transparent" />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="score" radius={[0, 6, 6, 0]}>
                {barData.map((d, i) => (
                  <Cell key={i} fill={TIER_COLORS[d.tier] || '#64748b'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="panel p-6 animate-slide-up" style={{ animationDelay: '640ms' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)]">Live Agent Activity</h2>
          <Link to="/agent" className="text-xs font-heading text-[var(--accent-cyan)] hover:underline">View all &rarr;</Link>
        </div>
        {recentActions.length === 0 ? (
          <EmptyState icon={Bot} title="No agent activity yet"
            description="Run the orchestrator from the Agent Activity page to see actions here." />
        ) : (
          <div className="space-y-1.5">
            {recentActions.map((item, i) => {
              const headline = getAgentHeadline(item.action.tool, item.action);
              return (
                <div key={i} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/[0.02] transition">
                  <AgentChip toolId={item.action.tool} size="sm" />
                  <span className="text-xs text-[var(--text-secondary-2)] truncate flex-1">{headline.title}</span>
                  <Link to={`/shipments/${item.shipmentId}`} className="text-[10px] font-data text-[var(--text-secondary-2)] hover:text-[var(--accent-cyan)] shrink-0">
                    {item.windowId}
                  </Link>
                  <span className="text-[10px] font-data text-[var(--text-secondary-2)] shrink-0 w-14 text-right">{timeAgo(item.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="panel p-6 animate-slide-up" style={{ animationDelay: '720ms' }}>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)]">Shipment Risk Summary</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 panel-sm px-2.5 py-1.5">
              <Search className="w-3.5 h-3.5 text-[var(--text-secondary-2)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shipment ID"
                className="bg-transparent outline-none text-xs font-heading text-[var(--text-primary)] placeholder-[var(--text-secondary-2)] w-32" />
            </div>
            <select value={tierFilter} onChange={e => setTierFilter(e.target.value)}
              className="panel-sm px-2.5 py-1.5 text-xs font-heading text-[var(--text-primary)] bg-transparent outline-none cursor-pointer">
              <option value="ALL">All tiers</option>
              {TIER_ORDER.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
              className="panel-sm px-2.5 py-1.5 text-xs font-heading text-[var(--text-primary)] bg-transparent outline-none cursor-pointer">
              <option value="ALL">All products</option>
              {allProducts.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--card-border)] text-left text-[11px] text-[var(--text-secondary-2)] uppercase tracking-wider font-heading">
                <th className="pb-3 pr-4 font-medium">Shipment</th>
                <th className="pb-3 pr-4 font-medium">Containers</th>
                <th className="pb-3 pr-4 font-medium">Products</th>
                <th className="pb-3 pr-4 font-medium">Windows</th>
                <th className="pb-3 pr-4 font-medium">Latest Tier</th>
                <th className="pb-3 pr-4 font-medium">Max Score</th>
                <th className="pb-3 pr-4 font-medium">% Critical</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.length === 0 ? (
                <tr><td colSpan={7}>
                  <EmptyState icon={Search} title="No shipments match your filters"
                    description="Try a different shipment ID, tier, or product." />
                </td></tr>
              ) : filteredShipments.slice(0, 10).map((s, i) => (
                <tr key={s.shipment_id}
                    className="border-b border-[var(--card-border)] hover:bg-white/[0.02] transition animate-fade-in"
                    style={{ animationDelay: `${760 + i * 40}ms` }}>
                  <td className="py-3 pr-4">
                    <Link to={`/shipments/${s.shipment_id}`} className="font-medium font-data transition" style={{ color: 'var(--accent-cyan)' }}>
                      {s.shipment_id}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 text-[var(--text-secondary-2)]">{s.containers.join(', ')}</td>
                  <td className="py-3 pr-4 text-[var(--text-secondary-2)]">{s.products.join(', ')}</td>
                  <td className="py-3 pr-4 text-[var(--text-primary)] font-data">{s.total_windows}</td>
                  <td className="py-3 pr-4"><TierBadge tier={s.latest_risk_tier} /></td>
                  <td className="py-3 pr-4 font-data text-[var(--text-primary)]">{s.max_fused_score.toFixed(4)}</td>
                  <td className="py-3 pr-4">
                    <span className="font-data" style={{ color: s.pct_critical > 30 ? 'var(--accent-red)' : 'var(--text-secondary-2)' }}>
                      {s.pct_critical}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
