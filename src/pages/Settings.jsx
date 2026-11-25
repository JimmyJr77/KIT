import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, X, Crosshair, BellRing, Mail, MessageSquare, Settings as SettingsIcon, ShieldCheck, Target, Code2 } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { hiddenNav } from '../lib/sidebar.js';
import { navFor } from '../components/Layout.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { PipedrivePullPanel } from '../components/PipedrivePanel.jsx';
import { AdminView, TeamLeadView, DeveloperView, leadPages } from './AdminAccess.jsx';
import { ledTeams } from './MyTeam.jsx';

const isAdmin = (user) => user.role === 'admin';

/**
 * Settings has a tab for each role, kept in the address (?tab=admin): General Settings for everyone, Admin for admins
 * (access, the directory and site setup), Team Lead for anyone who leads a team (and admins), Site Dev for people with
 * the Site Dev role (set on their account). Someone sees only the tabs for roles they have, and the switcher only when
 * there's more than one. The server checks each role again on everything these tabs load and save.
 */
const TABS = [
  { key: 'general', label: 'General Settings', icon: SettingsIcon, subtitle: 'How KIT is connected and configured', can: () => true, Page: GeneralView },
  { key: 'admin', label: 'Admin', icon: ShieldCheck, subtitle: 'Who can use KIT, the team directory and site setup', can: isAdmin, Page: AdminView },
  { key: 'team-lead', label: 'Team Lead', icon: Target, subtitle: 'Your team and what it’s expected to deliver', can: (u) => leadPages(u).length > 0, Page: TeamLeadView },
  { key: 'site-dev', label: 'Site Dev', icon: Code2, subtitle: 'Site feedback to work through', can: (u) => !!u.developer, Page: DeveloperView },
];

/** The Settings tabs this user can open, General Settings first. */
export const settingsTabs = (user) => TABS.filter((t) => t.can(user));

/** The address of a Settings tab. */
export const settingsPath = (key) => (key === 'general' ? '/settings' : `/settings?tab=${key}`);

