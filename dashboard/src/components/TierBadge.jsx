const TIERS = {
  CRITICAL: { bg: 'rgba(239,68,68,0.12)',  text: '#f87171', dot: '#ef4444' },
  HIGH:     { bg: 'rgba(249,115,22,0.12)', text: '#fb923c', dot: '#f97316' },
  MEDIUM:   { bg: 'rgba(234,179,8,0.12)',  text: '#fde047', dot: '#eab308' },
  LOW:      { bg: 'rgba(34,197,94,0.12)',  text: '#4ade80', dot: '#22c55e' },
};

export default function TierBadge({ tier, size = 'sm' }) {
  const s = TIERS[tier] || TIERS.LOW;
  const pad = size === 'lg' ? '3px 10px' : '3px 8px';
  const fontSize = size === 'lg' ? '12px' : '10.5px';
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-md font-bold select-none"
      style={{ background: s.bg, color: s.text, padding: pad, fontSize }}
    >
      <span
        className={tier === 'CRITICAL' ? 'animate-pulse' : ''}
        style={{ width: 5, height: 5, borderRadius: '50%', background: s.dot, flexShrink: 0, display: 'inline-block' }}
      />
      {tier}
    </span>
  );
}
