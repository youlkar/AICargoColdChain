import { useState, useEffect, useRef, useCallback } from 'react';

const _apiUrl = import.meta.env.VITE_API_URL ?? '';
const _wsBase = _apiUrl
  ? _apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')
  : `ws://${window.location.host}`;
const WS_URL = `${_wsBase}/ws/events`;

const IDLE_TIMEOUT_MS = 20 * 60 * 1000; // disconnect after 20 min of no interaction
const IDLE_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

export function useWebSocket(eventTypes = []) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const idleTimerRef = useRef(null);
  const idleRef = useRef(false);

  const disconnect = useCallback(() => {
    clearTimeout(reconnectRef.current);
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
    idleRef.current = true;
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    idleRef.current = false;
    try {
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        // Only auto-reconnect if the user isn't idle
        if (!idleRef.current) {
          reconnectRef.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          if (eventTypes.length === 0 || eventTypes.includes(data.type)) {
            setMessages(prev => [...prev.slice(-99), data]);
          }
        } catch { /* ignore non-JSON */ }
      };
      wsRef.current = ws;
    } catch { /* connection refused */ }
  }, [eventTypes.join(',')]);

  const resetIdleTimer = useCallback(() => {
    clearTimeout(idleTimerRef.current);
    // If we went idle and the user just came back, reconnect
    if (idleRef.current) connect();
    idleTimerRef.current = setTimeout(disconnect, IDLE_TIMEOUT_MS);
  }, [connect, disconnect]);

  useEffect(() => {
    connect();
    resetIdleTimer();

    IDLE_EVENTS.forEach(e => window.addEventListener(e, resetIdleTimer, { passive: true }));
    return () => {
      clearTimeout(reconnectRef.current);
      clearTimeout(idleTimerRef.current);
      wsRef.current?.close();
      IDLE_EVENTS.forEach(e => window.removeEventListener(e, resetIdleTimer));
    };
  }, [connect, resetIdleTimer]);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, connected, clearMessages };
}
