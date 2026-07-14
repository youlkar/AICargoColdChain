import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, Brain } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import TierBadge from './TierBadge';
import AgentRunTimeline from './AgentRunTimeline';
import { EmptyState, ChartSkeleton } from './shared/States';
import { humanize } from '../lib/toolResults';
import { SEMANTIC_VAR, runStatusSemantic } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';

const STATUS_FIELDS = [
  { key: 'status', label: 'Status', humanize: true },
  { key: 'requires_approval', label: 'Requires approval', bool: true },
  { key: 'replan_count', label: 'Replans' },
];

const ID_FIELDS = [
  { key: 'approval_id', label: 'Approval ID' },
  { key: 'thread_id', label: 'Thread ID' },
];

export default function AgentRunDetail() {
  const { runKey } = useParams();
  const { data: history, loading } = useApi('/orchestrator/history?limit=30');

  const run = Array.isArray(history)
    ? history.find(d => getRunKey(d) === runKey)
    : null;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-5">
      <Link to="/agent" className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]">
        <ArrowLeft className="w-3.5 h-3.5" /> Back to Agent Activity
      </Link>

      {!run && loading && <ChartSkeleton height={300} />}

      {!run && !loading && (
        <EmptyState title="Run not found" description={`No run matching this page in the last 30 runs.`} />
      )}

      {run && (
        <>
          <div className="flex items-center gap-3">
            <TierBadge tier={run.risk_tier || 'LOW'} />
            <h3 className="text-lg font-semibold font-heading text-[var(--text-primary)] m-0">{run.window_id || run._window_id}</h3>
            <span className="text-xs text-[var(--text-secondary-2)]">{run.shipment_id} / {run.container_id}</span>
          </div>

          {(run.decision_summary || run.llm_reasoning) && (
            <div className="panel p-4 space-y-2">
              {run.decision_summary && (
                <p className="text-sm font-semibold text-[var(--text-primary)] flex items-start gap-2 m-0">
                  <AlertTriangle className="w-4 h-4 text-[var(--accent-red)] shrink-0 mt-0.5" />
                  {run.decision_summary}
                </p>
              )}
              {run.llm_reasoning && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary-2)] flex items-center gap-1 mb-1">
                    <Brain className="w-3 h-3" /> Why
                  </p>
                  <p className="text-xs text-[var(--text-secondary-2)] leading-relaxed">{run.llm_reasoning}</p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-[240px_1fr] gap-5">
            <div className="panel p-4 space-y-1 h-fit">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary-2)] mb-1">Status</p>
              {STATUS_FIELDS.map(({ key, label, humanize: shouldHumanize, bool }) => {
                const value = run[key];
                if (value === undefined || value === null) return null;
                const display = bool ? (value ? 'Yes' : 'No') : (shouldHumanize ? humanize(value) : value);
                const color = key === 'status' ? SEMANTIC_VAR[runStatusSemantic(run)] : undefined;
                return (
                  <div key={key} className="flex justify-between text-xs border-b border-[var(--card-border)] last:border-0 py-1.5">
                    <span className="text-[var(--text-secondary-2)]">{label}</span>
                    <span className="font-data text-right" style={color ? { color } : { color: 'var(--text-primary)' }}>{display}</span>
                  </div>
                );
              })}
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary-2)] mt-3 mb-1">Identifiers</p>
              {ID_FIELDS.map(({ key, label }) => (
                run[key] !== undefined && run[key] !== null && (
                  <div key={key} className="flex justify-between text-xs border-b border-[var(--card-border)] last:border-0 py-1.5 gap-2">
                    <span className="text-[var(--text-secondary-2)] shrink-0">{label}</span>
                    <span className="font-data text-[var(--text-primary)] text-right break-all">{run[key]}</span>
                  </div>
                )
              ))}
            </div>
            <AgentRunTimeline decision={run} />
          </div>
        </>
      )}
    </div>
  );
}
