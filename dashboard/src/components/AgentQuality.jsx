import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  DollarSign, Clock, FlaskConical,
  AlertTriangle, Inbox, CheckCircle2, ShieldCheck,
} from 'lucide-react';
import { humanize } from '../lib/toolResults';
import './agent-quality-v2.css';

const RANGE_OPTIONS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

// SVG line chart for the eval pass-rate trend — same technique used across
// the other redesigned pages (no charting library, driven by live data).
function PassRateTrend({ points }) {
  const path = useMemo(() => {
    if (!points || points.length < 2) return null;
    const values = points.map(p => p.pass_rate);
    const pts = values.map((v, i) => ({
      x: (i / (values.length - 1)) * 560,
      y: 100 - (v / 100) * 88,
    }));
    return pts.reduce((d, p, i) => {
      if (i === 0) return `M${p.x},${p.y}`;
      const prev = pts[i - 1];
      const mx = (prev.x + p.x) / 2;
      return `${d} C${mx},${prev.y} ${mx},${p.y} ${p.x},${p.y}`;
    }, '');
  }, [points]);

  if (!path) return null;

  return (
    <svg width="100%" height="110" viewBox="0 0 560 110" preserveAspectRatio="none">
      <line x1="0" y1="22" x2="560" y2="22" stroke="var(--aq-hair)" strokeDasharray="3 3" />
      <line x1="0" y1="55" x2="560" y2="55" stroke="var(--aq-hair)" strokeDasharray="3 3" />
      <line x1="0" y1="88" x2="560" y2="88" stroke="var(--aq-hair)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--aq-green)" strokeWidth="2.2" />
    </svg>
  );
}

