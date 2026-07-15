import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, AlertTriangle, Brain } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { humanize, safeStr, NotificationResult } from '../lib/toolResults';
import { SEMANTIC_VAR, runStatusSemantic } from '../lib/runStatus';
import { getRunKey } from '../lib/runKey';
import { getAgentMeta } from '../lib/agents.jsx';
import './agent-run-detail-v2.css';

// ── Human-readable formatter for raw decision/reflection text ────────────────
const AGENT_NAME_MAP = {
  compliance_agent:   'Compliance Agent',
  cold_storage_agent: 'Cold Storage Agent',
  route_agent:        'Route Agent',
  insurance_agent:    'Insurance Agent',
  scheduling_agent:   'Scheduling Agent',
  notification_agent: 'Notification Agent',
  triage_agent:       'Triage Agent',
  approval_workflow:  'Approval Workflow',
};

// Replace technical tokens with readable equivalents
function humanizeText(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/^(QUALITY|INFO|WARN|ERROR|DEBUG)\s+\w+:\s*/i, '');
  for (const [key, val] of Object.entries(AGENT_NAME_MAP)) {
    s = s.replace(new RegExp(key, 'g'), val);
  }
  s = s
    .replace(/spoilage_probability/g, 'spoilage probability')
    .replace(/route_evaluation/g, 'route evaluation')
    .replace(/primary_issue/g, 'primary issue')
    .replace(/risk_tier/g, 'risk tier')
    .replace(/temp_slope/g, 'temperature slope')
    .replace(/duration_hours/g, 'duration (hours)')
    .replace(/ml_score/g, 'ML score')
    .replace(/fused_risk_score/g, 'risk score')
    .replace(/\bN\/A\b/g, 'not available')
    .replace(/_([a-z])/g, (_, c) => ' ' + c);
  s = s.replace(/  +/g, ' ').trim();
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

const STATUS_FIELDS = [
  { key: 'status', label: 'Status', humanize: true },
  { key: 'requires_approval', label: 'Requires approval', bool: true },
  { key: 'replan_count', label: 'Replans' },
];

const ID_FIELDS = [
  { key: 'approval_id', label: 'Approval ID' },
  { key: 'thread_id', label: 'Thread ID' },
];

const TC = {
  ok:   { bg: 'var(--ard-green-soft)', border: 'var(--ard-green-soft)', color: 'var(--ard-green)' },
  warn: { bg: 'var(--ard-amber-soft)', border: 'var(--ard-amber-soft)', color: 'var(--ard-amber)' },
  info: { bg: 'var(--ard-blue-soft)',  border: 'var(--ard-blue-soft)',  color: 'var(--ard-blue)' },
  crit: { bg: 'var(--ard-red-soft)',   border: 'var(--ard-red-soft)',   color: 'var(--ard-red)' },
};

const ARC_STATUS = {
  compliance_agent:   { label: 'Completed',           tone: 'ok' },
  cold_storage_agent: { label: 'Facility identified', tone: 'blue' },
  insurance_agent:    { label: 'Claim prepared',      tone: 'warn' },
  scheduling_agent:   { label: 'Pending approval',    tone: 'warn' },
  route_agent:        { label: 'Route selected',      tone: 'blue' },
  notification_agent: { label: 'Sent',                tone: 'ok' },
  triage_agent:        { label: 'Scored',              tone: 'ok' },
  approval_workflow:  { label: 'Escalated',           tone: 'warn' },
  _default:           { label: 'Completed',           tone: 'ok' },
};
const TONE_STYLE = {
  ok:   { bg: 'var(--ard-green-soft)', color: 'var(--ard-green)' },
  blue: { bg: 'var(--ard-blue-soft)', color: 'var(--ard-blue)' },
  warn: { bg: 'var(--ard-amber-soft)', color: 'var(--ard-amber)' },
};

// ── Per-agent result bodies — mirror the mockup's ac-* markup exactly, pulling
// from the same real result fields the app's original ToolResult renderers use
// (lib/toolResultRenderers.jsx), just restyled to the Clinical Calm system. ───

function KVRow({ label, value, color }) {
  if (value == null || value === '') return null;
  return (
    <div className="ac-kv"><span className="k">{label}</span><span className="v" style={color ? { color } : undefined}>{value}</span></div>
  );
}

