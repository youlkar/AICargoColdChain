// App-level context that holds the Agent Activity page's live-stream
// connection and latest-result state, so it survives navigation away from
// and back to the /agent route (React Router unmounts route components).
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

const _apiUrl = import.meta.env.VITE_API_URL ?? '';
const _wsBase = _apiUrl
  ? _apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')
  : `ws://${typeof window !== 'undefined' ? window.location.host : 'localhost:8000'}`;

const OrchestrationStreamContext = createContext(null);

export function OrchestrationStreamProvider({ children }) {
  const [windowId, setWindowId] = useState('');
  const [demoResult, setDemoResult] = useState(null);
  const [liveEvents, setLiveEvents] = useState([]);

  const [events, setEvents] = useState([]);
  const [thinking, setThinking] = useState({});
  const [activeNode, setActiveNode] = useState(null);
  const [agentStatus, setAgentStatus] = useState({});
  const [connected, setConnected] = useState(false);
  const [complete, setComplete] = useState(false);
  const [result, setResult] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const wsRef = useRef(null);

  const start = useCallback(() => {
    if (!windowId) return;
    wsRef.current?.close();
    setEvents([]);
    setThinking({});
    setActiveNode(null);
    setAgentStatus({});
    setComplete(false);
    setResult(null);
    setStreaming(true);

    const url = `${_wsBase}/ws/stream/${windowId}`;
    const ws = new WebSocket(url);

    ws.onopen  = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => ws.close();

    ws.onmessage = (evt) => {
      try {
        const ev = JSON.parse(evt.data);
        const ts = Date.now();

        if (ev.type === 'agent_thinking') {
          setThinking(prev => ({
            ...prev,
            [ev.node]: (prev[ev.node] || '') + ev.token,
          }));
          return;
        }

        if (ev.type === 'node_start') setActiveNode(ev.node);
        if (ev.type === 'run_complete') {
          setComplete(true);
          setActiveNode(null);
          setStreaming(false);
          if (ev.decision) setResult({ ...ev.decision, _window_id: windowId });
        }

        if (ev.type === 'agent_dispatch' && ev.agent) {
          setAgentStatus(prev => ({ ...prev, [ev.agent]: { status: 'running' } }));
        }
        if (ev.type === 'tool_result' && ev.agent) {
          setAgentStatus(prev => ({
            ...prev,
            [ev.agent]: {
              status: 'done',
              success: ev.success,
              confidence: ev.confidence,
              reasoning: ev.reasoning,
            },
          }));
        }

        setEvents(prev => [...prev.slice(-49), { ...ev, _ts: ts }]);
      } catch { /* ignore non-JSON */ }
    };

    wsRef.current = ws;
  }, [windowId]);

  const stop = useCallback(() => {
    wsRef.current?.close();
    setStreaming(false);
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  // Surface the live-stream's final decision as the "latest result" card.
  useEffect(() => {
    if (complete && result) setDemoResult(result);
  }, [complete, result]);

  const value = {
    windowId, setWindowId,
    demoResult, setDemoResult,
    liveEvents, setLiveEvents,
    liveStream: { events, thinking, activeNode, agentStatus, connected, complete, result, streaming, start, stop },
  };

  return (
    <OrchestrationStreamContext.Provider value={value}>
      {children}
    </OrchestrationStreamContext.Provider>
  );
}

export function useOrchestrationStream() {
  const ctx = useContext(OrchestrationStreamContext);
  if (!ctx) throw new Error('useOrchestrationStream must be used within OrchestrationStreamProvider');
  return ctx;
}
