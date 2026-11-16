import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate, stamp } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import { TagFilter, byTags } from '../components/Labels.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import { PipelineViewToggle, TicketSearch } from './ProcessView.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));
// The standings someone sets while the deal is open. A deal that's paid or closed reads Closed instead.
const STATUSES = [
  { key: 'on_track', label: 'On-Track', tone: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  { key: 'off_up', label: 'Off-Track Trending Up', tone: 'bg-lime-50 text-lime-800 ring-lime-200' },
  { key: 'off_steady', label: 'Off-Track Steady', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { key: 'off_down', label: 'Off-Track Trending Down', tone: 'bg-red-50 text-red-700 ring-red-200' },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s]));
const CLOSED = { label: 'Closed', tone: 'bg-slate-200 text-slate-700 ring-slate-300' };
// Where the deal has got to, shown as the category in place of the stage.
const OUTCOMES = {
  awarded: { label: 'Awarded', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  paid: { label: 'Paid (Won)', tone: 'bg-emerald-600 text-white ring-emerald-600' },
  closed: { label: 'Closed - Not awarded', tone: 'bg-slate-200 text-slate-700 ring-slate-300' },
};
const UNSET = 'bg-white text-slate-500 ring-slate-300';
/** "18 mo", "5 yr", or the deal's own wording when it can't be read as months. */
const duration = (r) => (r.term_months ? (r.term_months % 12 === 0 ? `${r.term_months / 12} yr` : `${r.term_months} mo`) : r.term_text || '—');
const closeDate = (iso) => (iso ? shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
// Ways to order the table. `dir` is the direction each starts in; rows missing the value sorted on go to the bottom either
// way, and ties go by name. Status runs On-Track down to Off-Track Trending Down, then not set, then Closed.
const STATUS_RANK = { on_track: 0, off_up: 1, off_steady: 2, off_down: 3 };
const SORTS = {
  name: { label: 'Name', dir: 'asc', of: (r) => r.title.trim().toLowerCase() || null },
  added: { label: 'Date added', dir: 'desc', of: (r) => r.added_at || null },
  close: { label: 'Est. close date', dir: 'asc', of: (r) => r.close_date || null },
  status: { label: 'Status', dir: 'asc', of: (r) => (r.closed ? 5 : STATUS_RANK[r.status] ?? 4) },
};
const compareBy = ({ key, dir }) => (a, b) => {
  const x = SORTS[key].of(a);
  const y = SORTS[key].of(b);
  if (x == null || y == null) return ((x == null) - (y == null)) || a.title.localeCompare(b.title);
  const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
  return (dir === 'asc' ? c : -c) || a.title.localeCompare(b.title);
};
const savedSort = () => {
  try {
    const v = JSON.parse(localStorage.getItem('kit.c2c.sort'));
    if (SORTS[v?.key] && ['asc', 'desc'].includes(v.dir)) return v;
  } catch { /* none saved */ }
  return { key: 'close', dir: 'asc' };
};

/**
 * Close to closing: every pipeline ticket in Under Evaluation, plus any added by hand, as a table to walk down. A ticket
 * stays on the list when its deal closes; its category then follows the deal and its status reads Closed. Notes are the ticket's own comments and notes.
 */
export default function CloseToClosing() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const take = (d) => setRows(d.rows);
  const load = () => api.get('/c2c').then(take).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (call) => { setError(''); try { take(await call()); } catch (e) { setError(e.message); } };

  const [q, setQ] = useState('');
  const [tags, setTags] = useState([]);
  const [sort, setSortState] = useState(savedSort);
  const setSort = (v) => { setSortState(v); try { localStorage.setItem('kit.c2c.sort', JSON.stringify(v)); } catch { /* not kept */ } };
  // A column heading sorts by it; clicking the one already sorted on reverses it.
  const sortOn = (key) => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: SORTS[key].dir });

  const sorted = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (rows || []).filter((r) => !words || `${r.title} ${r.organization || ''}`.toLowerCase().includes(words)).filter(byTags(tags)).sort(compareBy(sort));
  }, [rows, q, tags, sort]);
  const listed = useMemo(() => new Set((rows || []).map((r) => r.ticket_id)), [rows]);
  const open = sorted.filter((r) => !r.closed);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <PageHeader title="Close to closing" subtitle="Every ticket in Under Evaluation, plus any you add. A ticket stays here when its deal closes.">
          <PipelineViewToggle />
        </PageHeader>
        <div className="flex flex-wrap items-center gap-4">
          <TicketSearch value={null} skip={listed} placeholder="Add a ticket: search by opportunity or organization…"
            onChange={(t) => t && run(() => api.post('/c2c', { ticket_id: t.id }))} />
          {rows && <span className="text-sm text-slate-500">{open.length} open · <span className="font-medium text-emerald-700 tabular-nums">{money(open.reduce((s, r) => s + (r.value || 0), 0))}</span></span>}
          {error && <span className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full max-w-xs">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search this list…" aria-label="Search this list" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <TagFilter value={tags} onChange={setTags} className="w-72" />
          <div className="flex items-center gap-1">
            <select className="input h-[38px] w-44 py-0" aria-label="Sort the list" value={sort.key}
              onChange={(e) => setSort({ key: e.target.value, dir: SORTS[e.target.value].dir })}>
              {Object.entries(SORTS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
            </select>
            <button type="button" className="btn h-[38px] w-[38px] shrink-0 p-0" onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
              title={`${sort.dir === 'asc' ? 'Ascending' : 'Descending'} (click to reverse)`} aria-label={`${sort.dir === 'asc' ? 'Ascending' : 'Descending'}. Reverse the order.`}>
              {sort.dir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full min-w-[68rem] table-fixed text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="w-[22%] px-4 py-2.5"><SortHead k="name" sort={sort} onSort={sortOn}>Opportunity</SortHead></th>
                <th className="w-28 px-3 py-2.5 text-right">Value</th>
                <th className="w-24 px-3 py-2.5">Duration</th>
                <th className="w-36 px-3 py-2.5">Category</th>
                <th className="w-36 px-3 py-2.5 whitespace-nowrap"><SortHead k="close" sort={sort} onSort={sortOn}>Est. Close Date</SortHead></th>
                <th className="w-52 px-3 py-2.5"><SortHead k="status" sort={sort} onSort={sortOn}>Status</SortHead></th>
                <th className="px-3 py-2.5">Notes</th>
                <th className="w-9" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Nothing is in Under Evaluation yet. Add a ticket with the search above.</td></tr>}
              {rows?.length > 0 && !sorted.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No tickets on the list match.</td></tr>}
              {sorted.map((r) => (
                <Row key={r.ticket_id} row={r} selected={openId === r.ticket_id} onOpen={() => setOpenId(r.ticket_id)} run={run} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openId && <TicketTimeline key={openId} ticketId={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
    </div>
  );
}

/** A column heading that sorts the table by its column, with an arrow while it's the one sorted on. */
function SortHead({ k, sort, onSort, children }) {
  const on = sort.key === k;
  return (
    <button type="button" onClick={() => onSort(k)} title={`Sort by ${SORTS[k].label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 tracking-wide uppercase hover:text-slate-800 ${on ? 'text-slate-800' : ''}`}>
      {children}{on && (sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
    </button>
  );
}

function Row({ row: r, selected, onOpen, run, onError }) {
  const status = r.closed ? CLOSED : STATUS[r.status];
  const outcome = OUTCOMES[r.outcome];
  const stop = (e) => e.stopPropagation();
  return (
    <tr onClick={onOpen} className={`cursor-pointer align-top transition ${selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
      <td className="px-4 py-3">
        <button type="button" className="text-left font-semibold text-slate-900 hover:text-brand-700">{r.title}</button>
        <div className="mt-0.5 text-xs text-slate-500">{[r.organization, r.owner && fullName(r.owner)].filter(Boolean).join(' · ')}</div>
      </td>
      <td className="px-3 py-3 text-right font-medium whitespace-nowrap text-emerald-700 tabular-nums">{money(r.value)}</td>
      <td className="px-3 py-3 text-slate-700" title={r.term_text || undefined}>{duration(r)}</td>
      <td className="px-3 py-3 text-slate-700">
        {outcome ? <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${outcome.tone}`} title={r.outcome === 'awarded' ? undefined : `Was in ${r.stage}`}>{outcome.label}</span> : r.stage || '—'}
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-slate-700">{closeDate(r.close_date)}</td>
      <td className="px-3 py-3" onClick={stop}>
        {r.closed || !r.can_edit ? (
          <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ring-1 ${status?.tone || UNSET}`}
            title={r.closed ? 'The deal is closed' : 'Only the ticket’s owner or an admin sets the status'}>{status?.label || 'Not set'}</span>
        ) : (
          <select aria-label={`Status of ${r.title}`} value={r.status || ''}
            onChange={(e) => run(() => api.put(`/c2c/${r.ticket_id}`, { status: e.target.value || null }))}
            className={`max-w-full cursor-pointer rounded-full border-0 py-1 pr-7 pl-2.5 text-xs font-semibold ring-1 ${status?.tone || UNSET}`}>
            <option value="">Not set</option>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
      </td>
      <td className="px-3 py-3" onClick={stop}><Notes row={r} run={run} onError={onError} /></td>
      <td className="py-3 pr-2" onClick={stop}>
        {!r.evaluating && (
          <button type="button" aria-label={`Take ${r.title} off the list`} title="Take off this list"
            onClick={() => confirm(`Take “${r.title}” off Close to closing? The ticket itself isn’t changed.`) && run(() => api.del(`/c2c/${r.ticket_id}`))}
            className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>
        )}
      </td>
    </tr>
  );
}

/** The note a row shows (the latest unless another is picked), with Add and Edit. Notes save to the ticket itself. */
function Notes({ row: r, run, onError }) {
  const [draft, setDraft] = useState(null); // { id: note being edited, or null for a new one, body }
  const [busy, setBusy] = useState(false);
  const shown = r.notes.find((n) => n.id === r.note_id) || r.notes[0] || null;
  const label = (n) => `${stamp(n.created_at)}${n.author ? ` · ${fullName(n.author)}` : ''}: ${n.body.replace(/\s+/g, ' ').slice(0, 50)}`;

  const save = async () => {
    const body = draft.body.trim();
    if (!body || busy) return;
    setBusy(true);
    onError('');
    try {
      if (draft.id) await api.put(`/tickets/comments/${draft.id}`, { body });
      else {
        await api.post(`/tickets/${r.ticket_id}/comments`, { body, kind: 'comment' });
        if (r.note_id) await api.put(`/c2c/${r.ticket_id}`, { note_id: null }); // a new note is the latest: show it
      }
      setDraft(null);
      await run(() => api.get('/c2c'));
    } catch (e) { onError(e.message); } finally { setBusy(false); }
  };

  if (draft) {
    return (
      <div className="space-y-1.5">
        <textarea autoFocus className="input min-h-20 text-sm" value={draft.body} placeholder="Write a note. It saves to the ticket."
          aria-label={draft.id ? 'Edit note' : 'New note'} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); if (e.key === 'Escape') setDraft(null); }} />
        <div className="flex gap-1.5">
          <button type="button" className="btn-primary px-2.5 py-1 text-xs" disabled={busy || !draft.body.trim()} onClick={save}>{draft.id ? 'Save' : 'Add note'}</button>
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {shown ? (
        <>
          <div className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-slate-700" title={shown.body}><MentionText text={shown.body} /></div>
          <div className="text-[11px] text-slate-400">{[shown.author && fullName(shown.author), stamp(shown.created_at), shown.updated_at && 'edited'].filter(Boolean).join(' · ')}</div>
        </>
      ) : <div className="text-sm text-slate-400">No notes yet</div>}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setDraft({ id: null, body: '' })}><Plus size={12} /> Add</button>
        {shown && (
          <button type="button" className="btn px-2 py-0.5 text-xs" disabled={!shown.mine} onClick={() => setDraft({ id: shown.id, body: shown.body })}
            title={shown.mine ? 'Edit this note' : 'Only the person who wrote a note can edit it'}><Pencil size={12} /> Edit</button>
        )}
        {r.notes.length > 1 && (
          <select aria-label={`Note shown for ${r.title}`} value={r.note_id || ''} title="Which note this row shows"
            onChange={(e) => run(() => api.put(`/c2c/${r.ticket_id}`, { note_id: Number(e.target.value) || null }))}
            className="input h-6 w-44 max-w-full min-w-0 py-0 pr-6 pl-2 text-xs">
            <option value="">Latest note</option>
            {r.notes.map((n) => <option key={n.id} value={n.id}>{label(n)}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
