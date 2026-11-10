import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, FolderArchive, CalendarDays, Plane, ListChecks, Ticket, SquareKanban, ContactRound, Blocks, Megaphone, BriefcaseBusiness, Bell, Settings, ShieldCheck, UserRound, UsersRound, FileChartColumn, Lightbulb, BookOpenText, MessagesSquare, BadgeDollarSign, LogOut, PanelLeftClose, PanelLeftOpen, MoreHorizontal, Crosshair } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { hiddenNav } from '../lib/sidebar.js';
import { fullName, initials } from '../lib/format.js';
import { ledTeams } from '../pages/MyTeam.jsx';
import { markOnDark } from '../lib/brand.js';
import FeedbackWidget from './FeedbackWidget.jsx';

const NAV = [
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/playbook', label: 'Playbook', icon: BookOpenText },
  { to: '/reports', label: 'Reports', icon: FileChartColumn },
  { to: '/events', label: 'Events', icon: CalendarDays },
  { to: '/travel', label: 'Travel', icon: Plane },
  { to: '/priorities', label: 'Priorities', icon: ListChecks },
  { to: '/tickets', label: 'Tickets', icon: Ticket },
  { to: '/pipeline', label: 'BD Pipeline', icon: SquareKanban },
  { to: '/delivery', label: 'Delivery', icon: BriefcaseBusiness },
  { to: '/closed-deals', label: 'Closed deals', icon: FolderArchive },
  { to: '/compensation', label: 'Compensation', icon: BadgeDollarSign },
  { to: '/crm', label: 'CRM', icon: ContactRound },
  { to: '/solutions', label: 'Technical Solutions', icon: Blocks },
  { to: '/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/retros', label: 'Retrospectives', icon: MessagesSquare },
  { to: '/lessons', label: 'Lessons Learned', icon: Lightbulb },
];

/**
 * Every sidebar page this user can open, in sidebar order: the main list, then Settings and the access pages at the
 * bottom (`bottom: true`). Settings can't be hidden; the rest can, from Settings (see lib/sidebar.js).
 */
export function navFor(user) {
  const isAdmin = user.role === 'admin';
  const led = ledTeams(user).length;
  return [
    ...NAV,
    { to: '/settings', label: 'Settings', icon: Settings, bottom: true, fixed: true },
    ...(!isAdmin && !led ? [{ to: '/member', label: 'Member Access', icon: UserRound, bottom: true }] : []),
    ...(led > 0 ? [{ to: '/my-team', label: led === 1 ? 'My team' : 'My teams', icon: UsersRound, bottom: true }] : []),
    // Admin Access holds the Admin, Team Lead and Developer views; it shows for anyone with one of those roles.
    ...(isAdmin || led > 0 || user.developer ? [{ to: '/admin', label: 'Admin Access', icon: ShieldCheck, bottom: true }] : []),
  ];
}

const COLLAPSED_KEY = 'kit.sidebar.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; } };
const writeCollapsed = (v) => { try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

/** Unread alert count: refreshed on navigation, every minute, and when the Alerts page reads some. */
function useUnreadAlerts() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = () => api.get('/alerts/unread', { quiet: true }).then((d) => setCount(d.count)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('kit:alerts', load);
    return () => { clearInterval(t); window.removeEventListener('kit:alerts', load); };
  }, [pathname]);
  return count;
}

/** Access requests waiting on an admin; refreshed like alerts, and when Admin Access handles one. */
function usePendingRequests(isAdmin) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!isAdmin) return undefined;
    const load = () => api.get('/users/access-requests', { quiet: true }).then((d) => setCount(d.pending)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    window.addEventListener('kit:access-requests', load);
    return () => { clearInterval(t); window.removeEventListener('kit:access-requests', load); };
  }, [pathname, isAdmin]);
  return count;
}

