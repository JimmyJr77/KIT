import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { Search, ListOrdered, Plus, Clock, Settings } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, fullStamp } from '../lib/format.js';
import { activityTimer, daysSince } from '../lib/activityTimer.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import NewTicketPanel from './NewTicketPanel.jsx';
import PwinSettings from './PwinSettings.jsx';

const NO_STAGE = '__none__';
const money = (n) => usd(n).replace('.00', '');
// Closed-out stages are set apart from the active pipeline.
const CLOSED = new Set(['Awarded', 'Lost', 'No Bid']);

/** Master tickets as a board, one column per pipeline stage. Drag a ticket to move it to another stage. */
export default function Pipeline() {
  const meta = useApi('/priorities/meta');
  const users = useApi('/users');
  const [scope, setScope] = useState('all');
  const [filters, setFilters] = useState([]); // "o:<user id>" for account owners, "t:<account type>" for account types
  const [q, setQ] = useState('');
  const [tickets, setTickets] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Re-render every minute so the activity bars keep growing.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const load = () => {
    const p = new URLSearchParams({ scope, q, kind: 'bid' }); // only bid tickets move through the pipeline
    const owners = filters.filter((f) => f.startsWith('o:')).map((f) => f.slice(2));
    const types = filters.filter((f) => f.startsWith('t:')).map((f) => f.slice(2));
    if (owners.length) p.set('owners', owners.join(','));
    if (types.length) p.set('types', types.join(','));
    return api.get(`/tickets?${p}`).then((d) => setTickets(d.tickets));
  };
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [scope, filters, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // BD account owners (everyone on the BD team), alphabetical, then the account types.
  const filterOptions = useMemo(() => [
    ...(users.data?.users || []).filter((u) => (u.teams || []).some((t) => t.name === 'BD'))
      .sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }))
      .map((u) => ({ value: `o:${u.id}`, label: fullName(u), group: 'BD account owners' })),
    ...(meta.data?.accountTypes || []).map((t) => ({ value: `t:${t}`, label: t, group: 'Account types' })),
  ], [users.data, meta.data]);

  const stages = meta.data?.pipelineStatuses || [];
  const columns = useMemo(() => {
    const byStage = (s) => (tickets || []).filter((t) => (t.pipeline_status || NO_STAGE) === s);
    const cols = stages.map((s) => ({ key: s, label: s, tickets: byStage(s) }));
    const none = byStage(NO_STAGE);
    // Tickets with no stage get their own column, shown only when there are some.
    return none.length ? [{ key: NO_STAGE, label: 'No stage', tickets: none }, ...cols] : cols;
  }, [tickets, stages]);

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
        <PageHeader title="BD Pipeline" subtitle="Bid tickets by pipeline stage. Drag a ticket to move it.">
          <div className="w-80 text-left">
            <MultiSelect compact options={filterOptions} value={filters} onChange={setFilters} placeholder="Filter by account owner or type…" />
          </div>
          <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
            {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScope(k)}
                className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
          <button type="button" className="btn h-9 py-0" onClick={() => setSettingsOpen(true)}><Settings size={15} /> Settings</button>
        </PageHeader>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full max-w-md">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search by opportunity or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" onClick={() => setCreating(true)} title="New ticket" aria-label="New ticket"
            className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
          {error && <span className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        <DndContext sensors={sensors} collisionDetection={pointerWithin}
          onDragStart={({ active }) => setDragId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
          <div className="flex h-full min-h-96 items-stretch gap-3">
            {columns.map((c) => <Column key={c.key} column={c} onOpen={setOpenId} dragId={dragId} now={now} />)}
          </div>
          <DragOverlay>{dragging && <TicketCard ticket={dragging} now={now} overlay />}</DragOverlay>
        </DndContext>
      </div>

      {settingsOpen && <PwinSettings onClose={() => setSettingsOpen(false)} onSaved={load} />}

      {creating && (
        <NewTicketPanel bidOnly onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); load(); setOpenId(t.id); }} />
      )}

      {openId && <TicketTimeline key={openId} ticketId={openId} onClose={() => { setOpenId(null); load(); }} onChanged={load} />}
    </div>
  );
}

function Column({ column, onOpen, dragId, now }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  const total = column.tickets.reduce((s, t) => s + (t.value || 0), 0);
  const closed = CLOSED.has(column.key);
  return (
    <section ref={setNodeRef} aria-label={`${column.label} stage`}
      className={`flex w-64 shrink-0 flex-col rounded-xl border transition ${
        isOver ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-100' : closed ? 'border-slate-200 bg-slate-100/70' : 'border-slate-200 bg-white/70'}`}>
      <header className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className={`text-sm font-semibold ${column.key === NO_STAGE ? 'text-slate-500 italic' : 'text-slate-800'}`}>{column.label}</h2>
          <span className="text-xs text-slate-400">{column.tickets.length}</span>
        </div>
        <span className="text-xs font-medium text-emerald-700 tabular-nums">{total ? money(total) : ''}</span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {column.tickets.map((t) => <DraggableTicket key={t.id} ticket={t} onOpen={onOpen} hidden={dragId === t.id} now={now} />)}
        {!column.tickets.length && (
          <p className={`rounded-lg border-2 border-dashed px-3 py-6 text-center text-xs ${isOver ? 'border-brand-500 text-brand-600' : 'border-slate-200 text-slate-400'}`}>
            {isOver ? 'Drop here' : 'No tickets'}
          </p>
        )}
      </div>
    </section>
  );
}

function DraggableTicket({ ticket, onOpen, hidden, now }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => onOpen(ticket.id)} className={hidden ? 'opacity-30' : ''}>
      <TicketCard ticket={ticket} now={now} />
    </div>
  );
}

function TicketCard({ ticket: t, now, overlay }) {
  const owner = t.owner_first_name ? { id: t.created_by, first_name: t.owner_first_name, last_name: t.owner_last_name } : null;
  const days = daysSince(t.last_activity, now);
  const { bar, counter } = activityTimer(days);
  const idle = `${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'} since last activity (${fullStamp(t.last_activity)})`;
  return (
    <div className={`relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm transition hover:border-brand-500 hover:shadow-md active:cursor-grabbing ${overlay ? 'w-60 rotate-2 shadow-xl' : ''}`}>
      <div className="line-clamp-2 font-semibold leading-snug text-slate-900" title={t.opportunity_title}>{t.opportunity_title}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-slate-500">{[t.organization, t.account_type].filter(Boolean).join(' · ')}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700 tabular-nums">{t.value != null ? money(t.value) : '—'}</span>
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
      {/* Activity timer: grows green over 7 days, then steps through warning colors until day 14. */}
      {bar && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100" title={idle}>
          <div className={`h-full ${bar.color} transition-[width] duration-700`} style={{ width: `${bar.width}%` }} />
        </div>
      )}
    </div>
  );
}
