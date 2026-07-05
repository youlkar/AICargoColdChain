import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ArrowUpRight } from 'lucide-react';
import { buildTimelineSteps } from '../lib/runTimeline';
import { SEMANTIC_VAR } from '../lib/runStatus';
import { formatTimestamp } from '../lib/format';
import { ObservationPanel, renderActions, PlanSection } from './AgentRunDetailParts';

function StepDetail({ step }) {
  const { kind, payload } = step.detail;
  if (kind === 'plan') return <PlanSection title="Draft plan" steps={payload} />;
  if (kind === 'actions') return <div className="mt-2">{renderActions(payload, {})}</div>;
  if (kind === 'text') {
    return (
      <ul className="text-xs text-[var(--text-secondary-2)] space-y-1 mt-2">
        {payload.map((line, i) => <li key={i}>- {line}</li>)}
      </ul>
    );
  }
  if (kind === 'approval') {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-xs text-[var(--text-secondary-2)]">
          {payload.approvedBy ? `Approved by ${payload.approvedBy} at ${payload.approvedAt}` : 'Not yet actioned.'}
        </p>
        {!payload.approvedBy && (
          <Link
            to="/approvals"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-[var(--accent-red)] hover:opacity-90 transition-opacity"
          >
            Go to Approvals <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    );
  }
  return null;
}

export default function AgentRunTimeline({ decision }) {
  const steps = buildTimelineSteps(decision);
  const [openId, setOpenId] = useState(null);

  return (
    <div className="panel p-5">
      {steps.map((step, i) => {
        const isOpen = openId === step.id;
        const color = SEMANTIC_VAR[step.level];
        return (
          <div key={step.id} className="flex gap-3 relative pb-5 last:pb-0">
            {i < steps.length - 1 && (
              <span className="absolute left-[9px] top-6 bottom-0 w-px bg-[var(--card-border)]" />
            )}
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0 z-10"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 25%, transparent)`, color }}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : step.id)}
                className="flex items-center justify-between w-full text-left -mx-2 px-2 py-1 rounded-lg hover:bg-white/[0.04] focus-visible:bg-white/[0.04] transition-colors"
              >
                <h4 className="text-sm font-semibold font-heading text-[var(--text-primary)] m-0">{step.title}</h4>
                <span className="flex items-center gap-2">
                  {step.time && <span className="font-data text-[11px] text-[var(--text-secondary-2)]">{formatTimestamp(step.time)}</span>}
                  <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-secondary-2)] shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              <p className="text-xs text-[var(--text-secondary-2)] mt-0.5">{step.summary}</p>
              {isOpen && <StepDetail step={step} />}
            </div>
          </div>
        );
      })}
      {decision?.observation && <div className="mt-2"><ObservationPanel decision={decision} /></div>}
    </div>
  );
}
