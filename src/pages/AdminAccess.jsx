import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, X, ShieldCheck, Trash2, UserPlus, Users, Search, Pencil } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { fullName, stamp, fullStamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { TeamTags, AddTeamSelect } from '../components/TeamPicker.jsx';
import ProfileFields from '../components/ProfileFields.jsx';
import SidePanel from '../components/SidePanel.jsx';
import Avatar from '../components/Avatar.jsx';
import BookingTargetsPanel from '../components/BookingTargets.jsx';
import { TerritoryTags, AddTerritorySelect, TerritoriesPanel, saveUserTerritories } from '../components/Territories.jsx';

/** Admins only: access requests from the sign-in page, approved accounts, and the team directory. */
export default function AdminAccess() {
  const { user } = useAuth();
  return user.role === 'admin' ? <AdminPage /> : <Navigate to="/settings" replace />;
}

function AdminPage() {
  const approved = useApi('/users/approved');
  const users = useApi('/users');
  const teams = useApi('/teams');
  const territories = useApi('/territories');
  const [error, setError] = useState('');
  const teamList = teams.data?.teams || [];
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <PageHeader title="Admin Access" subtitle="Who can use KIT, and the team directory" />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <RequestsPanel onApproved={approved.reload} />
      <ApprovedPanel approved={approved} teams={teamList} onError={setError} />
      <DirectoryPanel approved={approved} users={users} teams={teamList} territories={territories.data?.territories || []} onError={setError} />
      <TerritoriesPanel territories={territories} onChanged={users.reload} />
      <BookingTargetsPanel />
    </div>
  );
}

