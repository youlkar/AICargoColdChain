// Shared agent registry/metadata used by AgentActivity, AgentActivityOverview,
// and related lib modules — kept separate to avoid circular imports.
import {
  Building2, DollarSign, Shield, FileCheck, Navigation,
  Bell, Clock, BarChart3, Zap,
} from 'lucide-react';

export const AGENTS = [
  { id: 'compliance_agent', name: 'Compliance Agent', icon: FileCheck, color: 'violet', desc: 'GDP/FDA validation using regulatory vector search + LLM interpretation', wave: 1 },
  { id: 'route_agent', name: 'Route Agent', icon: Navigation, color: 'cyan', desc: 'Safe route selection from certified carrier options by product temp class', wave: 1 },
  { id: 'cold_storage_agent', name: 'Cold Storage', icon: Building2, color: 'indigo', desc: 'Finds backup cold-storage facilities ranked by suitability and proximity', wave: 1 },
  { id: 'notification_agent', name: 'Notification', icon: Bell, color: 'amber', desc: 'Multi-channel alerts to stakeholders with revised ETA and spoilage data', wave: 'deferred' },
  { id: 'scheduling_agent', name: 'Scheduling', icon: Clock, color: 'blue', desc: 'Reschedule downstream appointments with compliance flags and priority', wave: 2 },
  { id: 'insurance_agent', name: 'Insurance', icon: DollarSign, color: 'emerald', desc: 'Itemized loss estimation with product, disposal, and disruption breakdown', wave: 2 },
  { id: 'triage_agent', name: 'Triage', icon: BarChart3, color: 'rose', desc: 'Multi-shipment priority ranking with enrichment from scored windows', wave: 'on-demand' },
  { id: 'approval_workflow', name: 'Approval', icon: Shield, color: 'red', desc: 'Human-in-the-loop approval queue for irreversible high-stakes actions', wave: 'human' },
];

// Wave-1 specialist subgraphs run in parallel first (dispatch_wave1), then
// wave-2 subgraphs run in parallel using wave-1 results (dispatch_wave2).
// Mirrors orchestrator/graph.py's _SUBGRAPH_AGENT_NAMES / dispatch ordering.
export const WAVE_AGENTS = {
  1: ['compliance_agent', 'cold_storage_agent', 'route_agent'],
  2: ['insurance_agent', 'scheduling_agent'],
};

export const WAVE_BADGE = {
  1: { label: 'Wave 1', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  2: { label: 'Wave 2', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  deferred: { label: 'Deferred', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
  'on-demand': { label: 'On-demand', cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  human: { label: 'Human Loop', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

export const COLOR_MAP = {
  violet: { bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' },
  cyan: { bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400' },
  indigo: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/20', text: 'text-indigo-400' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' },
  rose: { bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400' },
};

export function getAgentMeta(toolId) {
  const agent = AGENTS.find(a => a.id === toolId);
  if (!agent) return { icon: Zap, color: COLOR_MAP.violet, name: toolId };
  return { icon: agent.icon, color: COLOR_MAP[agent.color], name: agent.name };
}

export function isDeferredStep(s) {
  const act = String(s?.action || '').toLowerCase();
  const tool = String(s?.tool || '').toLowerCase();
  return act.includes('deferred') || (tool === 'notification_agent' && act.includes('notification'));
}

// Compares the planned tool calls (revised plan if reflection produced one,
// otherwise the draft plan) against tools that actually ran, so the UI can
// flag plan/execution gaps. Deferred steps (e.g. notifications awaiting
// approval) are excluded since they're intentionally not executed yet.
export function getPlanCoverage(d) {
  const plan = Array.isArray(d.revised_plan) && d.revised_plan.length > 0 ? d.revised_plan : d.draft_plan;
  if (!Array.isArray(plan)) return null;

  const plannedTools = [...new Set(
    plan.filter(s => s?.tool && !isDeferredStep(s)).map(s => s.tool)
  )];
  if (plannedTools.length === 0) return null;

  const executedTools = new Set([
    ...(Array.isArray(d.actions_taken) ? d.actions_taken : []),
    ...(Array.isArray(d.corrective_actions) ? d.corrective_actions : []),
  ].map(a => a?.tool).filter(Boolean));

  const missing = plannedTools.filter(t => !executedTools.has(t));
  return { plannedTools, executedTools, missing };
}
