import { useTheme } from '../../lib/ThemeContext';

// Dark mode: deep saturated gradients, white text
const DARK_GRADIENTS = {
  blue:   '#1e3a8a, #1d4ed8',
  purple: '#3b1c8c, #7c3aed',
  amber:  '#78350f, #d97706',
  teal:   '#0f4c4c, #0d9488',
};
const DARK_BORDERS = {
  blue:   'rgba(96,165,250,0.20)',
  purple: 'rgba(167,139,250,0.20)',
  amber:  'rgba(251,191,36,0.20)',
  teal:   'rgba(45,212,191,0.20)',
};

// Light mode: pastel backgrounds, dark accent text
const LIGHT_GRADIENTS = {
  blue:   '#eff6ff, #dbeafe',
  purple: '#f5f3ff, #ede9fe',
  amber:  '#fffbeb, #fef3c7',
  teal:   '#f0fdfa, #ccfbf1',
};
const LIGHT_BORDERS = {
  blue:   'rgba(59,130,246,0.25)',
  purple: 'rgba(109,40,217,0.20)',
  amber:  'rgba(180,83,9,0.20)',
  teal:   'rgba(14,116,144,0.20)',
};
const LIGHT_TEXT = {
  blue:   '#1d4ed8',
  purple: '#6d28d9',
  amber:  '#b45309',
  teal:   '#0e7490',
};
const LIGHT_ICON_BG = {
  blue:   'rgba(29,78,216,0.10)',
  purple: 'rgba(109,40,217,0.10)',
  amber:  'rgba(180,83,9,0.10)',
  teal:   'rgba(14,116,144,0.10)',
};

export default function KpiCard({ icon: Icon, label, value, variant = 'blue', trend }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const grad   = isLight ? LIGHT_GRADIENTS[variant] : DARK_GRADIENTS[variant];
  const border = isLight ? LIGHT_BORDERS[variant]   : DARK_BORDERS[variant];
  const valueColor   = isLight ? LIGHT_TEXT[variant]    : '#ffffff';
  const labelColor   = isLight ? LIGHT_TEXT[variant]    : 'rgba(255,255,255,0.70)';
  const iconBgColor  = isLight ? LIGHT_ICON_BG[variant] : 'rgba(255,255,255,0.18)';
  const trendBgColor = isLight ? LIGHT_ICON_BG[variant] : 'rgba(255,255,255,0.18)';

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-[18px] cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{
        background: `linear-gradient(135deg, ${grad})`,
        border: `1px solid ${border}`,
      }}
    >
      {/* decorative circle */}
      <div className="pointer-events-none absolute -bottom-5 -right-5 w-20 h-20 rounded-full"
        style={{ background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)' }} />

      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: iconBgColor }}>
          <Icon className="w-[15px] h-[15px]" style={{ color: valueColor }} />
        </div>
        {trend && (
          <span className="text-[11px] font-bold rounded-full px-2 py-0.5"
            style={{ background: trendBgColor, color: valueColor }}>
            {trend}
          </span>
        )}
      </div>
      <p className="text-[26px] font-extrabold leading-tight tabular-nums tracking-tight mb-1"
        style={{ color: valueColor }}>
        {value}
      </p>
      <p className="text-[11px] font-medium" style={{ color: labelColor }}>
        {label}
      </p>
    </div>
  );
}
