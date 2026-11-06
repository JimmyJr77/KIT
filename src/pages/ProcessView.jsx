import { useEffect, useRef, useState } from 'react';
import { NavLink, useSearchParams } from 'react-router-dom';
import { Search, Workflow, Trophy, XCircle, Archive } from 'lucide-react';
import { api } from '../lib/api.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import ProcessTimeline from '../components/ProcessTimeline.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import { useClickAway } from '../components/UserCombobox.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));

/** Switches between the BD Pipeline board and the Process view of one ticket. */
export function PipelineViewToggle() {
  const link = ({ isActive }) => `flex items-center rounded px-3 ${isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`;
  return (
    <nav className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" aria-label="Pipeline view">
      <NavLink to="/pipeline" end className={link}>Pipeline</NavLink>
      <NavLink to="/pipeline/process" className={link}>Process</NavLink>
    </nav>
  );
}

/**
 * The Process view: search for a pipeline ticket (open, won, lost or archived) and see its pursuit left to right, from how
 * the lead came in, through strategy and shaping, to each milestone. The ticket is in the URL, so the view can be linked to.
 */
export default function ProcessView() {
  const [params, setParams] = useSearchParams();
  const ticketId = Number(params.get('ticket')) || null;
  const [picked, setPicked] = useState(null); // the chosen ticket's row, for the search box
  const [openTool, setOpenTool] = useState(undefined); // undefined: the ticket pane is closed; null or a tool name: open on it
  const [reloadKey, setReloadKey] = useState(0);
  const choose = (t) => { setPicked(t); setParams(t ? { ticket: String(t.id) } : {}); };
  useEffect(() => {
    if (ticketId && picked?.id !== ticketId) api.get(`/tickets?scope=all&kind=bid&ids=${ticketId}`).then((d) => setPicked(d.tickets[0] || null)).catch(() => {});
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <PageHeader title="Process" subtitle="One pipeline ticket, left to right: the lead, the strategy, the shaping work and each milestone.">
          <PipelineViewToggle />
        </PageHeader>
        <TicketSearch value={ticketId ? picked : null} onChange={choose} />
      </div>
      {ticketId ? (
        <ProcessTimeline key={ticketId} ticketId={ticketId} reloadKey={reloadKey} onOpenTool={(tool) => setOpenTool(tool)} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
          <div className="max-w-md text-center text-slate-400">
            <Workflow size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm">Search for a pipeline ticket above to see its process: who generated the lead, the strategy behind it, what shaped it, and every milestone with who was there and who approved.</p>
          </div>
        </div>
      )}
      {ticketId && openTool !== undefined && (
        <TicketTimeline key={`${ticketId}-${openTool}`} ticketId={ticketId} initialTool={openTool}
          onClose={() => { setOpenTool(undefined); setReloadKey((k) => k + 1); }} onChanged={() => setReloadKey((k) => k + 1)} />
      )}
    </div>
  );
}

/** Type-to-search across every pipeline ticket, including closed and archived ones. */
function TicketSearch({ value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));
  useEffect(() => {
    if (!open) return undefined;
    const h = setTimeout(() => {
      api.get(`/tickets?scope=all&kind=bid&q=${encodeURIComponent(q.trim())}`).then((d) => setResults(d.tickets.slice(0, 15))).catch(() => setResults([]));
    }, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [q, open]);
  const pick = (t) => { onChange(t); setQ(''); setOpen(false); };
  return (
    <div className="relative w-full max-w-xl" ref={ref}>
      <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
      <input className="input pl-9" value={open ? q : value ? `${value.opportunity_title}${value.organization ? ` · ${value.organization}` : ''}` : q}
        placeholder="Search for a pipeline ticket by opportunity or organization…" aria-label="Find a pipeline ticket"
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
                {t.deal_status === 'won' && <Trophy size={13} className="shrink-0 text-emerald-600" title="Won" />}
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
