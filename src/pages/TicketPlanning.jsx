import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Plus, Trash2, Loader2, Check, Eye, ChessPawn, Scale, Sparkles, PenLine, ContactRound, ArrowLeft, Search, Link2, Unlink, Flag, Workflow, Upload, FileText, Download, ChevronDown, ChevronRight, Users, ClipboardList, Star, CalendarCheck, Ticket } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { api } from '../lib/api.js';
import { stamp, fullStamp, fullName, shortDate } from '../lib/format.js';
import { ContactForm, ContactDetail, RelationshipBadge, contactName, contactLine } from './ContactEditor.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import { PROCESS_TYPES, REVIEW_AREAS, DECISIONS, milestoneOf } from '../lib/process.js';
import { ActivitiesDrawer } from './TicketActivities.jsx';
import { CRITERIA, SCORE_LABELS, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin, weightShares } from '../lib/assessment.js';

/**
 * The menu items along the ticket pane's left edge. Strategy and the win assessment are for pipeline tickets only. Priority
 * accounts share the `account` ones, under `accountLabel` if they have one; their priority tickets (`accountOnly`) are theirs alone.
 */
export const PLAN_TOOLS = [
  { key: 'strategy', label: 'Strategy', icon: ChessPawn, bidOnly: true, account: true },
  { key: 'activities', label: 'Activity', icon: CalendarCheck, account: true },
  { key: 'tickets', label: 'Priority tickets', icon: Ticket, account: true, accountOnly: true },
  { key: 'assessment', label: 'Bid and win assessment', icon: Scale, bidOnly: true },
  { key: 'people', label: 'People', accountLabel: 'CRM', icon: ContactRound, account: true },
  { key: 'process', label: 'Milestones', icon: Workflow, bidOnly: true },
  { key: 'details', label: 'Deal details', icon: ClipboardList, bidOnly: true },
];

export function PlanRail({ ticket, active, onSelect, skip = [] }) {
  const shown = (t) => !skip.includes(t.key) && (ticket.ticket_type === 'account' ? t.account : !t.accountOnly && (!t.bidOnly || ticket.ticket_type !== 'work'));
  return PLAN_TOOLS.filter(shown).map(({ key, label, accountLabel, icon: Icon }) => {
    const name = (ticket.ticket_type === 'account' && accountLabel) || label;
    return (
      <button key={key} type="button" onClick={() => onSelect(active === key ? null : key)} title={name} aria-label={name} aria-pressed={active === key}
        className={`grid h-9 w-9 place-items-center rounded-md transition ${active === key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'}`}>
        <Icon size={18} />
      </button>
    );
  });
}

/** The extra pane for whichever menu item is open. `onChanged` refreshes the timeline after a save. */
export function PlanDrawer({ tool, ticket, onClose, onChanged, onDirty, activityId }) {
  if (tool === 'activities') return <ActivitiesDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} initialId={activityId} />;
  if (tool === 'people') return <PeopleDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
  if (tool === 'strategy') return <StrategyDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'process') return <ProcessDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'details') return <DetailsDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'assessment') return <AssessmentDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  return null;
}

/**
 * Set by the ticket pane: `{ readOnly, ownerName }`. Read-only when you don't own the ticket (and aren't an admin): you can
 * read everything and comment, but the ticket's own fields, milestones and people are its owner's to change.
 */
export const TicketAccess = createContext({ readOnly: false, ownerName: null });

/** "View only" note for someone who doesn't own the ticket. */
export function ViewOnlyNote({ className = '' }) {
  const { readOnly, ownerName } = useContext(TicketAccess);
  if (!readOnly) return null;
  return (
    <p className={`flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200 ${className}`}>
      <Eye size={13} className="mt-px shrink-0" />
      <span>View only. {ownerName ? `${ownerName} owns this ticket, so only they` : 'Only the ticket’s owner'} (or an admin) can change it. You can still comment.</span>
    </p>
  );
}

/** A drawer's frame. With `lockable`, a read-only viewer sees its fields disabled and no save bar. */
export function DrawerShell({ title, subtitle, onClose, footer, lockable = false, children }) {
  const { readOnly } = useContext(TicketAccess);
  const locked = lockable && readOnly;
  return (
    <>
      <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
        </div>
        <button className="btn-ghost p-1.5" onClick={onClose} aria-label={`Close ${title}`}><X size={18} /></button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {locked && <ViewOnlyNote className="mb-3" />}
        {lockable ? <fieldset disabled={locked} className="min-w-0">{children}</fieldset> : children}
      </div>
      {footer && !locked && <footer className="border-t border-slate-200 bg-white px-5 py-3">{footer}</footer>}
    </>
  );
}

// ---- People (CRM)

/**
 * The people involved in this ticket, or priority account (where it's the CRM pane, topped by everyone we know there).
 * Anyone added here also goes into the master CRM; people already in the CRM can be linked instead. Selecting someone
 * opens their details and interaction log.
 */
