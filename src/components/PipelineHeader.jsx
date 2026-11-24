import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Plus, Search, Settings, ArrowUp, ArrowDown, X, Trophy, XCircle, Archive } from 'lucide-react';
import { api } from '../lib/api.js';
import { usd } from '../lib/travelCalc.js';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';
import MultiSelect from './MultiSelect.jsx';
import { TagFilter, LabelChip, useStoredTags } from './Labels.jsx';
import { useStored, usePrune } from '../lib/stored.js';
import { useClickAway } from './UserCombobox.jsx';

/**
 * The account owner / territory filter every BD Pipeline page shares: BD account owners (everyone on the BD team,
 * alphabetical), then the territories (Pipedrive's "Account"). Values are "o:<user id>" and "t:<territory id>".
 * `page` names the page it's on ("pipeline", "c2c"…): what's picked is kept for that page, and a pick that's gone is dropped.
 */
export function useOwnerTerritoryFilter(page) {
  const users = useApi('/users');
  const territories = useApi('/territories');
  const [value, setValue] = useStored(`${page}.owners`, [], { valid: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string') });
  const options = useMemo(() => [
    ...(users.data?.users || []).filter((u) => (u.teams || []).some((t) => t.name === 'BD'))
      .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }))
      .map((u) => ({ value: `o:${u.id}`, label: fullName(u), group: 'BD account owners' })),
    ...(territories.data?.territories || []).map((t) => ({ value: `t:${t.id}`, label: t.name, group: 'Territories' })),
  ], [users.data, territories.data]);
  usePrune(value, setValue, users.data && territories.data ? options.map((o) => o.value) : null);
  const owners = value.filter((f) => f.startsWith('o:')).map((f) => Number(f.slice(2)));
  const territoryIds = value.filter((f) => f.startsWith('t:')).map((f) => Number(f.slice(2)));
  /** Whether a row with this owner id and territory id passes the filter. */
  const passes = (ownerId, territoryId) => (!owners.length || owners.includes(ownerId)) && (!territoryIds.length || territoryIds.includes(territoryId));
  return { options, value, setValue, owners, territories: territoryIds, passes };
}

export { useStoredTags };

const SCOPES = ['mine', 'all'];
/** My tickets / All tickets on a BD Pipeline page, kept for that page. */
export const useStoredScope = (page, legacy) => useStored(`${page}.scope`, 'all', { valid: (v) => SCOPES.includes(v), legacy });

/**
 * The header every BD Pipeline page (Pipeline, Process, C2C, SAC) shares, so they look and work alike:
 *   top right, always: My tickets / All tickets, the view toggle and Settings;
 *   under the title, left to right: add a ticket, search, the account owner / territory filter, the tag filter, sort,
 *     then anything the page adds (`extra`);
 *   below that: the pipelines (`tabs`, on the board), with the owners, territories and tags picked shown to their right.
 * `onSettings` opens the board's settings in place; elsewhere Settings goes to the board with them open.
 */
export default function PipelineHeader({ title, subtitle, scope, onScope, onSettings, add, search, filter, tags, onTags, sort, extra, tabs, children }) {
  const picked = filter ? filter.options.filter((o) => filter.value.includes(o.value)) : [];
  const chips = picked.length > 0 || tags?.length > 0;
  return (
    <div className="space-y-3 border-b border-slate-200 bg-white px-8 pt-8 pb-4 print:hidden">
      {/* The controls line up with the title, wherever a long subtitle wraps to. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {onScope && (
            <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
              {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => onScope(k)}
                  className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
              ))}
            </div>
          )}
          <PipelineViewToggle />
          {onSettings
            ? <button type="button" className="btn h-9 py-0" onClick={onSettings}><Settings size={15} /> Settings</button>
            : <Link to="/pipeline?settings=1" className="btn h-9 py-0" title="The board's settings: PWIN, stages, cards"><Settings size={15} /> Settings</Link>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {add}
        {search && (search.node || (
          <div className="relative w-64">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder={search.placeholder || 'Search by opportunity or org…'} aria-label="Search by opportunity or organization"
              value={search.value} onChange={(e) => search.onChange(e.target.value)} />
          </div>
        ))}
        {filter && (
          <div className="w-60">
            <MultiSelect compact hideChips options={filter.options} value={filter.value} onChange={filter.onChange} placeholder="Filter by acct owner / territory…" />
          </div>
        )}
        {onTags && <TagFilter hideChips value={tags} onChange={onTags} className="w-44" />}
        {sort && (
          <div className="flex items-center gap-1">
            <select className="input h-[38px] w-40 py-0" aria-label="Sort" value={sort.value} onChange={(e) => sort.onChange(e.target.value)}>
              {sort.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {sort.onDir && (
              <button type="button" className="btn h-[38px] w-[38px] shrink-0 p-0" onClick={sort.onDir} title={`${sort.dirLabel || (sort.dir === 'asc' ? 'Ascending' : 'Descending')} (click to reverse)`}
                aria-label={`${sort.dirLabel || (sort.dir === 'asc' ? 'Ascending' : 'Descending')}. Reverse the order.`}>
                {sort.dir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
              </button>
            )}
          </div>
        )}
        {extra}
      </div>

      {(tabs || chips) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {tabs}
          {chips && (
            <div className="flex flex-wrap items-center gap-1.5">
              {picked.map((o) => (
                <span key={o.value} className="chip" title={o.group}>
                  {o.label}
                  <button type="button" onClick={() => filter.onChange(filter.value.filter((v) => v !== o.value))} aria-label={`Stop filtering by ${o.label}`} className="hover:text-brand-900"><X size={12} /></button>
                </span>
              ))}
              {tags?.map((t) => <LabelChip key={t} name={t} onRemove={() => onTags(tags.filter((x) => x !== t))} />)}
              <button type="button" className="text-xs text-slate-500 hover:text-slate-800 hover:underline" onClick={() => { filter?.onChange([]); onTags?.([]); }}>Clear</button>
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

/** The add button: a new pipeline ticket, or whatever the page adds. */
export function AddButton({ title = 'New ticket', onClick, disabled = false }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={title} title={title} className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
  );
}

/** An add button that opens a search for an existing pipeline ticket, for lists tickets are added to (C2C, SAC). */
export function AddExistingButton({ title, onPick, skip = null, refine = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <AddButton title={title} onClick={() => setOpen(!open)} />
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 w-[28rem] rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <div className="mb-1.5 px-1 text-xs font-semibold text-slate-600">{title}</div>
          <TicketSearch autoFocus value={null} skip={skip} refine={refine} placeholder="Search by opportunity or org…" onChange={(t) => { if (t) { setOpen(false); onPick(t); } }} />
        </div>
      )}
    </div>
  );
}

