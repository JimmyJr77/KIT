import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
// With the board in priority order a ticket is dropped on another ticket (to go just above it) as well as on a column.
const CARD = 'card:';
// While a ticket is dragged, the header becomes buckets: dropping on one staffs the ticket for that event (see BucketBar).
const BUCKET = 'bucket:';
const cardFirst = (args) => { const hits = pointerWithin(args); const cards = hits.filter((h) => String(h.id).startsWith(CARD)); return cards.length ? cards : hits; };
import { ListOrdered, Clock, Star, ChevronsLeft, ChevronsRight, UserPlus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullStamp, ticketKind } from '../lib/format.js';
import { activityTimer, daysSince } from '../lib/activityTimer.js';
import { usd } from '../lib/travelCalc.js';
import PipelineHeader, { AddButton, useOwnerTerritoryFilter, useStoredTags, useStoredScope } from '../components/PipelineHeader.jsx';
import { useStored } from '../lib/stored.js';
import Avatar from '../components/Avatar.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import NewTicketPanel, { PIPELINE_CLOSED_HINT } from './NewTicketPanel.jsx';
import PwinSettings from './PwinSettings.jsx';
import { LabelList, byTags, usePriorityTagHidden, useTagName } from '../components/Labels.jsx';
import NextStepBadge from '../components/NextStepBadge.jsx';
import NextStepQuick from '../components/NextStepQuick.jsx';
import { bucketsFor } from '../lib/process.js';

