import { Eye, RotateCcw, CheckCircle, Clock } from 'lucide-react';
import { safeStr, humanize } from '../lib/toolResults';
import { getAgentMeta, isDeferredStep } from '../lib/agents';
import { ToolResult } from '../lib/toolResultRenderers';

export function ObservationPanel({ decision }) {
  const d = decision || {};
  if (!d.observation) return null;

  const adequate = !d.observation_issues?.length;
  return (
    <div className={`rounded-xl p-4 border ${
      adequate ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-amber-500/5 border-amber-500/10'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Eye className={`w-4 h-4 ${adequate ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className={`text-xs font-bold ${adequate ? 'text-emerald-400' : 'text-amber-400'}`}>
          Post-Execution Observation
        </span>
        {d.replan_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full">
            <RotateCcw className="w-2.5 h-2.5" /> Re-planned {d.replan_count}x
          </span>
        )}
      </div>
      <p className={`text-[11px] leading-relaxed ${adequate ? 'text-emerald-300/70' : 'text-amber-300/70'}`}>
        {safeStr(d.observation)}
      </p>
      {Array.isArray(d.observation_issues) && d.observation_issues.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {d.observation_issues.map((issue, i) => (
            <p key={i} className="text-[10px] text-amber-400/80 pl-3">- {safeStr(issue)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

export function renderActions(actionsTaken, decisionMeta) {
  if (!Array.isArray(actionsTaken) || actionsTaken.length === 0) return null;

  const postApproval = actionsTaken.filter(a => a?._pass === 'post_approval');
  const firstPass = actionsTaken.filter(a => a?._pass !== 'post_approval');
  const hasBothPasses = firstPass.length > 0 && postApproval.length > 0;

  const renderGroup = (items, label, labelColor) => (
    <>
      {label && (
        <div className="col-span-2 flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-[var(--card-border)]" />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>{label}</span>
          <div className="h-px flex-1 bg-[var(--card-border)]" />
        </div>
      )}
      {items.map((a, j) => {
        if (!a || typeof a !== 'object') return null;
        const meta = getAgentMeta(a.tool);
        const Icon = meta.icon;
        return (
          <div key={`${label}-${j}`} className="rounded-xl p-4 border border-[var(--card-border)] bg-[var(--bg-page)]">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${meta.color.text}`} />
              <span className="text-xs font-bold text-[var(--text-primary)]">{meta.name}</span>
              {a.result?.status && <span className="text-[10px] text-[var(--text-secondary-2)] bg-white/[0.06] px-2 py-0.5 rounded-full ml-auto">{humanize(a.result.status)}</span>}
            </div>
            <ToolResult tool={a.tool} result={a.result} decisionMeta={decisionMeta} />
          </div>
        );
      })}
    </>
  );

  return (
    <div className="grid grid-cols-1 gap-3">
      {hasBothPasses ? (
        <>
          {renderGroup(firstPass, `First Pass — ${firstPass.length} tools`, 'text-[var(--text-secondary-2)]')}
          {renderGroup(postApproval, `Post-Approval — ${postApproval.length} tools`, 'text-violet-400')}
        </>
      ) : (
        renderGroup(actionsTaken, null, null)
      )}
    </div>
  );
}

export function PlanSection({ title, steps, postApprovalTools }) {
  if (!Array.isArray(steps)) return null;
  const isDeferred = isDeferredStep;
  return (
    <div>
      <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">
        {steps.map((s, i) => {
          if (!s || typeof s !== 'object') return null;
          const deferred = isDeferred(s);
          return (
            <div key={i} className={`flex gap-3 text-xs items-start ${deferred ? 'pl-2 border-l-2 border-violet-500/30' : ''}`}>
              <span className={`font-data w-5 text-right shrink-0 pt-0.5 ${deferred ? 'text-violet-500' : 'text-[var(--text-secondary-2)]'}`}>{s.step ?? i + 1}.</span>
              <div className="min-w-0">
                <span className={deferred ? 'text-violet-300' : 'text-[var(--text-secondary-2)]'}>{safeStr(s.action)}</span>
                {s.tool && <span className={`ml-2 text-[10px] font-medium ${deferred ? 'text-violet-400/70' : 'text-cyan-500/70'}`}>{getAgentMeta(s.tool).name}</span>}
                {deferred && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded border border-violet-500/20">
                    <Clock className="w-2.5 h-2.5" /> awaits approval
                  </span>
                )}
                {s.reason && <p className={`text-[10px] mt-0.5 break-words ${deferred ? 'text-violet-500/60' : 'text-[var(--text-secondary-2)]'}`}>{safeStr(s.reason)}</p>}
              </div>
            </div>
          );
        })}
        {Array.isArray(postApprovalTools) && postApprovalTools.length > 0 && (
          <div className="mt-2 pt-2 border-t border-violet-500/15 space-y-1.5">
            <p className="text-[9px] font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> Executed after human approval</p>
            {postApprovalTools.map((t, i) => (
              <div key={i} className="flex gap-3 text-xs items-start pl-2 border-l-2 border-emerald-500/30">
                <CheckCircle className="text-emerald-500 w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <span className="text-emerald-300">Executed {getAgentMeta(t).name}</span>
                  <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">
                    <CheckCircle className="w-2.5 h-2.5" /> approved
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
