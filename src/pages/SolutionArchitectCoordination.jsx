import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check, FileText, PenLine, Circle, RotateCcw, Trash2, Plus } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { fullName, stamp } from '../lib/format.js';
import { LabelList, byTags } from '../components/Labels.jsx';
import { PROCESS_TYPES, CRITICALITY, milestoneOf } from '../lib/process.js';
import { DueDate, CriticalityPill } from './TicketPlanning.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import NoteBox from '../components/NoteBox.jsx';
import PipelineHeader, { AddExistingButton, useOwnerTerritoryFilter } from '../components/PipelineHeader.jsx';

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
 * leads and admins order the master list on All tickets. A click on a row opens that event's blocks of work. Notes are
 * written and edited in the row (each one is a note on the ticket), and the ticket's owner can remove an event outright.
 */
export default function SolutionArchitectCoordination() {
  const { user } = useAuth();
  const [rows, setRows] = useState(null);
  const [canRankMaster, setCanRankMaster] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null); // { ticket_id, id } of the event whose pane is open, or { ticket_id, staff } to staff a ticket
  const [showDone, setShowDone] = useState(false);
  const [architects, setArchitects] = useState([]); // the solution architects who can be staffed
  const take = (d) => { setRows(d.rows); setCanRankMaster(!!d.can_rank_master); setArchitects(d.architects || []); };
  const load = () => api.get(`/sac${showDone ? '?done=1' : ''}`).then(take).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [showDone]); // eslint-disable-line react-hooks/exhaustive-deps
  // A request written in a row is the Request block of that event's form: the list reloads, and a pane open on the same
  // ticket is opened afresh so its form shows what was just written.
  const [formVersion, setFormVersion] = useState(0);
  const requestSaved = (id) => { if (open && rows?.find((x) => x.id === id)?.ticket_id === open.ticket_id) setFormVersion((v) => v + 1); return load(); };
  const run = async (call) => { setError(''); try { await call(); await load(); } catch (e) { setError(e.message); } };

  const [scope, setScopeState] = useState(() => saved('kit.sac.scope', (v) => ['mine', 'all'].includes(v), 'all'));
  const setScope = (v) => { setScopeState(v); keep('kit.sac.scope', v); };
  const filter = useOwnerTerritoryFilter(); // account owners and territories, as on the board
  const [tags, setTags] = useState([]);
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [sort, setSortState] = useState(() => saved('kit.sac.sort', (v) => !!SORTS[v], 'priority'));
  const setSort = (v) => { setSortState(v); keep('kit.sac.sort', v); };

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    return (rows || []).filter((r) => scope === 'all' || r.mine)
      .filter((r) => filter.passes(r.owner?.id, r.territory?.id)).filter(byTags(tags))
      .filter((r) => !type || r.step_type === type)
      .filter((r) => !words || `${r.title} ${r.organization || ''} ${r.step_type} ${r.request}`.toLowerCase().includes(words))
      .sort(SORTS[sort].compare(scope));
  }, [rows, scope, filter.value, tags, type, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <PipelineHeader title="Solution Architect Coordination" subtitle="Every staffed pursuit: RFI responses, white papers, gate reviews, SOO, SOW, ROM and proposals. Click a row to write or respond."
        scope={scope} onScope={setScope}
        add={<AddExistingButton title="Staff a ticket" onPick={(t) => setOpen({ ticket_id: t.id, staff: true })} />}
        search={{ value: q, onChange: setQ }}
        filter={{ options: filter.options, value: filter.value, onChange: filter.setValue }} tags={tags} onTags={setTags}
        sort={{ options: Object.entries(SORTS).map(([k, o]) => [k, o.label]), value: sort, onChange: setSort }}
        extra={<>
          <select className="input h-[38px] w-48 py-0" aria-label="Show one staffing event" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Every staffing event</option>
            {PROCESS_TYPES.map((t) => <option key={t} value={t}>{t} ({milestoneOf(t).tag})</option>)}
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
        </>}>
        <p className="text-xs text-slate-400">
          {showDone ? 'Done staffing events. Reopen one to put it back on the list.'
            : sort !== 'priority' ? 'Sorted by ' + SORTS[sort].label.toLowerCase() + '. Switch to Priority order to drag rows into order.'
            : scope === 'mine' ? 'Your tickets in your own order: drag a row by its handle to set what matters most.'
            : canRankMaster ? 'The master list: as a team lead, drag a row by its handle to set the order everyone sees.'
            : 'The master list, in the order team leads set. Switch to My tickets to order your own.'}
        </p>
      </PipelineHeader>

      <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <table className="w-full min-w-[120rem] table-fixed text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                <tr>
                  <th className="w-12 py-2.5 pl-3">#</th>
                  <th className="w-[16%] px-3 py-2.5">Opportunity</th>
                  <th className="w-44 px-3 py-2.5">Staffing event</th>
                  <th className="w-36 px-3 py-2.5">Due date</th>
                  <th className="w-36 px-3 py-2.5">Category</th>
                  <th className="w-44 px-3 py-2.5">How critical</th>
                  <th className="w-32 px-3 py-2.5">Architects</th>
                  <th className="px-3 py-2.5">Request</th>
                  <th className="w-72 px-3 py-2.5">Notes</th>
                  <th className="w-56 px-3 py-2.5">Work</th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <SortableContext items={shown.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <tbody className="divide-y divide-slate-100">
                  {rows === null && <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>}
                  {rows?.length === 0 && (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">
                      {showDone ? 'Nothing is done yet.' : 'Nothing is staffed yet. Use Staff Ticket in a pipeline ticket, drag a ticket onto a bucket on the board, or give it a process tag.'}
                    </td></tr>
                  )}
                  {rows?.length > 0 && !shown.length && <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-400">No staffing events match.</td></tr>}
                  {shown.map((r, i) => (
                    <Row key={r.id} row={r} n={i + 1} draggable={canDrag && (scope === 'all' || r.mine)} selected={open?.id === r.id} user={user} architects={architects}
                      onOpen={() => setOpen({ ticket_id: r.ticket_id, id: r.id })} run={run} onRequestSaved={requestSaved} />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>
      </div>

      {open && <TicketTimeline key={`${open.ticket_id}-${open.id}-${formVersion}`} ticketId={open.ticket_id} stepId={open.id ?? null} startStaffing={!!open.staff} drawerOnly onClose={() => { setOpen(null); load(); }} onChanged={load} />}
    </div>
  );
}

function Row({ row: r, n, draggable, selected, onOpen, run, architects, onRequestSaved }) {
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
        <div className="mt-0.5 text-xs text-slate-500">{[r.organization, r.owner && fullName(r.owner), r.territory?.name].filter(Boolean).join(' · ')}</div>
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
      <td className="px-3 py-3 text-slate-700" title="The stage the ticket is in now">{r.stage || '—'}</td>
      <td className="px-3 py-3" onClick={r.can_edit ? stop : undefined}>
        {r.can_edit && !r.completed_at ? (
          <select aria-label={`How critical ${r.step_type} for ${r.title} is`} value={r.criticality} onChange={(e) => put({ criticality: e.target.value })}
            className={`max-w-full cursor-pointer rounded-full border-0 py-1 pr-7 pl-2.5 text-xs font-semibold ring-1 ${CRITICALITY.find((c) => c.key === r.criticality)?.tone}`}>
            {CRITICALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        ) : <CriticalityPill value={r.criticality} />}
      </td>
      <td className="px-3 py-3" onClick={r.completed_at ? undefined : stop}>
        {r.completed_at ? <ArchitectList people={r.architects} /> : <ArchitectCell row={r} options={architects} onSave={(ids) => put({ architects: ids })} />}
      </td>
      <td className="px-3 py-3" onClick={r.completed_at ? undefined : stop}>
        {r.completed_at
          ? (r.request ? <p className="line-clamp-3 text-sm break-words whitespace-pre-wrap text-slate-700" title={r.request}>{r.request}</p> : <span className="text-xs text-slate-400">No request written</span>)
          : <RequestCell row={r} onSave={(text) => api.put(`/tickets/process/${r.id}`, { notes: text }).then(() => onRequestSaved(r.id))} />}
      </td>
      <td className="px-3 py-3" onClick={stop}><NotesCell row={r} run={run} /></td>
      <td className="px-3 py-3">
        <ul className="space-y-0.5">
          {def.fields.map(([key, label, hint]) => {
            const text = r.fields[key];
            const docs = r.files.filter((f) => f.field === key).length;
            return (
              <li key={key} className={`flex items-center gap-1.5 text-xs ${text || docs ? 'text-slate-700' : 'text-slate-400'}`} title={text ? text.slice(0, 300) : hint}>
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
        <div className="flex flex-col items-end gap-1.5">
          {r.completed_at
            ? <button type="button" className="btn px-2 py-1 text-xs" onClick={() => put({ done: false })} title="Put it back on the list"><RotateCcw size={12} /> Reopen</button>
            : <button type="button" className="btn px-2 py-1 text-xs" onClick={() => confirm(`Mark ${r.step_type} for “${r.title}” done? It leaves this list.`) && put({ done: true })} title="Mark it done: it leaves this list"><Check size={12} /> Done</button>}
          {r.can_edit && (
            <button type="button" onClick={() => remove(r, run)} title="Remove this staffing event and its tag from the ticket"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 size={12} /> Remove</button>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * Remove: the staffing event goes outright, not into Done. Its work, architects and place in every order go with it and its
 * process tag comes off the ticket; documents and notes stay on the ticket. The ticket's owner or an admin can do it.
 */
const remove = (r, run) => {
  const tag = milestoneOf(r.step_type).tag;
  if (!confirm(`Remove ${r.step_type} from “${r.title}”?\n\nThe staffing event is deleted with its written work and architects, and the ${tag} tag comes off the ticket. Its documents and notes stay on the ticket. This can’t be undone.`)) return;
  run(() => api.del(`/tickets/process/${r.id}`));
};

/**
 * The event's request: what's needed from the solution architect. A click on it (or on "Add a request") opens it to write
 * here; ⌘/Ctrl+Enter or Save keeps it, Escape (or Cancel) drops the change. It's the Request block of the event's form, so
 * what's written here is what the form shows, and the other way round. Anyone can write it, as in the form.
 */
function RequestCell({ row: r, onSave }) {
  const [text, setText] = useState(null); // null: not editing
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (text !== null && document.activeElement !== ref.current) { const el = ref.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } }, [text === null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (text === null) {
    return r.request
      ? <button type="button" onClick={() => setText(r.request)} title="Click to edit the request"
          className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded px-1.5 py-0.5 text-left text-sm break-words whitespace-pre-wrap text-slate-700 hover:bg-white hover:ring-1 hover:ring-slate-300">
          <span className="line-clamp-3">{r.request}</span>
        </button>
      : <button type="button" onClick={() => setText('')} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Plus size={12} /> Add a request</button>;
  }
  const changed = text.trim() !== r.request.trim();
  const save = async () => {
    if (busy) return;
    if (!changed) return setText(null);
    setBusy(true);
    setError('');
    try { await onSave(text.trim()); setText(null); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const cancel = () => { if (!changed || confirm('Discard your changes to the request?')) setText(null); };
  return (
    <div className="rounded-lg border border-brand-500 bg-white ring-2 ring-brand-100">
      <textarea ref={ref} rows={4} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label={`Request for ${r.step_type} on ${r.title}`}
        placeholder="What's needed from the solution architect: the ask, the customer's deadline, open questions…"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        }}
        className="block w-full resize-y rounded-t-lg border-0 bg-transparent px-2.5 py-1.5 text-sm focus:ring-0 focus:outline-none" />
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 py-1">
        {error && <span className="mr-auto text-[11px] text-red-700">{error}</span>}
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={cancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary px-2 py-0.5 text-xs" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}

const noteBy = (n) => [n.author && fullName(n.author), stamp(n.created_at), n.updated_at && 'edited'].filter(Boolean).join(' · ');

/**
 * The event's notes, newest first, written right here: Add note (or a click on "No notes yet") opens a box, and sending it adds
 * a note to the ticket about this event. A click on a note you wrote edits it. The latest shows; the rest open below it.
 */
function NotesCell({ row: r, run }) {
  const [editing, setEditing] = useState(null); // null, 'new', or the id of the note being edited
  const [all, setAll] = useState(false);
  const shown = all ? r.notes : r.notes.slice(0, 1);
  // A note that doesn't save stays in its box with the reason; one that does closes it and the list reloads.
  const send = (call) => call().then(() => { setEditing(null); run(async () => {}); });
  const add = (body) => send(() => api.post(`/tickets/${r.ticket_id}/comments`, { kind: 'note', body, process_step_id: r.id }));
  const edit = (id, body) => send(() => api.put(`/tickets/comments/${id}`, { body }));
  return (
    <div className="space-y-2">
      {editing === 'new' && <NoteBox onSave={add} onCancel={() => setEditing(null)} label={`New note on ${r.step_type} for ${r.title}`} />}
      {shown.map((n) => (editing === n.id
        ? <NoteBox key={n.id} initial={n.body} onSave={(body) => edit(n.id, body)} onCancel={() => setEditing(null)} label="Edit your note" />
        : (
          <div key={n.id} className="space-y-0.5">
            {n.mine
              ? <button type="button" onClick={() => setEditing(n.id)} title="Click to edit your note"
                  className="-mx-1.5 block w-[calc(100%+0.75rem)] rounded px-1.5 py-0.5 text-left text-sm break-words whitespace-pre-wrap text-slate-700 hover:bg-white hover:ring-1 hover:ring-slate-300">
                  <span className="line-clamp-4"><MentionText text={n.body} /></span>
                </button>
              : <div className="line-clamp-4 text-sm break-words whitespace-pre-wrap text-slate-700" title={n.body}><MentionText text={n.body} /></div>}
            <div className="text-[11px] text-slate-400">{noteBy(n)}</div>
          </div>
        )))}
      <div className="flex items-center gap-3 text-xs">
        {editing !== 'new' && (
          <button type="button" onClick={() => setEditing('new')} className="flex items-center gap-1 font-medium text-brand-700 hover:underline">
            <Plus size={12} /> {r.notes.length ? 'Add note' : 'Add a note'}
          </button>
        )}
        {r.notes.length > 1 && (
          <button type="button" onClick={() => setAll(!all)} className="text-slate-500 hover:text-slate-800 hover:underline">
            {all ? 'Show latest only' : `${r.notes.length - 1} earlier`}
          </button>
        )}
      </div>
    </div>
  );
}

const ArchitectList = ({ people }) => (people.length
  ? <span className="flex flex-wrap gap-1">{people.map((u) => <Avatar key={u.id} user={u} size="xs" />)}</span>
  : <span className="text-xs text-slate-400">None yet</span>);

/**
 * Who's staffed to the event. A click on the architects (or "None yet") opens the solution architects in that spot, to tick
 * any number of; it saves as it closes. Someone staffed who isn't a solution architect stays listed, so they can be taken off.
 */
function ArchitectCell({ row: r, options, onSave }) {
  const [picked, setPicked] = useState(null); // null: closed
  const [at, setAt] = useState(null);
  const button = useRef(null);
  const menu = useRef(null);
  const current = r.architects.map((u) => u.id);
  const close = () => {
    if (picked === null) return;
    const next = picked;
    setPicked(null);
    if (next.length !== current.length || next.some((id) => !current.includes(id))) onSave(next);
  };
  // The table scrolls, so the list is placed on the page where the cell is. It closes (and saves) on a click elsewhere, or
  // if the page moves under it.
  useEffect(() => {
    if (picked === null) return undefined;
    const outside = (e) => { if (!menu.current?.contains(e.target) && !button.current?.contains(e.target)) close(); };
    window.addEventListener('mousedown', outside);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('mousedown', outside); window.removeEventListener('scroll', outside, true); window.removeEventListener('resize', close); };
  });
  const open = () => {
    const box = button.current.getBoundingClientRect();
    setAt({ left: Math.min(box.left, window.innerWidth - 336), top: box.bottom + 4, maxHeight: Math.max(160, window.innerHeight - box.bottom - 16) });
    setPicked(current);
  };
  const people = [...options, ...r.architects.filter((u) => !options.some((o) => o.id === u.id))];
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <>
      <button ref={button} type="button" onClick={() => (picked === null ? open() : close())} aria-haspopup="listbox" aria-expanded={picked !== null}
        aria-label={`Solution architects on ${r.step_type} for ${r.title}`} title="Click to choose the solution architects"
        className="-mx-1.5 rounded px-1.5 py-0.5 text-left hover:bg-white hover:ring-1 hover:ring-slate-300">
        <ArchitectList people={r.architects} />
      </button>
      {picked !== null && createPortal(
        <div ref={menu} role="listbox" aria-multiselectable="true" style={at} onKeyDown={(e) => e.key === 'Escape' && setPicked(null)}
          className="fixed z-50 w-80 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Solution architects</div>
          {people.length === 0 && <div className="px-3 py-2 text-sm text-slate-400">No one is on the Technical Solutioning team yet.</div>}
          {people.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
              <Avatar user={u} size="xs" />
              <span className="min-w-0 flex-1 truncate text-slate-800">{fullName(u)}</span>
              {u.title && <span className="shrink-0 text-[11px] text-slate-400">{u.title}</span>}
            </label>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-slate-100 px-3 pt-1.5 pb-1">
            <button type="button" className="text-xs text-slate-500 hover:text-slate-800 hover:underline" onClick={() => setPicked([])}>None</button>
            <button type="button" className="btn px-2 py-0.5 text-xs" onClick={close}>Done</button>
          </div>
        </div>, document.body)}
    </>
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

