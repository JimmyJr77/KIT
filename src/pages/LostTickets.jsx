import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { byDirector } from '../lib/directors.js';
import PageHeader from '../components/PageHeader.jsx';
import DirectorSelect from '../components/DirectorSelect.jsx';
import { LabelList, TagFilter, byTags } from '../components/Labels.jsx';
import TicketTimeline from './TicketTimeline.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));

/** Switches between the BD Pipeline board and the list of every lost pipeline ticket. */
export function PipelineViewToggle() {
  const link = ({ isActive }) => `flex items-center rounded px-3 ${isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`;
  return (
    <nav className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" aria-label="Pipeline view">
      <NavLink to="/pipeline" end className={link}>Pipeline</NavLink>
      <NavLink to="/pipeline/lost" className={link}>Lost</NavLink>
    </nav>
  );
}

/** Every lost pipeline ticket, on every pipeline, including the ones long since archived. Newest losses first. */
export default function LostTickets() {
  const meta = useApi('/priorities/meta');
  const [tickets, setTickets] = useState(null);
  const [q, setQ] = useState('');
  const [pipeline, setPipeline] = useState('');
  const [director, setDirector] = useState('');
  const [reason, setReason] = useState('');
  const [tags, setTags] = useState([]);
  const [sort, setSort] = useState({ key: 'lost', dir: 'desc' });
  const [openId, setOpenId] = useState(null);

  const load = () => api.get('/tickets?scope=all&kind=bid').then((d) => setTickets(d.tickets.filter((t) => t.pipeline_status === 'Lost')));
  useEffect(() => { load(); }, []);

  const pipelines = meta.data?.pipelines || [];
  const pipelineName = (id) => pipelines.find((p) => (p.id ?? null) === (id ?? null))?.name || '—';
  const reasons = useMemo(() => {
    const counts = new Map();
    (tickets || []).forEach((t) => { const r = t.lost_reason || ''; counts.set(r, (counts.get(r) || 0) + 1); });
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [tickets]);

  const SORTS = {
    title: (t) => t.opportunity_title.toLowerCase(), value: (t) => t.value ?? -1, lost: (t) => t.done_at || t.updated_at,
    reason: (t) => (t.lost_reason || '').toLowerCase(), director: (t) => `${t.director_last_name || '~'} ${t.director_first_name || ''}`.toLowerCase(),
  };
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const get = SORTS[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return (tickets || [])
      .filter((t) => !pipeline || String(t.pipeline_id ?? 'kit') === pipeline)
      .filter(byDirector(director))
      .filter(byTags(tags))
      .filter((t) => !reason || (reason === 'none' ? !t.lost_reason : t.lost_reason === reason))
      .filter((t) => !s || `${t.opportunity_title} ${t.organization || ''} ${t.lost_reason || ''}`.toLowerCase().includes(s))
      .sort((a, b) => { const x = get(a), y = get(b); return x < y ? -sign : x > y ? sign : 0; });
  }, [tickets, q, pipeline, director, reason, tags, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, t) => s + (t.value || 0), 0);

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'lost' || key === 'value' ? 'desc' : 'asc' }));
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
      <PageHeader title="Lost pipeline tickets" subtitle="Every pipeline ticket marked Lost, on every pipeline, including archived ones. Select one for its timeline.">
        <PipelineViewToggle />
      </PageHeader>

      <div className="panel flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by opportunity, organization or reason…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {pipelines.length > 1 && (
          <select className="input w-48" value={pipeline} onChange={(e) => setPipeline(e.target.value)} aria-label="Pipeline">
            <option value="">All pipelines</option>
            {pipelines.map((p) => <option key={p.id ?? 'kit'} value={String(p.id ?? 'kit')}>{p.name}</option>)}
          </select>
        )}
        <DirectorSelect tickets={tickets} value={director} onChange={setDirector} className="h-[38px] w-48" />
        <select className="input w-56" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Lost reason">
          <option value="">All lost reasons</option>
          {reasons.map(([r, n]) => <option key={r || 'none'} value={r || 'none'}>{r || 'No reason given'} ({n})</option>)}
        </select>
        <TagFilter value={tags} onChange={setTags} className="w-64" />
        <div className="ml-auto text-right">
          <div className="text-xs text-slate-500 uppercase">{rows.length.toLocaleString()} lost pipeline ticket{rows.length === 1 ? '' : 's'} · value</div>
          <div className="text-xl font-bold text-red-700">{money(total)}</div>
        </div>
      </div>

      {tickets && !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <XCircle size={28} className="mx-auto mb-2 text-slate-300" />
          {tickets.length ? 'No lost pipeline tickets match.' : 'No lost pipeline tickets.'}
        </div>
      ) : tickets && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                {header('title', 'Opportunity')}<th className="px-4 py-3">Pipeline</th>{header('director', 'BD director')}
                {header('reason', 'Lost reason')}{header('value', 'Value', 'text-right')}{header('lost', 'Lost')}
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
                  <td className="px-4 py-3 text-slate-600">{pipelineName(t.pipeline_id)}</td>
                  <td className="px-4 py-3 text-slate-600">{t.director_first_name ? `${t.director_first_name} ${t.director_last_name}` : '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{t.lost_reason || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(t.value)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{t.done_at ? shortDate(t.done_at.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
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
