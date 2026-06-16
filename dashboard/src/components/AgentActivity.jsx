import { useState, useCallback, useEffect, useRef } from 'react';
import { useApi, getApi, postApi, deleteApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import TierBadge from './TierBadge';
import { safeStr } from '../lib/toolResults';
import { useOrchestrationStream } from '../lib/OrchestrationStreamContext';
import { AGENTS, WAVE_AGENTS, WAVE_BADGE, COLOR_MAP, getAgentMeta, isDeferredStep, getPlanCoverage } from '../lib/agents';
import { ToolResult } from '../lib/toolResultRenderers';
import { ExecutiveSummary, ExecutiveHistoryCard, LiveAgentsStrip } from './AgentActivityOverview';
import {
  Play, Zap, CheckCircle, ChevronDown, ChevronUp,
  Shield, Brain, AlertTriangle,
  Activity, ArrowRight, Bot, Cpu,
  RefreshCw, Eye, RotateCcw, Wifi, WifiOff, XCircle, Radio, GitMerge,
  MessageSquare, Layers, LayoutDashboard, Terminal, Search,
} from 'lucide-react';
import { getRunStatus } from '../lib/agentSummaries';
import { EmptyState } from './shared/States';

/* ── Agent Registry (no type labels) ──────────────────────────────── */

function AgentRegistry() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold font-heading text-[var(--text-secondary-2)]">Agent Tool Registry</h2>
        <p className="text-[10px] text-[var(--text-secondary-2)]">Wave 1 &amp; 2 agents run in parallel via LangGraph <code className="text-[var(--text-secondary-2)]">Send()</code> fan-out</p>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {AGENTS.map((agent, i) => {
          const c = COLOR_MAP[agent.color];
          const Icon = agent.icon;
          const wave = WAVE_BADGE[agent.wave];
          return (
            <div key={agent.id} className={`panel-sm p-4 animate-slide-up border ${c.border}`} style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`rounded-lg p-1.5 ${c.bg}`}><Icon className={`w-4 h-4 ${c.text}`} /></div>
                <span className={`text-xs font-bold ${c.text}`}>{agent.name}</span>
                {wave && <span className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold border ${wave.cls}`}>{wave.label}</span>}
              </div>
              <p className="text-[10px] text-[var(--text-secondary-2)] leading-relaxed">{agent.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Pipeline Step Visualizer ──────────────────────────────────────── */

function PipelineSteps({ decision }) {
  const d = decision || {};
  const isPostApproval = d._execution_mode === 'post_approval' || d._execution_mode === 'human_selective';
  const isConfirmed = d._execution_mode === 'confirmed' || d.review_status === 'confirmed';
  const isAwaitingReview = d.awaiting_approval && !isPostApproval && !isConfirmed;
  const hasRevisedPlan = Array.isArray(d.revised_plan) && d.revised_plan.length > 0;
  const hasReflection = Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0;
  const hasObservation = !!d.observation;
  const hasExecution = Array.isArray(d.actions_taken) && d.actions_taken.length > 0;

  const steps = isPostApproval ? [
    { label: 'Interpret', done: true, icon: Activity },
    { label: 'Plan', done: true, icon: Brain },
    { label: 'Execute', done: true, icon: Play },
    { label: 'Observe', done: true, icon: Eye },
    { label: 'Reflect', done: true, icon: Cpu },
    ...(hasRevisedPlan ? [{ label: 'Revise', done: true, icon: Zap }] : []),
    { label: 'Reviewed', done: true, icon: Shield, special: true },
    { label: 'Re-Execute', done: true, icon: RotateCcw },
    { label: 'Output', done: !!d.decision_summary, icon: CheckCircle },
  ] : isConfirmed ? [
    { label: 'Interpret', done: true, icon: Activity },
    { label: 'Plan', done: true, icon: Brain },
    { label: 'Execute', done: true, icon: Play },
    { label: 'Observe', done: true, icon: Eye },
    { label: 'Reflect', done: true, icon: Cpu },
    { label: 'Confirmed', done: true, icon: Shield, special: true },
    { label: 'Output', done: true, icon: CheckCircle },
  ] : isAwaitingReview ? [
    { label: 'Interpret', done: true, icon: Activity },
    { label: 'Plan', done: true, icon: Brain },
    { label: 'Execute', done: hasExecution, icon: Play },
    { label: 'Observe', done: hasObservation, icon: Eye },
    { label: 'Reflect', done: hasReflection, icon: Cpu },
    ...(hasRevisedPlan ? [{ label: 'Revise', done: true, icon: Zap }] : []),
    { label: 'Human Review', done: false, icon: Shield, special: true, pulse: true },
    { label: 'Output', done: false, icon: CheckCircle },
  ] : [
    { label: 'Interpret', done: true, icon: Activity },
    { label: 'Plan', done: Array.isArray(d.draft_plan) && d.draft_plan.length > 0, icon: Brain },
    { label: 'Execute', done: hasExecution, icon: Play },
    { label: 'Observe', done: hasObservation, icon: Eye },
    { label: 'Reflect', done: hasReflection, icon: Cpu },
    ...(hasRevisedPlan ? [{ label: 'Revise', done: true, icon: Zap }] : []),
    { label: 'Output', done: !!d.decision_summary, icon: CheckCircle },
  ];
  // Which wave-1/wave-2 specialist agents actually produced a result, so the
  // "Execute" step can be expanded into the parallel dispatch structure.
  const executedTools = new Set([
    ...(Array.isArray(d.actions_taken) ? d.actions_taken : []),
    ...(Array.isArray(d.corrective_actions) ? d.corrective_actions : []),
  ].map(a => a?.tool).filter(Boolean));
  const showWaves = hasExecution && (executedTools.size > 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto py-2">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const isReplan = s.label.startsWith('Re-plan');
          return (
            <div key={s.label} className="flex items-center gap-1 shrink-0">
              <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold ${
                isReplan ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : s.special && s.pulse ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse'
                  : s.special ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                  : s.done ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'bg-white/[0.03] text-[var(--text-secondary-2)] border border-[var(--card-border)]'
              }`}>
                <Icon className="w-3 h-3" /> {s.label}
              </div>
              {i < steps.length - 1 && <ArrowRight className={`w-3 h-3 shrink-0 ${s.done ? 'text-cyan-600' : 'text-[var(--text-secondary-2)]'}`} />}
            </div>
          );
        })}
      </div>
      {showWaves && <WaveCoverage executedTools={executedTools} />}
    </div>
  );
}

