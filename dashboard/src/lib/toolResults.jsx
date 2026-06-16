// Shared result-rendering helpers used by AgentActivity and Approvals pages.
import { Brain } from 'lucide-react';

export function MethodBadge({ method }) {
  if (!method) return null;
  const isLLM = String(method).includes('llm') || String(method).includes('vector');
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ring-1 ring-inset ${
      isLLM ? 'bg-violet-500/15 text-violet-400 ring-violet-500/20' : 'bg-slate-700/50 text-slate-400 ring-slate-600/30'
    }`}>
      {isLLM && <Brain className="w-2.5 h-2.5" />}
      {String(method).replace(/_/g, ' ')}
    </span>
  );
}

export function KV({ label, value, mono = false }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-1.5 text-[11px]">
      <span className="text-slate-500 shrink-0">{label}:</span>
      <span className={`text-slate-300 ${mono ? 'font-mono' : ''}`}>{String(value)}</span>
    </div>
  );
}

export function safeStr(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function NotificationResult({ r }) {
  if (!r) return null;
  const ap = r.alert_payload || {};
  const isAgentic = r.agentic_workflow === true;
  const sent = r.notifications_sent || [];

  const msgPreview = r.message_preview || ap.message || r.message || '';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <KV label="Channel" value={r.channel} />
        <KV label="Recipients" value={Array.isArray(r.recipients) ? r.recipients.join(', ') : safeStr(r.recipients)} />
        {isAgentic && <KV label="Batch ID" value={r.notification_batch_id} mono />}
        {isAgentic && <KV label="Sent/Failed" value={`${r.successful_deliveries || 0} / ${r.failed_deliveries || 0}`} />}
        {!isAgentic && <KV label="Revised ETA" value={ap.revised_eta} mono />}
        {!isAgentic && <KV label="Spoilage" value={ap.spoilage_probability_pct != null ? `${ap.spoilage_probability_pct}%` : null} />}
      </div>

      {msgPreview && (
        <div className="mt-1.5 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/15">
          <span className="text-[9px] font-semibold text-amber-400 uppercase tracking-wider block mb-1">Notification Message</span>
          <p className="text-xs text-amber-200/90 leading-relaxed whitespace-pre-wrap">{msgPreview}</p>
        </div>
      )}

      {sent.length > 0 && (
        <div className="space-y-1">
          <span className="text-[9px] font-semibold text-cyan-400 uppercase tracking-wider">Delivered Notifications</span>
          {sent.slice(0, 4).map((n, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-slate-800/40">
              <span className={`w-1.5 h-1.5 rounded-full ${n.status === 'sent' ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-slate-300 font-medium">{n.recipient_name || n.recipient_role}</span>
              <span className="text-slate-500">via {n.channel}</span>
              {n.subject && <span className="text-cyan-300/80 truncate ml-auto max-w-[200px]">"{n.subject}"</span>}
            </div>
          ))}
          {sent.length > 4 && <p className="text-[10px] text-slate-500">+{sent.length - 4} more</p>}
        </div>
      )}
    </div>
  );
}
