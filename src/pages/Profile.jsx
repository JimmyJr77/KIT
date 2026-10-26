import { useState } from 'react';
import { Check, X, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';
import ProfileFields from '../components/ProfileFields.jsx';
import PageHeader from '../components/PageHeader.jsx';

const pick = (u) => ({
  first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '',
  username: u.username, title: u.title || '', team_id: u.team_id || '',
});

export default function Profile() {
  const { user, setUser } = useAuth();
  const [form, setForm] = useState(pick(user));
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    try {
      const d = await api.put('/users/me', form);
      setUser(d.user);
      setMsg({ ok: true, text: 'Profile saved' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title="Profile" subtitle="Your contact details and team" />
      <form onSubmit={save} className="panel space-y-5">
        <ProfileFields value={form} onChange={setForm} />
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save profile</button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </form>
      <PasswordPanel />
      <IntegrationsPanel />
      {user.role === 'admin' && <AdminPanel />}
    </div>
  );
}

function PasswordPanel() {
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/users/me/password', pw);
      setPw({ current: '', next: '' });
      setMsg({ ok: true, text: 'Password updated' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };
  return (
    <form onSubmit={save} className="panel">
      <h2 className="section-title mb-4">Change password</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <input className="input" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        <input className="input" type="password" placeholder="New password (8+ chars)" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        <button className="btn">Update password</button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
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

function AdminPanel() {
  const approved = useApi('/users/approved');
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
      <h2 className="section-title flex items-center gap-2"><ShieldCheck size={16} className="text-brand-600" /> Admin · Access & team directory</h2>

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
