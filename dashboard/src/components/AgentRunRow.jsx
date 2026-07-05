import { useNavigate } from 'react-router-dom';
import { ChevronRight, RotateCcw } from 'lucide-react';
import TierBadge from './TierBadge';
import { runStatusSemantic, SEMANTIC_VAR } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';
import { getAgentMeta } from '../lib/agents';
import { timeAgo } from '../lib/format';

const STATUS_LABEL = {
  crit: 'Awaiting approval',
  warn: 'Corrections proposed',
  ok: 'Resolved',
  info: 'No actions yet',
};

const MAX_VISIBLE_ICONS = 5;

export default function AgentRunRow({ decision, runLabel }) {
  const navigate = useNavigate();
  const d = decision || {};
  const windowId = d.window_id || d._window_id;
  const level = runStatusSemantic(d);
  const color = SEMANTIC_VAR[level];

  const uniqueTools = Array.isArray(d.actions_taken)
    ? [...new Set(d.actions_taken.map(a => a?.tool).filter(Boolean))]
    : [];
  const visibleTools = uniqueTools.slice(0, MAX_VISIBLE_ICONS);
  const overflowCount = uniqueTools.length - visibleTools.length;

  return (
    <button
      type="button"
      onClick={() => navigate(`/agent/runs/${encodeURIComponent(getRunKey(d))}`)}
      className="w-full panel px-4 py-3.5 text-left hover:border-[var(--accent-cyan)] transition-colors"
    >
      <div className="flex items-center gap-3">
        <TierBadge tier={d.risk_tier || 'LOW'} />
        {runLabel && (
          <span className="text-[10px] text-[var(--text-secondary-2)] bg-white/[0.06] px-2 py-0.5 rounded-md">
            Run {runLabel.index} of {runLabel.total}
          </span>
        )}
        {d.replan_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--accent-amber)] bg-[var(--accent-amber)]/10 px-2 py-0.5 rounded-md">
            <RotateCcw className="w-2.5 h-2.5" /> Re-planned {d.replan_count}x
          </span>
        )}
        <div className="min-w-0">
          <span className="font-data text-sm font-semibold font-heading text-[var(--text-primary)]">{windowId}</span>
          <span className="text-xs text-[var(--text-secondary-2)] ml-2">{d.shipment_id} / {d.container_id}</span>
        </div>
        <div className="ml-auto flex items-center gap-4 shrink-0 text-xs">
          <span className="flex items-center gap-1.5" style={{ color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
            {STATUS_LABEL[level]}
          </span>
          {visibleTools.length > 0 && (
            <div className="flex items-center gap-1">
              {visibleTools.map((tool, i) => {
                const meta = getAgentMeta(tool);
                const Icon = meta.icon;
                return (
                  <span
                    key={`${tool}-${i}`}
                    data-agent-icon
                    title={meta.name}
                    className={`w-5 h-5 rounded-md flex items-center justify-center ${meta.color.bg} ${meta.color.border} border`}
                  >
                    <Icon className={`w-3 h-3 ${meta.color.text}`} />
                  </span>
                );
              })}
              {overflowCount > 0 && (
                <span className="text-[10px] text-[var(--text-secondary-2)]">+{overflowCount}</span>
              )}
            </div>
          )}
          <ChevronRight className="w-4 h-4 text-[var(--text-secondary-2)]" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 mt-2 pt-2 border-t border-[var(--card-border)]">
        <span className="text-[11px] text-[var(--text-secondary-2)] truncate flex-1">
          {d.decision_summary || 'No decision summary recorded for this run.'}
        </span>
        {d.timestamp && (
          <span className="text-[10px] font-data text-[var(--text-secondary-2)] shrink-0">{timeAgo(d.timestamp)}</span>
        )}
      </div>
    </button>
  );
}
