import { useState } from 'react';
import { Check, X, Crosshair } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { hiddenNav } from '../lib/sidebar.js';
import { navFor } from '../components/Layout.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Settings() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title="Settings" subtitle="How KIT is connected and configured" />
      <FocusPanel />
      <SidebarPanel />
      <IntegrationsPanel />
    </div>
  );
}

/**
 * Focus: while it's on, the Dashboard, Reports, Priorities, Travel, Tickets, the BD Pipeline and Delivery show you only
 * what you're tied to or mentioned in (the server narrows them: see server/focus.js). Saved as soon as it's switched.
 */
function FocusPanel() {
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const on = !!user.focus;
  const toggle = async () => {
    setBusy(true);
    try {
      const d = await api.put('/users/me/focus', { on: !on });
      setUser(d.user);
      setMsg(null);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="section-title flex items-center gap-2"><Crosshair size={16} className={on ? 'text-brand-600' : 'text-slate-400'} /> Focus</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-500">
            Show only what’s yours. With Focus on, the Dashboard, Reports, Priorities, Travel, Tickets, BD Pipeline and Delivery
            keep to what you own, are assigned to, follow or have posted on, and anything you’re @mentioned in. Everything else is
            still there when you turn it off. Only you see this.
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Focus" onClick={toggle} disabled={busy}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition ${on ? 'bg-brand-600' : 'bg-slate-300'} ${busy ? 'opacity-60' : ''}`}>
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </div>
  );
}

/** Which pages show in your own sidebar. Hidden ones stay under More; Settings always shows. Saved on each change. */
function SidebarPanel() {
  const { user, setUser } = useAuth();
  const [msg, setMsg] = useState(null);
  const items = navFor(user).filter((n) => !n.fixed);
  const hidden = new Set(hiddenNav(user));

  // The sidebar changes right away; the server's copy then replaces it, or the old choice comes back on an error.
  const save = async (next) => {
    const before = user;
    setUser({ ...user, hidden_nav: JSON.stringify([...next]) });
    try {
      const d = await api.put('/users/me/sidebar', { hidden: [...next] });
      setUser(d.user);
      setMsg(null);
    } catch (err) {
      setUser(before);
      setMsg(err.message);
    }
  };
  const toggle = (to) => {
    const next = new Set(hidden);
    if (next.has(to)) next.delete(to); else next.add(to);
    save(next);
  };

  return (
    <div className="panel">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="section-title">Sidebar</h2>
          <p className="text-xs text-slate-500">Pick the pages in your sidebar. The rest stay under More. Only you see this.</p>
        </div>
        <button type="button" className="btn-ghost shrink-0" disabled={!hidden.size} onClick={() => save(new Set())}>Show all</button>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(({ to, label, icon: Icon }) => (
          <label key={to} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!hidden.has(to)} onChange={() => toggle(to)} />
            <Icon size={18} className={`shrink-0 ${hidden.has(to) ? 'text-slate-300' : 'text-slate-500'}`} />
            <span className={hidden.has(to) ? 'text-slate-400' : ''}>{label}</span>
          </label>
        ))}
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}
    </div>
  );
}

function IntegrationsPanel() {
  const { data } = useApi('/ai/status');
  if (!data) return null;
  const items = [
    ['Gemini', data.gemini, data.model],
    ['Airfare MCP', data.airfare],
    ['Rental Car MCP', data.rentalCar],
    ['GSA Per Diem API', data.gsaApi],
    ['Google Workspace', data.googleWorkspace],
  ];
  return (
    <div className="panel">
      <h2 className="section-title mb-3">Integrations</h2>
      <div className="flex flex-wrap gap-2">
        {items.map(([name, on, extra]) => (
          <span key={name} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {on ? <Check size={13} /> : <X size={13} />} {name}{extra ? ` · ${extra}` : ''}
          </span>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">Configure in the server <code>.env</code> file. See README.</p>
    </div>
  );
}
