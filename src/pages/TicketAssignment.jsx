import { useState } from 'react';
import { MapPin, UserRound, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';

/** People who can direct a bid: everyone on the BD team, plus whoever the ticket already names. */
function useDirectors(currentId) {
  const users = useApi('/users');
  const all = users.data?.users || [];
  return all.filter((u) => u.teams?.some((t) => t.name === 'BD') || u.id === currentId);
}

/** The BD director, territory and projected win date, for a form. value: { bd_director_id, territory_id, projected_win_date, win_date_undetermined }. */
export function AssignmentFields({ value, onChange }) {
  const directors = useDirectors(Number(value.bd_director_id) || null);
  const territories = useApi('/territories').data?.territories || [];
  return (
    <>
      <div>
        <label className="label">BD director</label>
        <select className="input" value={value.bd_director_id ?? ''} onChange={(e) => onChange({ ...value, bd_director_id: e.target.value })}>
          <option value="">Unassigned</option>
          {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Territory</label>
        <select className="input" value={value.territory_id ?? ''} onChange={(e) => onChange({ ...value, territory_id: e.target.value })}>
          <option value="">No territory</option>
          {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Projected win date</label>
        <input type="date" className="input" value={value.projected_win_date || ''} disabled={!!value.win_date_undetermined}
          onChange={(e) => onChange({ ...value, projected_win_date: e.target.value })} />
      </div>
      <label className="flex items-end gap-2 pb-2.5 text-sm text-slate-600">
        <input type="checkbox" className="accent-brand-600" checked={!!value.win_date_undetermined}
          onChange={(e) => onChange({ ...value, win_date_undetermined: e.target.checked, projected_win_date: e.target.checked ? '' : value.projected_win_date })} />
        Win date undetermined
      </label>
    </>
  );
}

/** At the top of a bid ticket: who directs it, which territory it's in, and when it's expected to be won. Each change saves right away. */
export function AssignmentBar({ ticket, onChanged }) {
  const directors = useDirectors(ticket.bd_director_id);
  const territories = useApi('/territories').data?.territories || [];
  const [error, setError] = useState('');
  const save = async (patch) => {
    setError('');
    try { await api.put(`/tickets/${ticket.id}/assignment`, patch); onChanged(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="space-y-1">
      <div className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
        <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-500">
          <UserRound size={14} className="shrink-0" /> <span className="shrink-0">BD director</span>
          <select className="input min-w-0 py-1 text-sm" value={ticket.bd_director_id ?? ''} onChange={(e) => save({ bd_director_id: e.target.value || null })}>
            <option value="">Unassigned</option>
            {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
          </select>
        </label>
        <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-slate-500">
          <MapPin size={14} className="shrink-0 text-teal-600" /> <span className="shrink-0">Territory</span>
          <select className="input min-w-0 py-1 text-sm" value={ticket.territory_id ?? ''} onChange={(e) => save({ territory_id: e.target.value || null })}>
            <option value="">No territory</option>
            {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <WinDateField ticket={ticket} onSave={save} />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** Projected win date: a date, or Undetermined (it joins the undetermined pool on the dashboard). */
function WinDateField({ ticket, onSave }) {
  const undetermined = !!ticket.win_date_undetermined;
  const missing = !undetermined && !ticket.projected_win_date;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-slate-500 sm:col-span-2">
      <CalendarClock size={14} className="shrink-0" /> <span className="shrink-0">Projected win</span>
      <input type="date" className={`input w-40 py-1 text-sm ${missing ? 'ring-amber-300' : ''}`} value={ticket.projected_win_date || ''}
        disabled={undetermined} aria-label="Projected win date" onChange={(e) => e.target.value && onSave({ projected_win_date: e.target.value })} />
      <label className="flex items-center gap-1.5 font-normal text-slate-600">
        <input type="checkbox" className="accent-brand-600" checked={undetermined} onChange={(e) => onSave({ win_date_undetermined: e.target.checked })} />
        Undetermined
      </label>
      {missing && <span className="font-normal text-amber-700">Not set yet</span>}
    </div>
  );
}
