import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, ArrowLeftRight, CalendarDays, Lock, LockOpen, Settings, X, Archive, Target, ListChecks, Redo2, Zap } from 'lucide-react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter, pointerWithin, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi, DAYS } from '../lib/data.js';
import { fullName, initials, shortDate, todayIso, stamp } from '../lib/format.js';
import { addDays } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import PriorityPanel from './PriorityPanel.jsx';
import PriorityCard from './PriorityCard.jsx';
import StrategicPriorities from '../components/StrategicPriorities.jsx';
import TaskView from '../components/TaskView.jsx';
import CommentPanel from './CommentPanel.jsx';
import { LANE_VIEWS, ViewSwitcher, TicketsView, TasksView, ThreadsView, WorkView } from './LaneViews.jsx';

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
  const navigate = useNavigate();
  const teams = useApi('/teams');
  const allUsers = useApi('/users');
  const meta = useApi('/priorities/meta');
  // Open on your team's board; someone on several teams (or none) starts on All.
  const [teamId, setTeamId] = useState(user.team_ids?.length === 1 ? user.team_ids[0] : 'all');
  const [weekDate, setWeekDate] = useState(todayIso());
  const [board, setBoard] = useState(null);
  const [lanes, setLanes] = useState({});
  const [filter, setFilter] = useState([]);
  const [mode, setModeState] = useState(() => readPref('kit.priorities.mode', 'weekly'));
  const setMode = (m) => { setModeState(m); writePref('kit.priorities.mode', m); };
  const strategic = mode === 'strategic';
  const tasks = mode === 'tasks';
  const weekly = !strategic && !tasks;
  const [orientation, setOrientation] = useState(readPref('kit.priorities.orientation', 'rows'));
  const [showWeeks, setShowWeeksState] = useState(() => readPref('kit.priorities.weeks', 'shown') !== 'hidden');
  const setShowWeeks = (v) => { setShowWeeksState(v); writePref('kit.priorities.weeks', v ? 'shown' : 'hidden'); };
  const [panel, setPanel] = useState(null); // { card } | { newFor: userId }
  const [thread, setThread] = useState(null); // { id } | { options } for a new question or comment
  const [activeId, setActiveId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isAll = teamId === 'all';
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
  // With Focus on the board is just you (the server sends no one else), so there's nobody to filter.
  const members = (board?.members || []).filter((m) => user.focus || !filter.length || filter.includes(m.id));
  const editable = board && board.weekStart >= board.currentWeekStart;
  const planning = board?.planning;
  // On the All board each team has its own lock; someone's new cards are work once all their teams have closed planning.
  const planningClosedFor = (m) => (board?.team.id === 'all'
    ? !!m?.team_ids?.length && m.team_ids.every((id) => planning?.closed_teams.includes(id))
    : !!planning?.closed);
  const [planningBusy, setPlanningBusy] = useState(false);
  const togglePlanning = async () => {
    const closing = !planning.closed;
    if (closing && !confirm('Close planning for this week? Anything added from now on is tracked as work, not priorities.')) return;
    setPlanningBusy(true);
    try {
      const r = await api.put('/priorities/planning', { team: board.team.id, week: board.weekStart, closed: closing });
      setBoard((b) => ({ ...b, planning: r.planning }));
    } finally {
      setPlanningBusy(false);
    }
  };
  const draggable = editable;
  const usersById = useMemo(() => Object.fromEntries((allUsers.data?.users || []).map((u) => [u.id, u])), [allUsers.data]);

  // Teams check in on different days, so a picked week's start date can fall in another team's previous week.
  // Keep the same week relative to this week instead (this week stays this week).
  const changeTeam = (id) => {
    if (board) {
      const offset = Math.round((Date.parse(board.weekStart) - Date.parse(board.currentWeekStart)) / (7 * 864e5));
      setWeekDate(addDays(todayIso(), offset * 7));
    }
    setTeamId(id);
  };

  const changeCheckin = async (id, dow) => {
    await api.put(`/teams/${id}/checkin`, { checkin_dow: Number(dow) });
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
    if (!over || !draggable) return;
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

  const newMember = panel?.newFor ? board?.members.find((m) => m.id === panel.newFor) : null;
  // Check off a task right away, then save. The server moves it to the end of its list.
  const toggleTask = async (card, index, done) => {
    const move = (c) => {
      const list = [...c.checklist];
      const [item] = list.splice(index, 1);
      return { ...c, checklist: [...list, { ...item, done }] };
    };
    setBoard((b) => ({ ...b, cards: b.cards.map((c) => (c.id === card.id ? move(c) : c)) }));
    try {
      const r = await api.put(`/priorities/cards/${card.id}/checklist/${index}`, { done });
      setBoard((b) => ({ ...b, cards: b.cards.map((c) => (c.id === card.id ? r.card : c)) }));
      if (done) load(); // a finished task is logged as work
    } catch {
      load();
    }
  };

  // A member's threads are comments about one of their priorities: this week's, or an earlier one they're
  // assigned to on the same master ticket. Comments about a master ticket as a whole stay on the ticket.
  const threadsFor = (member, cardIds) => {
    const cards = cardIds.map((id) => cardsById[id]).filter(Boolean);
    const ids = new Set(cards.map((c) => c.id));
    const tickets = new Set(cards.map((c) => c.ticket_id));
    return (board?.threads || []).filter((m) => m.card_id
      && (ids.has(m.card_id) || (tickets.has(m.ticket_id) && m.card_assignee_ids.includes(member.id))));
  };
  // What a new comment can be about: each of the member's priorities, grouped by master ticket.
  const aboutOptions = (cardIds) => {
    const byTicket = new Map();
    cardIds.map((id) => cardsById[id]).filter(Boolean).forEach((c) => {
      if (!byTicket.has(c.ticket_id)) byTicket.set(c.ticket_id, { ticket_id: c.ticket_id, title: c.opportunity_title, cards: [] });
      byTicket.get(c.ticket_id).cards.push({ id: c.id, title: c.title || 'Untitled priority' });
    });
    return [...byTicket.values()];
  };

  // Open what a work entry points at: its thread, its priority, or the ticket timeline.
  const openWork = (w) => {
    if (['question', 'comment', 'reply'].includes(w.kind) && w.ref_id) return setThread({ id: w.ref_id });
    if (w.card_id && cardsById[w.card_id]) return setPanel({ card: cardsById[w.card_id] });
    if (w.ticket_id) navigate(`/tickets?open=${w.ticket_id}`);
  };

  const activeCard = activeId ? cardsById[Number(String(activeId).split('::')[1])] : null;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <PageHeader title={strategic ? 'Strategic Priorities' : tasks ? 'Tasks' : 'Weekly Priorities'}
          subtitle={strategic ? 'Priority accounts and priority tickets: the agencies, pipeline tickets and work tickets that matter most, for the team or each member.'
            : tasks ? 'How the team’s tasks stand. Choose a member for their full list, by this week, due date and strategic priority.' : "Set the week's priorities at check-in. Left-most (or top) card is the top priority. Unfinished priorities roll into the next week."}>
          {weekly && <>
          <button className="btn" onClick={() => { const o = orientation === 'rows' ? 'columns' : 'rows'; setOrientation(o); writePref('kit.priorities.orientation', o); }}>
            <ArrowLeftRight size={15} /> {user.focus ? 'Views' : 'Members'} as {orientation === 'rows' ? 'columns' : 'rows'}
          </button>
          <button className="btn" onClick={() => navigate('/archive?tab=cards')} title="Archived priority cards"><Archive size={15} /> Archive</button>
          <button className="btn" onClick={() => setSettingsOpen(true)}><Settings size={15} /> Settings</button>
          </>}
        </PageHeader>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="label">View</span>
            <div className="flex h-[38px] rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Priorities view">
              {[['strategic', 'Strategic', Target], ['weekly', 'Weekly', CalendarDays], ['tasks', 'Task', ListChecks]].map(([k, label, Icon]) => (
                <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                  className={`flex items-center gap-1.5 rounded-md px-3 text-sm ${mode === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>
          <div className="w-52">
            <label className="label">Team</label>
            <select className="input" value={teamId} onChange={(e) => changeTeam(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All</option>
              {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          {user.focus ? <div className="flex-1" /> : (
          <div className="min-w-72 flex-1">
            <label className="label">Show members</label>
            <MultiSelect
              options={(board?.members || []).map((m) => ({ value: m.id, label: fullName(m), sub: m.team_name ? `${m.title || ''} · ${m.team_name}` : m.title }))}
              value={filter}
              onChange={setFilter}
              placeholder="All members — type to filter…"
            />
          </div>
          )}
          {weekly && (
            <button type="button" aria-pressed={showWeeks} aria-controls="week-strip" onClick={() => setShowWeeks(!showWeeks)}
              title={`${showWeeks ? 'Hide' : 'Show'} the weeks${board ? ` · showing the week of ${shortDate(board.weekStart)}` : ''}`}
              className={`btn h-[38px] px-2.5 ${showWeeks ? 'bg-brand-50 text-brand-700 ring-brand-200' : ''}`}>
              <CalendarDays size={16} />
              {!showWeeks && board && <span className="text-xs">{board.weekStart === board.currentWeekStart ? 'This week' : shortDate(board.weekStart)}</span>}
            </button>
          )}
        </div>

        {board && weekly && showWeeks && <WeekStrip weekStart={board.weekStart} current={board.currentWeekStart} onPick={setWeekDate} />}

        {weekly && <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-brand-600 bg-white ring-1 ring-slate-200" /> Priority (planned)</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-red-500 bg-red-50 ring-1 ring-red-200" /> Mid-sprint add (after planning closed)</span>
          <span className="flex items-center gap-1.5"><Zap size={13} className="text-amber-500" /> Work (logged automatically)</span>
          <span className="flex items-center gap-1.5"><span className="flex h-3.5 items-center rounded bg-violet-100 px-1 text-violet-800"><Redo2 size={9} strokeWidth={3} /></span> Rolled over (unfinished last week)</span>
          {board && !editable && <span className="flex items-center gap-1 text-slate-600"><Lock size={12} /> Past week — read only</span>}
          {planning && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-slate-400">
                {planning.closed
                  ? `Planning closed${planning.closed_by ? ` by ${planning.closed_by}` : ''}${planning.closed_at ? ` · ${stamp(planning.closed_at)}` : ''}`
                  : planning.closed_count > 0 ? `Planning closed for ${planning.closed_count} of ${planning.total} teams` : 'Planning open'}
              </span>
              {editable && (
                <button className={planning.closed ? 'btn' : 'btn-primary'} onClick={togglePlanning} disabled={planningBusy}>
                  {planning.closed ? <><LockOpen size={15} /> Open planning</> : <><Lock size={15} /> Close planning</>}
                </button>
              )}
            </div>
          )}
        </div>}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        {strategic ? (board && <StrategicPriorities members={members} me={user.id} />) : tasks ? (board && <TaskView members={members} teamSize={board.members.length} onPick={(id) => setFilter(id ? [id] : [])} />) : <>
        {board && !members.length && <p className="py-16 text-center text-slate-400">{user.focus ? 'You aren’t on this team. Focus is on, so only your own priorities show: pick one of your teams, or All.' : 'No members on this team yet. Assign people to the team from their Profile.'}</p>}
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => setActiveId(active.id)} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
          <div className={orientation === 'rows' ? 'inline-flex min-w-full flex-col gap-3' : 'flex items-start gap-4'}>
            {/* With Focus on there's only your lane, so each of its views gets a lane of its own instead of sharing one. */}
            {members.flatMap((m) => (user.focus ? LANE_VIEWS.map((v) => v.key) : [null]).map((fixedView) => (
              <Lane key={`${m.id}-${fixedView}`} fixedView={fixedView} member={m} orientation={orientation} cardIds={lanes[m.id] || []} cardsById={cardsById}
                usersById={usersById} editable={editable && (board.team.id !== 'all' || !!m.team_ids?.length)} draggable={draggable}
                onOpen={(card) => setPanel({ card })} onNew={() => setPanel({ newFor: m.id })}
                onToggleTask={toggleTask} threads={threadsFor(m, lanes[m.id] || [])}
                onOpenThread={(t) => setThread({ id: t.id })}
                work={(board.work || []).filter((w) => w.user_id === m.id)} onOpenWork={openWork}
                onNewThread={(lanes[m.id] || []).length ? () => setThread({ options: aboutOptions(lanes[m.id]), member: m }) : null} />
            )))}
          </div>
          <DragOverlay>{activeCard && <PriorityCard card={activeCard} usersById={usersById} rank={null} overlay />}</DragOverlay>
        </DndContext>
        </>}
      </div>

      {settingsOpen && (
        <SettingsPanel teams={isAll ? teams.data?.teams || [] : team ? [team] : []} onChange={changeCheckin} onClose={() => setSettingsOpen(false)} />
      )}

      {thread && (
        <CommentPanel key={thread.id ?? 'new'} threadId={thread.id} options={thread.options} member={thread.member}
          onClose={() => setThread(null)} onPosted={(id) => { setThread({ id }); load(); }} onChanged={load} />
      )}

      {panel && board && (
        <PriorityPanel
          key={panel.card?.id ?? `new-${panel.newFor}`}
          card={panel.card}
          defaultAssignee={panel.newFor}
          users={allUsers.data?.users || []}
          statuses={meta.data?.pipelineStatuses || []}
          teamId={board.team.id}
          weekStart={board.weekStart}
          teamChoices={board.team.id === 'all' && !panel.card
            ? (newMember?.teams || []).map((t) => ({ id: t.id, name: t.name, week: board.teamWeeks[t.id] })) : undefined}
          readOnly={!editable}
          midSprint={planningClosedFor(newMember)}
          onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); load(); }}
          onNotesChanged={load}
        />
      )}
    </div>
  );
}

/** Slide-out panel for board settings. On the All board, each team's check-in day is listed. */
function SettingsPanel({ teams, onChange, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/20" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-[slidein_.2s_ease-out]">
        <style>{'@keyframes slidein{from{transform:translateX(100%)}to{transform:none}}'}</style>
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">Weekly Priorities settings</h2>
          <button className="btn-ghost p-1.5" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {teams.map((t) => (
            <div key={t.id}>
              <label className="label">{teams.length > 1 ? `${t.name} · weekly check-in day` : 'Weekly check-in day'}</label>
              <select className="input" value={t.checkin_dow} onChange={(e) => onChange(t.id, e.target.value)}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

function WeekStrip({ weekStart, current, onPick }) {
  const ref = useRef(null);
  const weeks = useMemo(() => Array.from({ length: 30 }, (_, i) => addDays(current, (i - 25) * 7)), [current]);
  useEffect(() => {
    ref.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [weekStart]);
  return (
    <div id="week-strip" className="flex items-center gap-2">
      <button className="btn p-2" onClick={() => onPick(addDays(weekStart, -7))} title="Previous week"><ChevronLeft size={16} /></button>
      <div ref={ref} className="flex flex-1 gap-1.5 overflow-x-auto scroll-smooth py-1 [scrollbar-width:thin]">
        {weeks.map((w) => {
          const sel = w === weekStart;
          const now = w === current;
          return (
            <button key={w} data-selected={sel} onClick={() => onPick(w)}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-left text-xs ${sel ? 'border-brand-600 bg-brand-600 text-white' : now ? 'border-brand-500 bg-brand-100 text-brand-700 hover:border-brand-600' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-500'}`}>
              <div className="font-semibold">{shortDate(w)}</div>
              <div className={sel ? 'text-brand-100' : now ? 'text-brand-600' : 'text-slate-400'}>{w === current ? 'This week' : new Date(`${w}T12:00:00`).getFullYear()}</div>
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

/**
 * One person's lane. Its views share the lane, picked with the icon strip, unless `fixedView` pins it to one: then the
 * lane is headed by that view's name instead of the person's (Focus shows a lane per view, all of them yours).
 */
function Lane({ fixedView = null, member, work = [], onOpenWork, orientation, cardIds, cardsById, usersById, editable, draggable, onOpen, onNew, onToggleTask, threads, onOpenThread, onNewThread }) {
  // A saved view that no longer exists (the old Support tab) falls back to priority order.
  const [pickedView, setViewState] = useState(() => {
    const v = readPref(`kit.priorities.view.${member.id}`, 'priorities');
    return LANE_VIEWS.some((l) => l.key === v) ? v : 'priorities';
  });
  const setView = (v) => { setViewState(v); writePref(`kit.priorities.view.${member.id}`, v); };
  const view = fixedView || pickedView;
  const sortable = draggable && view === 'priorities';
  // Only the priority-order lane takes drops; a pinned lane for another view has its own id so it can't stand in for it.
  const { setNodeRef, isOver } = useDroppable({ id: fixedView && fixedView !== 'priorities' ? `lane::${member.id}::${fixedView}` : `lane::${member.id}`, data: { type: 'lane', userId: member.id }, disabled: !sortable });
  const items = cardIds.map((id) => `${member.id}::${id}`);
  const rows = orientation === 'rows';
  const pinned = LANE_VIEWS.find((l) => l.key === fixedView);
  const tasksOn = cardIds.flatMap((id) => cardsById[id]?.checklist || []);
  const pinnedCount = {
    priorities: `${cardIds.length} priorit${cardIds.length === 1 ? 'y' : 'ies'}`,
    tickets: ((n) => `${n} ticket${n === 1 ? '' : 's'}`)(new Set(cardIds.map((id) => cardsById[id]?.ticket_id).filter(Boolean)).size),
    tasks: `${tasksOn.filter((t) => t.done).length} of ${tasksOn.length} done`,
    threads: `${threads.length} open`,
    work: `${work.length} logged`,
  }[fixedView];
  const header = pinned ? (
    <div className={`flex items-center gap-2.5 ${rows ? 'sticky left-0 z-10 w-52 shrink-0 self-stretch border-r border-slate-200 bg-white px-4 py-3' : 'border-b border-slate-200 px-4 py-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700">{pinned.icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-semibold whitespace-normal">{pinned.label}</div>
        <div className="truncate text-xs text-slate-500">{pinnedCount}</div>
      </div>
    </div>
  ) : (
    <div className={`flex items-center gap-2.5 ${rows ? 'sticky left-0 z-10 w-52 shrink-0 self-stretch border-r border-slate-200 bg-white px-4 py-3' : 'border-b border-slate-200 px-4 py-3'}`}>
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials(member)}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{fullName(member)}</div>
        <div className="truncate text-xs text-slate-500">{member.title}{member.team_name && ` · ${member.team_name}`} · {cardIds.length} priorit{cardIds.length === 1 ? 'y' : 'ies'}{work.length > 0 && ` · ${work.length} work`}</div>
      </div>
    </div>
  );
  const body = `flex gap-3 p-3 ${rows ? 'min-h-32 flex-1 items-stretch' : 'min-h-40 flex-col'}`;
  return (
    <div className={`rounded-xl border bg-white shadow-sm ${isOver ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'} ${rows ? 'flex' : `${view === 'tasks' ? 'w-80' : 'w-72'} shrink-0`}`}>
      {header}
      {!pinned && (
        <div className={rows ? 'sticky left-52 z-10 flex self-stretch bg-white' : ''}>
          <ViewSwitcher view={view} onChange={setView} rows={rows} counts={{ threads: threads.length, work: work.length }} />
        </div>
      )}
      {view === 'priorities' && (
        <SortableContext items={items} strategy={rows ? horizontalListSortingStrategy : verticalListSortingStrategy} disabled={!sortable}>
          <div ref={setNodeRef} className={body}>
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
      )}
      {view === 'tickets' && <div className={body}><TicketsView cardIds={cardIds} cardsById={cardsById} usersById={usersById} rows={rows} onOpen={onOpen} /></div>}
      {view === 'tasks' && <div className={body}><TasksView cardIds={cardIds} cardsById={cardsById} rows={rows} editable={editable} onToggle={onToggleTask} onOpen={onOpen} /></div>}
      {view === 'threads' && <div className={body}><ThreadsView threads={threads} rows={rows} onOpenThread={onOpenThread} onNew={onNewThread} /></div>}
      {view === 'work' && <div className={body}><WorkView work={work} rows={rows} onOpen={onOpenWork} /></div>}
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
