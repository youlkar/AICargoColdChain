import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApi, getApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import './monitoring-v2.css';

// Tier -> mon palette token mapping (soft bg + solid text/dot color) — same
// system as OverviewV2 / the sidebar, kept local to this file since it's the
// only page that needs it right now.
const TIER_STYLE = {
  CRITICAL: { bg: 'var(--mon-red-soft)', color: 'var(--mon-red)' },
  HIGH:     { bg: 'var(--mon-amber-soft)', color: 'var(--mon-amber)' },
  MEDIUM:   { bg: 'var(--mon-yellow-soft)', color: 'var(--mon-yellow)' },
  LOW:      { bg: 'var(--mon-green-soft)', color: 'var(--mon-green)' },
};

function TierBadgeV2({ tier }) {
  const s = TIER_STYLE[tier] || TIER_STYLE.LOW;
  return <span className="mon-tier-badge" style={{ background: s.bg, color: s.color }}>{tier}</span>;
}

// Stacked bar for one transit phase's tier breakdown.
function PhaseStackRow({ phase, critical = 0, high = 0, medium = 0, low = 0 }) {
  const total = critical + high + medium + low;
  const pct = n => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="mon-stackrow">
      <span className="lbl">{phase}</span>
      <div className="mon-stackbar">
        {critical > 0 && <div className="mon-stackseg" style={{ width: `${pct(critical)}%`, background: 'var(--mon-red)' }} />}
        {high > 0 && <div className="mon-stackseg" style={{ width: `${pct(high)}%`, background: 'var(--mon-amber)' }} />}
        {medium > 0 && <div className="mon-stackseg" style={{ width: `${pct(medium)}%`, background: 'var(--mon-yellow)' }} />}
        {low > 0 && <div className="mon-stackseg" style={{ width: `${pct(low)}%`, background: 'var(--mon-green)' }} />}
      </div>
      <span className="total">{total}</span>
    </div>
  );
}

// SVG area chart for the score histogram — same smooth-curve approach used by
// OverviewV2's pulse chart, driven entirely by live analytics.score_histogram.
function ScoreHistogram({ bins }) {
  const { path, fill } = useMemo(() => {
    if (!bins || bins.length < 2) return {};
    const counts = bins.map(b => b.count);
    const max = Math.max(...counts, 1);
    const pts = counts.map((c, i) => ({
      x: (i / (counts.length - 1)) * 300,
      y: 150 - (c / max) * 130,
    }));
    const line = pts.reduce((d, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }, '');
    return { path: line, fill: `${line} L${pts.at(-1).x},150 L0,150 Z` };
  }, [bins]);

  if (!path) return <div className="mon-empty">Not enough histogram data yet.</div>;

  return (
    <svg width="100%" height="150" viewBox="0 0 300 150" preserveAspectRatio="none">
      <defs>
        <linearGradient id="mon-hist-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--mon-blue)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--mon-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1="37" x2="300" y2="37" stroke="var(--mon-hair)" strokeDasharray="3 3" />
      <line x1="0" y1="75" x2="300" y2="75" stroke="var(--mon-hair)" strokeDasharray="3 3" />
      <line x1="0" y1="112" x2="300" y2="112" stroke="var(--mon-hair)" strokeDasharray="3 3" />
      <path d={fill} fill="url(#mon-hist-grad)" />
      <path d={path} fill="none" stroke="var(--mon-blue)" strokeWidth="2" />
    </svg>
  );
}

