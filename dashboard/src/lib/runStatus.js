export const SEMANTIC_VAR = {
  ok: 'var(--accent-emerald)',
  warn: 'var(--accent-amber)',
  crit: 'var(--accent-red)',
  info: 'var(--accent-cyan)',
};

export function tierToSemantic(tier) {
  switch (String(tier || '').toUpperCase()) {
    case 'MEDIUM': return 'warn';
    case 'HIGH':
    case 'CRITICAL': return 'crit';
    case 'LOW':
    default: return 'ok';
  }
}

export function runStatusSemantic(decision) {
  const d = decision || {};
  const isRejected = d._execution_mode === 'rejected' || d.review_status === 'rejected';
  if (isRejected) return 'rejected';
  const isApproved = d._execution_mode === 'confirmed' || d._execution_mode === 'post_approval'
    || d.review_status === 'confirmed';
  if (d.awaiting_approval && !isApproved) return 'crit';
  if (d.review_status === 'corrections_proposed') return 'warn';
  if (Array.isArray(d.actions_taken) && d.actions_taken.length > 0) return 'ok';
  return 'info';
}

export function semanticClasses(level) {
  const cssVar = SEMANTIC_VAR[level] || SEMANTIC_VAR.info;
  return {
    text: `text-[${cssVar}]`,
    bg: `bg-[${cssVar}]/10`,
    border: `border-[${cssVar}]/20`,
  };
}
