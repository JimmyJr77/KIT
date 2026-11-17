import { useEffect, useMemo, useState } from 'react';
import { X, Search, ArrowUp, ArrowDown, Download, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import MultiSelect from '../components/MultiSelect.jsx';
import { fullName, shortDate, stamp, todayIso } from '../lib/format.js';
import { usd, quarterFor } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import { nameOnLight } from '../lib/brand.js';
import { TagFilter, byTags, LabelList } from '../components/Labels.jsx';
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
/** The note a row shows: the one picked for it, else its latest. */
const shownNote = (r) => r.notes.find((n) => n.id === r.note_id) || r.notes[0] || null;
const closeDate = (iso) => (iso ? shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
// Ways to order the table. `dir` is the direction each starts in; rows missing the value sorted on go to the bottom either
// way, and ties go by name. Status runs On-Track down to Off-Track Trending Down, then not set, then Closed.
const STATUS_RANK = { on_track: 0, off_up: 1, off_steady: 2, off_down: 3 };
const SORTS = {
  name: { label: 'Name', dir: 'asc', of: (r) => r.title.trim().toLowerCase() || null },
  added: { label: 'Date added', dir: 'desc', of: (r) => r.added_at || null },
  close: { label: 'Est. close date', dir: 'asc', of: (r) => r.close_date || null },
  value: { label: 'Value', dir: 'desc', of: (r) => (r.value == null ? null : Number(r.value)) },
  status: { label: 'Status', dir: 'asc', of: (r) => (r.closed ? 5 : STATUS_RANK[r.status] ?? 4) },
};
/** This calendar quarter and the three after it: ["2026 Q4", "2027 Q1", …]. */
function comingQuarters(today = todayIso()) {
  const [y, m] = today.split('-').map(Number);
  const first = y * 4 + Math.floor((m - 1) / 3);
  return [0, 1, 2, 3].map((i) => `${Math.floor((first + i) / 4)} Q${((first + i) % 4) + 1}`);
}
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

  const users = useApi('/users');
  const territories = useApi('/territories');
  const [scope, setScope] = useState('all'); // 'mine': tickets I own, direct or have a priority card on
  const [filters, setFilters] = useState([]); // "o:<user id>" for account owners, "t:<territory id>" for territories
  // BD account owners (everyone on the BD team), alphabetical, then the territories (Pipedrive's "Account"), as on the board.
  const filterOptions = useMemo(() => [
    ...(users.data?.users || []).filter((u) => (u.teams || []).some((t) => t.name === 'BD'))
      .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }))
      .map((u) => ({ value: `o:${u.id}`, label: fullName(u), group: 'BD account owners' })),
    ...(territories.data?.territories || []).map((t) => ({ value: `t:${t.id}`, label: t.name, group: 'Territories' })),
  ], [users.data, territories.data]);
  const [q, setQ] = useState('');
  const [tags, setTags] = useState([]);
  const [sort, setSortState] = useState(savedSort);
  const setSort = (v) => { setSortState(v); try { localStorage.setItem('kit.c2c.sort', JSON.stringify(v)); } catch { /* not kept */ } };
  // A column heading sorts by it; clicking the one already sorted on reverses it.
  const sortOn = (key) => setSort(sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: SORTS[key].dir });

  const [quarter, setQuarter] = useState(''); // '' for every ticket, or a quarter its est. close date must fall in
  const quarters = useMemo(() => comingQuarters(), []);

  const sorted = useMemo(() => {
    const words = q.trim().toLowerCase();
    const owners = filters.filter((f) => f.startsWith('o:')).map((f) => Number(f.slice(2)));
    const terrs = filters.filter((f) => f.startsWith('t:')).map((f) => Number(f.slice(2)));
    return (rows || []).filter((r) => scope === 'all' || r.mine)
      .filter((r) => (!owners.length || owners.includes(r.owner?.id)) && (!terrs.length || terrs.includes(r.territory_id)))
      .filter((r) => !words || `${r.title} ${r.organization || ''}`.toLowerCase().includes(words)).filter(byTags(tags))
      .filter((r) => !quarter || quarterFor(r.close_date) === quarter).sort(compareBy(sort));
  }, [rows, q, tags, sort, quarter, scope, filters]);
  const listed = useMemo(() => new Set((rows || []).map((r) => r.ticket_id)), [rows]);
  const open = sorted.filter((r) => !r.closed);
  const openRow = openId && rows?.find((r) => r.ticket_id === openId);

  // Downloaded as a PDF, the list is in the order and with the filters the page has now, on landscape sheets.
  const [building, setBuilding] = useState(false);
  const download = async () => {
    setBuilding(true);
    setError('');
    try {
      const { downloadC2cPdf } = await import('../lib/c2cPdf.js');
      await downloadC2cPdf({
        fileName: `Close to closing ${todayIso()}.pdf`,
        date: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
        summary: summaryLine, logo: nameOnLight,
        rows: sorted.map((r) => {
          const note = shownNote(r);
          return {
            title: r.title, sub: [r.organization, r.owner && fullName(r.owner)].filter(Boolean).join(' · '), tags: (r.labels || []).join(' · '),
            value: money(r.value), duration: duration(r), category: OUTCOMES[r.outcome]?.label || r.stage || '—', closeDate: closeDate(r.close_date),
            status: r.closed ? CLOSED.label : STATUS[r.status]?.label || 'Not set',
            note: note?.body || '', noteBy: note ? [note.author && fullName(note.author), stamp(note.created_at)].filter(Boolean).join(' · ') : '',
          };
        }),
      });
    } catch (e) { setError(`Couldn’t make the PDF: ${e.message}`); } finally { setBuilding(false); }
  };
  // Printed from the browser, the table goes on landscape sheets too.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@media print { @page { size: letter landscape; margin: 0.4in; } }';
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const openTotal = money(sorted.filter((r) => !r.closed).reduce((s, r) => s + (r.value || 0), 0));
  const narrowed = [scope === 'mine' && 'my tickets', filters.length && filterOptions.filter((o) => filters.includes(o.value)).map((o) => o.label).join(', '), q.trim() && `matching “${q.trim()}”`, tags.length && `tagged ${tags.join(', ')}`, quarter && `closing ${quarter}`].filter(Boolean);
  const summaryLine = `${sorted.length} ${sorted.length === 1 ? 'opportunity' : 'opportunities'} · ${sorted.filter((r) => !r.closed).length} open · ${openTotal}${narrowed.length ? ` · ${narrowed.join(', ')}` : ''} · sorted by ${SORTS[sort.key].label.toLowerCase()}, ${sort.dir === 'asc' ? 'ascending' : 'descending'}`;

  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      {/* The printed sheet's heading: what's listed, how it's narrowed and ordered, and when it was printed. */}
      <div className="hidden print:mb-3 print:block">
        <div className="flex items-center justify-between gap-4">
          <img src={nameOnLight} alt="Knexus" className="h-5 w-auto" />
          <div className="text-[9px] font-semibold tracking-wide text-brand-700 uppercase">KIT · Close to closing</div>
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-bold text-slate-900">Close to closing</h1>
          <span className="text-[10px] text-slate-500">Prepared {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</span>
        </div>
        <p className="text-[10px] text-slate-600">{summaryLine}</p>
      </div>
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4 print:hidden">
        <PageHeader title="Close to closing" subtitle="Every ticket in Under Evaluation, plus any you add. A ticket stays here when its deal closes.">
          <div className="w-80 text-left">
            <MultiSelect compact options={filterOptions} value={filters} onChange={setFilters} placeholder="Filter by account owner or territory…" />
          </div>
          <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
            {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScope(k)}
                className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
          <button type="button" className="btn h-9 py-0" onClick={download} disabled={!rows || building} title="Download the list as a PDF, as it's ordered and narrowed now">
            {building ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} Download
          </button>
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
          <select className="input h-[38px] w-48 py-0" aria-label="Show tickets expected to close in" title="Narrow the list by est. close date" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            <option value="">All close dates</option>
            {quarters.map((k, i) => <option key={k} value={k}>{k}{i === 0 ? ' (current)' : ''}</option>)}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6 print:overflow-visible print:bg-white print:p-0">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible print:rounded-none print:border-0">
          <table className="w-full min-w-[68rem] table-fixed text-left text-sm print:min-w-0 print:text-[10px]">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase print:border-slate-400 print:text-[8px]">
              <tr>
                <th className="w-[22%] px-4 py-2.5 print:w-[23%] print:px-1.5 print:py-1"><SortHead k="name" sort={sort} onSort={sortOn}>Opportunity</SortHead></th>
                <th className="w-28 px-3 py-2.5 text-right print:w-[9%] print:px-1.5 print:py-1"><SortHead k="value" sort={sort} onSort={sortOn}>Value</SortHead></th>
                <th className="w-24 px-3 py-2.5 print:w-[7%] print:px-1.5 print:py-1">Duration</th>
                <th className="w-36 px-3 py-2.5 print:w-[11%] print:px-1.5 print:py-1">Category</th>
                <th className="w-36 px-3 py-2.5 whitespace-nowrap print:w-[10%] print:px-1.5 print:py-1"><SortHead k="close" sort={sort} onSort={sortOn}>Est. Close Date</SortHead></th>
                <th className="w-52 px-3 py-2.5 print:w-[13%] print:px-1.5 print:py-1"><SortHead k="status" sort={sort} onSort={sortOn}>Status</SortHead></th>
                <th className="px-3 py-2.5 print:px-1.5 print:py-1">Notes</th>
                <th className="w-9 print:hidden" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 print:divide-slate-300">
              {rows === null && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Nothing is in Under Evaluation yet. Add a ticket with the search above.</td></tr>}
              {rows?.length > 0 && !sorted.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No tickets on the list match.</td></tr>}
              {sorted.map((r) => (
                <Row key={r.ticket_id} row={r} selected={openId === r.ticket_id} onOpen={() => setOpenId(r.ticket_id)} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* In the pane, any comment or note can be picked as the one its row shows; the one showing is outlined. */}
      <div className="print:hidden">
      {openId && <TicketTimeline key={openId} ticketId={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load}
        notePick={openRow && { shownId: shownNote(openRow)?.id ?? null, pickedId: openRow.note_id,
          onPick: (id) => run(() => api.put(`/c2c/${openId}`, { note_id: id })) }} />}
      </div>
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

function Row({ row: r, selected, onOpen, run }) {
  const status = r.closed ? CLOSED : STATUS[r.status];
  const outcome = OUTCOMES[r.outcome];
  const stop = (e) => e.stopPropagation();
  return (
    <tr onClick={onOpen} className={`cursor-pointer align-top transition ${selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
      <td className="px-4 py-3 print:px-1.5 print:py-1.5">
        <button type="button" className="text-left font-semibold text-slate-900 hover:text-brand-700">{r.title}</button>
        <div className="mt-0.5 text-xs text-slate-500 print:text-[8px]">{[r.organization, r.owner && fullName(r.owner)].filter(Boolean).join(' · ')}</div>
        <LabelList labels={r.labels} className="mt-1.5 print:mt-1 print:origin-top-left print:scale-[0.8]" />
      </td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5 text-right font-medium whitespace-nowrap text-emerald-700 tabular-nums">{money(r.value)}</td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5 text-slate-700" onClick={r.can_edit ? stop : undefined}><Duration row={r} run={run} /></td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5 text-slate-700">
        {outcome ? <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ring-1 print:px-1.5 print:py-0.5 print:text-[8px] ${outcome.tone}`} title={r.outcome === 'awarded' ? undefined : `Was in ${r.stage}`}>{outcome.label}</span> : r.stage || '—'}
      </td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5 whitespace-nowrap text-slate-700">{closeDate(r.close_date)}</td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5" onClick={stop}>
        {/* On paper, and for anyone who can't set it, the status is a plain pill. */}
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 print:inline-block print:px-1.5 print:py-0.5 print:text-[8px] ${r.closed || !r.can_edit ? 'inline-block whitespace-nowrap' : 'hidden'} ${status?.tone || UNSET}`}
          title={r.closed ? 'The deal is closed' : 'Only the ticket’s owner or an admin sets the status'}>{status?.label || 'Not set'}</span>
        {!r.closed && r.can_edit && (
          <select aria-label={`Status of ${r.title}`} value={r.status || ''}
            onChange={(e) => run(() => api.put(`/c2c/${r.ticket_id}`, { status: e.target.value || null }))}
            className={`max-w-full cursor-pointer rounded-full border-0 py-1 pr-7 pl-2.5 text-xs font-semibold ring-1 print:hidden ${status?.tone || UNSET}`}>
            <option value="">Not set</option>
            {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        )}
      </td>
      <td className="px-3 py-3 print:px-1.5 print:py-1.5"><Notes row={r} /></td>
      <td className="py-3 pr-2 print:hidden" onClick={stop}>
        {!r.evaluating && (
          <button type="button" aria-label={`Take ${r.title} off the list`} title="Take off this list"
            onClick={() => confirm(`Take “${r.title}” off Close to closing? The ticket itself isn’t changed.`) && run(() => api.del(`/c2c/${r.ticket_id}`))}
            className="rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><X size={14} /></button>
        )}
      </td>
    </tr>
  );
}

/** The note a row shows: the latest, unless another is picked in the ticket's pane. Notes are written on the ticket. */
function Notes({ row: r }) {
  const shown = shownNote(r);
  if (!shown) return <div className="text-sm text-slate-400 print:text-[9px]">No notes yet</div>;
  return (
    <div className="space-y-1">
      <div className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-slate-700 print:line-clamp-6 print:text-[9px]" title={shown.body}><MentionText text={shown.body} /></div>
      <div className="text-[11px] text-slate-400 print:text-[7px] print:text-slate-500">{[shown.author && fullName(shown.author), stamp(shown.created_at), shown.updated_at && 'edited'].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

/** The contract's length. Its owner (or an admin) clicks to type it, as on the deal: "12 months", "1 base + 4 option years". It saves to the ticket. */
function Duration({ row: r, run }) {
  const [text, setText] = useState(null); // null: not editing
  if (!r.can_edit) return <span title={r.term_text || undefined}>{duration(r)}</span>;
  const save = () => {
    const next = text.trim();
    setText(null);
    if (next !== (r.term_text || '')) run(() => api.put(`/c2c/${r.ticket_id}`, { duration: next }));
  };
  if (text === null) {
    return (
      <button type="button" onClick={() => setText(r.term_text || '')} title={`${r.term_text ? `${r.term_text}. ` : ''}Click to edit: it saves to the ticket`}
        className="-mx-1.5 w-full rounded px-1.5 py-0.5 text-left hover:bg-white hover:ring-1 hover:ring-slate-300">{duration(r)}</button>
    );
  }
  return (
    <input autoFocus className="input -mx-1.5 h-7 w-[calc(100%+0.75rem)] px-1.5 py-0 text-sm" value={text} placeholder="e.g. 12 months" aria-label={`Duration of ${r.title}`}
      onChange={(e) => setText(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setText(null); }} />
  );
}