function PeopleDrawer({ ticket, onClose, onChanged }) {
  const [view, setView] = useState('list'); // list | new | link | <contact id>
  const [people, setPeople] = useState(null);
  const account = ticket.ticket_type === 'account';
  const noun = account ? 'account' : 'ticket';
  const load = () => api.get(`/contacts/ticket/${ticket.id}`).then((d) => setPeople(d.contacts));
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { setView('list'); load(); };
  const makePrimary = async (c) => {
    await api.put(`/contacts/${c.id}/tickets/${ticket.id}/primary`, { primary: !c.is_primary });
    load();
    onChanged();
  };
  const unlink = async (c) => {
    if (!confirm(`Take ${contactName(c)} off this ${noun}? They stay in the CRM.`)) return;
    await api.del(`/contacts/${c.id}/tickets/${ticket.id}`);
    load();
    onChanged();
  };

  const header = view !== 'list' && (
    <button type="button" onClick={back} className="mb-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><ArrowLeft size={13} /> Back to people</button>
  );
  const selected = typeof view === 'number' ? people?.find((p) => p.id === view) : null;
  const { readOnly } = useContext(TicketAccess);

  return (
    <DrawerShell title={selected ? contactName(selected) : view === 'new' ? 'Add a person' : view === 'link' ? 'Add from the CRM' : account ? 'CRM' : 'People'}
      subtitle={selected ? contactLine(selected) || 'In the CRM' : 'Everyone added here also goes into the CRM'} onClose={onClose}>
      {header}
      {view === 'list' && (
        <div className="space-y-3">
          {account && <CrmPeople organization={ticket.organization} account reloadKey={people} />}
          {account && <h4 className="border-t border-slate-200 pt-3 text-xs font-medium text-slate-700">On this account</h4>}
          {readOnly ? <ViewOnlyNote /> : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary flex-1 text-xs" onClick={() => setView('new')}><Plus size={14} /> Add a person</button>
              <button type="button" className="btn flex-1 text-xs" onClick={() => setView('link')}><Link2 size={14} /> Add from the CRM</button>
            </div>
          )}
          {people && !people.length && <p className="text-sm text-slate-400">No one on this {noun} yet.</p>}
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
                {!readOnly && <>
                <button type="button" onClick={() => makePrimary(c)} title={c.is_primary ? 'No longer the primary contact' : 'Make the primary contact'}
                  aria-label={c.is_primary ? 'No longer the primary contact' : 'Make the primary contact'} aria-pressed={c.is_primary}
                  className={`rounded p-1 hover:bg-slate-100 ${c.is_primary ? 'text-amber-500' : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-500'}`}>
                  <Star size={14} fill={c.is_primary ? 'currentColor' : 'none'} />
                </button>
                <button type="button" onClick={() => unlink(c)} title={`Take off this ${noun}`} aria-label={`Take off this ${noun}`}
                  className="rounded p-1 text-slate-300 opacity-0 group-hover:opacity-100 hover:bg-slate-100 hover:text-slate-600"><Unlink size={14} /></button>
                </>}
                {readOnly && c.is_primary && <Star size={14} className="m-1 text-amber-500" fill="currentColor" aria-label="Primary contact" />}
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
        {results && !shown.length && <li className="px-3 py-3 text-sm text-slate-400">{q ? 'No one matches.' : `Everyone in the CRM is already on this ${ticket.ticket_type === 'account' ? 'account' : 'ticket'}.`}</li>}
      </ul>
    </div>
  );
}

// ---- Process flow

const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const today = () => new Date().toLocaleDateString('en-CA');
const stepForm = (s) => ({ step_type: s.step_type, step_date: s.step_date || '', notes: s.notes, reviews: s.reviews, decision: s.decision || '', pricing: s.pricing || '' });
const DECISION_STYLE = { Proceed: 'bg-emerald-100 text-emerald-800', Revise: 'bg-amber-100 text-amber-800', 'No-Bid': 'bg-red-100 text-red-800' };

/**
 * The milestones of a pipeline ticket (RFI, RFP, gate reviews, ROM, proposal…), oldest first. Milestones can be added at
 * any time. Each records who was there and who approved, by role, a gate's decision and price considerations, notes and documents.
 * The Process view lays them out left to right with everything that happened in between.
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
  const { readOnly } = useContext(TicketAccess);

  return (
    <DrawerShell title="Milestones" subtitle="The formal steps of this pursuit: who was there, who approved, decisions and documents" onClose={onClose}>
      <div className="space-y-4">
        {readOnly ? <ViewOnlyNote /> : (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">New milestone</span>
          <div className="flex gap-2">
            <select className="input flex-1 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Milestone">
              {PROCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
            <input type="date" className="input w-36 text-sm" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Milestone date" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || milestoneOf(type).about || 'Add milestones in any order; they sort by date'}</span>
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={add} disabled={busy}>{busy ? 'Adding…' : <><Plus size={13} /> Add milestone</>}</button>
          </div>
        </section>
        )}

        {steps && !steps.length && <p className="text-sm text-slate-400">{readOnly ? 'No milestones yet.' : 'No milestones yet. Add the first one above.'}</p>}
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
  const { readOnly } = useContext(TicketAccess);
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
              {s.decision && <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${DECISION_STYLE[s.decision] || 'bg-slate-100 text-slate-700'}`}>{s.decision}</span>}
            </div>
            {!open && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                {involved.map((a) => <span key={a.key} className="rounded bg-slate-100 px-1.5 py-0.5">{a.label}</span>)}
                {s.files.length > 0 && <span className="flex items-center gap-0.5"><FileText size={11} /> {s.files.length}</span>}
                {people.length > 0 && <span className="flex -space-x-1">{people.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size="xs" className="ring-2 ring-white" />)}</span>}
                {!involved.length && !s.files.length && !s.notes && !s.pricing && <span className="text-slate-400">Nothing recorded yet</span>}
              </div>
            )}
            {!open && s.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{s.notes}</p>}
          </div>
          {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-300" />}
        </button>
        {open && (
          <fieldset disabled={readOnly} className="min-w-0">
            <ProcessStepEditor step={s} user={user} userOptions={userOptions} onDirty={onDirty} apply={apply} onDeleted={onDeleted} />
          </fieldset>
        )}
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
  // Only people who were there can have approved.
  const setPeople = (area, v) => setForm((f) => ({ ...f, reviews: { ...f.reviews, [area]: { ...f.reviews[area], people: v, approved: f.reviews[area].approved.filter((id) => v.includes(id)) } } }));
  const milestone = milestoneOf(form.step_type);

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
    if (!confirm(`Delete this ${s.step_type} milestone? Its documents stay on the ticket.`)) return;
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
          <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-type-${s.id}`}>Milestone</label>
          <select id={`ps-type-${s.id}`} className="input py-1.5 text-sm" value={form.step_type} onChange={(e) => set('step_type', e.target.value)}>
            {PROCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-date-${s.id}`}>Date</label>
          <input id={`ps-date-${s.id}`} type="date" className="input py-1.5 text-sm" value={form.step_date} onChange={(e) => set('step_date', e.target.value)} />
        </div>
      </div>
      {milestone.about && <p className="-mt-2 text-[11px] text-slate-500">{milestone.phase} · {milestone.about}</p>}

      {milestone.gate && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-decision-${s.id}`}>Decision</label>
            <select id={`ps-decision-${s.id}`} className="input py-1.5 text-sm" value={form.decision} onChange={(e) => set('decision', e.target.value)}>
              <option value="">Not decided yet</option>
              {DECISIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-pricing-${s.id}`}>Price considerations</label>
            <textarea id={`ps-pricing-${s.id}`} rows={2} className="input resize-y py-1.5 text-sm" value={form.pricing} onChange={(e) => set('pricing', e.target.value)}
              placeholder="Initial price, ROM, price-to-win, margin, B&P budget…" />
          </div>
        </div>
      )}

      <section>
        <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Users size={12} /> Who was there, and who approved</h4>
        <div className="space-y-2.5">
          {REVIEW_AREAS.map((a) => {
            const r = form.reviews[a.key];
            const expected = a.at.includes(form.step_type);
            const there = userOptions.filter((o) => r.people.includes(o.value));
            return (
              <div key={a.key} className={`rounded-md p-2.5 ${expected ? 'bg-brand-50/60 ring-1 ring-brand-100' : 'bg-slate-50'}`}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs font-semibold text-slate-700">{a.label}</span>
                  {expected && <span className="text-[10px] font-medium text-brand-700" title={a.about}>Expected at this milestone</span>}
                </div>
                <MultiSelect compact options={userOptions} value={r.people} onChange={(v) => setPeople(a.key, v)} placeholder="Who was there…" />
                {there.length > 0 && (
                  <div className="mt-1.5">
                    <MultiSelect compact options={there} value={r.approved} onChange={(v) => setReview(a.key, 'approved', v)} placeholder="Who approved…" />
                  </div>
                )}
                <textarea rows={2} className="input mt-1.5 resize-y py-1.5 text-sm" placeholder={`${a.short} notes, outcome, or people outside KIT…`}
                  value={r.notes} onChange={(e) => setReview(a.key, 'notes', e.target.value)} aria-label={`${a.label} notes`} />
              </div>
            );
          })}
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
            <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500 hover:text-red-600" onClick={remove} aria-label="Delete milestone" title="Delete milestone"><Trash2 size={13} /></button>
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
    <DrawerShell title="Strategy" subtitle="How we win this account" onClose={onClose} lockable
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
          <CrmSection organization={ticket.organization} ticketId={ticket.id} />
          <SuggestedStrategy />
        </div>
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

const OBJECTIVE_TINT = { 'Not started': 'bg-slate-100 text-slate-600', 'In progress': 'bg-sky-50 text-sky-800', Achieved: 'bg-emerald-50 text-emerald-700', Missed: 'bg-red-50 text-red-700' };

/**
 * Who we know at an organization and the account objectives there, plus anyone on `ticketId`. On a priority account (`inclusive`)
 * that's anything with the name as whole words in any field, as the CRM page's filter finds. `reloadKey` fetches again when it changes.
 */
function useCrm(organization, { ticketId, inclusive, reloadKey } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const p = new URLSearchParams();
    if (organization) p.set('organization', organization);
    if (ticketId) p.set('ticket', ticketId);
    if (inclusive) p.set('inclusive', '1');
    api.get(`/contacts/crm?${p}`).then(setData).catch((e) => setError(e.message));
  }, [organization, ticketId, inclusive, reloadKey]);
  return { data, error };
}

