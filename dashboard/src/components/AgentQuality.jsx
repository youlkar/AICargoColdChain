import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { ShieldAlert, ShieldCheck, DollarSign, Clock, Activity, FlaskConical } from 'lucide-react';
import StatCard from './shared/StatCard';

const RANGE_OPTIONS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
];

export default function AgentQuality() {
  const [hours, setHours] = useState(24);
  const { data, loading, error } = useApi(`/agent-quality/overview?hours=${hours}`, [hours]);

  if (loading) return <div className="p-6 text-sm text-[var(--text-secondary-2)]">Loading agent quality metrics…</div>;
  if (error) return <div className="p-6 text-sm text-red-400">Failed to load agent quality metrics.</div>;

  const d = data || {};
  const severities = d.severity_counts || { warning: 0, critical: 0 };
  const topChecks = d.top_checks || [];
  const avgNodeLatencies = d.avg_node_latencies || {};
  const nodeLatency = Object.entries(avgNodeLatencies).map(([node, ms]) => ({ node, ms: Math.round(ms) }));
  const evalRuns = d.recent_eval_runs || [];
  const latestEval = evalRuns[0];
  const passRateTrend = [...evalRuns].reverse().map((r, i) => ({
    run: i + 1, pass_rate: Math.round((r.pass_rate || 0) * 100),
  }));

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

      {/* Guardrail health */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Runs" value={d.total_runs ?? 0} accent="cyan" />
        <StatCard icon={ShieldAlert} label="Critical Findings" value={severities.critical ?? 0} accent="red" />
        <StatCard icon={ShieldCheck} label="Warning Findings" value={severities.warning ?? 0} accent="amber" />
        <StatCard icon={ShieldAlert} label="Guardrail-Escalated Runs"
          value={`${Math.round((d.guardrail_escalation_rate ?? 0) * 100)}%`} accent="emerald" />
      </div>

      {/* Cost & latency */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard icon={DollarSign} label={`Total Cost (${hours}h)`} value={`$${(d.total_cost_usd ?? 0).toFixed(4)}`} accent="emerald" />
        <StatCard icon={Clock} label="Total Tokens" value={(d.total_tokens ?? 0).toLocaleString()} accent="cyan" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4">
          <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-3">
            Most-Triggered Guardrail Checks
          </p>
          {topChecks.length === 0 ? (
            <p className="text-xs text-[var(--text-secondary-2)]">No findings in this window.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={topChecks} layout="vertical" margin={{ left: 24 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="check" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent-amber)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="panel p-4">
          <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider mb-3">
            Per-Node Latency (avg ms)
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

      {/* Eval trend */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-violet-400" />
          <p className="text-xs font-semibold font-heading text-[var(--text-secondary-2)] uppercase tracking-wider">
            Eval Trend
          </p>
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
