import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Loader2, ArrowLeft, Phone, Users, SquareCheck, Clock, Mail, Utensils, Flag, Video, MapPin, ExternalLink, GripVertical, ListChecks, MessageSquare, CalendarRange, Star, Check, Hourglass } from 'lucide-react';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate, stamp, fullStamp } from '../lib/format.js';
import MultiSelect from '../components/MultiSelect.jsx';
import MentionTextarea from '../components/MentionTextarea.jsx';
import Avatar from '../components/Avatar.jsx';
import { contactName } from './ContactEditor.jsx';
import { DrawerShell } from './TicketPlanning.jsx';

// Pipedrive's activity types, each with its icon.
export const TYPE_ICONS = { Call: Phone, Meeting: Users, Task: SquareCheck, Deadline: Clock, Email: Mail, Lunch: Utensils };
const PRIORITY_STYLE = { High: 'bg-red-50 text-red-700 ring-red-200', Medium: 'bg-amber-50 text-amber-800 ring-amber-200', Low: 'bg-slate-100 text-slate-600 ring-slate-200' };
const DURATIONS = [['', 'No duration'], ['00:15', '15 min'], ['00:30', '30 min'], ['00:45', '45 min'], ['01:00', '1 hour'], ['01:30', '1½ hours'], ['02:00', '2 hours'], ['03:00', '3 hours'], ['04:00', '4 hours'], ['08:00', 'All day']];
const today = () => new Date().toLocaleDateString('en-CA');

const blank = (ticket) => ({
  subject: '', activity_type: 'Meeting', due_date: today(), due_time: '', duration: '01:00', priority: '', flagged: false, waiting_client: false,
  assignee_id: '', ticket_id: ticket.id, location: '', video_call: '', participants: [], organization: ticket.organization || '',
  phone: '', email: '', goals: '', description: '', note: '', done: false,
});
const formOf = (a) => ({
  subject: a.subject, activity_type: a.activity_type, due_date: a.due_date || '', due_time: a.due_time || '', duration: a.duration || '',
  priority: a.priority || '', flagged: a.flagged, waiting_client: a.waiting_client, assignee_id: a.assignee_id || '', ticket_id: a.ticket_id, location: a.location || '',
  video_call: a.video_call || '', participants: a.participants.map((p) => p.id), organization: a.organization || '', phone: a.phone || '',
  email: a.email || '', goals: a.goals || '', description: a.description || '', note: a.note || '', done: a.done,
});

