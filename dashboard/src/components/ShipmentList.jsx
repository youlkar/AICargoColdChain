import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { Ship, ChevronRight, Thermometer } from 'lucide-react';
import { humanize } from '../lib/toolResults';
import './shipments-v2.css';

const TIERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const TIER_STYLE = {
  CRITICAL: { bg: 'var(--ship-red-soft)', color: 'var(--ship-red)' },
  HIGH:     { bg: 'var(--ship-amber-soft)', color: 'var(--ship-amber)' },
  MEDIUM:   { bg: 'var(--ship-yellow-soft)', color: 'var(--ship-yellow)' },
  LOW:      { bg: 'var(--ship-green-soft)', color: 'var(--ship-green)' },
};

function TierBadgeV2({ tier, size }) {
  const s = TIER_STYLE[tier] || TIER_STYLE.LOW;
  return <span className={size === 'lg' ? 'ship-tier-lg' : 'ship-tier'} style={{ background: s.bg, color: s.color }}>{tier}</span>;
}

// Small ring donut built from a shipment's tier percentages — pure SVG, no
// charting library, same technique used across the other redesigned pages.
function MiniDonut({ pctCritical = 0, pctHigh = 0 }) {
  const pctLowMed = Math.max(0, 100 - pctCritical - pctHigh);
  const c = 2 * Math.PI * 20; // circumference for r=20
  const segs = [
    { pct: pctCritical, color: 'var(--ship-red)' },
    { pct: pctHigh, color: 'var(--ship-amber)' },
    { pct: pctLowMed, color: 'var(--ship-green)' },
  ].filter(s => s.pct > 0);

  // Precompute each segment's dash length + cumulative offset without
  // mutating a variable during render (offsets derived functionally).
  const arcs = segs.reduce((acc, s) => {
    const dash = (s.pct / 100) * c;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    return [...acc, { ...s, dash, offset }];
  }, []);

  return (
    <svg className="ship-donut" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="20" fill="none" stroke="var(--ship-track)" strokeWidth="7" />
      {arcs.map((s, i) => (
        <circle key={i} cx="26" cy="26" r="20" fill="none" stroke={s.color} strokeWidth="7"
          strokeDasharray={`${s.dash} ${c - s.dash}`} strokeDashoffset={-s.offset}
          transform="rotate(-90 26 26)" strokeLinecap="round" />
      ))}
    </svg>
  );
}

