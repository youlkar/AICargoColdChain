import { runStatusSemantic } from './runStatus';
import { getAgentMeta } from './agents';

export function buildTimelineSteps(decision) {
  const d = decision || {};
  const steps = [];

  if (Array.isArray(d.draft_plan) && d.draft_plan.length > 0) {
    steps.push({
      id: 'plan',
      level: 'info',
      title: 'Interpret & Plan',
      time: d.timestamp || null,
      summary: `Drafted ${d.draft_plan.length} step plan`,
      detail: { kind: 'plan', payload: d.draft_plan },
    });
  }

  if (Array.isArray(d.actions_taken) && d.actions_taken.length > 0) {
    const hasFailure = d.actions_taken.some(a => a?.result?.status && a.result.status !== 'ok' && a.result.status !== 'success');
    steps.push({
      id: 'execute',
      level: hasFailure ? 'warn' : 'ok',
      title: 'Execute',
      time: null,
      summary: `Ran: ${d.actions_taken.map(a => getAgentMeta(a?.tool).name).join(', ')}`,
      detail: { kind: 'actions', payload: d.actions_taken },
    });
  }

  if (Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0) {
    steps.push({
      id: 'reflect',
      level: 'warn',
      title: 'Reflect',
      time: null,
      summary: d.reflection_notes[0],
      detail: { kind: 'text', payload: d.reflection_notes },
    });
  }

  if (d.awaiting_approval) {
    steps.push({
      id: 'approval',
      level: 'crit',
      title: 'Awaiting human approval',
      time: null,
      summary: 'Revised plan requires sign-off before further action',
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  }

  return steps;
}

export { runStatusSemantic };