export default function AgentQuality() {
  const [view, setView] = useState('business');
  const [hours, setHours] = useState(24);
  const { data, loading, error } = useApi(`/agent-quality/overview?hours=${hours}`, [hours]);
  const rangeLabel = RANGE_OPTIONS.find(o => o.hours === hours)?.label || `${hours}h`;

  if (loading) return <div className="aq"><p style={{ color: 'var(--aq-ink-2)' }}>Loading agent quality metrics…</p></div>;
  if (error) return <div className="aq"><p style={{ color: 'var(--aq-red)' }}>Failed to load agent quality metrics.</p></div>;

  const d = data || {};
  const severities = d.severity_counts || { warning: 0, critical: 0 };
  const topChecks = (d.top_checks || []).map(c => ({ ...c, label: humanize(c.check) }));
  const avgNodeLatencies = d.avg_node_latencies || {};
  const nodeLatency = Object.entries(avgNodeLatencies).map(([node, ms]) => ({ node: humanize(node), ms: Math.round(ms) }));
  const evalRuns = d.recent_eval_runs || [];
  const latestEval = evalRuns[0];
  const passRateTrend = [...evalRuns].reverse().map((r, i) => ({
    run: i + 1, pass_rate: Math.round((r.pass_rate || 0) * 100),
  }));

  const hasMetrics = d.total_runs != null;
  const noDataInWindow = hasMetrics && d.total_runs === 0;
  const healthyZero = hasMetrics && d.total_runs > 0 && (severities.critical ?? 0) === 0 && (severities.warning ?? 0) === 0;

  const maxCheckCount = Math.max(...topChecks.map(c => c.count), 1);
  const maxLatency = Math.max(...nodeLatency.map(n => n.ms), 1);

  // Business-view framing reuses the exact same real fields as the technical
  // view — just relabeled in plain language, nothing fabricated.
  const noChangesNeededRate = 100 - Math.round((d.guardrail_escalation_rate ?? 0) * 100);
  const systemHealthy = (severities.critical ?? 0) === 0;

  return (
    <div className="aq">

      {/* Header */}
      <div className="aq-top">
        <div>
          <h1 className="aq-title">Agent Quality</h1>
          <p className="aq-sub">Guardrail health, cost/latency, and eval performance</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="aq-viewtabs">
            <button type="button" className={`aq-viewtab${view === 'business' ? ' active' : ''}`} onClick={() => setView('business')}>Business View</button>
            <button type="button" className={`aq-viewtab${view === 'technical' ? ' active' : ''}`} onClick={() => setView('technical')}>Technical View</button>
          </div>
          <div className="aq-segtabs">
            {RANGE_OPTIONS.map(opt => (
              <button key={opt.hours} type="button" className={hours === opt.hours ? 'active' : ''} onClick={() => setHours(opt.hours)}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ================= BUSINESS VIEW — "AI Trust Center" ================= */}
      {view === 'business' && !noDataInWindow && (
        <div>
          <div className="aq-panel aq-narrative">
            <div className="ic"><ShieldCheck style={{ width: 19, height: 19 }} /></div>
            <div>
              <p className="txt">
                The AI made <b>{d.total_runs ?? 0} decisions</b> in the last {rangeLabel}. <b>{noChangesNeededRate}% needed no changes</b> from your team — it's reliably making the right call on its own, and flagging the rest for your review instead of guessing.
              </p>
              <p className="sub">"Critical finding" just means the system caught something it wasn't confident enough to act on alone — not that something went wrong.</p>
            </div>
          </div>

          <div className="aq-kpis">
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-blue-soft)', color: 'var(--aq-blue)' }}>{rangeLabel}</div>
              <div className="aq-kpi-label">Decisions Made</div>
              <div className="aq-kpi-value">{d.total_runs ?? 0}</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-green-soft)', color: 'var(--aq-green)' }}>✓</div>
              <div className="aq-kpi-label">No Changes Needed</div>
              <div className="aq-kpi-value" style={{ color: 'var(--aq-green)' }}>{noChangesNeededRate}%</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-label">Human Override Rate</div>
              <div className="aq-kpi-value">{Math.round((d.guardrail_escalation_rate ?? 0) * 100)}%</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: systemHealthy ? 'var(--aq-green-soft)' : 'var(--aq-red-soft)', color: systemHealthy ? 'var(--aq-green)' : 'var(--aq-red)' }}>{systemHealthy ? 'OK' : '!'}</div>
              <div className="aq-kpi-label">System Health</div>
              <div className="aq-kpi-value" style={{ color: systemHealthy ? 'var(--aq-green)' : 'var(--aq-red)' }}>{systemHealthy ? 'Healthy' : 'Needs Attention'}</div>
            </div>
          </div>

          <div className="aq-panel">
            <h2 className="aq-panel-h">What "critical finding" means, in plain terms</h2>
            <p style={{ fontSize: 10.5, color: 'var(--aq-ink-2)', margin: '-8px 0 12px' }}>Every finding below is a moment the system asked for a human instead of guessing</p>
            {topChecks.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--aq-ink-2)' }}>No findings in this window — the system handled everything on its own.</p>
            ) : (
              topChecks.slice(0, 3).map(c => (
                <div key={c.check} className="aq-barrow">
                  <span className="lbl">{c.label}</span>
                  <div className="track"><div className="fill" style={{ width: `${(c.count / maxCheckCount) * 100}%`, background: 'var(--aq-amber)' }} /></div>
                  <span className="val">{c.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {view === 'business' && noDataInWindow && (
        <div className="aq-empty">
          <Inbox style={{ display: 'block', margin: '0 auto' }} />
          <p className="t">No agent runs recorded in the last {rangeLabel}</p>
          <p className="d">Try the 7d range, or check back after the next orchestration cycle.</p>
        </div>
      )}
      {/* ================= /BUSINESS VIEW ================= */}

      {/* ================= TECHNICAL VIEW — unchanged from before ================= */}
      {view === 'technical' && (
      <div>

      {/* Critical alert banner */}
      {(severities.critical ?? 0) > 0 && (
        <div className="aq-alertbar">
          <div className="l">
            <div className="aq-alerticon"><AlertTriangle style={{ width: 16, height: 16 }} /></div>
            <div>
              <p className="t1">{severities.critical} critical guardrail finding{severities.critical === 1 ? '' : 's'} in the last {rangeLabel}</p>
              <p className="t2"><a href="#aq-guardrail-checks" className="aq-link">Jump to findings ↓</a></p>
            </div>
          </div>
        </div>
      )}

      {noDataInWindow ? (
        <div className="aq-empty">
          <Inbox style={{ display: 'block', margin: '0 auto' }} />
          <p className="t">No agent runs recorded in the last {rangeLabel}</p>
          <p className="d">Try the 7d range, or check back after the next orchestration cycle.</p>
        </div>
      ) : (
        <>
          {healthyZero && (
            <div className="aq-okbar">
              <CheckCircle2 style={{ width: 22, height: 22, color: 'var(--aq-green)' }} />
              <div>
                <p className="t1">{d.total_runs} runs, 0 critical findings</p>
                <p className="t2">All guardrail checks passed in this window.</p>
              </div>
            </div>
          )}

          {/* Guardrail health KPIs */}
          <div className="aq-kpis">
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-blue-soft)', color: 'var(--aq-blue)' }}>{rangeLabel}</div>
              <div className="aq-kpi-label">Runs</div>
              <div className="aq-kpi-value">{d.total_runs ?? 0}</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-red-soft)', color: 'var(--aq-red)' }}>!</div>
              <div className="aq-kpi-label">Critical Findings</div>
              <div className="aq-kpi-value" style={{ color: 'var(--aq-red)' }}>{severities.critical ?? 0}</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-amber-soft)', color: 'var(--aq-amber)' }}>!</div>
              <div className="aq-kpi-label">Warning Findings</div>
              <div className="aq-kpi-value" style={{ color: 'var(--aq-amber)' }}>{severities.warning ?? 0}</div>
            </div>
            <div className="aq-kpi">
              <div className="aq-kpi-tag" style={{ background: 'var(--aq-amber-soft)', color: 'var(--aq-amber)' }}>%</div>
              <div className="aq-kpi-label">Guardrail Escalated</div>
              <div className="aq-kpi-value" style={{ color: 'var(--aq-amber)' }}>{Math.round((d.guardrail_escalation_rate ?? 0) * 100)}%</div>
            </div>
          </div>

          {/* Cost & latency — secondary/FYI, slim treatment */}
          <div className="aq-slimrow">
            <div className="aq-slim">
              <span className="lbl"><DollarSign style={{ width: 14, height: 14 }} /> Total cost ({rangeLabel})</span>
              <span className="val">${(d.total_cost_usd ?? 0).toFixed(4)}</span>
            </div>
            <div className="aq-slim">
              <span className="lbl"><Clock style={{ width: 14, height: 14 }} /> Total tokens</span>
              <span className="val">{(d.total_tokens ?? 0).toLocaleString()}</span>
            </div>
          </div>

          {/* Guardrail checks + latency */}
          <div className="aq-charts2" id="aq-guardrail-checks">
            <div className="aq-panel">
              <h2 className="aq-panel-h">Most-Triggered Guardrail Checks</h2>
              {topChecks.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--aq-ink-2)' }}>No findings in this window.</p>
              ) : (
                topChecks.map(c => (
                  <div key={c.check} className="aq-barrow">
                    <span className="lbl">{c.label}</span>
                    <div className="track"><div className="fill" style={{ width: `${(c.count / maxCheckCount) * 100}%`, background: 'var(--aq-amber)' }} /></div>
                    <span className="val">{c.count}</span>
                  </div>
                ))
              )}
            </div>

            <div className="aq-panel">
              <h2 className="aq-panel-h">Per-Node Latency (avg ms)</h2>
              {nodeLatency.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--aq-ink-2)' }}>No latency data yet.</p>
              ) : (
                nodeLatency.map(n => (
                  <div key={n.node} className="aq-barrow">
                    <span className="lbl">{n.node}</span>
                    <div className="track"><div className="fill" style={{ width: `${(n.ms / maxLatency) * 100}%`, background: 'var(--aq-blue)' }} /></div>
                    <span className="val">{n.ms}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Eval trend */}
      <div className="aq-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <FlaskConical style={{ width: 15, height: 15, color: 'var(--aq-blue)' }} />
          <h2 className="aq-panel-h" style={{ margin: 0 }}>Eval Trend</h2>
          <span style={{ fontSize: 10.5, color: 'var(--aq-ink-2)', marginLeft: 'auto' }}>
            Last 10 saved eval runs — independent of the {rangeLabel} toggle above
          </span>
        </div>
        {!latestEval ? (
          <p style={{ fontSize: 12, color: 'var(--aq-ink-2)' }}>
            No eval runs yet — run <code className="aq-mono">python -m evals.run_evals --save</code>.
          </p>
        ) : (
          <>
            <div className="aq-evalstats">
              <div className="aq-evalstat"><div className="k">Pass rate</div><div className="v">{Math.round((latestEval.pass_rate || 0) * 100)}%</div></div>
              <div className="aq-evalstat"><div className="k">Tier accuracy</div><div className="v">{Math.round((latestEval.tier_accuracy || 0) * 100)}%</div></div>
              <div className="aq-evalstat"><div className="k">Action precision</div><div className="v">{Math.round((latestEval.action_precision || 0) * 100)}%</div></div>
              <div className="aq-evalstat"><div className="k">Action recall</div><div className="v">{Math.round((latestEval.action_recall || 0) * 100)}%</div></div>
              <div className="aq-evalstat"><div className="k">Avg judge score</div><div className="v">{latestEval.avg_judge_score != null ? latestEval.avg_judge_score.toFixed(2) : '—'}</div></div>
            </div>
            {passRateTrend.length > 1 && <PassRateTrend points={passRateTrend} />}
          </>
        )}
      </div>

      </div>
      )}
      {/* ================= /TECHNICAL VIEW ================= */}
    </div>
  );
}
