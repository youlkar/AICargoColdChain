import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { ArrowLeft, Thermometer, TrendingUp } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { humanize } from '../lib/toolResults';
import './shipments-v2.css';

const TIER_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const TIER_STYLE = {
  CRITICAL: { bg: 'var(--ship-red-soft)', color: 'var(--ship-red)' },
  HIGH:     { bg: 'var(--ship-amber-soft)', color: 'var(--ship-amber)' },
  MEDIUM:   { bg: 'var(--ship-yellow-soft)', color: 'var(--ship-yellow)' },
  LOW:      { bg: 'var(--ship-green-soft)', color: 'var(--ship-green)' },
};

function TierBadgeV2({ tier }) {
  const s = TIER_STYLE[tier] || TIER_STYLE.LOW;
  return <span className="ship-tier-lg" style={{ background: s.bg, color: s.color }}>{tier}</span>;
}

function TierDonut({ tierCounts }) {
  const total = TIER_ORDER.reduce((s, t) => s + (tierCounts[t] || 0), 0);
  const c = 2 * Math.PI * 20;

  // Precompute each segment's dash length + cumulative offset without
  // mutating a variable during render (offsets derived functionally).
  const arcs = TIER_ORDER.filter(t => tierCounts[t] > 0).reduce((acc, t) => {
    const pct = total > 0 ? (tierCounts[t] / total) * 100 : 0;
    const dash = (pct / 100) * c;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    return [...acc, { tier: t, dash, offset }];
  }, []);

  return (
    <svg width="52" height="52" viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="20" fill="none" stroke="var(--ship-track)" strokeWidth="7" />
      {arcs.map(a => (
        <circle key={a.tier} cx="26" cy="26" r="20" fill="none" stroke={TIER_STYLE[a.tier].color} strokeWidth="7"
          strokeDasharray={`${a.dash} ${c - a.dash}`} strokeDashoffset={-a.offset}
          transform="rotate(-90 26 26)" strokeLinecap="round" />
      ))}
    </svg>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ background: 'var(--ship-panel)', border: '1px solid var(--ship-panel-border)', borderRadius: 10, padding: '8px 12px', boxShadow: 'var(--ship-shadow)' }}>
      <p style={{ fontFamily: 'Charter,Georgia,serif', fontWeight: 600, fontSize: 12, color: 'var(--ship-ink-0)', margin: 0 }}>{d.wid}</p>
      <p style={{ fontSize: 11, color: 'var(--ship-ink-2)', margin: '2px 0 0' }}>Phase: {humanize(d.phase)}</p>
      {d.temp != null && <p style={{ fontSize: 11, color: 'var(--ship-blue)', margin: '2px 0 0' }}>Temp: {d.temp.toFixed(2)}°C</p>}
      {d.final != null && <p style={{ fontSize: 11, color: TIER_STYLE[d.tier]?.color, margin: '2px 0 0' }}>Score: {d.final.toFixed(4)} ({d.tier})</p>}
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
    <div className="ship"><p style={{ color: 'var(--ship-ink-2)' }}>Loading shipment…</p></div>
  );
  if (error) return (
    <div className="ship"><p style={{ color: 'var(--ship-red)' }}>Error: {error}</p></div>
  );

  const chartData = displayWindows.map((w, i) => ({
    idx: i, temp: w.avg_temp_c, final: w.final_score,
    det: w.det_score, ml: w.ml_score, tier: w.risk_tier,
    wid: w.window_id, phase: w.transit_phase,
  }));

  const tierCounts = {};
  for (const w of displayWindows) tierCounts[w.risk_tier] = (tierCounts[w.risk_tier] || 0) + 1;

  const phaseCounts = {};
  for (const w of displayWindows) {
    const p = w.transit_phase || 'unknown';
    if (!phaseCounts[p]) phaseCounts[p] = { phase: p, count: 0, sumScore: 0 };
    phaseCounts[p].count++;
    phaseCounts[p].sumScore += w.final_score;
  }
  const phaseData = Object.values(phaseCounts).map(p => ({
    ...p, avgScore: p.count > 0 ? p.sumScore / p.count : 0,
  })).sort((a, b) => b.avgScore - a.avgScore);

  const temps = displayWindows.map(w => w.avg_temp_c);
  const scores = displayWindows.map(w => w.final_score);

  return (
    <div className="ship">

      {/* Breadcrumb */}
      <div className="ship-crumb">
        <Link to="/shipments"><ArrowLeft style={{ width: 13, height: 13 }} /> Shipments</Link>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="ship-mono" style={{ color: 'var(--ship-ink-0)', fontWeight: 600 }}>{id}</span>
        <span>{displayWindows.length} windows{activeContainer ? ` in ${activeContainer}` : ''}</span>
        {tierCounts.CRITICAL > 0 && <TierBadgeV2 tier="CRITICAL" />}
        {tierCounts.HIGH > 0 && <TierBadgeV2 tier="HIGH" />}
      </div>

      {/* Container tabs */}
      {containers.length > 1 && (
        <div className="ship-containertabs">
          <button type="button" className={`ship-ctab${!activeContainer ? ' active' : ''}`} onClick={() => setActiveContainer(null)}>
            All ({windows.length})
          </button>
          {containers.map(c => {
            const worst = c.windows.reduce((w, x) => x.final_score > w.final_score ? x : w).risk_tier;
            return (
              <button key={c.id} type="button" className={`ship-ctab${activeContainer === c.id ? ' active' : ''}`} onClick={() => setActiveContainer(c.id)}>
                {c.id}
                <span style={{ opacity: 0.75 }}>{c.product}</span>
                <span className="dot" style={{ background: activeContainer === c.id ? '#fff' : TIER_STYLE[worst]?.color }} />
                <span className="ship-mono">{c.windows.length}w</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stats row */}
      <div className="ship-statgrid">
        <div className="ship-statcard">
          <div className="ship-statcard-lbl">Tier Breakdown</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <TierDonut tierCounts={tierCounts} />
            <div style={{ fontSize: 11.5 }}>
              {TIER_ORDER.filter(t => tierCounts[t] > 0).map(t => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: TIER_STYLE[t].color, display: 'inline-block' }} />
                  <span style={{ color: 'var(--ship-ink-2)' }}>{humanize(t.toLowerCase())}</span>
                  <b className="ship-mono" style={{ marginLeft: 'auto', color: 'var(--ship-ink-0)' }}>{tierCounts[t]}</b>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="ship-statcard">
          <div className="ship-statcard-lbl">Risk by Phase</div>
          {phaseData.slice(0, 4).map(p => (
            <div key={p.phase} className="ship-phaserow">
              <span className="k">{humanize(p.phase)}</span>
              <div className="ship-scoretrack" style={{ flex: 1 }}>
                <div className="ship-scorefill" style={{ width: `${Math.min(p.avgScore * 100, 100)}%`, background: p.avgScore > 0.6 ? 'var(--ship-red)' : p.avgScore > 0.3 ? 'var(--ship-amber)' : 'var(--ship-green)' }} />
              </div>
              <span className="v">{p.avgScore.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="ship-statcard">
          <div className="ship-statcard-lbl">Temperature Range</div>
          <div className="ship-statline"><span className="k">Min</span><span className="v" style={{ color: 'var(--ship-blue)' }}>{Math.min(...temps).toFixed(1)}°C</span></div>
          <div className="ship-statline"><span className="k">Mean</span><span className="v">{(temps.reduce((s, t) => s + t, 0) / temps.length).toFixed(1)}°C</span></div>
          <div className="ship-statline"><span className="k">Max</span><span className="v" style={{ color: 'var(--ship-red)' }}>{Math.max(...temps).toFixed(1)}°C</span></div>
        </div>

        <div className="ship-statcard">
          <div className="ship-statcard-lbl">Risk Score Stats</div>
          <div className="ship-statline"><span className="k">Max Score</span><span className="v" style={{ color: 'var(--ship-red)', fontWeight: 700 }}>{Math.max(...scores).toFixed(4)}</span></div>
          <div className="ship-statline"><span className="k">Mean Score</span><span className="v">{(scores.reduce((s, x) => s + x, 0) / scores.length).toFixed(4)}</span></div>
          <div className="ship-statline"><span className="k">Containers</span><span className="v">{containers.length}</span></div>
        </div>
      </div>

      {/* Charts */}
      <div className="ship-charts2">
        <div className="ship-statcard">
          <div className="ship-chart-head">
            <Thermometer style={{ width: 15, height: 15, color: 'var(--ship-blue)' }} />
            <h2>Temperature Timeline</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <XAxis dataKey="idx" tick={{ fontSize: 10, fill: 'var(--ship-ink-2)' }} stroke="transparent" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--ship-ink-2)' }} stroke="transparent" />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="temp" stroke="var(--ship-blue)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="ship-statcard">
          <div className="ship-chart-head">
            <TrendingUp style={{ width: 15, height: 15, color: 'var(--ship-red)' }} />
            <h2>Risk Score Timeline</h2>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <XAxis dataKey="idx" tick={{ fontSize: 10, fill: 'var(--ship-ink-2)' }} stroke="transparent" />
              <YAxis domain={[0, 1]} tick={{ fontSize: 10, fill: 'var(--ship-ink-2)' }} stroke="transparent" />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={0.8} stroke="var(--ship-red)" strokeDasharray="4 4" strokeOpacity={0.5} />
              <ReferenceLine y={0.6} stroke="var(--ship-amber)" strokeDasharray="4 4" strokeOpacity={0.5} />
              <ReferenceLine y={0.3} stroke="var(--ship-yellow)" strokeDasharray="4 4" strokeOpacity={0.5} />
              <Line type="monotone" dataKey="final" stroke="var(--ship-red)" strokeWidth={2} dot={false} name="Fused" />
              <Line type="monotone" dataKey="det" stroke="var(--ship-ink-2)" strokeWidth={1} dot={false} opacity={0.6} name="Det" />
              <Line type="monotone" dataKey="ml" stroke="var(--ship-green)" strokeWidth={1} dot={false} opacity={0.6} name="ML" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Window table */}
      <div className="ship-tablecard">
        <div className="ship-table-head">
          <h2 className="ship-serif" style={{ fontWeight: 600, fontSize: 14.5, margin: 0, color: 'var(--ship-ink-0)' }}>Window Details</h2>
        </div>
        <div className="ship-tablewrap">
          <table className="ship-table">
            <thead>
              <tr>
                <th>Window</th><th>Container</th><th>Product</th><th>Phase</th>
                <th>Temp</th><th>Det</th><th>ML</th><th>Final</th><th>Tier</th><th>Rules</th>
              </tr>
            </thead>
            <tbody>
              {displayWindows.map(w => (
                <tr key={w.window_id}>
                  <td className="ship-mono" style={{ color: 'var(--ship-ink-0)' }}>{w.window_id}</td>
                  <td className="ship-mono">{w.container_id}</td>
                  <td>{w.product_id}</td>
                  <td>{humanize(w.transit_phase)}</td>
                  <td className="ship-mono" style={{ color: 'var(--ship-ink-0)' }}>{w.avg_temp_c?.toFixed(1)}°C</td>
                  <td className="ship-mono" style={{ color: 'var(--ship-amber)', opacity: 0.85 }}>{w.det_score?.toFixed(3)}</td>
                  <td className="ship-mono" style={{ color: 'var(--ship-green)', opacity: 0.85 }}>{w.ml_score?.toFixed(3)}</td>
                  <td className="ship-mono" style={{ color: 'var(--ship-ink-0)', fontWeight: 600 }}>{w.final_score?.toFixed(4)}</td>
                  <td><TierBadgeV2 tier={w.risk_tier} /></td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {w.det_rules_fired ? humanize(w.det_rules_fired) : '—'}
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
