import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { Search, ListOrdered, Plus, Clock, Settings, ArrowDown, ArrowUp, Star, Trophy } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, fullStamp, ticketKind } from '../lib/format.js';
import { activityTimer, daysSince } from '../lib/activityTimer.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import NewTicketPanel, { PIPELINE_CLOSED_HINT } from './NewTicketPanel.jsx';
import PwinSettings from './PwinSettings.jsx';
import { LabelList, TagFilter, byTags } from '../components/Labels.jsx';
import { PipelineViewToggle } from './ProcessView.jsx';
import NextStepBadge from '../components/NextStepBadge.jsx';

const NO_STAGE = '__none__';
const money = (n) => usd(n).replace('.00', '');
// Won and lost deals aren't on the board, as in Pipedrive: Closed deals lists them (and won ones are contracts in Delivery).
import { isClosed } from '../lib/lanes.js';

/** Master tickets as a board, one column per pipeline stage. Drag a ticket to move it to another stage. */
// Ways to order the cards in each column. `dir` is the direction each starts in when picked; the arrow button reverses
// it. The board opens on next task due, descending. Cards missing the value sorted on (no next task, no value) go to the bottom either way, and
// ties go by last entry, most recent first.
const SORTS = {
  next: { label: 'Next task due', dir: 'asc', of: (t) => (t.next_step?.due_date ? `${t.next_step.due_date} ${t.next_step.due_time || '99:99'}` : null), words: ['Soonest first', 'Latest first'] },
  activity: { label: 'Last entry', dir: 'desc', of: (t) => t.last_activity || null, words: ['Oldest first', 'Most recent first'] },
  created: { label: 'Date created', dir: 'desc', of: (t) => t.created_at || null, words: ['Oldest first', 'Newest first'] },
  value: { label: 'Value', dir: 'desc', of: (t) => (t.value == null ? null : Number(t.value)), words: ['Lowest first', 'Highest first'] },
  name: { label: 'Name (A–Z)', dir: 'asc', of: (t) => (t.opportunity_title || '').trim() || null, words: ['A to Z', 'Z to A'] },
};
const compareOn = (key, dir) => (a, b) => {
  const x = SORTS[key].of(a);
  const y = SORTS[key].of(b);
  if (x == null || y == null) return (x == null) - (y == null);
  const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: 'base', numeric: true });
  return dir === 'asc' ? c : -c;
};
const compareBy = ({ key, dir }) => (a, b) => compareOn(key, dir)(a, b) || compareOn('activity', 'desc')(a, b);
const savedSort = () => {
  try {
    const v = JSON.parse(localStorage.getItem('kit.pipeline.sort.v3'));
    if (SORTS[v?.key] && ['asc', 'desc'].includes(v.dir)) return v;
  } catch { /* none saved */ }
  return { key: 'next', dir: 'desc' };
};

