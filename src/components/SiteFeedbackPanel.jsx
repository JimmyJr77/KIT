import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, Archive, ArchiveRestore, Trash2, Check } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, stamp, fullStamp } from '../lib/format.js';

const FILTERS = [
  ['open', 'Open'],
  ['done', 'Done'],
  ['archived', 'Archived'],
];
const inFilter = (f, filter) => (filter === 'archived' ? !!f.archived_at : !f.archived_at && (filter === 'done' ? !!f.done_at : !f.done_at));

/**
 * The Developer section of Admin Access: what people sent through the KITT feedback widget, worked like tickets. Check
 * one off when it's done, then archive it (one at a time, or every done one at once). Archived ones can come back or be
 * deleted for good. `feedback` is the useApi('/feedback') result, shared with the page so its tab can show the open count.
 */
export default function SiteFeedbackPanel({ feedback }) {
  const [filter, setFilter] = useState('open');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const all = feedback.data?.feedback || [];
  const count = (k) => all.filter((f) => inFilter(f, k)).length;
  const shown = all.filter((f) => inFilter(f, filter));

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    try { await fn(); feedback.reload(); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const update = (f, patch) => run(f.id, () => api.put(`/feedback/${f.id}`, patch));
  const remove = (f) => {
    if (!confirm(`Delete this feedback from ${f.user ? fullName(f.user) : 'a former user'} for good? This can't be undone.`)) return;
    run(f.id, () => api.del(`/feedback/${f.id}`));
  };
  const archiveDone = () => run('all', () => api.post('/feedback/archive-done'));

  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto flex items-center gap-2">
          <MessageSquareText size={16} className="text-brand-600" /> Site feedback
        </h2>
        <div className="flex rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200" role="radiogroup" aria-label="Show feedback">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)}
              className={`rounded px-2.5 py-1 whitespace-nowrap ${filter === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {label} <span className={filter === k ? 'text-white/80' : 'text-slate-400'}>{count(k)}</span>
            </button>
          ))}
        </div>
        {filter === 'done' && count('done') > 0 && (
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={archiveDone} disabled={busy === 'all'}>
            <Archive size={13} /> Archive all done
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">Issues and suggestions sent through KITT in the corner of every page. Check one off when it's fixed, then archive it.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {feedback.data && !shown.length && (
        <p className="py-4 text-center text-sm text-slate-400">
          {{ open: all.length ? 'All caught up. Nothing open.' : 'Nothing sent yet.', done: 'Nothing checked off and waiting to be archived.', archived: 'Nothing archived yet.' }[filter]}
        </p>
      )}
      {shown.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {shown.map((f) => {
            const done = !!f.done_at;
            const archived = !!f.archived_at;
            return (
              <li key={f.id} className="flex items-start gap-3 px-3 py-3">
                <button type="button" role="checkbox" aria-checked={done} disabled={busy === f.id || archived}
                  onClick={() => update(f, { done: !done })}
                  title={archived ? undefined : done ? 'Mark not done' : 'Mark done'} aria-label={`Feedback FB-${f.id} done`}
                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white hover:border-brand-500'} ${archived ? 'opacity-60' : ''}`}>
                  {done && <Check size={13} strokeWidth={3} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-slate-500">
                    <span className="font-mono text-slate-400">FB-{f.id}</span>
                    {' · '}<span className="font-semibold text-slate-800">{f.user ? fullName(f.user) : 'Former user'}</span>
                    {' · '}<span title={fullStamp(f.created_at)}>{stamp(f.created_at)}</span>
                    {f.path && <>{' · '}<Link to={f.path} className="font-mono text-brand-600 hover:underline">{f.path}</Link></>}
                  </div>
                  <p className={`mt-1 text-sm whitespace-pre-wrap ${done ? 'text-slate-500 line-through decoration-slate-300' : 'text-slate-700'}`}>{f.message}</p>
                  {(done || archived) && (
                    <div className="mt-1 text-[11px] text-slate-400">
                      {done && <span title={fullStamp(f.done_at)}>Done {f.done_by ? `by ${fullName(f.done_by)} ` : ''}{stamp(f.done_at)}</span>}
                      {done && archived && ' · '}
                      {archived && <span title={fullStamp(f.archived_at)}>Archived {stamp(f.archived_at)}</span>}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {archived ? (
                    <>
                      <button type="button" className="btn-ghost p-1.5 text-slate-500 hover:text-slate-800" onClick={() => update(f, { archived: false })} disabled={busy === f.id}
                        title="Unarchive" aria-label={`Unarchive FB-${f.id}`}><ArchiveRestore size={15} /></button>
                      <button type="button" className="btn-ghost p-1.5 text-slate-400 hover:text-red-600" onClick={() => remove(f)} disabled={busy === f.id}
                        title="Delete for good" aria-label={`Delete FB-${f.id}`}><Trash2 size={15} /></button>
                    </>
                  ) : (
                    <button type="button" className={`btn-ghost p-1.5 ${done ? 'text-brand-600 hover:text-brand-800' : 'text-slate-400 hover:text-slate-700'}`}
                      onClick={() => update(f, { archived: true })} disabled={busy === f.id}
                      title="Archive" aria-label={`Archive FB-${f.id}`}><Archive size={15} /></button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
