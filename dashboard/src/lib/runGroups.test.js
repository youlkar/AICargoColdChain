import { describe, it, expect } from 'vitest';
import { buildRunLabels } from './runGroups';

describe('buildRunLabels', () => {
  it('omits a label for window_ids that only appear once', () => {
    const history = [{ window_id: 'W001', thread_id: 'T1', timestamp: '2026-01-01T00:00:00Z' }];
    const labels = buildRunLabels(history);
    expect(labels.has('T1')).toBe(false);
  });

  it('labels runs sharing a window_id with 1-based chronological index and total count', () => {
    const history = [
      { window_id: 'W890', thread_id: 'T-newest', timestamp: '2026-06-20T18:18:00Z' },
      { window_id: 'W890', thread_id: 'T-middle', timestamp: '2026-06-20T17:34:00Z' },
      { window_id: 'W890', thread_id: 'T-oldest', timestamp: '2026-06-18T18:15:00Z' },
    ];
    const labels = buildRunLabels(history);
    expect(labels.get('T-oldest')).toEqual({ index: 1, total: 3 });
    expect(labels.get('T-middle')).toEqual({ index: 2, total: 3 });
    expect(labels.get('T-newest')).toEqual({ index: 3, total: 3 });
  });

  it('groups independently per window_id', () => {
    const history = [
      { window_id: 'W890', thread_id: 'T-a', timestamp: '2026-06-20T18:18:00Z' },
      { window_id: 'W890', thread_id: 'T-b', timestamp: '2026-06-20T17:34:00Z' },
      { window_id: 'W850', thread_id: 'T-c', timestamp: '2026-06-18T19:37:00Z' },
    ];
    const labels = buildRunLabels(history);
    expect(labels.get('T-a')).toEqual({ index: 2, total: 2 });
    expect(labels.get('T-b')).toEqual({ index: 1, total: 2 });
    expect(labels.has('T-c')).toBe(false);
  });

  it('returns an empty map for an empty or non-array history', () => {
    expect(buildRunLabels([]).size).toBe(0);
    expect(buildRunLabels(null).size).toBe(0);
  });
});
