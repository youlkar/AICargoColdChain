import { describe, it, expect } from 'vitest';
import { SEMANTIC_VAR, tierToSemantic, runStatusSemantic, semanticClasses } from './runStatus';

describe('tierToSemantic', () => {
  it('maps LOW to ok', () => {
    expect(tierToSemantic('LOW')).toBe('ok');
  });
  it('maps MEDIUM to warn', () => {
    expect(tierToSemantic('MEDIUM')).toBe('warn');
  });
  it('maps HIGH to crit', () => {
    expect(tierToSemantic('HIGH')).toBe('crit');
  });
  it('maps CRITICAL to crit', () => {
    expect(tierToSemantic('CRITICAL')).toBe('crit');
  });
  it('defaults unknown/missing tiers to ok', () => {
    expect(tierToSemantic(undefined)).toBe('ok');
    expect(tierToSemantic('NOT_A_TIER')).toBe('ok');
  });
});

describe('runStatusSemantic', () => {
  it('returns crit when awaiting_approval and not yet approved', () => {
    expect(runStatusSemantic({ awaiting_approval: true })).toBe('crit');
  });
  it('returns warn when corrections_proposed', () => {
    expect(runStatusSemantic({ review_status: 'corrections_proposed' })).toBe('warn');
  });
  it('returns ok when actions_taken exist with no open issues', () => {
    expect(runStatusSemantic({ actions_taken: [{ tool: 'route_agent' }] })).toBe('ok');
  });
  it('returns info when there are no actions yet and nothing pending', () => {
    expect(runStatusSemantic({})).toBe('info');
  });
});

describe('semanticClasses', () => {
  it('returns text/bg/border keyed off the matching CSS var for each level', () => {
    for (const level of ['ok', 'warn', 'crit', 'info']) {
      const classes = semanticClasses(level);
      const cssVar = SEMANTIC_VAR[level];
      expect(classes.text).toContain(cssVar);
      expect(classes.bg).toContain(cssVar);
      expect(classes.border).toContain(cssVar);
    }
  });
});
