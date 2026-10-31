import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ProfileFields from '../components/ProfileFields.jsx';
import PageHeader from '../components/PageHeader.jsx';

const pick = (u) => ({
  first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '',
  username: u.username, title: u.title || '', team_ids: u.team_ids || [],
});

/** Team id → 'member' | 'lead', for coloring someone's team tags. */
export const rolesOf = (u) => Object.fromEntries((u?.teams || []).map((t) => [t.id, t.role]));

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
        <ProfileFields value={form} onChange={setForm} roles={rolesOf(user)} />
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save profile</button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </form>
      <PasswordPanel />
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
