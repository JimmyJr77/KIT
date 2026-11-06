import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle2, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { daysToArchive, ARCHIVE_AFTER_DAYS } from '../lib/lanes.js';
import { byDirector } from '../lib/directors.js';
import PageHeader from '../components/PageHeader.jsx';
import DirectorSelect from '../components/DirectorSelect.jsx';
import { LabelList, TagFilter, byTags } from '../components/Labels.jsx';
import TicketTimeline from './TicketTimeline.jsx';

const money = (n) => (n == null ? '—' : usd(Math.round(n)).replace('.00', ''));
const ownerOf = (t) => (t.owner_first_name ? `${t.owner_first_name} ${t.owner_last_name}` : null);

/**
 * Every work ticket in the Tickets page's Done lane. Work tickets leave the Tickets page 14 days after reaching Done, or
 * sooner when moved here by hand, and this is where they can all still be found, sorted and filtered. Newest first.
 * Pipeline tickets aren't here: won and lost deals are in Closed deals.
 */
export default function DoneTickets() {
  const territories = useApi('/territories');
  const [tickets, setTickets] = useState(null);
  const [q, setQ] = useState('');
  const [where, setWhere] = useState(''); // '' | board | archived
  const [territory, setTerritory] = useState('');
  const [director, setDirector] = useState('');
  const [tags, setTags] = useState([]);
  const [sort, setSort] = useState({ key: 'done', dir: 'desc' });
  const [openId, setOpenId] = useState(null);

  // Work tickets only: won and lost pipeline tickets are in Closed deals.
  const load = () => api.get('/tickets?scope=all&kind=work').then((d) => setTickets(d.tickets.filter((t) => t.lane === 'done')));
  useEffect(() => { load(); }, []);

  const SORTS = {
    title: (t) => t.opportunity_title.toLowerCase(), value: (t) => t.value ?? -1,
    owner: (t) => (ownerOf(t) || '~').toLowerCase(), territory: (t) => (t.territory_name || '~').toLowerCase(), done: (t) => t.done_at || t.updated_at,
  };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const get = SORTS[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return (tickets || [])
      .filter((t) => !where || (where === 'archived') === !!t.archived)
      .filter((t) => !territory || (territory === 'none' ? !t.territory_id : t.territory_id === Number(territory)))
      .filter(byDirector(director))
      .filter(byTags(tags))
      .filter((t) => !s || `${t.opportunity_title} ${t.organization || ''}`.toLowerCase().includes(s))
      .sort((a, b) => { const x = get(a), y = get(b); return x < y ? -sign : x > y ? sign : 0; });
  }, [tickets, q, where, territory, director, tags, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, t) => s + (t.value || 0), 0);
  const onBoard = (tickets || []).filter((t) => !t.archived).length;

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'done' || key === 'value' ? 'desc' : 'asc' }));
  const header = (key, label, className = '') => (
    <th className={`px-4 py-3 ${className}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Done archive" subtitle="Every work ticket that reached Done. Select one for its timeline.">
        <Link to="/tickets" className="btn h-9"><ArrowLeft size={15} /> Tickets</Link>
      </PageHeader>
      <p className="-mt-2 text-xs text-slate-500">
        Work tickets leave the Tickets page {ARCHIVE_AFTER_DAYS} days after reaching Done, or sooner when moved here by hand. Pipeline tickets are not here: won and lost deals are in <Link to="/closed-deals" className="text-brand-700 hover:underline">Closed deals</Link>, and won ones are contracts in Delivery.
        {tickets && ` ${onBoard} of ${tickets.length} are still on the Tickets page.`}
      </p>

      <div className="panel flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by ticket or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input w-56" value={where} onChange={(e) => setWhere(e.target.value)} aria-label="Where it is">
          <option value="">On the page and archived</option>
          <option value="board">Still on the Tickets page</option>
          <option value="archived">Archived from the page</option>
        </select>
        <select className="input w-44" value={territory} onChange={(e) => setTerritory(e.target.value)} aria-label="Territory">
          <option value="">All territories</option>
          {(territories.data?.territories || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="none">No territory</option>
        </select>
        <DirectorSelect tickets={tickets} value={director} onChange={setDirector} className="h-[38px] w-44" />
        <TagFilter value={tags} onChange={setTags} className="w-60" />
        <div className="ml-auto text-right">
          <div className="text-xs text-slate-500 uppercase">{rows.length.toLocaleString()} done ticket{rows.length === 1 ? '' : 's'} · value</div>
          <div className="text-xl font-bold text-slate-800">{money(total)}</div>
        </div>
      </div>

      {!tickets && <p className="text-sm text-slate-400">Loading done tickets…</p>}
      {tickets && !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <CheckCircle2 size={28} className="mx-auto mb-2 text-slate-300" />
          {tickets.length ? 'No done tickets match.' : 'No done tickets yet.'}
        </div>
      ) : tickets && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                {header('title', 'Ticket')}{header('owner', 'Owner')}
                {header('territory', 'Territory')}{header('value', 'Value', 'text-right')}{header('done', 'Done')}<th className="px-4 py-3">Tickets page</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setOpenId(t.id)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{t.opportunity_title}</div>
                    <div className="text-xs text-slate-500">{t.organization || `Ticket #${t.id}`}</div>
                    <LabelList labels={t.labels} className="mt-1" />
                  </td>
                  <td className="px-4 py-3 text-slate-600">{ownerOf(t) || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{t.territory_name || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(t.value)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{t.done_at ? shortDate(t.done_at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-slate-500">
                    {t.archived ? 'Archived' : <span className="text-brand-700">On the page{daysToArchive(t) == null ? '' : ` · ${daysToArchive(t) ? `${daysToArchive(t)}d left` : 'archives today'}`}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && <TicketTimeline key={openId} ticketId={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
    </div>
  );
}
