import { useState } from 'react';
import { Users } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';
import Avatar from './Avatar.jsx';

/** The switches, in column order. Each is stored on the person's BD membership (user_teams). */
const FLAGS = [
  { key: 'in_numbers', label: 'BD numbers', help: 'A BD director in the report card, Tactical Meeting Report, targets, compensation and dashboards. Off for people who support BD but don’t sell.' },
  { key: 'in_priorities', label: 'Weekly Priorities', help: 'Has a lane on BD’s Weekly Priorities.' },
  { key: 'in_travel', label: 'Travel', help: 'BD’s leads approve their trips, and their trips and spend count in BD’s travel totals. Off for someone with a travel budget of their own: an admin approves their trips instead.' },
];

function Switch({ on, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} disabled={disabled}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-brand-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

/**
 * BD leads and admins: everyone on the BD team, with what their place on BD counts toward. Everyone counts in all three
 * by default; switch one off to leave someone out of it without taking them off the team.
 */
export default function BdTeamPanel() {
  const users = useApi('/users');
  const teams = useApi('/teams');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const bd = (teams.data?.teams || []).find((t) => t.name === 'BD');
  const members = bd ? (users.data?.users || []).filter((u) => (u.team_ids || []).includes(bd.id))
    .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' })) : [];
  const flagsOf = (u) => u.teams.find((t) => t.id === bd.id) || {};

  const set = async (u, key, value) => {
    setBusy(`${u.id}:${key}`);
    setError('');
    try {
      await api.put(`/users/${u.id}/teams/${bd.id}/flags`, { [key]: value });
      await users.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><Users size={16} className="text-brand-600" /> BD team members</h2>
      <p className="text-xs text-slate-500">
        Everyone on BD counts in all three by default. Switch one off to leave someone out of it while they stay on the team.
        To take someone off BD altogether, change their teams.
      </p>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              {FLAGS.map((f) => <th key={f.key} className="px-3 py-2 text-center font-medium" title={f.help}>{f.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((u) => (
              <tr key={u.id}>
                <td className="px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar user={u} size="sm" />
                    <div className="min-w-0 leading-snug">
                      <div className="truncate font-medium text-slate-800">{fullName(u)}</div>
                      {u.title && <div className="truncate text-xs text-slate-500">{u.title}</div>}
                    </div>
                  </div>
                </td>
                {FLAGS.map((f) => (
                  <td key={f.key} className="px-3 py-2 text-center">
                    <span className="inline-flex"><Switch on={flagsOf(u)[f.key] !== false} disabled={busy === `${u.id}:${f.key}`}
                      label={`${f.label}: ${fullName(u)}`} onChange={(v) => set(u, f.key, v)} /></span>
                  </td>
                ))}
              </tr>
            ))}
            {users.data && teams.data && !members.length && (
              <tr><td colSpan={FLAGS.length + 1} className="px-3 py-6 text-center text-slate-400">No one is on BD yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <ul className="space-y-1 text-xs text-slate-500">
        {FLAGS.map((f) => <li key={f.key}><span className="font-medium text-slate-600">{f.label}:</span> {f.help}</li>)}
      </ul>
    </div>
  );
}