function ComplianceCardBody({ r }) {
  if (!r) return null;
  const cv = r.compliance_validation || {};
  const status = cv.compliance_status || r.compliance_status || 'unknown';
  const regs = cv.regulations_checked || cv.applicable_citations || [];
  const rawViolations = cv.violations || r.violations || [];
  const violations = rawViolations.map(v => typeof v === 'object' ? (v.violation_type || v.description || JSON.stringify(v)) : String(v));
  const badgeStyle = status === 'compliant' || status === 'pass'
    ? { bg: 'var(--ard-green-soft)', color: 'var(--ard-green)' }
    : status === 'conditional_pass'
    ? { bg: 'var(--ard-yellow-soft)', color: 'var(--ard-yellow)' }
    : { bg: 'var(--ard-red-soft)', color: 'var(--ard-red)' };
  const decisionMethod = cv.decision_method || r.decision_method;
  const disposition = cv.disposition || r.disposition;

  return (
    <>
      <div className="ac-statusrow">
        <span className="ac-badge" style={badgeStyle}>{humanize(status).toUpperCase()}</span>
        {decisionMethod && <span className="ac-methodbadge">{humanize(decisionMethod)}</span>}
        {disposition && <span className="ac-methodbadge">Disposition: {humanize(disposition)}</span>}
      </div>
      {violations.length > 0 && (
        <div className="ac-box" style={{ background: 'var(--ard-red-soft)' }}>
          <div className="boxlbl" style={{ color: 'var(--ard-red)' }}><AlertTriangle style={{ width: 11, height: 11 }} /> Violations ({violations.length})</div>
          {violations.slice(0, 5).map((v, i) => <div key={i} className="line" style={{ color: 'var(--ard-ink-1)' }}>{safeStr(v)}</div>)}
        </div>
      )}
      {regs.length > 0 && (
        <div className="ac-box" style={{ background: 'var(--ard-blue-soft)' }}>
          <div className="boxlbl" style={{ color: 'var(--ard-blue)' }}>📖 Regulations Checked ({regs.length})</div>
          {regs.slice(0, 4).map((c, i) => <div key={i} className="line" style={{ color: 'var(--ard-ink-1)' }}>{safeStr(c)}</div>)}
        </div>
      )}
      {cv.evidence_summary && <p className="ac-evidence">"{safeStr(cv.evidence_summary)}"</p>}
      <div className="ac-kvgrid">
        <KVRow label="Score" value={cv.compliance_score} />
        <KVRow label="Risk Tier" value={cv.risk_tier} color={cv.risk_tier === 'CRITICAL' ? 'var(--ard-red)' : undefined} />
        <KVRow label="Event" value={cv.event_type && humanize(cv.event_type)} />
        <KVRow label="Log ID" value={r.log_id} />
      </div>
    </>
  );
}

function ColdStorageCardBody({ r }) {
  if (!r) return null;
  const alts = Array.isArray(r.alternative_facilities) ? r.alternative_facilities : [];
  return (
    <>
      <div className="ac-statusrow">
        <span style={{ fontWeight: 700, color: 'var(--ard-ink-0)', fontSize: 13 }}>{safeStr(r.recommended_facility) || '—'}</span>
        {r.suitability_tier && <span className="ac-badge" style={{ background: 'var(--ard-green-soft)', color: 'var(--ard-green)' }}>{humanize(r.suitability_tier).toUpperCase()}</span>}
      </div>
      <div className="ac-kvgrid">
        <KVRow label="Location" value={r.location} />
        <KVRow label="Temp range" value={r.temp_range_supported || r.temp_range} />
        <KVRow label="Capacity" value={r.available_capacity_pct != null ? `${Number(r.available_capacity_pct).toFixed(0)}%` : null} />
        <KVRow label="Advance notice" value={r.advance_notice_required_hours != null ? `${r.advance_notice_required_hours}h` : null} />
        <KVRow label="Contact" value={r.contact} />
        <KVRow label="Urgency" value={r.urgency && humanize(r.urgency)} color={r.urgency === 'critical' || r.urgency === 'high' ? 'var(--ard-amber)' : undefined} />
      </div>
      {alts.length > 0 && (
        <>
          <div className="ac-sectionlbl">Alternatives ({alts.length})</div>
          {alts.slice(0, 3).map((a, i) => (
            <div key={i} className="ac-altrow">
              <span className="name">{safeStr(a.name || a.id || `Alt ${i + 1}`)}</span>
              {a.disqualified
                ? <span style={{ color: 'var(--ard-red)' }}>disqualified — {humanize(safeStr(a.disqualification_reason))}</span>
                : a.suitability_tier && <span style={{ color: 'var(--ard-green)' }}>{humanize(a.suitability_tier)}</span>}
            </div>
          ))}
        </>
      )}
    </>
  );
}

