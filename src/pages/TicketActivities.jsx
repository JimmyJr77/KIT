import { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, ArrowLeft, Phone, Users, SquareCheck, Clock, Mail, Utensils, Flag, Video, MapPin, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate } from '../lib/format.js';
import MultiSelect from '../components/MultiSelect.jsx';
import { contactName } from './ContactEditor.jsx';
import { DrawerShell } from './TicketPlanning.jsx';

// Pipedrive's activity types, each with its icon.
export const TYPE_ICONS = { Call: Phone, Meeting: Users, Task: SquareCheck, Deadline: Clock, Email: Mail, Lunch: Utensils };
const PRIORITY_STYLE = { High: 'bg-red-50 text-red-700 ring-red-200', Medium: 'bg-amber-50 text-amber-800 ring-amber-200', Low: 'bg-slate-100 text-slate-600 ring-slate-200' };
const DURATIONS = [['', 'No duration'], ['00:15', '15 min'], ['00:30', '30 min'], ['00:45', '45 min'], ['01:00', '1 hour'], ['01:30', '1½ hours'], ['02:00', '2 hours'], ['03:00', '3 hours'], ['04:00', '4 hours'], ['08:00', 'All day']];
const today = () => new Date().toLocaleDateString('en-CA');

const blank = (ticket) => ({
  subject: '', activity_type: 'Meeting', due_date: today(), due_time: '', duration: '01:00', priority: '', flagged: false,
  assignee_id: '', ticket_id: ticket.id, location: '', video_call: '', participants: [], organization: ticket.organization || '',
  phone: '', email: '', goals: '', description: '', note: '', done: false,
});
const formOf = (a) => ({
  subject: a.subject, activity_type: a.activity_type, due_date: a.due_date || '', due_time: a.due_time || '', duration: a.duration || '',
  priority: a.priority || '', flagged: a.flagged, assignee_id: a.assignee_id || '', ticket_id: a.ticket_id, location: a.location || '',
  video_call: a.video_call || '', participants: a.participants.map((p) => p.id), organization: a.organization || '', phone: a.phone || '',
  email: a.email || '', goals: a.goals || '', description: a.description || '', note: a.note || '', done: a.done,
});

