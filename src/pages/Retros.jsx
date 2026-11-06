import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MessagesSquare, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { shortDate, todayIso } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';

export const STAGE_NAMES = { brainstorm: 'Brainstorm', actions: 'Actions', closed: 'Closed' };
const STAGE_STYLE = { brainstorm: 'bg-amber-50 text-amber-700', actions: 'bg-brand-50 text-brand-700', closed: 'bg-slate-100 text-slate-600' };

/** Open a retro, or (with `board`) change its name and date or delete it. */
export function RetroPanel({ board, templates, onClose, onSaved, onDeleted }) {
  const [form, setForm] = useState({ name: board?.name || '', retro_date: board?.retro_date || todayIso(), template: 'start_stop_continue', hide_notes: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const ready = form.name.trim() && form.retro_date;

  const save = async (e) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      onSaved(board ? await api.put(`/retros/${board.id}`, { name: form.name, retro_date: form.retro_date }) : await api.post('/retros', form));
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete the retro “${board.name}” and its tickets? Lessons already made from it stay.`)) return;
    setBusy(true);
    try {
      await api.del(`/retros/${board.id}`);
      onDeleted();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <SidePanel wide title={board ? 'Retro details' : 'New retro'} subtitle={board ? undefined : 'You’ll be the retro lead. Everyone in KIT can join.'} onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          {board && <button type="button" className="btn-danger" disabled={busy} onClick={remove}><Trash2 size={14} /> Delete</button>}
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          <button type="submit" form="retro-form" className="btn-primary" disabled={!ready || busy}>{busy ? 'Saving…' : board ? 'Save' : 'Open retro'}</button>
        </div>
      )}>
      <form id="retro-form" className="space-y-4" onSubmit={save}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div>
          <label className="label" htmlFor="retro-name">Name</label>
          <input id="retro-name" className="input" maxLength={120} autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="w-44">
          <label className="label" htmlFor="retro-date">Retro date</label>
          <input id="retro-date" type="date" className="input" value={form.retro_date} onChange={(e) => set({ retro_date: e.target.value })} />
        </div>
        {!board && (
          <>
            <div role="radiogroup" aria-label="Format">
              <span className="label">Format</span>
              <div className="space-y-2">
                {templates.map((t) => (
                  <button key={t.key} type="button" role="radio" aria-checked={form.template === t.key} onClick={() => set({ template: t.key })}
                    className={`w-full rounded-lg border bg-white px-3 py-2 text-left transition ${form.template === t.key ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-slate-300'}`}>
                    <div className="text-sm font-semibold text-slate-800">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.hint}</div>
                    {t.lanes.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{t.lanes.map((l) => <span key={l} className="chip">{l}</span>)}</div>}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-0.5" checked={form.hide_notes} onChange={(e) => set({ hide_notes: e.target.checked })} />
              <span>Hide tickets until I reveal them
                <span className="block text-xs text-slate-500">Everyone writes first, so the first ticket doesn’t steer the rest.</span>
              </span>
            </label>
          </>
        )}
      </form>
    </SidePanel>
  );
}

/** Every retro, newest first. */
export default function Retros() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const load = () => api.get('/retros').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const remove = async (e, b) => {
    e.stopPropagation();
    if (!confirm(`Delete the retro “${b.name}” and its tickets? Lessons already made from it stay.`)) return;
    setError('');
    try {
      await api.del(`/retros/${b.id}`);
      load();
    } catch (err) { setError(err.message); }
  };
  const boards = data?.boards;

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Retrospectives" subtitle="Post a thought, thumbs up what matters, turn the best into Lessons Learned.">
        <button className="btn-primary" disabled={!data} onClick={() => setCreating(true)}><Plus size={16} /> New retro</button>
      </PageHeader>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-400">Loading retros…</p>}
      {boards && !boards.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <MessagesSquare size={28} className="mx-auto mb-2 text-slate-300" />
          No retros yet. Open the first one.
        </div>
      )}
      {boards?.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>{['Retro', 'Date', 'Format', 'Lead', 'Stage', 'Tickets', 'Lessons'].map((h) => <th key={h} className="px-4 py-3">{h}</th>)}<th aria-label="Delete" /></tr>
            </thead>
            <tbody>
              {boards.map((b) => (
                <tr key={b.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => navigate(`/retros/${b.id}`)}>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{shortDate(b.retro_date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-4 py-3 text-slate-600">{data.templates.find((t) => t.key === b.template)?.name}</td>
                  <td className="px-4 py-3 text-slate-600">{b.lead || '—'}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STAGE_STYLE[b.stage]}`}>{STAGE_NAMES[b.stage]}</span></td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{b.tickets}</td>
                  <td className="px-4 py-3 text-slate-600 tabular-nums">{b.lessons}</td>
                  <td className="px-2 py-2 text-right">
                    {b.can_delete && <button type="button" className="btn-ghost p-1.5" aria-label={`Delete ${b.name}`} title="Delete retro" onClick={(e) => remove(e, b)}><Trash2 size={14} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <RetroPanel templates={data.templates} onClose={() => setCreating(false)} onSaved={(d) => navigate(`/retros/${d.id}`)} />}
    </div>
  );
}
