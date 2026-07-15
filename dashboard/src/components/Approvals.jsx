import { useState, useCallback, useEffect, useMemo } from 'react';
import { useApi, postApi, deleteApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { NotificationResult, safeStr } from '../lib/toolResults';
import {
  CheckCircle, XCircle, Shield, RefreshCw, Search,
  Clock, Ban, ThumbsUp, Zap, Play, AlertTriangle, Bell, Check,
} from 'lucide-react';
import './approvals-v2.css';

const ALL_TOOLS = [
  { id: 'compliance_agent', label: 'Compliance' },
  { id: 'route_agent', label: 'Route' },
  { id: 'cold_storage_agent', label: 'Cold Storage' },
  { id: 'notification_agent', label: 'Notification' },
  { id: 'scheduling_agent', label: 'Scheduling' },
  { id: 'insurance_agent', label: 'Insurance' },
  { id: 'triage_agent', label: 'Triage' },
];

const TIER_STYLE = {
  CRITICAL: { bg: 'var(--appr-red-soft)', color: 'var(--appr-red)' },
  HIGH:     { bg: 'var(--appr-amber-soft)', color: 'var(--appr-amber)' },
  MEDIUM:   { bg: 'var(--appr-yellow-soft)', color: 'var(--appr-yellow)' },
  LOW:      { bg: 'var(--appr-green-soft)', color: 'var(--appr-green)' },
};

const STATUS_STYLES = {
  pending:   { bg: 'var(--appr-amber-soft)', color: 'var(--appr-amber)', icon: Clock,       label: 'PENDING REVIEW' },
  approved:  { bg: 'var(--appr-green-soft)', color: 'var(--appr-green)', icon: CheckCircle,  label: 'APPROVED' },
  confirmed: { bg: 'var(--appr-blue-soft)',  color: 'var(--appr-blue)',  icon: ThumbsUp,     label: 'CONFIRMED' },
  executed:  { bg: 'var(--appr-blue-soft)',  color: 'var(--appr-blue)',  icon: Zap,          label: 'EXECUTED' },
  rejected:  { bg: 'var(--appr-red-soft)',   color: 'var(--appr-red)',   icon: Ban,          label: 'REJECTED' },
};

function TierPill({ tier }) {
  const s = TIER_STYLE[tier] || TIER_STYLE.LOW;
  return <span className="appr-tier" style={{ background: s.bg, color: s.color }}>{tier}</span>;
}

// ── Collapsed row for confirmed/executed/rejected approvals — expand for detail ──
function DecidedCard({ a }) {
  const [open, setOpen] = useState(false);
  const status = a.status;
  const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
  const StatusIcon = style.icon;

  const summary = status === 'confirmed'
    ? `First-pass execution verified as adequate by ${a.decided_by || 'operator'}`
    : status === 'executed'
    ? 'Corrective execution complete'
    : `Rejected by ${a.decided_by || 'operator'} — no further execution`;

  return (
    <div className={`appr-card${status === 'rejected' ? ' rejected' : ''}`}>
      <div className="appr-collapsed" onClick={() => setOpen(o => !o)}>
        <TierPill tier={a.risk_tier} />
        <span className="appr-id">{a.approval_id}</span>
        <div className="grow">
          {a.window_id || a.shipment_id}{a.container_id ? ` / ${a.container_id}` : ''} — {summary}
        </div>
        <span className="appr-status" style={{ background: style.bg, color: style.color }}>
          <StatusIcon style={{ width: 11, height: 11 }} /> {style.label}
        </span>
        <span className="appr-time">{a.decided_at ? new Date(a.decided_at).toLocaleString() : (a.created_at ? new Date(a.created_at).toLocaleString() : '')}</span>
        <svg className="appr-chev" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </div>
      <div className={`appr-expand${open ? ' open' : ''}`}>
        <p style={{ fontSize: 13, color: 'var(--appr-ink-0)', marginTop: 0 }}>{a.action_description}</p>
        {a.justification && <p style={{ fontSize: 11.5, color: 'var(--appr-ink-2)', marginTop: 4 }}>{a.justification}</p>}

        {status === 'confirmed' && (
          <div className="appr-infobox" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)' }}>
            <ThumbsUp style={{ width: 14, height: 14 }} />
            Human confirmed — no additional tools needed.
            {a.decided_at && <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{new Date(a.decided_at).toLocaleString()}</span>}
          </div>
        )}

        {status === 'executed' && (
          <div className="appr-infobox" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Zap style={{ width: 14, height: 14 }} />
              Corrective Execution Complete
              {a.executed_at && <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{new Date(a.executed_at).toLocaleString()}</span>}
            </div>
            {Array.isArray(a.executed_tools) && a.executed_tools.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {a.executed_tools.map(t => (
                  <span key={t} className="appr-tag" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)', borderColor: 'var(--appr-blue-soft-2)' }}>{t}</span>
                ))}
              </div>
            )}
            {(a.post_approval_actions || []).map((pa, idx) => (
              <div key={idx} className="appr-execline" style={{ width: '100%' }}>
                <span className="dot" style={{ background: pa.success ? 'var(--appr-green)' : 'var(--appr-red)' }} />
                <span style={{ fontWeight: 600, color: 'var(--appr-ink-0)' }}>{pa.tool?.replace(/_/g, ' ')}</span>
                {!pa.success && <span style={{ color: 'var(--appr-red)', marginLeft: 'auto' }}>failed</span>}
              </div>
            ))}
            {(a.post_approval_actions || []).map((pa, idx) => (
              pa.tool === 'notification_agent'
                ? <div key={`nr-${idx}`} style={{ marginTop: 6, width: '100%' }}><NotificationResult r={pa.result} /></div>
                : (pa.result?.error ? <p key={`err-${idx}`} style={{ fontSize: 11, color: 'var(--appr-red)', marginTop: 4 }}>{pa.result.error}</p> : null)
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Approvals() {
  const { data, loading, error, refetch } = useApi('/approvals/all');
  const { messages: wsMessages, connected } = useWebSocket(['approval_decided', 'approval_executed', 'approval_confirmed']);
  const [actionInFlight, setActionInFlight] = useState(null);
  const [selectedTools, setSelectedTools] = useState({});
  const [executionResults, setExecutionResults] = useState({});
  const [executing, setExecuting] = useState(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [channels, setChannels] = useState({ slack: true, sms: true, email: false });

  useEffect(() => {
    if (wsMessages.length > 0) refetch();
  }, [wsMessages, refetch]);

  const handleConfirm = useCallback(async (approvalId) => {
    setActionInFlight(approvalId);
    try {
      await postApi(`/approvals/${approvalId}/confirm`, { decided_by: 'operator' });
      await refetch();
    } catch (e) {
      console.error('Confirm error:', e);
    } finally {
      setActionInFlight(null);
    }
  }, [refetch]);

  const handleExecute = useCallback(async (approvalId, fallbackTools) => {
    setExecuting(approvalId);
    try {
      const manuallySelected = selectedTools[approvalId] || [];
      const tools = manuallySelected.length > 0 ? manuallySelected : (fallbackTools || []);
      const body = { selected_tools: tools };
      const result = await postApi(`/approvals/${approvalId}/execute`, body);
      setExecutionResults(prev => ({ ...prev, [approvalId]: result }));
    } catch (e) {
      setExecutionResults(prev => ({ ...prev, [approvalId]: { error: e.message } }));
    } finally {
      setExecuting(null);
      setTimeout(() => refetch(), 300);
    }
  }, [selectedTools, refetch]);

  const handleReject = useCallback(async (approvalId) => {
    setActionInFlight(approvalId);
    try {
      await postApi(`/approvals/${approvalId}/decide`, { decision: 'rejected', decided_by: 'operator' });
      await refetch();
    } catch (e) {
      console.error('Reject error:', e);
    } finally {
      setActionInFlight(null);
    }
  }, [refetch]);

  const handleClearAll = useCallback(async () => {
    try {
      await deleteApi('/approvals');
      setExecutionResults({});
      setSelectedTools({});
      await refetch();
    } catch (e) {
      console.error('Clear failed:', e);
    }
  }, [refetch]);

  const toggleTool = useCallback((approvalId, toolId) => {
    setSelectedTools(prev => {
      const current = prev[approvalId] || [];
      const next = current.includes(toolId)
        ? current.filter(t => t !== toolId)
        : [...current, toolId];
      return { ...prev, [approvalId]: next };
    });
  }, []);

  const toggleSelected = useCallback((approvalId) => {
    setSelectedIds(prev => prev.includes(approvalId)
      ? prev.filter(id => id !== approvalId)
      : [...prev, approvalId]);
  }, []);

  const clearSelection = useCallback(() => setSelectedIds([]), []);

  const handleBulkApprove = useCallback(async () => {
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        const a = (Array.isArray(data) ? data : []).find(x => x.approval_id === id);
        if (!a) continue;
        const allProposed = [...(a.proposed_corrections || []), ...(a.proposed_deferred || [])];
        await handleExecute(id, allProposed);
      }
    } finally {
      setBulkBusy(false);
      setSelectedIds([]);
    }
  }, [selectedIds, data, handleExecute]);

  const handleBulkReject = useCallback(async () => {
    setBulkBusy(true);
    try {
      for (const id of selectedIds) {
        await handleReject(id);
      }
    } finally {
      setBulkBusy(false);
      setSelectedIds([]);
    }
  }, [selectedIds, handleReject]);

  const counts = Array.isArray(data) ? {
    all: data.length,
    pending: data.filter(a => a.status === 'pending').length,
    confirmed: data.filter(a => a.status === 'confirmed').length,
    executed: data.filter(a => a.status === 'executed').length,
    rejected: data.filter(a => a.status === 'rejected').length,
  } : { all: 0, pending: 0, confirmed: 0, executed: 0, rejected: 0 };

  const correctionsCount = Array.isArray(data)
    ? data.filter(a => a.review_status === 'corrections_proposed' && a.status === 'pending').length
    : 0;

  // Real top-priority pending item, used to drive the notification preview —
  // no fabricated alert content, this is whatever's actually waiting.
  const safeData = Array.isArray(data) ? data : [];
  const pendingItems = safeData.filter(a => a.status === 'pending');
  const topCriticalPending = pendingItems.find(a => a.risk_tier === 'CRITICAL') || pendingItems[0] || null;

  const filtered = useMemo(() => {
    let rows = Array.isArray(data) ? data : [];
    if (filter !== 'all') rows = rows.filter(a => a.status === filter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(a => [a.approval_id, a.window_id, a.shipment_id, a.container_id]
        .filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return rows;
  }, [data, filter, search]);

  return (
    <div className="appr">

      {/* Header */}
      <div className="appr-top">
        <div>
          <h1 className="appr-title">Human Review Queue</h1>
          <p className="appr-sub">Every MEDIUM+ event lands here for human review after automated execution</p>
        </div>
        <div className="appr-statusrow">
          <div className={`appr-chip ${connected ? 'live' : ''}`}>
            <span className="appr-livedot" />{connected ? 'Live' : 'Offline'}
          </div>
          <button type="button" className="appr-chip clickable" onClick={refetch}>
            <RefreshCw style={{ width: 12, height: 12 }} /> Refresh
          </button>
          {Array.isArray(data) && data.length > 0 && (
            <button type="button" className="appr-chip clickable danger" onClick={handleClearAll}>
              <XCircle style={{ width: 12, height: 12 }} /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* KPI summary — computed from live approvals data */}
      <div className="appr-kpis">
        <div className="appr-kpi">
          <div className="appr-kpi-tag" style={{ background: 'var(--appr-amber-soft)', color: 'var(--appr-amber)' }}>ACTION</div>
          <div className="appr-kpi-label">Pending Review</div>
          <div className="appr-kpi-value" style={{ color: 'var(--appr-amber)' }}>{counts.pending}</div>
        </div>
        <div className="appr-kpi">
          <div className="appr-kpi-tag" style={{ background: 'var(--appr-red-soft)', color: 'var(--appr-red)' }}>!</div>
          <div className="appr-kpi-label">Corrections Proposed</div>
          <div className="appr-kpi-value" style={{ color: 'var(--appr-red)' }}>{correctionsCount}</div>
        </div>
        <div className="appr-kpi">
          <div className="appr-kpi-tag" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)' }}>DONE</div>
          <div className="appr-kpi-label">Executed</div>
          <div className="appr-kpi-value" style={{ color: 'var(--appr-blue)' }}>{counts.executed}</div>
        </div>
        <div className="appr-kpi">
          <div className="appr-kpi-label">Rejected</div>
          <div className="appr-kpi-value">{counts.rejected}</div>
        </div>
      </div>

      {/* Live Alert Preview — shows the real top-priority pending item as it
          would appear in a push notification, with one-tap approve/reject */}
      <div className="appr-notifpreview">
        <div className="appr-notif-head">
          <div>
            <h2>Live Alert Preview</h2>
            <p>What the on-call approver would see the moment this item hit the queue</p>
          </div>
          <div className="appr-channeltoggles">
            {(['slack', 'sms', 'email']).map(ch => (
              <button key={ch} type="button"
                className={`appr-channeltoggle${channels[ch] ? ' on' : ''}`}
                onClick={() => setChannels(prev => ({ ...prev, [ch]: !prev[ch] }))}>
                <span className="swdot" />{ch.charAt(0).toUpperCase() + ch.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {topCriticalPending ? (
          <div className="appr-slackmock">
            <div className="appr-slackmock-top">
              <div className="appr-slackmock-avatar"><Bell style={{ width: 15, height: 15 }} /></div>
              <div className="appr-slackmock-meta">
                <div className="who">Cold Chain AI <span style={{ fontWeight: 400, color: 'var(--appr-ink-2)' }}>via #ops-approvals</span></div>
                <div className="chan">to on-call approver</div>
              </div>
              <div className="appr-slackmock-time">{topCriticalPending.created_at ? new Date(topCriticalPending.created_at).toLocaleTimeString() : 'just now'}</div>
            </div>
            <div className="appr-slackmock-body">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle style={{ width: 13, height: 13, color: 'var(--appr-red)', flex: 'none' }} />
                <b>{topCriticalPending.risk_tier} approval needed — {topCriticalPending.approval_id}</b>
              </span><br />
              {topCriticalPending.window_id || topCriticalPending.shipment_id}{topCriticalPending.container_id ? ` / ${topCriticalPending.container_id}` : ''} · {safeStr(topCriticalPending.action_description)}
            </div>
            <div className="appr-slackmock-actions">
              <button type="button" className="appr-slackmock-btn approve"
                disabled={executing === topCriticalPending.approval_id}
                onClick={() => handleExecute(topCriticalPending.approval_id, [...(topCriticalPending.proposed_corrections || []), ...(topCriticalPending.proposed_deferred || [])])}>
                <Check style={{ width: 12, height: 12 }} /> Approve &amp; Execute
              </button>
              <button type="button" className="appr-slackmock-btn reject"
                disabled={actionInFlight === topCriticalPending.approval_id}
                onClick={() => handleReject(topCriticalPending.approval_id)}>
                <XCircle style={{ width: 12, height: 12 }} /> Reject
              </button>
            </div>
          </div>
        ) : (
          <div style={{ padding: '20px 18px', fontSize: 12.5, color: 'var(--appr-ink-2)' }}>No pending approvals right now — nothing to alert on.</div>
        )}
      </div>

      {/* Bulk selection bar — appears once one or more pending cards are checked */}
      {selectedIds.length > 0 && (
        <div className="appr-bulkbar">
          <span className="count">{selectedIds.length} selected</span>
          <span style={{ fontSize: 11.5, color: 'var(--appr-ink-2)' }}>of {counts.pending} pending</span>
          <div className="appr-bulkbar-actions">
            <button type="button" className="appr-btn appr-btn-primary" disabled={bulkBusy} onClick={handleBulkApprove}>
              {bulkBusy ? <><span className="appr-spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> Working…</> : 'Approve All Selected'}
            </button>
            <button type="button" className="appr-btn appr-btn-reject" disabled={bulkBusy} onClick={handleBulkReject}>Reject All Selected</button>
            <a href="#" onClick={e => { e.preventDefault(); clearSelection(); }} style={{ fontSize: 12, color: 'var(--appr-ink-2)', textDecoration: 'none', alignSelf: 'center' }}>Cancel</a>
          </div>
        </div>
      )}

      {/* Filter + search */}
      <div className="appr-bar">
        <div className="appr-tabs">
          {['all', 'pending', 'confirmed', 'executed', 'rejected'].map(f => (
            <button key={f} type="button" className={`appr-tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)} <strong>{counts[f]}</strong>
            </button>
          ))}
        </div>
        <div className="appr-search">
          <Search />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shipment or approval ID" />
        </div>
      </div>

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--appr-ink-2)', padding: '24px 0' }}>
          <div className="appr-spinner" /> Loading review queue…
        </div>
      )}
      {error && <p style={{ color: 'var(--appr-red)' }}>Error: {error}</p>}

      {!loading && filtered.length === 0 && (
        <div className="appr-empty">
          <Shield style={{ display: 'block', margin: '0 auto' }} />
          <p className="t">{filter === 'all' && !search ? 'No reviews yet' : 'No matching reviews'}</p>
          <p className="d">
            {filter === 'all' && !search
              ? 'Run orchestration on a MEDIUM+ window to generate one.'
              : 'Try a different filter or search term.'}
          </p>
        </div>
      )}

      {filtered.map(a => {
        const status = a.status || 'pending';
        if (status !== 'pending' && status !== 'approved') {
          return <DecidedCard key={a.approval_id} a={a} />;
        }

        const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
        const StatusIcon = style.icon;
        const isPending = status === 'pending';
        const isApproved = status === 'approved';
        const execResult = executionResults[a.approval_id];
        const toolsForThis = selectedTools[a.approval_id] || [];

        const hasCorrections = a.review_status === 'corrections_proposed';
        const proposedCorrections = a.proposed_corrections || [];
        const proposedDeferred = a.proposed_deferred || [];
        const allProposed = [...proposedCorrections, ...proposedDeferred];

        return (
          <div key={a.approval_id} className="appr-card">
            <div className="appr-card-head">
              {isPending && (
                <input type="checkbox" className="appr-select" checked={selectedIds.includes(a.approval_id)}
                  onChange={() => toggleSelected(a.approval_id)} />
              )}
              <TierPill tier={a.risk_tier} />
              {(a.guardrail_findings || []).some(f => !f.passed && f.check === 'rate_limit_exceeded') && (
                <span className="appr-tag" style={{ background: 'var(--appr-red-soft)', color: 'var(--appr-red)', borderColor: 'var(--appr-red-soft-2)' }}>Rate Limit</span>
              )}
              {(a.guardrail_findings || []).some(f => !f.passed && f.check === 'low_confidence') && (
                <span className="appr-tag" style={{ background: 'var(--appr-amber-soft)', color: 'var(--appr-amber)', borderColor: 'var(--appr-amber-soft)' }}>Confidence Gate</span>
              )}
              <span className="appr-id">{a.approval_id}</span>
              <span className="appr-idsub">{a.window_id || a.shipment_id}{a.container_id ? ` / ${a.container_id}` : ''}</span>
              <span className="appr-status" style={{ background: style.bg, color: style.color }}>
                <StatusIcon style={{ width: 11, height: 11 }} /> {style.label}
              </span>
              <span className="appr-time">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</span>
            </div>

            <div className="appr-body">

              {/* 1. What happened */}
              <div className="appr-section">
                <div className="appr-section-lbl"><span className="num">1</span>What happened</div>
                <div className="appr-reasoncard">
                  <p className="desc">{a.action_description}</p>
                  {a.justification && <p className="why">{a.justification}</p>}
                </div>
              </div>

              {/* 2. Agent activity so far */}
              {isPending && (Array.isArray(a.first_pass_tools) && a.first_pass_tools.length > 0 || allProposed.length > 0) && (
                <div className="appr-section">
                  <div className="appr-section-lbl"><span className="num">2</span>Agent activity so far</div>
                  <div className="appr-toolstable">
                    {Array.isArray(a.first_pass_tools) && a.first_pass_tools.length > 0 && (
                      <div className="appr-toolsrow">
                        <span className="swatch" style={{ background: 'var(--appr-green)' }} />
                        <span className="rlbl" style={{ color: 'var(--appr-green)' }}>Already ran</span>
                        <div className="rchips">
                          {a.first_pass_tools.map(t => (
                            <span key={t} className="appr-tag" style={{ background: 'var(--appr-green-soft)', color: 'var(--appr-green)', borderColor: 'var(--appr-green-soft)' }}>{t.replace('_agent', '')}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {proposedCorrections.length > 0 && (
                      <div className="appr-toolsrow">
                        <span className="swatch" style={{ background: 'var(--appr-amber)' }} />
                        <span className="rlbl" style={{ color: 'var(--appr-amber)' }}>Proposed correction</span>
                        <div className="rchips">
                          {proposedCorrections.map(t => (
                            <span key={t} className="appr-tag" style={{ background: 'var(--appr-amber-soft)', color: 'var(--appr-amber)', borderColor: 'var(--appr-amber-soft)' }}>{t.replace('_agent', '')}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {proposedDeferred.length > 0 && (
                      <div className="appr-toolsrow">
                        <span className="swatch" style={{ background: 'var(--appr-blue)' }} />
                        <span className="rlbl" style={{ color: 'var(--appr-blue)' }}>Deferred</span>
                        <div className="rchips">
                          {proposedDeferred.map(t => (
                            <span key={t} className="appr-tag" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)', borderColor: 'var(--appr-blue-soft-2)' }}>{t.replace('_agent', '')}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {isPending && (
                    hasCorrections ? (
                      <div className="appr-hint" style={{ background: 'var(--appr-amber-soft)', color: 'var(--appr-amber)' }}>
                        <AlertTriangle style={{ width: 14, height: 14 }} />
                        Reflection found quality issues after the first pass — corrections are pre-selected below. A stakeholder notification is also waiting on your decision.
                      </div>
                    ) : (
                      <div className="appr-hint" style={{ background: 'var(--appr-blue-soft)', color: 'var(--appr-blue)' }}>
                        <CheckCircle style={{ width: 14, height: 14 }} />
                        All tools executed successfully — no corrections needed. Approve to send the stakeholder notification.
                      </div>
                    )
                  )}
                </div>
              )}

              {/* 3. Your decision */}
              {isPending && (
                <div className="appr-section">
                  <div className="appr-section-lbl"><span className="num">3</span>Your decision</div>
                  <p className="appr-toolslbl">
                    {hasCorrections ? 'Corrections are pre-selected below — deselect to skip, or add more before executing' : 'Optionally select additional tools to run before approving'}
                  </p>
                  <div className="appr-toolchips">
                    {ALL_TOOLS.map(tool => {
                      const isCorrection = proposedCorrections.includes(tool.id);
                      const isDeferred = proposedDeferred.includes(tool.id);
                      const effectiveSelected = toolsForThis.length > 0
                        ? toolsForThis.includes(tool.id)
                        : (isCorrection || isDeferred);
                      const isFirstPass = Array.isArray(a.first_pass_tools) && a.first_pass_tools.includes(tool.id);
                      const cls = isFirstPass ? 'done' : effectiveSelected && isDeferred ? 'deferred-selected' : effectiveSelected ? 'selected' : '';
                      return (
                        <button key={tool.id} type="button"
                          className={`appr-toolchip${cls ? ' ' + cls : ''}`}
                          disabled={isFirstPass}
                          title={isFirstPass ? 'Already executed in first pass' : isDeferred ? 'Deferred to post-approval' : ''}
                          onClick={() => toggleTool(a.approval_id, tool.id)}>
                          {tool.label} {isFirstPass ? '✓' : isDeferred ? '⏳' : ''}
                        </button>
                      );
                    })}
                  </div>

                  <div className="appr-foot">
                    {toolsForThis.length > 0 ? (
                      <button type="button" className="appr-btn appr-btn-primary"
                        disabled={executing === a.approval_id || actionInFlight === a.approval_id}
                        onClick={() => handleExecute(a.approval_id, allProposed)}>
                        {executing === a.approval_id ? <><span className="appr-spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> Executing…</> : <><Play style={{ width: 13, height: 13 }} /> Execute {toolsForThis.length} selected tools</>}
                      </button>
                    ) : (
                      <button type="button" className="appr-btn appr-btn-primary"
                        disabled={executing === a.approval_id || actionInFlight === a.approval_id}
                        onClick={() => handleExecute(a.approval_id, allProposed)}>
                        {executing === a.approval_id ? <><span className="appr-spinner" style={{ borderTopColor: '#fff', borderColor: 'rgba(255,255,255,0.4)' }} /> Executing…</> : <><Play style={{ width: 13, height: 13 }} /> Approve &amp; Execute ({allProposed.length} tools{hasCorrections ? ` incl. ${proposedCorrections.length} corrections` : ''})</>}
                      </button>
                    )}

                    {hasCorrections && (
                      <button type="button" className="appr-btn appr-btn-confirm"
                        disabled={executing === a.approval_id || actionInFlight === a.approval_id}
                        onClick={() => handleExecute(a.approval_id, proposedDeferred)}>
                        <ThumbsUp style={{ width: 13, height: 13 }} /> Skip Corrections — Notify Only
                      </button>
                    )}

                    <button type="button" className="appr-btn appr-btn-reject"
                      disabled={actionInFlight === a.approval_id}
                      onClick={() => handleReject(a.approval_id)}>
                      <XCircle style={{ width: 13, height: 13 }} /> Reject
                    </button>

                    {actionInFlight === a.approval_id && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--appr-ink-2)' }}>
                        <span className="appr-spinner" /> Processing…
                      </span>
                    )}
                  </div>

                  {execResult?.error && (
                    <div className="appr-errbox">
                      Error: {typeof execResult.error === 'object' ? JSON.stringify(execResult.error) : execResult.error}
                    </div>
                  )}
                </div>
              )}

              {/* Approved: waiting for tool selection */}
              {isApproved && (
                <div className="appr-section">
                  <div className="appr-section-lbl"><span className="num">2</span>Select tools to execute</div>
                  <div className="appr-toolchips">
                    {ALL_TOOLS.map(tool => {
                      const selected = toolsForThis.includes(tool.id);
                      return (
                        <button key={tool.id} type="button"
                          className={`appr-toolchip${selected ? ' selected' : ''}`}
                          onClick={() => toggleTool(a.approval_id, tool.id)}>
                          {tool.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="appr-foot">
                    <button type="button" className="appr-btn appr-btn-confirm"
                      disabled={actionInFlight === a.approval_id || executing === a.approval_id}
                      onClick={() => handleConfirm(a.approval_id)}>
                      <ThumbsUp style={{ width: 13, height: 13 }} />
                      {actionInFlight === a.approval_id ? 'Confirming…' : 'Confirm — First Pass Adequate'}
                    </button>
                    <button type="button" className="appr-btn appr-btn-primary"
                      disabled={executing === a.approval_id}
                      onClick={() => handleExecute(a.approval_id)}>
                      <Play style={{ width: 13, height: 13 }} />
                      {executing === a.approval_id ? 'Executing…' : `Execute ${toolsForThis.length > 0 ? toolsForThis.length + ' selected' : 'proposed'} tools`}
                    </button>
                  </div>
                </div>
              )}

            </div>
          </div>
        );
      })}
    </div>
  );
}
