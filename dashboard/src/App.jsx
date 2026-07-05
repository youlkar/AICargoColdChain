import { Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getApi } from './hooks/useApi';
import { useApi } from './hooks/useApi';
import {
  LayoutDashboard, Ship, ScrollText, CheckCircle, Activity,
  Bot, ShieldAlert, Brain, Wifi, WifiOff, FlaskConical,
} from 'lucide-react';
import Overview from './components/Overview';
import ShipmentList from './components/ShipmentList';
import ShipmentDetail from './components/ShipmentDetail';
import AuditLog from './components/AuditLog';
import Approvals from './components/Approvals';
import Monitoring from './components/Monitoring';
import AgentActivity from './components/AgentActivity';
import AgentRunDetail from './components/AgentRunDetail';
import AgentQuality from './components/AgentQuality';
import TopBar from './components/TopBar';
import ThemeToggleButton from './components/ThemeToggleButton';
import { OrchestrationStreamProvider } from './lib/OrchestrationStreamContext';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/shipments', icon: Ship, label: 'Shipments' },
  { to: '/agent', icon: Bot, label: 'Agent Activity' },
  { to: '/agent-quality', icon: FlaskConical, label: 'Agent Quality' },
  { to: '/audit', icon: ScrollText, label: 'Audit Log' },
  { to: '/approvals', icon: CheckCircle, label: 'Approvals', badgeKey: 'approvals' },
];

function LLMBadge() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const load = () => getApi('/llm/status').then(setStatus).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (!status) return null;
  const active = status.active_provider;
  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        {active ? (
          <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[11px] text-emerald-400 font-medium">LLM Online</span></>
        ) : (
          <><WifiOff className="w-3.5 h-3.5 text-slate-500" /><span className="text-[11px] text-slate-500">LLM Offline</span></>
        )}
      </div>
      {active && (
        <div className="flex items-center gap-1.5">
          <Brain className="w-3 h-3 text-violet-400" />
          <span className="text-[10px] text-violet-300 font-mono truncate">
            {status.active_model || active}
          </span>
        </div>
      )}
      <div className="text-[10px] text-slate-500">
        Mode: <span className="text-cyan-400 font-medium">{active ? 'Agentic' : 'Deterministic'}</span>
      </div>
    </div>
  );
}

function Sidebar() {
  const { data: pending } = useApi('/approvals/pending');
  const pendingCount = Array.isArray(pending) ? pending.length : 0;

  return (
    <aside className="w-60 flex flex-col min-h-screen shrink-0 bg-[var(--card-bg)] border-r border-[var(--card-border)]">
      <div className="px-5 py-5 border-b border-[var(--card-border)]">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent-cyan)' }}>
            <ShieldAlert className="w-4.5 h-4.5" style={{ color: 'var(--card-bg)' }} />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight font-heading text-[var(--text-primary)]">AI Cargo</span>
            <p className="text-[10px] text-[var(--text-secondary-2)] leading-tight">Cold-Chain Intelligence</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV.map(({ to, icon: Icon, label, badgeKey }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {({ isActive }) => (
              <span
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-heading transition-all duration-200
                ${isActive ? 'bg-cyan-500/10 font-medium' : 'text-[var(--text-secondary-2)] hover:bg-white/[0.04] hover:text-[var(--text-primary)]'}`}
                style={isActive ? { color: 'var(--accent-cyan)' } : undefined}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
                {badgeKey === 'approvals' && pendingCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-bold font-data"
                    style={{ backgroundColor: 'var(--accent-red)', color: '#fff' }}>
                    {pendingCount}
                  </span>
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-2">
        <ThemeToggleButton />
      </div>

      <div className="border-t border-[var(--card-border)]">
        <LLMBadge />
        <div className="px-4 pb-4 text-[10px] text-[var(--text-secondary-2)] space-y-0.5">
          <p>GDP / FDA 21 CFR 11 Compliant</p>
          <p>LangGraph + XGBoost + SHAP + RAG</p>
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)] font-heading">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen">
        <TopBar />
        <main className="flex-1 overflow-auto scrollbar-thin">
          <OrchestrationStreamProvider>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/monitoring" element={<Monitoring />} />
              <Route path="/shipments" element={<ShipmentList />} />
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/agent" element={<AgentActivity />} />
              <Route path="/agent/runs/:runKey" element={<AgentRunDetail />} />
              <Route path="/agent-quality" element={<AgentQuality />} />
              <Route path="/audit" element={<AuditLog />} />
              <Route path="/approvals" element={<Approvals />} />
            </Routes>
          </OrchestrationStreamProvider>
        </main>
      </div>
    </div>
  );
}