/** A sidebar link: icon and label, or just the icon when minimized, with an optional count badge. */
function NavItem({ to, label, icon: Icon, count, collapsed, onClick }) {
  const badge = count > 0 ? (count > 99 ? '99+' : count) : null;
  return (
    <NavLink
      to={to}
      onClick={onClick}
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
}

/**
 * The More button under the sidebar list, and its popout beside the sidebar listing every page this user can
 * open, hidden ones included. A link, Escape, or a click outside closes it.
 */
function MoreMenu({ items, counts, collapsed }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const button = useRef(null);
  const panel = useRef(null);
  const { pathname } = useLocation();

  // Beside the sidebar, lined up with the button, kept inside the window (over the sidebar on a narrow screen).
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const b = button.current.getBoundingClientRect();
      const edge = button.current.closest('aside')?.getBoundingClientRect().right ?? b.right;
      const width = Math.min(256, window.innerWidth - 16);
      const height = panel.current?.offsetHeight || 0;
      setPos({
        left: Math.max(8, Math.min(edge + 8, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(b.top, window.innerHeight - height - 8)),
        width,
      });
    };
    place();
    // Minimizing or expanding the sidebar moves its edge once the width transition ends.
    const aside = button.current.closest('aside');
    window.addEventListener('resize', place);
    aside?.addEventListener('transitionend', place);
    return () => { window.removeEventListener('resize', place); aside?.removeEventListener('transitionend', place); };
  }, [open, collapsed, items.length]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e) => {
      if (!panel.current?.contains(e.target) && !button.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button ref={button} onClick={() => setOpen((o) => !o)} title={collapsed ? 'More' : 'All pages'} aria-label="More" aria-expanded={open} aria-haspopup="true"
        className={`relative flex w-full items-center gap-3 rounded-md py-2 text-sm font-medium transition ${collapsed ? 'justify-center px-0' : 'px-3'} ${
          open ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
        }`}>
        <MoreHorizontal size={18} className="shrink-0" />
        {!collapsed && 'More'}
      </button>
      {open && (
        <div ref={panel} role="menu" aria-label="All pages"
          style={pos ? { left: pos.left, top: pos.top, width: pos.width } : { visibility: 'hidden' }}
          className="fixed z-[60] flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-xl bg-brand-900 text-slate-200 shadow-xl ring-1 ring-white/15 print:hidden">
          <div className="px-4 pt-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">All pages</div>
          <div className="min-h-0 space-y-0.5 overflow-y-auto px-2 pb-2">
            {items.map((n, i) => (
              <div key={n.to}>
                {n.bottom && !items[i - 1]?.bottom && <div className="mx-1 my-1.5 border-t border-white/10" />}
                <NavItem {...n} count={counts[n.to]} onClick={() => setOpen(false)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const unread = useUnreadAlerts();
  const isAdmin = user.role === 'admin';
  const pendingRequests = usePendingRequests(isAdmin);
  // Minimized, the sidebar shows icons only; the choice is remembered on this browser.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => setCollapsed((c) => { writeCollapsed(!c); return !c; });
  const Toggle = collapsed ? PanelLeftOpen : PanelLeftClose;
  // Pages hidden in Settings leave the sidebar but stay under More.
  const items = navFor(user);
  const hidden = new Set(hiddenNav(user));
  const shown = items.filter((n) => n.fixed || !hidden.has(n.to));
  const counts = { '/alerts': unread, '/admin': pendingRequests };

  return (
    // When printing, drop the sidebar and the fixed-height frame so the page flows across sheets.
    <div className="flex h-screen overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside className={`flex shrink-0 flex-col overflow-hidden whitespace-nowrap bg-brand-900 text-slate-200 transition-[width] duration-200 print:hidden ${collapsed ? 'w-16' : 'w-60'}`}>
        <div className={`flex items-center gap-2.5 py-5 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
          <img src={markOnDark} alt="Knexus" className="h-9 w-9 shrink-0 object-contain" title={collapsed ? 'KIT — Knexus Intelligence Toolkit' : undefined} />
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-base font-bold tracking-wide text-white">KIT</div>
              <div className="truncate text-[11px] leading-tight text-slate-400">Knexus Intelligence Toolkit</div>
            </div>
          )}
        </div>
        <nav className={`min-h-0 flex-1 space-y-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
          {shown.filter((n) => !n.bottom).map((n) => <NavItem key={n.to} {...n} count={counts[n.to]} collapsed={collapsed} />)}
        </nav>
        {/* While Focus is on, a marker says why the pages hold less; it links to the switch in Settings. */}
        {!!user.focus && (
          <NavLink to="/settings" title="Focus is on: you’re seeing only what you’re on or mentioned in. Turn it off in Settings." aria-label="Focus is on. Open Settings"
            className={`mb-2 flex items-center gap-2 rounded-md bg-amber-400/15 py-1.5 text-xs font-semibold text-amber-200 ring-1 ring-amber-300/30 hover:bg-amber-400/25 ${collapsed ? 'mx-2 justify-center px-0' : 'mx-3 px-3'}`}>
            <Crosshair size={15} className="shrink-0" /> {!collapsed && 'Focus on'}
          </NavLink>
        )}
        {/* More sits outside the scrolling list, so it's always in view however many pages are shown. */}
        <div className={`space-y-1 border-t border-white/10 pt-2 pb-2 ${collapsed ? 'px-2' : 'px-3'}`}>
          <MoreMenu items={items} counts={counts} collapsed={collapsed} />
          {shown.filter((n) => n.bottom).map((n) => <NavItem key={n.to} {...n} count={counts[n.to]} collapsed={collapsed} />)}
          <button onClick={toggle} title={collapsed ? 'Expand sidebar' : 'Minimize sidebar'} aria-label={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
            className={`flex items-center gap-3 rounded-md py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white ${collapsed ? 'w-full justify-center px-0' : 'w-full px-3'}`}>
            <Toggle size={18} className="shrink-0" /> {!collapsed && 'Minimize'}
          </button>
        </div>
        <div className={`flex items-center gap-3 border-t border-white/10 py-4 ${collapsed ? 'flex-col px-2' : 'px-4'}`}>
          <NavLink to="/profile" title={collapsed ? `${fullName(user)} · Profile` : 'Your profile'} aria-label="Your profile"
            className={({ isActive }) => `group flex min-w-0 items-center gap-3 rounded-md transition ${collapsed ? '' : '-m-1.5 flex-1 p-1.5'} ${isActive ? 'bg-white/10' : 'hover:bg-white/5'}`}>
            {({ isActive }) => (
              <>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold ring-2 transition ${isActive ? 'bg-brand-500 text-white ring-white/40' : 'bg-white/15 ring-transparent group-hover:ring-white/30'}`}>{initials(user)}</span>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-white">{fullName(user)}</span>
                    <span className="block truncate text-xs text-slate-400">{user.title || user.username}</span>
                  </span>
                )}
              </>
            )}
          </NavLink>
          <button onClick={logout} className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto print:overflow-visible">
        <Outlet />
      </main>
      <FeedbackWidget />
    </div>
  );
}
