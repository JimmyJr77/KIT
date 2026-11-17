import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Workflow } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import ProcessTimeline from '../components/ProcessTimeline.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import NewTicketPanel, { PIPELINE_CLOSED_HINT } from './NewTicketPanel.jsx';
import { byTags } from '../components/Labels.jsx';
import PipelineHeader, { AddButton, TicketSearch, useOwnerTerritoryFilter } from '../components/PipelineHeader.jsx';

// The view toggle and ticket search live with the header every BD Pipeline page shares.
export { PipelineViewToggle, TicketSearch } from '../components/PipelineHeader.jsx';

// How the ticket search lists what it finds.
const SORTS = {
  activity: { label: 'Last entry', dir: 'desc', of: (t) => t.last_activity || '' },
  name: { label: 'Name (A–Z)', dir: 'asc', of: (t) => (t.opportunity_title || '').toLowerCase() },
  value: { label: 'Value', dir: 'desc', of: (t) => Number(t.value) || 0 },
  created: { label: 'Date created', dir: 'desc', of: (t) => t.created_at || '' },
};

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
  const [creating, setCreating] = useState(false);
  const meta = useApi('/priorities/meta');
  const choose = (t) => { setPicked(t); setParams(t ? { ticket: String(t.id) } : {}); };
  useEffect(() => {
    if (ticketId && picked?.id !== ticketId) api.get(`/tickets?scope=all&kind=bid&ids=${ticketId}`).then((d) => setPicked(d.tickets[0] || null)).catch(() => {});
  }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The search finds tickets the way the other pipeline pages list them: mine or all, by owner, territory and tag, in the order picked.
  const [scope, setScope] = useState('all');
  const filter = useOwnerTerritoryFilter();
  const [tags, setTags] = useState([]);
  const [sort, setSort] = useState({ key: 'activity', dir: 'desc' });
  const query = useMemo(() => {
    const p = new URLSearchParams({ scope });
    if (filter.owners.length) p.set('owners', filter.owners.join(','));
    if (filter.territories.length) p.set('territories', filter.territories.join(','));
    return p.toString();
  }, [scope, filter.owners.join(), filter.territories.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const refine = useCallback((xs) => {
    const of = SORTS[sort.key].of;
    return xs.filter(byTags(tags)).sort((a, b) => { const x = of(a); const y = of(b); const c = x < y ? -1 : x > y ? 1 : 0; return sort.dir === 'asc' ? c : -c; });
  }, [tags, sort]);

  return (
    <div className="flex h-full flex-col">
      <PipelineHeader title="Process steps & shaping history" subtitle="One pipeline ticket, left to right: the lead, the strategy, the shaping work and each staffing event."
        scope={scope} onScope={setScope}
        add={<AddButton onClick={() => setCreating(true)} disabled={!!meta.data?.pipelineTicketsClosed} title={meta.data?.pipelineTicketsClosed ? PIPELINE_CLOSED_HINT : 'New ticket'} />}
        search={{ node: <TicketSearch className="relative w-80" value={ticketId ? picked : null} onChange={choose} params={query} refine={refine} placeholder="Search by opportunity or org…" /> }}
        filter={{ options: filter.options, value: filter.value, onChange: filter.setValue }} tags={tags} onTags={setTags}
        sort={{ options: Object.entries(SORTS).map(([k, o]) => [k, o.label]), value: sort.key, onChange: (k) => setSort({ key: k, dir: SORTS[k].dir }),
          dir: sort.dir, onDir: () => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' }) }} />
      {ticketId ? (
        <ProcessTimeline key={ticketId} ticketId={ticketId} reloadKey={reloadKey} onOpenTool={(tool) => setOpenTool(tool)} />
      ) : (
        <div className="flex flex-1 items-center justify-center bg-slate-50 p-8">
          <div className="max-w-md text-center text-slate-400">
            <Workflow size={32} className="mx-auto mb-3 text-slate-300" />
            <p className="text-sm">Search for a pipeline ticket above to see its process steps and shaping history: who generated the lead, the strategy behind it, what shaped it, and every staffing event with who was there and who approved.</p>
          </div>
        </div>
      )}
      {ticketId && openTool !== undefined && (
        <TicketTimeline key={`${ticketId}-${openTool}`} ticketId={ticketId} initialTool={openTool}
          onClose={() => { setOpenTool(undefined); setReloadKey((k) => k + 1); }} onChanged={() => setReloadKey((k) => k + 1)} />
      )}
      {creating && <NewTicketPanel bidOnly onClose={() => setCreating(false)} onCreated={(t) => { setCreating(false); choose(t); }} />}
    </div>
  );
}