function RequestsPanel({ onApproved }) {
  const requests = useApi('/users/access-requests');
  const [roles, setRoles] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const act = async (q, action) => {
    if (action === 'decline' && !confirm(`Decline access for ${q.email}?`)) return;
    setBusy(q.id);
    setError('');
    try {
      await api.post(`/users/access-requests/${q.id}/${action}`, { role: roles[q.id] || 'member' });
      requests.reload();
      if (action === 'approve') onApproved();
      window.dispatchEvent(new Event('kit:access-requests'));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const list = requests.data?.requests || [];
  const pending = list.filter((q) => q.status === 'pending');
  const handled = list.filter((q) => q.status !== 'pending');

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2">
        <UserPlus size={16} className="text-brand-600" /> Requested access
        {pending.length > 0 && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white">{pending.length}</span>}
      </h2>
      <p className="text-xs text-slate-500">People who asked for access from the sign-in page. Approving adds their email to approved accounts so they can activate it.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {requests.data && !pending.length && <p className="text-sm text-slate-400">No requests waiting.</p>}
      {pending.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {pending.map((q) => (
            <li key={q.id} className="flex flex-wrap items-start gap-3 px-3 py-3">
              <div className="min-w-60 flex-1">
                <div className="text-sm font-semibold text-slate-800">{q.first_name} {q.last_name}</div>
                <div className="text-xs text-slate-500">{q.email} · <span title={fullStamp(q.created_at)}>requested {stamp(q.created_at)}</span></div>
                {q.reason && <p className="mt-1 text-sm whitespace-pre-wrap text-slate-700">{q.reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select className="input w-28 py-1.5 text-sm" value={roles[q.id] || 'member'} onChange={(e) => setRoles({ ...roles, [q.id]: e.target.value })} aria-label={`Role for ${q.email}`}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => act(q, 'approve')} disabled={busy === q.id}><Check size={14} /> Approve</button>
                <button type="button" className="btn px-3 py-1.5 text-xs" onClick={() => act(q, 'decline')} disabled={busy === q.id}><X size={14} /> Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {handled.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">Handled in the last 30 days ({handled.length})</summary>
          <ul className="mt-2 space-y-1">
            {handled.map((q) => (
              <li key={q.id} className="text-xs text-slate-600">
                <span className="font-medium">{q.first_name} {q.last_name}</span> ({q.email}) ·{' '}
                <span className={q.status === 'approved' ? 'text-emerald-700' : 'text-slate-500'}>{q.status}</span>
                {q.handled_by && <> by {fullName(q.handled_by)}</>} <span title={fullStamp(q.handled_at)}>{stamp(q.handled_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const roleSelect = (value, onChange, label, className = 'w-28') => (
  <select className={`input py-1 text-sm ${className}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
    <option value="member">Member</option>
    <option value="admin">Admin</option>
  </select>
);

const rolesOf = (u) => Object.fromEntries((u.teams || []).map((t) => [t.id, t.role]));

/** Emails approved ahead of time. Once someone activates, they move to the team directory. */
function ApprovedPanel({ approved, teams, onError }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const waiting = (approved.data?.approved || []).filter((a) => !a.user_id);

  const approve = async (e) => {
    e.preventDefault();
    onError('');
    try {
      await api.post('/users/approved', { email, role });
      setEmail('');
      approved.reload();
    } catch (err) {
      onError(err.message);
    }
  };
  const setTeams = async (a, ids) => {
    try { await api.put(`/users/approved/${encodeURIComponent(a.email)}`, { team_ids: ids }); approved.reload(); } catch (err) { onError(err.message); }
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /> Approved accounts</h2>
      <p className="text-xs text-slate-500">Approve an email so its owner can activate an account. Teams set here are theirs when they sign in.</p>
      <form onSubmit={approve} className="flex flex-wrap gap-2">
        <input className="input min-w-0 flex-1 sm:max-w-sm" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select className="input w-28" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn-primary">Authorize account</button>
      </form>
      {approved.data && (
        waiting.length ? (
          <div>
            <h3 className="label">Awaiting activation ({waiting.length})</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {waiting.map((a) => {
                const ids = a.team_ids || [];
                return (
                  <li key={a.email} className={APPROVED_ROW}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-800" title={a.email}>{a.email}</div>
                      <div className="text-xs text-slate-500 capitalize">{a.role}</div>
                    </div>
                    <div className={ROW_REST}>
                      <div className="min-w-0 flex-1">
                        <TeamTags teams={teams} value={ids} admin={a.role === 'admin'} onRemove={(id) => setTeams(a, ids.filter((x) => x !== id))} />
                      </div>
                      <div className={ROW_ACTIONS}>
                        <AddTeamSelect teams={teams} value={ids} onAdd={(id) => setTeams(a, [...ids, id])} className="w-32" />
                        <RevokeButton email={a.email} onRevoked={approved.reload} onError={onError} />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : <p className="text-sm text-slate-400">Everyone approved has activated their account.</p>
      )}
    </div>
  );
}

// Each row has three columns on wide screens: who, their tags (left-aligned), and the controls (right-aligned, a fixed
// width so the role menus line up). Narrower, the who sits above a line with the tags and controls.
const ROW = 'grid items-center gap-x-4 gap-y-2 px-3 py-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_18.75rem]';
// Approved emails have only an add-team menu and revoke on the right, so that column is narrower.
const APPROVED_ROW = 'grid items-center gap-x-4 gap-y-2 px-3 py-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_11rem]';
const ROW_REST = 'flex flex-wrap items-center gap-x-3 gap-y-2 lg:contents';
// items-stretch keeps the add-team and role menus (and the icon buttons) the same height.
const ROW_ACTIONS = 'ml-auto flex items-stretch justify-end gap-1';

function RevokeButton({ email, onRevoked, onError }) {
  const revoke = async () => {
    if (!confirm(`Revoke access for ${email}? They won't be able to sign in.`)) return;
    try { await api.del(`/users/approved/${encodeURIComponent(email)}`); onRevoked(); } catch (err) { onError(err.message); }
  };
  return <button type="button" className="btn-ghost p-1.5 text-red-600" onClick={revoke} title={`Revoke access for ${email}`} aria-label={`Revoke access for ${email}`}><Trash2 size={15} /></button>;
}

/** Everyone with an active account: their teams, role and contact details. */
function DirectoryPanel({ approved, users, teams, territories, onError }) {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [team, setTeam] = useState('');
  const [editing, setEditing] = useState(null);
  const approvedEmails = new Set((approved.data?.approved || []).map((a) => a.email.toLowerCase()));
  const all = users.data?.users || [];
  const s = q.trim().toLowerCase();
  const shown = all.filter((u) => (!team || (u.team_ids || []).includes(Number(team)))
    && (!s || `${fullName(u)} ${u.email} ${u.username} ${u.title || ''}`.toLowerCase().includes(s)));

  const update = async (u, patch) => {
    try { await api.put(`/users/${u.id}`, { ...u, ...patch }); users.reload(); } catch (err) { onError(err.message); }
  };
  const setTeamRole = async (u, teamId, role) => {
    try { await api.put(`/users/${u.id}/teams/${teamId}`, { role }); users.reload(); } catch (err) { onError(err.message); }
  };
  const setTerritories = async (u, ids) => {
    try { await saveUserTerritories(u.id, ids); users.reload(); } catch (err) { onError(err.message); }
  };

  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto flex items-center gap-2"><Users size={16} className="text-brand-600" /> Team directory <span className="text-xs font-normal text-slate-400">{all.length} people</span></h2>
        <div className="relative w-full sm:w-56">
          <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
          <input className="input py-1.5 pl-8 text-sm" placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        </div>
        <select className="input w-full py-1.5 text-sm sm:w-44" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team">
          <option value="">All teams</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">Right-click a team tag to make someone that team's lead. Add territories from the edit button.</p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {shown.map((u) => {
          const ids = u.team_ids || [];
          return (
            <li key={u.id} className={ROW}>
              <div className="flex min-w-0 items-center gap-3">
                <Avatar user={u} size="md" />
                <div className="min-w-0 leading-snug">
                  <div className="truncate text-sm font-semibold text-slate-800">{fullName(u)}</div>
                  {u.title && <div className="truncate text-xs text-slate-600">{u.title}</div>}
                  <div className="truncate text-xs text-slate-400" title={[u.email, `@${u.username}`, u.phone].filter(Boolean).join(' · ')}>
                    {[u.email, u.phone].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
              <div className={ROW_REST}>
                <div className="min-w-0 flex-1">
                  <TeamTags teams={teams} value={ids} roles={rolesOf(u)} admin={u.role === 'admin'}
                    onRemove={(id) => update(u, { team_ids: ids.filter((x) => x !== id) })}
                    onSetRole={(teamId, role) => setTeamRole(u, teamId, role)}>
                    <TerritoryTags territories={u.territories} onRemove={(id) => setTerritories(u, u.territories.map((t) => t.id).filter((x) => x !== id))} />
                  </TeamTags>
                </div>
                <div className={ROW_ACTIONS}>
                  <AddTeamSelect teams={teams} value={ids} onAdd={(id) => update(u, { team_ids: [...ids, id] })} className="w-32" />
                  {roleSelect(u.role, (role) => update(u, { role }), `Role for ${fullName(u)}`)}
                  <button type="button" className="btn-ghost p-1.5 text-slate-500 hover:text-slate-800" onClick={() => setEditing(u)}
                    title={`Edit ${fullName(u)}`} aria-label={`Edit ${fullName(u)}`}><Pencil size={15} /></button>
                  {/* No revoking your own access from here; that would sign you out for good. */}
                  {u.id !== me.id && approvedEmails.has(u.email.toLowerCase())
                    ? <RevokeButton email={u.email} onRevoked={() => { approved.reload(); users.reload(); }} onError={onError} />
                    : <span className="w-[30px] shrink-0" />}
                </div>
              </div>
            </li>
          );
        })}
        {users.data && !shown.length && <li className="px-3 py-6 text-center text-sm text-slate-400">No one matches.</li>}
      </ul>
      {editing && <EditAccountPanel user={editing} territories={territories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); approved.reload(); }} />}
    </div>
  );
}

/** Change someone's account details, teams, territories and site role. */
function EditAccountPanel({ user, territories, onClose, onSaved }) {
  const [form, setForm] = useState({
    first_name: user.first_name, last_name: user.last_name, email: user.email, phone: user.phone || '',
    username: user.username, title: user.title || '', team_ids: user.team_ids || [], role: user.role,
  });
  const [territoryIds, setTerritoryIds] = useState((user.territories || []).map((t) => t.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.put(`/users/${user.id}`, form);
      await saveUserTerritories(user.id, territoryIds);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <SidePanel title={`Edit ${fullName(user)}`} subtitle="Account details, teams and site role" onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
        </div>
      )}>
      <form onSubmit={save} className="space-y-4">
        <ProfileFields value={form} onChange={setForm} roles={rolesOf(user)} />
        <div>
          <label className="label">Territories</label>
          <div className="flex min-h-[38px] flex-wrap items-center gap-1.5">
            <TerritoryTags territories={territories.filter((t) => territoryIds.includes(t.id))} onRemove={(id) => setTerritoryIds(territoryIds.filter((x) => x !== id))} />
            <AddTerritorySelect territories={territories} value={territoryIds} onAdd={(id) => setTerritoryIds([...territoryIds, id])} className="w-auto py-1.5 text-sm" />
          </div>
          <p className="mt-1 text-xs text-slate-500">The customer areas they cover, usually for BD directors.</p>
        </div>
        <div>
          <label className="label">Site role</label>
          {roleSelect(form.role, (role) => setForm({ ...form, role }), 'Site role', 'w-40')}
          <p className="mt-1 text-xs text-slate-500">Admins can manage access and everyone's accounts.</p>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button type="submit" className="hidden" />
      </form>
    </SidePanel>
  );
}
