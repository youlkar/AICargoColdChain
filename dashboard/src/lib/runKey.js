export function getRunKey(run) {
  const d = run || {};
  if (d.thread_id) return d.thread_id;
  const windowId = d.window_id || d._window_id;
  return `${windowId}_${d.timestamp}`;
}
