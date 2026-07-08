import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { Link, useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { AlertTriangle, Thermometer, Activity, ClipboardCheck, CheckCircle2, Search, Bot, ShieldCheck, ChevronRight, DollarSign, Boxes } from 'lucide-react';
import TierBadge from './TierBadge';
import { TIER_COLORS, TIER_ORDER } from '../lib/colors';
import ColdChainPulse from './shared/ColdChainPulse';
import { StatCardSkeleton, ChartSkeleton, ErrorState, EmptyState } from './shared/States';
import { getAgentHeadline } from '../lib/agentSummaries';
import { timeAgo, formatUsdCompact } from '../lib/format';
import { safeStr } from '../lib/toolResults';
import KpiCard from './shared/KpiCard';

// Short display labels for agent feed chips — matching mockup aesthetic
const AGENT_FEED_CHIPS = {
  triage_agent:       { label: 'RISK',       bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
  compliance_agent:   { label: 'COMPLIANCE', bg: 'rgba(139,92,246,0.12)',  color: '#a78bfa' },
  notification_agent: { label: 'NOTIFY',     bg: 'rgba(34,211,238,0.12)',  color: '#22d3ee' },
  approval_workflow:  { label: 'ESCALATION', bg: 'rgba(251,191,36,0.12)',  color: '#fbbf24' },
  cold_storage_agent: { label: 'STORAGE',    bg: 'rgba(56,189,248,0.12)',  color: '#38bdf8' },
  route_agent:        { label: 'ROUTE',      bg: 'rgba(34,211,238,0.12)',  color: '#22d3ee' },
  insurance_agent:    { label: 'INSURE',     bg: 'rgba(52,211,153,0.12)',  color: '#34d399' },
  _default:           { label: 'AGENT',      bg: 'rgba(148,163,184,0.10)', color: '#94a3b8' },
};

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
  const navigate = useNavigate();
  const [rangeHours, setRangeHours] = useState(24);
  const { data, loading, error, refetch } = useApi(
    `/risk/overview${rangeHours ? `?hours=${rangeHours}` : ''}`, [rangeHours]
  );
  const { data: history } = useApi('/orchestrator/history?limit=200');
  const { data: pendingApprovals } = useApi('/approvals/pending');
  const topShipment = data?.top_risky_shipments?.[0];
  const topShipmentId = topShipment?.shipment_id;
  const { data: pulseWindows } = useApi(`/shipments/${topShipmentId || 'none'}/windows`);

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
    escalated: data.escalated_shipments || 0,
    monitored: data.monitored_shipments || 0,
    critical: data.tier_counts.CRITICAL || 0,
    valueAtRisk: formatUsdCompact(data.total_value_at_risk_usd),
    pendingApprovals: (pendingApprovals || []).length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">

      {/* Section 1 — Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3 ">
        <div>
          <h1 className="text-2xl font-bold font-heading" style={{ color: 'var(--text-primary)' }}>Cold-Chain Overview</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary-2)' }}>
            {data.total_shipments} active shipments &middot; last updated {lastUpdated}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-0.5 p-0.5 rounded-lg" style={{ backgroundColor: 'var(--bg-page)' }}>
            {[[24, '24h'], [168, '7d'], [0, 'All']].map(([h, label]) => (
              <button key={h} onClick={() => setRangeHours(h)}
                className="px-3 py-1.5 rounded-md text-xs font-heading font-semibold transition"
                style={rangeHours === h
                  ? { backgroundColor: 'rgba(34,211,238,0.10)', color: 'var(--accent-cyan)' }
                  : { color: 'var(--text-secondary-2)' }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 panel-sm px-3 py-2">
            <ShieldCheck className="w-4 h-4" style={{ color: 'var(--accent-emerald)' }} />
            <span className="text-xs font-heading font-medium" style={{ color: 'var(--accent-emerald)' }}>GDP Compliant</span>
          </div>
        </div>
      </div>

      {/* Section 2 — Hero banner */}
      <div
        className="relative overflow-hidden rounded-2xl p-5"
        style={{
          background: 'linear-gradient(135deg, #0e3a4f 0%, #0a2d3d 50%, #0d1f35 100%)',
          border: '1px solid rgba(34,211,238,0.15)',
        }}
      >
        {/* glow blob */}
        <div className="pointer-events-none absolute -top-10 -right-10 w-48 h-48 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.08) 0%, transparent 70%)' }} />
        <div className="grid grid-cols-4 divide-x divide-[rgba(34,211,238,0.10)]">
          {/* Col 1 — Fleet Size */}
          <div className="px-6 first:pl-0">
            <p className="text-[11px] font-heading font-medium uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.7)' }}>Fleet Size</p>
            <p className="text-[28px] font-extrabold font-data leading-tight text-white">{statValues.shipments}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>Active shipments in transit</p>
          </div>

          {/* Col 2 — Value at Risk */}
          <div className="px-6">
            <p className="text-[11px] font-heading font-medium uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.7)' }}>Value at Risk</p>
            <p className="text-[28px] font-extrabold font-data leading-tight text-white">{statValues.valueAtRisk}</p>
            <p className="text-xs mt-1 font-data" style={{ color: statValues.escalated > 0 ? '#fca5a5' : 'rgba(148,163,184,0.6)' }}>
              {statValues.escalated} escalated
            </p>
          </div>

          {/* Col 3 — Escalated Windows */}
          <div className="px-6">
            <p className="text-[11px] font-heading font-medium uppercase tracking-wider mb-1" style={{ color: 'rgba(148,163,184,0.7)' }}>Escalated Windows</p>
            <p className="text-[28px] font-extrabold font-data leading-tight" style={{ color: totalWindows > 0 ? '#fbbf24' : 'white' }}>{totalWindows}</p>
            <p className="text-xs mt-1" style={{ color: 'rgba(148,163,184,0.6)' }}>across all risk tiers</p>
          </div>

          {/* Col 4 — Action buttons */}
          <div className="px-6 flex flex-col gap-2 justify-center">
            {statValues.pendingApprovals > 0 && (
              <Link
                to="/approvals"
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold font-heading transition hover:opacity-90"
                style={{ backgroundColor: 'var(--accent-red)', color: '#fff' }}
              >
                Review {statValues.pendingApprovals} Approval{statValues.pendingApprovals === 1 ? '' : 's'}
              </Link>
            )}
            <Link
              to="/agent"
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold font-heading transition hover:opacity-90"
              style={{ backgroundColor: 'var(--accent-cyan)', color: '#0b1120' }}
            >
              Run Orchestrator
            </Link>
          </div>
        </div>
      </div>

      {/* Section 3 — Alert / all-clear banner */}
      {topApproval ? (
        <div className="panel p-4 flex items-center justify-between gap-4 flex-wrap " style={{ borderLeft: '4px solid var(--accent-red)' }}>
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
            Review &rarr;
          </Link>
        </div>
      ) : (
        <div className="panel p-4 flex items-center gap-3 ">
          <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--accent-emerald)' }} />
          <p className="text-sm font-heading text-[var(--text-secondary-2)]">No shipments need attention right now.</p>
        </div>
      )}

      {/* Section 4 — KPI cards */}
      <div className="grid grid-cols-4 gap-4 ">
        <KpiCard
          icon={Boxes}
          variant="blue"
          value={statValues.shipments}
          label="Active Shipments"
          trend={statValues.escalated > 0 ? `${statValues.escalated} escalated` : undefined}
        />
        <KpiCard
          icon={AlertTriangle}
          variant="purple"
          value={String(statValues.critical).padStart(3, '0')}
          label="Critical Alerts"
          trend={statValues.critical > 0 ? `${statValues.critical} active` : undefined}
        />
        <KpiCard
          icon={DollarSign}
          variant="amber"
          value={statValues.valueAtRisk}
          label="Value at Risk"
        />
        <KpiCard
          icon={ClipboardCheck}
          variant="teal"
          value={statValues.pendingApprovals}
          label="Pending Approvals"
          trend={statValues.pendingApprovals > 0 ? `${statValues.pendingApprovals} pending` : undefined}
        />
      </div>

      {/* Section 5 — Three-column row */}
      <div className="grid gap-4 " style={{ gridTemplateColumns: '1fr 2.4fr 1fr' }}>

        {/* Left — Tier Distribution */}
        <div className="panel overflow-hidden">
          <div className="px-[18px] pt-[14px] pb-[12px]" style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
            <h2 className="text-[12.5px] font-bold font-heading text-[var(--text-primary)]">Tier Distribution</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary-2)' }}>Escalated windows only</p>
          </div>
          <div className="px-[18px] py-3">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                  innerRadius={46} outerRadius={72} paddingAngle={3} strokeWidth={0}>
                  {pieData.map(d => (
                    <Cell key={d.name} fill={TIER_COLORS[d.name]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <text x="50%" y="46%" textAnchor="middle" className="fill-[var(--text-primary)] text-xl font-bold font-data">{totalWindows}</text>
                <text x="50%" y="58%" textAnchor="middle" className="fill-[var(--text-secondary-2)] text-[10px]">escalated</text>
              </PieChart>
            </ResponsiveContainer>
            {/* Vertical legend matching mockup */}
            <div className="space-y-2 mt-1 px-2">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary-2)' }}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIER_COLORS[d.name] }} />
                    {d.name.charAt(0) + d.name.slice(1).toLowerCase()}
                  </div>
                  <span className="text-[12px] font-bold font-data" style={{ color: TIER_COLORS[d.name] }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Center — ColdChainPulse */}
        <ColdChainPulse
          shipmentId={topShipmentId}
          windows={pulseWindows}
          riskTier={topShipment?.latest_risk_tier}
          score={topShipment?.max_fused_score}
          valueAtRisk={topShipment?.value_at_risk_usd}
        />

        {/* Right — Live Agent Activity */}
        <div className="panel overflow-hidden">
          <div className="flex items-center justify-between px-[18px] pt-[14px] pb-[12px]"
            style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
            <div>
              <h2 className="text-[12.5px] font-bold font-heading text-[var(--text-primary)]">Live Agent Activity</h2>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary-2)' }}>Last 6 actions</p>
            </div>
            <Link to="/agent" className="text-[11px] font-semibold font-heading hover:underline" style={{ color: 'var(--accent-cyan)' }}>View all →</Link>
          </div>
          <div className="px-[18px] py-2">
            {recentActions.length === 0 ? (
              <EmptyState icon={Bot} title="No agent activity yet"
                description="Run the orchestrator from the Agent Activity page to see actions here." />
            ) : (
              <div>
                {recentActions.slice(0, 6).map((item, i) => {
                  const headline = getAgentHeadline(item.action.tool, item.action);
                  const chip = AGENT_FEED_CHIPS[item.action.tool] || AGENT_FEED_CHIPS._default;
                  return (
                    <div key={i} className="flex items-center gap-2 py-[8px]"
                      style={i < recentActions.slice(0,6).length - 1 ? { borderBottom: '1px solid rgba(148,163,184,0.06)' } : {}}>
                      <span className="shrink-0 rounded-md px-[7px] py-[3px] text-[10px] font-bold tracking-wide"
                        style={{ background: chip.bg, color: chip.color }}>{chip.label}</span>
                      <span className="text-[11.5px] truncate flex-1" style={{ color: 'var(--text-secondary-2)' }}>{headline.title}</span>
                      <span className="text-[10px] font-data shrink-0" style={{ color: 'rgba(148,163,184,0.35)' }}>{timeAgo(item.timestamp)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 6 — Shipment Risk Table */}
      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
          <div>
            <h2 className="text-[12.5px] font-bold font-heading text-[var(--text-primary)]">Shipment Risk Summary</h2>
            <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary-2)' }}>Click a row for shipment details</p>
          </div>
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
              <tr className="text-left text-[11px] text-[var(--text-secondary-2)] uppercase tracking-wider font-heading"
                style={{ background: 'rgba(148,163,184,0.02)', borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
                <th className="px-3.5 py-2.5 font-medium first:pl-5">Shipment</th>
                <th className="px-3.5 py-2.5 font-medium">Containers</th>
                <th className="px-3.5 py-2.5 font-medium">Products</th>
                <th className="px-3.5 py-2.5 font-medium">Windows</th>
                <th className="px-3.5 py-2.5 font-medium">Latest Tier</th>
                <th className="px-3.5 py-2.5 font-medium">Max Score</th>
                <th className="px-3.5 py-2.5 font-medium text-right">% Critical</th>
                <th className="px-3.5 py-2.5 font-medium text-right pr-5">Value at Risk</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.length === 0 ? (
                <tr><td colSpan={8}>
                  <EmptyState icon={Search} title="No shipments match your filters"
                    description="Try a different shipment ID, tier, or product." />
                </td></tr>
              ) : filteredShipments.slice(0, 10).map((s, i) => (
                <tr key={s.shipment_id}
                    onClick={() => navigate(`/shipments/${s.shipment_id}`)}
                    className="hover:bg-white/[0.03] transition animate-fade-in cursor-pointer"
                    style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}
                    style={{ animationDelay: `${760 + i * 40}ms` }}>
                  <td className="py-2.5 px-3.5 first:pl-5">
                    <span className="font-medium font-data flex items-center gap-1.5" style={{ color: 'var(--accent-cyan)' }}>
                      {s.shipment_id}
                      <ChevronRight className="w-3.5 h-3.5 opacity-50" />
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 text-[var(--text-secondary-2)]">{s.containers.join(', ')}</td>
                  <td className="py-2.5 px-3.5 text-[var(--text-secondary-2)]">{s.products.join(', ')}</td>
                  <td className="py-2.5 px-3.5 text-[var(--text-primary)] font-data">{s.total_windows}</td>
                  <td className="py-2.5 px-3.5 first:pl-5"><TierBadge tier={s.latest_risk_tier} /></td>
                  <td className="py-2.5 px-3.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-[64px] h-1.5 rounded-full" style={{ backgroundColor: 'var(--card-border)' }}>
                        <div className="h-1.5 rounded-full" style={{
                          width: `${Math.min(s.max_fused_score * 100, 100)}%`,
                          backgroundColor: TIER_COLORS[s.latest_risk_tier] || 'var(--text-secondary-2)',
                        }} />
                      </div>
                      <span className="font-data text-[var(--text-primary)] shrink-0">{s.max_fused_score.toFixed(4)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3.5 text-right">
                    <span className="font-data" style={{ color: s.pct_critical > 30 ? 'var(--accent-red)' : 'var(--text-secondary-2)' }}>
                      {s.pct_critical}%
                    </span>
                  </td>
                  <td className="py-2.5 px-3.5 text-right">
                    <span className="font-data font-semibold" style={{ color: 'var(--accent-amber)' }}>
                      {formatUsdCompact(s.value_at_risk_usd)}
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
