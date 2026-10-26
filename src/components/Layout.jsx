import { NavLink, Outlet } from 'react-router-dom';
import { UserRound, Plane, ListChecks, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import { fullName, initials } from '../lib/format.js';

const NAV = [
  { to: '/profile', label: 'Profile', icon: UserRound },
  { to: '/travel', label: 'Travel', icon: Plane },
  { to: '/priorities', label: 'Weekly Priorities', icon: ListChecks },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col bg-brand-900 text-slate-200">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500 text-lg font-bold text-white">K</div>
          <div>
            <div className="text-base font-bold tracking-wide text-white">KIT</div>
            <div className="text-[11px] leading-tight text-slate-400">Knexus Intelligence Toolkit</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`
              }
            >
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white/15 text-xs font-semibold">{initials(user)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-white">{fullName(user)}</div>
            <div className="truncate text-xs text-slate-400">{user.title || user.username}</div>
          </div>
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