function RouteCardBody({ r }) {
  if (!r) return null;
  return (
    <>
      <div className="ac-statusrow">
        <span style={{ fontWeight: 700, color: 'var(--ard-ink-0)', fontSize: 13 }}>{safeStr(r.carrier) || '—'}</span>
        {r.selection_method && <span className="ac-methodbadge">{humanize(r.selection_method)}</span>}
        {r.temp_class && <span className="ac-methodbadge">{r.temp_class}</span>}
      </div>
      {r.recommended_route && <p style={{ fontSize: 11.5, color: 'var(--ard-ink-1)', marginBottom: 10 }}>{safeStr(r.recommended_route)}</p>}
      {r.selection_rationale && (
        <div className="ac-box" style={{ background: 'var(--ard-blue-soft)' }}>
          <div className="boxlbl" style={{ color: 'var(--ard-blue)' }}><Brain style={{ width: 11, height: 11 }} /> LLM Rationale</div>
          <p style={{ fontSize: 11, color: 'var(--ard-ink-1)', lineHeight: 1.55 }}>{safeStr(r.selection_rationale)}</p>
        </div>
      )}
      <div className="ac-kvgrid">
        <KVRow label="ETA change" value={r.eta_change_hours != null ? `${r.eta_change_hours}h` : null} />
        <KVRow label="Reason" value={r.reason} />
      </div>
    </>
  );
}

const LOSS_BREAKDOWN_LABELS = {
  product_loss_usd: 'Product loss', disposal_cost_usd: 'Disposal cost', handling_cost_usd: 'Handling cost',
  downstream_disruption_usd: 'Downstream disruption', risk_multiplier: 'Risk multiplier',
};

function InsuranceCardBody({ r }) {
  if (!r) return null;
  const lb = r.loss_breakdown && typeof r.loss_breakdown === 'object' ? r.loss_breakdown : {};
  const headline = lb.total_estimated_loss_usd ?? r.estimated_loss_usd;
  const headlineLabel = lb.total_estimated_loss_usd != null ? 'total estimated loss' : 'estimated loss';

  return (
    <>
      <div className="ac-headline">
        <span className="big">{headline != null ? `$${Number(headline).toLocaleString()}` : '—'}</span>
        <span className="lbl">{headlineLabel}</span>
      </div>
      <div className="ac-kvgrid">
        <KVRow label="Product" value={r.product_name} />
        <KVRow label="Incident" value={r.incident_summary} />
        {r.estimated_loss_usd != null && lb.total_estimated_loss_usd != null && (
          <KVRow label="Direct loss estimate" value={`$${Number(r.estimated_loss_usd).toLocaleString()}`} />
        )}
        {Object.entries(lb).filter(([k]) => k !== 'total_estimated_loss_usd').map(([k, v]) => (
          <KVRow key={k} label={LOSS_BREAKDOWN_LABELS[k] || humanize(k)}
            value={k === 'risk_multiplier' ? `${v}×` : (typeof v === 'number' ? `$${v.toLocaleString()}` : safeStr(v))} />
        ))}
        <KVRow label="Replacement" value={r.replacement_lead_time_days != null ? `${r.replacement_lead_time_days}d (${r.expedited_lead_time_days || '?'}d exp.)` : null} />
        <KVRow label="Substitute" value={r.substitute_available != null ? (r.substitute_available ? 'Available' : 'No') : null} color={r.substitute_available ? 'var(--ard-green)' : undefined} />
      </div>
      {Array.isArray(r.next_steps) && r.next_steps.length > 0 && (
        <>
          <div className="ac-sectionlbl">Next Steps</div>
          <div className="ac-box" style={{ background: 'var(--ard-amber-soft)', marginBottom: 0 }}>
            {r.next_steps.slice(0, 3).map((s, i) => <div key={i} className="line" style={{ color: 'var(--ard-ink-1)' }}>{safeStr(s)}</div>)}
          </div>
        </>
      )}
    </>
  );
}

