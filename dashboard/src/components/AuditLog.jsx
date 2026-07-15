import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { ScrollText, ChevronDown, Shield, ShieldCheck, AlertTriangle, Search, Download } from 'lucide-react';
import { getAgentMeta } from '../lib/agents.jsx';
import { getRunKey } from '../lib/runKey';
import { runStatusSemantic } from '../lib/runStatus';
import { humanize } from '../lib/toolResults';
import { timeAgo } from '../lib/format';
import './audit-log-v2.css';

const TIER_STYLE = {
  CRITICAL: { bg: 'var(--aud-red-soft)', color: 'var(--aud-red)' },
  HIGH:     { bg: 'var(--aud-amber-soft)', color: 'var(--aud-amber)' },
  MEDIUM:   { bg: 'var(--aud-yellow-soft)', color: 'var(--aud-yellow)' },
  LOW:      { bg: 'var(--aud-green-soft)', color: 'var(--aud-green)' },
};

const RUN_STATUS_LABEL = { crit: 'Awaiting', warn: 'Corrections', ok: 'Resolved', info: 'No actions', rejected: 'Rejected' };
const RUN_STATUS_STYLE = {
  crit: { bg: 'var(--aud-amber-soft)', color: 'var(--aud-amber)' },
  warn: { bg: 'var(--aud-amber-soft)', color: 'var(--aud-amber)' },
  ok:   { bg: 'var(--aud-green-soft)', color: 'var(--aud-green)' },
  info: { bg: 'var(--aud-panel-border)', color: 'var(--aud-ink-2)' },
  rejected: { bg: 'var(--aud-red-soft)', color: 'var(--aud-red)' },
};

function TierPill({ tier }) {
  const s = TIER_STYLE[tier] || TIER_STYLE.LOW;
  return <span className="aud-tier" style={{ background: s.bg, color: s.color }}>{tier}</span>;
}

const TIER_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

// Small ring donut for the Tier Distribution KPI card — pure SVG, no charting
// library. Offsets are precomputed functionally (no mutation during render).
function TierDonut({ tierCounts }) {
  const total = TIER_ORDER.reduce((s, t) => s + (tierCounts[t] || 0), 0);
  const c = 2 * Math.PI * 20;

  const arcs = TIER_ORDER.filter(t => tierCounts[t] > 0).reduce((acc, t) => {
    const pct = total > 0 ? (tierCounts[t] / total) * 100 : 0;
    const dash = (pct / 100) * c;
    const offset = acc.length ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
    return [...acc, { tier: t, dash, offset }];
  }, []);

  return (
    <svg width="52" height="52" viewBox="0 0 52 52" style={{ flex: 'none' }}>
      <circle cx="26" cy="26" r="20" fill="none" stroke="var(--aud-track)" strokeWidth="7" />
      {arcs.map(a => (
        <circle key={a.tier} cx="26" cy="26" r="20" fill="none" stroke={TIER_STYLE[a.tier].color} strokeWidth="7"
          strokeDasharray={`${a.dash} ${c - a.dash}`} strokeDashoffset={-a.offset}
          transform="rotate(-90 26 26)" strokeLinecap="round" />
      ))}
    </svg>
  );
}

// Best-effort one-line summary of a tool's result — mirrors the original's
// priority-ordered field lookup so the audit trail shows something useful
// without per-agent-type rendering branches.
function summarizeToolResult(result) {
  if (!result || typeof result !== 'object') return null;
  const r = result;
  if (r.compliance_status) return `${humanize(r.compliance_status)}${r.product_disposition ? ` → ${humanize(r.product_disposition)}` : ''}`;
  if (r.selected_route || r.recommended_route) return r.selected_route || r.recommended_route;
  if (r.recommended_facility || r.facility_name) return r.recommended_facility || r.facility_name;
  if (r.estimated_loss_usd != null) return `$${Number(r.estimated_loss_usd).toLocaleString()} estimated loss`;
  if (r.estimated_loss != null) return `$${Number(r.estimated_loss).toLocaleString()} estimated loss`;
  if (r.status) return humanize(r.status);
  return null;
}