const NO_STAGE = '__none__';
const ALIAS = 'alias:'; // a personal alias's column, by its id
const NO_ALIASES = [];
// How wide the board's columns (and so its tickets) are: each person's own choice, in the board's settings, kept in this
// browser. Narrow, medium and wide are fixed widths, and the board scrolls sideways for what doesn't fit; "fit" shares the
// window among the columns instead, however thin that makes them.
const COLUMN_CLASS = { narrow: 'w-52 shrink-0', medium: 'w-[17rem] shrink-0', wide: 'w-[34rem] shrink-0', fit: 'min-w-0 flex-1 basis-0' };
// The size of the text on the board's tickets, also each person's own choice in the board's settings: standard, or
// small, which draws each ticket a step smaller (text, tags and spacing together) so more of them fit on screen.
const TEXT_ZOOM = { standard: 1, small: 0.86 };
const savedTextSize = () => { try { const v = localStorage.getItem('kit.pipeline.textSize'); return TEXT_ZOOM[v] ? v : 'standard'; } catch { return 'standard'; } };
const CardTextSize = createContext('standard');
const savedWidth = () => { try { const v = localStorage.getItem('kit.pipeline.cardWidth'); return COLUMN_CLASS[v] ? v : 'wide'; } catch { return 'wide'; } };
// Stages each person has minimized (a thin lane with its name written down it), by pipeline, kept in this browser.
const savedMinimized = () => { try { const v = JSON.parse(localStorage.getItem('kit.pipeline.minimized')); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const money = (n) => usd(n).replace('.00', '');
// Won and lost deals aren't on the board, as in Pipedrive: Closed deals lists them (and won ones are contracts in Delivery).
import { isClosed } from '../lib/lanes.js';
import { useAuth } from '../lib/auth.jsx';
import { canEditTicket } from '../lib/ticketAccess.js';

/** Master tickets as a board, one column per pipeline stage. Drag a ticket to move it to another stage. */
// Ways to order the cards in each column. `dir` is the direction each starts in when picked; the arrow button reverses
// it. The board opens on next task due, descending. Cards missing the value sorted on (no next task, no value) go to the bottom either way, and
// ties go by last entry, most recent first.
const SORTS = {
  // The board's own order, set by dragging tickets up and down their column. Nothing to do with priority tickets.
  priority: { label: 'Priority order', dir: 'asc', of: (t) => t.board_position ?? null, words: ['Highest priority first', 'Lowest priority first'] },
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
// Ties go by last entry, except in priority order, where tickets nobody has placed go newest first (as the server numbers them).
const compareBy = ({ key, dir }) => (a, b) => compareOn(key, dir)(a, b) || (key === 'priority' ? b.id - a.id : compareOn('activity', 'desc')(a, b));
const validSort = (v) => !!SORTS[v?.key] && ['asc', 'desc'].includes(v.dir);

export default function Pipeline() {
  const meta = useApi('/priorities/meta');
  const sacMeta = useApi('/sac/meta');
  const [staffed, setStaffed] = useState(''); // what the last drop on a bucket did
  // What's set here (my or all tickets, search, owners, territories, tags, sort, the pipeline) is kept for this person.
  const [scope, setScope] = useStoredScope('pipeline');
  const filter = useOwnerTerritoryFilter('pipeline'); // account owners and territories
  const filters = filter.value;
  const [q, setQ] = useStored('pipeline.q', '', { valid: (v) => typeof v === 'string' });
  const [tags, setTags] = useStoredTags('pipeline');
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [openStep, setOpenStep] = useState(undefined); // the activity to open the ticket on, from the next-step popup
  const [quick, setQuick] = useState(null); // the ticket whose next-step popup is up, from its circle
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  // Settings from another BD Pipeline page come here with ?settings=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsOpen, setSettingsOpenState] = useState(() => searchParams.get('settings') === '1');
  const setSettingsOpen = (v) => { setSettingsOpenState(v); if (!v && searchParams.has('settings')) setSearchParams({}, { replace: true }); };
  const [cardWidth, setCardWidthState] = useState(savedWidth);
  const setCardWidth = (v) => { setCardWidthState(v); try { localStorage.setItem('kit.pipeline.cardWidth', v); } catch { /* not kept */ } };
  const [textSize, setTextSizeState] = useState(savedTextSize);
  const setTextSize = (v) => { setTextSizeState(v); try { localStorage.setItem('kit.pipeline.textSize', v); } catch { /* not kept */ } };
  const [minimized, setMinimized] = useState(savedMinimized);
  const toggleMinimized = (key) => setMinimized((xs) => {
    const next = xs.includes(key) ? xs.filter((k) => k !== key) : [...xs, key];
    try { localStorage.setItem('kit.pipeline.minimized', JSON.stringify(next)); } catch { /* not kept */ }
    return next;
  });
  const [sort, setSort] = useStored('pipeline.sort', { key: 'next', dir: 'desc' }, { valid: validSort, legacy: 'kit.pipeline.sort.v3' });
  // A stored pipeline that's gone falls back to the first one with tickets (see `pipeline` below).
  const [pipelineKey, setPipelineKey] = useStored('pipeline.pipeline', '', { valid: (v) => typeof v === 'string', legacy: 'kit.pipeline' });
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

  // One board per pipeline: KIT's own, plus one for each Pipedrive pipeline. KIT's own shows only when it has pipeline tickets or
  // is the only one.
  const keyOf = (id) => (id == null ? 'kit' : String(id));
  // What the board shows: open pipeline tickets (won and lost ones have left the board), narrowed to the chosen tags.
  const shown = useMemo(() => (tickets || []).filter((t) => !isClosed(t)).filter(byTags(tags)), [tickets, tags]);
  const pipelines = useMemo(() => {
    const list = meta.data?.pipelines || [];
    const counts = new Map();
    shown.forEach((t) => counts.set(keyOf(t.pipeline_id), (counts.get(keyOf(t.pipeline_id)) || 0) + 1));
    return list.filter((p) => p.id != null || counts.get('kit') || list.length === 1).map((p) => ({ ...p, key: keyOf(p.id), count: counts.get(keyOf(p.id)) || 0 }));
  }, [meta.data, shown]);
  const pipeline = pipelines.find((p) => p.key === pipelineKey) || pipelines.find((p) => p.count) || pipelines[0];
  const choosePipeline = setPipelineKey;

  const stages = (pipeline?.statuses || []).filter((s) => s !== 'Lost');
  const lastStage = stages[stages.length - 1];
  // Your personal aliases on this pipeline: columns only you see, each beside the stage it belongs to. A ticket in one is
  // still in that stage for everyone else and in every report.
  const stageInfo = useApi(pipeline ? `/stages?pipeline_id=${pipeline.id ?? 'kit'}` : null);
  const aliases = stageInfo.data?.aliases || NO_ALIASES;

  const columns = useMemo(() => {
    const onBoard = shown.filter((t) => keyOf(t.pipeline_id) === pipeline?.key);
    const aliasOf = (t) => aliases.find((a) => a.id === t.alias_id && a.stage === t.pipeline_status);
    const byStage = (s) => onBoard.filter((t) => (t.pipeline_status || NO_STAGE) === s && !aliasOf(t)).sort(compareBy(sort));
    const cols = stages.flatMap((s) => [{ key: s, label: s, tickets: byStage(s) },
      ...aliases.filter((a) => a.stage === s).map((a) => ({ key: `${ALIAS}${a.id}`, label: a.name, alias: a, tickets: onBoard.filter((t) => aliasOf(t) === a).sort(compareBy(sort)) }))]);
    const none = byStage(NO_STAGE);
    // Tickets with no stage get their own column, shown only when there are some.
    return none.length ? [{ key: NO_STAGE, label: 'No stage', tickets: none }, ...cols] : cols;
  }, [shown, stages, pipeline?.key, sort, aliases]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranking = sort.key === 'priority'; // tickets are dragged up and down their column to set the order
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  // The stage reports count a ticket's stage as (a KIT-added stage blended into Capture offers Capture's buckets).
  const reportStage = (t) => sacMeta.data?.stages?.[`${keyOf(t.pipeline_id)}|${t.pipeline_status}`] ?? t.pipeline_status;
  const staff = async (t, type) => {
    setError('');
    setStaffed('');
    try {
      const d = await api.post('/sac', { ticket_id: t.id, step_type: type });
      setTickets((xs) => xs.map((x) => (x.id === t.id ? { ...x, labels: d.labels } : x)));
      setStaffed(d.created ? `“${t.opportunity_title}” is staffed for ${type}: tagged and on the SAC list.` : `“${t.opportunity_title}” already has an open ${type} on the SAC list.`);
    } catch (e) {
      setError(`Couldn’t staff “${t.opportunity_title}”: ${e.message}`);
    }
  };

  const onDragEnd = async ({ active, over }) => {
    setDragId(null);
    if (!over) return;
    const t = tickets.find((x) => x.id === active.id);
    if (!t) return;
    // Dropped on a bucket: the ticket keeps its stage and is staffed for that event.
    if (String(over.id).startsWith(BUCKET)) { staff(t, String(over.id).slice(BUCKET.length)); return; }
    // Dropped on a ticket (priority order only): into that ticket's column, just above it. Dropped on a column: at its end.
    const onCard = String(over.id).startsWith(CARD) ? Number(String(over.id).slice(CARD.length)) : null;
    if (onCard === t.id) return;
    const column = onCard != null ? columns.find((c) => c.tickets.some((x) => x.id === onCard)) : columns.find((c) => c.key === over.id);
    if (!column) return;
    // An alias column stands for its stage: the ticket moves there if it isn't in it, and is then placed in the alias.
    const stage = column.alias ? column.alias.stage : column.key === NO_STAGE ? null : column.key;
    const stageMoved = (t.pipeline_status || null) !== stage;
    const aliasId = column.alias?.id ?? null;
    const aliasMoved = (t.alias_id ?? null) !== aliasId;
    if (!stageMoved && !aliasMoved && !ranking) return;
    // The column as it will show, and from that the ticket that follows this one in priority order (reversed when the board is).
    const shown = column.tickets.filter((x) => x.id !== t.id);
    shown.splice(onCard != null ? shown.findIndex((x) => x.id === onCard) : shown.length, 0, t);
    const ranked = sort.dir === 'asc' ? shown : [...shown].reverse();
    const before_id = ranked[ranked.indexOf(t) + 1]?.id ?? null;
    const prev = tickets;
    const place = new Map(ranking ? ranked.map((x, i) => [x.id, i + 1]) : []);
    setTickets((xs) => xs.map((x) => ({
      ...x, ...(place.has(x.id) ? { board_position: place.get(x.id) } : {}),
      ...(x.id === t.id && stageMoved ? { pipeline_status: stage, last_activity: new Date().toISOString().slice(0, 19).replace('T', ' ') } : {}),
      ...(x.id === t.id ? { alias_id: aliasId } : {}),
    })));
    setError('');
    try {
      if (stageMoved) await api.put(`/tickets/${t.id}/stage`, { pipeline_status: stage });
      if (aliasMoved) await api.put('/stages/aliases/place', { ticket_id: t.id, alias_id: aliasId });
      if (ranking) await api.put(`/tickets/${t.id}/board-position`, { before_id });
      // A new stage changes what KIT works out for the card (the Unqualified and Qualified tags), so the board is read again.
      if (ranking || stageMoved) load();
    } catch (e) {
      setTickets(prev);
      setError(`Couldn’t move “${t.opportunity_title}”: ${e.message}`);
    }
  };

  const dragging = dragId && tickets?.find((t) => t.id === dragId);

  return (
    <div className="flex h-full flex-col">
      <CardTextSize.Provider value={textSize}>
      <DndContext sensors={sensors} collisionDetection={ranking ? cardFirst : pointerWithin}
        onDragStart={({ active }) => { setDragId(active.id); setStaffed(''); }} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
      <div className="relative">
        {dragging && <BucketBar ticket={dragging} stage={reportStage(dragging)} />}
        <PipelineHeader title="BD Pipeline" subtitle="Pipeline tickets by stage. Drag a ticket to move it, or onto a staffing bucket in the header to send it to SAC."
          scope={scope} onScope={setScope} onSettings={() => setSettingsOpen(true)}
          add={<AddButton onClick={() => setCreating(true)} disabled={!!meta.data?.pipelineTicketsClosed} title={meta.data?.pipelineTicketsClosed ? PIPELINE_CLOSED_HINT : 'New ticket'} />}
          search={{ value: q, onChange: setQ }}
          filter={{ options: filter.options, value: filter.value, onChange: filter.setValue }} tags={tags} onTags={setTags}
          sort={{ options: Object.entries(SORTS).map(([k, o]) => [k, o.label]), value: sort.key, onChange: (k) => setSort({ key: k, dir: SORTS[k].dir }),
            dir: sort.dir, dirLabel: SORTS[sort.key].words[sort.dir === 'asc' ? 0 : 1], onDir: () => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' }) }}
          extra={<>
            {error && <span className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</span>}
            {staffed && (
              <span className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-1.5 text-sm text-emerald-800">
                <UserPlus size={14} /> {staffed} <Link to="/pipeline/sac" className="font-semibold underline">Open SAC</Link>
                <button type="button" onClick={() => setStaffed('')} aria-label="Dismiss" className="rounded p-0.5 hover:bg-emerald-100"><X size={13} /></button>
              </span>
            )}
          </>}
          tabs={pipelines.length > 1 && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pipelines">
              {pipelines.map((p) => (
                <button key={p.key} type="button" role="tab" aria-selected={p.key === pipeline?.key} onClick={() => choosePipeline(p.key)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${p.key === pipeline?.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {p.name} <span className="opacity-70">{p.count}</span>
                </button>
              ))}
            </div>
          )} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
          {/* At a set width the board scrolls sideways for the columns that don't fit; fitted to the window, they share it. */}
          <div className={`flex h-full min-h-96 items-stretch gap-3 ${cardWidth === 'fit' ? '' : 'w-max min-w-full'}`}>
            {columns.map((c) => <Column key={c.key} column={c} onOpen={(id) => { setOpenStep(undefined); setOpenId(id); }}
              onOpenStep={setQuick} dragId={dragId} now={now}
              last={(c.alias?.stage ?? c.key) === lastStage} width={cardWidth} ranking={ranking}
              minimized={minimized.includes(`${pipeline?.key}|${c.key}`)} onMinimize={() => toggleMinimized(`${pipeline?.key}|${c.key}`)} />)}
          </div>
      </div>
      <DragOverlay>{dragging && <TicketCard ticket={dragging} now={now} overlay />}</DragOverlay>
      </DndContext>
      </CardTextSize.Provider>

      {settingsOpen && <PwinSettings onClose={() => setSettingsOpen(false)} onSaved={load} pipeline={pipeline} cardWidth={cardWidth} onCardWidth={setCardWidth} textSize={textSize} onTextSize={setTextSize}
        onStagesChanged={() => { meta.reload({ quiet: true }); stageInfo.reload({ quiet: true }); load(); }} />}

      {creating && (
        <NewTicketPanel bidOnly pipeline={pipeline} onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); load(); setOpenId(t.id); }} />
      )}

      {quick && <NextStepQuick ticket={quick} onClose={() => setQuick(null)} onChanged={load}
        onOpenTicket={() => { setOpenStep(quick.next_step?.id ?? null); setOpenId(quick.id); setQuick(null); }} />}
      {openId && <TicketTimeline key={`${openId}-${openStep}`} ticketId={openId} activityId={openStep} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
    </div>
  );
}

/**
 * Over the header while a ticket is dragged: one bucket per staffing event its stage can be staffed for. A drop on one
 * leaves the ticket in its stage, makes the staffing event, tags the ticket and puts it on the SAC list.
 */
function BucketBar({ ticket, stage }) {
  const buckets = bucketsFor(stage);
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-center gap-2 bg-white/95 px-8 py-3 backdrop-blur-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Staff “{ticket.opportunity_title}” · drop on an event to tag it and send it to SAC, or on a stage below to move it
      </p>
      <div className="flex min-h-0 flex-1 gap-2">
        {buckets.map((b) => <Bucket key={b.type} event={b} />)}
      </div>
    </div>
  );
}

function Bucket({ event }) {
  const nameOf = useTagName();
  const { setNodeRef, isOver } = useDroppable({ id: `${BUCKET}${event.type}` });
  return (
    <div ref={setNodeRef} className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-2 text-center transition ${
      isOver ? 'scale-[1.03] border-brand-500 bg-brand-50 text-brand-800 shadow-md' : 'border-slate-300 bg-slate-50 text-slate-700'}`}>
      <span className="text-sm leading-tight font-semibold">{event.type}</span>
      <span className={`mt-1 rounded-full px-2 py-px text-[11px] font-medium ${isOver ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>{nameOf(event.tag)}</span>
    </div>
  );
}

function Column({ column, onOpen, onOpenStep, dragId, now, last = false, width = 'wide', minimized, onMinimize, ranking }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const total = column.tickets.reduce((s, t) => s + (t.value || 0), 0);
  const closed = last; // the last stage is drawn apart; a deal there is marked paid on the ticket itself
  // Minimized: a thin lane with the stage's name written down it and no cards. It still takes a drop, and opens only when clicked.
  if (minimized) {
    return (
      <section ref={setNodeRef} aria-label={`${column.label} stage`} className="flex w-11 shrink-0">
        <button type="button" onClick={onMinimize} aria-expanded={false} aria-label={`Show the ${column.label} stage (${column.tickets.length} tickets)`} title={`Show ${column.label}`}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border py-2.5 transition ${
            isOver ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-100' : 'border-slate-200 bg-slate-100/70 hover:border-slate-300 hover:bg-slate-100'}`}>
          <ChevronsRight size={15} className="shrink-0 text-slate-400" />
          <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200 tabular-nums">{column.tickets.length}</span>
          <span className={`min-h-0 truncate text-sm font-semibold [writing-mode:vertical-rl] ${column.key === NO_STAGE ? 'text-slate-500 italic' : 'text-slate-800'}`}>{column.label}</span>
          {total > 0 && <span className="shrink-0 text-xs font-medium text-emerald-700 tabular-nums [writing-mode:vertical-rl]">{money(total)}</span>}
        </button>
      </section>
    );
  }
  return (
    <section ref={setNodeRef} aria-label={`${column.label} stage`}
      className={`flex ${COLUMN_CLASS[width] || COLUMN_CLASS.wide} flex-col rounded-xl border transition ${
        isOver ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-100' : closed ? 'border-slate-200 bg-slate-100/70' : 'border-slate-200 bg-white/70'}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className={`text-sm font-semibold ${column.key === NO_STAGE ? 'text-slate-500 italic' : 'text-slate-800'}`}>{column.label}</h2>
          <span className="text-xs text-slate-400">{column.tickets.length}</span>
          {column.alias && <span className="rounded-full bg-violet-50 px-1.5 py-px text-[10px] font-medium whitespace-nowrap text-violet-700" title={`Your own stage, part of ${column.alias.stage}. Only you see this column; for everyone else, and in reports, these tickets are in ${column.alias.stage}.`}>{column.alias.stage}</span>}
        </div>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-xs font-medium text-emerald-700 tabular-nums">{total ? money(total) : ''}</span>
          {onMinimize && (
            <button type="button" onClick={onMinimize} aria-expanded aria-label={`Minimize the ${column.label} stage`} title="Minimize this stage"
              className="shrink-0 self-center rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ChevronsLeft size={14} /></button>
          )}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tickets.map((t) => <DraggableTicket key={t.id} ticket={t} onOpen={onOpen} onOpenStep={onOpenStep} hidden={dragId === t.id} now={now} ranking={ranking} />)}
        {!column.tickets.length && (
          <p className={`rounded-lg border-2 border-dashed px-3 py-6 text-center text-xs ${isOver ? 'border-brand-500 text-brand-600' : 'border-slate-200 text-slate-400'}`}>
            {isOver ? 'Drop here' : 'No tickets'}
          </p>
        )}
      </div>
    </section>
  );
}

/** A pipeline ticket on the board. Its owner (or an admin) drags it to another stage; others just open it. */
function DraggableTicket({ ticket, onOpen, onOpenStep, hidden, now, ranking }) {
  const { user } = useAuth();
  const canEdit = canEditTicket(user, ticket);
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id, disabled: !canEdit });
  // In priority order, another ticket dropped on this one goes just above it: a line shows where.
  const drop = useDroppable({ id: `${CARD}${ticket.id}`, disabled: !ranking });
  const above = ranking && drop.isOver && !hidden;
  return (
    <div ref={(el) => { setNodeRef(el); drop.setNodeRef(el); }} {...attributes} {...listeners} onClick={() => onOpen(ticket.id)}
      className={`${hidden ? 'opacity-30' : ''} ${above ? 'relative before:absolute before:inset-x-0 before:-top-1.5 before:h-1 before:rounded-full before:bg-brand-500' : ''}`}>
      <TicketCard ticket={ticket} now={now} onOpenStep={onOpenStep} />
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
  const priorityOff = usePriorityTagHidden(); // the viewer's own choice, in the board's settings
  const idle = `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} since last activity (${fullStamp(t.last_activity)})`;
  const zoom = TEXT_ZOOM[useContext(CardTextSize)] || 1; // the board's text size; 1 anywhere else the card is used
  return (
    <div style={zoom === 1 ? undefined : { zoom }} className={`relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-white p-3 pr-8 text-sm shadow-sm transition hover:border-brand-500 hover:shadow-md active:cursor-grabbing ${overlay ? 'w-60 rotate-2 shadow-xl' : ''} ${className}`}>
      <NextStepBadge small step={t.next_step} onOpen={() => onOpenStep?.(t)} className="absolute top-1/2 right-2 -translate-y-1/2" />
      <div className="line-clamp-2 font-semibold leading-snug text-slate-900" title={t.opportunity_title}>{t.opportunity_title}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-slate-500">{[t.organization, t.account_type].filter(Boolean).join(' · ')}</div>
      {(t.ticket_type === 'work' || t.priority_of || t.unq || t.qualified || t.marketing || t.labels?.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 empty:hidden">
          <TicketKindTag ticket={t} />
          {!priorityOff && <PriorityTag of={t.priority_of} />}
          <LabelList labels={t.labels} unq={t.unq} qualified={t.qualified} marketing={t.marketing} card />
        </div>
      )}
      {/* On a narrow ticket the counts drop to a line of their own, and the ticket grows, instead of running into the value and PWIN. */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex shrink-0 items-center gap-1">
          {t.ticket_type !== 'work' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">{t.value != null ? money(t.value) : '—'}</span>}
          {t.pwin && (
            <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-brand-700 tabular-nums" title={`PWIN: weighted PWIN Assessment, ${t.pwin.rated} of ${t.pwin.total} areas rated${t.pwin.penalties.length ? `. Held back by ${t.pwin.penalties.map((x) => x.title).join(', ')}` : ''}`}>
              {t.pwin.score}%
            </span>
          )}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-slate-400">
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
