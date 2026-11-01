import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, Loader2, Check, SquareCheck, ChessPawn, Scale, Sparkles, PenLine, ContactRound, ArrowLeft, Search, Link2, Unlink, Flag, Workflow, Upload, FileText, Download, ChevronDown, ChevronRight, Users, ClipboardList, Star, CalendarCheck, MessageSquare } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { api } from '../lib/api.js';
import { stamp, fullStamp, fullName, shortDate } from '../lib/format.js';
import { ContactForm, ContactDetail, RelationshipBadge, contactName, contactLine } from './ContactEditor.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import { PROCESS_TYPES, REVIEW_AREAS } from '../lib/process.js';
import { ActivitiesDrawer, ActivityForm, SubtaskList, CommentComposer, when } from './TicketActivities.jsx';
import { CRITERIA, SCORE_LABELS, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin, weightShares } from '../lib/assessment.js';

/** The menu items along the ticket pane's left edge. Strategy and the win assessment are for bid tickets only. */
export const PLAN_TOOLS = [
  { key: 'strategy', label: 'Strategy', icon: ChessPawn, bidOnly: true },
  { key: 'activities', label: 'Activity', icon: CalendarCheck },
  { key: 'tasks', label: 'Tasks', icon: SquareCheck },
  { key: 'assessment', label: 'Bid and win assessment', icon: Scale, bidOnly: true },
  { key: 'people', label: 'People', icon: ContactRound },
  { key: 'process', label: 'Process flow', icon: Workflow, bidOnly: true },
  { key: 'details', label: 'Deal details', icon: ClipboardList, bidOnly: true },
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
export function PlanDrawer({ tool, ticket, onClose, onChanged, onDirty, activityId }) {
  if (tool === 'activities') return <ActivitiesDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} initialId={activityId} />;
  if (tool === 'tasks') return <TasksDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'people') return <PeopleDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
  if (tool === 'strategy') return <StrategyDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'process') return <ProcessDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'details') return <DetailsDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'assessment') return <AssessmentDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  return null;
}

