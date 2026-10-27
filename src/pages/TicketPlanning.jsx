import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Loader2, Check, SquareCheck, ChessPawn, Scale, ContactRound, ArrowLeft, Search, Link2, Unlink, Footprints, GripVertical, Flag, Pencil, ArrowUp, ArrowDown } from 'lucide-react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { api } from '../lib/api.js';
import { stamp, fullStamp, fullName, shortDate } from '../lib/format.js';
import { ContactForm, ContactDetail, RelationshipBadge, contactName, contactLine } from './ContactEditor.jsx';
import { CRITERIA, SCORE_LABELS, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin, weightShares } from '../lib/assessment.js';

/** The menu items along the ticket pane's left edge. Strategy and the win assessment are for bid tickets only. */
export const PLAN_TOOLS = [
  { key: 'strategy', label: 'Strategy', icon: ChessPawn, bidOnly: true },
  { key: 'steps', label: 'Next steps', icon: Footprints, bidOnly: true },
  { key: 'tasks', label: 'Tasks', icon: SquareCheck },
  { key: 'assessment', label: 'Bid and win assessment', icon: Scale, bidOnly: true },
  { key: 'people', label: 'People', icon: ContactRound },
];

export function PlanRail({ ticket, active, onSelect }) {
  return PLAN_TOOLS.filter((t) => !t.bidOnly || ticket.ticket_type !== 'work').map(({ key, label, icon: Icon }) => (
    <button key={key} type="button" onClick={() => onSelect(active === key ? null : key)} title={label} aria-label={label} aria-pressed={active === key}
      className={`grid h-9 w-9 place-items-center rounded-md transition ${active === key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'}`}>
      <Icon size={18} />
    </button>
  ));
}

/** The extra pane for whichever menu item is open. `onChanged` refreshes the timeline after a save. */
export function PlanDrawer({ tool, ticket, onClose, onChanged, onDirty }) {
  if (tool === 'tasks') return <TasksDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
  if (tool === 'people') return <PeopleDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
  if (tool === 'steps') return <StepsDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'strategy') return <StrategyDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'assessment') return <AssessmentDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  return null;
}

function DrawerShell({ title, subtitle, onClose, footer, children }) {
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
        </div>
        <button className="btn-ghost p-1.5" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer && <footer className="border-t border-slate-200 bg-white px-5 py-3">{footer}</footer>}
    </>
  );
}

// ---- Tasks

