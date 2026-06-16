const ACCENTS = {
  cyan: 'var(--accent-cyan)',
  red: 'var(--accent-red)',
  amber: 'var(--accent-amber)',
  emerald: 'var(--accent-emerald)',
};

/**
 * Stat card: label + big mono numeral + tinted icon chip.
 * `accent` selects the icon/value color from the new palette tokens.
 */
export default function StatCard({ icon: Icon, label, value, accent = 'cyan', delay = 0 }) {
  const color = ACCENTS[accent] || ACCENTS.cyan;
  return (
    <div className="panel p-4 animate-slide-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold font-heading text-[var(--text-secondary-2)]">
          {label}
        </span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}1f` }}>
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
      </div>
      <p className="text-2xl font-bold font-data" style={{ color }}>{value}</p>
    </div>
  );
}