/** "Tue, Nov 3 · 10:00 AM · 1 hour", for the list. */
function when(a) {
  const time = a.due_time && new Date(`2000-01-01T${a.due_time}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dur = DURATIONS.find(([v]) => v && v === a.duration)?.[1] || (a.duration ? a.duration : null);
  return [a.due_date && shortDate(a.due_date, { weekday: 'short', month: 'short', day: 'numeric' }), time, dur].filter(Boolean).join(' · ');
}
const overdue = (a) => !a.done && a.due_date && a.due_date < today();

/**
 * The Activity section on a bid ticket: calls, meetings, lunches and so on, as in Pipedrive. Check one off when it's
 * done; open one to see or change everything about it.
 */
export function ActivitiesDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('list'); // list | new | <activity id>
  const load = () => api.get(`/activities?ticket=${ticket.id}`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (a) => {
    setData((d) => ({ ...d, activities: d.activities.map((x) => (x.id === a.id ? { ...x, done: !x.done } : x)) }));
    await api.put(`/activities/${a.id}`, { done: !a.done });
    load();
    onChanged();
  };
  const back = () => { onDirty?.(false); setView('list'); load(); };

  const editing = view !== 'list' && (view === 'new' ? null : data?.activities.find((a) => a.id === view));
  if (view !== 'list' && data) {
    return (
      <ActivityForm key={view} ticket={ticket} activity={editing} types={data.types} priorities={data.priorities} onClose={onClose}
        onBack={back} onSaved={() => { back(); onChanged(); }} onDirty={onDirty} />
    );
  }

  const open = data?.activities.filter((a) => !a.done) || [];
  const done = data?.activities.filter((a) => a.done) || [];
  return (
    <DrawerShell title="Activity" subtitle={data ? `${open.length} to do · ${done.length} done` : 'Loading…'} onClose={onClose}>
      <div className="space-y-4">
        <button type="button" className="btn-primary w-full justify-center" onClick={() => setView('new')}><Plus size={15} /> Add activity</button>
        {data && !data.activities.length && <p className="text-center text-sm text-slate-400">No activities yet. Schedule a call, meeting or lunch.</p>}
        {[['To do', open], ['Done', done]].map(([label, list]) => list.length > 0 && (
          <section key={label}>
            <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</h4>
            <ul className="space-y-1.5">
              {list.map((a) => <ActivityRow key={a.id} a={a} onToggle={() => toggle(a)} onOpen={() => setView(a.id)} />)}
            </ul>
          </section>
        ))}
      </div>
    </DrawerShell>
  );
}

function ActivityRow({ a, onToggle, onOpen }) {
  const Icon = TYPE_ICONS[a.activity_type] || SquareCheck;
  return (
    <li className={`flex items-start gap-2.5 rounded-lg border bg-white px-3 py-2 ${a.flagged && !a.done ? 'border-red-200' : 'border-slate-200'}`}>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={a.done} onChange={onToggle} aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <Icon size={14} className="shrink-0 text-slate-500" aria-label={a.activity_type} />
          <span className={`truncate text-sm font-medium ${a.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{a.subject}</span>
          {a.flagged && <Flag size={12} className="shrink-0 fill-red-500 text-red-500" aria-label="Flagged" />}
          {a.priority && <span className={`ml-auto shrink-0 rounded px-1.5 text-[10px] font-medium ring-1 ${PRIORITY_STYLE[a.priority]}`}>{a.priority}</span>}
        </span>
        <span className={`mt-0.5 block text-[11px] ${overdue(a) ? 'font-medium text-red-600' : 'text-slate-500'}`}>
          {[when(a) || 'No date', overdue(a) && 'overdue', a.assignee_name].filter(Boolean).join(' · ')}
        </span>
        {(a.location || a.video_call || a.participants.length > 0) && (
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
            {a.location && <span className="flex items-center gap-0.5"><MapPin size={10} /> {a.location}</span>}
            {a.video_call && <span className="flex items-center gap-0.5"><Video size={10} /> Video call</span>}
            {a.participants.length > 0 && <span className="flex items-center gap-0.5"><Users size={10} /> {a.participants.map(contactName).join(', ')}</span>}
          </span>
        )}
      </button>
    </li>
  );
}

function ActivityForm({ ticket, activity, types, priorities, onClose, onBack, onSaved, onDirty }) {
  const initial = activity ? formOf(activity) : blank(ticket);
  const [form, setForm] = useState(initial);
  const [users, setUsers] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/users').then((d) => setUsers(d.users));
    api.get('/contacts').then((d) => setContacts(d.contacts));
    api.get('/tickets?scope=all&kind=bid').then((d) => setTickets(d.tickets));
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
      else await api.post('/activities', form);
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete the activity “${activity.subject}”?`)) return;
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
          <div className="flex items-end">
            <button type="button" aria-pressed={form.flagged} onClick={() => setForm((f) => ({ ...f, flagged: !f.flagged }))}
              className={`flex h-[38px] w-full items-center justify-center gap-1.5 rounded-md text-sm ring-1 transition ${form.flagged ? 'bg-red-50 text-red-700 ring-red-300' : 'bg-white text-slate-600 ring-slate-300 hover:text-slate-900'}`}>
              <Flag size={14} className={form.flagged ? 'fill-red-500 text-red-500' : ''} /> {form.flagged ? 'Flagged' : 'Flag'}
            </button>
          </div>
          {field('Assigned to', (
            <select className="input" value={form.assignee_id} onChange={set('assignee_id')}>
              <option value="">Nobody</option>
              {users.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          ))}
          {field('Linked bid ticket', (
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
      </div>
    </DrawerShell>
  );
}
