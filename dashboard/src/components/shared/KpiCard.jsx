/**
 * Gradient KPI card for the Overview redesign.
 * `variant` → 'blue' | 'purple' | 'amber' | 'teal'
 * `trend`   → optional string shown as a pill top-right (e.g. "↑ 3 new")
 * `value`   → string or number displayed large
 * `label`   → small label below value
 * `icon`    → Lucide icon component
 */
const GRADIENTS = {
  blue:   'var(--kpi-blue-start), var(--kpi-blue-end)',
  purple: 'var(--kpi-purple-start), var(--kpi-purple-end)',
  amber:  '#78350f, #d97706',
  teal:   'var(--kpi-teal-start), var(--kpi-teal-end)',
};

const BORDERS = {
  blue:   'rgba(96,165,250,0.20)',
  purple: 'rgba(167,139,250,0.20)',
  amber:  'rgba(251,191,36,0.20)',
  teal:   'rgba(45,212,191,0.20)',
};

export default function KpiCard({ icon: Icon, label, value, variant = 'blue', trend }) {
  const grad = GRADIENTS[variant] || GRADIENTS.blue;
  const bdr  = BORDERS[variant]   || BORDERS.blue;
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-[18px] cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        background: `linear-gradient(135deg, ${grad})`,
        border: `1px solid ${bdr}`,
      }}
    >
      {/* decorative circle */}
      <div className="pointer-events-none absolute -bottom-5 -right-5 w-20 h-20 rounded-full bg-white/[0.06]" />

      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-white/[0.18] flex items-center justify-center">
          <Icon className="w-[15px] h-[15px] text-white" />
        </div>
        {trend && (
          <span className="text-[11px] font-bold bg-white/[0.18] text-white rounded-full px-2 py-0.5">
            {trend}
          </span>
        )}
      </div>
      <p className="text-[26px] font-extrabold text-white leading-tight tabular-nums tracking-tight mb-1">
        {value}
      </p>
      <p className="text-[11px] text-white/70 font-medium">{label}</p>
    </div>
  );
}