export default function Monitoring() {
  const [feed, setFeed] = useState([]);
  const [page, setPage] = useState(0);
  const { data: analytics } = useApi('/analytics');
  const { data: overview } = useApi('/risk/overview');
  const { messages: liveWindows, connected } = useWebSocket(['ingest_scored']);

  const loadMore = useCallback(async () => {
    const rows = await getApi(`/windows?limit=30&offset=${page * 30}`);
    setFeed(prev => page === 0 ? rows : [...prev, ...rows]);
  }, [page]);

  useEffect(() => { loadMore(); }, [loadMore]);

  const latestLiveWindow = liveWindows[liveWindows.length - 1]?.result;
  useEffect(() => {
    if (!latestLiveWindow) return;
    setFeed(prev => prev.some(w => w.window_id === latestLiveWindow.window_id)
      ? prev
      : [latestLiveWindow, ...prev]);
  }, [latestLiveWindow]);

  const criticals = feed.filter(w => w.risk_tier === 'CRITICAL');
  const maxAvgTemp = analytics?.temp_by_product?.length
    ? Math.max(...analytics.temp_by_product.map(p => p.avg_temp), 1)
    : 1;

  return (
    <div className="mon">

      {/* Header */}
      <div className="mon-top">
        <div>
          <h1 className="mon-title">Live Monitoring</h1>
          <p className="mon-sub">Real-time risk analytics across all shipments, containers, and windows</p>
        </div>
        <div className={`mon-livechip ${connected ? 'on' : 'off'}`}>
          {connected ? (
            <span className="mon-livepulse"><span className="ping" /><span className="core" /></span>
          ) : (
            <span className="mon-livepulse"><span className="core" style={{ background: 'var(--mon-ink-2)' }} /></span>
          )}
          {connected ? 'Live' : 'Reconnecting…'}
        </div>
      </div>

      {/* KPI strip */}
      {overview && (
        <div className="mon-kpis">
          <div className="mon-kpi">
            <div className="mon-kpi-label">Escalated Windows</div>
            <div className="mon-kpi-value">{overview.total_windows.toLocaleString()}</div>
          </div>
          <div className="mon-kpi">
            <div className="mon-kpi-tag" style={{ background: 'var(--mon-red-soft)', color: 'var(--mon-red)' }}>!</div>
            <div className="mon-kpi-label">Critical</div>
            <div className="mon-kpi-value" style={{ color: 'var(--mon-red)' }}>{overview.tier_counts.CRITICAL || 0}</div>
          </div>
          <div className="mon-kpi">
            <div className="mon-kpi-tag" style={{ background: 'var(--mon-amber-soft)', color: 'var(--mon-amber)' }}>!</div>
            <div className="mon-kpi-label">High</div>
            <div className="mon-kpi-value" style={{ color: 'var(--mon-amber)' }}>{overview.tier_counts.HIGH || 0}</div>
          </div>
          <div className="mon-kpi">
            <div className="mon-kpi-label">Medium</div>
            <div className="mon-kpi-value" style={{ color: 'var(--mon-yellow)' }}>{overview.tier_counts.MEDIUM || 0}</div>
          </div>
          <div className="mon-kpi">
            <div className="mon-kpi-label">Low</div>
            <div className="mon-kpi-value" style={{ color: 'var(--mon-green)', fontSize: 16 }}>Not tracked</div>
          </div>
        </div>
      )}

      {/* Critical banner */}
      {criticals.length > 0 && (
        <div className="mon-alertbar">
          <div className="l">
            <div className="mon-alerticon"><AlertTriangle style={{ width: 16, height: 16 }} /></div>
            <div>
              <p className="t1">{criticals.length} CRITICAL windows in view</p>
              <p className="t2">Immediate action required — go to Agent Activity to orchestrate</p>
            </div>
          </div>
          <Link to="/agent-v2" className="mon-btn mon-btn-danger">Orchestrate →</Link>
        </div>
      )}

      {/* Analytics charts */}
      {analytics && (
        <div className="mon-charts3">
          <div className="mon-panel">
            <h2 className="mon-panel-h">Risk by Transit Phase</h2>
            <p className="mon-panel-sub">Window counts per phase, stacked by tier</p>
            {(analytics.phase_stats || []).map(p => <PhaseStackRow key={p.phase} {...p} />)}
            <div className="mon-stacklegend">
              <span><span className="dot" style={{ background: 'var(--mon-red)' }} />Critical</span>
              <span><span className="dot" style={{ background: 'var(--mon-amber)' }} />High</span>
              <span><span className="dot" style={{ background: 'var(--mon-yellow)' }} />Medium</span>
              <span><span className="dot" style={{ background: 'var(--mon-green)' }} />Low</span>
            </div>
          </div>

          <div className="mon-panel">
            <h2 className="mon-panel-h">Score Distribution</h2>
            <p className="mon-panel-sub">Histogram of fused risk scores (0–1)</p>
            <ScoreHistogram bins={analytics.score_histogram} />
          </div>

          <div className="mon-panel">
            <h2 className="mon-panel-h">Temperature by Product</h2>
            <p className="mon-panel-sub">Avg temp and critical % per product</p>
            {(analytics.temp_by_product || []).map(p => {
              const color = p.critical_pct > 20 ? 'var(--mon-red)' : p.critical_pct > 5 ? 'var(--mon-amber)' : 'var(--mon-blue)';
              return (
                <div key={p.product_id} className="mon-barrow">
                  <span className="lbl">{p.product_id}</span>
                  <div className="track"><div className="fill" style={{ width: `${Math.min((p.avg_temp / maxAvgTemp) * 100, 100)}%`, background: color }} /></div>
                  <span className="val">{p.avg_temp.toFixed(1)}°</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Container heatmap + Window risk feed */}
      <div className="mon-lists">
        {/* Container heatmap */}
        {analytics && (
          <div className="mon-panel" style={{ padding: 0 }}>
            <div className="mon-listhead">
              <div>
                <h2 className="mon-panel-h">Top-Risk Containers</h2>
                <p className="mon-panel-sub" style={{ marginBottom: 0 }}>Shipment → Container → Window breakdown</p>
              </div>
            </div>
            <div className="mon-listbody">
              {analytics.container_stats.slice(0, 30).map(c => (
                <div key={`${c.shipment_id}-${c.container_id}`} className="mon-row" style={{ borderLeftColor: TIER_STYLE[c.risk_tier]?.color }}>
                  <TierBadgeV2 tier={c.risk_tier} />
                  <div className="grow">
                    <Link to={`/shipments/${c.shipment_id}`} className="ship">{c.shipment_id}</Link>
                    <span className="mon-mono">{c.container_id}</span>
                    <span>{c.product_id}</span>
                    <span>{c.windows} wins</span>
                    {c.critical_windows > 0 && <span style={{ color: 'var(--mon-red)' }}>{c.critical_windows} crit</span>}
                    {c.high_windows > 0 && <span style={{ color: 'var(--mon-amber)' }}>{c.high_windows} high</span>}
                    <span>Avg: {c.avg_temp}°C</span>
                  </div>
                  <div className="miniscore">
                    <div className="track"><div className="fill" style={{ width: `${Math.min(c.max_score * 100, 100)}%`, background: TIER_STYLE[c.risk_tier]?.color }} /></div>
                    <div className="num">{c.max_score.toFixed(3)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Window risk feed */}
        <div className="mon-panel" style={{ padding: 0 }}>
          <div className="mon-listhead">
            <div>
              <h2 className="mon-panel-h">Window Risk Feed</h2>
              <p className="mon-panel-sub" style={{ marginBottom: 0 }}>{feed.length} windows loaded, sorted by risk score</p>
            </div>
          </div>
          <div className="mon-listbody">
            {feed.map(w => (
              <div key={w.window_id} className="mon-row" style={{ borderLeftColor: TIER_STYLE[w.risk_tier]?.color }}>
                <div className="rid"><div className="w">{w.window_id}</div></div>
                <div className="grow">
                  <Link to={`/shipments/${w.shipment_id}`} className="ship">{w.shipment_id}</Link>
                  <span>{w.container_id}</span>
                  <span>Temp: {w.avg_temp_c?.toFixed(1)}°C</span>
                  <span>Phase: {w.transit_phase}</span>
                  {w.det_rules_fired && <span style={{ color: 'var(--mon-amber)' }}>{w.det_rules_fired}</span>}
                </div>
                <div className="score">
                  <div className="v" style={{ color: TIER_STYLE[w.risk_tier]?.color }}>{w.final_score?.toFixed(4)}</div>
                  <div className="sub">D:{w.det_score?.toFixed(2)} ML:{w.ml_score?.toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mon-loadmore">
            <button type="button" onClick={() => setPage(p => p + 1)}>Load more</button>
          </div>
        </div>
      </div>

    </div>
  );
}
