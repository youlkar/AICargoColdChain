// Plain-English summaries of orchestration decisions, derived from the same
// `actions_taken` / `reflection_notes` / execution-mode fields that the
// technical view renders verbatim. Used by AgentActivityOverview.
import { safeStr } from './toolResults';

export const SENTIMENT_STYLES = {
  good:     { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  warning:  { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   dot: 'bg-amber-400' },
  critical: { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',     dot: 'bg-red-400' },
  info:     { text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/20',    dot: 'bg-cyan-400' },
};

const fmtUsd = (n) => `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

// One-line, plain-English headline + detail for a single agent's result.
export function getAgentHeadline(tool, action) {
  const r = (action && action.result) || {};
  const success = action?.success !== false;

  if (!success) {
    return { title: 'Action Did Not Complete', detail: safeStr(r.error || 'This step ran into an error and needs attention.'), sentiment: 'critical' };
  }

  switch (tool) {
    case 'compliance_agent': {
      const cv = r.compliance_validation || {};
      const status = cv.compliance_status || r.compliance_status;
      const violations = cv.violations || r.violations || [];
      const approvalLevel = cv.approval_level || r.approval_level;
      if (status === 'violation') {
        return {
          title: 'Compliance Violation Found',
          detail: `${violations.length} regulation${violations.length === 1 ? '' : 's'} violated${approvalLevel ? ` — ${approvalLevel} approval required` : ''}.`,
          sentiment: 'critical',
        };
      }
      if (status === 'conditional_pass') {
        return {
          title: 'Conditional Compliance Pass',
          detail: cv.evidence_summary ? safeStr(cv.evidence_summary) : 'Minor issues noted — proceed with caution.',
          sentiment: 'warning',
        };
      }
      return { title: 'Fully Compliant', detail: 'No regulatory issues found for this shipment.', sentiment: 'good' };
    }

    case 'route_agent': {
      if (r.status === 'recommendation_generated') {
        const eta = r.eta_change_hours;
        let etaText = '';
        if (typeof eta === 'number' && eta !== 0) {
          etaText = eta < 0 ? ` — arrives ${Math.abs(eta)}h sooner` : ` — arrives ${eta}h later`;
        }
        return {
          title: 'Reroute Recommended',
          detail: `${safeStr(r.carrier) || 'New carrier'}${r.recommended_route ? ` via ${safeStr(r.recommended_route)}` : ''}${etaText}.`,
          sentiment: typeof eta === 'number' && eta < 0 ? 'good' : 'warning',
        };
      }
      return { title: 'Current Route Confirmed', detail: 'No rerouting needed — the existing route remains safe.', sentiment: 'good' };
    }

    case 'cold_storage_agent': {
      if (r.status === 'facility_identified') {
        const tier = r.suitability_tier;
        const capacity = r.available_capacity_pct != null ? `${Number(r.available_capacity_pct).toFixed(0)}% capacity available` : 'capacity confirmed';
        return {
          title: 'Backup Cold Storage Secured',
          detail: `${safeStr(r.recommended_facility) || 'A backup facility'}${r.location ? ` (${safeStr(r.location)})` : ''} — ${tier ? `${tier} match, ` : ''}${capacity}.`,
          sentiment: tier === 'excellent' || tier === 'good' ? 'good' : 'warning',
        };
      }
      return { title: 'No Backup Facility Found', detail: 'No suitable cold-storage alternative was identified — manual follow-up needed.', sentiment: 'critical' };
    }

    case 'insurance_agent': {
      const loss = r.estimated_loss_usd;
      return {
        title: 'Loss Estimate Prepared',
        detail: `${loss != null ? fmtUsd(loss) : 'A loss'} estimated${r.claim_id ? ` — claim ${r.claim_id} drafted` : ''}.`,
        sentiment: 'warning',
      };
    }

    case 'scheduling_agent': {
      const recs = Array.isArray(r.facility_recommendations) ? r.facility_recommendations : [];
      if (recs.length === 0) {
        return { title: 'No Rescheduling Needed', detail: 'Downstream appointments are unaffected.', sentiment: 'good' };
      }
      const totalAppts = recs.reduce((sum, f) => sum + (Number(f.appointment_count) || 0), 0);
      return {
        title: 'Downstream Schedule Adjusted',
        detail: `${totalAppts} appointment${totalAppts === 1 ? '' : 's'} across ${recs.length} facilit${recs.length === 1 ? 'y' : 'ies'} rescheduled.`,
        sentiment: 'warning',
      };
    }

    case 'notification_agent': {
      if (r.status === 'notifications_sent') {
        const sent = r.successful_deliveries ?? (Array.isArray(r.notifications_sent) ? r.notifications_sent.length : 0);
        const total = r.total_notifications ?? sent;
        const recipients = Array.isArray(r.recipients) ? r.recipients.join(', ') : 'stakeholders';
        return {
          title: 'Stakeholders Notified',
          detail: `${sent}/${total} notification${total === 1 ? '' : 's'} delivered to ${recipients}.`,
          sentiment: r.failed_deliveries ? 'warning' : 'good',
        };
      }
      const recipients = Array.isArray(r.recipients) ? r.recipients.join(', ') : 'stakeholders';
      return { title: 'Notifications Queued', detail: `Will alert ${recipients} once a decision is approved.`, sentiment: 'info' };
    }

    case 'approval_workflow': {
      return {
        title: 'Escalated for Human Review',
        detail: `${r.approval_level ? `${r.approval_level} approval` : 'Approval'} requested${r.urgency ? ` — ${r.urgency} urgency` : ''}.`,
        sentiment: 'warning',
      };
    }

    default:
      return { title: safeStr(r.status || 'Completed').replace(/_/g, ' '), detail: '', sentiment: 'info' };
  }
}

// Overall run status — collapses the various execution-mode / approval flags
// into one plain-English status pill.
export function getRunStatus(d) {
  const isPostApproval = d._execution_mode === 'post_approval' || d._execution_mode === 'human_selective';
  const isConfirmed = d._execution_mode === 'confirmed' || d.review_status === 'confirmed';
  const isAwaitingApproval = d.awaiting_approval && !isPostApproval && !isConfirmed;
  const hasCorrections = d.review_status === 'corrections_proposed';

  if (isPostApproval) {
    return { label: 'Resolved', detail: 'Reviewed, approved, and stakeholders notified.', sentiment: 'good' };
  }
  if (isConfirmed) {
    return { label: 'Confirmed', detail: 'Operator confirmed — no further action needed.', sentiment: 'good' };
  }
  if (isAwaitingApproval && hasCorrections) {
    return { label: 'Action Required', detail: 'Additional corrective steps were proposed — needs review.', sentiment: 'warning' };
  }
  if (isAwaitingApproval) {
    return { label: 'Awaiting Confirmation', detail: 'All actions completed — awaiting operator sign-off.', sentiment: 'warning' };
  }
  return { label: 'Completed', detail: 'Handled automatically — no human action needed.', sentiment: 'good' };
}

// A simplified, plain-English "journey" for the run — collapses the
// Interpret/Plan/Execute/Observe/Reflect/Revise pipeline into business steps.
export function getJourneySteps(d) {
  const isPostApproval = d._execution_mode === 'post_approval' || d._execution_mode === 'human_selective';
  const isConfirmed = d._execution_mode === 'confirmed' || d.review_status === 'confirmed';
  const isAwaitingApproval = d.awaiting_approval && !isPostApproval && !isConfirmed;
  const hasExecution = Array.isArray(d.actions_taken) && d.actions_taken.length > 0;
  const hasReflection = Array.isArray(d.reflection_notes) && d.reflection_notes.length > 0;
  const reviewRequired = !!(d.awaiting_approval || isPostApproval || isConfirmed);

  const steps = [
    { label: 'Risk Detected', state: 'done' },
    { label: 'Agents Investigated', state: hasExecution ? 'done' : 'pending' },
    { label: 'Quality Checked', state: hasReflection ? 'done' : hasExecution ? 'pending' : 'upcoming' },
  ];

  if (reviewRequired) {
    steps.push({ label: 'Human Review', state: isPostApproval || isConfirmed ? 'done' : isAwaitingApproval ? 'active' : 'upcoming' });
    steps.push({ label: 'Resolved', state: isPostApproval || isConfirmed ? 'done' : 'upcoming' });
  } else {
    steps.push({ label: 'Resolved', state: d.decision_summary ? 'done' : 'pending' });
  }
  return steps;
}
