import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi, getApi, postApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useOrchestrationStream } from '../lib/OrchestrationStreamContext';
import { AGENTS } from '../lib/agents';
import { Play, Zap, Wifi, WifiOff, ChevronDown, ChevronUp } from 'lucide-react';
import AgentLiveStrip from './AgentLiveStrip';
import AgentRunList from './AgentRunList';
import { getRunKey } from '../lib/runKey';

function AgentReference() {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold font-heading text-[var(--text-primary)]"
      >
        What agents exist
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && (
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {AGENTS.map(a => (
            <div key={a.id} className="text-xs text-[var(--text-secondary-2)]">
              <span className="font-semibold text-[var(--text-primary)]">{a.name}</span> — {a.desc}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentActivity() {
  const { data: history, loading, refetch } = useApi('/orchestrator/history?limit=30');
  const { data: mode } = useApi('/orchestrator/mode');
  const { messages: wsMessages, connected: wsConnected } = useWebSocket([
    'orchestrator_decision', 'approval_decided', 'approval_executed', 'approval_confirmed', 'tool_executed',
  ]);
  const [running, setRunning] = useState(false);
  const [lastRunId, setLastRunId] = useState(null);
  const { windowId, setWindowId, demoResult, setDemoResult } = useOrchestrationStream();

  useEffect(() => {
    if (wsMessages.length === 0) return;
    const latest = wsMessages[wsMessages.length - 1];
    if (['orchestrator_decision', 'approval_executed', 'approval_confirmed', 'approval_decided'].includes(latest.type)) {
      refetch();
    }
  }, [wsMessages, refetch]);

  const runSingle = useCallback(async (wid) => {
    setRunning(true);
    setDemoResult(null);
    try {
      const result = await postApi(`/orchestrator/run/${wid}`, {});
      if (result && !result.detail) {
        setDemoResult(result);
        setLastRunId(getRunKey(result));
      } else {
        setDemoResult({ error: result?.detail || 'Unknown error' });
      }
      await refetch();
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch, setDemoResult]);

  const runDemo = useCallback(async () => {
    setRunning(true);
    setDemoResult(null);
    try {
      const windows = await getApi('/windows?risk_tier=CRITICAL&limit=1');
      if (Array.isArray(windows) && windows.length > 0) {
        const result = await postApi(`/orchestrator/run/${windows[0].window_id}`, {});
        if (result && !result.detail) {
          setDemoResult(result);
          setLastRunId(getRunKey(result));
        } else {
          setDemoResult({ error: result?.detail || 'Unknown error' });
        }
        await refetch();
      }
    } catch (e) {
      setDemoResult({ error: e.message });
    } finally { setRunning(false); }
  }, [refetch, setDemoResult]);

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
  }, [refetch, setDemoResult]);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold font-heading text-[var(--text-primary)] m-0">Agent Activity</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--text-secondary-2)]">
          {wsConnected ? <Wifi className="w-3.5 h-3.5 text-[var(--accent-emerald)]" /> : <WifiOff className="w-3.5 h-3.5" />}
          {mode?.active_provider ? 'Agentic' : 'Deterministic'}
        </div>
      </div>

      <AgentLiveStrip windowId={running ? windowId : null} currentWave={1} agentStatus={{}} />

      <div className="panel p-5 space-y-3">
        <div className="flex gap-2">
          <input
            placeholder="Window id (e.g. W00041)"
            value={windowId || ''}
            onChange={e => setWindowId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg text-sm bg-[var(--bg-page)] border border-[var(--card-border)] text-[var(--text-primary)]"
          />
          <button
            type="button"
            disabled={running || !windowId}
            onClick={() => runSingle(windowId)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-[var(--accent-cyan)] disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> Run
          </button>
          <button
            type="button"
            disabled={running}
            onClick={runDemo}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] border border-[var(--card-border)] disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" /> Run Live Demo
          </button>
          <button
            type="button"
            disabled={running}
            onClick={runCriticalBatch}
            className="px-4 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] border border-[var(--card-border)] disabled:opacity-50"
          >
            Batch Top 5 Critical
          </button>
        </div>
        {demoResult?.error && (
          <p className="text-xs text-[var(--accent-red)]">{demoResult.error}</p>
        )}
        {demoResult && !demoResult.error && lastRunId && (
          <Link to={`/agent/runs/${encodeURIComponent(lastRunId)}`} className="text-xs text-[var(--accent-cyan)] hover:underline">
            View details for {demoResult.window_id || demoResult._window_id} →
          </Link>
        )}
      </div>

      <AgentRunList history={history} loading={loading} />

      <AgentReference />
    </div>
  );
}