export default function Pipeline() {
  const meta = useApi('/priorities/meta');
  const users = useApi('/users');
  const territories = useApi('/territories');
  const [scope, setScope] = useState('all');
  const [filters, setFilters] = useState([]); // "o:<user id>" for account owners, "t:<territory id>" for territories
  const [q, setQ] = useState('');
  const [tags, setTags] = useState([]);
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openStep, setOpenStep] = useState(undefined); // the activity to open the ticket on, from its next-step circle
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sort, setSortState] = useState(savedSort);
  const setSort = (v) => {
    setSortState(v);
    try { localStorage.setItem('kit.pipeline.sort.v3', JSON.stringify(v)); } catch { /* not kept */ }
  };
  const [pipelineKey, setPipelineKey] = useState(() => { try { return localStorage.getItem('kit.pipeline') || ''; } catch { return ''; } });
  // Re-render every minute so the activity bars keep growing.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const load = () => {
    const p = new URLSearchParams({ scope, q, kind: 'bid' }); // only pipeline tickets move through the pipeline
    const owners = filters.filter((f) => f.startsWith('o:')).map((f) => f.slice(2));
    const terrs = filters.filter((f) => f.startsWith('t:')).map((f) => f.slice(2));
    if (owners.length) p.set('owners', owners.join(','));
    if (terrs.length) p.set('territories', terrs.join(','));
    // Archived pipeline tickets (archived by hand, or archived or deleted in Pipedrive) live in the Archive, not on the board.
    return api.get(`/tickets?${p}`).then((d) => setTickets(d.tickets.filter((t) => !t.archived)));
  };
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [scope, filters, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // BD account owners (everyone on the BD team), alphabetical, then the territories (Pipedrive's "Account"), in their order.
  const filterOptions = useMemo(() => [
    ...(users.data?.users || []).filter((u) => (u.teams || []).some((t) => t.name === 'BD'))
      .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }))
      .map((u) => ({ value: `o:${u.id}`, label: fullName(u), group: 'BD account owners' })),
    ...(territories.data?.territories || []).map((t) => ({ value: `t:${t.id}`, label: t.name, group: 'Territories' })),
  ], [users.data, territories.data]);

  // One board per pipeline: KIT's own, plus one for each Pipedrive pipeline. KIT's own shows only when it has pipeline tickets or
  // is the only one.
  const keyOf = (id) => (id == null ? 'kit' : String(id));
  // What the board shows: open pipeline tickets (won and lost ones have left the board), narrowed to the chosen tags.
  const shown = useMemo(() => (tickets || []).filter((t) => !isClosed(t)).filter(byTags(tags)), [tickets, tags]);
  const closed = useMemo(() => (tickets || []).filter(isClosed), [tickets]);
  const pipelines = useMemo(() => {
    const list = meta.data?.pipelines || [];
    const counts = new Map();
    shown.forEach((t) => counts.set(keyOf(t.pipeline_id), (counts.get(keyOf(t.pipeline_id)) || 0) + 1));
    return list.filter((p) => p.id != null || counts.get('kit') || list.length === 1).map((p) => ({ ...p, key: keyOf(p.id), count: counts.get(keyOf(p.id)) || 0 }));
  }, [meta.data, shown]);
  const pipeline = pipelines.find((p) => p.key === pipelineKey) || pipelines.find((p) => p.count) || pipelines[0];
  const choosePipeline = (k) => { setPipelineKey(k); try { localStorage.setItem('kit.pipeline', k); } catch { /* not saved */ } };

  const stages = (pipeline?.statuses || []).filter((s) => s !== 'Lost');
  const lastStage = stages[stages.length - 1];
  const wonHere = closed.filter((t) => t.deal_status === 'won' && keyOf(t.pipeline_id) === pipeline?.key);

  const markWon = async (t) => {
    if (!confirm(`Mark “${t.opportunity_title}” won? It moves into Delivery as a contract.${t.pipedrive_id ? ' Pipedrive follows.' : ''}`)) return;
    setError('');
    try { await api.put(`/tickets/${t.id}/outcome`, { deal_status: 'won' }); load(); } catch (e) { setError(`Couldn’t mark “${t.opportunity_title}” won: ${e.message}`); }
  };
  const columns = useMemo(() => {
    const onBoard = shown.filter((t) => keyOf(t.pipeline_id) === pipeline?.key);
    const byStage = (s) => onBoard.filter((t) => (t.pipeline_status || NO_STAGE) === s).sort(compareBy(sort));
    const cols = stages.map((s) => ({ key: s, label: s, tickets: byStage(s) }));
    const none = byStage(NO_STAGE);
    // Tickets with no stage get their own column, shown only when there are some.
    return none.length ? [{ key: NO_STAGE, label: 'No stage', tickets: none }, ...cols] : cols;
  }, [shown, stages, pipeline?.key, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const onDragEnd = async ({ active, over }) => {
    setDragId(null);
    if (!over) return;
    const t = tickets.find((x) => x.id === active.id);
    const stage = over.id === NO_STAGE ? null : over.id;
    if (!t || (t.pipeline_status || null) === stage) return;
    const prev = tickets;
    setTickets((xs) => xs.map((x) => (x.id === t.id ? { ...x, pipeline_status: stage, last_activity: new Date().toISOString().slice(0, 19).replace('T', ' ') } : x)));
    setError('');
    try {
      await api.put(`/tickets/${t.id}/stage`, { pipeline_status: stage });
    } catch (e) {
      setTickets(prev);
      setError(`Couldn’t move “${t.opportunity_title}”: ${e.message}`);
    }
  };

  const dragging = dragId && tickets?.find((t) => t.id === dragId);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <PageHeader title="BD Pipeline" subtitle="Pipeline tickets by stage. Drag a ticket to move it.">
          <div className="w-80 text-left">
            <MultiSelect compact options={filterOptions} value={filters} onChange={setFilters} placeholder="Filter by account owner or territory…" />
          </div>
          <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
            {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScope(k)}
                className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
          <PipelineViewToggle />
          <button type="button" className="btn h-9 py-0" onClick={() => setSettingsOpen(true)}><Settings size={15} /> Settings</button>
        </PageHeader>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => setCreating(true)} disabled={!!meta.data?.pipelineTicketsClosed} aria-label="New ticket"
            title={meta.data?.pipelineTicketsClosed ? PIPELINE_CLOSED_HINT : 'New ticket'}
            className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
          <div className="relative w-full max-w-md">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search by opportunity or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <TagFilter value={tags} onChange={setTags} className="w-72" />
          <div className="flex items-center gap-1">
            <select className="input h-[38px] w-44 py-0" aria-label="Sort tickets" value={sort.key}
              onChange={(e) => setSort({ key: e.target.value, dir: SORTS[e.target.value].dir })}>
              {Object.entries(SORTS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
            </select>
            <button type="button" className="btn h-[38px] w-[38px] shrink-0 p-0" onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
              title={`${SORTS[sort.key].words[sort.dir === 'asc' ? 0 : 1]} (click to reverse)`}
              aria-label={`${SORTS[sort.key].words[sort.dir === 'asc' ? 0 : 1]}. Reverse the order.`}>
              {sort.dir === 'asc' ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>
          {error && <span className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</span>}
          {wonHere.length > 0 && (
            <Link to="/closed-deals" className="ml-auto flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100" title="Won deals leave the board; they're contracts in Delivery">
              <Trophy size={13} /> {wonHere.length} won · {money(wonHere.reduce((s, t) => s + (t.value || 0), 0))}
            </Link>
          )}
        </div>
        {pipelines.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pipelines">
            {pipelines.map((p) => (
              <button key={p.key} type="button" role="tab" aria-selected={p.key === pipeline?.key} onClick={() => choosePipeline(p.key)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${p.key === pipeline?.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {p.name} <span className="opacity-70">{p.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        <DndContext sensors={sensors} collisionDetection={pointerWithin}
          onDragStart={({ active }) => setDragId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
          <div className="flex h-full min-h-96 items-stretch gap-3">
            {columns.map((c) => <Column key={c.key} column={c} onOpen={(id) => { setOpenStep(undefined); setOpenId(id); }}
              onOpenStep={(t) => { setOpenStep(t.next_step?.id ?? null); setOpenId(t.id); }} dragId={dragId} now={now}
              onWon={c.key === lastStage ? markWon : null} />)}
          </div>
          <DragOverlay>{dragging && <TicketCard ticket={dragging} now={now} overlay />}</DragOverlay>
        </DndContext>
      </div>

      {settingsOpen && <PwinSettings onClose={() => setSettingsOpen(false)} onSaved={load} />}

      {creating && (
        <NewTicketPanel bidOnly pipeline={pipeline} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); load(); setOpenId(t.id); }} />
      )}

      {openId && <TicketTimeline key={`${openId}-${openStep}`} ticketId={openId} activityId={openStep} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
    </div>
  );
}

function Column({ column, onOpen, onOpenStep, dragId, now, onWon }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const total = column.tickets.reduce((s, t) => s + (t.value || 0), 0);
  const closed = !!onWon; // the last stage: a deal here is marked won from its card
  return (
    <section ref={setNodeRef} aria-label={`${column.label} stage`}
      className={`flex min-w-40 flex-1 basis-0 flex-col rounded-xl border transition ${
        isOver ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-100' : closed ? 'border-slate-200 bg-slate-100/70' : 'border-slate-200 bg-white/70'}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className={`text-sm font-semibold ${column.key === NO_STAGE ? 'text-slate-500 italic' : 'text-slate-800'}`}>{column.label}</h2>
          <span className="text-xs text-slate-400">{column.tickets.length}</span>
        </div>
        <span className="text-xs font-medium text-emerald-700 tabular-nums">{total ? money(total) : ''}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tickets.map((t) => <DraggableTicket key={t.id} ticket={t} onOpen={onOpen} onOpenStep={onOpenStep} hidden={dragId === t.id} now={now} onWon={onWon} />)}
        {!column.tickets.length && (
          <p className={`rounded-lg border-2 border-dashed px-3 py-6 text-center text-xs ${isOver ? 'border-brand-500 text-brand-600' : 'border-slate-200 text-slate-400'}`}>
            {isOver ? 'Drop here' : 'No tickets'}
          </p>
        )}
      </div>
    </section>
  );
}

function DraggableTicket({ ticket, onOpen, onOpenStep, hidden, now, onWon }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => onOpen(ticket.id)} className={hidden ? 'opacity-30' : ''}>
      <TicketCard ticket={ticket} now={now} onOpenStep={onOpenStep} />
      {onWon && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onWon(ticket); }} onPointerDown={(e) => e.stopPropagation()}
          className="mt-1 flex w-full items-center justify-center gap-1 rounded-md bg-emerald-50 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
          title="Mark won: it becomes a contract in Delivery">
          <Trophy size={12} /> Mark won
        </button>
      )}
    </div>
  );
}

/** A ticket on someone's priority ticket list (from the top of their My dashboard) carries this tag. */
export function PriorityTag({ of }) {
  if (!of) return null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-px text-[11px] font-semibold text-amber-800" title={`On ${of}'s priority tickets`}>
      <Star size={10} className="fill-amber-500 text-amber-500" /> Priority
    </span>
  );
}

/** "Work Ticket" on a work ticket, so it stands out among pipeline tickets; nothing on a pipeline ticket. */
export function TicketKindTag({ ticket }) {
  if (ticket?.ticket_type !== 'work') return null;
  return <span className="rounded bg-slate-200 px-1.5 py-px text-[11px] font-semibold text-slate-700">{ticketKind(ticket)}</span>;
}

/** The standard ticket card. Used on the pipeline board and on My dashboard's priority tickets (pipeline or work). */
export function TicketCard({ ticket: t, now = Date.now(), overlay, onOpenStep, className = '' }) {
  const owner = t.owner_first_name ? { id: t.created_by, first_name: t.owner_first_name, last_name: t.owner_last_name } : null;
  const days = daysSince(t.last_activity, now);
  const { bar, counter } = activityTimer(days);
  const idle = `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} since last activity (${fullStamp(t.last_activity)})`;
  return (
    <div className={`relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-white p-3 pr-10 text-sm shadow-sm transition hover:border-brand-500 hover:shadow-md active:cursor-grabbing ${overlay ? 'w-60 rotate-2 shadow-xl' : ''} ${className}`}>
      <NextStepBadge step={t.next_step} onOpen={() => onOpenStep?.(t)} className="absolute top-1/2 right-2 -translate-y-1/2" />
      <div className="line-clamp-2 font-semibold leading-snug text-slate-900" title={t.opportunity_title}>{t.opportunity_title}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-slate-500">{[t.organization, t.account_type].filter(Boolean).join(' · ')}</div>
      {(t.ticket_type === 'work' || t.priority_of || t.labels?.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <TicketKindTag ticket={t} />
          <PriorityTag of={t.priority_of} />
          <LabelList labels={t.labels} />
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          {t.ticket_type !== 'work' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">{t.value != null ? money(t.value) : '—'}</span>}
          {t.pwin && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-brand-700 tabular-nums" title={`PWIN: weighted bid and win assessment, ${t.pwin.rated} of ${t.pwin.total} areas rated${t.pwin.penalties.length ? `. Held back by ${t.pwin.penalties.map((x) => x.title).join(', ')}` : ''}`}>
              {t.pwin.score}%
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="flex items-center gap-0.5" title="Priorities"><ListOrdered size={11} /> {t.card_count}</span>
          {owner && <Avatar user={owner} size="xs" />}
          {counter && <span className="flex items-center gap-0.5 font-medium text-slate-500 tabular-nums" title={idle}><Clock size={11} /> {counter}</span>}
        </span>
      </div>
      {/* Activity timer: a bar that regrows each week, green, yellow, orange then red, and turns black after four weeks. */}
      {bar && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100" title={idle}>
          <div className={`h-full ${bar.color} transition-[width] duration-700`} style={{ width: `${bar.width}%` }} />
        </div>
      )}
    </div>
  );
}