/** Every to-do on the ticket: its own general tasks (which anyone can add) and each priority's checklist. */
function TasksDrawer({ ticket, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/tickets/${ticket.id}/tasks`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await api.post(`/tickets/${ticket.id}/tasks`, { text });
      setText('');
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const toggleGeneral = async (k) => {
    setData((d) => ({ ...d, general: d.general.map((x) => (x.id === k.id ? { ...x, done: !x.done } : x)) }));
    await api.put(`/tickets/tasks/${k.id}`, { done: !k.done });
    load();
    onChanged();
  };
  const removeGeneral = async (k) => {
    if (!confirm(`Delete the task “${k.text}”?`)) return;
    await api.del(`/tickets/tasks/${k.id}`);
    load();
    onChanged();
  };
  const toggleCard = async (card, index, done) => {
    await api.put(`/priorities/cards/${card.id}/checklist/${index}`, { done });
    load();
    onChanged();
  };

  const all = data ? [...data.general, ...data.cards.flatMap((c) => c.checklist)] : [];
  const open = all.filter((t) => !t.done).length;

  return (
    <DrawerShell title="Tasks" subtitle={data ? `${open} to do · ${all.length - open} done across this ticket` : 'Loading…'} onClose={onClose}>
      <div className="space-y-5">
        <section>
          <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">General tasks</h4>
          <p className="mb-2 text-[11px] text-slate-400">For this ticket as a whole, not tied to a priority or comment.</p>
          <div className="flex gap-2">
            <input className="input" placeholder="Add a task…" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} disabled={busy} />
            <button type="button" className="btn-primary px-2.5" onClick={add} disabled={!text.trim() || busy} aria-label="Add task"><Plus size={16} /></button>
          </div>
          {data && (
            <TaskGroup items={data.general.map((k) => ({ key: `g${k.id}`, text: k.text, done: k.done, onToggle: () => toggleGeneral(k), onDelete: () => removeGeneral(k) }))}
              empty="No general tasks yet." />
          )}
        </section>

        {data?.cards.map((c) => (
          <section key={c.id}>
            <h4 className="text-xs font-semibold text-slate-700">{c.title || 'Untitled priority'}</h4>
            <p className="mb-1 text-[11px] text-slate-400">{c.is_planned ? 'Priority' : 'Work'} · week of {shortDate(c.week_start)}{c.completed ? ' · complete' : ''}</p>
            <TaskGroup items={c.checklist.map((t, i) => ({ key: `c${c.id}-${i}`, text: t.text, done: t.done, onToggle: () => toggleCard(c, i, !t.done) }))} />
          </section>
        ))}
        {data && !data.cards.length && <p className="text-xs text-slate-400">No priorities on this ticket have checklist items.</p>}
      </div>
    </DrawerShell>
  );
}

/** A list split into to-do and done; finished items sit at the bottom. */
function TaskGroup({ items, empty }) {
  if (!items.length) return empty ? <p className="mt-2 text-xs text-slate-400">{empty}</p> : null;
  const sorted = [...items.filter((i) => !i.done), ...items.filter((i) => i.done)];
  return (
    <ul className="mt-2 space-y-0.5">
      {sorted.map((i) => (
        <li key={i.key} className="group flex items-start gap-2 rounded px-1 py-0.5 hover:bg-white">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={!!i.done} onChange={i.onToggle} />
          <span className={`flex-1 text-sm ${i.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{i.text}</span>
          {i.onDelete && (
            <button type="button" onClick={i.onDelete} aria-label="Delete task" className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={14} /></button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---- People (CRM)

/**
 * The people involved in this ticket. Anyone added here also goes into the master CRM; people already in the
 * CRM can be linked instead. Selecting someone opens their details and interaction log.
 */
function PeopleDrawer({ ticket, onClose, onChanged }) {
  const [view, setView] = useState('list'); // list | new | link | <contact id>
  const [people, setPeople] = useState(null);
  const load = () => api.get(`/contacts/ticket/${ticket.id}`).then((d) => setPeople(d.contacts));
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { setView('list'); load(); };
  const unlink = async (c) => {
    if (!confirm(`Take ${contactName(c)} off this ticket? They stay in the CRM.`)) return;
    await api.del(`/contacts/${c.id}/tickets/${ticket.id}`);
    load();
    onChanged();
  };

  const header = view !== 'list' && (
    <button type="button" onClick={back} className="mb-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><ArrowLeft size={13} /> Back to people</button>
  );
  const selected = typeof view === 'number' ? people?.find((p) => p.id === view) : null;

  return (
    <DrawerShell title={selected ? contactName(selected) : view === 'new' ? 'Add a person' : view === 'link' ? 'Add from the CRM' : 'People'}
      subtitle={selected ? contactLine(selected) || 'In the CRM' : 'Everyone added here also goes into the CRM'} onClose={onClose}>
      {header}
      {view === 'list' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <button type="button" className="btn-primary flex-1 text-xs" onClick={() => setView('new')}><Plus size={14} /> Add a person</button>
            <button type="button" className="btn flex-1 text-xs" onClick={() => setView('link')}><Link2 size={14} /> Add from the CRM</button>
          </div>
          {people && !people.length && <p className="text-sm text-slate-400">No one on this ticket yet.</p>}
          <ul className="space-y-2">
            {people?.map((c) => (
              <li key={c.id} className="group flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5 hover:border-brand-500">
                <button type="button" onClick={() => setView(c.id)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-800">{contactName(c)}</span>
                    <RelationshipBadge level={c.relationship} short />
                  </div>
                  {contactLine(c) && <div className="truncate text-xs text-slate-500">{contactLine(c)}</div>}
                  <div className="text-[11px] text-slate-400">{c.interaction_count} interaction{c.interaction_count === 1 ? '' : 's'}{c.last_interaction_at ? ` · last ${stamp(c.last_interaction_at)}` : ''}</div>
                </button>
                <button type="button" onClick={() => unlink(c)} title="Take off this ticket" aria-label="Take off this ticket"
                  className="rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600"><Unlink size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {view === 'new' && (
        <ContactForm submitLabel="Add person" onCancel={back}
          onSubmit={async (form) => { const r = await api.post('/contacts', { ...form, ticket_id: ticket.id }); onChanged(); await load(); setView(r.contact.id); }} />
      )}
      {view === 'link' && <LinkFromCrm ticket={ticket} linked={people || []} onLinked={async (id) => { onChanged(); await load(); setView(id); }} />}
      {typeof view === 'number' && <ContactDetail contactId={view} onChanged={() => load()} onDeleted={back} />}
    </DrawerShell>
  );
}

/** Search the CRM for someone not yet on this ticket, and add them. */
function LinkFromCrm({ ticket, linked, onLinked }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  useEffect(() => {
    const h = setTimeout(() => api.get(`/contacts?q=${encodeURIComponent(q)}`).then((d) => setResults(d.contacts)), q ? 200 : 0);
    return () => clearTimeout(h);
  }, [q]);
  const add = async (c) => { await api.put(`/contacts/${c.id}/tickets/${ticket.id}`); onLinked(c.id); };
  const shown = (results || []).filter((c) => !linked.some((l) => l.id === c.id));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
        <input autoFocus className="input pl-8" placeholder="Search by name, organization, or role…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => add(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{contactName(c)}</div>
                {contactLine(c) && <div className="truncate text-xs text-slate-500">{contactLine(c)}</div>}
              </div>
              <RelationshipBadge level={c.relationship} short />
            </button>
          </li>
        ))}
        {results && !shown.length && <li className="px-3 py-3 text-sm text-slate-400">{q ? 'No one matches.' : 'Everyone in the CRM is already on this ticket.'}</li>}
      </ul>
    </div>
  );
}

// ---- Next steps

/**
 * The broad-stroke next major steps in pursuing the account. New steps go on top; steps can be checked off,
 * dragged into a new order, and one can be flagged as the next step (it becomes the win assessment's next milestone).
 */
function StepsDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [steps, setSteps] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/tickets/${ticket.id}/steps`).then((d) => setSteps(d.steps)); }, [ticket.id]);
  useEffect(() => { onDirty?.(!!text.trim()); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (p) => p.then((d) => { setSteps(d.steps); onChanged(); }).catch((e) => setError(e.message));
  const add = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    await apply(api.post(`/tickets/${ticket.id}/steps`, { text }));
    setText('');
    setBusy(false);
  };
  const update = (s, body) => apply(api.put(`/tickets/steps/${s.id}`, body));
  const remove = (s) => confirm('Delete this step?') && apply(api.del(`/tickets/steps/${s.id}`));
  const reorder = (ids) => {
    setSteps((xs) => ids.map((id) => xs.find((x) => x.id === id)));
    apply(api.put(`/tickets/${ticket.id}/steps/order`, { ids }));
  };
  const move = (from, to) => steps && to >= 0 && to < steps.length && reorder(arrayMove(steps.map((s) => s.id), from, to));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = steps.map((s) => s.id);
    reorder(arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id)));
  };

  const next = steps?.find((s) => s.is_next);

  return (
    <DrawerShell title="Next steps" subtitle="The big moves in pursuing this account" onClose={onClose}>
      <div className="space-y-4">
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-xs font-semibold tracking-wide text-slate-600 uppercase" htmlFor="new-step">New step</label>
          <textarea id="new-step" rows={2} className="input resize-none text-sm" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder="e.g. Brief the PEO on our transition approach before the draft RFP"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
              if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); }
            }} />
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || 'New steps go on top · ⌘↵ to add'}</span>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={add} disabled={!text.trim() || busy}>{busy ? 'Adding…' : 'Add step'}</button>
          </div>
        </section>

        {next && (
          <p className="flex items-start gap-1.5 rounded-md bg-brand-50 px-3 py-2 text-[11px] text-brand-800">
            <Flag size={12} className="mt-0.5 shrink-0" />
            <span>“{next.text}” is the next step. It’s filled in as the Next milestone under Bid and win assessment › Pursuit momentum.</span>
          </p>
        )}

        {steps && !steps.length && <p className="text-sm text-slate-400">No steps yet. Add the first major step above.</p>}
        {steps && steps.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-2">
                {steps.map((s, i) => (
                  <StepItem key={s.id} step={s} first={i === 0} last={i === steps.length - 1}
                    onMoveUp={() => move(i, i - 1)} onMoveDown={() => move(i, i + 1)}
                    onToggle={() => update(s, { done: !s.done })} onNext={() => update(s, { next: !s.is_next })}
                    onSave={(t) => update(s, { text: t })} onDelete={() => remove(s)} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </DrawerShell>
  );
}

function StepItem({ step: s, first, last, onMoveUp, onMoveDown, onToggle, onNext, onSave, onDelete }) {
  const { user } = useAuth();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.text);
  const mine = s.author?.id === user.id;
  const canDelete = mine || user.role === 'admin';
  const save = async () => { if (draft.trim() && draft.trim() !== s.text) await onSave(draft.trim()); setEditing(false); };

  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex gap-2 rounded-lg border bg-white p-2.5 transition ${isDragging ? 'z-10 shadow-lg' : ''} ${
        s.is_next ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to reorder" title="Drag to reorder"
          className="cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-600 active:cursor-grabbing"><GripVertical size={14} /></button>
        <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={s.done} onChange={onToggle} aria-label={s.done ? 'Mark not done' : 'Mark done'} title={s.done ? 'Mark not done' : 'Mark done'} />
      </div>
      <div className="min-w-0 flex-1">
        {s.is_next && <span className="mb-1 inline-flex items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase"><Flag size={10} /> Next step</span>}
        {editing ? (
          <div>
            <textarea autoFocus rows={2} className="input resize-none text-sm" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
                if (e.key === 'Escape') { e.stopPropagation(); setDraft(s.text); setEditing(false); }
              }} />
            <div className="mt-1 flex justify-end gap-1.5">
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { setDraft(s.text); setEditing(false); }}>Cancel</button>
              <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={save} disabled={!draft.trim()}>Save</button>
            </div>
          </div>
        ) : (
          <p className={`text-sm break-words whitespace-pre-wrap ${s.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{s.text}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pr-1 text-[11px] text-slate-400">
          <Avatar user={s.author} size="xs" />
          <span className="whitespace-nowrap">{fullName(s.author) || 'Someone'}</span>
          <span className="whitespace-nowrap" title={fullStamp(s.created_at)}>· {stamp(s.created_at)}</span>
          {s.updated_at && <span title={fullStamp(s.updated_at)}>· edited</span>}
          {s.done && s.done_at && <span className="whitespace-nowrap" title={fullStamp(s.done_at)}>· done {stamp(s.done_at)}</span>}
        </div>
      </div>
      {!editing && (
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 rounded-md bg-white opacity-0 shadow-sm ring-1 ring-slate-200 transition group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label={s.is_next ? 'Unmark as next step' : 'Make this the next step'} onClick={onNext} active={s.is_next}><Flag size={13} /></IconButton>
          {!first && <IconButton label="Move up" onClick={onMoveUp}><ArrowUp size={13} /></IconButton>}
          {!last && <IconButton label="Move down" onClick={onMoveDown}><ArrowDown size={13} /></IconButton>}
          {mine && <IconButton label="Edit" onClick={() => setEditing(true)}><Pencil size={13} /></IconButton>}
          {canDelete && <IconButton label="Delete" onClick={onDelete} danger><Trash2 size={13} /></IconButton>}
        </div>
      )}
    </li>
  );
}

function IconButton({ label, onClick, active, danger, children }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={`rounded p-1 ${active ? 'text-brand-700' : 'text-slate-500'} ${danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-100 hover:text-brand-700'}`}>
      {children}
    </button>
  );
}

// ---- Strategy and assessment share loading and saving. The ticket pane asks before discarding unsaved changes.

function usePlan(ticketId) {
  const [plan, setPlan] = useState(null);
  useEffect(() => { api.get(`/tickets/${ticketId}/plan`).then(setPlan); }, [ticketId]);
  return [plan, setPlan];
}

function SaveBar({ dirty, busy, savedAt, savedBy, error, onSave }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[11px] ${error ? 'text-red-600' : dirty ? 'text-amber-700' : 'text-slate-400'}`}>
        {error || (dirty ? 'Unsaved changes' : savedAt ? <><Check size={11} className="mr-0.5 inline" />Saved {stamp(savedAt)}{savedBy ? ` by ${savedBy}` : ''}</> : 'Not saved yet')}
      </span>
      <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={onSave} disabled={!dirty || busy}>
        {busy ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save'}
      </button>
    </div>
  );
}

// ---- Strategy

function StrategyDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [plan, setPlan] = usePlan(ticket.id);
  const [text, setText] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const value = text ?? plan?.strategy ?? '';
  const dirty = text !== null && text !== (plan?.strategy ?? '');
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.put(`/tickets/${ticket.id}/strategy`, { strategy: value });
      setPlan((p) => ({ ...p, strategy: value, strategy_updated_at: r.strategy_updated_at, strategy_updated_by: r.strategy_updated_by }));
      setText(null);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DrawerShell title="Strategy" subtitle="How we win this account" onClose={onClose}
      footer={plan && <SaveBar dirty={dirty} busy={busy} error={error} savedAt={plan.strategy_updated_at} savedBy={plan.strategy_updated_by} onSave={save} />}>
      {plan ? (
        <textarea className="input h-full min-h-[60vh] resize-none text-sm leading-relaxed" value={value} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), dirty && save())}
          placeholder={'Win themes, customer hot buttons, discriminators, teaming approach, price-to-win, and the actions that get us there…'} />
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

// ---- Win assessment

function AssessmentDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [plan, setPlan] = usePlan(ticket.id);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saved = useRef(null);
  const [nextStep, setNextStep] = useState(null);
  const [weights, setWeights] = useState(DEFAULT_PWIN_WEIGHTS);
  const [gates, setGates] = useState(DEFAULT_PWIN_GATES);
  useEffect(() => { api.get('/tickets/pwin-weights').then((d) => { setWeights(d.weights); setGates(d.gates); }); }, []);
  useEffect(() => {
    if (plan && draft === null) { setDraft(plan.assessment || {}); saved.current = JSON.stringify(plan.assessment || {}); }
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get(`/tickets/${ticket.id}/steps`).then((d) => setNextStep(d.steps.find((s) => s.is_next) || null)); }, [ticket.id]);

  const dirty = draft !== null && JSON.stringify(draft) !== saved.current;
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const setScore = (c, score) => setDraft((d) => ({ ...d, [c]: { ...d[c], answers: d[c]?.answers || {}, score: d[c]?.score === score ? null : score } }));
  const setAnswer = (c, p, v) => setDraft((d) => ({ ...d, [c]: { score: d[c]?.score ?? null, answers: { ...(d[c]?.answers || {}), [p]: v } } }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.put(`/tickets/${ticket.id}/assessment`, { assessment: draft });
      saved.current = JSON.stringify(draft);
      setPlan((p) => ({ ...p, assessment: draft, assessment_updated_at: r.assessment_updated_at, assessment_updated_by: r.assessment_updated_by }));
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // PWIN updates as scores change, before saving.
  const score = pwin(draft || {}, weights, gates);
  const shares = weightShares(weights);
  const rated = CRITERIA.filter((c) => draft?.[c.key]?.score).length;

  return (
    <DrawerShell title="Bid and win assessment" subtitle="Do we have a real shot at winning?" onClose={onClose}
      footer={plan && <SaveBar dirty={dirty} busy={busy} error={error} savedAt={plan.assessment_updated_at} savedBy={plan.assessment_updated_by} onSave={save} />}>
      {!draft ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-4">
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">PWIN</span>
              <span className="text-xs text-slate-500">{rated} of {CRITERIA.length} rated</span>
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="text-3xl font-bold text-slate-900 tabular-nums">{score ? `${score.score}%` : '—'}</span>
              <div className="h-2 flex-1 rounded-full bg-slate-100">
                {score && <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${score.score}%` }} />}
              </div>
            </div>
            {score?.penalties.length > 0 && (
              <div className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-[11px] leading-snug text-red-800">
                <p className="font-semibold">Held back from {score.base}% by areas below 3:</p>
                <ul className="mt-0.5 space-y-0.5">
                  {score.penalties.map((x) => (
                    <li key={x.key} className="flex justify-between gap-2">
                      <span>{x.title} · {x.rated ? `rated ${x.rating}` : 'not rated yet'}{x.mustHave ? ' · must-have' : ''}</span>
                      <span className="shrink-0 font-semibold tabular-nums">×{x.factor.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              A weighted probability of win. Rate each area 1–5: <b>1</b> no information or evidence · <b>3</b> some information and evidence ·{' '}
              <b>5</b> strong or full information and evidence. Ratings below 5 cost more the further they fall, and any area below 3 cuts the
              whole score (a must-have cuts it hard). Areas not yet rated count as 1. Weights and must-haves are set in BD Pipeline › Settings.
            </p>
          </section>

          {CRITERIA.map((c, n) => {
            const entry = draft[c.key] || {};
            return (
              <section key={c.key} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-slate-800">
                      {n + 1}. {c.title}
                      <span className="ml-1.5 rounded bg-slate-100 px-1 py-0.5 align-middle text-[10px] font-medium whitespace-nowrap text-slate-500" title="Share of the PWIN score">
                        {Math.round(shares[c.key])}%
                      </span>
                      {gates.includes(c.key) && (
                        <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 align-middle text-[10px] font-semibold whitespace-nowrap text-amber-800" title="Rated below 3, this area cuts PWIN hard, whatever its weight">
                          Must-have
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] leading-snug text-slate-500">{c.blurb}</p>
                  </div>
                  <ScorePicker value={entry.score} onChange={(s) => setScore(c.key, s)} />
                </div>
                <div className="mt-3 space-y-2.5">
                  {c.prompts.map((p) => (
                    <div key={p.key}>
                      <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`a-${c.key}-${p.key}`}>{p.label}</label>
                      {c.key === 'momentum' && p.key === 'milestone' && nextStep && (
                        <p className="mb-1 flex items-center gap-1 text-[10px] text-brand-700"><Flag size={10} /> Filled in from the flagged step in Next steps</p>
                      )}
                      {p.options ? (
                        <select id={`a-${c.key}-${p.key}`} className="input py-1.5 text-sm" value={entry.answers?.[p.key] || ''} onChange={(e) => setAnswer(c.key, p.key, e.target.value)}>
                          <option value="">—</option>
                          {p.options.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : p.type === 'date' ? (
                        <input id={`a-${c.key}-${p.key}`} type="date" className="input py-1.5 text-sm" value={entry.answers?.[p.key] || ''} onChange={(e) => setAnswer(c.key, p.key, e.target.value)} />
                      ) : (
                        <textarea id={`a-${c.key}-${p.key}`} rows={2} className="input resize-y py-1.5 text-sm" placeholder={p.placeholder}
                          value={entry.answers?.[p.key] || ''} onChange={(e) => setAnswer(c.key, p.key, e.target.value)} />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </DrawerShell>
  );
}

/** Five buttons, 1–5. Clicking the selected score clears it. */
function ScorePicker({ value, onChange }) {
  return (
    <div className="flex shrink-0 gap-1" role="radiogroup" aria-label="Score">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)} title={`${s} — ${SCORE_LABELS[s]}`}
          className={`grid h-7 w-7 place-items-center rounded-md text-xs font-semibold tabular-nums transition ${
            value === s ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700'}`}>
          {s}
        </button>
      ))}
    </div>
  );
}
