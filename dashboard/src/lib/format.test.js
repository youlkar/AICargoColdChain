import { describe, it, expect } from 'vitest';
import { formatTimestamp } from './format';

describe('formatTimestamp', () => {
  it('formats an ISO timestamp into a human-readable date and time', () => {
    const result = formatTimestamp('2026-06-20T18:18:42.323124+00:00');
    // Exact wording depends on locale/timezone, but it must not be the raw ISO string
    // and must contain the year and a recognizable month name.
    expect(result).not.toBe('2026-06-20T18:18:42.323124+00:00');
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/Jun/);
  });

  it('returns an empty string for null/undefined/invalid input', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
  });
});
