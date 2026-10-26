import { formatPhoneInput } from '../lib/format.js';
import { useApi } from '../lib/data.js';

export const EMPTY_PROFILE = { first_name: '', last_name: '', email: '', phone: '', username: '', title: '', team_id: '' };


export default function ProfileFields({ value, onChange, disabled }) {
  const { data } = useApi('/teams');
  const teams = data?.teams || [];
  const set = (k) => (e) => onChange({ ...value, [k]: k === 'phone' ? formatPhoneInput(e.target.value) : e.target.value });

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label className="label">First name</label>
        <input className="input" value={value.first_name} onChange={set('first_name')} required disabled={disabled} />
      </div>
      <div>
        <label className="label">Last name</label>
        <input className="input" value={value.last_name} onChange={set('last_name')} required disabled={disabled} />
      </div>
      <div>
        <label className="label">Email</label>
        <input className="input" type="email" value={value.email} onChange={set('email')} required disabled={disabled} />
      </div>
      <div>
        <label className="label">Phone number</label>
        <input className="input" inputMode="tel" placeholder="555-555-5555" value={value.phone || ''} onChange={set('phone')} disabled={disabled} />
      </div>
      <div>
        <label className="label">Username</label>
        <input className="input" value={value.username} onChange={set('username')} required disabled={disabled} autoCapitalize="none" />
        <p className="mt-1 text-xs text-slate-400">Not case sensitive.</p>
      </div>
      <div>
        <label className="label">Title / Position</label>
        <input className="input" value={value.title || ''} onChange={set('title')} disabled={disabled} />
      </div>
      <div>
        <label className="label">Team</label>
        <select className="input" value={value.team_id || ''} onChange={set('team_id')} disabled={disabled}>
          <option value="">Select a team…</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
    </div>
  );
}