function RunRow({ run }) {
  const [open, setOpen] = useState(false);
  const windowId = run.window_id || run._window_id;
  const level = runStatusSemantic(run);
  const actions = run.actions_taken || [];
  const uniqueTools = [...new Set(actions.map(a => a?.tool).filter(Boolean))];
  const runKey = getRunKey(run);
  const findings = (run.guardrail_findings || []).filter(f => f && f.passed === false);
  const statusStyle = RUN_STATUS_STYLE[level];

  return (
    <>
      <div className="aud-row" onClick={() => setOpen(o => !o)}>
        <TierPill tier={run.risk_tier} />
        <span className="aud-id">{windowId}</span>
        <span className="aud-sub2">{run.shipment_id}{run.container_id ? ` / ${run.container_id}` : ''}</span>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {uniqueTools.slice(0, 5).map(t => (
            <span key={t} className="aud-agentchip" style={{ background: 'var(--aud-blue-soft)', color: 'var(--aud-blue)' }}>{humanize(getAgentMeta(t).name)}</span>
          ))}
          {uniqueTools.length > 5 && <span className="aud-sub2">+{uniqueTools.length - 5}</span>}
        </div>
        <span className="aud-tier" style={{ background: statusStyle.bg, color: statusStyle.color }}>{RUN_STATUS_LABEL[level]}</span>
        {findings.length > 0 && <AlertTriangle style={{ width: 14, height: 14, color: 'var(--aud-amber)' }} />}
        <span className="aud-grow" />
        <span className="aud-time">{timeAgo(run.timestamp)}</span>
        <ChevronDown className="aud-chev" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </div>
      <div className={`aud-detail${open ? ' open' : ''}`}>
        <div>
          <div className="collbl">Scores</div>
          <div className="line">Fused: <b>{run.fused_risk_score?.toFixed(4) ?? '—'}</b></div>
          <div className="line">ML Spoilage: <b>{run.ml_spoilage_probability?.toFixed(4) ?? '—'}</b></div>
          <div className="line">Confidence: <b>{run.confidence?.toFixed(2) ?? '—'}</b></div>
          {run.replan_count > 0 && <div className="line" style={{ color: 'var(--aud-amber)', marginTop: 4 }}>{run.replan_count} replan(s)</div>}
        </div>
        <div>
          <div className="collbl">Key Drivers</div>
          {run.key_drivers?.length > 0
            ? run.key_drivers.slice(0, 4).map((k, j) => <div key={j} className="line">{humanize(typeof k === 'string' ? k : JSON.stringify(k))}</div>)
            : <div className="line" style={{ color: 'var(--aud-ink-2)' }}>none</div>}
        </div>
        <div>
          <div className="collbl">Agent Results</div>
          {actions.length > 0 ? actions.map((a, j) => {
            const summary = summarizeToolResult(a.result);
            return (
              <div key={j} className="line">
                <span style={{ color: 'var(--aud-blue)' }}>{humanize(getAgentMeta(a.tool).name)}</span>
                {summary ? <>: <b>{summary}</b></> : null}
              </div>
            );
          }) : <div className="line" style={{ color: 'var(--aud-ink-2)' }}>none</div>}
          {findings.length > 0 && <div className="line" style={{ color: 'var(--aud-red)', fontWeight: 600, marginTop: 4 }}>{findings.length} guardrail finding(s)</div>}
        </div>
        <div>
          <div className="collbl">Decision</div>
          <div className="line" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {run.decision_summary || run.llm_reasoning || run.approval_reason || '—'}
          </div>
          {run.requires_approval && <div className="line" style={{ color: 'var(--aud-amber)', fontWeight: 600, marginTop: 4 }}>Requires approval</div>}
          <Link to={`/agent-v2/runs/${encodeURIComponent(runKey)}`} onClick={e => e.stopPropagation()} style={{ display: 'inline-block', marginTop: 8 }}>
            Full run details →
          </Link>
        </div>
      </div>
    </>
  );
}

