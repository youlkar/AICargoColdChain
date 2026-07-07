// dashboard/src/components/TopBar.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Sun, Moon, User, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { useTheme } from '../lib/ThemeContext';
import CommandPalette from './CommandPalette';
import TierBadge from './TierBadge';

function LiveIndicator() {
  const { connected } = useWebSocket([]);
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs" style={{ background: connected ? 'color-mix(in oklab, var(--accent-emerald) 10%, transparent)' : undefined, border: connected ? '1px solid color-mix(in oklab, var(--accent-emerald) 25%, transparent)' : '1px solid var(--card-border)' }}>
      {connected
        ? <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-emerald)', flexShrink: 0 }} />
        : <WifiOff className="w-3.5 h-3.5 text-[var(--text-secondary-2)]" />}
      <span className="font-heading font-medium" style={{ color: connected ? 'var(--accent-emerald)' : 'var(--text-secondary-2)' }}>
        {connected ? 'Live' : 'Offline'}
      </span>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data } = useApi('/risk/overview');
  const alerts = (data?.top_risky_shipments || [])
    .filter(s => s.latest_risk_tier === 'CRITICAL' || s.latest_risk_tier === 'HIGH')
    .slice(0, 5);

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="relative p-2 rounded-lg hover:bg-white/[0.06] transition">
        <Bell className="w-4 h-4 text-[var(--text-secondary-2)]" />
        {alerts.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[10px] font-bold font-data flex items-center justify-center"
            style={{ backgroundColor: 'var(--accent-red)', color: '#fff' }}>
            {alerts.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 panel overflow-hidden z-40" onMouseLeave={() => setOpen(false)}>
          <div className="px-4 py-2.5 border-b border-[var(--card-border)]">
            <p className="text-xs font-semibold font-heading text-[var(--text-primary)]">Recent Critical Alerts</p>
          </div>
          {alerts.length === 0 ? (
            <p className="px-4 py-4 text-xs text-[var(--text-secondary-2)]">No critical alerts right now.</p>
          ) : (
            <div className="max-h-72 overflow-y-auto scrollbar-thin">
              {alerts.map(s => (
                <Link key={s.shipment_id} to={`/shipments/${s.shipment_id}`} onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition">
                  <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-red)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-data text-[var(--text-primary)]">{s.shipment_id}</p>
                    <p className="text-xs text-[var(--text-secondary-2)]">max score {s.max_fused_score.toFixed(3)}</p>
                  </div>
                  <TierBadge tier={s.latest_risk_tier} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.1] transition">
        <User className="w-4 h-4 text-[var(--text-secondary-2)]" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 panel overflow-hidden z-40" onMouseLeave={() => setOpen(false)}>
          <button onClick={toggleTheme}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-heading text-[var(--text-primary)] hover:bg-white/[0.04] transition">
            {isLight ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
            Switch to {isLight ? 'dark' : 'light'} theme
          </button>
        </div>
      )}
    </div>
  );
}

export default function TopBar() {
  return (
    <header className="h-[52px] shrink-0 flex items-center gap-3 px-4 border-b border-[var(--card-border)]">
      <CommandPalette />
      <div className="ml-auto flex items-center gap-2">
        <LiveIndicator />
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
