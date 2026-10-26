import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, ArrowLeftRight, CalendarDays, CheckSquare, Lock } from 'lucide-react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, pointerWithin, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, DAYS } from '../lib/data.js';
import { fullName, initials, shortDate, todayIso } from '../lib/format.js';
import { addDays, usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import PriorityPanel from './PriorityPanel.jsx';

// Prefer the card under the pointer, then the lane under the pointer, then the nearest target.
const collision = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => h.data?.droppableContainer?.data?.current?.type === 'card');
  return card ? [card] : hits.length ? hits : closestCenter(args);
};

const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export default function WeeklyPriorities() {
  const { user } = useAuth();
  const teams = useApi('/teams');
  const allUsers = useApi('/users');
  const meta = useApi('/priorities/meta');
  const [teamId, setTeamId] = useState(user.team_id || 1);
  const [weekDate, setWeekDate] = useState(todayIso());
  const [board, setBoard] = useState(null);
  const [lanes, setLanes] = useState({});
  const [filter, setFilter] = useState([]);
  const [orientation, setOrientation] = useState(readPref('kit.priorities.orientation', 'rows'));
  const [panel, setPanel] = useState(null); // { card } | { newFor: userId }
  const [activeId, setActiveId] = useState(null);

  const team = teams.data?.teams.find((t) => t.id === Number(teamId));

  const load = () => api.get(`/priorities?team=${teamId}&week=${weekDate}`).then(setBoard);
  useEffect(() => { load(); }, [teamId, weekDate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFilter([]); }, [teamId]);

  // Build each member's ordered lane from card assignments.
  useEffect(() => {
    if (!board) return;
    const next = {};
    board.members.forEach((m) => {
      next[m.id] = board.cards
        .map((c) => ({ c, a: c.assignees.find((a) => a.user_id === m.id) }))
        .filter((x) => x.a)
        .sort((x, y) => x.a.position - y.a.position)
        .map((x) => x.c.id);
    });
    setLanes(next);
  }, [board]);

  const cardsById = useMemo(() => Object.fromEntries((board?.cards || []).map((c) => [c.id, c])), [board]);
  const members = (board?.members || []).filter((m) => !filter.length || filter.includes(m.id));
  const editable = board && board.weekStart >= board.currentWeekStart;
  const usersById = useMemo(() => Object.fromEntries((allUsers.data?.users || []).map((u) => [u.id, u])), [allUsers.data]);

  const changeCheckin = async (dow) => {
    await api.put(`/teams/${teamId}/checkin`, { checkin_dow: Number(dow) });
    await teams.reload();
    load();
  };

  // ---- Drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = async ({ active, over }) => {
    setActiveId(null);
    if (!over || !editable) return;
    const src = active.data.current;
    const dst = over.data.current;
    if (!src || !dst) return;
    const next = { ...lanes };
    const from = [...(next[src.userId] || [])];
    if (src.userId === dst.userId) {
      const oldIdx = from.indexOf(src.cardId);
      const newIdx = dst.type === 'card' ? from.indexOf(dst.cardId) : from.length - 1;
      if (oldIdx === newIdx) return;
      next[src.userId] = arrayMove(from, oldIdx, newIdx);
    } else {
      const to = [...(next[dst.userId] || [])];
      if (to.includes(src.cardId)) return; // already assigned to that person
      next[src.userId] = from.filter((id) => id !== src.cardId);
      const at = dst.type === 'card' ? to.indexOf(dst.cardId) : to.length;
      to.splice(at < 0 ? to.length : at, 0, src.cardId);
      next[dst.userId] = to;
    }
    setLanes(next);
    const changed = Object.fromEntries([...new Set([src.userId, dst.userId])].map((u) => [u, next[u]]));
    const r = await api.put('/priorities/lanes', { team_id: board.team.id, week_start: board.weekStart, lanes: changed });
    setBoard((b) => ({ ...b, cards: r.cards }));
  };

  const activeCard = activeId ? cardsById[Number(String(activeId).split('::')[1])] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <PageHeader title="Weekly Priorities" subtitle="Set the week's priorities at check-in. Left-most (or top) card is the top priority.">
          <button className="btn" onClick={() => { const o = orientation === 'rows' ? 'columns' : 'rows'; setOrientation(o); writePref('kit.priorities.orientation', o); }}>
            <ArrowLeftRight size={15} /> {orientation === 'rows' ? 'Members as columns' : 'Members as rows'}
          </button>
        </PageHeader>

        <div className="flex flex-wrap items-end gap-4">
          <div className="w-52">
            <label className="label">Team</label>
            <select className="input" value={teamId} onChange={(e) => setTeamId(Number(e.target.value))}>
              {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="w-44">
            <label className="label">Weekly check-in day</label>
            <select className="input" value={team?.checkin_dow ?? 1} onChange={(e) => changeCheckin(e.target.value)}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="min-w-72 flex-1">
            <label className="label">Show members</label>
            <MultiSelect
              options={(board?.members || []).map((m) => ({ value: m.id, label: fullName(m), sub: m.title }))}
              value={filter}
              onChange={setFilter}
              placeholder="All members — type to filter…"
            />
          </div>
        </div>

        {board && <WeekStrip weekStart={board.weekStart} current={board.currentWeekStart} onPick={setWeekDate} />}

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-brand-600 bg-white ring-1 ring-slate-200" /> Planned at check-in</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-amber-500 bg-amber-50 ring-1 ring-amber-200" /> New work added after check-in</span>
          {board && !editable && <span className="flex items-center gap-1 text-slate-600"><Lock size={12} /> Past week — read only</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        {board && !members.length && <p className="py-16 text-center text-slate-400">No members on this team yet. Assign people to the team from their Profile.</p>}
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => setActiveId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className={orientation === 'rows' ? 'inline-flex min-w-full flex-col gap-3' : 'flex items-start gap-4'}>
            {members.map((m) => (
              <Lane key={m.id} member={m} orientation={orientation} cardIds={lanes[m.id] || []} cardsById={cardsById}
                usersById={usersById} editable={editable}
                onOpen={(card) => setPanel({ card })} onNew={() => setPanel({ newFor: m.id })} />
            ))}
          </div>
          <DragOverlay>{activeCard && <PriorityCard card={activeCard} usersById={usersById} rank={null} overlay />}</DragOverlay>
        </DndContext>
      </div>

      {panel && board && (
        <PriorityPanel
          key={panel.card?.id ?? `new-${panel.newFor}`}
          card={panel.card}
          defaultAssignee={panel.newFor}
          users={allUsers.data?.users || []}
          statuses={meta.data?.pipelineStatuses || []}
          teamId={board.team.id}
          weekStart={board.weekStart}
          readOnly={!editable}
          onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); load(); }}
        />
      )}
    </div>
  );
}

