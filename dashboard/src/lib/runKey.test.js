import { describe, it, expect } from 'vitest';
import { getRunKey } from './runKey';

describe('getRunKey', () => {
  it('uses thread_id when present', () => {
    expect(getRunKey({ thread_id: 'S015_W00890_1781976863848', window_id: 'W00890' })).toBe('S015_W00890_1781976863848');
  });

  it('falls back to window_id + timestamp when thread_id is missing', () => {
    expect(getRunKey({ window_id: 'W00890', timestamp: '2026-06-18T18:15:18.922614+00:00' }))
      .toBe('W00890_2026-06-18T18:15:18.922614+00:00');
  });

  it('falls back to _window_id when window_id is missing', () => {
    expect(getRunKey({ _window_id: 'W00890', timestamp: '2026-06-18T18:15:18.922614+00:00' }))
      .toBe('W00890_2026-06-18T18:15:18.922614+00:00');
  });

  it('produces distinct keys for two runs of the same window_id', () => {
    const a = getRunKey({ window_id: 'W00890', thread_id: 'S015_W00890_111' });
    const b = getRunKey({ window_id: 'W00890', thread_id: 'S015_W00890_222' });
    expect(a).not.toBe(b);
  });
});
