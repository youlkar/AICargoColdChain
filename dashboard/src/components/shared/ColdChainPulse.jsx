import { useMemo, useId } from 'react';
import { Link } from 'react-router-dom';
import { formatUsdCompact } from '../../lib/format';
import TierBadge from '../TierBadge';

const TIER_COLORS = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#eab308', LOW: '#22c55e' };
// Bar heights (px) per tier — proportional, never filling the full container
const TIER_HEIGHTS = { CRITICAL: 48, HIGH: 38, MEDIUM: 28, LOW: 18 };
const TIER_OPACITY = { CRITICAL: 0.85, HIGH: 0.85, MEDIUM: 0.85, LOW: 0.5 };
// Always show at least this many bar slots so sparse shipments don't look blocky
const MIN_BAR_SLOTS = 12;

export default function ColdChainPulse({ shipmentId, windows, riskTier, score, valueAtRisk }) {
  const gradId = useId();

  const { bars, sparkPoints, maxTemp, totalWindows } = useMemo(() => {
    const valid = (windows || []).filter(w => w.risk_tier);
    const withTemp = valid.filter(w => typeof w.avg_temp_c === 'number');

    // Subsample to max 20 bars for visual clarity
    const step = valid.length > 20 ? Math.ceil(valid.length / 20) : 1;
    const rawBars = valid.filter((_, i) => i % step === 0).slice(0, 20);
    // Pad to MIN_BAR_SLOTS with nulls so sparse shipments don't render as giant blocks
    const bars = rawBars.length < MIN_BAR_SLOTS
      ? [...rawBars, ...Array(MIN_BAR_SLOTS - rawBars.length).fill(null)]
      : rawBars;

    // Sparkline from temp values (or fallback: tier-rank if no temp)
    const TIER_RANK = { CRITICAL: 1, HIGH: 0.7, MEDIUM: 0.45, LOW: 0.2 };
    const yValues = withTemp.length > 1
      ? withTemp.map(w => w.avg_temp_c)
      : valid.map(w => TIER_RANK[w.risk_tier] ?? 0);

    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const yRange = yMax - yMin || 1;

    const sparkPoints = yValues.map((v, i) => ({
      x: yValues.length > 1 ? (i / (yValues.length - 1)) * 400 : 200,
      // map to y ∈ [8, 44] — high value = high y (inverted for SVG)
      y: 44 - ((v - yMin) / yRange) * 36,
    }));

    const maxTemp = withTemp.length ? Math.max(...withTemp.map(w => w.avg_temp_c)) : null;

    return { bars, sparkPoints, maxTemp, totalWindows: valid.length };
  }, [windows]);

  if (!shipmentId) {
    return (
      <div className="panel flex items-center justify-center" style={{ minHeight: 200 }}>
        <p className="text-xs" style={{ color: 'var(--text-secondary-2)' }}>
          No escalated shipments in this range.
        </p>
      </div>
    );
  }

  // Smooth cubic-bezier sparkline path
  const sparkLine = sparkPoints.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = sparkPoints[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
  }, '');
  const sparkFill = sparkPoints.length > 1
    ? `${sparkLine} L${sparkPoints.at(-1).x},48 L0,48 Z`
    : '';

  const tempLabel = maxTemp != null ? `${maxTemp.toFixed(1)}°C` : '—';
  const varLabel = typeof valueAtRisk === 'number' ? formatUsdCompact(valueAtRisk) : '—';

  return (
    <div className="panel overflow-hidden flex flex-col">

      {/* ── Header ── */}
      <div className="flex items-start justify-between px-[18px] pt-[14px] pb-[12px]"
        style={{ borderBottom: '1px solid rgba(148,163,184,0.06)' }}>
        <div>
          <p className="text-[12.5px] font-bold font-heading" style={{ color: 'var(--text-primary)' }}>
            Cold-Chain Pulse{' '}
            <Link to={`/shipments/${shipmentId}`}
              className="font-data hover:underline"
              style={{ color: 'var(--accent-cyan)', fontSize: '11px' }}>
              · {shipmentId}
            </Link>
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary-2)' }}>
            Highest-risk shipment · {totalWindows}-window view
          </p>
        </div>
        {riskTier && <TierBadge tier={riskTier} size="sm" />}
      </div>

      {/* ── Chart area ── */}
      <div className="px-[18px] pt-3 pb-1 flex-1 flex flex-col">
        <p className="text-[11px] mb-2" style={{ color: 'var(--text-secondary-2)' }}>
          Risk windows over time (colour = tier)
        </p>

        {/* Colored bar blocks — always MIN_BAR_SLOTS slots wide */}
        <div className="flex items-end gap-[3px]" style={{ height: '56px' }}>
          {bars.map((w, i) =>
            w == null ? (
              <div key={i} className="flex-1" style={{ minWidth: 0 }} />
            ) : (
              <div key={i} className="flex-1 rounded-[3px]"
                style={{
                  height: `${TIER_HEIGHTS[w.risk_tier] ?? 18}px`,
                  background: TIER_COLORS[w.risk_tier] ?? '#22c55e',
                  opacity: TIER_OPACITY[w.risk_tier] ?? 0.6,
                  minWidth: 0,
                }} />
            )
          )}
        </div>

        {/* Sparkline */}
        {sparkPoints.length > 1 && (
          <svg width="100%" height="64" viewBox="0 0 400 48"
            preserveAspectRatio="none" className="block mt-1">
            <defs>
              <linearGradient id={`sg-${gradId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={sparkFill} fill={`url(#sg-${gradId})`} />
            <path d={sparkLine} fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </div>

      {/* ── Bottom stats ── */}
      <div className="grid grid-cols-4 px-[18px] py-[10px]"
        style={{ borderTop: '1px solid rgba(148,163,184,0.06)' }}>
        {[
          {
            value: typeof score === 'number' ? score.toFixed(4) : '—',
            label: 'Max Risk Score',
            color: typeof score === 'number' && score > 0.5 ? 'var(--accent-red)' : 'var(--text-primary)',
          },
          {
            value: tempLabel,
            label: 'Temp Excursion',
            color: 'var(--text-primary)',
          },
          {
            value: totalWindows,
            label: 'Windows',
            color: 'var(--text-primary)',
          },
          {
            value: varLabel,
            label: 'Value at Risk',
            color: 'var(--accent-amber)',
          },
        ].map(({ value, label, color }) => (
          <div key={label} className="text-center">
            <p className="text-[15px] font-extrabold font-data tabular-nums leading-tight"
              style={{ color }}>{value}</p>
            <p className="text-[9px] font-heading font-semibold uppercase tracking-wider mt-1"
              style={{ color: 'var(--text-secondary-2)' }}>{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