function SchedulingCardBody({ r }) {
  if (!r) return null;
  const recs = Array.isArray(r.facility_recommendations) ? r.facility_recommendations : [];
  return (
    <>
      <div className="ac-kvgrid">
        <KVRow label="Reason" value={r.reason} />
        <KVRow label="Product" value={r.product_id} />
      </div>
      {recs.slice(0, 2).map((f, i) => (
        <div key={i} className="ac-box" style={{ background: 'var(--ard-bg-0)', border: '1px solid var(--ard-panel-border)' }}>
          <p style={{ fontSize: 11.5, color: 'var(--ard-ink-0)', fontWeight: 600, marginBottom: 6 }}>{safeStr(f.facility)}</p>
          <div className="ac-kvgrid" style={{ marginBottom: 0 }}>
            <KVRow label="Action" value={f.action && humanize(f.action)} />
            <KVRow label="Appointments" value={f.appointment_count} />
            <KVRow label="Revised ETA" value={f.revised_eta} />
            <KVRow label="Patient impact" value={f.patient_impact} />
          </div>
        </div>
      ))}
      {recs.length > 2 && <p style={{ fontSize: 11, color: 'var(--ard-ink-2)' }}>+{recs.length - 2} more facilities</p>}
    </>
  );
}

function ApprovalCardBody({ r, decisionMeta }) {
  if (!r) return null;
  const isResolved = decisionMeta?._approval_status === 'approved' || decisionMeta?._execution_mode === 'post_approval';
  const displayStatus = isResolved ? 'approved' : (r.status || 'pending');
  const style = displayStatus === 'approved' ? { bg: 'var(--ard-green-soft)', color: 'var(--ard-green)' }
    : displayStatus === 'rejected' ? { bg: 'var(--ard-red-soft)', color: 'var(--ard-red)' }
    : { bg: 'var(--ard-amber-soft)', color: 'var(--ard-amber)' };
  return (
    <>
      <div className="ac-statusrow">
        <span className="ac-badge" style={style}>{displayStatus.toUpperCase()}</span>
        {decisionMeta?._approved_by && <span className="ac-methodbadge">by {decisionMeta._approved_by}</span>}
      </div>
      <div className="ac-kvgrid">
        <KVRow label="Approval ID" value={r.approval_id} />
        <KVRow label="Urgency" value={r.urgency && humanize(r.urgency)} />
      </div>
      {r.message && <p style={{ fontSize: 11.5, color: 'var(--ard-ink-1)', marginTop: 6 }}>{safeStr(r.message)}</p>}
    </>
  );
}

function FallbackCardBody({ r }) {
  if (!r) return null;
  const show = ['status', 'risk_tier', 'message', 'shipment_id'];
  return (
    <div className="ac-kvgrid">
      {show.filter(k => r[k]).map(k => <KVRow key={k} label={humanize(k)} value={safeStr(r[k])} />)}
    </div>
  );
}

function AgentResultBody({ tool, result, decisionMeta }) {
  if (!result) return null;
  switch (tool) {
    case 'compliance_agent':   return <ComplianceCardBody r={result} />;
    case 'route_agent':        return <RouteCardBody r={result} />;
    case 'cold_storage_agent': return <ColdStorageCardBody r={result} />;
    case 'scheduling_agent':   return <SchedulingCardBody r={result} />;
    case 'insurance_agent':    return <InsuranceCardBody r={result} />;
    case 'notification_agent': return <NotificationResult r={result} />;
    case 'approval_workflow':  return <ApprovalCardBody r={result} decisionMeta={decisionMeta} />;
    default: return <FallbackCardBody r={result} />;
  }
}

