// dashboard/src/components/shared/ColdChainPulse.jsx
import { useMemo } from 'react';

const ZONE_CRITICAL_MIN = 8; // °C — above this is CRITICAL
const ZONE_WARNING_MIN = 4;  // °C — between WARNING_MIN and CRITICAL_MIN is WARNING

/**
 * Temperature-over-time line chart with CRITICAL/WARNING/SAFE risk-zone bands
 * and highlighted excursion points (temps above ZONE_CRITICAL_MIN).
 *
 * `windows`: array of { window_id, avg_temp_c, risk_tier } in chronological order.
 * `shipmentId`: label shown in the card header.
 */
export default function ColdChainPulse({ shipmentId, windows }) {
  const { points, minTemp, maxTemp, excursion } = useMemo(() => {
    const valid = (windows || []).filter(w => typeof w.avg_temp_c === 'number');
    if (valid.length === 0) return { points: [], minTemp: 0, maxTemp: 10, excursion: null };
    const temps = valid.map(w => w.avg_temp_c);
    const minTemp = Math.min(...temps, ZONE_WARNING_MIN - 1);
    const maxTemp = Math.max(...temps, ZONE_CRITICAL_MIN + 1);
    const excursion = valid.find(w => w.avg_temp_c >= ZONE_CRITICAL_MIN) || null;
    const points = valid.map((w, i) => ({
      x: valid.length > 1 ? (i / (valid.length - 1)) * 580 + 10 : 300,
      temp: w.avg_temp_c,
      windowId: w.window_id,
    }));
    return { points, minTemp, maxTemp, excursion };
  }, [windows]);

  if (points.length === 0) return null;

  const range = maxTemp - minTemp || 1;
  const toY = (temp) => 10 + (1 - (temp - minTemp) / range) * 90; // chart area: y in [10,100]
  const polyline = points.map(p => `${p.x},${toY(p.temp)}`).join(' ');
  const excursionPoint = excursion ? points.find(p => p.windowId === excursion.window_id) : null;

  const critZoneY = toY(ZONE_CRITICAL_MIN);
  const warnZoneY = toY(ZONE_WARNING_MIN);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
        <div>
          <h2 className="text-sm font-bold font-heading text-[var(--text-primary)]">
            Cold-Chain Pulse{shipmentId ? ` — ${shipmentId}` : ''}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary-2)] mt-0.5">
            Temperature vs. risk zones across transit windows
          </p>
        </div>
        {excursion && (
          <span className="text-xs font-bold font-data" style={{ color: 'var(--accent-red)' }}>
            {excursion.avg_temp_c.toFixed(1)}°C — excursion
          </span>
        )}
      </div>
      <svg viewBox="0 0 600 110" className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
        {/* Risk zone bands */}
        <rect x="0" y="0" width="600" height={critZoneY} fill="var(--accent-red)" opacity="0.07" />
        <rect x="0" y={critZoneY} width="600" height={warnZoneY - critZoneY} fill="var(--accent-amber)" opacity="0.06" />
        <rect x="0" y={warnZoneY} width="600" height={110 - warnZoneY} fill="var(--accent-emerald)" opacity="0.06" />
        <text x="6" y="14" fill="var(--accent-red)" fontSize="9" fontFamily="var(--font-data)" opacity="0.7">CRITICAL</text>
        <text x="6" y={warnZoneY > critZoneY + 12 ? critZoneY + 13 : critZoneY + 13} fill="var(--accent-amber)" fontSize="9" fontFamily="var(--font-data)" opacity="0.7">WARNING</text>
        <text x="6" y="100" fill="var(--accent-emerald)" fontSize="9" fontFamily="var(--font-data)" opacity="0.7">SAFE</text>

        {/* Temperature line */}
        <polyline points={polyline} fill="none" stroke="var(--accent-cyan)" strokeWidth="2.5" />

        {/* Excursion marker */}
        {excursionPoint && (
          <>
            <line x1={excursionPoint.x} y1={toY(excursion.avg_temp_c)} x2={excursionPoint.x} y2="110"
              stroke="var(--accent-red)" strokeWidth="1" strokeDasharray="3,3" />
            <circle cx={excursionPoint.x} cy={toY(excursion.avg_temp_c)} r="5"
              fill="var(--accent-red)" stroke="var(--card-bg)" strokeWidth="2" />
          </>
        )}
      </svg>
    </div>
  );
}
