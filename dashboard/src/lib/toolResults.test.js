import { describe, it, expect } from 'vitest';
import { humanize } from './toolResults';

describe('humanize', () => {
  it('replaces underscores with spaces and capitalizes only the first letter', () => {
    expect(humanize('facility_identified')).toBe('Facility identified');
    expect(humanize('claim_draft_prepared')).toBe('Claim draft prepared');
    expect(humanize('recommendations_generated')).toBe('Recommendations generated');
    expect(humanize('completed')).toBe('Completed');
  });

  it('returns an empty string for null/undefined/empty input', () => {
    expect(humanize(null)).toBe('');
    expect(humanize(undefined)).toBe('');
    expect(humanize('')).toBe('');
  });
});