export function DrawerShell({ title, subtitle, onClose, footer, children }) {
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

/**
 * Every activity on the ticket as a checkbox, in priority order, with its subtasks indented under it. Checking an
 * activity marks it done in the Activity pane too. A new task is a new activity: its form opens here, then returns.
 */
function TasksDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('list'); // list | new | <activity id>
  const [commenting, setCommenting] = useState(null);
  const load = () => api.get(`/activities?ticket=${ticket.id}`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = () => { load(); onChanged(); };
  const back = () => { onDirty?.(false); setView('list'); load(); };

  if (view !== 'list' && data) {
    return (
      <ActivityForm key={view} ticket={ticket} activityId={view === 'new' ? null : view} types={data.types} priorities={data.priorities} onClose={onClose}
        onBack={back} onSaved={() => { back(); onChanged(); }} onChanged={changed} onDirty={onDirty} backLabel="Back to tasks" />
    );
  }

  const toggle = async (a) => {
    setData((d) => ({ ...d, activities: d.activities.map((x) => (x.id === a.id ? { ...x, done: !x.done } : x)) }));
    await api.put(`/activities/${a.id}`, { done: !a.done });
    changed();
  };
  const all = data?.activities || [];
  const items = all.length + all.reduce((n, a) => n + a.subtasks.length, 0);
  const done = all.filter((a) => a.done).length + all.reduce((n, a) => n + a.subtasks.filter((x) => x.done).length, 0);

  return (
    <DrawerShell title="Tasks" subtitle={data ? `${items - done} to do · ${done} done across this ticket` : 'Loading…'} onClose={onClose}>
      <div className="space-y-4">
        <button type="button" className="btn-primary w-full justify-center" onClick={() => setView('new')}><Plus size={15} /> New task</button>
        {data && !all.length && <p className="text-center text-sm text-slate-400">No tasks yet. A new task is a new activity on this ticket.</p>}
        <ul className="space-y-2">
          {all.map((a) => (
            <li key={a.id} className={`rounded-lg border bg-white p-2.5 ${a.rank === 1 ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
              <div className="group flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={a.done} onChange={() => toggle(a)}
                  aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`} />
                <button type="button" onClick={() => setView(a.id)} className="min-w-0 flex-1 text-left">
                  {a.rank === 1 && <span className="mb-0.5 inline-block rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">Next step</span>}
                  <span className={`block text-sm font-medium ${a.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{a.subject}</span>
                  <span className="block text-[11px] text-slate-500">{[a.activity_type, when(a) || 'No date', a.assignee_name].filter(Boolean).join(' · ')}</span>
                </button>
                <button type="button" onClick={() => setCommenting(commenting === a.id ? null : a.id)} title="Comment on this task" aria-label={`Comment on “${a.subject}”`}
                  className={`flex items-center gap-0.5 text-[11px] ${a.comment_count ? 'text-violet-600' : 'text-slate-300 opacity-0 group-hover:opacity-100'} hover:text-violet-700`}>
                  <MessageSquare size={14} />{a.comment_count > 0 && a.comment_count}
                </button>
              </div>
              {commenting === a.id && (
                <div className="mt-1.5 ml-6">
                  <CommentComposer ticketId={ticket.id} target={{ type: 'activity', id: a.id }} autoFocus placeholder={`Comment on “${a.subject}”…`}
                    onPosted={() => { setCommenting(null); changed(); }} onCancel={() => setCommenting(null)} />
                </div>
              )}
              {(!a.done || a.subtasks.length > 0) && (
                <div className="mt-1.5 ml-6 border-l-2 border-slate-100 pl-2">
                  <SubtaskList activity={a} ticketId={ticket.id} onChanged={changed} compact />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </DrawerShell>
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
  const makePrimary = async (c) => {
    await api.put(`/contacts/${c.id}/tickets/${ticket.id}/primary`, { primary: !c.is_primary });
    load();
    onChanged();
  };
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
                    {c.is_primary && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">Primary</span>}
                  </div>
                  {contactLine(c) && <div className="truncate text-xs text-slate-500">{contactLine(c)}</div>}
                  <div className="text-[11px] text-slate-400">{c.interaction_count} interaction{c.interaction_count === 1 ? '' : 's'}{c.last_interaction_at ? ` · last ${stamp(c.last_interaction_at)}` : ''}</div>
                </button>
                <button type="button" onClick={() => makePrimary(c)} title={c.is_primary ? 'No longer the primary contact' : 'Make the primary contact'}
                  aria-label={c.is_primary ? 'No longer the primary contact' : 'Make the primary contact'} aria-pressed={c.is_primary}
                  className={`rounded p-1 hover:bg-slate-100 ${c.is_primary ? 'text-amber-500' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-500'}`}>
                  <Star size={14} fill={c.is_primary ? 'currentColor' : 'none'} />
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

// ---- Process flow

const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const today = () => new Date().toLocaleDateString('en-CA');
const stepForm = (s) => ({ step_type: s.step_type, step_date: s.step_date || '', notes: s.notes, reviews: s.reviews });

/**
 * A timeline of the formal process steps on a bid (RFI, RFP, gate reviews, ROM, proposal…), oldest first.
 * Steps can be added at any time. Each records who was involved in its reviews, notes, and documents.
 */
function ProcessDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [steps, setSteps] = useState(null);
  const [users, setUsers] = useState([]);
  const [type, setType] = useState(PROCESS_TYPES[0]);
  const [date, setDate] = useState(today());
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const setDirty = (v) => { dirty.current = v; onDirty?.(v); };
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/process`).then((d) => setSteps(d.steps)).catch((e) => setError(e.message));
    api.get('/users').then((d) => setUsers(d.users));
  }, [ticket.id]);

  const apply = (p) => p.then((d) => { setSteps(d.steps); onChanged(); return d; });
  const toggle = (id) => {
    if (dirty.current && !confirm('You have unsaved changes to this step. Discard them?')) return;
    setDirty(false);
    setOpenId(openId === id ? null : id);
  };
  const add = async () => {
    if (busy || (dirty.current && !confirm('You have unsaved changes to a step. Discard them?'))) return;
    setBusy(true);
    setError('');
    try {
      const d = await apply(api.post(`/tickets/${ticket.id}/process`, { step_type: type, step_date: date }));
      setDirty(false);
      setOpenId(d.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const userOptions = users.map((u) => ({ value: u.id, label: fullName(u), sub: u.team_name }));
  const byId = (id) => users.find((u) => u.id === id);

  return (
    <DrawerShell title="Process flow" subtitle="The formal steps of this pursuit, with their reviews and documents" onClose={onClose}>
      <div className="space-y-4">
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">New process step</span>
          <div className="flex gap-2">
            <select className="input flex-1 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Step type">
              {PROCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input type="date" className="input w-36 text-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Step date" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || 'Add steps in any order; the timeline sorts by date'}</span>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={add} disabled={busy}>{busy ? 'Adding…' : <><Plus size={13} /> Add step</>}</button>
          </div>
        </section>

        {steps && !steps.length && <p className="text-sm text-slate-400">No process steps yet. Add the first one above.</p>}
        {steps && steps.length > 0 && (
          <ol className="relative space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-slate-200">
            {steps.map((s) => (
              <ProcessStep key={s.id} step={s} open={openId === s.id} onToggle={() => toggle(s.id)} byId={byId} userOptions={userOptions}
                onDirty={setDirty} apply={apply}
                onDeleted={() => { setDirty(false); setOpenId(null); }} />
            ))}
          </ol>
        )}
      </div>
    </DrawerShell>
  );
}

function ProcessStep({ step: s, open, onToggle, byId, userOptions, onDirty, apply, onDeleted }) {
  const { user } = useAuth();
  const involved = REVIEW_AREAS.filter((a) => s.reviews[a.key].people.length || s.reviews[a.key].notes);
  const people = [...new Set(REVIEW_AREAS.flatMap((a) => s.reviews[a.key].people))].map(byId).filter(Boolean);
  return (
    <li className="relative flex gap-3">
      <span className={`relative z-10 mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-slate-50 ${open ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'}`}>
        <Workflow size={12} />
      </span>
      <div className={`min-w-0 flex-1 rounded-lg border bg-white transition ${open ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-500'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 p-2.5 text-left">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-semibold text-slate-800">{s.step_type}</span>
              <span className="text-xs text-slate-500">{s.step_date ? shortDate(s.step_date) : 'No date'}</span>
            </div>
            {!open && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                {involved.map((a) => <span key={a.key} className="rounded bg-slate-100 px-1.5 py-0.5">{a.label}</span>)}
                {s.files.length > 0 && <span className="flex items-center gap-0.5"><FileText size={11} /> {s.files.length}</span>}
                {people.length > 0 && <span className="flex -space-x-1">{people.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size="xs" className="ring-2 ring-white" />)}</span>}
                {!involved.length && !s.files.length && !s.notes && <span className="text-slate-400">Nothing recorded yet</span>}
              </div>
            )}
            {!open && s.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{s.notes}</p>}
          </div>
          {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-300" />}
        </button>
        {open && <ProcessStepEditor step={s} user={user} userOptions={userOptions} onDirty={onDirty} apply={apply} onDeleted={onDeleted} />}
      </div>
    </li>
  );
}

function ProcessStepEditor({ step: s, user, userOptions, onDirty, apply, onDeleted }) {
  const [form, setForm] = useState(() => stepForm(s));
  const [saved, setSaved] = useState(() => JSON.stringify(stepForm(s)));
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const dirty = JSON.stringify(form) !== saved;
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setReview = (area, k, v) => setForm((f) => ({ ...f, reviews: { ...f.reviews, [area]: { ...f.reviews[area], [k]: v } } }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await apply(api.put(`/tickets/process/${s.id}`, form));
      const next = stepForm(d.steps.find((x) => x.id === s.id));
      setForm(next);
      setSaved(JSON.stringify(next));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Delete this ${s.step_type} step? Its documents stay on the ticket.`)) return;
    try { await apply(api.del(`/tickets/process/${s.id}`)); onDeleted(); } catch (e) { setError(e.message); }
  };
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try { await apply(api.post(`/tickets/process/${s.id}/files`, fd)); } catch (e) { setError(e.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-4 border-t border-slate-100 px-3 pt-3 pb-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-type-${s.id}`}>Step</label>
          <select id={`ps-type-${s.id}`} className="input py-1.5 text-sm" value={form.step_type} onChange={(e) => set('step_type', e.target.value)}>
            {PROCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-date-${s.id}`}>Date</label>
          <input id={`ps-date-${s.id}`} type="date" className="input py-1.5 text-sm" value={form.step_date} onChange={(e) => set('step_date', e.target.value)} />
        </div>
      </div>

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Users size={12} /> Who was involved</h4>
        <div className="space-y-2.5">
          {REVIEW_AREAS.map((a) => (
            <div key={a.key} className="rounded-md bg-slate-50 p-2.5">
              <div className="mb-1 text-xs font-semibold text-slate-700">{a.label}</div>
              <MultiSelect compact options={userOptions} value={form.reviews[a.key].people} onChange={(v) => setReview(a.key, 'people', v)} placeholder="Add people…" />
              <textarea rows={2} className="input mt-1.5 resize-y py-1.5 text-sm" placeholder={`${a.label} notes, outcome, or people outside KIT…`}
                value={form.reviews[a.key].notes} onChange={(e) => setReview(a.key, 'notes', e.target.value)} aria-label={`${a.label} notes`} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <label className="mb-1 block text-xs font-semibold tracking-wide text-slate-500 uppercase" htmlFor={`ps-notes-${s.id}`}>Notes</label>
        <textarea id={`ps-notes-${s.id}`} rows={3} className="input resize-y text-sm" value={form.notes} onChange={(e) => set('notes', e.target.value)}
          placeholder="Decisions, open questions, due dates…" />
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Documents</span>
          <label className={`btn cursor-pointer px-2.5 py-1 text-xs ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
            {uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : <><Upload size={12} /> Upload</>}
            <input ref={fileRef} type="file" className="sr-only" onChange={(e) => upload(e.target.files[0])} />
          </label>
        </div>
        {s.files.length ? (
          <ul className="space-y-1">
            {s.files.map((f) => (
              <li key={f.id}>
                <a href={`/api/tickets/files/${f.id}`} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm hover:border-brand-500" title={`Uploaded ${fullStamp(f.created_at)}${f.uploaded_by ? ` by ${fullName(f.uploaded_by)}` : ''}`}>
                  <FileText size={14} className="shrink-0 text-emerald-600" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 text-[11px] text-slate-400">{bytes(f.size)}</span>
                  <Download size={13} className="shrink-0 text-slate-400" />
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-slate-400">No documents yet. Uploads also appear on the ticket timeline.</p>}
      </section>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className={`text-[11px] ${error ? 'text-red-600' : dirty ? 'text-amber-700' : 'text-slate-400'}`}>
          {error || (dirty ? 'Unsaved changes' : s.updated_at ? `Saved ${stamp(s.updated_at)}${s.updated_by ? ` by ${fullName(s.updated_by)}` : ''}` : `Added ${stamp(s.created_at)}${s.author ? ` by ${fullName(s.author)}` : ''}`)}
        </span>
        <span className="flex shrink-0 gap-1.5">
          {(s.author?.id === user.id || user.role === 'admin') && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500 hover:text-red-600" onClick={remove} aria-label="Delete step" title="Delete step"><Trash2 size={13} /></button>
          )}
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={save} disabled={!dirty || busy}>
            {busy ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save'}
          </button>
        </span>
      </div>
    </div>
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
        <div className="space-y-5">
          <section className="space-y-1.5">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><PenLine size={13} /> Your strategy</h4>
            <textarea className="input min-h-[38vh] resize-y text-sm leading-relaxed" value={value} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), dirty && save())}
              aria-label="Your strategy"
              placeholder={'Win themes, customer hot buttons, discriminators, teaming approach, price-to-win, and the actions that get us there…'} />
          </section>
          <SuggestedStrategy />
        </div>
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

/**
 * Where an AI-suggested strategy will go, drawn from the ticket's details, contacts, process steps and assessment.
 * Not connected yet: this is a placeholder, and nothing here is sent anywhere or saved.
 */
function SuggestedStrategy() {
  return (
    <section className="space-y-1.5" aria-label="Suggested strategy">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <Sparkles size={13} className="text-violet-500" /> Suggested strategy
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-slate-500 normal-case">Coming soon</span>
      </h4>
      <div className="space-y-3 rounded-lg border border-dashed border-violet-200 bg-violet-50/40 p-4">
        <p className="text-sm text-slate-600">
          An AI-suggested strategy will appear here, drawn from this ticket's details, contacts, process steps and win assessment.
          It stays separate from yours: copy what's useful into Your strategy.
        </p>
        <button type="button" className="btn px-3 py-1.5 text-xs" disabled title="Not connected yet">
          <Sparkles size={13} /> Generate suggestion
        </button>
      </div>
    </section>
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
  useEffect(() => { api.get(`/activities?ticket=${ticket.id}`).then((d) => setNextStep(d.activities.find((a) => a.rank === 1) || null)); }, [ticket.id]);

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
                        <p className="mb-1 flex items-center gap-1 text-[10px] text-brand-700"><Flag size={10} /> Filled in from the ticket’s next step, its top activity</p>
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

// ---- Deal details

const money = (n, currency) => {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n); } catch { return `${n} ${currency}`; }
};
const lineTotal = (p) => p.quantity * p.item_price * (1 - p.discount / 100);
const formOf = (d) => ({
  lost_reason: d.lost_reason ?? '', probability: d.probability ?? '', currency: d.currency ?? '', source: d.source ?? '',
  followers: d.followers.map((u) => u.id), custom_fields: d.custom_fields, pipeline_id: d.pipeline_id ?? '',
});

/**
 * The Pipedrive deal fields with no other place on the ticket (tags sit under the ticket's title): lost reason, probability, currency, source,
 * followers, custom fields and products. Everything else in a deal already has a home (stage, value, dates, people,
 * notes, activities, files, emails), so a deal can be brought over whole.
 */
function DetailsDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = (d) => { setData(d); setForm(formOf(d)); };
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/details`).then(load);
    api.get('/users').then((d) => setUsers(d.users));
  }, [ticket.id]);
  const dirty = !!data && JSON.stringify(form) !== JSON.stringify(formOf(data));
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setField = (i, k, v) => setForm((f) => ({ ...f, custom_fields: f.custom_fields.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      load(await api.put(`/tickets/${ticket.id}/details`, { ...form, pipeline_id: form.pipeline_id || null }));
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const products = async (call) => {
    setError('');
    // Only the product list changes; unsaved edits to the fields above are kept.
    try { setData(await call()); onChanged(); } catch (e) { setError(e.message); }
  };

  const userOptions = users.filter((u) => u.active !== 0).map((u) => ({ value: u.id, label: fullName(u) }));
  const lost = ticket.pipeline_status === 'Lost';

  return (
    <DrawerShell title="Deal details" subtitle={data?.pipedrive_id ? `Pipedrive deal #${data.pipedrive_id}` : 'Deal fields from Pipedrive, and any others'} onClose={onClose}
      footer={form && <SaveBar dirty={dirty} busy={busy} error={error} onSave={save} />}>
      {form ? (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2">
            {data.pipelines.length > 1 && (
              <label className="sm:col-span-2">
                <span className="label">Pipeline</span>
                <select className="input" value={form.pipeline_id} onChange={set('pipeline_id')}>
                  {data.pipelines.map((p) => <option key={p.id ?? ''} value={p.id ?? ''}>{p.name}</option>)}
                </select>
              </label>
            )}
            {lost && (
              <label className="sm:col-span-2">
                <span className="label">Lost reason</span>
                <input className="input" value={form.lost_reason} onChange={set('lost_reason')} placeholder="e.g. No Bid, price, incumbent kept it…" />
              </label>
            )}
            <label>
              <span className="label">Probability (%)</span>
              <input className="input" type="number" min={0} max={100} value={form.probability} onChange={set('probability')} placeholder="Set by hand" />
            </label>
            <label>
              <span className="label">Currency</span>
              <input className="input uppercase" maxLength={3} value={form.currency} onChange={set('currency')} placeholder="USD" />
            </label>
            <label className="sm:col-span-2">
              <span className="label">Source</span>
              <input className="input" value={form.source} onChange={set('source')} placeholder="Where the deal came from" />
            </label>
            <div className="sm:col-span-2">
              <span className="label">Followers</span>
              <MultiSelect options={userOptions} value={form.followers} onChange={(v) => setForm((f) => ({ ...f, followers: v }))} placeholder="Type a name…" />
            </div>
          </section>

          <section>
            <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Custom fields</h4>
            <p className="mb-2 text-[11px] text-slate-400">Pipedrive custom fields come over here, by name. Add your own the same way.</p>
            <div className="space-y-1.5">
              {form.custom_fields.map((x, i) => (
                <div key={i} className="flex gap-1.5">
                  <input className="input w-2/5 text-sm" value={x.name} onChange={(e) => setField(i, 'name', e.target.value)} placeholder="Field" aria-label="Field name" />
                  <input className="input flex-1 text-sm" value={x.value} onChange={(e) => setField(i, 'value', e.target.value)} placeholder="Value" aria-label="Field value" />
                  <button type="button" className="btn-ghost px-1.5 text-slate-400 hover:text-red-600" aria-label="Remove field"
                    onClick={() => setForm((f) => ({ ...f, custom_fields: f.custom_fields.filter((_, j) => j !== i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, { name: '', value: '' }] }))}>
                <Plus size={13} /> Add a field
              </button>
            </div>
          </section>

          <ProductsSection data={data} currency={form.currency || data.currency}
            onAdd={(p) => products(() => api.post(`/tickets/${ticket.id}/products`, p))}
            onDelete={(p) => confirm(`Remove “${p.name}”?`) && products(() => api.del(`/tickets/products/${p.id}`))} />
        </div>
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

/** Products on the deal, each saved as it's added or removed (apart from the fields above). */
function ProductsSection({ data, currency, onAdd, onDelete }) {
  const blank = { name: '', quantity: '1', item_price: '', discount: '' };
  const [p, setP] = useState(blank);
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  const add = async () => { if (p.name.trim()) { await onAdd(p); setP(blank); } };
  const total = data.products.reduce((s, x) => s + lineTotal(x), 0);
  return (
    <section>
      <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Products</h4>
      <p className="mb-2 text-[11px] text-slate-400">What's being sold on this deal. Saved as soon as you add or remove one.</p>
      {data.products.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {data.products.map((x) => (
            <li key={x.id} className="group flex items-start gap-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{x.name}</div>
                <div className="text-[11px] text-slate-500">
                  {x.quantity} × {money(x.item_price, currency)}{x.discount ? ` · ${x.discount}% off` : ''}{x.comments ? ` · ${x.comments}` : ''}
                </div>
              </div>
              <span className="shrink-0 tabular-nums text-slate-700">{money(lineTotal(x), currency)}</span>
              <button type="button" onClick={() => onDelete(x)} aria-label={`Remove ${x.name}`} className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={14} /></button>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 text-xs font-semibold text-slate-700"><span>Total</span><span className="tabular-nums">{money(total, currency)}</span></li>
        </ul>
      )}
      <div className="grid grid-cols-[1fr_4rem_6rem_4rem_auto] gap-1.5">
        <input className="input text-sm" value={p.name} onChange={set('name')} placeholder="Product" aria-label="Product name" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input className="input text-sm" type="number" min={0} value={p.quantity} onChange={set('quantity')} aria-label="Quantity" title="Quantity" />
        <input className="input text-sm" type="number" min={0} value={p.item_price} onChange={set('item_price')} placeholder="Price" aria-label="Item price" />
        <input className="input text-sm" type="number" min={0} max={100} value={p.discount} onChange={set('discount')} placeholder="% off" aria-label="Discount percent" />
        <button type="button" className="btn-primary px-2" onClick={add} disabled={!p.name.trim()} aria-label="Add product"><Plus size={15} /></button>
      </div>
    </section>
  );
}