function WeekStrip({ weekStart, current, onPick }) {
  const ref = useRef(null);
  const weeks = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(current, (i - 25) * 7)), [current]);
  useEffect(() => {
    ref.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [weekStart]);
  return (
    <div className="flex items-center gap-2">
      <button className="btn p-2" onClick={() => onPick(addDays(weekStart, -7))} title="Previous week"><ChevronLeft size={16} /></button>
      <div ref={ref} className="flex flex-1 gap-1.5 overflow-x-auto scroll-smooth py-1 [scrollbar-width:thin]">
        {weeks.map((w) => {
          const sel = w === weekStart;
          return (
            <button key={w} data-selected={sel} onClick={() => onPick(w)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-left text-xs ${sel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-500'}`}>
              <div className="font-semibold">{shortDate(w)}</div>
              <div className={sel ? 'text-brand-100' : 'text-slate-400'}>{w === current ? 'This week' : new Date(`${w}T12:00:00`).getFullYear()}</div>
            </button>
          );
        })}
      </div>
      <button className="btn p-2" onClick={() => onPick(addDays(weekStart, 7))} title="Next week"><ChevronRight size={16} /></button>
      <label className="btn relative p-2" title="Jump to date">
        <CalendarDays size={16} />
        <input type="date" className="absolute inset-0 cursor-pointer opacity-0" onChange={(e) => e.target.value && onPick(e.target.value)} />
      </label>
      {weekStart !== current && <button className="btn" onClick={() => onPick(current)}>This week</button>}
    </div>
  );
}

function Lane({ member, orientation, cardIds, cardsById, usersById, editable, onOpen, onNew }) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane::${member.id}`, data: { type: 'lane', userId: member.id }, disabled: !editable });
  const items = cardIds.map((id) => `${member.id}::${id}`);
  const rows = orientation === 'rows';
  const header = (
    <div className={`flex items-center gap-2.5 ${rows ? 'sticky left-0 z-10 w-52 shrink-0 self-stretch border-r border-slate-200 bg-white px-4 py-3' : 'border-b border-slate-200 px-4 py-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials(member)}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{fullName(member)}</div>
        <div className="truncate text-xs text-slate-500">{member.title} · {cardIds.length} priorit{cardIds.length === 1 ? 'y' : 'ies'}</div>
      </div>
    </div>
  );
  return (
    <div className={`rounded-xl border bg-white shadow-sm ${isOver ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'} ${rows ? 'flex' : 'w-72 shrink-0'}`}>
      {header}
      <SortableContext items={items} strategy={rows ? horizontalListSortingStrategy : verticalListSortingStrategy} disabled={!editable}>
        <div ref={setNodeRef} className={`flex gap-3 p-3 ${rows ? 'min-h-32 flex-1 items-stretch' : 'min-h-40 flex-col'}`}>
          {cardIds.map((id, i) => cardsById[id] && (
            <SortableCard key={id} id={`${member.id}::${id}`} userId={member.id} card={cardsById[id]} rank={i + 1} usersById={usersById} onOpen={onOpen} rows={rows} />
          ))}
          {editable && (
            <button onClick={onNew}
              className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 text-sm text-slate-400 hover:border-brand-500 hover:text-brand-600 ${rows ? 'w-40' : 'py-3'}`}>
              <Plus size={16} /> Add priority
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableCard({ id, userId, card, rank, usersById, onOpen, rows }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id, data: { type: 'card', userId, cardId: card.id },
  });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
      className={`${rows ? 'w-64 shrink-0' : ''} ${isDragging ? 'opacity-30' : ''}`} onClick={() => onOpen(card)}>
      <PriorityCard card={card} rank={rank} usersById={usersById} />
    </div>
  );
}

export function PriorityCard({ card, rank, usersById, overlay }) {
  const planned = !!card.is_planned;
  const done = card.checklist.filter((c) => c.done).length;
  return (
    <div className={`h-full cursor-pointer rounded-lg border border-l-4 p-3 text-sm shadow-sm transition hover:shadow-md ${
      planned ? 'border-slate-200 border-l-brand-600 bg-white' : 'border-amber-200 border-l-amber-500 bg-amber-50'
    } ${card.completed ? 'opacity-60' : ''} ${overlay ? 'w-64 rotate-2 shadow-xl' : ''}`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className={`font-semibold leading-snug ${card.completed ? 'line-through' : ''}`}>{card.opportunity_title}</div>
        {rank && <span className={`shrink-0 rounded px-1.5 text-xs font-bold ${planned ? 'bg-brand-50 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>#{rank}</span>}
      </div>
      {card.title && <div className="mb-1 text-slate-700">{card.title}</div>}
      {card.organization && <div className="text-xs text-slate-500">{card.organization}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {card.pipeline_status && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{card.pipeline_status}</span>}
        {card.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{usd(card.value).replace('.00', '')}</span>}
        {card.due_date && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Due {shortDate(card.due_date)}</span>}
        {card.checklist.length > 0 && <span className="flex items-center gap-0.5 text-slate-500"><CheckSquare size={12} />{done}/{card.checklist.length}</span>}
      </div>
      {card.assignees.length > 1 && (
        <div className="mt-2 flex -space-x-1.5">
          {card.assignees.map((a) => (
            <span key={a.user_id} title={fullName(usersById[a.user_id])}
              className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-700 ring-2 ring-white">
              {initials(usersById[a.user_id])}
            </span>
          ))}
        </div>
      )}
      {!planned && <div className="mt-2 text-[10px] font-semibold tracking-wide text-amber-700 uppercase">New work</div>}
    </div>
  );
}