/* Shows which wave-1/wave-2 specialist agents ran for this decision, mirroring
   the live WaveLanesPanel but derived from the persisted actions_taken list. */
function WaveCoverage({ executedTools }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
      {[1, 2].map(wave => {
        const badge = WAVE_BADGE[wave];
        const agentIds = WAVE_AGENTS[wave];
        return (
          <div key={wave} className="flex items-center gap-1.5">
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${badge.cls}`}>{badge.label}</span>
            {agentIds.map(id => {
              const meta = getAgentMeta(id);
              const ran = executedTools.has(id);
              return (
                <span key={id} className={`flex items-center gap-1 text-[10px] ${ran ? meta.color.text : 'text-[var(--text-secondary-2)]'}`}>
                  {ran ? <CheckCircle className="w-2.5 h-2.5" /> : <span className="w-2.5 h-2.5 rounded-full border border-[var(--card-border)] inline-block" />}
                  {meta.name}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ── Phase 4A: Live Stream Panel ──────────────────────────────────── */

/* ── Wave Lanes: visualizes wave1/wave2 parallel dispatch ───────────── */

function WaveLane({ wave, agentStatus }) {
  const agentIds = WAVE_AGENTS[wave] || [];
  const badge = WAVE_BADGE[wave];
  const anyActive = agentIds.some(id => agentStatus[id]?.status === 'running');
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${badge.cls}`}>{badge.label}</span>
        <span className="text-[10px] text-[var(--text-secondary-2)]">— {agentIds.length} agents in parallel</span>
        {anyActive && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse ml-auto" />}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${agentIds.length}, minmax(0, 1fr))` }}>
        {agentIds.map(id => {
          const meta = getAgentMeta(id);
          const Icon = meta.icon;
          const st = agentStatus[id];
          const status = st?.status || 'idle';
          const ring = status === 'running' ? 'border-cyan-500/40 animate-pulse'
            : status === 'done' ? (st.success === false ? 'border-red-500/30' : 'border-emerald-500/30')
            : 'border-[var(--card-border)]';
          return (
            <div key={id} className={`rounded-lg border ${ring} ${meta.color.bg} p-2 min-w-0`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Icon className={`w-3 h-3 shrink-0 ${meta.color.text}`} />
                <span className={`text-[10px] font-semibold truncate ${meta.color.text}`}>{meta.name}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                {status === 'idle' && <span className="text-[9px] text-[var(--text-secondary-2)]">idle</span>}
                {status === 'running' && <span className="text-[9px] text-cyan-400 flex items-center gap-1"><div className="w-2.5 h-2.5 border-[1.5px] border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" /> running</span>}
                {status === 'done' && (
                  <span className={`text-[9px] font-medium ${st.success === false ? 'text-red-400' : 'text-emerald-400'}`}>
                    {st.success === false ? '✗ failed' : '✓ done'}
                    {st.confidence != null && ` · conf ${Number(st.confidence).toFixed(2)}`}
                  </span>
                )}
              </div>
              {status === 'done' && st.reasoning && (
                <p className="text-[9px] text-[var(--text-secondary-2)] mt-0.5 line-clamp-2 leading-tight">{st.reasoning}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WaveLanesPanel({ agentStatus }) {
  return (
    <div className="bg-white/[0.02] border border-[var(--card-border)] rounded-xl p-3 flex gap-4">
      <WaveLane wave={1} agentStatus={agentStatus} />
      <div className="flex items-center text-[var(--text-secondary-2)] shrink-0">
        <ArrowRight className="w-4 h-4" />
      </div>
      <WaveLane wave={2} agentStatus={agentStatus} />
    </div>
  );
}

const EVENT_STYLES = {
  agent_thinking:  { color: 'text-violet-400', bg: 'bg-violet-500/10', icon: Brain,       label: 'Thinking' },
  tool_start:      { color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   icon: Play,        label: 'Tool →' },
  tool_result:     { color: 'text-emerald-400',bg: 'bg-emerald-500/10',icon: CheckCircle, label: 'Tool ✓' },
  node_start:      { color: 'text-[var(--text-secondary-2)]',  bg: 'bg-white/[0.03]',  icon: Activity,    label: 'Node' },
  node_end:        { color: 'text-[var(--text-secondary-2)]',  bg: 'bg-white/[0.03]',  icon: Activity,    label: 'Done' },
  agent_dispatch:  { color: 'text-amber-400',  bg: 'bg-amber-500/10',  icon: Layers,      label: 'Dispatch' },
  wave_complete:   { color: 'text-blue-400',   bg: 'bg-blue-500/10',   icon: GitMerge,    label: 'Wave ✓' },
  agent_message:   { color: 'text-indigo-400', bg: 'bg-indigo-500/10', icon: MessageSquare,label: 'Message' },
  run_complete:    { color: 'text-emerald-400',bg: 'bg-emerald-500/10',icon: CheckCircle, label: 'Complete' },
  stream_error:    { color: 'text-red-400',    bg: 'bg-red-500/10',    icon: AlertTriangle,label: 'Error' },
};

function LiveStreamPanel() {
  const { windowId, liveStream } = useOrchestrationStream();
  const { events, thinking, activeNode, agentStatus, connected, complete, streaming, start, stop } = liveStream;
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const handleStart = () => {
    if (!windowId) return;
    start();
  };
  const handleStop = () => {
    stop();
  };

  const thinkingNodes = Object.entries(thinking).filter(([, t]) => t.length > 0);

  return (
    <div className="panel p-5 space-y-4 border border-violet-500/10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio className={`w-4 h-4 ${connected && streaming ? 'text-emerald-400 animate-pulse' : 'text-[var(--text-secondary-2)]'}`} />
          <span className="text-sm font-semibold font-heading text-[var(--text-primary)]">Live Agent Stream</span>
          {connected && streaming && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium">STREAMING</span>
          )}
          {complete && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 font-medium">COMPLETE</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {streaming ? (
            <button onClick={handleStop}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition">
              Stop
            </button>
          ) : (
            <button onClick={handleStart} disabled={!windowId}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-xs font-medium disabled:opacity-40 transition">
              <Radio className="w-3 h-3" /> Watch Live
            </button>
          )}
        </div>
      </div>

      {/* Active node indicator */}
      {activeNode && (
        <div className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="text-[var(--text-secondary-2)]">Active node:</span>
          <span className="font-data text-cyan-300">{activeNode}</span>
        </div>
      )}

      {/* Wave 1 / Wave 2 parallel dispatch lanes */}
      {(streaming || Object.keys(agentStatus).length > 0) && (
        <WaveLanesPanel agentStatus={agentStatus} />
      )}

      {/* LLM Thinking panels */}
      {thinkingNodes.length > 0 && (
        <div className="space-y-2">
          {thinkingNodes.map(([node, tokens]) => (
            <div key={node} className="bg-violet-950/30 border border-violet-500/15 rounded-xl p-3">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Brain className="w-3 h-3 text-violet-400" />
                <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider">{node} — thinking</span>
              </div>
              <p className="text-[11px] text-violet-200/80 font-data leading-relaxed whitespace-pre-wrap line-clamp-6">
                {tokens}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Event log */}
      <div className="space-y-1 max-h-72 overflow-y-auto scrollbar-thin pr-1">
        {events.length === 0 && !streaming && (
          <p className="text-xs text-[var(--text-secondary-2)] py-4 text-center">
            Enter a Window ID above, then click "Watch Live" to stream a run in real time.
          </p>
        )}
        {events.map((ev, i) => {
          const style = EVENT_STYLES[ev.type] || { color: 'text-[var(--text-secondary-2)]', bg: 'bg-white/[0.03]', icon: Activity, label: ev.type };
          const Icon = style.icon;
          return (
            <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded-lg ${style.bg}`}>
              <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${style.color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold ${style.color}`}>{style.label}</span>
                  {ev.node  && <span className="text-[10px] text-[var(--text-secondary-2)] font-data">{ev.node}</span>}
                  {ev.tool  && <span className="text-[10px] text-[var(--text-secondary-2)] font-data">{ev.tool}</span>}
                  <span className="text-[9px] text-[var(--text-secondary-2)] ml-auto">{new Date(ev._ts).toLocaleTimeString()}</span>
                </div>
                {/* Extra detail per event type */}
                {ev.type === 'agent_dispatch' && ev.deferred?.length > 0 && (
                  <p className="text-[10px] text-amber-300/70">deferred: {ev.deferred.join(', ')}</p>
                )}
                {ev.type === 'tool_result' && (
                  <p className={`text-[10px] ${ev.success === false ? 'text-red-400/80' : 'text-emerald-300/70'}`}>
                    {ev.success === false ? '✗ failed' : '✓ success'}
                    {ev.confidence != null && ` · confidence ${Number(ev.confidence).toFixed(2)}`}
                    {ev.reasoning && <span className="text-[var(--text-secondary-2)]"> — {safeStr(ev.reasoning).slice(0, 100)}{safeStr(ev.reasoning).length > 100 ? '…' : ''}</span>}
                  </p>
                )}
                {ev.type === 'wave_complete' && ev.cascade_keys?.length > 0 && (
                  <p className="text-[10px] text-blue-300/70">cascade: {ev.cascade_keys.join(', ')}</p>
                )}
                {ev.type === 'node_end' && ev.reflection_notes?.length > 0 && (
                  <p className="text-[10px] text-[var(--text-secondary-2)] truncate">{ev.reflection_notes[0]}</p>
                )}
                {ev.type === 'agent_message' && ev.sender && (
                  <div className="text-[10px] text-indigo-300/70">
                    <p className="truncate">{ev.sender} → {ev.recipient}: {String(ev.message_type || '').replace(/_/g, ' ')}</p>
                    {ev.payload && Object.keys(ev.payload).length > 0 && (
                      <p className="text-indigo-400/50 truncate font-data">{safeStr(ev.payload).slice(0, 120)}{safeStr(ev.payload).length > 120 ? '…' : ''}</p>
                    )}
                    {ev.reasoning && <p className="text-[var(--text-secondary-2)] truncate">{ev.reasoning}</p>}
                  </div>
                )}
                {ev.type === 'run_complete' && (
                  <p className={`text-[10px] ${ev.awaiting_approval ? 'text-amber-300' : 'text-emerald-300'}`}>
                    {ev.awaiting_approval ? `⏳ Awaiting approval (id: ${ev.approval_id})` : '✓ Run complete'}
                  </p>
                )}
                {ev.type === 'stream_error' && (
                  <p className="text-[10px] text-red-400">{ev.error}</p>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function AgentActivity() {
  const { data: history, loading, refetch } = useApi('/orchestrator/history?limit=30');
  const { data: mode } = useApi('/orchestrator/mode');
  const { messages: wsMessages, connected: wsConnected } = useWebSocket([
    'orchestrator_decision', 'approval_decided', 'approval_executed', 'approval_confirmed', 'tool_executed',
  ]);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [view, setView] = useState('overview');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('ALL');
  const [historyRangeHours, setHistoryRangeHours] = useState(0);
  const { windowId, setWindowId, demoResult, setDemoResult, liveEvents, setLiveEvents, liveStream } = useOrchestrationStream();

  useEffect(() => {
    if (wsMessages.length === 0) return;
    const latest = wsMessages[wsMessages.length - 1];
    setLiveEvents(prev => [...prev.slice(-19), { ...latest, _ts: Date.now() }]);

    if (latest.type === 'orchestrator_decision' || latest.type === 'approval_executed'
      || latest.type === 'approval_confirmed' || latest.type === 'approval_decided') {
      refetch();
    }

    // If an approval was confirmed/executed for the run currently shown in the
    // Run Panel, refresh it in place so the page doesn't look stuck waiting
    // for approval after it's been actioned from another tab.
    if (latest.type === 'approval_confirmed' || latest.type === 'approval_executed') {
      const updated = latest.record || latest.decision;
      if (updated && demoResult) {
        const currentId = demoResult.window_id || demoResult._window_id;
        const updatedId = updated.window_id || updated._window_id;
        if (currentId && updatedId && currentId === updatedId) {
          setDemoResult(updated);
        }
      }
    }
  }, [wsMessages, refetch, demoResult, setDemoResult]);

  const runSingle = useCallback(async (wid) => {
    setRunning(true);
    setDemoResult(null);
    try {
      const result = await postApi(`/orchestrator/run/${wid}`, {});
      if (result && !result.detail) setDemoResult(result);
      else setDemoResult({ error: result?.detail || 'Unknown error' });
      await refetch();
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch]);

  const runCriticalBatch = useCallback(async () => {
    setRunning(true);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=5');
      if (Array.isArray(windows) && windows.length > 0) {
        await postApi('/orchestrator/run-batch', windows.map(w => w.window_id));
        await refetch();
      }
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch]);

  const runDemo = useCallback(async () => {
    setRunning(true);
    setDemoResult(null);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=1');
      if (Array.isArray(windows) && windows.length > 0) {
        const result = await postApi(`/orchestrator/run/${windows[0].window_id}`, {});
        if (result && !result.detail) setDemoResult(result);
        else setDemoResult({ error: result?.detail || 'Unknown error' });
        await refetch();
      }
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold font-heading text-[var(--text-primary)]">Agent Orchestration</h1>
          <p className="text-sm text-[var(--text-secondary-2)] mt-0.5">Parallel multi-agent · Wave 1 → Wave 2 · Self-correcting loop · HITL checkpoint</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="panel-sm p-1 flex items-center gap-1">
            <button onClick={() => setView('overview')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium font-heading transition ${
                view === 'overview' ? 'bg-cyan-500/15 text-cyan-400' : 'text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]'
              }`}>
              <LayoutDashboard className="w-3.5 h-3.5" /> Overview
            </button>
            <button onClick={() => setView('technical')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium font-heading transition ${
                view === 'technical' ? 'bg-cyan-500/15 text-cyan-400' : 'text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]'
              }`}>
              <Terminal className="w-3.5 h-3.5" /> Technical
            </button>
          </div>
          <div className="panel-sm px-2.5 py-1.5 flex items-center gap-1.5">
            {wsConnected ? <Wifi className="w-3 h-3 text-emerald-400" /> : <WifiOff className="w-3 h-3 text-red-400" />}
            <span className={`text-[10px] font-medium font-heading ${wsConnected ? 'text-emerald-400' : 'text-red-400'}`}>
              {wsConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>
          {mode && (
            <div className="panel-sm px-3 py-2 flex items-center gap-2">
              <Brain className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-[11px] text-violet-300 font-data">{safeStr(mode.model || 'deterministic')}</span>
              <span className={`w-2 h-2 rounded-full ${mode.mode === 'agentic' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            </div>
          )}
        </div>
      </div>

      {/* Live Event Feed — technical only */}
      {view === 'technical' && liveEvents.length > 0 && (
        <div className="panel-sm p-3 border border-cyan-500/10 space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
          <div className="flex items-center gap-1.5 mb-1">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">Live Events</span>
          </div>
          {liveEvents.slice(-5).reverse().map((evt, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <span className="text-[var(--text-secondary-2)] font-data w-16 shrink-0">{new Date(evt._ts).toLocaleTimeString()}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                evt.type === 'approval_executed' ? 'bg-emerald-500/10 text-emerald-400'
                : evt.type === 'approval_decided' ? 'bg-amber-500/10 text-amber-400'
                : 'bg-cyan-500/10 text-cyan-400'
              }`}>{evt.type.replace('_', ' ')}</span>
              <span className="text-[var(--text-secondary-2)] truncate">
                {evt.decision?.window_id || evt.decision?._window_id || evt.result?.approval_id || evt.approval_id || ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Run Panel */}
      <div className="panel p-5 space-y-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 flex-1 min-w-[300px]">
            <span className="text-sm text-[var(--text-secondary-2)] font-heading font-medium shrink-0">Window ID:</span>
            <input value={windowId} onChange={e => setWindowId(e.target.value)}
              placeholder="e.g. W00464"
              className="panel-sm px-3 py-2 text-sm w-36 font-data text-[var(--text-primary)] placeholder-[var(--text-secondary-2)] focus:outline-none focus:ring-1 focus:ring-cyan-500/30 transition" />
            <button onClick={() => windowId && runSingle(windowId)} disabled={running || !windowId}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg text-sm font-medium font-heading hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/15">
              <Play className="w-3.5 h-3.5" /> Run
            </button>
          </div>
          <button onClick={runDemo} disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-lg text-sm font-medium font-heading hover:from-violet-500 hover:to-purple-500 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/15">
            <Bot className="w-4 h-4" /> {running ? 'Running...' : 'Run Live Demo'}
          </button>
          <button onClick={runCriticalBatch} disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-red-600 to-rose-600 text-white rounded-lg text-sm font-medium font-heading hover:from-red-500 hover:to-rose-500 disabled:opacity-50 transition-all shadow-lg shadow-red-500/15">
            <Zap className="w-4 h-4" /> Batch Top 5
          </button>
        </div>
        {running && (
          <div className="flex items-center gap-3 text-cyan-400 animate-pulse">
            <div className="w-4 h-4 border-2 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin" />
            <span className="text-sm font-heading">Orchestrating — LLM planning, reflecting, executing, observing...</span>
          </div>
        )}
      </div>

      {view === 'overview' ? (
        <>
          {/* Live agent status while a run is in flight */}
          {running && !demoResult && (
            <LiveAgentsStrip agentStatus={liveStream.agentStatus} windowId={windowId} />
          )}

          {/* Latest result, plain-English */}
          {demoResult && !demoResult.error && (
            <div className="animate-slide-up">
              <ExecutiveSummary decision={demoResult} />
            </div>
          )}

          {demoResult?.error && (
            <div className="panel-sm p-4 border border-red-500/20 bg-red-500/5">
              <p className="text-sm text-red-400">Error: {safeStr(demoResult.error)}</p>
            </div>
          )}

          {/* History */}
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="panel p-5 h-16 animate-pulse bg-slate-500/5" />
              ))}
            </div>
          )}

          {!loading && Array.isArray(history) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)]">Recent Runs ({history.length})</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 panel-sm px-2.5 py-1.5">
                    <Search className="w-3.5 h-3.5 text-[var(--text-secondary-2)]" />
                    <input value={historySearch} onChange={e => setHistorySearch(e.target.value)} placeholder="Search window/shipment"
                      className="bg-transparent outline-none text-xs font-heading text-[var(--text-primary)] placeholder-[var(--text-secondary-2)] w-36" />
                  </div>
                  <select value={historyStatus} onChange={e => setHistoryStatus(e.target.value)}
                    className="panel-sm px-2.5 py-1.5 text-xs font-heading text-[var(--text-primary)] bg-transparent outline-none cursor-pointer">
                    <option value="ALL">All statuses</option>
                    <option value="Awaiting Confirmation">Awaiting Confirmation</option>
                    <option value="Action Required">Action Required</option>
                    <option value="Resolved">Resolved</option>
                    <option value="Confirmed">Confirmed</option>
                    <option value="Completed">Completed</option>
                  </select>
                  <select value={historyRangeHours} onChange={e => setHistoryRangeHours(Number(e.target.value))}
                    className="panel-sm px-2.5 py-1.5 text-xs font-heading text-[var(--text-primary)] bg-transparent outline-none cursor-pointer">
                    <option value={0}>All time</option>
                    <option value={24}>Last 24h</option>
                    <option value={168}>Last 7d</option>
                  </select>
                  <button onClick={refetch} className="flex items-center gap-1.5 text-xs font-heading text-[var(--text-secondary-2)] hover:text-[var(--text-primary)] transition">
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                  <button onClick={async () => {
                    await deleteApi('/orchestrator/history');
                    await refetch();
                    setDemoResult(null);
                  }} className="flex items-center gap-1.5 text-xs font-heading text-red-500/70 hover:text-red-400 transition">
                    <XCircle className="w-3 h-3" /> Clear
                  </button>
                </div>
              </div>

              {(() => {
                const cutoff = historyRangeHours > 0 ? Date.now() - historyRangeHours * 3600 * 1000 : 0;
                const q = historySearch.trim().toLowerCase();
                const filtered = history.filter(dec => {
                  if (cutoff && new Date(dec.timestamp || 0).getTime() < cutoff) return false;
                  if (historyStatus !== 'ALL' && getRunStatus(dec).label !== historyStatus) return false;
                  if (q) {
                    const hay = `${safeStr(dec.window_id || dec._window_id)} ${safeStr(dec.shipment_id)} ${safeStr(dec.container_id)}`.toLowerCase();
                    if (!hay.includes(q)) return false;
                  }
                  return true;
                });
                if (history.length === 0) {
                  return <EmptyState icon={Bot} title="No runs yet" description="Click Run Live Demo or enter a Window ID and click Run to start." />;
                }
                if (filtered.length === 0) {
                  return <EmptyState icon={Search} title="No runs match your filters" description="Try a different search term, status, or time range." />;
                }
                return filtered.map((dec, i) => (
                  <ExecutiveHistoryCard key={`${dec.window_id || dec._window_id}-${i}`} decision={dec}
                    expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
                ));
              })()}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Phase 4A — Live Stream Panel */}
          <LiveStreamPanel />

          {/* Demo Result */}
          {demoResult && !demoResult.error && (
            <div className="panel overflow-hidden animate-slide-up gradient-border">
              <div className="px-5 py-3.5 border-b border-[var(--card-border)] flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-semibold font-heading text-[var(--text-primary)]">Latest Result</span>
                <TierBadge tier={demoResult.risk_tier} />
                <span className="text-xs text-[var(--text-secondary-2)] font-data ml-auto">{safeStr(demoResult.window_id || demoResult._window_id)}</span>
              </div>
              <div className="px-5 py-4 space-y-4">
                <PipelineSteps decision={demoResult} />
                {demoResult.decision_summary && <p className="text-sm text-[var(--text-secondary-2)]">{safeStr(demoResult.decision_summary)}</p>}
                <ObservationPanel decision={demoResult} />
                {renderActions(demoResult.actions_taken, demoResult)}
              </div>
            </div>
          )}

          {demoResult?.error && (
            <div className="panel-sm p-4 border border-red-500/20 bg-red-500/5">
              <p className="text-sm text-red-400">Error: {safeStr(demoResult.error)}</p>
            </div>
          )}

          <AgentRegistry />

          {/* History */}
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="panel p-5 h-16 animate-pulse bg-slate-500/5" />
              ))}
            </div>
          )}

          {!loading && Array.isArray(history) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold font-heading text-[var(--text-primary)]">Orchestration History ({history.length})</h2>
                <div className="flex items-center gap-2">
                  <button onClick={refetch} className="flex items-center gap-1.5 text-xs font-heading text-[var(--text-secondary-2)] hover:text-[var(--text-primary)] transition">
                    <RefreshCw className="w-3 h-3" /> Refresh
                  </button>
                  <button onClick={async () => {
                    await deleteApi('/orchestrator/history');
                    await refetch();
                    setDemoResult(null);
                  }} className="flex items-center gap-1.5 text-xs font-heading text-red-500/70 hover:text-red-400 transition">
                    <XCircle className="w-3 h-3" /> Clear
                  </button>
                </div>
              </div>
              {history.length === 0 ? (
                <EmptyState icon={Bot} title="No runs yet" description="Click Run Live Demo or enter a Window ID and click Run to start." />
              ) : history.map((dec, i) => (
                <DecisionCard key={`${dec.window_id || dec._window_id}-${i}`} decision={dec}
                  expanded={expanded === i} onToggle={() => setExpanded(expanded === i ? null : i)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ObservationPanel({ decision }) {
  const d = decision || {};
  if (!d.observation) return null;

  const adequate = !d.observation_issues?.length;
  return (
    <div className={`rounded-xl p-4 border ${
      adequate ? 'bg-emerald-500/5 border-emerald-500/10' : 'bg-amber-500/5 border-amber-500/10'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <Eye className={`w-4 h-4 ${adequate ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className={`text-xs font-bold ${adequate ? 'text-emerald-400' : 'text-amber-400'}`}>
          Post-Execution Observation
        </span>
        {d.replan_count > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-full">
            <RotateCcw className="w-2.5 h-2.5" /> Re-planned {d.replan_count}x
          </span>
        )}
      </div>
      <p className={`text-[11px] leading-relaxed ${adequate ? 'text-emerald-300/70' : 'text-amber-300/70'}`}>
        {safeStr(d.observation)}
      </p>
      {Array.isArray(d.observation_issues) && d.observation_issues.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {d.observation_issues.map((issue, i) => (
            <p key={i} className="text-[10px] text-amber-400/80 pl-3">- {safeStr(issue)}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function renderActions(actionsTaken, decisionMeta) {
  if (!Array.isArray(actionsTaken) || actionsTaken.length === 0) return null;

  const postApproval = actionsTaken.filter(a => a?._pass === 'post_approval');
  const firstPass = actionsTaken.filter(a => a?._pass !== 'post_approval');
  const hasBothPasses = firstPass.length > 0 && postApproval.length > 0;

  const renderGroup = (items, label, labelColor) => (
    <>
      {label && (
        <div className="col-span-2 flex items-center gap-2 pt-1">
          <div className="h-px flex-1 bg-[var(--card-border)]" />
          <span className={`text-[10px] font-bold uppercase tracking-wider ${labelColor}`}>{label}</span>
          <div className="h-px flex-1 bg-[var(--card-border)]" />
        </div>
      )}
      {items.map((a, j) => {
        if (!a || typeof a !== 'object') return null;
        const meta = getAgentMeta(a.tool);
        const Icon = meta.icon;
        return (
          <div key={`${label}-${j}`} className={`rounded-xl p-4 border ${meta.color.border} ${meta.color.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${meta.color.text}`} />
              <span className={`text-xs font-bold ${meta.color.text}`}>{meta.name}</span>
              {a.result?.status && <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full ml-auto">{safeStr(a.result.status)}</span>}
            </div>
            <ToolResult tool={a.tool} result={a.result} decisionMeta={decisionMeta} />
          </div>
        );
      })}
    </>
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      {hasBothPasses ? (
        <>
          {renderGroup(firstPass, `First Pass — ${firstPass.length} tools`, 'text-[var(--text-secondary-2)]')}
          {renderGroup(postApproval, `Post-Approval — ${postApproval.length} tools`, 'text-violet-400')}
        </>
      ) : (
        renderGroup(actionsTaken, null, null)
      )}
    </div>
  );
}

/* ── Decision Card ─────────────────────────────────────────────────── */

function DecisionCard({ decision, expanded, onToggle }) {
  const d = decision || {};
  const actionsCount = Array.isArray(d.actions_taken) ? d.actions_taken.length : 0;
  const isPostApproval = d._execution_mode === 'post_approval';
  const isConfirmed = d._execution_mode === 'confirmed' || d.review_status === 'confirmed';
  const isAwaitingApproval = d.awaiting_approval && !isPostApproval && !isConfirmed;
  const hasCorrections = d.review_status === 'corrections_proposed';
  const coverage = getPlanCoverage(d);
  // Pending review already surfaces gaps via "Corrections Proposed" — only
  // show the standalone gap badge once the run has settled.
  const showCoverageGap = coverage?.missing.length > 0 && !isAwaitingApproval;

  return (
    <div className={`panel overflow-hidden ${
      isPostApproval ? 'ring-1 ring-emerald-500/20'
      : isAwaitingApproval ? 'ring-1 ring-amber-500/20'
      : ''
    }`}>
      <div role="button" tabIndex={0} className="px-5 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02] transition" onClick={onToggle} onKeyDown={e => e.key === 'Enter' && onToggle()}>
        <TierBadge tier={d.risk_tier || 'LOW'} />
        <div className="min-w-0">
          <span className="font-data text-sm font-semibold font-heading text-[var(--text-primary)]">{safeStr(d.window_id || d._window_id)}</span>
          <span className="text-xs text-[var(--text-secondary-2)] ml-2">{safeStr(d.shipment_id)} / {safeStr(d.container_id)}</span>
        </div>
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {actionsCount > 0 && <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle className="w-3.5 h-3.5" />{actionsCount} tools</span>}

          {isPostApproval && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-500/10 text-violet-400 border border-violet-500/20">
              <CheckCircle className="w-3 h-3" /> Reviewed & Re-Executed
            </span>
          )}
          {isConfirmed && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <CheckCircle className="w-3 h-3" /> Human Confirmed
            </span>
          )}
          {isAwaitingApproval && hasCorrections && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Shield className="w-3 h-3" /> Corrections Proposed — Awaiting Review
            </span>
          )}
          {isAwaitingApproval && !hasCorrections && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Shield className="w-3 h-3" /> Execution Complete — Awaiting Confirmation
            </span>
          )}
          {showCoverageGap && (
            <span title={`Planned but not executed: ${coverage.missing.map(t => getAgentMeta(t).name).join(', ')}`}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <AlertTriangle className="w-3 h-3" /> {coverage.missing.length} planned tool{coverage.missing.length > 1 ? 's' : ''} not executed
            </span>
          )}

          <span className="font-data text-xs text-[var(--text-secondary-2)]">conf {Number(d.confidence || 0).toFixed(2)}</span>
          {expanded ? <ChevronUp className="w-4 h-4 text-[var(--text-secondary-2)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-secondary-2)]" />}
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-5 pt-2 border-t border-[var(--card-border)] space-y-4 animate-fade-in">
          {isPostApproval && d._approved_by && (
            <div className="flex items-center gap-2 text-[11px] bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium">
                Approved by {safeStr(d._approved_by)}
                {d._approved_at && <span className="text-emerald-400/50 ml-1">at {new Date(d._approved_at).toLocaleString()}</span>}
                {' '}&mdash; tools executed after human approval
              </span>
            </div>
          )}
          {isAwaitingApproval && hasCorrections && (
            <div className="bg-amber-500/5 border border-amber-500/10 rounded-lg px-3 py-2 space-y-2">
              <div className="flex items-center gap-2 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-400 font-medium">
                  Tools executed. Post-execution reflection found gaps — corrective actions proposed. Go to Review Queue to approve, modify, or dismiss.
                </span>
              </div>
              {Array.isArray(d.proposed_tools) && d.proposed_tools.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-[var(--text-secondary-2)] mr-1">Proposed corrections:</span>
                  {d.proposed_tools.map(t => (
                    <span key={t} className="bg-amber-500/10 text-amber-400 text-[10px] px-2 py-0.5 rounded border border-amber-500/15">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {isAwaitingApproval && !hasCorrections && (
            <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-[11px]">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">
                  All tools executed successfully. Reflection found no gaps. Go to Review Queue to confirm or add additional tools.
                </span>
              </div>
            </div>
          )}

          <PipelineSteps decision={d} />
          {d.decision_summary && <p className="text-sm text-[var(--text-secondary-2)]">{safeStr(d.decision_summary)}</p>}

          {d.llm_reasoning && (
            <div className="bg-violet-500/5 border border-violet-500/10 rounded-xl p-4">
              <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Brain className="w-3 h-3" /> LLM Reasoning</p>
              <p className="text-[11px] text-violet-300/70 leading-relaxed whitespace-pre-line">{safeStr(d.llm_reasoning)}</p>
            </div>
          )}

          {Array.isArray(d.draft_plan) && d.draft_plan.length > 0 && <PlanSection title="Draft Plan" steps={d.draft_plan} />}
          {Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-2">Reflection</p>
              {d.reflection_notes.map((n, j) => (
                <p key={j} className={`text-xs ${
                  String(n).includes('GAP') ? 'text-amber-400/80'
                  : String(n).includes('QUALITY') ? 'text-cyan-400/80'
                  : 'text-emerald-400/70'
                }`}>{safeStr(n)}</p>
              ))}
            </div>
          )}
          {Array.isArray(d.revised_plan) && d.revised_plan.length > 0 && (
            <PlanSection
              title="Revised Plan (from reflection)"
              steps={d.revised_plan}
              postApprovalTools={isPostApproval ? (d.post_approval_actions || []).map(a => a?.tool).filter(Boolean) : null}
            />
          )}

          {actionsCount > 0 && (
            <div>
              <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-3">
                {isPostApproval ? 'All Tool Execution Results' : Array.isArray(d.corrective_actions) && d.corrective_actions.length > 0 ? 'First-Pass Execution Results' : 'Tool Execution Results'}
              </p>
              {renderActions(d.actions_taken, d)}
            </div>
          )}

          {Array.isArray(d.corrective_actions) && d.corrective_actions.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-wider mb-3 flex items-center gap-1">
                <RotateCcw className="w-3 h-3" /> Corrective Execution Results
              </p>
              {renderActions(d.corrective_actions, d)}
            </div>
          )}

          <ObservationPanel decision={d} />
        </div>
      )}
    </div>
  );
}

function PlanSection({ title, steps, postApprovalTools }) {
  if (!Array.isArray(steps)) return null;
  const isDeferred = isDeferredStep;
  return (
    <div>
      <p className="text-[10px] font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">
        {steps.map((s, i) => {
          if (!s || typeof s !== 'object') return null;
          const deferred = isDeferred(s);
          return (
            <div key={i} className={`flex gap-3 text-xs items-start ${deferred ? 'pl-2 border-l-2 border-violet-500/30' : ''}`}>
              <span className={`font-data w-5 text-right shrink-0 pt-0.5 ${deferred ? 'text-violet-500' : 'text-[var(--text-secondary-2)]'}`}>{s.step ?? i + 1}.</span>
              <div className="min-w-0">
                <span className={deferred ? 'text-violet-300' : 'text-[var(--text-secondary-2)]'}>{safeStr(s.action)}</span>
                {s.tool && <span className={`ml-2 font-data text-[10px] ${deferred ? 'text-violet-400/70' : 'text-cyan-500/70'}`}>[{s.tool}]</span>}
                {deferred && <span className="ml-2 text-[9px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded border border-violet-500/20">⏳ awaits approval</span>}
                {s.reason && <p className={`text-[10px] mt-0.5 truncate ${deferred ? 'text-violet-500/60' : 'text-[var(--text-secondary-2)]'}`}>{safeStr(s.reason)}</p>}
              </div>
            </div>
          );
        })}
        {Array.isArray(postApprovalTools) && postApprovalTools.length > 0 && (
          <div className="mt-2 pt-2 border-t border-violet-500/15 space-y-1.5">
            <p className="text-[9px] font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5" /> Executed after human approval</p>
            {postApprovalTools.map((t, i) => (
              <div key={i} className="flex gap-3 text-xs items-start pl-2 border-l-2 border-emerald-500/30">
                <span className="font-data text-emerald-500 w-5 text-right shrink-0 pt-0.5">✓</span>
                <div className="min-w-0">
                  <span className="text-emerald-300">Executed {safeStr(t)}</span>
                  <span className="ml-2 text-emerald-400/70 font-data text-[10px]">[{t}]</span>
                  <span className="ml-2 text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/20">✓ approved</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
