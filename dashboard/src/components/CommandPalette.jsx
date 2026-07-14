// dashboard/src/components/CommandPalette.jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, Bot, X } from 'lucide-react';
import { getApi } from '../hooks/useApi';
import { AGENTS } from '../lib/agents';

const WINDOW_ID_RE = /^W\d+$/i;

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [shipments, setShipments] = useState(null);
  const [windowMatch, setWindowMatch] = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Global ⌘K / Ctrl+K shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lazy-load shipments the first time the palette opens
  useEffect(() => {
    if (open && shipments === null) {
      getApi('/shipments').then(setShipments).catch(() => setShipments([]));
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, shipments]);

  // Exact window-ID lookup
  useEffect(() => {
    const q = query.trim();
    if (!WINDOW_ID_RE.test(q)) { setWindowMatch(null); return; }
    let cancelled = false;
    getApi(`/windows/${q.toUpperCase()}`).then(w => {
      if (!cancelled) setWindowMatch(w && w.window_id ? w : null);
    }).catch(() => { if (!cancelled) setWindowMatch(null); });
    return () => { cancelled = true; };
  }, [query]);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);

  const goToShipment = (shipmentId) => { navigate(`/shipments/${shipmentId}`); close(); };
  const goToAgent = () => { navigate('/agent'); close(); };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-[var(--text-secondary-2)] bg-white/[0.03] border border-[var(--card-border)] hover:bg-white/[0.06] transition w-64">
        <Search className="w-3.5 h-3.5" />
        <span className="font-heading">Search shipments, windows, agents…</span>
        <span className="ml-auto font-data text-[10px] opacity-60">⌘K</span>
      </button>
    );
  }

  const q = query.trim().toLowerCase();
  const shipmentResults = q.length === 0 ? [] : (shipments || []).filter(s =>
    s.shipment_id.toLowerCase().includes(q) || s.products.some(p => p.toLowerCase().includes(q))
  ).slice(0, 6);
  const agentResults = q.length === 0 ? [] : AGENTS.filter(a =>
    a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)
  ).slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40" onClick={close}>
      <div className="panel w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--card-border)]">
          <Search className="w-4 h-4 text-[var(--text-secondary-2)]" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search shipments, window IDs, agents…"
            className="flex-1 bg-transparent outline-none text-sm font-heading text-[var(--text-primary)] placeholder-[var(--text-secondary-2)]" />
          <button onClick={close} className="text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto scrollbar-thin">
          {q.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-[var(--text-secondary-2)]">
              Type to search shipments, window IDs (e.g. W00464), or agent names.
            </p>
          )}

          {windowMatch && (
            <button onClick={() => goToShipment(windowMatch.shipment_id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition text-left">
              <Package className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-data text-[var(--text-primary)]">{windowMatch.window_id}</p>
                <p className="text-xs text-[var(--text-secondary-2)]">{windowMatch.shipment_id} · {windowMatch.container_id}</p>
              </div>
            </button>
          )}

          {shipmentResults.map(s => (
            <button key={s.shipment_id} onClick={() => goToShipment(s.shipment_id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition text-left">
              <Package className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-heading font-semibold text-[var(--text-primary)]">{s.shipment_id}</p>
                <p className="text-xs text-[var(--text-secondary-2)] truncate">{s.products.join(', ')}</p>
              </div>
            </button>
          ))}

          {agentResults.map(a => (
            <button key={a.id} onClick={goToAgent}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition text-left">
              <Bot className="w-4 h-4 text-[var(--accent-cyan)] shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-heading font-semibold text-[var(--text-primary)]">{a.name}</p>
                <p className="text-xs text-[var(--text-secondary-2)] truncate">{a.desc}</p>
              </div>
            </button>
          ))}

          {q.length > 0 && !windowMatch && shipmentResults.length === 0 && agentResults.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-[var(--text-secondary-2)]">No matches for "{query}".</p>
          )}
        </div>
      </div>
    </div>
  );
}
