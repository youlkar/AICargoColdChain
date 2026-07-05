const ACCENTS = {
  cyan: 'var(--accent-cyan)',
  red: 'var(--accent-red)',
  amber: 'var(--accent-amber)',
  emerald: 'var(--accent-emerald)',
};

/**
 * Stat card: label + big mono numeral + tinted icon chip.
 * `accent` selects the icon/value color from the new palette tokens.
 * `delta` (optional) renders a small trend line below the value, e.g.
 * { icon: TrendingUp, text: '12% vs previous 24h', tone: 'ok' | 'warn' | 'neutral' }.
 */
const DELTA_TONE = {
  ok: 'var(--accent-emerald)',
  warn: 'var(--accent-red)',
  neutral: 'var(--text-secondary-2)',
};

export default function StatCard({ icon: Icon, label, value, accent = 'cyan', delay = 0, delta }) {
  const color = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div className="panel p-4 animate-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[11px] font-semibold font-heading text-[var(--text-secondary-2)]">
          {label}
        </span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold font-data" style={{ color }}>{value}</p>
      {delta && (
        <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: DELTA_TONE[delta.tone] || DELTA_TONE.neutral }}>
          {delta.icon && <delta.icon className="w-3 h-3" />}
          {delta.text}
        </p>
      )}
    </div>
  );
}
