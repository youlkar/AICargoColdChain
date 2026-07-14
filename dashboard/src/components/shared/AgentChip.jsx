import { getAgentMeta } from '../../lib/agents';

const SIZES = {
  sm: { box: 'w-6 h-6 rounded-md', icon: 'w-3.5 h-3.5', text: 'text-[11px]' },
  md: { box: 'w-8 h-8 rounded-lg', icon: 'w-4 h-4', text: 'text-xs' },
  lg: { box: 'w-10 h-10 rounded-xl', icon: 'w-5 h-5', text: 'text-sm' },
};

/**
 * Small icon-chip + name for a specialist agent (RouteAgent, ComplianceAgent, etc.)
 * Pass `labelClassName="hidden"` to render icon-only (e.g. dense feeds).
 */
export default function AgentChip({ toolId, size = 'md', labelClassName = '' }) {
  const meta = getAgentMeta(toolId);
  const Icon = meta.icon;
  const s = SIZES[size] || SIZES.md;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`${s.box} flex items-center justify-center shrink-0 ${meta.color.bg} border ${meta.color.border}`}>
        <Icon className={`${s.icon} ${meta.color.text}`} />
      </div>
      <span className={`${s.text} font-semibold font-heading text-[var(--text-primary)] truncate ${labelClassName}`}>
        {meta.name}
      </span>
    </div>
  );
}