export default function Settings() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const tabs = settingsTabs(user);
  // A tab that isn't this user's (or isn't one at all) shows General Settings.
  const current = tabs.find((t) => t.key === params.get('tab')) || tabs[0];
  // Fetched here so the tabs can show what's waiting, whichever one is open: open site feedback for Site Dev, access
  // requests for admins (counted again when one is handled).
  const feedback = useApi(tabs.some((t) => t.key === 'site-dev') ? '/feedback' : null);
  const requests = useApi(isAdmin(user) ? '/users/access-requests' : null);
  useEffect(() => {
    window.addEventListener('kit:access-requests', requests.reload);
    return () => window.removeEventListener('kit:access-requests', requests.reload);
  }, [requests.reload]);
  const badges = { admin: requests.data?.pending, 'site-dev': feedback.data?.open };
  const { Page } = current;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader title="Settings" subtitle={current.subtitle}>
        {tabs.length > 1 && (
          <nav className="flex h-9 max-w-full overflow-x-auto rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" aria-label="Settings tabs">
            {tabs.map((t) => {
              const active = t.key === current.key;
              return (
                <Link key={t.key} to={settingsPath(t.key)} aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded px-3 whitespace-nowrap ${active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                  <t.icon size={14} /> {t.label}
                  {badges[t.key] > 0 && (
                    <span className={`rounded-full px-1.5 text-[10px] leading-4 font-bold ${active ? 'bg-white text-brand-700' : 'bg-amber-500 text-white'}`}>{badges[t.key]}</span>
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </PageHeader>
      <Page feedback={feedback} />
    </div>
  );
}

/**
 * What everyone sets for themselves. Members who are neither admins nor team leads also pull their own Pipedrive deals
 * here; admins and leads pull from their own tabs.
 */
function GeneralView() {
  const { user } = useAuth();
  return (
    <>
      <FocusPanel />
      <AlertDeliveryPanel />
      <SidebarPanel />
      {!isAdmin(user) && !ledTeams(user).length && <PipedrivePullPanel scope="mine" />}
      <IntegrationsPanel />
    </>
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

/**
 * Where your alerts go besides the Alerts page: your email, and a direct message from the KIT app in Google Chat. Each is
 * your own switch, saved as soon as it's flipped. Chat needs you to open the KIT app there once, which ties your Google
 * account to your KIT account by its email (see server/services/googleChat.js).
 */
function AlertDeliveryPanel() {
  const { user } = useAuth();
  const { data, reload } = useApi('/alerts/delivery');
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null); // { ok, text }
  useEffect(() => { if (data) setD(data); }, [data]);
  if (!d) return null;
  const { server } = d;

  const flip = async (key) => {
    setBusy(key);
    try {
      setD(await api.put('/alerts/delivery', { [key]: !d[key] }));
      setMsg(null);
    } catch (err) {
      setMsg({ text: err.message });
    } finally {
      setBusy(null);
    }
  };
  const test = async (channel) => {
    setBusy(`test-${channel}`);
    try {
      await api.post('/alerts/delivery/test', { channel });
      setMsg({ ok: true, text: channel === 'chat' ? 'Sent. Look for it in Google Chat.' : `Sent to ${d.address}.` });
    } catch (err) {
      setMsg({ text: err.message });
    } finally {
      setBusy(null);
    }
  };

  const off = !server.sending ? 'This is a development server, so it doesn’t send alerts out.' : null;
  const rows = [
    {
      key: 'email', icon: Mail, label: 'Email', ready: server.email.configured,
      note: !server.email.configured ? 'Email isn’t set up on this server yet.'
        : off || server.email.error && isAdmin(user) && `Last send failed: ${server.email.error}`
        || <>New alerts are emailed to <span className="font-medium text-slate-700">{d.address}</span>.</>,
      canTest: server.email.configured,
    },
    {
      key: 'chat', icon: MessageSquare, label: 'Google Chat', ready: server.chat.configured,
      note: !server.chat.configured ? (isAdmin(user) && server.chat.problem ? `Google Chat isn’t set up on this server yet: ${server.chat.problem}.` : 'Google Chat isn’t set up on this server yet.')
        : !d.chat_connected ? <>Not connected yet. In Google Chat, start a chat with the <span className="font-medium text-slate-700">KIT</span> app and say hello, signed in as <span className="font-medium text-slate-700">{d.address}</span>. <button type="button" className="text-brand-600 hover:underline" onClick={() => reload({ quiet: true })}>Check again</button></>
        : off || server.chat.error && isAdmin(user) && `Last send failed: ${server.chat.error}`
        || 'Connected. New alerts arrive as a direct message from the KIT app.',
      canTest: server.chat.configured && d.chat_connected,
    },
  ].filter((row) => row.key !== 'chat' || server.chat.configured || (isAdmin(user) && server.chat.problem)); // Chat shows only once the server has it (or is half set up, to an admin)

  return (
    <div className="panel">
      <h2 className="section-title flex items-center gap-2"><BellRing size={16} className="text-slate-400" /> Alert delivery</h2>
      <p className="mt-1 max-w-2xl text-xs text-slate-500">
        Get your alerts outside KIT as they happen. Ones that arrive together come as one message, and an alert you’ve already
        read in KIT isn’t sent. Only you see this.
      </p>
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map(({ key, icon: Icon, label, ready, note, canTest }) => (
          <li key={key} className="flex items-start gap-3 py-3">
            <Icon size={18} className={`mt-0.5 shrink-0 ${ready && d[key] ? 'text-brand-600' : 'text-slate-300'}`} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800">{label}</div>
              <p className="text-xs text-slate-500">{note}</p>
            </div>
            {canTest && <button type="button" className="btn-ghost shrink-0 text-xs" disabled={!!busy} onClick={() => test(key)}>{busy === `test-${key}` ? 'Sending…' : 'Send a test'}</button>}
            <button type="button" role="switch" aria-checked={d[key]} aria-label={`${label} alerts`} onClick={() => flip(key)} disabled={!!busy}
              className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${d[key] ? 'bg-brand-600' : 'bg-slate-300'} ${busy === key ? 'opacity-60' : ''}`}>
              <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${d[key] ? 'translate-x-5' : ''}`} />
            </button>
          </li>
        ))}
      </ul>
      {msg && <p className={`mt-1 text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
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
