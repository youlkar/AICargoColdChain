// Per-tool structured result renderers, shared between AgentActivity's
// technical view and the AgentActivityOverview "show details" expanders.
import { Brain, AlertTriangle, BookOpen } from 'lucide-react';
import { KV, safeStr, NotificationResult, MethodBadge } from './toolResults';

export function ComplianceResult({ r }) {
  if (!r) return null;
  const cv = r.compliance_validation || {};
  const status = cv.compliance_status || r.compliance_status || 'unknown';
  const regs = cv.regulations_checked || cv.applicable_citations || [];
  const rawViolations = cv.violations || r.violations || [];
  const violations = rawViolations.map(v => typeof v === 'object' ? (v.violation_type || v.description || JSON.stringify(v)) : String(v));

  const statusColor = status === 'compliant' || status === 'pass'
    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    : status === 'conditional_pass'
    ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20'
    : 'text-red-400 bg-red-500/10 border-red-500/20';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${statusColor}`}>{status.toUpperCase()}</span>
        <MethodBadge method={cv.decision_method || r.decision_method} />
        {(cv.disposition || r.disposition) && <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded">Disposition: {cv.disposition || r.disposition}</span>}
      </div>
      {violations.length > 0 && (
        <div className="bg-red-500/5 border border-red-500/10 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1 mb-1"><AlertTriangle className="w-3 h-3" /> Violations ({violations.length})</p>
          {violations.slice(0, 5).map((v, i) => <p key={i} className="text-[11px] text-red-300/80 pl-4 truncate">• {v}</p>)}
          {violations.length > 5 && <p className="text-[10px] text-red-400/50 pl-4">+{violations.length - 5} more</p>}
        </div>
      )}
      {regs.length > 0 && (
        <div className="bg-violet-500/5 border border-violet-500/10 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-1 mb-1"><BookOpen className="w-3 h-3" /> Regulations Checked ({regs.length})</p>
          {regs.slice(0, 4).map((c, i) => <p key={i} className="text-[11px] text-violet-300/70 pl-4 truncate">• {safeStr(c)}</p>)}
          {regs.length > 4 && <p className="text-[10px] text-violet-400/50 pl-4">+{regs.length - 4} more</p>}
        </div>
      )}
      {cv.evidence_summary && <p className="text-[11px] text-slate-400 italic leading-relaxed">{safeStr(cv.evidence_summary)}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Score" value={cv.compliance_score} mono />
        <KV label="Risk Tier" value={cv.risk_tier} />
        <KV label="Event" value={cv.event_type} />
        <KV label="Log ID" value={r.log_id} mono />
      </div>
    </div>
  );
}

export function RouteResult({ r }) {
  if (!r) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold text-white">{safeStr(r.carrier) || '—'}</span>
        <MethodBadge method={r.selection_method} />
        {r.temp_class && <span className="text-[10px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20">{r.temp_class}</span>}
      </div>
      {r.recommended_route && <p className="text-xs text-slate-400">{safeStr(r.recommended_route)}</p>}
      {r.selection_rationale && (
        <div className="bg-violet-500/5 border border-violet-500/10 rounded-lg p-3">
          <p className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider mb-1 flex items-center gap-1"><Brain className="w-3 h-3" /> LLM Rationale</p>
          <p className="text-[11px] text-violet-300/80 leading-relaxed">{safeStr(r.selection_rationale)}</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="ETA change" value={r.eta_change_hours != null ? `${r.eta_change_hours}h` : null} />
        <KV label="Reason" value={r.reason} />
      </div>
    </div>
  );
}

export function ColdStorageResult({ r }) {
  if (!r) return null;
  const alts = Array.isArray(r.alternative_facilities) ? r.alternative_facilities : [];
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-white">{safeStr(r.recommended_facility) || '—'}</span>
        {r.suitability_tier && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/20">{r.suitability_tier}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Location" value={r.location} />
        <KV label="Temp range" value={r.temp_range_supported || r.temp_range} mono />
        <KV label="Capacity" value={r.available_capacity_pct != null ? `${Number(r.available_capacity_pct).toFixed(0)}%` : null} />
        <KV label="Advance notice" value={r.advance_notice_required_hours != null ? `${r.advance_notice_required_hours}h` : null} />
        <KV label="Contact" value={r.contact} />
        <KV label="Urgency" value={r.urgency} />
      </div>
      {alts.length > 0 && (
        <div className="mt-1">
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Alternatives ({alts.length})</p>
          {alts.slice(0, 3).map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] py-0.5">
              <span className="text-slate-400 truncate flex-1">{safeStr(a.name || a.id || `Alt ${i + 1}`)}</span>
              {a.disqualified ? <span className="text-red-400 text-[10px]">{safeStr(a.disqualification_reason).replace(/_/g, ' ')}</span>
                : a.suitability_tier && <span className="text-emerald-400 text-[10px]">{a.suitability_tier}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function InsuranceResult({ r }) {
  if (!r) return null;
  const lb = r.loss_breakdown && typeof r.loss_breakdown === 'object' ? r.loss_breakdown : {};
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-white">{r.estimated_loss_usd != null ? `$${Number(r.estimated_loss_usd).toLocaleString()}` : '—'}</span>
        <span className="text-[10px] text-slate-500">estimated loss</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Product" value={r.product_name} />
        <KV label="Incident" value={r.incident_summary} />
        {Object.keys(lb).length > 0 && Object.entries(lb).map(([k, v]) => <KV key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'number' ? `$${v.toLocaleString()}` : safeStr(v)} />)}
        <KV label="Replacement" value={r.replacement_lead_time_days != null ? `${r.replacement_lead_time_days}d (${r.expedited_lead_time_days || '?'}d exp.)` : null} />
        <KV label="Substitute" value={r.substitute_available != null ? (r.substitute_available ? 'Available' : 'No') : null} />
      </div>
      {Array.isArray(r.next_steps) && r.next_steps.length > 0 && (
        <div className="mt-1">
          <p className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Next Steps</p>
          {r.next_steps.slice(0, 3).map((s, i) => <p key={i} className="text-[10px] text-slate-400 pl-3">• {safeStr(s)}</p>)}
        </div>
      )}
    </div>
  );
}

export function SchedulingResult({ r }) {
  if (!r) return null;
  const recs = Array.isArray(r.facility_recommendations) ? r.facility_recommendations : [];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Reason" value={r.reason} />
        <KV label="Product" value={r.product_id} />
      </div>
      {recs.length > 0 && (
        <div className="space-y-2 mt-1">
          {recs.slice(0, 2).map((f, i) => (
            <div key={i} className="bg-white/[0.02] border border-white/[0.04] rounded-lg p-2.5 space-y-1">
              <p className="text-[11px] text-white font-medium truncate">{safeStr(f.facility)}</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                <KV label="Action" value={f.action?.replace(/_/g, ' ')} />
                <KV label="Appointments" value={f.appointment_count} />
                <KV label="Revised ETA" value={f.revised_eta} mono />
                <KV label="Patient impact" value={f.patient_impact} />
                <KV label="Contact" value={f.facility_contact} mono />
              </div>
            </div>
          ))}
          {recs.length > 2 && <p className="text-[10px] text-slate-500">+{recs.length - 2} more facilities</p>}
        </div>
      )}
    </div>
  );
}

export function ApprovalResult({ r, decisionMeta }) {
  if (!r) return null;
  const isResolved = decisionMeta?._approval_status === 'approved' || decisionMeta?._execution_mode === 'post_approval';
  const displayStatus = isResolved ? 'approved' : (r.status || 'pending');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
          displayStatus === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
          : displayStatus === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/20'
          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>{displayStatus.toUpperCase()}</span>
        {decisionMeta?._approved_by && <span className="text-[10px] text-slate-500">by {decisionMeta._approved_by}</span>}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Approval ID" value={r.approval_id} mono />
        <KV label="Urgency" value={r.urgency} />
        {r.message && <div className="col-span-2"><KV label="Message" value={r.message} /></div>}
      </div>
    </div>
  );
}

export function FallbackResult({ r }) {
  if (!r) return null;
  const show = ['status', 'risk_tier', 'message', 'shipment_id'];
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
      {show.filter(k => r[k]).map(k => <KV key={k} label={k} value={safeStr(r[k])} />)}
    </div>
  );
}

export function ToolResult({ tool, result: r, decisionMeta }) {
  if (!r) return null;
  try {
    switch (tool) {
      case 'compliance_agent':   return <ComplianceResult r={r} />;
      case 'route_agent':        return <RouteResult r={r} />;
      case 'cold_storage_agent': return <ColdStorageResult r={r} />;
      case 'scheduling_agent':   return <SchedulingResult r={r} />;
      case 'insurance_agent':    return <InsuranceResult r={r} />;
      case 'notification_agent': return <NotificationResult r={r} />;
      case 'approval_workflow':  return <ApprovalResult r={r} decisionMeta={decisionMeta} />;
      default: return <FallbackResult r={r} />;
    }
  } catch {
    return <FallbackResult r={r} />;
  }
}
