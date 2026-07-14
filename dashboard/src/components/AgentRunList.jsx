import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import AgentRunRow from './AgentRunRow';
import { EmptyState, ChartSkeleton } from './shared/States';
import { runStatusSemantic } from '../lib/runStatus';
import { buildRunLabels } from '../lib/runGroups';
import { getRunKey } from '../lib/runKey';
import { TIER_ORDER } from '../lib/colors';

const FILTERS = [
  { id: 'all', label: 'All', predicate: () => true },
  { id: 'critical', label: 'Critical', predicate: d => d.risk_tier === 'CRITICAL' },
  { id: 'awaiting', label: 'Awaiting Approval', predicate: d => runStatusSemantic(d) === 'crit' },
  { id: 'resolved', label: 'Resolved', predicate: d => runStatusSemantic(d) === 'ok' },
];

function tierRank(tier) {
  const i = TIER_ORDER.indexOf(tier);
  return i === -1 ? TIER_ORDER.length : i;
}

export default function AgentRunList({ history, loading }) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [sort, setSort] = useState('recent');

  const safeHistory = useMemo(() => (Array.isArray(history) ? history : []), [history]);
  const runLabels = useMemo(() => buildRunLabels(safeHistory), [safeHistory]);

  const kpiCounts = useMemo(() => ({
    total: safeHistory.length,
    critical: safeHistory.filter(d => d.risk_tier === 'CRITICAL').length,
    awaiting: safeHistory.filter(d => runStatusSemantic(d) === 'crit').length,
    resolved: safeHistory.filter(d => runStatusSemantic(d) === 'ok').length,
  }), [safeHistory]);

  const chipCounts = useMemo(() => {
    const counts = {};
    for (const f of FILTERS) counts[f.id] = safeHistory.filter(f.predicate).length;
    return counts;
  }, [safeHistory]);

  const filtered = useMemo(() => {
    const activeDef = FILTERS.find(f => f.id === activeFilter) || FILTERS[0];
    let result = safeHistory.filter(activeDef.predicate);

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(d => {
        const haystack = [d.window_id, d._window_id, d.shipment_id, d.container_id]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      });
    }

    result = [...result].sort((a, b) => {
      if (sort === 'risk') {
        const diff = tierRank(a.risk_tier) - tierRank(b.risk_tier);
        if (diff !== 0) return diff;
      }
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    return result;
  }, [safeHistory, activeFilter, search, sort]);

  if (loading && !history) {
    return <div className="space-y-2"><ChartSkeleton height={56} /><ChartSkeleton height={56} /><ChartSkeleton height={56} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="panel p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary-2)] mb-1">Total Runs</p>
          <p className="font-data text-lg font-bold text-[var(--text-primary)]" data-testid="kpi-total">{kpiCounts.total}</p>
        </div>
        <div className="panel p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary-2)] mb-1">Critical</p>
          <p className="font-data text-lg font-bold text-[var(--accent-red)]" data-testid="kpi-critical">{kpiCounts.critical}</p>
        </div>
        <div className="panel p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary-2)] mb-1">Awaiting Approval</p>
          <p className="font-data text-lg font-bold text-[var(--accent-amber)]" data-testid="kpi-awaiting">{kpiCounts.awaiting}</p>
        </div>
        <div className="panel p-3">
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-secondary-2)] mb-1">Resolved</p>
          <p className="font-data text-lg font-bold text-[var(--accent-emerald)]" data-testid="kpi-resolved">{kpiCounts.resolved}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTERS.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveFilter(f.id)}
              className={`text-[11px] px-3 py-1 rounded-full border transition-colors ${
                activeFilter === f.id
                  ? 'border-[var(--accent-cyan)] text-[var(--accent-cyan)] bg-[var(--accent-cyan)]/10'
                  : 'border-[var(--card-border)] text-[var(--text-secondary-2)]'
              }`}
            >
              {f.label} <span className="font-data opacity-70">{chipCounts[f.id]}</span>
            </button>
          ))}
        </div>
        <div className="flex border border-[var(--card-border)] rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setSort('recent')}
            className={`text-[11px] px-3 py-1.5 ${sort === 'recent' ? 'bg-[var(--accent-cyan)] text-white' : 'text-[var(--text-secondary-2)]'}`}
          >
            Most recent
          </button>
          <button
            type="button"
            onClick={() => setSort('risk')}
            className={`text-[11px] px-3 py-1.5 ${sort === 'risk' ? 'bg-[var(--accent-cyan)] text-white' : 'text-[var(--text-secondary-2)]'}`}
          >
            Highest risk
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary-2)]" />
        <input
          placeholder="Search by window, shipment, or container id"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm bg-[var(--card-bg)] border border-[var(--card-border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary-2)]"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No runs found" description="Try a different search or filter, or run the orchestrator above." />
      ) : (
        <div className="space-y-2">
          {filtered.map(d => (
            <AgentRunRow key={d.window_id || d._window_id} decision={d} runLabel={runLabels.get(getRunKey(d))} />
          ))}
        </div>
      )}
    </div>
  );
}