/** Switches between the BD Pipeline's views: the board, the Process view of one ticket, Close to closing (C2C) and SAC. */
export function PipelineViewToggle() {
  const link = ({ isActive }) => `flex items-center rounded px-3 ${isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`;
  return (
    <nav className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" aria-label="Pipeline view">
      <NavLink to="/pipeline" end className={link}>Pipeline</NavLink>
      <NavLink to="/pipeline/process" className={link}>Process</NavLink>
      <NavLink to="/pipeline/c2c" className={link} title="Close to closing">C2C</NavLink>
      <NavLink to="/pipeline/sac" className={link} title="Solution Architect Coordination">SAC</NavLink>
    </nav>
  );
}

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));

/**
 * Type-to-search across every pipeline ticket, including closed and archived ones. `skip` leaves out tickets by id;
 * `params` adds to the search (scope, owners, territories); `refine` narrows and orders what comes back.
 */
export function TicketSearch({ value, onChange, placeholder = 'Search for a pipeline ticket by opportunity or organization…', skip = null, autoFocus = false,
  params = '', refine = null, className = 'relative w-full max-w-xl' }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));
  useEffect(() => {
    if (!open) return undefined;
    const h = setTimeout(() => {
      api.get(`/tickets?${params || 'scope=all'}&kind=bid&q=${encodeURIComponent(q.trim())}`)
        .then((d) => { const xs = d.tickets.filter((t) => !skip?.has(t.id)); setResults((refine ? refine(xs) : xs).slice(0, 15)); }).catch(() => setResults([]));
    }, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [q, open, skip, params, refine]);
  const pick = (t) => { onChange(t); setQ(''); setOpen(false); };
  return (
    <div className={className} ref={ref}>
      <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
      <input autoFocus={autoFocus} className="input pl-9" value={open ? q : value ? `${value.opportunity_title}${value.organization ? ` · ${value.organization}` : ''}` : q}
        placeholder={placeholder} aria-label="Find a pipeline ticket"
        onFocus={() => { setOpen(true); setQ(''); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && results?.[0]) pick(results[0]); }} />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg" role="listbox">
          {results === null && <li className="px-3 py-2 text-slate-400">Searching…</li>}
          {results?.length === 0 && <li className="px-3 py-2 text-slate-400">No pipeline tickets match.</li>}
          {results?.map((t) => (
            <li key={t.id} role="option" aria-selected={value?.id === t.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(t)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50 ${value?.id === t.id ? 'bg-brand-50/60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-slate-800">{t.opportunity_title}</div>
                  <div className="truncate text-xs text-slate-500">{[t.organization, t.pipeline_status, t.director_first_name ? `${t.director_first_name} ${t.director_last_name}` : null].filter(Boolean).join(' · ') || `Ticket #${t.id}`}</div>
                </div>
                <span className="shrink-0 text-xs text-emerald-700 tabular-nums">{money(t.value)}</span>
                {t.deal_status === 'won' && <Trophy size={13} className="shrink-0 text-emerald-600" title="Paid" />}
                {t.deal_status === 'lost' && <XCircle size={13} className="shrink-0 text-red-600" title="Lost" />}
                {t.archived && <Archive size={13} className="shrink-0 text-slate-400" title="Archived" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