// ── Agent result card (inside execute expand) ─────────────────────────────────
function AgentCard({ action, decisionMeta }) {
  const meta = getAgentMeta(action?.tool);
  const Icon = meta.icon;
  const statusMeta = ARC_STATUS[action?.tool] || ARC_STATUS._default;
  const statusStyle = TONE_STYLE[statusMeta.tone];

  return (
    <div className="ard-agentcard">
      <div className="ard-agentcard-head">
        <div className="l">
          <div className="ard-agenticon" style={{ background: 'var(--ard-blue-soft)', color: 'var(--ard-blue)' }}>
            <Icon style={{ width: 14, height: 14 }} />
          </div>
          {meta.name}
        </div>
        <span className="ard-agentstatus" style={{ background: statusStyle.bg, color: statusStyle.color }}>{statusMeta.label}</span>
      </div>
      {action?.result != null ? (
        <div className="ard-agentcard-body">
          <AgentResultBody tool={action.tool} result={action.result} decisionMeta={decisionMeta} />
        </div>
      ) : (
        <div className="ard-agentcard-body" style={{ fontSize: 11, color: 'var(--ard-ink-2)', fontStyle: 'italic' }}>No result captured</div>
      )}
    </div>
  );
}

// ── Collapsible Execute section ────────────────────────────────────────────────
function ExecuteSection({ payload, decisionMeta }) {
  const [open, setOpen] = useState(false);
  const actions = Array.isArray(payload) ? payload : [];
  if (actions.length === 0) return null;

  const uniqueTools = [...new Set(actions.map(a => a?.tool).filter(Boolean))];
  const agentNames = uniqueTools.map(t => getAgentMeta(t).name);

  return (
    <div>
      <div className="ard-exectoggle" role="button" tabIndex={0}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}>
        <div className="l">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
          <span className="count">{actions.length} agent result{actions.length !== 1 ? 's' : ''}</span>
          <span className="names">· {agentNames.join(' · ')}</span>
        </div>
        <svg className="ard-execchev" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15" /></svg>
      </div>
      <div className={`ard-execexpand${open ? ' open' : ''}`}>
        {actions.map((a, i) => (
          <AgentCard key={`${a?.tool}_${i}`} action={a} decisionMeta={decisionMeta} />
        ))}
      </div>
    </div>
  );
}