/** The CRM page on one tab, filtered to the organization. */
const crmLink = (tab, organization) => `/crm?${new URLSearchParams({ tab, organization })}`;

/**
 * Who we know at the organization and how well, best first. With a `ticketId`, the people on that ticket are in too, marked.
 * Read-only: people are managed in the People pane. On a priority account (`account`) this tops that pane, and its link
 * opens the CRM filtered to the account.
 */
function CrmPeople({ organization, ticketId, account, reloadKey }) {
  const { data, error } = useCrm(organization, { ticketId, inclusive: account, reloadKey });
  const people = data?.contacts || [];
  const best = people[0]?.relationship || 0;
  const known = people.filter((c) => c.relationship >= 3).length;
  return (
    <section className="space-y-2" aria-label="CRM">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        <ContactRound size={13} /> CRM
        <Link to={account ? crmLink('contacts', organization) : '/crm'} className="ml-auto text-[11px] font-medium tracking-normal text-brand-700 normal-case hover:underline">Open the CRM</Link>
      </h4>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-400">Loading…</p>}
      {data && (
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-slate-700">People{organization ? ` at ${organization}` : ''}</span>
            {people.length > 0 && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400">{people.length} known · {known} working relationship{known === 1 ? '' : 's'} or better{best >= 4 && <> · strongest <RelationshipBadge level={best} short /></>}</span>
            )}
          </div>
          {people.length ? (
            <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
              {people.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-slate-800">{contactName(c)}</span>
                      {c.is_primary && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">Primary</span>}
                      {ticketId && c.on_ticket && !c.is_primary && <span className="rounded bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600">On this ticket</span>}
                    </div>
                    <div className="truncate text-[11px] text-slate-500">
                      {[c.role, c.organization && c.organization !== organization ? c.organization : null, c.last_interaction_at ? `last ${stamp(c.last_interaction_at)}` : 'no interactions yet'].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <RelationshipBadge level={c.relationship} short />
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-slate-400">No one {organization ? `at ${organization} ` : ''}in the CRM yet.{!account && ` Add people in the People pane${ticketId ? ' on this ticket' : ''}.`}</p>}
        </div>
      )}
    </section>
  );
}

/** The open account objectives at the organization. Read-only: they're managed on the CRM page, which a priority account (`account`) links to filtered. */
export function CrmObjectives({ organization, account }) {
  const { data, error } = useCrm(organization, { inclusive: account });
  if (!data) return error ? <p className="text-xs text-red-600">{error}</p> : null;
  const objectives = data.objectives.filter((o) => !['Achieved', 'Missed'].includes(o.status));
  return (
    <section aria-label="Account objectives">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">Account objectives</span>
        <Link to={account ? crmLink('objectives', organization) : '/crm?tab=objectives'} className="text-[11px] text-brand-700 hover:underline">{objectives.length ? 'All objectives' : 'Add one'}</Link>
      </div>
      {objectives.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg bg-white ring-1 ring-slate-200">
          {objectives.map((o) => (
            <li key={o.id} className="flex items-start gap-2 px-2.5 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-slate-800">{o.objective}</div>
                <div className="text-[11px] text-slate-500">{[o.owner && fullName(o.owner), o.target_date && `by ${shortDate(o.target_date, { month: 'short', day: 'numeric', year: 'numeric' })}`].filter(Boolean).join(' · ')}</div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${OBJECTIVE_TINT[o.status]}`}>{o.status}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-slate-400">No open account objectives{organization ? ` for ${organization}` : ''}.</p>}
    </section>
  );
}

/** The CRM behind a pipeline ticket's strategy: the people, then the account objectives. */
function CrmSection({ organization, ticketId }) {
  return (
    <div className="space-y-2">
      <CrmPeople organization={organization} ticketId={ticketId} />
      <CrmObjectives organization={organization} />
    </div>
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
    <DrawerShell title="Bid and win assessment" subtitle="Do we have a real shot at winning?" onClose={onClose} lockable
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
const orgFormOf = (o) => ({
  name: o?.name ?? '', address: o?.address ?? '', labels: o?.labels ?? [], website: o?.website ?? '', linkedin: o?.linkedin ?? '',
  industry: o?.industry ?? '', annual_revenue: o?.annual_revenue ?? '', employee_count: o?.employee_count ?? '',
});
const Section = ({ title, hint, children }) => (
  <section>
    <h4 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h4>
    {hint && <p className="mb-2 text-[11px] text-slate-400">{hint}</p>}
    {children}
  </section>
);
const Row = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
    <span className="shrink-0 text-xs text-slate-500">{label}</span>
    <span className="min-w-0 text-right text-slate-800">{children ?? '—'}</span>
  </div>
);

/** One Pipedrive field as the right kind of input: a select for options, several ticks for a set, a date, a number, or text. */
function FieldInput({ field, value, onChange }) {
  const v = value ?? '';
  const options = field.options || [];
  if (field.field_type === 'enum' && options.length) {
    return (
      <select className="input" value={v} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
      </select>
    );
  }
  if (field.field_type === 'set' && options.length) {
    const chosen = String(v).split(',').map((x) => x.trim()).filter(Boolean);
    const toggle = (label) => onChange((chosen.includes(label) ? chosen.filter((x) => x !== label) : [...chosen, label]).join(', '));
    return (
      <div className="flex flex-wrap gap-1.5 py-1">
        {options.map((o) => (
          <button key={o.id} type="button" onClick={() => toggle(o.label)} aria-pressed={chosen.includes(o.label)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${chosen.includes(o.label) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:ring-slate-400'}`}>{o.label}</button>
        ))}
      </div>
    );
  }
  if (field.field_type === 'date') return <input className="input" type="date" value={v} onChange={(e) => onChange(e.target.value)} />;
  if (field.field_type === 'double' || field.field_type === 'monetary' || field.field_type === 'int') return <input className="input" type="number" step="any" value={v} onChange={(e) => onChange(e.target.value)} />;
  if (field.field_type === 'text') return <textarea className="input min-h-16 text-sm" value={v} onChange={(e) => onChange(e.target.value)} />;
  return <input className="input" value={v} onChange={(e) => onChange(e.target.value)} />;
}

/**
 * Everything on the Pipedrive deal that has no other place on the ticket (tags sit under the title; stage, value, dates, director and
 * territory at the top): the Summary and Details fields as Pipedrive lays them out (every custom field, with its options), the
 * source, the contact person and participants, the organization, products and installments. Pipedrive's fields keep their key, so
 * a change here is synced; KIT-only fields are a name and a value.
 */
function DetailsDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [org, setOrg] = useState(null);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = (d) => { setData(d); setForm(formOf(d)); setOrg(orgFormOf(d.organization || { name: ticket.organization })); };
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/details`).then(load);
    api.get('/users').then((d) => setUsers(d.users));
  }, [ticket.id]);
  const dirty = !!data && JSON.stringify(form) !== JSON.stringify(formOf(data));
  const orgDirty = !!data && JSON.stringify(org) !== JSON.stringify(orgFormOf(data.organization || { name: ticket.organization }));
  useEffect(() => { onDirty?.(dirty || orgDirty); }, [dirty, orgDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setField = (i, k, v) => setForm((f) => ({ ...f, custom_fields: f.custom_fields.map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
  /** The form's value for a Pipedrive field, and a setter that adds the field to the list when it's first filled in. */
  const pdValue = (field) => form.custom_fields.find((x) => x.key === field.key)?.value ?? '';
  const setPd = (field, v) => setForm((f) => {
    const has = f.custom_fields.some((x) => x.key === field.key);
    return { ...f, custom_fields: has ? f.custom_fields.map((x) => (x.key === field.key ? { ...x, value: v } : x)) : [...f.custom_fields, { key: field.key, name: field.name, value: v }] };
  });

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (dirty) load(await api.put(`/tickets/${ticket.id}/details`, { ...form, pipeline_id: form.pipeline_id || null }));
      if (orgDirty) load(await api.put(`/tickets/${ticket.id}/organization`, org));
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const lines = async (call) => {
    setError('');
    // Only the product or installment list changes; unsaved edits to the fields above are kept.
    try { setData(await call()); onChanged(); } catch (e) { setError(e.message); }
  };

  const userOptions = users.filter((u) => u.active !== 0).map((u) => ({ value: u.id, label: fullName(u) }));
  const lost = data?.deal_status === 'lost';
  const dealFields = data?.fields?.deal || [];
  const summaryFields = dealFields.filter((f) => f.important);
  const detailFields = dealFields.filter((f) => !f.important);
  const kitOnly = (form?.custom_fields || []).map((x, i) => ({ ...x, i })).filter((x) => !x.key);
  const orgField = (key) => (data?.fields?.organization || []).find((f) => f.key === key);
  const orgLabelOptions = (orgField('label_ids') || orgField('label'))?.options || [];
  const primary = data?.people?.find((c) => c.is_primary) || null;
  const participants = (data?.people || []).filter((c) => !c.is_primary);
  const synced = !!data?.pipedrive_id;

  const fieldBlock = (fields) => fields.map((f) => (
    <label key={f.key} className={f.field_type === 'text' || f.field_type === 'set' ? 'sm:col-span-2' : ''}>
      <span className="label">{f.name}</span>
      <FieldInput field={f} value={pdValue(f)} onChange={(v) => setPd(f, v)} />
    </label>
  ));

  return (
    <DrawerShell title="Deal details" subtitle={synced ? `Pipedrive deal #${data.pipedrive_id} · changes here sync to Pipedrive` : 'Deal fields from Pipedrive, and any others'} onClose={onClose} lockable
      footer={form && <SaveBar dirty={dirty || orgDirty} busy={busy} error={error} onSave={save} />}>
      {form ? (
        <div className="space-y-6">
          <Section title="Summary">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.pipelines.length > 1 && (
                <label className="sm:col-span-2">
                  <span className="label">Pipeline</span>
                  <select className="input" value={form.pipeline_id} onChange={set('pipeline_id')}>
                    {data.pipelines.map((p) => <option key={p.id ?? ''} value={p.id ?? ''}>{p.name}</option>)}
                  </select>
                </label>
              )}
              <div className="sm:col-span-2 rounded-lg bg-slate-50 px-3 py-1 text-sm">
                <Row label="Status">{{ open: 'Open', won: 'Won', lost: 'Lost' }[data.deal_status] || 'Open'}{data.won_at ? ` · ${stamp(data.won_at)}` : data.lost_at ? ` · ${stamp(data.lost_at)}` : ''}</Row>
                <Row label="Value">{data.value != null ? money(data.value, form.currency || data.currency) : null}</Row>
                <Row label="Expected close date">{data.projected_win_date ? shortDate(data.projected_win_date, { month: 'short', day: 'numeric', year: 'numeric' }) : null}</Row>
                <Row label="Organization">{org.name || null}</Row>
                <Row label="Contact person">{primary ? contactName(primary) : null}</Row>
              </div>
              {lost && (
                <label className="sm:col-span-2">
                  <span className="label">Lost reason</span>
                  <input className="input" list="deal-lost-reasons" value={form.lost_reason} onChange={set('lost_reason')} placeholder="e.g. No Bid, Not Selected…" />
                  <datalist id="deal-lost-reasons">{(ticket.lost_reasons || []).map((x) => <option key={x} value={x} />)}</datalist>
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
              {fieldBlock(summaryFields)}
            </div>
          </Section>

          {detailFields.length > 0 && (
            <Section title="Details" hint="Pipedrive's custom deal fields, with the choices Pipedrive offers. New fields added in Pipedrive show up here on their own.">
              <div className="grid gap-3 sm:grid-cols-2">{fieldBlock(detailFields)}</div>
            </Section>
          )}

          <Section title="Source">
            {synced ? (
              <div className="rounded-lg bg-slate-50 px-3 py-1">
                <Row label="Source origin">{data.source_origin}</Row>
                <Row label="Source origin ID">{data.source_origin_id}</Row>
                <Row label="Source channel">{data.source}</Row>
                <Row label="Source channel ID">{data.source_channel_id}</Row>
              </div>
            ) : (
              <label>
                <span className="label">Source</span>
                <input className="input" value={form.source} onChange={set('source')} placeholder="Where the deal came from" />
              </label>
            )}
          </Section>

          <Section title="Person" hint="The deal's contact person and participants. Add or change people in the People pane.">
            {primary ? <PersonCard person={primary} primary /> : <p className="text-sm text-slate-400">No contact person yet.</p>}
            {participants.length > 0 && (
              <div className="mt-2">
                <span className="text-[11px] font-medium text-slate-500">Participants</span>
                <ul className="mt-1 space-y-1.5">{participants.map((c) => <li key={c.id}><PersonCard person={c} /></li>)}</ul>
              </div>
            )}
          </Section>

          <Section title="Organization" hint={synced ? 'Pipedrive’s organization record. Changes here sync to Pipedrive.' : 'Where the deal is. Saved with the deal.'}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="label">Name</span><input className="input" value={org.name} onChange={(e) => setOrg({ ...org, name: e.target.value })} /></label>
              <label className="sm:col-span-2"><span className="label">Address</span><input className="input" value={org.address} onChange={(e) => setOrg({ ...org, address: e.target.value })} placeholder="Street, city, state" /></label>
              <div className="sm:col-span-2">
                <span className="label">Labels</span>
                <MultiSelect options={orgLabelOptions.map((o) => ({ value: o.label, label: o.label }))} value={org.labels} onChange={(v) => setOrg({ ...org, labels: v })} placeholder="Customer, Hot lead…" />
              </div>
              <label><span className="label">Website</span><input className="input" value={org.website} onChange={(e) => setOrg({ ...org, website: e.target.value })} placeholder="https://" /></label>
              <label><span className="label">LinkedIn profile</span><input className="input" value={org.linkedin} onChange={(e) => setOrg({ ...org, linkedin: e.target.value })} placeholder="https://linkedin.com/company/…" /></label>
              <label>
                <span className="label">Industry</span>
                {orgField('industry')?.options?.length ? (
                  <select className="input" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })}>
                    <option value="">—</option>
                    {orgField('industry').options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                  </select>
                ) : <input className="input" value={org.industry} onChange={(e) => setOrg({ ...org, industry: e.target.value })} />}
              </label>
              <label>
                <span className="label">Annual revenue</span>
                {orgField('annual_revenue')?.options?.length ? (
                  <select className="input" value={org.annual_revenue} onChange={(e) => setOrg({ ...org, annual_revenue: e.target.value })}>
                    <option value="">—</option>
                    {orgField('annual_revenue').options.map((o) => <option key={o.id} value={o.label}>{o.label}</option>)}
                  </select>
                ) : <input className="input" value={org.annual_revenue} onChange={(e) => setOrg({ ...org, annual_revenue: e.target.value })} />}
              </label>
              <label><span className="label">Number of employees</span><input className="input" type="number" min={0} value={org.employee_count} onChange={(e) => setOrg({ ...org, employee_count: e.target.value })} /></label>
            </div>
          </Section>

          <Section title="Followers">
            <MultiSelect options={userOptions} value={form.followers} onChange={(v) => setForm((f) => ({ ...f, followers: v }))} placeholder="Type a name…" />
          </Section>

          <Section title="Other fields" hint="KIT-only fields: a name and a value, kept in KIT.">
            <div className="space-y-1.5">
              {kitOnly.map((x) => (
                <div key={x.i} className="flex gap-1.5">
                  <input className="input w-2/5 text-sm" value={x.name} onChange={(e) => setField(x.i, 'name', e.target.value)} placeholder="Field" aria-label="Field name" />
                  <input className="input flex-1 text-sm" value={x.value} onChange={(e) => setField(x.i, 'value', e.target.value)} placeholder="Value" aria-label="Field value" />
                  <button type="button" className="btn-ghost px-1.5 text-slate-400 hover:text-red-600" aria-label="Remove field"
                    onClick={() => setForm((f) => ({ ...f, custom_fields: f.custom_fields.filter((_, j) => j !== x.i) }))}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, { name: '', value: '' }] }))}>
                <Plus size={13} /> Add a field
              </button>
            </div>
          </Section>

          <ProductsSection data={data} currency={form.currency || data.currency}
            onAdd={(p) => lines(() => api.post(`/tickets/${ticket.id}/products`, p))}
            onEdit={(p, patch) => lines(() => api.put(`/tickets/products/${p.id}`, patch))}
            onDelete={(p) => confirm(`Remove “${p.name}”?${p.pipedrive_id ? ' It’s removed from the deal in Pipedrive too.' : ''}`) && lines(() => api.del(`/tickets/products/${p.id}`))} />

          <InstallmentsSection data={data} currency={form.currency || data.currency}
            onAdd={(i) => lines(() => api.post(`/tickets/${ticket.id}/installments`, i))}
            onEdit={(i, patch) => lines(() => api.put(`/tickets/installments/${i.id}`, patch))}
            onDelete={(i) => confirm(`Remove this installment?${i.pipedrive_id ? ' It’s removed from the deal in Pipedrive too.' : ''}`) && lines(() => api.del(`/tickets/installments/${i.id}`))} />
        </div>
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

/** A person on the deal, as Pipedrive shows them: name, title, labels, work phone and email. */
function PersonCard({ person: c, primary }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-slate-800">{contactName(c)}</span>
        {primary && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">Contact person</span>}
        {(c.labels || []).map((l) => <span key={l} className="rounded-full bg-slate-100 px-2 text-[10px] font-medium text-slate-600">{l}</span>)}
      </div>
      <div className="mt-0.5 grid gap-x-4 text-xs text-slate-500 sm:grid-cols-2">
        <span>First name: <span className="text-slate-700">{c.first_name || '—'}</span></span>
        <span>Last name: <span className="text-slate-700">{c.last_name || '—'}</span></span>
        <span>Title: <span className="text-slate-700">{c.role || '—'}</span></span>
        <span>Organization: <span className="text-slate-700">{c.organization || '—'}</span></span>
        <span>Phone (work): {c.phone ? <a href={`tel:${c.phone}`} className="text-brand-700 hover:underline">{c.phone}</a> : '—'}</span>
        <span>Email (work): {c.email ? <a href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : '—'}</span>
      </div>
    </div>
  );
}

/** Products on the deal, each saved as it's added, changed or removed (apart from the fields above). */
function ProductsSection({ data, currency, onAdd, onEdit, onDelete }) {
  const blank = { name: '', quantity: '1', item_price: '', discount: '' };
  const [p, setP] = useState(blank);
  const [editing, setEditing] = useState(null); // a product id, with its draft
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  const add = async () => { if (p.name.trim()) { await onAdd(p); setP(blank); } };
  const total = data.products.reduce((s, x) => s + lineTotal(x), 0);
  const billing = (x) => (x.billing_frequency && x.billing_frequency !== 'one-time' ? ` · ${x.billing_frequency}${x.billing_frequency_cycles ? ` × ${x.billing_frequency_cycles}` : ''}${x.billing_start_date ? ` from ${x.billing_start_date}` : ''}` : '');
  return (
    <Section title="Products" hint="What's being sold on this deal, as in Pipedrive. Saved as soon as you add, change or remove one.">
      {data.products.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {data.products.map((x) => (
            <li key={x.id} className="group px-3 py-2 text-sm">
              {editing?.id === x.id ? (
                <div className="grid grid-cols-[1fr_4rem_6rem_4rem_4rem_auto_auto] items-center gap-1.5">
                  <input className="input text-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Product name" />
                  <input className="input text-sm" type="number" min={0} value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} aria-label="Quantity" />
                  <input className="input text-sm" type="number" min={0} value={editing.item_price} onChange={(e) => setEditing({ ...editing, item_price: e.target.value })} aria-label="Item price" />
                  <input className="input text-sm" type="number" min={0} max={100} value={editing.discount} onChange={(e) => setEditing({ ...editing, discount: e.target.value })} aria-label="Discount percent" title="% off" />
                  <input className="input text-sm" type="number" min={0} value={editing.tax} onChange={(e) => setEditing({ ...editing, tax: e.target.value })} aria-label="Tax percent" title="Tax %" />
                  <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={async () => { await onEdit(x, editing); setEditing(null); }}>Save</button>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing({ id: x.id, name: x.name, quantity: x.quantity, item_price: x.item_price, discount: x.discount, tax: x.tax ?? 0, comments: x.comments ?? '' })} title="Edit">
                    <div className="font-medium text-slate-800">{x.name}{x.is_enabled === 0 && <span className="ml-1.5 text-[10px] font-normal text-slate-400">disabled</span>}</div>
                    <div className="text-[11px] text-slate-500">
                      {x.quantity} × {money(x.item_price, currency)}{x.discount ? ` · ${x.discount}% off` : ''}{x.tax ? ` · ${x.tax}% tax` : ''}{billing(x)}{x.comments ? ` · ${x.comments}` : ''}
                    </div>
                  </button>
                  <span className="shrink-0 tabular-nums text-slate-700">{money(x.sum ?? lineTotal(x), currency)}</span>
                  <button type="button" onClick={() => onDelete(x)} aria-label={`Remove ${x.name}`} className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )}
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
    </Section>
  );
}

/** The deal's installments: Pipedrive's payment schedule (how much is due, and when). */
function InstallmentsSection({ data, currency, onAdd, onEdit, onDelete }) {
  const blank = { description: '', amount: '', billing_date: '' };
  const [i, setI] = useState(blank);
  const [editing, setEditing] = useState(null);
  const set = (k) => (e) => setI((x) => ({ ...x, [k]: e.target.value }));
  const add = async () => { if (i.amount && i.billing_date) { await onAdd(i); setI(blank); } };
  const total = data.installments.reduce((s, x) => s + (x.amount || 0), 0);
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <Section title="Installments" hint="The payment schedule on the deal, as in Pipedrive: each amount and the date it's due. Past dates are shown as due.">
      {data.installments.length > 0 && (
        <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {data.installments.map((x) => (
            <li key={x.id} className="group px-3 py-2 text-sm">
              {editing?.id === x.id ? (
                <div className="grid grid-cols-[1fr_7rem_9rem_auto_auto] items-center gap-1.5">
                  <input className="input text-sm" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} aria-label="Description" />
                  <input className="input text-sm" type="number" min={0} step="0.01" value={editing.amount} onChange={(e) => setEditing({ ...editing, amount: e.target.value })} aria-label="Amount" />
                  <input className="input text-sm" type="date" value={editing.billing_date} onChange={(e) => setEditing({ ...editing, billing_date: e.target.value })} aria-label="Billing date" />
                  <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={async () => { await onEdit(x, editing); setEditing(null); }}>Save</button>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing({ id: x.id, description: x.description ?? '', amount: x.amount, billing_date: x.billing_date ?? '' })} title="Edit">
                    <div className="font-medium text-slate-800">{x.description || 'Installment'}</div>
                    <div className="text-[11px] text-slate-500">{x.billing_date ? `${shortDate(x.billing_date, { month: 'short', day: 'numeric', year: 'numeric' })}${x.billing_date <= today ? ' · due' : ' · scheduled'}` : 'No date'}</div>
                  </button>
                  <span className="shrink-0 tabular-nums text-slate-700">{money(x.amount, currency)}</span>
                  <button type="button" onClick={() => onDelete(x)} aria-label="Remove installment" className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
              )}
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 text-xs font-semibold text-slate-700"><span>Total</span><span className="tabular-nums">{money(total, currency)}</span></li>
        </ul>
      )}
      <div className="grid grid-cols-[1fr_7rem_9rem_auto] gap-1.5">
        <input className="input text-sm" value={i.description} onChange={set('description')} placeholder="Description" aria-label="Description" onKeyDown={(e) => e.key === 'Enter' && add()} />
        <input className="input text-sm" type="number" min={0} step="0.01" value={i.amount} onChange={set('amount')} placeholder="Amount" aria-label="Amount" />
        <input className="input text-sm" type="date" value={i.billing_date} onChange={set('billing_date')} aria-label="Billing date" />
        <button type="button" className="btn-primary px-2" onClick={add} disabled={!i.amount || !i.billing_date} aria-label="Add installment"><Plus size={15} /></button>
      </div>
    </Section>
  );
}
