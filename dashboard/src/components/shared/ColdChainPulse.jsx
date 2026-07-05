// dashboard/src/components/shared/ColdChainPulse.jsx
import { useMemo, useId } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { TIER_COLORS } from '../../lib/colors';
import { formatUsdCompact } from '../../lib/format';

const ZONE_CRITICAL_MIN = 8; // °C — above this is CRITICAL
const ZONE_WARNING_MIN = 4;  // °C — between WARNING_MIN and CRITICAL_MIN is WARNING

/**
 * Temperature-over-time chart with CRITICAL/WARNING/SAFE risk-zone bands
 * and a highlighted excursion point, for the shipment currently flagged
 * as highest-risk on the Overview page.
 *
 * `windows`: array of { window_id, avg_temp_c, risk_tier } in chronological order.
 * `shipmentId` / `riskTier` / `score`: identify and label which shipment this is.
 */
export default function ColdChainPulse({ shipmentId, windows, riskTier, score, valueAtRisk }) {
  const gradientId = useId();
  const { points, minTemp, maxTemp, excursion } = useMemo(() => {
    const valid = (windows || []).filter(w => typeof w.avg_temp_c === 'number');
    if (valid.length === 0) return { points: [], minTemp: 0, maxTemp: 10, excursion: null };
    const temps = valid.map(w => w.avg_temp_c);
    const minTemp = Math.min(...temps, ZONE_WARNING_MIN - 1);
    const maxTemp = Math.max(...temps, ZONE_CRITICAL_MIN + 1);
    const excursion = valid.find(w => w.avg_temp_c >= ZONE_CRITICAL_MIN) || null;
    const points = valid.map((w, i) => ({
      x: valid.length > 1 ? (i / (valid.length - 1)) * 640 + 15 : 327,
      temp: w.avg_temp_c,
      windowId: w.window_id,
    }));
    return { points, minTemp, maxTemp, excursion };
  }, [windows]);

  if (!shipmentId || points.length === 0) {
    return (
      <div className="panel p-4 flex items-center justify-center" style={{ minHeight: 200 }}>
        <p className="text-xs text-[var(--text-secondary-2)]">No escalated shipments in this range — nothing to pulse-check.</p>
      </div>
    );
  }

  const range = maxTemp - minTemp || 1;
  const toY = (temp) => 10 + (1 - (temp - minTemp) / range) * 110; // chart area: y in [10,120]
  const excursionPoint = excursion ? points.find(p => p.windowId === excursion.window_id) : null;

  // Smooth the line into a cubic-bezier path instead of straight segments.
  const linePath = points.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${toY(p.temp)}`;
    const prev = points[i - 1];
    const midX = (prev.x + p.x) / 2;
    return `${d} C${midX},${toY(prev.temp)} ${midX},${toY(p.temp)} ${p.x},${toY(p.temp)}`;
  }, '');
  const fillPath = `${linePath} L${points[points.length - 1].x},140 L${points[0].x},140 Z`;

  const critZoneY = toY(ZONE_CRITICAL_MIN);
  const warnZoneY = toY(ZONE_WARNING_MIN);
  const tierColor = TIER_COLORS[riskTier] || 'var(--accent-cyan)';

  return (
    <div className="panel p-4 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold font-heading text-[var(--text-primary)]">Cold-Chain Pulse</h2>
          {riskTier && (
            <span className="text-[8px] font-bold font-heading px-1.5 py-0.5 rounded tracking-wide"
              style={{ color: tierColor, backgroundColor: `color-mix(in srgb, ${tierColor} 15%, transparent)` }}>
              {riskTier}
            </span>
          )}
        </div>
        <Link to={`/shipments/${shipmentId}`} className="text-[10px] font-heading font-semibold flex items-center gap-0.5 shrink-0"
          style={{ color: 'var(--accent-cyan)' }}>
          View shipment <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      <p className="text-[11px] text-[var(--text-secondary-2)] mb-2.5">
        Highest-risk shipment in range — <span className="font-data font-semibold" style={{ color: 'var(--accent-cyan)' }}>{shipmentId}</span>
        {typeof score === 'number' && <> · score {score.toFixed(3)}</>} · {points.length} window{points.length === 1 ? '' : 's'}
        {typeof valueAtRisk === 'number' && valueAtRisk > 0 && (
          <> · <span className="font-data font-semibold" style={{ color: 'var(--accent-amber)' }}>{formatUsdCompact(valueAtRisk)} at risk</span></>
        )}
      </p>

      <svg viewBox="0 0 670 140" className="w-full flex-1" style={{ minHeight: 130 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`pulse-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`crit-zone-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-red)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="var(--accent-red)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* gridlines */}
        <line x1="0" y1="10" x2="670" y2="10" stroke="var(--card-border)" strokeWidth="1" />
        <line x1="0" y1={(critZoneY + warnZoneY) / 2} x2="670" y2={(critZoneY + warnZoneY) / 2} stroke="var(--card-border)" strokeWidth="1" strokeDasharray="2,4" />
        <line x1="0" y1={(warnZoneY + 120) / 2} x2="670" y2={(warnZoneY + 120) / 2} stroke="var(--card-border)" strokeWidth="1" strokeDasharray="2,4" />
        <line x1="0" y1="130" x2="670" y2="130" stroke="var(--card-border)" strokeWidth="1" />

        {/* critical zone wash */}
        <rect x="0" y="0" width="670" height={critZoneY} fill={`url(#crit-zone-${gradientId})`} />

        {/* zone labels */}
        <text x="664" y={critZoneY > 18 ? 16 : critZoneY - 4} textAnchor="end" fill="var(--accent-red)" fontSize="8.5" fontWeight="600" opacity="0.65" letterSpacing="0.06em">CRITICAL</text>
        <text x="664" y={(critZoneY + warnZoneY) / 2 + 4} textAnchor="end" fill="var(--accent-amber)" fontSize="8.5" fontWeight="600" opacity="0.55" letterSpacing="0.06em">WARNING</text>
        <text x="664" y="128" textAnchor="end" fill="var(--accent-emerald)" fontSize="8.5" fontWeight="600" opacity="0.55" letterSpacing="0.06em">SAFE</text>

        {/* smooth temperature curve + gradient fill */}
        <path d={fillPath} fill={`url(#pulse-fill-${gradientId})`} />
        <path d={linePath} fill="none" stroke="var(--accent-cyan)" strokeWidth="2.5" strokeLinecap="round" />

        {/* excursion marker */}
        {excursionPoint && (
          <>
            <circle cx={excursionPoint.x} cy={toY(excursion.avg_temp_c)} r="9" fill="var(--accent-red)" opacity="0.18" />
            <line x1={excursionPoint.x} y1={toY(excursion.avg_temp_c)} x2={excursionPoint.x} y2="140"
              stroke="var(--accent-red)" strokeWidth="1" strokeDasharray="2,3" opacity="0.5" />
            <circle cx={excursionPoint.x} cy={toY(excursion.avg_temp_c)} r="4.5" fill="var(--accent-red)" stroke="var(--card-bg)" strokeWidth="2" />
            <text x={excursionPoint.x + 10} y={toY(excursion.avg_temp_c) - 4} fill="var(--accent-red)" fontSize="10" fontWeight="700">{excursion.avg_temp_c.toFixed(1)}°C</text>
            <text x={excursionPoint.x + 10} y={toY(excursion.avg_temp_c) + 8} fill="var(--accent-red)" fontSize="8" opacity="0.75">excursion</text>
          </>
        )}
      </svg>

      <div className="flex justify-between text-[8px] font-data text-[var(--text-secondary-2)] mt-1 px-0.5">
        <span>{points[0].windowId}</span>
        {points.length > 2 && <span>{points[Math.floor(points.length / 2)].windowId}</span>}
        <span>{points[points.length - 1].windowId}</span>
      </div>
    </div>
  );
}
