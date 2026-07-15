import { Routes, Route, NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { getApi } from './hooks/useApi';
import { useApi } from './hooks/useApi';
import {
  LayoutDashboard, Ship, ScrollText, CheckCircle, Activity,
  Bot, ShieldAlert, Brain, Wifi, WifiOff, FlaskConical,
  ChevronLeft, Sun, Moon,
} from 'lucide-react';
import { useTheme } from './lib/ThemeContext';
import OverviewV2 from './components/OverviewV2';
import ShipmentList from './components/ShipmentList';
import ShipmentDetail from './components/ShipmentDetail';
import AuditLog from './components/AuditLog';
import Approvals from './components/Approvals';
import Monitoring from './components/Monitoring';
import AgentActivity from './components/AgentActivity';
import AgentRunDetail from './components/AgentRunDetail';
import AgentActivityV2 from './components/AgentActivityV2';
import AgentRunDetailV2 from './components/AgentRunDetailV2';
import AgentQuality from './components/AgentQuality';
import TopBar from './components/TopBar';
import { OrchestrationStreamProvider } from './lib/OrchestrationStreamContext';
import './components/sidebar-v2.css';

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/monitoring', icon: Activity, label: 'Monitoring' },
  { to: '/shipments', icon: Ship, label: 'Shipments' },
  { to: '/agent-v2', icon: Bot, label: 'Agent Activity' },
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
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar-collapsed') === '1';
  });

  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <aside className={`sidebar-v2${collapsed ? ' collapsed' : ''}`}>
      <div className="sb-top">
        <div className="sb-brandmark"><ShieldAlert style={{ width: 16, height: 16 }} /></div>
        <span className="sb-brand-text">AI Cargo</span>
        <button type="button" className="sb-collapse-btn" onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <ChevronLeft style={{ width: 14, height: 14 }} />
        </button>
      </div>

      <nav className="sb-nav">
        <p className="sb-section-lbl">Main</p>
        {NAV.map(({ to, icon: Icon, label, badgeKey }) => (
          <NavLink key={to} to={to} end={to === '/'} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <span className={`sb-item${isActive ? ' active' : ''}`}>
                <Icon />
                <span>{label}</span>
                {badgeKey === 'approvals' && pendingCount > 0 && (
                  <span className="sb-badge">{pendingCount}</span>
                )}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="sb-bottom">
        <div className="sb-themetoggle">
          <button type="button" className={theme === 'light' ? 'active' : ''} title="Light mode"
            onClick={() => theme !== 'light' && toggleTheme()}>
            <Sun style={{ width: 15, height: 15 }} />
          </button>
          <button type="button" className={theme === 'dark' ? 'active' : ''} title="Dark mode"
            onClick={() => theme !== 'dark' && toggleTheme()}>
            <Moon style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div className="sb-llmbadge"><LLMBadge /></div>
        <p className="sb-footer-text">GDP / FDA 21 CFR 11 Compliant<br />LangGraph + XGBoost + SHAP + RAG</p>
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
              <Route path="/" element={<OverviewV2 />} />
              <Route path="/monitoring" element={<Monitoring />} />
              <Route path="/shipments" element={<ShipmentList />} />
              <Route path="/shipments/:id" element={<ShipmentDetail />} />
              <Route path="/agent" element={<AgentActivity />} />
              <Route path="/agent/runs/:runKey" element={<AgentRunDetail />} />
              <Route path="/agent-v2" element={<AgentActivityV2 />} />
              <Route path="/agent-v2/runs/:runKey" element={<AgentRunDetailV2 />} />
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
