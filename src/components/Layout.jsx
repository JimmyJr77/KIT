import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { UserRound, LayoutDashboard, Plane, ListChecks, Ticket, SquareKanban, Bell, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, initials } from '../lib/format.js';

const NAV = [
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/travel', label: 'Travel', icon: Plane },
  { to: '/priorities', label: 'Weekly Priorities', icon: ListChecks },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/pipeline', label: 'BD Pipeline', icon: SquareKanban },
];

const COLLAPSED_KEY = 'kit.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
const writeCollapsed = (v) => { try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

/** Unread alert count: refreshed on navigation, every minute, and when the Alerts page reads some. */
function useUnreadAlerts() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => api.get('/alerts/unread').then((d) => setCount(d.count)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('kit:alerts', load);
    return () => { clearInterval(t); window.removeEventListener('kit:alerts', load); };
  }, [pathname]);
  return count;
}

export default function Layout() {
  const { user, logout } = useAuth();
  const unread = useUnreadAlerts();
  // Minimized, the sidebar shows icons only; the choice is remembered on this browser.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`flex shrink-0 flex-col overflow-hidden whitespace-nowrap bg-brand-900 text-slate-200 transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex items-center gap-2.5 py-5 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500 text-lg font-bold text-white" title={collapsed ? 'KIT — Knexus Intelligence Toolkit' : undefined}>K</div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-base font-bold tracking-wide text-white">KIT</div>
              <div className="truncate text-[11px] leading-tight text-slate-400">Knexus Intelligence Toolkit</div>
            </div>
          )}
        </div>
        <nav className={`flex-1 space-y-1 ${collapsed ? 'px-2' : 'px-3'}`}>
          {NAV.map(({ to, label, icon: Icon }) => {
            const badge = to === '/alerts' && unread > 0 ? (unread > 99 ? '99+' : unread) : null;
            return (
              <NavLink
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 rounded-md py-2 text-sm font-medium transition ${collapsed ? 'justify-center px-0' : 'px-3'} ${
                    isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`
                }
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && label}
                {badge && (collapsed
                  ? <span className="absolute top-0.5 right-2 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">{badge}</span>
                  : <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{badge}</span>)}
              </NavLink>
            );
          })}
        </nav>
        <div className={collapsed ? 'flex justify-center px-2 pb-2' : 'px-3 pb-2'}>
          <button onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Minimize sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            className={`flex items-center gap-3 rounded-md py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white ${collapsed ? 'justify-center px-2' : 'w-full px-3'}`}>
            <Toggle size={18} className="shrink-0" /> {!collapsed && 'Minimize'}
          </button>
        </div>
        <div className={`flex items-center gap-3 border-t border-white/10 py-4 ${collapsed ? 'flex-col px-2' : 'px-4'}`}>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-xs font-semibold" title={collapsed ? fullName(user) : undefined}>{initials(user)}</div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-white">{fullName(user)}</div>
              <div className="truncate text-xs text-slate-400">{user.title || user.username}</div>
            </div>
          )}
          <button onClick={logout} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
