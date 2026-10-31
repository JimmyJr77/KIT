import { useEffect, useState } from 'react';
import { Flag, MapPin, Plus, Trash2, CalendarDays } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate, todayIso } from '../lib/format.js';
import SidePanel from '../components/SidePanel.jsx';

const STATUS_TINT = {
  'Not started': 'bg-slate-100 text-slate-600',
  'In progress': 'bg-sky-50 text-sky-800',
  Achieved: 'bg-emerald-50 text-emerald-700',
  Missed: 'bg-red-50 text-red-700',
};
const overdue = (o) => o.target_date && o.target_date < todayIso() && !['Achieved', 'Missed'].includes(o.status);

/**
 * Account development: what each BD director is working toward with a customer (access, relationships, shaping demand),
 * by when, and whether it happened.
 */
export default function AccountObjectives() {
  const { user } = useAuth();
  const users = useApi('/users');
  const territories = useApi('/territories').data?.territories || [];
  const [owner, setOwner] = useState('');
  const [territory, setTerritory] = useState('');
  const [status, setStatus] = useState('open');
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // an objective, or { new: true }

  const load = () => {
    const p = new URLSearchParams({ status });
    if (owner) p.set('owner', owner);
    if (territory) p.set('territory', territory);
    return api.get(`/objectives?${p}`).then(setData);
  };
  useEffect(() => { load(); }, [owner, territory, status]); // eslint-disable-line react-hooks/exhaustive-deps

  const directors = (users.data?.users || []).filter((u) => u.teams?.some((t) => t.name === 'BD'));
  const list = data?.objectives || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-[38px] w-48 py-0 text-sm" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="BD director">
          <option value="">All BD directors</option>
          {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
        </select>
        <select className="input h-[38px] w-52 py-0 text-sm" value={territory} onChange={(e) => setTerritory(e.target.value)} aria-label="Territory">
          <option value="">All territories</option>
          {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['open', 'Open'], ['done', 'Done'], ['', 'All']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className={`rounded px-3 ${status === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
        <button type="button" className="btn-primary h-[38px]" onClick={() => setEditing({ new: true, owner_id: directors.some((u) => u.id === user.id) ? user.id : '' })}>
          <Plus size={16} /> New objective
        </button>
      </div>

      {data && !list.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Flag size={28} className="mx-auto mb-2 text-slate-300" />
          {status === 'done' ? 'Nothing achieved or missed yet.' : 'No account objectives yet. Add one for each customer you\'re building access with.'}
        </div>
      )}

      {list.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[38rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr><th className="px-4 py-2.5">Customer</th><th className="px-4 py-2.5">Objective</th><th className="px-4 py-2.5">BD director</th><th className="px-4 py-2.5">Target</th><th className="px-4 py-2.5">Status</th></tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="cursor-pointer border-t border-slate-100 align-top hover:bg-brand-50/40" onClick={() => setEditing(o)}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-800">{o.organization}</div>
                    {o.territory_name && <div className="mt-0.5 flex items-center gap-1 text-xs text-teal-700"><MapPin size={11} /> {o.territory_name}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{o.objective}</td>
                  <td className="px-4 py-2.5 text-slate-600">{o.owner ? fullName(o.owner) : '—'}</td>
                  <td className={`px-4 py-2.5 whitespace-nowrap ${overdue(o) ? 'font-medium text-red-700' : 'text-slate-600'}`}>
                    {o.target_date ? shortDate(o.target_date, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}{overdue(o) && ' · overdue'}
                  </td>
                  <td className="px-4 py-2.5"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_TINT[o.status]}`}>{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ObjectivePanel objective={editing} directors={directors} territories={territories} statuses={data?.statuses || []}
          organizations={data?.organizations || []} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function ObjectivePanel({ objective, directors, territories, statuses, organizations, onClose, onSaved }) {
  const isNew = !!objective.new;
  const [form, setForm] = useState({
    organization: objective.organization || '', objective: objective.objective || '', owner_id: objective.owner_id ?? '',
    territory_id: objective.territory_id ?? '', target_date: objective.target_date || '', status: objective.status || 'Not started', notes: objective.notes || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (isNew) await api.post('/objectives', form); else await api.put(`/objectives/${objective.id}`, form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm('Delete this objective?')) return;
    await api.del(`/objectives/${objective.id}`);
    onSaved();
  };
  return (
    <SidePanel title={isNew ? 'New account objective' : 'Account objective'} subtitle="What we're working toward with this customer, and by when" onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" className="btn-primary flex-1" onClick={save} disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add objective' : 'Save changes'}</button>
          {!isNew && <button type="button" className="btn-danger" onClick={remove} aria-label="Delete objective"><Trash2 size={15} /></button>}
        </div>
      )}>
      <form onSubmit={save} className="space-y-4">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div>
          <label className="label">Customer organization *</label>
          <input className="input" list="objective-orgs" value={form.organization} onChange={set('organization')} autoFocus={isNew} />
          <datalist id="objective-orgs">{organizations.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
        <div>
          <label className="label">Objective *</label>
          <textarea className="input min-h-20 text-sm" value={form.objective} onChange={set('objective')}
            placeholder="e.g. Brief the PEO on our data platform; meet the new contracting officer; get our approach into the draft requirement" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">BD director</label>
            <select className="input" value={form.owner_id} onChange={set('owner_id')}>
              <option value="">Unassigned</option>
              {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Territory</label>
            <select className="input" value={form.territory_id} onChange={set('territory_id')}>
              <option value="">No territory</option>
              {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label flex items-center gap-1"><CalendarDays size={12} /> Target date</label>
            <input type="date" className="input" value={form.target_date} onChange={set('target_date')} />
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input" value={form.status} onChange={set('status')}>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="label">Progress notes</label>
          <textarea className="input min-h-24 text-sm" value={form.notes} onChange={set('notes')} placeholder="Who you've met, what's next, what's in the way…" />
        </div>
        <button type="submit" className="hidden" />
      </form>
    </SidePanel>
  );
}
