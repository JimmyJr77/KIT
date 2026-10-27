import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Check, X, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { fullName, stamp, fullStamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

/** Admins only: access requests from the sign-in page, approved accounts, and the team directory. */
export default function AdminAccess() {
  const { user } = useAuth();
  return user.role === 'admin' ? <AdminPage /> : <Navigate to="/settings" replace />;
}

function AdminPage() {
  const approved = useApi('/users/approved');
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title="Admin Access" subtitle="Who can use KIT, and the team directory" />
      <RequestsPanel onApproved={approved.reload} />
      <DirectoryPanel approved={approved} />
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
              <div className="min-w-0 flex-1">
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

function DirectoryPanel({ approved }) {
  const users = useApi('/users');
  const teams = useApi('/teams');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [error, setError] = useState('');

  const approve = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users/approved', { email, role });
      setEmail('');
      approved.reload();
    } catch (err) {
      setError(err.message);
    }
  };
  const revoke = async (em) => {
    if (!confirm(`Revoke access for ${em}?`)) return;
    try { await api.del(`/users/approved/${encodeURIComponent(em)}`); approved.reload(); } catch (err) { setError(err.message); }
  };
  const updateMember = async (u, patch) => {
    try { await api.put(`/users/${u.id}`, { ...u, ...patch }); users.reload(); } catch (err) { setError(err.message); }
  };

  return (
    <div className="panel space-y-6">
      <h2 className="section-title flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /> Access & team directory</h2>

      <div>
        <h3 className="label">Approved accounts</h3>
        <form onSubmit={approve} className="mb-3 flex flex-wrap gap-2">
          <input className="input max-w-xs" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select className="input w-32" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn-primary">Approve email</button>
        </form>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Email</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Status</th><th /></tr>
            </thead>
            <tbody>
              {approved.data?.approved.map((a) => (
                <tr key={a.email} className="border-t border-slate-100">
                  <td className="px-3 py-2">{a.email}</td>
                  <td className="px-3 py-2 capitalize">{a.role}</td>
                  <td className="px-3 py-2">{a.user_id ? <span className="text-emerald-600">Active · {a.first_name} {a.last_name}</span> : <span className="text-slate-400">Awaiting activation</span>}</td>
                  <td className="px-3 py-2 text-right"><button className="btn-ghost p-1.5 text-red-600" onClick={() => revoke(a.email)} title="Revoke"><Trash2 size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="label">Team directory</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Team</th><th className="px-3 py-2">Role</th></tr>
            </thead>
            <tbody>
              {users.data?.users.map((u) => (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-medium">{fullName(u)}<div className="text-xs font-normal text-slate-400">{u.email}</div></td>
                  <td className="px-3 py-2">{u.username}</td>
                  <td className="px-3 py-2">{u.phone}</td>
                  <td className="px-3 py-2">{u.title}</td>
                  <td className="px-3 py-2">
                    <select className="input py-1" value={u.team_id || ''} onChange={(e) => updateMember(u, { team_id: e.target.value })}>
                      <option value="">—</option>
                      {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select className="input py-1" value={u.role} onChange={(e) => updateMember(u, { role: e.target.value })}>
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