/** "Tue, Nov 3 · 10:00 AM · 1 hour", for the list. */
export function when(a) {
  const time = a.due_time && new Date(`2000-01-01T${a.due_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dur = DURATIONS.find(([v]) => v && v === a.duration)?.[1] || (a.duration ? a.duration : null);
  return [a.due_date && shortDate(a.due_date, { weekday: 'short', month: 'short', day: 'numeric' }), time, dur].filter(Boolean).join(' · ');
}
const overdue = (a) => !a.done && a.due_date && a.due_date < today();

/**
 * The Activity section on a ticket: calls, meetings, lunches and so on, as in Pipedrive. Open activities are the
 * ticket's priorities, in order: drag them to reorder, and the top one is the ticket's next step. Each is a primary task
 * with its subtasks under it, to check off and add to right here; select one to open all its details and comments.
 */
export function ActivitiesDrawer({ ticket, onClose, onChanged, onDirty, initialId }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState(initialId || 'list'); // list | new | <activity id>
  const load = () => api.get(`/activities?ticket=${ticket.id}`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = () => { load(); onChanged(); };
  const toggle = async (a) => {
    setData((d) => ({ ...d, activities: d.activities.map((x) => (x.id === a.id ? { ...x, done: !x.done } : x)) }));
    await api.put(`/activities/${a.id}`, { done: !a.done });
    changed();
  };
  const back = () => { onDirty?.(false); setView('list'); load(); };

  const open = data?.activities.filter((a) => !a.done) || [];
  const done = data?.activities.filter((a) => a.done) || [];
  const reorder = async (ids) => {
    setData((d) => ({ ...d, activities: [...ids.map((id) => d.activities.find((a) => a.id === id)), ...d.activities.filter((a) => a.done)] }));
    await api.put('/activities/order', { ticket_id: ticket.id, ids });
    changed();
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = open.map((a) => a.id);
    reorder(arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id)));
  };

  if (view !== 'list' && data) {
    return (
      <ActivityForm key={view} ticket={ticket} activityId={view === 'new' ? null : view} types={data.types} priorities={data.priorities} onClose={onClose}
        onBack={back} onSaved={() => { back(); onChanged(); }} onChanged={changed} onDirty={onDirty} />
    );
  }

  return (
    <DrawerShell title="Activity" subtitle={data ? `${open.length} to do · ${done.length} done` : 'Loading…'} onClose={onClose}>
      <div className="space-y-4">
        <button type="button" className="btn-primary w-full justify-center" onClick={() => setView('new')}><Plus size={15} /> Add activity</button>
        {data && !data.activities.length && <p className="text-center text-sm text-slate-400">No activities yet. Schedule a call, meeting or lunch.</p>}
        {open.length > 0 && (
          <section>
            <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">To do, in priority order</h4>
            <p className="mb-1.5 text-[11px] text-slate-400">Drag to reorder. The top one is this {ticket.ticket_type === 'account' ? 'account' : 'ticket'}’s next step.</p>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={open.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                <ol className="space-y-1.5">
                  {open.map((a) => <ActivityRow key={a.id} a={a} sortable ticketId={ticket.id} onToggle={() => toggle(a)} onOpen={() => setView(a.id)} onChanged={changed} />)}
                </ol>
              </SortableContext>
            </DndContext>
          </section>
        )}
        {done.length > 0 && (
          <section>
            <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Done</h4>
            <ul className="space-y-1.5">
              {done.map((a) => <ActivityRow key={a.id} a={a} ticketId={ticket.id} onToggle={() => toggle(a)} onOpen={() => setView(a.id)} onChanged={changed} />)}
            </ul>
          </section>
        )}
      </div>
    </DrawerShell>
  );
}

function ActivityRow({ a, ticketId, sortable, onToggle, onOpen, onChanged }) {
  const Icon = TYPE_ICONS[a.activity_type] || SquareCheck;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !sortable });
  const [commenting, setCommenting] = useState(false);
  const [picking, setPicking] = useState(null); // { x, y }: where the week menu opens
  const prio = isPriorityNow(a);
  const next = a.rank === 1;
  return (
    <li ref={setNodeRef} style={sortable ? { transform: CSS.Transform.toString(transform), transition } : undefined}
      className={`rounded-lg border bg-white px-2.5 py-2 ${isDragging ? 'relative z-10 shadow-lg' : ''} ${
        next ? 'border-brand-500 ring-2 ring-brand-100' : a.flagged && !a.done ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="group flex items-start gap-2">
        {sortable && (
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag “${a.subject}” to reorder`} title="Drag to reorder"
            className="mt-0.5 cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-600 active:cursor-grabbing"><GripVertical size={14} /></button>
        )}
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={a.done} onChange={onToggle} aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`} />
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          {next && <span className="mb-0.5 inline-flex items-center gap-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">Next step</span>}
          <span className="flex items-center gap-1.5">
            <Icon size={14} className="shrink-0 text-slate-500" aria-label={a.activity_type} />
            <span className={`truncate text-sm font-medium ${a.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{a.subject}</span>
            {a.flagged && <Flag size={12} className="shrink-0 fill-red-500 text-red-500" aria-label="Flagged" />}
            {a.waiting_client && !a.done && <WaitingIcon size={12} />}
            {a.priority && <span className={`ml-auto shrink-0 rounded px-1.5 text-[10px] font-medium ring-1 ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>}
          </span>
          <span className={`mt-0.5 block text-[11px] ${overdue(a) ? 'font-medium text-red-600' : 'text-slate-500'}`}>
            {[when(a) || 'No date', overdue(a) && 'overdue', a.assignee_name].filter(Boolean).join(' · ')}
          </span>
          {a.cards.length > 0 && <span className="mt-0.5 flex items-center gap-0.5 text-[11px] text-slate-400"><CalendarRange size={11} /> Priority, week of {a.cards.map((c) => shortDate(c.week_start)).join(', ')}</span>}
          {(a.location || a.video_call || a.participants.length > 0) && (
            <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
              {a.location && <span className="flex items-center gap-0.5"><MapPin size={10} /> {a.location}</span>}
              {a.video_call && <span className="flex items-center gap-0.5"><Video size={10} /> Video call</span>}
              {a.participants.length > 0 && <span className="flex items-center gap-0.5"><Users size={10} /> {a.participants.map(contactName).join(', ')}</span>}
            </span>
          )}
        </button>
        {!a.done && (
          <button type="button" title={prio ? 'A weekly priority: change or remove its weeks' : 'Mark as a weekly priority'}
            aria-label={`${prio ? 'Change' : 'Mark'} “${a.subject}” as a weekly priority`} aria-haspopup="menu" aria-expanded={!!picking} aria-pressed={prio}
            onMouseDown={(e) => e.stopPropagation()} // so the menu's click-away doesn't fire first and reopen it
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicking(picking ? null : { x: r.right, y: r.bottom }); }}
            className={`flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium ${prio ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' : 'text-slate-400 hover:bg-slate-50 hover:text-amber-600'}`}>
            <Star size={13} className={prio ? 'fill-amber-400 text-amber-500' : ''} /> Priority
          </button>
        )}
        <button type="button" onClick={() => setCommenting(!commenting)} title="Comment on this activity" aria-label={`Comment on “${a.subject}”`}
          className={`flex items-center gap-0.5 text-[11px] ${a.comment_count ? 'text-violet-600' : 'text-slate-300 opacity-0 group-hover:opacity-100 focus:opacity-100'} hover:text-violet-700`}>
          <MessageSquare size={14} />{a.comment_count > 0 && a.comment_count}
        </button>
      </div>
      {picking && <PriorityWeekMenu activity={a} ticketId={ticketId} x={picking.x} y={picking.y} onClose={() => setPicking(null)} onChanged={onChanged} />}
      {commenting && (
        <div className="mt-1.5 ml-6">
          <CommentComposer ticketId={ticketId} target={{ type: 'activity', id: a.id }} autoFocus placeholder={`Comment on “${a.subject}”…`}
            onPosted={() => { setCommenting(false); onChanged(); }} onCancel={() => setCommenting(false)} />
        </div>
      )}
      {(!a.done || a.subtasks.length > 0) && (
        <div className="mt-1.5 ml-6 border-l-2 border-slate-100 pl-2">
          <SubtaskList activity={a} ticketId={ticketId} onChanged={onChanged} compact />
        </div>
      )}
    </li>
  );
}

