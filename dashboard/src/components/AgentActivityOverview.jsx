import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle, AlertTriangle, Shield, ShieldAlert, ChevronDown, ChevronUp, Brain,
  Check, ArrowUpRight,
} from 'lucide-react';
import TierBadge from './TierBadge';
import AgentChip from './shared/AgentChip';
import { safeStr } from '../lib/toolResults';
import { ToolResult } from '../lib/toolResultRenderers';
import { getAgentMeta, WAVE_AGENTS } from '../lib/agents';
import { getAgentHeadline, getRunStatus, getJourneySteps, SENTIMENT_STYLES } from '../lib/agentSummaries';

/* ── Status banner ───────────────────────────────────────────────────
   One big, plain-English readout of "where things stand" for a run. */

const STATUS_ICON = { good: CheckCircle, warning: Shield, critical: AlertTriangle, info: Shield };

export function RunStatusBanner({ decision }) {
  const d = decision || {};
  const status = getRunStatus(d);
  const style = SENTIMENT_STYLES[status.sentiment];
  const Icon = STATUS_ICON[status.sentiment] || Shield;
  const isPostApproval = d._execution_mode === 'post_approval' || d._execution_mode === 'human_selective';
  const isConfirmed = d._execution_mode === 'confirmed' || d.review_status === 'confirmed';
  const needsAttention = d.awaiting_approval && !isPostApproval && !isConfirmed;

  return (
    <div className={`flex items-center gap-4 p-4 rounded-xl border ${style.bg} ${style.border}`}>
      <div className={`flex items-center justify-center w-11 h-11 rounded-full shrink-0 ${style.bg} border ${style.border}`}>
        <Icon className={`w-5 h-5 ${style.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-base font-bold font-heading ${style.text}`}>{status.label}</span>
          <TierBadge tier={d.risk_tier || 'LOW'} size="lg" />
          <span className="font-data text-xs text-[var(--text-secondary-2)]">{safeStr(d.window_id || d._window_id)}</span>
        </div>
        <p className="text-sm text-[var(--text-secondary-2)] mt-0.5">{status.detail}</p>
      </div>
      {needsAttention && (
        <Link to="/approvals"
          className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-lg text-xs font-semibold font-heading border border-amber-500/30 transition shrink-0">
          Review Now <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}

/* ── Journey timeline ────────────────────────────────────────────────
   Plain-language stepper replacing Interpret/Plan/Execute/Observe/
   Reflect/Revise jargon. */

const STEP_STYLES = {
  done:     'bg-emerald-500/20 border-emerald-400 text-emerald-400',
  active:   'bg-amber-500/20 border-amber-400 text-amber-400 animate-pulse',
  pending:  'bg-cyan-500/10 border-cyan-500/40 text-cyan-400',
  upcoming: 'bg-white/[0.02] border-white/10 text-[var(--text-secondary-2)]',
};

export function JourneyTimeline({ decision }) {
  const steps = getJourneySteps(decision || {});
  return (
    <div className="flex items-center px-1">
      {steps.map((s, i) => (
        <Fragment key={s.label}>
          <div className="flex flex-col items-center gap-1.5 shrink-0">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 ${STEP_STYLES[s.state] || STEP_STYLES.upcoming}`}>
              {s.state === 'done' ? <Check className="w-3.5 h-3.5" /> : <span className="text-[10px] font-bold font-data">{i + 1}</span>}
            </div>
            <span className={`text-[10px] text-center w-20 leading-tight font-heading ${s.state === 'upcoming' ? 'opacity-50' : ''} text-[var(--text-secondary-2)]`}>{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mb-5 rounded ${steps[i + 1].state !== 'upcoming' ? 'bg-emerald-500/30' : 'bg-white/[0.06]'}`} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

/* ── Outcome cards ───────────────────────────────────────────────────
   One card per agent that ran, headline first, full breakdown on demand. */

export function OutcomeCard({ action, decisionMeta }) {
  const [open, setOpen] = useState(false);
  const headline = getAgentHeadline(action?.tool, action);
  const style = SENTIMENT_STYLES[headline.sentiment] || SENTIMENT_STYLES.info;

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} overflow-hidden flex flex-col`}>
      <div className="p-4 flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          <AgentChip toolId={action?.tool} size="sm" />
          <span className={`ml-auto w-2 h-2 rounded-full ${style.dot}`} />
        </div>
        <p className={`text-sm font-bold font-heading ${style.text}`}>{headline.title}</p>
        {headline.detail && <p className="text-xs text-[var(--text-secondary-2)] mt-1 leading-relaxed">{headline.detail}</p>}
      </div>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-center gap-1 text-[10px] font-heading text-[var(--text-secondary-2)] hover:text-[var(--text-primary)] py-1.5 border-t border-[var(--card-border)] transition">
        {open ? <>Hide details <ChevronUp className="w-3 h-3" /></> : <>View details <ChevronDown className="w-3 h-3" /></>}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-[var(--card-border)] animate-fade-in">
          <ToolResult tool={action.tool} result={action.result} decisionMeta={decisionMeta} />
        </div>
      )}
    </div>
  );
}

export function OutcomeGrid({ decision }) {
  const d = decision || {};
  const actions = Array.isArray(d.actions_taken) ? d.actions_taken : [];
  if (actions.length === 0) return null;

  const postApproval = actions.filter(a => a?._pass === 'post_approval');
  const firstPass = actions.filter(a => a?._pass !== 'post_approval');
  const hasBothPasses = firstPass.length > 0 && postApproval.length > 0;

  const renderCards = (items) => items
    .filter(a => a && typeof a === 'object' && a.tool !== 'approval_workflow')
    .map((a, i) => <OutcomeCard key={`${a.tool}-${i}`} action={a} decisionMeta={d} />);

  if (hasBothPasses) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-2">Initial Actions</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{renderCards(firstPass)}</div>
        </div>
        <div>
          <p className="text-[10px] font-semibold font-heading text-violet-400 uppercase tracking-wider mb-2">After Human Approval</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{renderCards(postApproval)}</div>
        </div>
      </div>
    );
  }

  const cards = renderCards(actions);
  if (cards.length === 0) return null;
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{cards}</div>;
}

/* ── "Why" panel ─────────────────────────────────────────────────────
   Collapsible LLM reasoning + reflection notes, for those who want it. */

export function WhyThisDecision({ decision }) {
  const [open, setOpen] = useState(false);
  const d = decision || {};
  const notes = Array.isArray(d.reflection_notes) ? d.reflection_notes : [];
  const reasoning = d.llm_reasoning;
  if (!reasoning && notes.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-white/[0.02] overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold font-heading text-[var(--text-secondary-2)] hover:text-[var(--text-primary)] transition">
        <Brain className="w-3.5 h-3.5 text-violet-400" />
        Why these actions were chosen
        <span className="ml-auto">{open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-2 animate-fade-in">
          {reasoning && <p className="text-xs text-[var(--text-secondary-2)] leading-relaxed whitespace-pre-line">{safeStr(reasoning)}</p>}
          {notes.length > 0 && (
            <ul className="space-y-1">
              {notes.map((n, i) => <li key={i} className="text-xs text-[var(--text-secondary-2)] pl-3 border-l-2 border-[var(--card-border)]">{safeStr(n)}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Live "agents working" strip ────────────────────────────────────
   Shown while a run is in progress, before a result lands. */

export function LiveAgentsStrip({ agentStatus, windowId }) {
  const agentIds = [...WAVE_AGENTS[1], ...WAVE_AGENTS[2]];
  return (
    <div className="panel p-5 space-y-3 border border-cyan-500/10">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        <span className="text-sm font-semibold font-heading text-[var(--text-primary)]">Agents are investigating{windowId ? ` ${windowId}` : ''}…</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {agentIds.map(id => {
          const meta = getAgentMeta(id);
          const Icon = meta.icon;
          const st = agentStatus?.[id];
          const status = st?.status || 'idle';
          return (
            <div key={id} className={`rounded-xl border p-3 flex items-center gap-2 ${
              status === 'running' ? 'border-cyan-500/30 bg-cyan-500/5'
              : status === 'done' ? (st.success === false ? 'border-red-500/20 bg-red-500/5' : 'border-emerald-500/20 bg-emerald-500/5')
              : 'border-[var(--card-border)] bg-white/[0.02]'
            }`}>
              <Icon className={`w-4 h-4 shrink-0 ${meta.color.text}`} />
              <div className="min-w-0">
                <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] truncate">{meta.name}</p>
                <p className="text-[10px] text-[var(--text-secondary-2)] opacity-70">
                  {status === 'idle' && 'Waiting'}
                  {status === 'running' && 'Working…'}
                  {status === 'done' && (st.success === false ? 'Issue found' : 'Done')}
                </p>
              </div>
              {status === 'running' && <div className="ml-auto w-3 h-3 border-[1.5px] border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin shrink-0" />}
              {status === 'done' && <CheckCircle className={`ml-auto w-3.5 h-3.5 shrink-0 ${st.success === false ? 'text-red-400' : 'text-emerald-400'}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Executive summary (composed) ───────────────────────────────────── */

export function ExecutiveSummary({ decision }) {
  const d = decision || {};
  return (
    <div className="space-y-4">
      <RunStatusBanner decision={d} />
      {d.decision_summary && <p className="text-sm text-[var(--text-secondary-2)] leading-relaxed">{safeStr(d.decision_summary)}</p>}
      <JourneyTimeline decision={d} />
      <OutcomeGrid decision={d} />
      <WhyThisDecision decision={d} />
    </div>
  );
}

/* ── History card (collapsed row → full executive summary) ─────────── */

export function ExecutiveHistoryCard({ decision, expanded, onToggle }) {
  const d = decision || {};
  const status = getRunStatus(d);
  const style = SENTIMENT_STYLES[status.sentiment];
  const actionsCount = Array.isArray(d.actions_taken) ? d.actions_taken.length : 0;

  return (
    <div className="panel overflow-hidden">
      <div role="button" tabIndex={0} onClick={onToggle} onKeyDown={e => e.key === 'Enter' && onToggle()}
        className="px-5 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition">
        <TierBadge tier={d.risk_tier || 'LOW'} />
        <div className="min-w-0">
          <span className="font-data text-sm font-semibold text-[var(--text-primary)]">{safeStr(d.window_id || d._window_id)}</span>
          <span className="text-xs text-[var(--text-secondary-2)] ml-2">{safeStr(d.shipment_id)} / {safeStr(d.container_id)}</span>
        </div>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold font-heading border flex items-center gap-1 shrink-0 ${style.bg} ${style.text} ${style.border}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} /> {status.label}
        </span>
        {actionsCount > 0 && <span className="text-xs text-[var(--text-secondary-2)] shrink-0 hidden sm:inline">{actionsCount} actions</span>}
        {(() => {
          const findings = (d.guardrail_findings || []).filter(f => !f.passed);
          if (findings.length === 0) return null;
          const hasCritical = findings.some(f => f.severity === 'critical');
          return (
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold font-heading border shrink-0 ${
              hasCritical ? 'bg-red-500/15 text-red-300 border-red-500/30' : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
            }`}>
              <ShieldAlert className="w-3 h-3" /> {findings.length} guardrail
            </span>
          );
        })()}
        {expanded ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary-2)] shrink-0" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary-2)] shrink-0" />}
      </div>
      {!expanded && d.decision_summary && (
        <p className="px-5 pb-3 -mt-1 text-xs text-[var(--text-secondary-2)] truncate">{safeStr(d.decision_summary)}</p>
      )}
      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-[var(--card-border)] animate-fade-in">
          <ExecutiveSummary decision={d} />
          {(d.guardrail_findings || []).filter(f => !f.passed).length > 0 && (
            <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-1.5">
              <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider">Guardrail Findings</p>
              {(d.guardrail_findings || []).filter(f => !f.passed).map((f, i) => (
                <p key={i} className={`text-xs pl-3 border-l-2 ${f.severity === 'critical' ? 'border-red-500/40 text-red-300' : 'border-amber-500/40 text-amber-300'}`}>
                  <span className="font-semibold">{f.check}</span>: {f.message}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
