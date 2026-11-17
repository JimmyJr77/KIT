import { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Search, ArrowUp, ArrowDown, GripVertical, Check, FileText, PenLine, Circle, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { useAuth } from '../lib/auth.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import Avatar from '../components/Avatar.jsx';
import { fullName, stamp } from '../lib/format.js';
import { isBdDirector } from '../lib/bd.js';
import { LabelList } from '../components/Labels.jsx';
import { PROCESS_TYPES, CRITICALITY, milestoneOf } from '../lib/process.js';
import { DueDate, CriticalityPill } from './TicketPlanning.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import { PipelineViewToggle } from './ProcessView.jsx';

const CRIT_RANK = Object.fromEntries(CRITICALITY.map((c, i) => [c.key, i]));
const today = () => new Date().toLocaleDateString('en-CA');
// Priority order: the list's own order (yours on My tickets, the team lead's on All), then how critical, then due date.
const rankOf = (scope) => (r) => (scope === 'mine' ? r.my_rank : r.master_rank);
const priorityCompare = (scope) => (a, b) => {
  const x = rankOf(scope)(a);
  const y = rankOf(scope)(b);
  if (x != null || y != null) { if (x == null || y == null) return (x == null) - (y == null); if (x !== y) return x - y; }
  return (CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality]) || dueCompare(a, b);
};
const dueCompare = (a, b) => ((!a.due_date) - (!b.due_date)) || String(a.due_date || '').localeCompare(String(b.due_date || '')) || a.id - b.id;
const SORTS = {
  priority: { label: 'Priority order', compare: priorityCompare },
  due: { label: 'Due date', compare: () => dueCompare },
  critical: { label: 'How critical', compare: () => (a, b) => (CRIT_RANK[a.criticality] - CRIT_RANK[b.criticality]) || dueCompare(a, b) },
  event: { label: 'Staffing event', compare: () => (a, b) => (PROCESS_TYPES.indexOf(a.step_type) - PROCESS_TYPES.indexOf(b.step_type)) || dueCompare(a, b) },
  name: { label: 'Opportunity', compare: () => (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || dueCompare(a, b) },
};
const saved = (key, ok, fallback) => { try { const v = localStorage.getItem(key); return ok(v) ? v : fallback; } catch { return fallback; } };
const keep = (key, v) => { try { localStorage.setItem(key, v); } catch { /* not kept */ } };

/**
 * SAC, Solution Architect Coordination: every open staffing event on a pipeline ticket (RFI responses, white papers, gate
 * reviews, SOO, SOW, ROM, proposals) as one list to work down. Tickets join when staffed: from the ticket pane's Staff
 * Ticket, a drop on a board bucket, or a process tag. Each person drags their own tickets into order on My tickets; team
 * leads and admins order the master list on All tickets. A click on a row opens that event's blocks of work.
 */
export default function SolutionArchitectCoordination() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [canRankMaster, setCanRankMaster] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // { ticket_id, id } of the event whose pane is open
  const [showDone, setShowDone] = useState(false);
  const take = (d) => { setRows(d.rows); setCanRankMaster(!!d.can_rank_master); };
  const load = () => api.get(`/sac${showDone ? '?done=1' : ''}`).then(take).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [showDone]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (call) => { setError(''); try { await call(); await load(); } catch (e) { setError(e.message); } };

  const users = useApi('/users');
  const territories = useApi('/territories');
  const [scope, setScopeState] = useState(() => saved('kit.sac.scope', (v) => ['mine', 'all'].includes(v), 'all'));
  const setScope = (v) => { setScopeState(v); keep('kit.sac.scope', v); };
  const [filters, setFilters] = useState([]); // "d:<user id>" for BD directors, "t:<territory id>" for territories
  const filterOptions = useMemo(() => [
    ...(users.data?.users || []).filter(isBdDirector).sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }))
      .map((u) => ({ value: `d:${u.id}`, label: fullName(u), group: 'BD directors' })),
    ...(territories.data?.territories || []).map((t) => ({ value: `t:${t.id}`, label: t.name, group: 'Territories' })),
  ], [users.data, territories.data]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sort, setSortState] = useState(() => saved('kit.sac.sort', (v) => !!SORTS[v], 'priority'));
  const setSort = (v) => { setSortState(v); keep('kit.sac.sort', v); };

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    const directors = filters.filter((f) => f.startsWith('d:')).map((f) => Number(f.slice(2)));
    const terrs = filters.filter((f) => f.startsWith('t:')).map((f) => Number(f.slice(2)));
    return (rows || []).filter((r) => scope === 'all' || r.mine)
      .filter((r) => (!directors.length || directors.includes(r.director?.id)) && (!terrs.length || terrs.includes(r.territory?.id)))
      .filter((r) => !type || r.step_type === type)
      .filter((r) => !words || `${r.title} ${r.organization || ''} ${r.step_type} ${r.request}`.toLowerCase().includes(words))
      .sort(SORTS[sort].compare(scope));
  }, [rows, scope, filters, type, q, sort]);

  // Dragging rows sets the order: on My tickets, your own; on All tickets, the master list (team leads and admins only).
  const canDrag = !showDone && sort === 'priority' && (scope === 'mine' || canRankMaster);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    // The whole list in its current order (not just the rows the filters leave), with the dragged row moved to where it was dropped.
    const all = (rows || []).filter((r) => scope === 'all' || r.mine).sort(priorityCompare(scope));
    const from = all.findIndex((r) => r.id === active.id);
    const to = all.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    const ids = arrayMove(all, from, to).map((r) => r.id);
    const rank = scope === 'mine' ? 'my_rank' : 'master_rank';
    setRows((xs) => xs.map((r) => (ids.includes(r.id) ? { ...r, [rank]: ids.indexOf(r.id) + 1 } : r)));
    setError('');
    api.put('/sac/rank', { list: scope === 'mine' ? 'mine' : 'master', ids }).then(take).catch((e) => { setError(e.message); load(); });
  };

  const late = shown.filter((r) => r.due_date && r.due_date < today()).length;
  const critical = shown.filter((r) => r.criticality === 'critical').length;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 border-b border-slate-200 bg-white px-8 pt-8 pb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 flex-1 basis-56">
            <h1 className="text-2xl font-bold text-slate-900">Solution Architect Coordination</h1>
            <p className="mt-0.5 text-sm text-slate-500">Every staffed pursuit: RFI responses, white papers, gate reviews, SOO, SOW, ROM and proposals. Click a row to write or respond.</p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <div className="w-80 text-left">
              <MultiSelect compact options={filterOptions} value={filters} onChange={setFilters} placeholder="Filter by BD director or territory…" />
            </div>
            <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
              {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => setScope(k)}
                  className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
              ))}
            </div>
            <PipelineViewToggle />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative w-full max-w-xs">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Search this list…" aria-label="Search this list" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input h-[38px] w-56 py-0" aria-label="Show one staffing event" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Every staffing event</option>
            {PROCESS_TYPES.map((t) => <option key={t} value={t}>{t} ({milestoneOf(t).tag})</option>)}
          </select>
          <select className="input h-[38px] w-44 py-0" aria-label="Sort the list" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(SORTS).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done instead
          </label>
          {rows && !showDone && (
            <span className="text-sm text-slate-500">
              {shown.length} open{critical > 0 && <> · <span className="font-medium text-red-700">{critical} critical</span></>}{late > 0 && <> · <span className="font-medium text-red-700">{late} past due</span></>}
            </span>
          )}
          {error && <span className="rounded-md bg-red-50 px-3 py-1.5 text-sm text-red-700">{error}</span>}
        </div>
        <p className="text-xs text-slate-400">
          {showDone ? 'Done staffing events. Reopen one to put it back on the list.'
            : sort !== 'priority' ? 'Sorted by ' + SORTS[sort].label.toLowerCase() + '. Switch to Priority order to drag rows into order.'
            : scope === 'mine' ? 'Your tickets in your own order: drag a row by its handle to set what matters most.'
            : canRankMaster ? 'The master list: as a team lead, drag a row by its handle to set the order everyone sees.'
            : 'The master list, in the order team leads set. Switch to My tickets to order your own.'}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="w-full min-w-[90rem] table-fixed text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="w-12 py-2.5 pl-3">#</th>
                  <th className="w-[20%] px-3 py-2.5">Opportunity</th>
                  <th className="w-44 px-3 py-2.5">Staffing event</th>
                  <th className="w-36 px-3 py-2.5">Due date</th>
                  <th className="w-44 px-3 py-2.5">How critical</th>
                  <th className="w-32 px-3 py-2.5">Architects</th>
                  <th className="px-3 py-2.5">Request</th>
                  <th className="w-56 px-3 py-2.5">Work</th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <SortableContext items={shown.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <tbody className="divide-y divide-slate-100">
                  {rows === null && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
                  {rows?.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                      {showDone ? 'Nothing is done yet.' : 'Nothing is staffed yet. Use Staff Ticket in a pipeline ticket, drag a ticket onto a bucket on the board, or give it a process tag.'}
                    </td></tr>
                  )}
                  {rows?.length > 0 && !shown.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">No staffing events match.</td></tr>}
                  {shown.map((r, i) => (
                    <Row key={r.id} row={r} n={i + 1} draggable={canDrag && (scope === 'all' || r.mine)} selected={open?.id === r.id} user={user}
                      onOpen={() => setOpen({ ticket_id: r.ticket_id, id: r.id })} run={run} />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>
      </div>

      {open && <TicketTimeline key={`${open.ticket_id}-${open.id}`} ticketId={open.ticket_id} stepId={open.id} onClose={() => { setOpen(null); load(); }} onChanged={load} />}
    </div>
  );
}

function Row({ row: r, n, draggable, selected, onOpen, run }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id, disabled: !draggable });
  const def = milestoneOf(r.step_type);
  const stop = (e) => e.stopPropagation();
  const put = (body) => run(() => api.put(`/tickets/process/${r.id}`, body));
  return (
    <tr ref={setNodeRef} onClick={onOpen} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`cursor-pointer align-top transition ${isDragging ? 'relative z-10 bg-white shadow-lg' : selected ? 'bg-brand-50/60' : 'hover:bg-slate-50'}`}>
      <td className="py-3 pl-2" onClick={draggable ? stop : undefined}>
        <span className="flex items-center gap-0.5 text-xs text-slate-400 tabular-nums">
          {draggable
            ? <button type="button" {...attributes} {...listeners} aria-label={`Drag ${r.title} into order`} title="Drag into order" className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"><GripVertical size={14} /></button>
            : <span className="w-[18px]" />}
          {n}
        </span>
      </td>
      <td className="px-3 py-3">
        <div className="font-semibold text-slate-900">{r.title}</div>
        <div className="mt-0.5 text-xs text-slate-500">{[r.organization, r.stage, r.director && fullName(r.director), r.territory?.name].filter(Boolean).join(' · ')}</div>
        <LabelList labels={r.labels} className="mt-1.5" />
      </td>
      <td className="px-3 py-3">
        <div className="font-medium text-slate-800">{r.step_type}</div>
        <div className="mt-0.5 text-[11px] text-slate-400">{def.phase}{def.tag ? ` · ${def.tag}` : ''}</div>
        {r.decision && <div className="mt-1 text-[11px] font-semibold text-slate-600">{r.decision}</div>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap" onClick={r.can_edit && !r.completed_at ? stop : undefined}>
        {r.completed_at ? <span className="text-xs text-emerald-700">Done {stamp(r.completed_at)}</span> : <DueCell row={r} onSave={(v) => put({ step_date: v || null })} />}
      </td>
      <td className="px-3 py-3" onClick={r.can_edit ? stop : undefined}>
        {r.can_edit && !r.completed_at ? (
          <select aria-label={`How critical ${r.step_type} for ${r.title} is`} value={r.criticality} onChange={(e) => put({ criticality: e.target.value })}
            className={`max-w-full cursor-pointer rounded-full border-0 py-1 pr-7 pl-2.5 text-xs font-semibold ring-1 ${CRITICALITY.find((c) => c.key === r.criticality)?.tone}`}>
            {CRITICALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        ) : <CriticalityPill value={r.criticality} />}
      </td>
      <td className="px-3 py-3">
        {r.architects.length
          ? <span className="flex flex-wrap gap-1">{r.architects.map((u) => <Avatar key={u.id} user={u} size="xs" />)}</span>
          : <span className="text-xs text-slate-400">None yet</span>}
      </td>
      <td className="px-3 py-3">
        {r.request ? <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-slate-700" title={r.request}>{r.request}</p> : <span className="text-xs text-slate-400">No request written</span>}
      </td>
      <td className="px-3 py-3">
        <ul className="space-y-0.5">
          {def.fields.map(([key, label]) => {
            const text = r.fields[key];
            const docs = r.files.filter((f) => f.field === key).length;
            return (
              <li key={key} className={`flex items-center gap-1.5 text-xs ${text || docs ? 'text-slate-700' : 'text-slate-400'}`} title={text ? text.slice(0, 300) : undefined}>
                {text || docs ? <Check size={11} className="shrink-0 text-emerald-600" /> : <Circle size={9} className="mx-px shrink-0" />}
                <span className="truncate">{label}</span>
                {text && <PenLine size={10} className="shrink-0 text-slate-400" />}
                {docs > 0 && <span className="flex shrink-0 items-center gap-0.5 text-slate-500"><FileText size={10} />{docs}</span>}
              </li>
            );
          })}
        </ul>
      </td>
      <td className="px-3 py-3 text-right" onClick={stop}>
        {r.completed_at
          ? <button type="button" className="btn px-2 py-1 text-xs" onClick={() => put({ done: false })} title="Put it back on the list"><RotateCcw size={12} /> Reopen</button>
          : <button type="button" className="btn px-2 py-1 text-xs" onClick={() => confirm(`Mark ${r.step_type} for “${r.title}” done? It leaves this list.`) && put({ done: true })} title="Mark it done: it leaves this list"><Check size={12} /> Done</button>}
      </td>
    </tr>
  );
}

/** The due date. The ticket's owner (or an admin) clicks it, or "No due date", to set it. */
function DueCell({ row: r, onSave }) {
  const [value, setValue] = useState(null); // null: not editing
  if (!r.can_edit) return <DueDate date={r.due_date} done={false} className="text-sm" />;
  if (value === null) {
    return (
      <button type="button" onClick={() => setValue(r.due_date || '')} title="Click to set the due date"
        className="-mx-1.5 rounded px-1.5 py-0.5 text-left text-sm hover:bg-white hover:ring-1 hover:ring-slate-300">
        <DueDate date={r.due_date} done={false} />
      </button>
    );
  }
  const save = () => { const next = value; setValue(null); if (next !== (r.due_date || '')) onSave(next); };
  return (
    <input autoFocus type="date" className="input -mx-1.5 h-7 w-36 px-1.5 py-0 text-sm" value={value} aria-label={`Due date of ${r.step_type} for ${r.title}`}
      onChange={(e) => setValue(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setValue(null); }} />
  );
}