export default function ShipmentList() {
  const [filter, setFilter] = useState('ALL');
  const [sort, setSort] = useState('risk');
  const [search, setSearch] = useState('');
  const { data: shipments, loading, error } = useApi(filter === 'ALL' ? '/shipments' : `/shipments?risk_tier=${filter}`, [filter]);
  const { data: analytics } = useApi('/analytics');

  const containersByShipment = {};
  if (analytics?.container_stats) {
    for (const c of analytics.container_stats) {
      if (!containersByShipment[c.shipment_id]) containersByShipment[c.shipment_id] = [];
      containersByShipment[c.shipment_id].push(c);
    }
  }

  const tierCounts = useMemo(() => {
    const counts = { ALL: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const s of shipments || []) {
      counts.ALL++;
      if (counts[s.latest_risk_tier] != null) counts[s.latest_risk_tier]++;
    }
    return counts;
  }, [shipments]);

  const kpis = useMemo(() => {
    const rows = shipments || [];
    const avgScore = rows.length
      ? rows.reduce((s, r) => s + (r.max_fused_score || 0), 0) / rows.length
      : 0;
    return {
      total: rows.length,
      critical: rows.filter(s => s.latest_risk_tier === 'CRITICAL').length,
      high: rows.filter(s => s.latest_risk_tier === 'HIGH').length,
      avgScore,
    };
  }, [shipments]);

  const filteredSorted = useMemo(() => {
    let rows = shipments || [];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(s => s.shipment_id.toLowerCase().includes(q));
    rows = [...rows].sort((a, b) => sort === 'risk'
      ? (b.max_fused_score || 0) - (a.max_fused_score || 0)
      : (b.total_windows || 0) - (a.total_windows || 0));
    return rows;
  }, [shipments, search, sort]);

  return (
    <div className="ship">

      {/* Header */}
      <div className="ship-top">
        <div>
          <h1 className="ship-title">Shipments &amp; Containers</h1>
          <p className="ship-sub">Shipment → Container → Window hierarchy with risk breakdown</p>
        </div>
      </div>

      {/* KPI summary — computed live from the current shipment list */}
      <div className="ship-kpis">
        <div className="ship-kpi">
          <div className="ship-kpi-tag" style={{ background: 'var(--ship-blue-soft)', color: 'var(--ship-blue)' }}>ALL</div>
          <div className="ship-kpi-label">Total Shipments</div>
          <div className="ship-kpi-value">{kpis.total}</div>
        </div>
        <div className="ship-kpi">
          <div className="ship-kpi-tag" style={{ background: 'var(--ship-red-soft)', color: 'var(--ship-red)' }}>!</div>
          <div className="ship-kpi-label">Critical</div>
          <div className="ship-kpi-value" style={{ color: 'var(--ship-red)' }}>{kpis.critical}</div>
        </div>
        <div className="ship-kpi">
          <div className="ship-kpi-tag" style={{ background: 'var(--ship-amber-soft)', color: 'var(--ship-amber)' }}>!</div>
          <div className="ship-kpi-label">High</div>
          <div className="ship-kpi-value" style={{ color: 'var(--ship-amber)' }}>{kpis.high}</div>
        </div>
        <div className="ship-kpi">
          <div className="ship-kpi-label">Avg. Max Score</div>
          <div className="ship-kpi-value">{kpis.avgScore.toFixed(3)}</div>
        </div>
      </div>

      {/* Filter + sort + search */}
      <div className="ship-bar">
        <div className="ship-tabs">
          {TIERS.map(t => (
            <button key={t} type="button" className={`ship-tab${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>
              {humanize(t.toLowerCase())} <strong>{tierCounts[t]}</strong>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="ship-sorttoggle">
            <button type="button" className={sort === 'risk' ? 'active' : ''} onClick={() => setSort('risk')}>Risk</button>
            <button type="button" className={sort === 'windows' ? 'active' : ''} onClick={() => setSort('windows')}>Windows</button>
          </div>
          <div className="ship-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" strokeLinecap="round" /></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shipment ID" />
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ship-ink-2)', padding: '24px 0' }}>
          Loading shipments…
        </div>
      )}
      {error && <p style={{ color: 'var(--ship-red)' }}>Error: {error}</p>}

      {!loading && filteredSorted.length === 0 && (
        <div className="ship-empty">
          <Ship style={{ display: 'block', margin: '0 auto' }} />
          <p className="t">No shipments match this filter</p>
          <p className="d">Try a different tier or search term.</p>
        </div>
      )}

      {filteredSorted.map(s => {
        const containers = containersByShipment[s.shipment_id] || [];
        return (
          <div key={s.shipment_id} className="ship-card">
            <Link to={`/shipments/${s.shipment_id}`} className="ship-head">
              <div className="ship-icon"><Ship style={{ width: 17, height: 17 }} /></div>
              <div className="ship-titleblock">
                <span className="ship-idlink">{s.shipment_id}</span>
                <div className="ship-metarow">
                  <span>{s.total_windows} windows</span><span className="sep" />
                  <span>{s.containers.length} container{s.containers.length > 1 ? 's' : ''}</span><span className="sep" />
                  <span>{s.products.join(', ')}</span>
                </div>
              </div>
              <TierBadgeV2 tier={s.latest_risk_tier} size="lg" />
              <MiniDonut pctCritical={s.pct_critical} pctHigh={s.pct_high} />
              <div className="ship-score">
                <div className="v">{s.max_fused_score.toFixed(3)}</div>
                <div className="k">max score</div>
              </div>
              <ChevronRight className="ship-chev" />
            </Link>

            {containers.length > 0 && (
              <div className="ship-containers">
                {containers.map(c => (
                  <div key={c.container_id} className="ship-containerrow">
                    <span className="cid">{c.container_id}</span>
                    <div className="cmeta">
                      <span>{c.product_id}</span>
                      <TierBadgeV2 tier={c.risk_tier} />
                      <span>{c.windows} windows</span>
                      {c.critical_windows > 0 && <span style={{ color: 'var(--ship-red)' }}>{c.critical_windows} critical</span>}
                      {c.high_windows > 0 && <span style={{ color: 'var(--ship-amber)' }}>{c.high_windows} high</span>}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Thermometer style={{ width: 12, height: 12 }} />{c.avg_temp}°C avg</span>
                      <span>Phases: {(c.phases || []).map(humanize).join(', ')}</span>
                    </div>
                    <div className="cscore">
                      <div className="ship-scorebar">
                        <div className="ship-scoretrack"><div className="ship-scorefill" style={{ width: `${Math.min(c.max_score * 100, 100)}%`, background: TIER_STYLE[c.risk_tier]?.color }} /></div>
                        <span className="ship-mono" style={{ color: 'var(--ship-ink-0)', fontSize: 11 }}>{c.max_score.toFixed(3)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}
