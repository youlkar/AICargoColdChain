import { getRunKey } from './runKey';

export function buildRunLabels(history) {
  const labels = new Map();
  if (!Array.isArray(history)) return labels;

  const byWindow = new Map();
  for (const d of history) {
    const windowId = d?.window_id || d?._window_id;
    if (!byWindow.has(windowId)) byWindow.set(windowId, []);
    byWindow.get(windowId).push(d);
  }

  for (const group of byWindow.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    sorted.forEach((d, i) => {
      labels.set(getRunKey(d), { index: i + 1, total: sorted.length });
    });
  }

  return labels;
}