/** Marks an activity, ticket or priority that's waiting on the client. */
export function WaitingIcon({ size = 12, className = '' }) {
  return (
    <span title="Waiting on client" aria-label="Waiting on client" className={`inline-grid shrink-0 place-items-center rounded-full bg-sky-100 p-0.5 text-sky-700 ${className}`}>
      <Hourglass size={size - 2} strokeWidth={2.5} />
    </span>
  );
}

/** One activity, new or existing, in the pane. `activityId` null makes a new one. */
function ActivityForm({ ticket, activityId, types, priorities, onClose, onBack, onSaved, onChanged, onDirty }) {
  const [detail, setDetail] = useState(null);
  const loadDetail = () => api.get(`/activities/${activityId}`).then(setDetail);
  useEffect(() => { if (activityId) loadDetail(); }, [activityId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (activityId && !detail) return <DrawerShell title="Activity" subtitle="Loading…" onClose={onClose}><p className="text-sm text-slate-400">Loading…</p></DrawerShell>;
  return (
    <ActivityEditor key={detail?.activity.id ?? 'new'} ticket={ticket} activity={detail?.activity ?? null} comments={detail?.comments ?? []} types={types} priorities={priorities}
      onClose={onClose} onBack={onBack} onSaved={onSaved} onDirty={onDirty}
      onChanged={() => { loadDetail(); onChanged?.(); }} />
  );
}

function ActivityEditor({ ticket, activity, comments, types, priorities, onClose, onBack, onSaved, onChanged, onDirty }) {
  const initial = activity ? formOf(activity) : blank(ticket);
  const [form, setForm] = useState(initial);
  const [newSubtasks, setNewSubtasks] = useState([]);
  const { user } = useAuth();
  const [prioTeam, setPrioTeam] = useState(''); // a new activity: the team to make it a priority for this week ('' = not one)
  const [users, setUsers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/users').then((d) => setUsers(d.users));
    api.get('/contacts').then((d) => setContacts(d.contacts));
    api.get('/tickets?scope=all').then((d) => setTickets(d.tickets.filter((t) => !t.archived || t.id === ticket.id)));
  }, []);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const leave = () => { if (!dirty || confirm('Discard your changes to this activity?')) onBack(); };
  const save = async () => {
    if (!form.subject.trim()) return setError('Give the activity a subject');
    setBusy(true);
    setError('');
    try {
      if (activity) await api.put(`/activities/${activity.id}`, form);
      else {
        const { activity: made } = await api.post('/activities', { ...form, subtasks: newSubtasks });
        if (prioTeam) {
          await api.post('/priorities/cards', { team_id: prioTeam, ticket_id: made.ticket_id, activity_id: made.id, assignees: [made.assignee_id || user.id] });
        }
      }
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the activity “${activity.subject}”?${activity.pipedrive_id ? ' It’s deleted from the deal in Pipedrive too.' : ''}`)) return;
    await api.del(`/activities/${activity.id}`);
    onSaved();
  };

  const field = (label, el, wide) => <label className={wide ? 'sm:col-span-2' : ''}><span className="label">{label}</span>{el}</label>;
  const moved = activity && Number(form.ticket_id) !== activity.ticket_id;

  return (
    <DrawerShell title={activity ? 'Activity' : 'New activity'} subtitle={activity ? activity.subject : ticket.opportunity_title} onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          {activity && <button type="button" className="btn-ghost px-2 text-red-600 hover:bg-red-50" onClick={remove} disabled={busy} aria-label="Delete activity"><Trash2 size={15} /></button>}
          <span className="mr-auto text-[11px] text-red-600">{error}</span>
          <button type="button" className="btn" onClick={leave} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy || (activity && !dirty)}>
            {busy ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : activity ? 'Save changes' : 'Save activity'}
          </button>
        </div>
      )}>
      <button type="button" className="btn-ghost -mt-1 mb-3 px-1.5 py-1 text-xs" onClick={leave}><ArrowLeft size={13} /> All activities</button>
      {activity?.rank === 1 && <p className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-[11px] text-brand-800">This is the {ticket.ticket_type === 'account' ? 'account' : 'ticket'}’s next step: the top open activity.</p>}
      <div className="space-y-4">
        <input className="input text-base font-medium" placeholder="Title, e.g. Lunch with the program office" value={form.subject} onChange={set('subject')} autoFocus={!activity} aria-label="Title" />

        <div role="radiogroup" aria-label="Meeting type" className="flex flex-wrap gap-1">
          {types.map((t) => {
            const Icon = TYPE_ICONS[t];
            const on = form.activity_type === t;
            return (
              <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setForm((f) => ({ ...f, activity_type: t }))}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs ring-1 transition ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:text-slate-900'}`}>
                <Icon size={13} /> {t}
              </button>
            );
          })}
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          {field('Date', <input type="date" className="input" value={form.due_date} onChange={set('due_date')} />)}
          {field('Time', <input type="time" className="input" value={form.due_time} onChange={set('due_time')} />)}
          {field('Duration', (
            <select className="input" value={form.duration} onChange={set('duration')}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {form.duration && !DURATIONS.some(([v]) => v === form.duration) && <option value={form.duration}>{form.duration}</option>}
            </select>
          ))}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {field('Priority', (
            <select className="input" value={form.priority} onChange={set('priority')}>
              <option value="">No priority</option>
              {priorities.map((p) => <option key={p}>{p}</option>)}
            </select>
          ))}
          <div className="flex items-end gap-2">
            <button type="button" aria-pressed={form.flagged} onClick={() => setForm((f) => ({ ...f, flagged: !f.flagged }))}
              className={`flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-md text-sm ring-1 transition ${form.flagged ? 'bg-red-50 text-red-700 ring-red-300' : 'bg-white text-slate-600 ring-slate-300 hover:text-slate-900'}`}>
              <Flag size={14} className={form.flagged ? 'fill-red-500 text-red-500' : ''} /> {form.flagged ? 'Flagged' : 'Flag'}
            </button>
            <button type="button" aria-pressed={form.waiting_client} onClick={() => setForm((f) => ({ ...f, waiting_client: !f.waiting_client }))}
              title="We’re waiting on the client. Shown on the ticket and its priority card, and not counted against completion."
              className={`flex h-[38px] flex-[2] items-center justify-center gap-1.5 rounded-md text-sm whitespace-nowrap ring-1 transition ${form.waiting_client ? 'bg-sky-50 text-sky-800 ring-sky-300' : 'bg-white text-slate-600 ring-slate-300 hover:text-slate-900'}`}>
              <Hourglass size={14} className={form.waiting_client ? 'text-sky-600' : ''} /> Waiting on client
            </button>
          </div>
          {field('Assigned to', (
            <select className="input" value={form.assignee_id} onChange={set('assignee_id')}>
              <option value="">Nobody</option>
              {users.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          ))}
          {field('Linked ticket', (
            <select className="input" value={form.ticket_id} onChange={set('ticket_id')}>
              {!tickets.some((t) => t.id === Number(form.ticket_id)) && <option value={form.ticket_id}>{ticket.opportunity_title}</option>}
              {tickets.map((t) => <option key={t.id} value={t.id}>{t.opportunity_title}</option>)}
            </select>
          ))}
          {moved && <p className="text-[11px] text-amber-700 sm:col-span-2">Saving moves this activity to the other ticket.</p>}
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          {field('Location', <input className="input" value={form.location} onChange={set('location')} placeholder="Address or place" />)}
          {field('Video call', (
            <div className="flex gap-1">
              <input className="input" value={form.video_call} onChange={set('video_call')} placeholder="Meeting link" />
              {/^https?:\/\//.test(form.video_call) && <a href={form.video_call} target="_blank" rel="noreferrer" className="btn px-2" aria-label="Open the video call"><ExternalLink size={14} /></a>}
            </div>
          ))}
          <div className="sm:col-span-2">
            <span className="label">People</span>
            <MultiSelect options={contacts.map((c) => ({ value: c.id, label: contactName(c), sub: c.organization || undefined }))}
              value={form.participants} onChange={(v) => setForm((f) => ({ ...f, participants: v }))} placeholder="Add people from the CRM…" />
          </div>
          {field('Company', <input className="input" value={form.organization} onChange={set('organization')} placeholder="Organization" />, true)}
          {field('Phone', <input className="input" type="tel" value={form.phone} onChange={set('phone')} placeholder="Number to call" />)}
          {field('Email', <input className="input" type="email" value={form.email} onChange={set('email')} placeholder="name@agency.gov" />)}
        </section>

        <section className="space-y-3">
          {field('Goals', <textarea className="input" rows={2} value={form.goals} onChange={set('goals')} placeholder="What this activity should achieve" />, true)}
          {field('Description', <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Agenda or details, shared with the people taking part" />, true)}
          {field('Notes', <textarea className="input" rows={3} value={form.note} onChange={set('note')} placeholder="Private notes" />, true)}
        </section>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={form.done} onChange={set('done')} /> Mark as done
        </label>

        <section className="border-t border-slate-200 pt-4">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><ListChecks size={13} /> Subtasks</h4>
          {activity
            ? <SubtaskList activity={activity} ticketId={ticket.id} onChanged={onChanged} />
            : <DraftSubtasks value={newSubtasks} onChange={setNewSubtasks} />}
        </section>

        {!activity && (user.teams || []).length > 0 && (
          <section className="border-t border-slate-200 pt-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!prioTeam}
                onChange={(e) => setPrioTeam(e.target.checked ? user.teams[0].id : '')} />
              <Star size={13} className={prioTeam ? 'fill-amber-400 text-amber-500' : 'text-slate-400'} /> Make it a weekly priority this week
            </label>
            {prioTeam && user.teams.length > 1 && (
              <select className="input mt-1.5 ml-6 h-8 w-48 py-0 text-sm" value={prioTeam} onChange={(e) => setPrioTeam(Number(e.target.value))} aria-label="Team">
                {user.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </section>
        )}

        {activity && (
          <>
            <WeeklyPriority activity={activity} ticket={ticket} onChanged={onChanged} />
            <section className="border-t border-slate-200 pt-4">
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><MessageSquare size={13} /> Comments</h4>
              {ticket.ticket_type !== 'account' && <p className="mb-2 text-[11px] text-slate-400">Comments here also show in the ticket’s history, marked as activity comments.</p>}
              <ActivityComments comments={comments} activity={activity} />
              <CommentComposer ticketId={ticket.id} target={{ type: 'activity', id: activity.id }} onPosted={onChanged} />
            </section>
          </>
        )}
      </div>
    </DrawerShell>
  );
}

// ---- Subtasks and comments

/** An activity's subtasks: check off, add, delete, and comment on each. `compact` tucks the add box behind a link, for lists. */
export function SubtaskList({ activity, ticketId, onChanged, compact }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [commenting, setCommenting] = useState(null);
  const [adding, setAdding] = useState(!compact);
  const run = async (p) => { setBusy(true); try { await p; onChanged(); } finally { setBusy(false); } };
  const add = () => text.trim() && !busy && run(api.post(`/activities/${activity.id}/subtasks`, { text }).then(() => setText('')));
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      <ul className="space-y-0.5">
        {activity.subtasks.map((s) => (
          <li key={s.id}>
            <div className="group flex items-start gap-2 rounded px-1 py-0.5 hover:bg-slate-50">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={s.done} disabled={busy}
                onChange={() => run(api.put(`/activities/subtasks/${s.id}`, { done: !s.done }))} aria-label={`Mark “${s.text}” ${s.done ? 'not done' : 'done'}`} />
              <span className={`min-w-0 flex-1 text-sm ${s.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{s.text}</span>
              <button type="button" onClick={() => setCommenting(commenting === s.id ? null : s.id)} title="Comment on this subtask" aria-label={`Comment on “${s.text}”`}
                className={`flex items-center gap-0.5 text-[11px] ${s.comment_count ? 'text-violet-600' : 'text-slate-300 opacity-0 group-hover:opacity-100'} hover:text-violet-700`}>
                <MessageSquare size={13} />{s.comment_count > 0 && s.comment_count}
              </button>
              <button type="button" onClick={() => confirm(`Delete the subtask “${s.text}”?`) && run(api.del(`/activities/subtasks/${s.id}`))} aria-label={`Delete “${s.text}”`}
                className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={13} /></button>
            </div>
            {commenting === s.id && (
              <div className="mt-1 mb-2 ml-6">
                <CommentComposer ticketId={ticketId} target={{ type: 'subtask', id: s.id }} autoFocus placeholder={`Comment on “${s.text}”…`}
                  onPosted={() => { setCommenting(null); onChanged(); }} onCancel={() => setCommenting(null)} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="flex gap-1.5 pl-1">
          <input className="input h-8 py-1 text-sm" placeholder="Add a subtask…" value={text} onChange={(e) => setText(e.target.value)} autoFocus={compact}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); add(); }
              if (e.key === 'Escape' && compact) { e.stopPropagation(); setText(''); setAdding(false); }
            }}
            onBlur={() => { if (compact && !text.trim()) setAdding(false); }} aria-label={`Add a subtask to “${activity.subject}”`} />
          <button type="button" className="btn h-8 px-2" onClick={add} disabled={!text.trim() || busy} aria-label="Add subtask"><Plus size={14} /></button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-slate-400 hover:text-brand-700">
          <Plus size={12} /> Add subtask
        </button>
      )}
    </div>
  );
}

/** Subtasks for an activity that isn't saved yet: they're made along with it. */
function DraftSubtasks({ value, onChange }) {
  const [text, setText] = useState('');
  const add = () => { if (text.trim()) { onChange([...value, text.trim()]); setText(''); } };
  return (
    <div className="space-y-1">
      {value.map((t, i) => (
        <div key={i} className="flex items-center gap-2 px-1 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" disabled aria-hidden />
          <span className="flex-1">{t}</span>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove “${t}”`} className="text-slate-300 hover:text-red-600"><Trash2 size={13} /></button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input className="input h-8 py-1 text-sm" placeholder="Add a subtask…" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} aria-label="Add a subtask" />
        <button type="button" className="btn h-8 px-2" onClick={add} disabled={!text.trim()} aria-label="Add subtask"><Plus size={14} /></button>
      </div>
    </div>
  );
}

/** Write a comment on an activity or a subtask. It joins the ticket's history, marked as an activity comment. */
export function CommentComposer({ ticketId, target, onPosted, onCancel, autoFocus, placeholder = 'Write a comment… use @ to mention someone' }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/tickets/${ticketId}/comments`, { body, target_type: target.type, target_id: target.id });
      setBody('');
      onPosted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5">
      <MentionTextarea rows={2} className="input resize-y text-sm" value={body} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
          if (e.key === 'Escape' && onCancel) { e.stopPropagation(); onCancel(); }
        }} />
      <div className="flex items-center justify-end gap-1.5">
        {error && <span className="mr-auto text-[11px] text-red-600">{error}</span>}
        {onCancel && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={post} disabled={!body.trim() || busy}>{busy ? 'Posting…' : 'Comment'}</button>
      </div>
    </div>
  );
}

/** The comments on an activity and its subtasks, oldest first, with their replies. */
function ActivityComments({ comments, activity }) {
  if (!comments.length) return <p className="mb-2 text-xs text-slate-400">No comments yet.</p>;
  const subtask = (id) => activity.subtasks.find((s) => s.id === id)?.text;
  const one = (m, reply) => (
    <div key={m.id} className={`rounded-md px-2.5 py-1.5 ${reply ? 'ml-4 bg-slate-50' : 'border border-violet-200 bg-violet-50/50'}`}>
      <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-500">
        <Avatar user={m.author} size="xs" />
        <span className="font-medium text-slate-700">{fullName(m.author) || 'Someone'}</span>
        <span title={fullStamp(m.created_at)}>· {stamp(m.created_at)}</span>
        {m.target_type === 'subtask' && subtask(m.target_id) && <span className="rounded bg-white px-1 text-violet-700 ring-1 ring-violet-200">on “{subtask(m.target_id)}”</span>}
      </div>
      <p className="mt-0.5 text-sm whitespace-pre-wrap text-slate-800">{m.body}</p>
    </div>
  );
  return <div className="mb-2 space-y-1.5">{comments.map((m) => <div key={m.id} className="space-y-1">{one(m)}{m.replies.map((x) => one(x, true))}</div>)}</div>;
}

/** Whether an activity is a weekly priority this week or a coming one (weeks start within the last seven days). */
const weekAgo = () => new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA');
export const isPriorityNow = (a) => (a.cards || []).some((c) => c.week_start >= weekAgo());

/**
 * The menu behind an activity's Priority button: pick the week to make it a priority in, for one of your teams.
 * Weeks start on the team's check-in day. A week whose planning has closed takes it as work instead.
 */
function PriorityWeekMenu({ activity, ticketId, x, y, onClose, onChanged }) {
  const { user } = useAuth();
  const teams = user.teams || [];
  const [team, setTeam] = useState(teams[0]?.id ?? '');
  const [weeks, setWeeks] = useState(null);
  const [busy, setBusy] = useState(null); // the week being added
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const away = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [onClose]);
  useEffect(() => {
    if (!team) return;
    setWeeks(null);
    api.get(`/priorities/weeks?team=${team}`).then(setWeeks).catch((e) => setError(e.message));
  }, [team]);

  const cardOn = (w) => activity.cards.find((c) => c.team_id === Number(team) && c.week_start === w);
  // Picking a week marks it; picking a marked week takes it off that week (the activity stays on the ticket).
  const toggle = async (week) => {
    const card = cardOn(week);
    if (card && !confirm(`Take “${activity.subject}” off ${card.team_name}’s priorities for the week of ${shortDate(week)}? Notes on that week’s card go with it.`)) return;
    setBusy(week);
    setError('');
    try {
      if (card) await api.del(`/priorities/cards/${card.id}?keep_activity=1`);
      else await api.post('/priorities/cards', { team_id: team, ticket_id: ticketId, activity_id: activity.id, week_start: week, assignees: [activity.assignee_id || user.id] });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
    setBusy(null);
  };
  const width = 240;
  return (
    <div ref={ref} role="menu" aria-label="Weekly priority for the week of" style={{ left: Math.max(8, Math.min(x - width, window.innerWidth - width - 8)), top: y + 4 }}
      className="fixed z-50 rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg" onClick={(e) => e.stopPropagation()}>
      <div className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-slate-500 uppercase" style={{ width }}>Weekly priority for the week of</div>
      {!teams.length && <p className="px-3 py-1.5 text-xs text-slate-400">You’re not on a team yet.</p>}
      {teams.length > 1 && (
        <div className="px-3 pb-1.5">
          <select className="input h-7 w-full py-0 text-xs" value={team} onChange={(e) => setTeam(Number(e.target.value))} aria-label="Team">
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      {team && !weeks && !error && <p className="px-3 py-1.5 text-xs text-slate-400">Loading…</p>}
      {weeks?.weeks.map((w) => {
        const current = w.week_start === weeks.currentWeekStart;
        const on = !!cardOn(w.week_start);
        return (
          <button key={w.week_start} type="button" role="menuitemcheckbox" aria-checked={on} disabled={!!busy} onClick={() => toggle(w.week_start)}
            title={on ? 'A priority for this team that week: select to take it off' : w.closed ? 'Planning for this week has closed, so it’s added as work' : undefined}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-default disabled:opacity-60">
            <span className="w-3.5 shrink-0">{on ? <Check size={14} className="text-brand-600" /> : busy === w.week_start ? <Loader2 size={14} className="animate-spin text-slate-400" /> : null}</span>
            <span className="flex-1">{current ? 'Current week' : shortDate(w.week_start)}{current && <span className="ml-1 text-xs text-slate-400">{shortDate(w.week_start)}</span>}</span>
            {w.closed && !on && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800" title="Planning closed: added as work">Work</span>}
          </button>
        );
      })}
      {error && <p className="px-3 py-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

/** Which weeks this activity is someone's weekly priority, with the week picker to mark or unmark it. */
function WeeklyPriority({ activity, ticket, onChanged }) {
  const [picking, setPicking] = useState(null);
  const prio = isPriorityNow(activity);
  return (
    <section className="border-t border-slate-200 pt-4">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><CalendarRange size={13} /> Weekly priorities</h4>
      {activity.cards.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-sm text-slate-700">
          {activity.cards.map((c) => <li key={c.id}>{c.team_name} · week of {shortDate(c.week_start)}</li>)}
        </ul>
      )}
      {!activity.done && (
        <button type="button" className="btn h-8 px-2.5 text-xs" aria-haspopup="menu" aria-expanded={!!picking}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicking(picking ? null : { x: r.right, y: r.bottom }); }}>
          <Star size={13} className={prio ? 'fill-amber-400 text-amber-500' : ''} /> {prio ? 'Change priority weeks' : 'Mark as a weekly priority'}
        </button>
      )}
      {picking && <PriorityWeekMenu activity={activity} ticketId={ticket.id} x={picking.x} y={picking.y} onClose={() => setPicking(null)} onChanged={onChanged} />}
      {!activity.cards.length && activity.done && <p className="text-xs text-slate-400">Not on anyone’s weekly priorities.</p>}
    </section>
  );
}