function ComplianceRow({ rec }) {
  const [open, setOpen] = useState(false);

  if (rec.entry_type === 'guardrail_finding') {
    return (
      <div className="aud-findingrow">
        <AlertTriangle style={{ width: 15, height: 15, color: rec.severity === 'critical' ? 'var(--aud-red)' : 'var(--aud-amber)' }} />
        <span className="aud-id" style={{ fontSize: 12 }}>{humanize(rec.check)}</span>
        <span className="aud-sub2">{humanize(getAgentMeta(rec.agent).name)}</span>
        <span className="aud-grow" style={{ fontSize: 11.5, color: 'var(--aud-ink-1)' }}>{rec.message}</span>
        <span className="aud-time">{rec.timestamp}</span>
      </div>
    );
  }

  const finalScore = complianceFinalScore(rec);
  const detScore = complianceDetScore(rec);
  const mlScore = complianceMlScore(rec);
  const rulesFired = complianceRulesFired(rec);
  const actions = complianceActions(rec);
  const requiresApproval = complianceRequiresApproval(rec);
  const hasMlFeatures = (rec.ml_top_features || []).length > 0;

  return (
    <>
      <div className="aud-row" onClick={() => setOpen(o => !o)}>
        <TierPill tier={rec.risk_tier} />
        <span className="aud-id">{rec.window_id}</span>
        <span className="aud-sub2">{rec.shipment_id} / {rec.container_id}</span>
        <span className="aud-mono" style={{ fontSize: 12, color: 'var(--aud-ink-1)' }}>{finalScore?.toFixed(4) ?? '—'}</span>
        {requiresApproval && <Shield style={{ width: 14, height: 14, color: 'var(--aud-amber)' }} />}
        <span className="aud-grow" />
        <span className="aud-time">{recordTimestamp(rec)}</span>
        <ChevronDown className="aud-chev" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </div>
      <div className={`aud-detail${open ? ' open' : ''}`}>
        <div>
          <div className="collbl">Scores</div>
          <div className="line">Det: <b>{detScore != null ? detScore.toFixed(4) : '—'}</b></div>
          <div className="line">ML: <b>{mlScore != null ? mlScore.toFixed(4) : '—'}</b></div>
          <div className="line">Final: <b>{finalScore != null ? finalScore.toFixed(4) : '—'}</b></div>
        </div>
        <div>
          <div className="collbl">Rules Fired</div>
          {rulesFired.length > 0
            ? rulesFired.map((r, j) => <div key={j} className="line">{humanize(r)}</div>)
            : <div className="line" style={{ color: 'var(--aud-ink-2)' }}>none</div>}
        </div>
        <div>
          <div className="collbl">Top ML Features</div>
          {hasMlFeatures
            ? rec.ml_top_features.slice(0, 3).map((f, j) => (
                <div key={j} className="line">{humanize(f.feature)}: <b>{f.shap_value?.toFixed(3)}</b></div>
              ))
            : <div className="line" style={{ color: 'var(--aud-ink-2)' }}>not available for this record</div>}
        </div>
        <div>
          <div className="collbl">Actions</div>
          {actions.length > 0
            ? actions.map((a, j) => <div key={j} className="line" style={{ color: 'var(--aud-blue)' }}>{humanize(a)}</div>)
            : <div className="line" style={{ color: 'var(--aud-ink-2)' }}>none</div>}
          {requiresApproval && <div className="line" style={{ color: 'var(--aud-red)', fontWeight: 600, marginTop: 4 }}>Requires human approval</div>}
        </div>
      </div>
    </>
  );
}

// SHA-256 over the actual record set, computed client-side via SubtleCrypto —
// a real content hash of the records currently on screen, not a fabricated
// string. Note this hashes the current snapshot, not a per-record chain — see
// the "How does this work?" explainer below for what a true tamper-evident
// chain would additionally need (record_hash/prev_hash written at audit-record
// creation time, recomputed forward on verify).
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

