import { useEffect, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { Archive, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullStamp, ticketKind } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { LANES, daysToArchive } from '../lib/lanes.js';
import { activityTimer, daysSince } from '../lib/activityTimer.js';
import Avatar from '../components/Avatar.jsx';
import { LabelList } from '../components/Labels.jsx';
import NextStepBadge from '../components/NextStepBadge.jsx';

const money = (n) => usd(n).replace('.00', '');
const HINT = {
  todo: 'New tickets, and PL tickets quiet for 14+ days',
  in_work: 'PL tickets with activity in the last 7 days',
  stale: 'PL tickets quiet for 7–14 days',
  done: 'Won, lost, or finished. Work tickets archive after 14 days; won and lost deals stay, and are in Closed deals.',
};

/**
 * Tickets as swim lanes: To-do, In work, Stale / waiting, Done. Work tickets are dragged between lanes and archived from
 * Done. Pipeline tickets are read-only here: they move on their own from the deal's activity and status.
 */
export default function TicketLanes({ tickets, onOpen, onOpenStep, onChanged }) {
  const [board, setBoard] = useState(tickets);
  const [dragId, setDragId] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setBoard(tickets); }, [tickets]);
  // Re-render every minute so the activity bars keep growing.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const change = async (t, body, optimistic) => {
    setError('');
    if (optimistic) setBoard((xs) => xs.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    try {
      await api.put(`/tickets/${t.id}/lane`, body);
    } catch (e) {
      setError(e.message);
    }
    onChanged();
  };

  const onDragEnd = ({ active, over }) => {
    setDragId(null);
    const t = board.find((x) => x.id === active.id);
    if (!over || !t || t.ticket_type !== 'work' || t.lane === over.id) return;
    change(t, { lane: over.id }, { lane: over.id });
  };
  const archive = (t) => change(t, { archived: true }, { archived: true });

  const dragging = dragId && board.find((t) => t.id === dragId);
  const live = board.filter((t) => !t.archived);

  return (
    <div>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={({ active }) => setDragId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <div className="grid min-h-96 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {LANES.map((l) => (
            <Lane key={l.key} lane={l} tickets={live.filter((t) => t.lane === l.key)} dragId={dragId} now={now}
              onOpen={onOpen} onOpenStep={onOpenStep} onArchive={archive} />
          ))}
        </div>
        <DragOverlay>{dragging && <LaneCard ticket={dragging} now={now} overlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Lane({ lane, tickets, dragId, now, onOpen, onOpenStep, onArchive }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane.key });
  return (
    <section ref={setNodeRef} aria-label={`${lane.label} lane`}
      className={`flex flex-col rounded-xl border transition ${isOver ? 'border-brand-500 bg-brand-50/60 ring-2 ring-brand-100' : 'border-slate-200 bg-slate-50/70'}`}>
      <header className="border-b border-slate-200 px-3 py-2.5">
        <div className="flex items-baseline gap-1.5">
          <h2 className="text-sm font-semibold text-slate-800">{lane.label}</h2>
          <span className="text-xs text-slate-400">{tickets.length}</span>
        </div>
        <p className="text-[11px] text-slate-400">{HINT[lane.key]}</p>
      </header>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {tickets.map((t) => (
          <DraggableCard key={t.id} ticket={t} hidden={dragId === t.id} now={now} onOpen={onOpen} onOpenStep={onOpenStep} onArchive={onArchive} />
        ))}
        {!tickets.length && (
          <p className={`rounded-lg border-2 border-dashed px-3 py-6 text-center text-xs ${isOver ? 'border-brand-500 text-brand-600' : 'border-slate-200 text-slate-400'}`}>
            {isOver ? 'Drop here' : 'Nothing here'}
          </p>
        )}
      </div>
    </section>
  );
}

/** Work tickets drag between lanes; pipeline tickets only open. */
function DraggableCard({ ticket, hidden, ...rest }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: ticket.id, disabled: ticket.ticket_type !== 'work' });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} onClick={() => rest.onOpen(ticket.id)} className={hidden ? 'opacity-30' : ''}>
      <LaneCard ticket={ticket} {...rest} />
    </div>
  );
}

function LaneCard({ ticket: t, now, overlay, onOpenStep, onArchive }) {
  const owner = t.owner_first_name ? { id: t.created_by, first_name: t.owner_first_name, last_name: t.owner_last_name } : null;
  const isBid = t.ticket_type !== 'work';
  // In work and Stale share one running clock: the same activity bar as on BD Pipeline.
  const timed = t.lane === 'in_work' || t.lane === 'stale';
  const days = daysSince(t.last_activity, now);
  const { bar, counter } = activityTimer(days);
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div className={`relative overflow-hidden rounded-lg border bg-white p-3 pr-11 text-sm shadow-sm transition hover:border-brand-500 hover:shadow-md ${
      isBid ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} border-slate-200 ${overlay ? 'w-72 rotate-2 shadow-xl' : ''}`}>
      <NextStepBadge step={t.next_step} onOpen={() => onOpenStep?.(t)} className="absolute top-1/2 right-2.5 -translate-y-1/2" />
      <div className="flex items-start justify-between gap-2">
        <div className="line-clamp-2 font-semibold leading-snug text-slate-900" title={t.opportunity_title}>{t.opportunity_title}</div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${isBid ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-700'}`}>{isBid ? 'PL' : 'Work'}</span>
      </div>
      <div className="mt-0.5 h-4 truncate text-xs text-slate-500">{[t.organization, t.pipeline_status].filter(Boolean).join(' · ')}</div>
      <LabelList labels={t.labels} className="mt-1.5" />
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span className="flex min-w-0 items-center gap-1.5">
          {t.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-medium text-emerald-700">{money(t.value)}</span>}
          {owner && <Avatar user={owner} size="xs" />}
          {t.lane === 'done' && daysToArchive(t, now) != null && <span title={`Archives ${daysToArchive(t, now) ? `in ${daysToArchive(t, now)} days` : 'today'}`}>Archives in {daysToArchive(t, now)}d</span>}
          {timed && counter && <span className="flex items-center gap-0.5 font-medium text-slate-500" title={`${Math.floor(days)} days since last activity (${fullStamp(t.last_activity)})`}><Clock size={11} /> {counter}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {!isBid && t.lane === 'done' && onArchive && (
            <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={stop(() => onArchive(t))} title="Move to the Done archive now" aria-label="Move to the Done archive now"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Archive size={14} /></button>
          )}
        </span>
      </div>
      {timed && bar && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100" title={`${Math.floor(days)} days since last activity`}>
          <div className={`h-full ${bar.color}`} style={{ width: `${bar.width}%` }} />
        </div>
      )}
      <span className="sr-only">{ticketKind(t)}</span>
    </div>
  );
}