// ── Single timeline item ──────────────────────────────────────────────────────
function TimelineStep({ step, decisionMeta, index, isLast }) {
  const kind = step.detail?.kind || 'text';
  const level = step.level || 'info';
  const tc = TC[level] || TC.info;

  const timeLabel = step.time
    ? new Date(step.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : null;

  return (
    <div className="ard-tlitem">
      {!isLast && <div className="ard-tlline" />}
      <div className="ard-tlcircle" style={{ background: tc.bg, color: tc.color, borderColor: tc.border }}>{index + 1}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ard-tltoprow">
          <div style={{ minWidth: 0 }}>
            <div className="ard-tltitle">{step.title}</div>
            {kind === 'actions' && step.summary && <div className="ard-tlsummary" style={{ marginTop: 1 }}>{step.summary}</div>}
          </div>
          {timeLabel && <div className="ard-tltime">{timeLabel}</div>}
        </div>

        {kind !== 'actions' && step.summary && <div className="ard-tlsummary">{step.summary}</div>}

        {kind === 'actions' && <ExecuteSection payload={step.detail?.payload} decisionMeta={decisionMeta} />}

        {kind === 'text' && Array.isArray(step.detail?.payload) && step.detail.payload.length > 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 3 }}>
            {step.detail.payload.slice(1).map((note, i) => <div key={i} className="ard-tlnote">{note}</div>)}
          </div>
        )}

        {kind === 'approval' && (
          <div style={{ marginTop: 6 }}>
            {step.detail?.payload?.approvedBy && (
              <div className="ard-approvedby">By: <b>{step.detail.payload.approvedBy}</b></div>
            )}
            {step.detail?.payload?.approvedAt && (
              <div className="ard-approvedby">At: {new Date(step.detail.payload.approvedAt).toLocaleString()}</div>
            )}
            <Link to="/approvals" className="ard-gotoapproval">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
              Go to Approvals
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Rich timeline step builder ────────────────────────────────────────────────
function buildRichSteps(run) {
  const d = run || {};
  const steps = [];
  const windowId = d.window_id || d._window_id || '';

  const score = d.fused_risk_score ?? d.max_fused_score ?? d.risk_score ?? d.final_score;
  const drivers = (d.key_drivers || d.ml_top_features || []).slice(0, 3);
  let triageSummary = '';
  if (score != null) {
    triageSummary = `ML scored ${windowId} at ${Number(score).toFixed(4)} — ${d.risk_tier || 'UNKNOWN'} tier triggered.`;
    if (drivers.length > 0) triageSummary += ` Top features: ${drivers.map(f => humanizeText(f)).join(', ')}.`;
  } else {
    triageSummary = `Risk tier: ${d.risk_tier || 'UNKNOWN'}.${d.decision_summary ? ' ' + humanizeText(d.decision_summary) : ''}`;
  }
  steps.push({
    id: 'triage',
    level: d.risk_tier === 'CRITICAL' ? 'crit' : d.risk_tier === 'HIGH' ? 'warn' : 'info',
    title: 'Risk Triage', time: d.timestamp || null, summary: triageSummary,
    detail: { kind: 'text', payload: null },
  });

  if (Array.isArray(d.draft_plan) && d.draft_plan.length > 0) {
    const planTools = d.draft_plan.map(s => getAgentMeta(s?.tool)?.name || s?.tool || s?.action).filter(Boolean);
    let planningSummary = `Draft plan: ${planTools.join(' → ')}.`;
    if (d.replan_count > 0) planningSummary += ` Replan #${d.replan_count} triggered${d.approval_reason ? ': ' + d.approval_reason : ''}.`;
    steps.push({
      id: 'plan', level: 'warn',
      title: d.replan_count > 0 ? `LLM Planning — Wave 1 (${d.replan_count} replan${d.replan_count > 1 ? 's' : ''})` : 'LLM Planning — Wave 1',
      time: null, summary: planningSummary,
      detail: { kind: 'plan', payload: d.draft_plan },
    });
  }

  const allActions = [...(Array.isArray(d.actions_taken) ? d.actions_taken : []), ...(Array.isArray(d.corrective_actions) ? d.corrective_actions : [])];
  if (allActions.length > 0) {
    const agentNames = [...new Set(allActions.map(a => getAgentMeta(a?.tool)?.name).filter(Boolean))];
    const hasFailure = allActions.some(a => a?.result?.status && !['ok', 'success'].includes(a.result.status));
    const waveLabel = d.replan_count > 0 ? `Wave ${d.replan_count + 1}` : 'Wave 1';
    steps.push({
      id: 'execute', level: hasFailure ? 'warn' : 'ok',
      title: `Execute — ${waveLabel}`, time: null, summary: `Ran: ${agentNames.join(', ')}`,
      detail: { kind: 'actions', payload: allActions },
    });
  }

  if (Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0) {
    const noteText = d.reflection_notes.join(' ').toLowerCase();
    const isHold = noteText.includes('hold') || noteText.includes('violation') || noteText.includes('compliance') || noteText.includes('depot') || d.replan_count > 0;
    steps.push({
      id: 'reflect', level: 'crit',
      title: isHold ? 'Compliance Hold Applied' : 'Reflect', time: null,
      summary: humanizeText(d.reflection_notes[0]),
      detail: { kind: 'text', payload: d.reflection_notes.map(humanizeText) },
    });
  }

  if (d.awaiting_approval) {
    steps.push({
      id: 'approval', level: 'warn', title: 'Escalation — Human Review', time: null,
      summary: humanizeText(d.approval_reason || 'Awaiting ops team confirmation before proceeding.'),
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  } else if (d._approved_by || d._approved_at) {
    steps.push({
      id: 'approved', level: 'ok', title: 'Approved', time: d._approved_at || null,
      summary: `Approved by ${d._approved_by || 'operator'}.`,
      detail: { kind: 'approval', payload: { approvedBy: d._approved_by, approvedAt: d._approved_at } },
    });
  }

  return steps;
}

const TIER_BADGE = {
  CRITICAL: { bg: 'var(--ard-red-soft)', color: 'var(--ard-red)' },
  HIGH:     { bg: 'var(--ard-amber-soft)', color: 'var(--ard-amber)' },
  MEDIUM:   { bg: 'var(--ard-yellow-soft)', color: 'var(--ard-yellow)' },
  LOW:      { bg: 'var(--ard-green-soft)', color: 'var(--ard-green)' },
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AgentRunDetailV2() {
  const BASE = '/agent-v2';
  const { runKey } = useParams();
  const { data: history, loading } = useApi('/orchestrator/history?limit=30');

  const run = Array.isArray(history) ? history.find(d => getRunKey(d) === runKey) : null;
  const steps = run ? buildRichSteps(run) : [];
  const level = run ? runStatusSemantic(run) : 'info';
  const tier = run?.risk_tier || 'LOW';
  const windowId = run?.window_id || run?._window_id;
  const decisionMeta = run ? {
    risk_tier: run.risk_tier, window_id: windowId,
    shipment_id: run.shipment_id, container_id: run.container_id,
  } : {};

  return (
    <div className="ard">

      <div className="ard-crumb">
        <Link to={BASE}><ArrowLeft style={{ width: 14, height: 14 }} /> Agent Activity</Link>
        <ArrowRight style={{ width: 12, height: 12, opacity: 0.4 }} />
        <span className="ard-mono" style={{ color: 'var(--ard-ink-0)', fontWeight: 600 }}>{windowId || runKey}</span>
      </div>

      {!run && loading && <p style={{ color: 'var(--ard-ink-2)' }}>Loading run…</p>}
      {!run && !loading && (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ard-ink-2)' }}>
          <p style={{ fontWeight: 600, color: 'var(--ard-ink-0)' }}>Run not found</p>
          <p style={{ fontSize: 12, marginTop: 4 }}>No run matching this key in the last 30 runs.</p>
        </div>
      )}

      {run && (() => {
        const riskScore = run.fused_risk_score ?? run.max_fused_score ?? run.risk_score ?? run.final_score;
        const agentsUsed = [...new Set([...(run.actions_taken || []), ...(run.corrective_actions || [])].map(a => a?.tool).filter(Boolean))].length;

        const insResult = [...(run.actions_taken || []), ...(run.corrective_actions || [])].find(a => a?.tool === 'insurance_agent')?.result;
        const peakTemp = insResult?.excursion_summary?.peak_temp_c ?? run.telemetry_snapshot?.max_temp_c ?? run.telemetry_snapshot?.peak_temp_c ?? null;
        const valueAtRisk = insResult?.estimated_loss_usd ?? insResult?.loss_breakdown?.total_estimated_loss_usd ?? insResult?.total_estimated_loss_usd ?? null;

        const statusLabel = run.awaiting_approval ? 'Awaiting Approval' : run._approved_by ? 'Approved' : level === 'ok' ? 'Resolved' : level === 'warn' ? 'Needs Review' : 'Completed';
        const statusStyle = run.awaiting_approval
          ? { bg: 'var(--ard-amber-soft)', color: 'var(--ard-amber)' }
          : run._approved_by
          ? { bg: 'var(--ard-green-soft)', color: 'var(--ard-green)' }
          : { bg: 'var(--ard-blue-soft)', color: 'var(--ard-blue)' };
        const tb = TIER_BADGE[tier] || TIER_BADGE.LOW;

        const dispTime = run.timestamp ? new Date(run.timestamp).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : null;

        const statsRow = [
          { label: 'Risk Score', value: riskScore != null ? Number(riskScore).toFixed(4) : '—', color: 'var(--ard-red)' },
          { label: 'Peak Temp', value: peakTemp != null ? `${Number(peakTemp).toFixed(1)}°C` : '—', color: 'var(--ard-blue)' },
          { label: 'Agents Used', value: agentsUsed || '—', color: 'var(--ard-ink-0)' },
          { label: 'Replans', value: run.replan_count ?? 0, color: 'var(--ard-ink-0)' },
          { label: 'Value at Risk', value: valueAtRisk != null ? (valueAtRisk >= 1000 ? `$${(valueAtRisk / 1000).toFixed(0)}K` : `$${valueAtRisk}`) : '—', color: 'var(--ard-amber)' },
        ];

        return (
          <>
            {/* Hero card */}
            <div className="ard-herocard">
              <div className="ard-herotop">
                <div>
                  <div className="ard-badgerow">
                    <span className="ard-tierpill" style={{ background: tb.bg, color: tb.color }}>{tier}</span>
                    <div style={{ width: 1, height: 16, background: 'var(--ard-hair)' }} />
                    <span style={{ fontSize: 11, color: 'var(--ard-ink-2)' }}>{windowId}{run.shipment_id ? ` · ${run.shipment_id}` : ''}</span>
                  </div>
                  <div className="ard-heroid">
                    {run.shipment_id && run.container_id ? `${run.shipment_id} / ${run.container_id}` : run.shipment_id || run.container_id || windowId}
                  </div>
                  <div className="ard-herosub">
                    Multi-wave agentic orchestration
                    {agentsUsed ? ` · ${agentsUsed} agent${agentsUsed !== 1 ? 's' : ''} dispatched` : ''}
                    {dispTime ? ` · ${dispTime}` : ''}
                  </div>
                </div>
                <div className="ard-herostatus" style={{ background: statusStyle.bg }}>
                  <div className="k" style={{ color: statusStyle.color }}>Status</div>
                  <div className="v" style={{ color: statusStyle.color }}>{statusLabel}</div>
                </div>
              </div>
              <div className="ard-herostats">
                {statsRow.map(s => (
                  <div key={s.label} className="ard-herostat">
                    <div className="v" style={{ color: s.color }}>{s.value}</div>
                    <div className="k">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Decision summary */}
            {run.decision_summary && (
              <div className="ard-infopanel">
                <div className="ic" style={{ background: 'var(--ard-amber-soft)' }}>
                  <AlertTriangle style={{ width: 18, height: 18, color: 'var(--ard-amber)' }} />
                </div>
                <div>
                  <p className="lbl">Decision Summary</p>
                  <p className="txt" style={{ fontWeight: 600 }}>{humanizeText(run.decision_summary)}</p>
                </div>
              </div>
            )}

            {/* LLM reasoning */}
            {run.llm_reasoning && (
              <div className="ard-infopanel">
                <div className="ic" style={{ background: 'var(--ard-blue-soft)' }}>
                  <Brain style={{ width: 18, height: 18, color: 'var(--ard-blue)' }} />
                </div>
                <div>
                  <p className="lbl">LLM Reasoning</p>
                  <p className="txt" style={{ fontStyle: 'italic', color: 'var(--ard-ink-1)', fontWeight: 400 }}>{humanizeText(run.llm_reasoning)}</p>
                </div>
              </div>
            )}

            {/* Sidebar + timeline */}
            <div className="ard-detailgrid">
              <div className="ard-panel" style={{ padding: 16 }}>
                <p className="ard-sidehead">Status</p>
                {STATUS_FIELDS.map(({ key, label, humanize: sh, bool }) => {
                  const val = run[key];
                  if (val === undefined || val === null) return null;
                  const display = bool ? (val ? 'Yes' : 'No') : (sh ? humanize(val) : val);
                  const color = key === 'status' ? SEMANTIC_VAR[level] : undefined;
                  return (
                    <div key={key} className="ard-sidefield">
                      <span className="k">{label}</span>
                      <span className="v" style={color ? { color } : undefined}>{String(display)}</span>
                    </div>
                  );
                })}
                <p className="ard-sidehead">Identifiers</p>
                {ID_FIELDS.map(({ key, label }) => run[key] != null ? (
                  <div key={key} className="ard-sidefield">
                    <span className="k">{label}</span>
                    <span className="v" style={{ fontSize: 11, wordBreak: 'break-all' }}>{run[key]}</span>
                  </div>
                ) : null)}
                {run.max_fused_score != null && (
                  <>
                    <p className="ard-sidehead">Risk</p>
                    <div className="ard-sidefield" style={{ borderBottom: 'none' }}>
                      <span className="k">Fused Score</span>
                      <span className="v">{run.max_fused_score.toFixed(4)}</span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--ard-track)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(100, run.max_fused_score * 100).toFixed(0)}%`, background: (TIER_BADGE[tier] || TIER_BADGE.LOW).color }} />
                    </div>
                  </>
                )}
              </div>

              <div className="ard-panel" style={{ padding: '20px 22px' }}>
                <div className="ard-timelinehead">
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ard-ink-0)' }}>Decision Timeline</span>
                  <span className="ard-stepbadge">{steps.length} step{steps.length !== 1 ? 's' : ''}</span>
                </div>
                {steps.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--ard-ink-2)' }}>No timeline data available.</p>
                ) : (
                  steps.map((step, i) => (
                    <TimelineStep key={step.id || i} step={step} decisionMeta={decisionMeta} index={i} isLast={i === steps.length - 1} />
                  ))
                )}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
