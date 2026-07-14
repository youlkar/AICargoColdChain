import { getAgentMeta } from '../lib/agents';
import { SEMANTIC_VAR } from '../lib/runStatus';

const DOT_COLOR = {
  idle: 'var(--text-secondary-2)',
  running: SEMANTIC_VAR.info,
  done: SEMANTIC_VAR.ok,
};

export default function AgentLiveStrip({ windowId, currentWave, agentStatus }) {
  if (!windowId) return null;
  const entries = Object.entries(agentStatus || {});

  return (
    <div className="panel px-4 py-3 flex items-center gap-4 flex-wrap">
      <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: SEMANTIC_VAR.ok }} />
      <div className="text-sm">
        <span className="font-data font-semibold text-[var(--text-primary)]">{windowId}</span>
        <span className="text-[var(--text-secondary-2)] ml-2">Wave {currentWave}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {entries.map(([agentId, status]) => {
          const meta = getAgentMeta(agentId);
          return (
            <span
              key={agentId}
              className="flex items-center gap-1.5 text-xs text-[var(--text-secondary-2)] border border-[var(--card-border)] rounded-full px-2.5 py-1"
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DOT_COLOR[status] || DOT_COLOR.idle }} />
              {meta.name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
