import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ShieldAlert, ShieldCheck, DollarSign, Clock, Activity, FlaskConical,
  AlertTriangle, Inbox, CheckCircle2,
} from 'lucide-react';
import StatCard from './shared/StatCard';
import { humanize } from '../lib/toolResults';

const RANGE_OPTIONS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

export default function AgentQuality() {
  const [hours, setHours] = useState(24);
  const { data, loading, error } = useApi(`/agent-quality/overview?hours=${hours}`, [hours]);
  const rangeLabel = RANGE_OPTIONS.find(o => o.hours === hours)?.label || `${hours}h`;

  if (loading) return <div className="p-6 text-sm text-[var(--text-secondary-2)]">Loading agent quality metrics…</div>;
  if (error) return <div className="p-6 text-sm text-red-400">Failed to load agent quality metrics.</div>;

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold font-heading text-[var(--text-primary)]">Agent Quality</h1>
        <div className="flex gap-2">
          {RANGE_OPTIONS.map(opt => (
            <button key={opt.hours} onClick={() => setHours(opt.hours)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-heading border transition ${
                hours === opt.hours
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  : 'border-[var(--card-border)] text-[var(--text-secondary-2)] hover:text-[var(--text-primary)]'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {(severities.critical ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-xl px-4 py-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-red) 8%, transparent)',
            border: '1px solid color-mix(in srgb, var(--accent-red) 30%, transparent)',
          }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-red)' }} />
          <p className="text-sm text-[var(--text-primary)]">
            <span className="font-semibold">{severities.critical} critical guardrail finding{severities.critical === 1 ? '' : 's'}</span> in the last {rangeLabel}.{' '}
            <a href="#guardrail-checks" className="text-[var(--accent-cyan)] hover:underline">Jump to findings ↓</a>
          </p>
        </div>
      )}

      {noDataInWindow ? (
        <div className="panel p-10 flex flex-col items-center text-center gap-2">
          <Inbox className="w-7 h-7" style={{ color: 'var(--text-secondary-2)' }} />
          <p className="text-sm text-[var(--text-primary)]">No agent runs recorded in the last {rangeLabel}</p>
          <p className="text-xs text-[var(--text-secondary-2)]">Try the 7d range, or check back after the next orchestration cycle.</p>
        </div>
      ) : (
        <>
          {healthyZero && (
            <div className="panel p-6 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 shrink-0" style={{ color: 'var(--accent-emerald)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--accent-emerald)' }}>{d.total_runs} runs, 0 critical findings</p>
                <p className="text-xs text-[var(--text-secondary-2)]">All guardrail checks passed in this window.</p>
              </div>
            </div>
          )}

          {/* Guardrail health */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={Activity} label="Runs" value={d.total_runs ?? 0} accent="cyan" />
            <StatCard icon={AlertTriangle} label="Critical findings" value={severities.critical ?? 0} accent="red" />
            <StatCard icon={ShieldAlert} label="Warning findings" value={severities.warning ?? 0} accent="amber" />
            <StatCard icon={ShieldCheck} label="Guardrail escalated"
              value={`${Math.round((d.guardrail_escalation_rate ?? 0) * 100)}%`} accent="amber" />
          </div>

          {/* Cost & latency — secondary/FYI, slimmer treatment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="panel px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary-2)] flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" /> Total cost ({rangeLabel})
              </span>
              <span className="text-sm font-semibold font-data text-[var(--text-primary)]">${(d.total_cost_usd ?? 0).toFixed(4)}</span>
            </div>
            <div className="panel px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary-2)] flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" /> Total tokens
              </span>
              <span className="text-sm font-semibold font-data text-[var(--text-primary)]">{(d.total_tokens ?? 0).toLocaleString()}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div id="guardrail-checks" className="panel p-4">
              <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] mb-3">
                Most-triggered guardrail checks
              </p>
              {topChecks.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary-2)]">No findings in this window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={topChecks} layout="vertical" margin={{ left: 24 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={140} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="var(--accent-amber)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="panel p-4">
              <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] mb-3">
                Per-node latency (avg ms)
              </p>
              {nodeLatency.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary-2)]">No latency data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={nodeLatency}>
                    <XAxis dataKey="node" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="ms" fill="var(--accent-cyan)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </>
      )}

      {/* Eval trend */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-violet-400" />
          <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)]">
            Eval trend
          </p>
          <span className="text-[10px] text-[var(--text-secondary-2)] ml-auto">
            Last 10 saved eval runs — independent of the {rangeLabel} toggle above
          </span>
        </div>
        {!latestEval ? (
          <p className="text-xs text-[var(--text-secondary-2)]">No eval runs yet — run <code>python -m evals.run_evals --save</code>.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              <div><p className="text-[var(--text-secondary-2)]">Pass rate</p><p className="font-data text-lg font-bold">{Math.round((latestEval.pass_rate || 0) * 100)}%</p></div>
              <div><p className="text-[var(--text-secondary-2)]">Tier accuracy</p><p className="font-data text-lg font-bold">{Math.round((latestEval.tier_accuracy || 0) * 100)}%</p></div>
              <div><p className="text-[var(--text-secondary-2)]">Action precision</p><p className="font-data text-lg font-bold">{Math.round((latestEval.action_precision || 0) * 100)}%</p></div>
              <div><p className="text-[var(--text-secondary-2)]">Action recall</p><p className="font-data text-lg font-bold">{Math.round((latestEval.action_recall || 0) * 100)}%</p></div>
              <div><p className="text-[var(--text-secondary-2)]">Avg judge score</p><p className="font-data text-lg font-bold">{latestEval.avg_judge_score != null ? latestEval.avg_judge_score.toFixed(2) : '—'}</p></div>
            </div>
            {passRateTrend.length > 1 && (
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={passRateTrend}>
                  <XAxis dataKey="run" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="pass_rate" stroke="var(--accent-emerald)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>
    </div>
  );
}
