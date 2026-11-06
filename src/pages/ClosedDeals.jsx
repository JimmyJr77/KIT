import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronUp, ChevronDown, ChevronsUpDown, FolderArchive, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { byDirector } from '../lib/directors.js';
import PageHeader from '../components/PageHeader.jsx';
import DirectorSelect from '../components/DirectorSelect.jsx';
import TicketTimeline from './TicketTimeline.jsx';

const GROUPS = [
  { key: 'execution', label: 'In execution', about: 'Won and in delivery. It moves to Executed once its funding covers the contract value, or once the contract is marked Complete on Delivery (or its Pipedrive project is completed).', date: 'Won' },
  { key: 'executed', label: 'Executed', about: 'Fully funded, or the contract is Complete or canceled. Its contract is still in Delivery.', date: 'Completed' },
  { key: 'lost', label: 'Lost', about: 'Deals marked lost, here or in Pipedrive.', date: 'Lost' },
  { key: 'other', label: 'Other', about: 'Left the pipeline with no outcome: archived here while still open, or archived or deleted in Pipedrive. A won deal archived or deleted in Pipedrive leaves Delivery and lands here; one that already had funding recorded is flagged, in case it was only tidied away in Pipedrive once funded.', date: 'Removed' },
];
const money = (n) => (n == null ? '—' : usd(Math.round(n)).replace('.00', ''));
const directorOf = (d) => (d.director_first_name ? `${d.director_first_name} ${d.director_last_name}` : null);
const day = (d) => (d ? shortDate(d.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
const SORTS = {
  title: (d) => d.opportunity_title.toLowerCase(), director: (d) => (directorOf(d) || '~').toLowerCase(), territory: (d) => (d.territory_name || '~').toLowerCase(),
  amount: (d) => d.amount ?? -1, closed: (d) => d.closed_on || '',
};

/** What's worth saying about a deal in its group: why it was lost, how and from where it left the pipeline, or its contract and funding. */
function detail(d) {
  if (d.group === 'lost') return d.lost_reason || '—';
  if (d.group === 'other') {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {d.pipeline_status ? `Was ${d.pipeline_status}` : '—'}<span className="text-slate-400">· {d.removed_how}</span>
        {d.discrepancy && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800" title={`${money(d.funded)} of funding was recorded on this contract before Pipedrive ${d.removed_how === 'Deleted in Pipedrive' ? 'deleted' : 'archived'} the deal. Check it against Pipedrive before treating it as gone.`}>
            <TriangleAlert size={12} className="mr-1 inline -mt-0.5" />Funded {money(d.funded)}, then removed in Pipedrive
          </span>
        )}
      </span>
    );
  }
  const funding = d.program_id ? (d.fully_funded ? 'Fully funded' : d.contract_value > 0 ? `${Math.min(100, Math.round((d.funded / d.contract_value) * 100))}% funded` : null) : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {d.program_id ? <Link to={`/delivery?open=${d.program_id}`} className="text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>Open contract</Link> : 'No contract'}
      {funding && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${d.fully_funded ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{funding}</span>}
      {d.group === 'executed' && d.program_status !== 'Active' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{d.program_status}</span>}
    </span>
  );
}

/** Where deals go once they're closed, sorted into In execution, Executed, Lost and Other. Select one for its timeline. */
export default function ClosedDeals() {
  const [deals, setDeals] = useState(null);
  const [group, setGroup] = useState('execution');
  const [q, setQ] = useState('');
  const [director, setDirector] = useState('');
  const [sort, setSort] = useState({ key: 'closed', dir: 'desc' });
  const [openId, setOpenId] = useState(null);

  const load = () => api.get('/delivery/closed').then((d) => setDeals(d.deals));
  useEffect(() => { load(); }, []);

  const inGroup = (key) => (deals || []).filter((d) => d.group === key);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const get = SORTS[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return inGroup(group)
      .filter(byDirector(director))
      .filter((d) => !s || `${d.opportunity_title} ${d.organization || ''} ${d.lost_reason || ''} ${d.pipeline_status || ''} ${directorOf(d) || ''} ${d.territory_name || ''}`.toLowerCase().includes(s))
      .sort((a, b) => { const x = get(a), y = get(b); return x < y ? -sign : x > y ? sign : 0; });
  }, [deals, group, q, director, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = rows.reduce((s, d) => s + (d.amount || 0), 0);
  const current = GROUPS.find((g) => g.key === group);
  const discrepancies = inGroup('other').filter((d) => d.discrepancy).length;

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'closed' || key === 'amount' ? 'desc' : 'asc' }));
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
      <PageHeader title="Closed deals" subtitle="Deals that have left the open pipeline. Select one for its timeline." />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {GROUPS.map((g) => {
          const list = inGroup(g.key);
          return (
            <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => setGroup(g.key)}
              className={`rounded-xl border bg-white p-4 text-left shadow-sm ${group === g.key ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="text-xs font-semibold text-slate-500 uppercase">{g.label}</div>
              <div className="mt-1 text-2xl font-bold text-slate-800 tabular-nums">{deals ? list.length.toLocaleString() : '—'}</div>
              <div className="text-xs text-slate-500 tabular-nums">{deals ? money(list.reduce((s, d) => s + (d.amount || 0), 0)) : ' '}</div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">{current.about}</p>
      {discrepancies > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <TriangleAlert size={15} className="shrink-0" />
          {discrepancies === 1 ? 'One won deal had' : `${discrepancies} won deals had`} funding recorded when Pipedrive archived or deleted {discrepancies === 1 ? 'it' : 'them'}. {group === 'other' ? 'They are flagged below.' : 'See Other.'} Check each against Pipedrive before treating it as gone.
        </p>
      )}

      <div className="panel flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by deal, organization, stage, director or territory…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <DirectorSelect tickets={inGroup(group)} value={director} onChange={setDirector} className="h-[38px] w-44" />
        <div className="ml-auto text-right">
          <div className="text-xs text-slate-500 uppercase">{rows.length.toLocaleString()} deal{rows.length === 1 ? '' : 's'} · value</div>
          <div className="text-xl font-bold text-slate-800">{money(total)}</div>
        </div>
      </div>

      {!deals && <p className="text-sm text-slate-400">Loading closed deals…</p>}
      {deals && !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <FolderArchive size={28} className="mx-auto mb-2 text-slate-300" />
          {inGroup(group).length ? 'No deals match.' : `Nothing in ${current.label} yet.`}
        </div>
      ) : deals && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                {header('title', 'Deal')}{header('director', 'BD director')}{header('territory', 'Territory')}{header('amount', 'Value', 'text-right')}
                {header('closed', current.date)}<th className="px-4 py-3">{group === 'lost' ? 'Reason' : group === 'other' ? 'Stage · how it left' : 'Contract'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setOpenId(d.id)}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{d.opportunity_title}</div>
                    <div className="text-xs text-slate-500">{d.organization || `Ticket #${d.id}`}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{directorOf(d) || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{d.territory_name || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(d.amount)}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{day(d.closed_on)}</td>
                  <td className="px-4 py-3 text-slate-600">{detail(d)}</td>
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
