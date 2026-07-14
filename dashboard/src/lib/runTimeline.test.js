import { describe, it, expect } from 'vitest';
import { buildTimelineSteps } from './runTimeline';

describe('buildTimelineSteps', () => {
  it('builds an Interpret & Plan step from draft_plan with info level', () => {
    const decision = {
      timestamp: '2026-06-20T09:14:02Z',
      draft_plan: [{ step: 1, action: 'reroute', tool: 'route_agent' }],
    };
    const steps = buildTimelineSteps(decision);
    const planStep = steps.find(s => s.id === 'plan');
    expect(planStep).toBeDefined();
    expect(planStep.level).toBe('info');
    expect(planStep.detail.kind).toBe('plan');
    expect(planStep.detail.payload).toEqual(decision.draft_plan);
  });

  it('builds an Execute step listing actions_taken with ok level when no issues', () => {
    const decision = { actions_taken: [{ tool: 'route_agent', result: { status: 'ok' } }] };
    const steps = buildTimelineSteps(decision);
    const execStep = steps.find(s => s.id === 'execute');
    expect(execStep.level).toBe('ok');
    expect(execStep.detail.kind).toBe('actions');
    expect(execStep.detail.payload).toEqual(decision.actions_taken);
  });

  it('names the agents in the Execute step summary instead of just a count', () => {
    const decision = {
      actions_taken: [
        { tool: 'compliance_agent', result: { status: 'ok' } },
        { tool: 'cold_storage_agent', result: { status: 'ok' } },
      ],
    };
    const steps = buildTimelineSteps(decision);
    const execStep = steps.find(s => s.id === 'execute');
    expect(execStep.summary).toBe('Ran: Compliance Agent, Cold Storage');
  });

  it('builds a Reflect step with warn level when reflection_notes are present', () => {
    const decision = { reflection_notes: ['missing cert'], actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    const reflectStep = steps.find(s => s.id === 'reflect');
    expect(reflectStep).toBeDefined();
    expect(reflectStep.level).toBe('warn');
  });

  it('does not build a Reflect step when there are no reflection_notes', () => {
    const decision = { actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    expect(steps.find(s => s.id === 'reflect')).toBeUndefined();
  });

  it('builds an Approval step with crit level when awaiting_approval is true', () => {
    const decision = { awaiting_approval: true };
    const steps = buildTimelineSteps(decision);
    const approvalStep = steps.find(s => s.id === 'approval');
    expect(approvalStep).toBeDefined();
    expect(approvalStep.level).toBe('crit');
    expect(approvalStep.detail.kind).toBe('approval');
  });

  it('does not build an Approval step when awaiting_approval is falsy', () => {
    const decision = { actions_taken: [{ tool: 'route_agent' }] };
    const steps = buildTimelineSteps(decision);
    expect(steps.find(s => s.id === 'approval')).toBeUndefined();
  });

  it('returns steps in a stable order: plan, execute, reflect, approval', () => {
    const decision = {
      draft_plan: [{ step: 1, action: 'x' }],
      actions_taken: [{ tool: 'route_agent' }],
      reflection_notes: ['note'],
      awaiting_approval: true,
    };
    const ids = buildTimelineSteps(decision).map(s => s.id);
    expect(ids).toEqual(['plan', 'execute', 'reflect', 'approval']);
  });

  it('returns an empty array for an empty decision object', () => {
    expect(buildTimelineSteps({})).toEqual([]);
  });
});