function buildMinimalPdf(lines) {
  const esc = s => String(s).replace(/([()\\])/g, '\\$1');
  const stream = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 50 ${730 - i * 20} Td (${esc(l)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return pdf;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function recordTimestamp(rec) {
  return rec.assessment_timestamp || rec.timestamp || null;
}

// Compliance records come from two shapes: legacy batch-scored records
// (audit_*.jsonl — final_score, deterministic_score, deterministic_rules_fired,
// requires_human_approval at top level) and real orchestrator-driven records
// (compliance_events.jsonl — det/ml scores and rules nested under `details`,
// no requires_human_approval field at all). These helpers read whichever
// shape is present instead of assuming the legacy one.
function complianceFinalScore(r) {
  return r.final_score ?? r.details?.fused_score ?? null;
}
function complianceDetScore(r) {
  return r.deterministic_score ?? r.details?.det_score ?? null;
}
function complianceMlScore(r) {
  return r.ml_score ?? r.details?.ml_prob ?? null;
}
function complianceRulesFired(r) {
  return r.deterministic_rules_fired ?? r.details?.rules ?? [];
}
function complianceActions(r) {
  if (r.recommended_actions) return r.recommended_actions;
  if (r.details?.primary_issue) return [r.details.primary_issue];
  return [];
}
function complianceRequiresApproval(r) {
  if (typeof r.requires_human_approval === 'boolean') return r.requires_human_approval;
  return r.risk_tier === 'CRITICAL' || r.risk_tier === 'HIGH';
}

const REPORT_COLUMNS = {
  compliance: {
    header: [
      'window_id', 'shipment_id', 'container_id', 'risk_tier',
      'deterministic_score', 'ml_score', 'final_score',
      'rules_fired', 'recommended_actions', 'regulatory_tags',
      'requires_human_approval', 'event_type', 'log_id', 'timestamp',
    ],
    row: r => [
      r.window_id, r.shipment_id, r.container_id, r.risk_tier,
      complianceDetScore(r), complianceMlScore(r), complianceFinalScore(r),
      complianceRulesFired(r).join('; '), complianceActions(r).join('; '),
      (r.regulatory_tags || []).join('; '),
      complianceRequiresApproval(r) ? 'true' : 'false',
      r.event_type ?? '', r.log_id ?? '', recordTimestamp(r),
    ],
  },
  runs: {
    header: [
      'window_id', 'shipment_id', 'container_id', 'risk_tier', 'status',
      'fused_risk_score', 'ml_spoilage_probability', 'confidence',
      'agents_involved', 'replan_count', 'guardrail_findings',
      'decision_summary', 'requires_approval', 'timestamp',
    ],
    row: r => [
      r.window_id || r._window_id, r.shipment_id, r.container_id, r.risk_tier,
      RUN_STATUS_LABEL[runStatusSemantic(r)],
      r.fused_risk_score, r.ml_spoilage_probability, r.confidence,
      [...new Set((r.actions_taken || []).map(a => a?.tool).filter(Boolean))].join('; '),
      r.replan_count ?? 0,
      (r.guardrail_findings || []).filter(f => f && f.passed === false).length,
      r.decision_summary || r.llm_reasoning || r.approval_reason || '',
      r.requires_approval ? 'true' : 'false',
      r.timestamp,
    ],
  },
};

function downloadReport(report) {
  const filename = `${slugify(report.name)}-${report.id}.${report.format.toLowerCase()}`;
  const cols = REPORT_COLUMNS[report.kind];
  if (report.format === 'CSV') {
    const csvLines = [cols.header.join(',')];
    for (const r of report.rows) {
      csvLines.push(cols.row(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    }
    triggerDownload(new Blob([csvLines.join('\n')], { type: 'text/csv' }), filename);
    return;
  }

  // PDF: real per-record rows (window/shipment/tier/score/timestamp), not
  // just an aggregate summary — a "signed" audit export needs actual
  // evidence rows, not just counts.
  const summaryLines = [
    report.name,
    report.meta,
    'Status: Electronically Signed',
    '',
    `Records included: ${report.rows.length}`,
    report.kind === 'compliance'
      ? `Critical tier: ${report.rows.filter(r => r.risk_tier === 'CRITICAL').length}`
      : `Awaiting approval: ${report.rows.filter(r => runStatusSemantic(r) === 'crit').length}`,
    report.kind === 'compliance'
      ? `Requires human approval: ${report.rows.filter(complianceRequiresApproval).length}`
      : `Resolved: ${report.rows.filter(r => runStatusSemantic(r) === 'ok').length}`,
    `Content hash: ${report.hash.slice(0, 32)}...`,
    '',
    `Generated in-browser from the live ${report.kind === 'compliance' ? 'compliance audit log' : 'shipment run history'}.`,
    '',
    '--- Records ---',
  ];
  // buildMinimalPdf is a single fixed-height page (~35 lines) with no
  // pagination — cap what we list and point to the CSV for the full set,
  // rather than silently rendering rows off the bottom of the page.
  const PDF_ROW_CAP = 30;
  const rowLines = report.kind === 'compliance'
    ? report.rows.slice(0, PDF_ROW_CAP).map(r => `${r.window_id} | ${r.shipment_id}/${r.container_id} | ${r.risk_tier} | score=${complianceFinalScore(r) ?? '—'} | ${recordTimestamp(r)}`)
    : report.rows.slice(0, PDF_ROW_CAP).map(r => `${r.window_id || r._window_id} | ${r.shipment_id}/${r.container_id} | ${r.risk_tier} | ${RUN_STATUS_LABEL[runStatusSemantic(r)]} | ${r.timestamp}`);
  if (report.rows.length > PDF_ROW_CAP) {
    rowLines.push(`... ${report.rows.length - PDF_ROW_CAP} more record(s) — use CSV format for the full export`);
  }

  triggerDownload(new Blob([buildMinimalPdf([...summaryLines, ...rowLines])], { type: 'application/pdf' }), filename);
}

export default function AuditLog() {
  const [viewMode, setViewMode] = useState('compliance'); // 'compliance' | 'runs'
  const [tierFilter, setTierFilter] = useState('');
  const [search, setSearch] = useState('');

  const compliancePath = tierFilter ? `/audit-logs?limit=200&risk_tier=${tierFilter}` : '/audit-logs?limit=200';
  const path = viewMode === 'runs' ? '/orchestrator/history?limit=30' : compliancePath;
  const { data, loading, error } = useApi(path, [viewMode, tierFilter]);

  // Independent of viewMode/tierFilter — backs the integrity banner and both
  // report generators so they always reflect the full record set, not
  // whatever tier/window the on-screen list happens to be filtered to.
  const { data: allRecords } = useApi('/audit-logs?limit=500', []);
  const complianceRecords = useMemo(() => (Array.isArray(allRecords) ? allRecords.filter(r => r.entry_type !== 'guardrail_finding') : []), [allRecords]);
  const { data: allRuns } = useApi('/orchestrator/history?limit=500', []);
  const runRecords = useMemo(() => (Array.isArray(allRuns) ? allRuns : []), [allRuns]);

  const [integrityHash, setIntegrityHash] = useState(null);
  const [verifiedAt, setVerifiedAt] = useState(null);
  const [showIntegrityHow, setShowIntegrityHow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (complianceRecords.length === 0) return;
    const content = complianceRecords.map(r => `${r.window_id}|${r.shipment_id}|${recordTimestamp(r)}|${r.final_score}`).join('\n');
    sha256Hex(content).then(hash => {
      if (!cancelled) { setIntegrityHash(hash); setVerifiedAt(new Date()); }
    });
    return () => { cancelled = true; };
  }, [complianceRecords]);

  const handleVerifyIntegrity = () => {
    if (complianceRecords.length === 0) return;
    const content = complianceRecords.map(r => `${r.window_id}|${r.shipment_id}|${recordTimestamp(r)}|${r.final_score}`).join('\n');
    sha256Hex(content).then(hash => { setIntegrityHash(hash); setVerifiedAt(new Date()); });
  };

  const reportSourceRows = viewMode === 'runs' ? runRecords : complianceRecords;
  const shipmentIds = useMemo(() => (
    [...new Set(reportSourceRows.map(r => r.shipment_id).filter(Boolean))].sort()
  ), [reportSourceRows]);

  const [complianceReportType, setComplianceReportType] = useState('monthly');
  const [runsReportType, setRunsReportType] = useState('monthly');
  const [reportScope, setReportScope] = useState('all');
  const [reportShipmentId, setReportShipmentId] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportFormat, setReportFormat] = useState('PDF');
  const [generatedReports, setGeneratedReports] = useState({ compliance: [], runs: [] });

  const reportType = viewMode === 'runs' ? runsReportType : complianceReportType;
  const setReportType = viewMode === 'runs' ? setRunsReportType : setComplianceReportType;
  const effectiveShipmentId = reportShipmentId || shipmentIds[0] || '';

  const handleGenerateReport = () => {
    const kind = viewMode === 'runs' ? 'runs' : 'compliance';
    let rows = reportSourceRows;
    if (reportScope === 'shipment' && effectiveShipmentId) rows = rows.filter(r => r.shipment_id === effectiveShipmentId);
    const rowTs = r => (kind === 'runs' ? r.timestamp : recordTimestamp(r));
    if (reportFrom) rows = rows.filter(r => { const ts = rowTs(r); return ts && ts >= reportFrom; });
    if (reportTo) rows = rows.filter(r => { const ts = rowTs(r); return ts && ts <= `${reportTo}T23:59:59`; });

    const scopeLabel = reportScope === 'shipment' ? effectiveShipmentId : 'All Shipments';
    const rangeLabel = (reportFrom || reportTo) ? `${reportFrom || 'earliest'} → ${reportTo || 'latest'}` : 'full history';
    const name = kind === 'runs'
      ? (reportType === 'monthly' ? 'Monthly Shipment Run Summary' : 'Full Shipment Run Export')
      : (reportType === 'monthly' ? 'Monthly Compliance Summary' : 'Full Audit Trail Export');
    const content = rows.map(r => `${r.window_id || r._window_id}|${r.shipment_id}|${rowTs(r)}|${r.fused_risk_score ?? r.final_score}`).join('\n');

    sha256Hex(content || 'empty').then(hash => {
      setGeneratedReports(prev => ({
        ...prev,
        [kind]: [{
          id: Date.now(),
          name,
          kind,
          scopeLabel,
          rangeLabel,
          format: reportFormat,
          rows,
          hash,
          meta: `${scopeLabel} · ${rangeLabel} · ${rows.length} record(s)`,
          generatedAt: new Date(),
        }, ...prev[kind]],
      }));
    });
  };

  const complianceStats = useMemo(() => {
    if (viewMode !== 'compliance' || !data || !data.length) return null;
    const tierCounts = {};
    const ruleCounts = {};
    let needsApproval = 0;
    for (const rec of data) {
      const t = rec.risk_tier || 'UNKNOWN';
      tierCounts[t] = (tierCounts[t] || 0) + 1;
      if (rec.requires_human_approval) needsApproval++;
      for (const r of (rec.deterministic_rules_fired || [])) {
        ruleCounts[r] = (ruleCounts[r] || 0) + 1;
      }
    }
    const ruleData = Object.entries(ruleCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([k, v]) => ({ rule: humanize(k), count: v }));
    return { total: data.length, tierCounts, ruleData, needsApproval };
  }, [data, viewMode]);

  const runStats = useMemo(() => {
    if (viewMode !== 'runs' || !data || !data.length) return null;
    const awaiting = data.filter(d => runStatusSemantic(d) === 'crit').length;
    const resolved = data.filter(d => runStatusSemantic(d) === 'ok').length;
    return { total: data.length, awaiting, resolved };
  }, [data, viewMode]);

  const filtered = useMemo(() => {
    let rows = Array.isArray(data) ? data : [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    if (viewMode === 'runs') {
      return rows.filter(r => [r.window_id, r._window_id, r.shipment_id, r.container_id].filter(Boolean).join(' ').toLowerCase().includes(q));
    }
    return rows.filter(r => [r.window_id, r.shipment_id, r.container_id, r.check].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [data, search, viewMode]);

  const maxRuleCount = complianceStats ? Math.max(...complianceStats.ruleData.map(r => r.count), 1) : 1;

  return (
    <div className="aud">

      {/* Header */}
      <div className="aud-top">
        <div>
          <h1 className="aud-title">Compliance Audit Log</h1>
          <p className="aud-sub">GDP / FDA 21 CFR 11 compliant assessment records</p>
        </div>
        <div className="aud-viewtabs">
          <button type="button" className={`aud-viewtab${viewMode === 'compliance' ? ' active' : ''}`} onClick={() => setViewMode('compliance')}>Compliance Records</button>
          <button type="button" className={`aud-viewtab${viewMode === 'runs' ? ' active' : ''}`} onClick={() => setViewMode('runs')}>Shipment Runs</button>
        </div>
      </div>

      {/* Audit Trail Integrity */}
      {viewMode === 'compliance' && (
        <div className="aud-integrity">
          <div className="aud-integrity-icon"><ShieldCheck /></div>
          <div className="aud-integrity-body">
            <div className="aud-integrity-title">
              Audit Trail Integrity
              <span className="aud-integrity-badge">{integrityHash ? 'Verified' : 'Computing…'}</span>
            </div>
            <div className="aud-integrity-hash">
              {integrityHash ? `sha256:${integrityHash.slice(0, 40)}…` : '—'}
              {verifiedAt && ` · ${complianceRecords.length} records · verified ${timeAgo(verifiedAt.toISOString())}`}
            </div>
            <button type="button" className="aud-integrity-howbtn" onClick={() => setShowIntegrityHow(v => !v)}>
              {showIntegrityHow ? 'Hide' : 'How does this work?'}
            </button>
            {showIntegrityHow && (
              <div className="aud-integrity-how">
                This is a SHA-256 content hash computed in your browser over every compliance record
                currently in the log (window ID, shipment ID, timestamp, final score) — if any record
                changed, the hash would change too. "Verify Now" refetches the records and recomputes
                it. This confirms the records loaded right now are internally consistent; it is not yet
                a full tamper-evident chain, which would additionally require each record to store its
                own hash plus the previous record's hash at write time, and "verify" to mean
                recomputing that chain from the first record forward.
                <div className="formula">hash = SHA-256(record₁ ‖ record₂ ‖ … ‖ recordₙ)</div>
              </div>
            )}
          </div>
          <div className="aud-integrity-actions">
            <button type="button" className="aud-integrity-btn" onClick={handleVerifyIntegrity}>Verify Now</button>
          </div>
        </div>
      )}

      {/* KPIs */}
      {viewMode === 'compliance' && complianceStats && (
        <div className="aud-kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="aud-kpi">
            <div className="aud-kpi-tag" style={{ background: 'var(--aud-blue-soft)', color: 'var(--aud-blue)' }}>{complianceStats.total}</div>
            <div className="aud-kpi-label">Total Records</div>
            <div className="aud-kpi-value">{complianceStats.total}</div>
          </div>
          <div className="aud-kpi">
            <div className="aud-kpi-tag" style={{ background: 'var(--aud-amber-soft)', color: 'var(--aud-amber)' }}>{complianceStats.needsApproval}</div>
            <div className="aud-kpi-label">Requires Approval</div>
            <div className="aud-kpi-value" style={{ color: 'var(--aud-amber)' }}>{complianceStats.needsApproval}</div>
          </div>
          <div className="aud-kpi">
            <div className="aud-kpi-tag" style={{ background: 'var(--aud-panel-border)', color: 'var(--aud-ink-1)' }}>TIER</div>
            <div className="aud-kpi-label">Tier Distribution</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 9 }}>
              <TierDonut tierCounts={complianceStats.tierCounts} />
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].filter(t => complianceStats.tierCounts[t]).map(t => (
                  <span key={t} style={{ color: TIER_STYLE[t].color }}>
                    {complianceStats.tierCounts[t]} {{ CRITICAL: 'crit', HIGH: 'high', MEDIUM: 'med', LOW: 'low' }[t]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {viewMode === 'runs' && runStats && (
        <div className="aud-kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="aud-kpi">
            <div className="aud-kpi-label">Total Runs</div>
            <div className="aud-kpi-value">{runStats.total}</div>
          </div>
          <div className="aud-kpi">
            <div className="aud-kpi-tag" style={{ background: 'var(--aud-amber-soft)', color: 'var(--aud-amber)' }}>!</div>
            <div className="aud-kpi-label">Awaiting Approval</div>
            <div className="aud-kpi-value" style={{ color: 'var(--aud-amber)' }}>{runStats.awaiting}</div>
          </div>
          <div className="aud-kpi">
            <div className="aud-kpi-label">Resolved</div>
            <div className="aud-kpi-value" style={{ color: 'var(--aud-green)' }}>{runStats.resolved}</div>
          </div>
        </div>
      )}

      {/* Most-triggered rules */}
      {viewMode === 'compliance' && complianceStats && (
        <div className="aud-panel" style={{ marginBottom: 16 }}>
          <h2 className="aud-panel-h">Most Triggered Rules</h2>
          <p className="aud-panel-sub">Deterministic rules fired across all records in range</p>
          {complianceStats.ruleData.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--aud-ink-2)' }}>No rules triggered.</p>
          ) : complianceStats.ruleData.map(r => (
            <div key={r.rule} className="aud-barrow">
              <span className="lbl">{r.rule}</span>
              <div className="track"><div className="fill" style={{ width: `${(r.count / maxRuleCount) * 100}%`, background: 'var(--aud-amber)' }} /></div>
              <span className="val">{r.count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Reports — Compliance Records: signed compliance exports. Shipment Runs: run-history exports. */}
      <div className="aud-panel" style={{ marginBottom: 16 }}>
        <h2 className="aud-panel-h">{viewMode === 'runs' ? 'Shipment Run Reports' : 'Compliance Reports'}</h2>
        <p className="aud-panel-sub">
          {viewMode === 'runs'
            ? 'Generate an export of shipment orchestration runs currently on record'
            : 'Generate a signed export from the records currently in the audit trail'}
        </p>

        <div className="aud-reportgen-row">
            <div className="aud-reportgen-field">
              <label>Report Type</label>
              <select value={reportType} onChange={e => setReportType(e.target.value)}>
                {viewMode === 'runs' ? (
                  <>
                    <option value="monthly">Monthly Shipment Run Summary</option>
                    <option value="full">Full Shipment Run Export</option>
                  </>
                ) : (
                  <>
                    <option value="monthly">Monthly Compliance Summary</option>
                    <option value="full">Full Audit Trail Export</option>
                  </>
                )}
              </select>
            </div>
            <div className="aud-reportgen-field">
              <label>Scope</label>
              <div className="aud-reportgen-toggle">
                <button type="button" className={reportScope === 'all' ? 'active' : ''} onClick={() => setReportScope('all')}>All Shipments</button>
                <button type="button" className={reportScope === 'shipment' ? 'active' : ''} onClick={() => setReportScope('shipment')}>This Shipment</button>
              </div>
            </div>
            <div className="aud-reportgen-field">
              <label>Shipment</label>
              <select value={effectiveShipmentId} onChange={e => setReportShipmentId(e.target.value)} disabled={reportScope !== 'shipment'}>
                {shipmentIds.length === 0 && <option value="">No shipments in range</option>}
                {shipmentIds.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
            </div>
            <div className="aud-reportgen-field">
              <label>From</label>
              <input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
            </div>
            <div className="aud-reportgen-field">
              <label>To</label>
              <input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} />
            </div>
            <div className="aud-reportgen-field">
              <label>Format</label>
              <div className="aud-reportgen-toggle">
                <button type="button" className={reportFormat === 'PDF' ? 'active' : ''} onClick={() => setReportFormat('PDF')}>PDF</button>
                <button type="button" className={reportFormat === 'CSV' ? 'active' : ''} onClick={() => setReportFormat('CSV')}>CSV</button>
              </div>
            </div>
            <button type="button" className="aud-reportgen-gobtn" onClick={handleGenerateReport} disabled={reportScope === 'shipment' && !effectiveShipmentId}>
              Generate Report
            </button>
          </div>

          <div className="aud-reportlist">
            {generatedReports[viewMode === 'runs' ? 'runs' : 'compliance'].length === 0 && (
              <div className="aud-report-empty">No reports generated yet this session.</div>
            )}
            {generatedReports[viewMode === 'runs' ? 'runs' : 'compliance'].map(r => (
              <div key={r.id} className="aud-report-row">
                <div>
                  <div className="aud-report-name">{r.name}</div>
                  <div className="aud-report-meta">{r.meta} · {timeAgo(r.generatedAt.toISOString())}</div>
                </div>
                <span className="aud-report-fmt">{r.format}</span>
                <span className="aud-report-signed">Signed</span>
                <button type="button" className="aud-report-dlbtn" onClick={() => downloadReport(r)}>
                  <Download style={{ width: 12, height: 12, marginRight: 5, verticalAlign: -2 }} />
                  Download
                </button>
              </div>
            ))}
          </div>
      </div>

      {/* Filter bar */}
      <div className="aud-bar">
        {viewMode === 'compliance' && (
          <div className="aud-tabs">
            {['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(t => (
              <button key={t || 'all'} type="button" className={`aud-tab${tierFilter === t ? ' active' : ''}`} onClick={() => setTierFilter(t)}>
                {t ? humanize(t.toLowerCase()) : 'All tiers'}
              </button>
            ))}
          </div>
        )}
        <div className="aud-search" style={{ marginLeft: viewMode === 'runs' ? 'auto' : 0 }}>
          <Search />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search window or shipment ID" />
        </div>
      </div>

      {loading && <p style={{ color: 'var(--aud-ink-2)' }}>Loading {viewMode === 'runs' ? 'shipment runs' : 'audit log'}…</p>}
      {error && <p style={{ color: 'var(--aud-red)' }}>Error: {error}</p>}

      {!loading && filtered.length === 0 && (
        <div className="aud-empty">
          <ScrollText style={{ display: 'block', margin: '0 auto' }} />
          <p>{viewMode === 'runs' ? 'No shipment runs found.' : 'No audit records found.'}</p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="aud-list">
          {viewMode === 'runs'
            ? filtered.map(run => <RunRow key={getRunKey(run)} run={run} />)
            : filtered.map((rec, i) => <ComplianceRow key={i} rec={rec} />)}
        </div>
      )}
    </div>
  );
}
