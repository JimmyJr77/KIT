import { createContext, Fragment, useContext, useEffect, useRef, useState } from 'react';
import { tagName, useTagName } from '../components/Labels.jsx';
import { Link } from 'react-router-dom';
import { X, Plus, Trash2, Loader2, Check, Eye, ChessPawn, Scale, Sparkles, PenLine, ContactRound, ArrowLeft, Search, Link2, Unlink, Flag, Workflow, Upload, FileText, Download, ChevronDown, ChevronRight, Users, ClipboardList, Star, CalendarCheck, Ticket, Megaphone, RotateCcw } from 'lucide-react';
import { useAuth } from '../lib/auth.jsx';
import Avatar from '../components/Avatar.jsx';
import { api } from '../lib/api.js';
import { stamp, fullStamp, fullName, shortDate } from '../lib/format.js';
import { ContactForm, ContactDetail, RelationshipBadge, contactName, contactLine } from './ContactEditor.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import { PROCESS_TYPES, REVIEW_AREAS, DECISIONS, CRITICALITY, DEFAULT_CRITICALITY, SA_FIELD, REQUEST_FIELD, QUAL_FIELD, SHARED_FIELDS, QUALIFICATION, QUAL_SCORES, STAFF_PICKS, canOverrideGate,
  defaultCriticality, criticalityOf, milestoneOf } from '../lib/process.js';
import { SaChecks, SaFiles, SaAttach, SaApprovedNote, NEEDS_ARCHITECT } from '../components/SaResponse.jsx';
import { ActivitiesDrawer } from './TicketActivities.jsx';
import { MarketingDrawer } from './TicketMarketing.jsx';
import { kitFieldLabel } from '../lib/dealFields.js';
import { CRITERIA, SCORE_LABELS, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin, weightShares } from '../lib/assessment.js';

/**
 * The menu items along the ticket pane's left edge. Strategy and the win assessment are for pipeline tickets only; Marketing
 * (requests, lead source, dollars) is on pipeline and work tickets. Priority
 * accounts share the `account` ones, under `accountLabel` if they have one; their priority tickets (`accountOnly`) are theirs alone.
 */
export const PLAN_TOOLS = [
  { key: 'strategy', label: 'Strategy', icon: ChessPawn, bidOnly: true, account: true },
  { key: 'activities', label: 'Activity', icon: CalendarCheck, account: true },
  { key: 'tickets', label: 'Priority tickets', icon: Ticket, account: true, accountOnly: true },
  { key: 'assessment', label: 'PWIN Assessment', icon: Scale, bidOnly: true },
  { key: 'people', label: 'People', accountLabel: 'CRM', icon: ContactRound, account: true },
  { key: 'process', label: 'Staffing events', icon: Workflow, bidOnly: true },
  { key: 'details', label: 'Deal details', icon: ClipboardList, bidOnly: true },
  { key: 'marketing', label: 'Marketing', icon: Megaphone },
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
export function PlanDrawer({ tool, ticket, onClose, onChanged, onDirty, activityId, stepId = null, staffing = false }) {
  if (tool === 'activities') return <ActivitiesDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} initialId={activityId} />;
  if (tool === 'people') return <PeopleDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
  if (tool === 'strategy') return <StrategyDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'process') return <ProcessDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} openId={stepId} staffing={staffing} />;
  if (tool === 'details') return <DetailsDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} onDirty={onDirty} />;
  if (tool === 'marketing') return <MarketingDrawer ticket={ticket} onClose={onClose} onChanged={onChanged} />;
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
const stepForm = (s) => ({ step_type: s.step_type, step_date: s.step_date || '', notes: s.notes, sa_notes: s.sa_notes || '', sa_response: s.sa_response || '', reviews: s.reviews, decision: s.decision || '', pricing: s.pricing || '',
  criticality: s.criticality || DEFAULT_CRITICALITY, fields: { ...(s.fields || {}) }, qualification: { ...(s.qualification || {}) }, done: !!s.done });
const DECISION_STYLE = { Proceed: 'bg-emerald-100 text-emerald-800', Revise: 'bg-amber-100 text-amber-800', 'No-Bid': 'bg-red-100 text-red-800' };
/** Open ones first, by due date (undated last); done ones after, latest first. */
const byDue = (a, b) => (a.done - b.done) || (a.done ? String(b.completed_at).localeCompare(String(a.completed_at))
  : ((!a.step_date) - (!b.step_date)) || String(a.step_date || '').localeCompare(String(b.step_date || '')) || a.id - b.id);

/** A due date as "Due Dec 4", reddened once it's passed while the event is open. */
export function DueDate({ date, done, className = '' }) {
  if (!date) return <span className={`text-slate-400 ${className}`}>No due date</span>;
  const late = !done && date < today();
  return <span className={`${late ? 'font-semibold text-red-600' : 'text-slate-500'} ${className}`} title={late ? 'Past due' : undefined}>Due {shortDate(date)}</span>;
}

/** A criticality pill. */
export function CriticalityPill({ value, className = '' }) {
  const c = criticalityOf(value);
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ${c.tone} ${className}`}>{c.label}</span>;
}

/**
 * The staffing events of a pipeline ticket (RFI responses, white papers, gate reviews, SOO, SOW, ROM, proposals): what the
 * pursuit is staffed for. The ticket's owner staffs it (the event is made, the ticket tagged for it, and it joins the SAC
 * list) and sets the due date and how critical it is; anyone writes the work, block by block, as text or a document.
 * `openId` opens one event; `staffing` (from the pane's Staff Ticket button) puts the new-event form forward.
 */
function ProcessDrawer({ ticket, onClose, onChanged, onDirty, openId: initialOpen = null, staffing = false }) {
  const [steps, setSteps] = useState(null);
  const [users, setUsers] = useState([]);
  const [type, setType] = useState(PROCESS_TYPES[0]);
  const [date, setDate] = useState('');
  const [criticality, setCriticality] = useState(() => defaultCriticality(ticket.pipeline_status)); // As Available from Prospecting
  const [openId, setOpenId] = useState(initialOpen);
  const [gateRule, setGateRule] = useState(''); // what makes a qualified lead, in a sentence (set in the pipeline's settings)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = useRef(false);
  const setDirty = (v) => { dirty.current = v; onDirty?.(v); };
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/process`).then((d) => { setSteps(d.steps); setGateRule(d.gate_rule || ''); }).catch((e) => setError(e.message));
    api.get('/users').then((d) => setUsers(d.users));
  }, [ticket.id]);
  // A Prospecting lead opens on its Initial Gate Review form, unless something else was asked for.
  const stage = ticket.report_stage || ticket.pipeline_status;
  useEffect(() => {
    if (!steps || initialOpen || staffing || openId || stage !== 'Prospecting') return;
    const gate = steps.find((x) => milestoneOf(x.step_type).qualifies && !x.done);
    if (gate) setOpenId(gate.id);
  }, [!!steps]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opened on one event: bring it into view.
  useEffect(() => {
    if (steps && initialOpen) document.getElementById(`staffing-${initialOpen}`)?.scrollIntoView({ block: 'start' });
  }, [!!steps]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (p) => p.then((d) => { setSteps(d.steps); onChanged(); return d; });
  const toggle = (id) => {
    if (dirty.current && !confirm('You have unsaved changes to this staffing event. Discard them?')) return;
    setDirty(false);
    setOpenId(openId === id ? null : id);
  };
  const add = async () => {
    if (busy || (dirty.current && !confirm('You have unsaved changes to a staffing event. Discard them?'))) return;
    setBusy(true);
    setError('');
    try {
      const d = await apply(api.post(`/tickets/${ticket.id}/process`, { step_type: type, step_date: date || null, criticality }));
      setDirty(false);
      setOpenId(d.id);
      setDate('');
      setCriticality(DEFAULT_CRITICALITY);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const userOptions = users.map((u) => ({ value: u.id, label: fullName(u), sub: u.team_name }));
  const byId = (id) => users.find((u) => u.id === id);
  const { readOnly } = useContext(TicketAccess);
  const sorted = steps && [...steps].sort(byDue);
  const tag = useTagName()(milestoneOf(type).tag);

  return (
    <DrawerShell title="Staffing events" onClose={onClose}
      subtitle={<><span className="block font-medium text-slate-700">{ticket.opportunity_title}</span>What this pursuit is staffed for: due dates, how critical, and the work, block by block. Open ones are on the SAC list.</>}>
      <div className="space-y-4">
        {readOnly ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
            Only the ticket’s owner (or an admin) staffs it and sets due dates and how critical. You can write the request and the work, and mark it done.
          </p>
        ) : (
        <section className={`space-y-2 rounded-lg border bg-white p-3 ${staffing ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
          <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">Staff this ticket</span>
          <select autoFocus={staffing} className="input text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Staffing event">
            {PROCESS_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-slate-600">Due date</span>
              <input type="date" className="input text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] font-medium text-slate-600">How critical</span>
              <select className="input text-sm" value={criticality} onChange={(e) => setCriticality(e.target.value)}>
                {CRITICALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || `${milestoneOf(type).about}. Tags the ticket ${tag}.`}</span>
            <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={add} disabled={busy}>{busy ? 'Staffing…' : <><Plus size={13} /> Staff ticket</>}</button>
          </div>
        </section>
        )}

        {steps && !steps.length && <p className="text-sm text-slate-400">{readOnly ? 'Not staffed for anything yet.' : 'Not staffed for anything yet. Staff it above.'}</p>}
        {sorted && sorted.length > 0 && (
          <ol className="relative space-y-3 before:absolute before:top-3 before:bottom-3 before:left-[11px] before:w-px before:bg-slate-200">
            {sorted.map((s) => (
              <ProcessStep key={s.id} step={s} open={openId === s.id} onToggle={() => toggle(s.id)} byId={byId} userOptions={userOptions} users={users} gateRule={gateRule}
                onDirty={setDirty} apply={apply}
                onDeleted={() => { setDirty(false); setOpenId(null); }} />
            ))}
          </ol>
        )}
      </div>
    </DrawerShell>
  );
}

function ProcessStep({ step: s, open, onToggle, byId, userOptions, users, gateRule, onDirty, apply, onDeleted }) {
  const { user } = useAuth();
  const def = milestoneOf(s.step_type);
  const involved = REVIEW_AREAS.filter((a) => s.reviews[a.key].people.length || s.reviews[a.key].notes);
  const people = [...new Set(REVIEW_AREAS.flatMap((a) => s.reviews[a.key].people))].map(byId).filter(Boolean);
  const written = def.fields.filter(([k]) => s.fields[k] || s.files.some((f) => f.field === k)).length;
  return (
    <li id={`staffing-${s.id}`} className="relative flex scroll-mt-3 gap-3">
      <span className={`relative z-10 mt-2.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ring-4 ring-slate-50 ${s.done ? 'bg-emerald-100 text-emerald-700' : open ? 'bg-brand-600 text-white' : 'bg-brand-100 text-brand-700'}`}>
        {s.done ? <Check size={12} /> : <Workflow size={12} />}
      </span>
      <div className={`min-w-0 flex-1 rounded-lg border bg-white transition ${open ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-500'} ${s.done && !open ? 'opacity-75' : ''}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 p-2.5 text-left">
          <div className="min-w-0 flex-1">
            {def.qualifies ? (
              // The Initial Gate, folded: its decision, then when it's due, how critical and who's on it.
              <>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold text-slate-800">{s.step_type}</span>
                  <GateTag gate={s.gate} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <DueDate date={s.step_date} done={s.done} className="text-xs" />
                  {s.done ? <span className="rounded bg-emerald-100 px-1.5 py-px text-[11px] font-semibold text-emerald-800">Done</span> : <CriticalityPill value={s.criticality} />}
                  {s.files.length > 0 && <span className="flex items-center gap-0.5 text-[11px] text-slate-500"><FileText size={11} /> {s.files.length}</span>}
                  {people.length > 0 && <span className="flex -space-x-1">{people.map((u) => <Avatar key={u.id} user={u} size="xs" className="ring-2 ring-white" />)}</span>}
                </div>
              </>
            ) : (
              <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-slate-800">{s.step_type}</span>
                <DueDate date={s.step_date} done={s.done} className="text-xs" />
                {s.done ? <span className="rounded bg-emerald-100 px-1.5 py-px text-[11px] font-semibold text-emerald-800">Done</span> : <CriticalityPill value={s.criticality} />}
                {s.decision && !def.qualifies && <span className={`rounded px-1.5 py-px text-[11px] font-semibold ${DECISION_STYLE[s.decision] || 'bg-slate-100 text-slate-700'}`}>{s.decision}</span>}
                <GateTag gate={s.gate} />
              </div>
              {!open && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                  {def.fields.length > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5">{written} of {def.fields.length} blocks written</span>}
                  {involved.map((a) => <span key={a.key} className="rounded bg-slate-100 px-1.5 py-0.5">{a.short}</span>)}
                  {s.files.length > 0 && <span className="flex items-center gap-0.5"><FileText size={11} /> {s.files.length}</span>}
                  {people.length > 0 && <span className="flex -space-x-1">{people.slice(0, 5).map((u) => <Avatar key={u.id} user={u} size="xs" className="ring-2 ring-white" />)}</span>}
                </div>
              )}
              {!open && s.notes && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{s.notes}</p>}
              </>
            )}
          </div>
          {open ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-300" />}
        </button>
        {open && <ProcessStepEditor step={s} user={user} userOptions={userOptions} users={users} gateRule={gateRule} onDirty={onDirty} apply={apply} onDeleted={onDeleted} />}
      </div>
    </li>
  );
}

/** One block of an event's work: a big area to write in, and the documents that answer it. */
function WorkBlock({ id, label, hint, value, onChange, files, onUpload, placeholder, rows = 6, children }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try { await onUpload(file); } finally { setUploading(false); if (ref.current) ref.current.value = ''; }
  };
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-slate-700" htmlFor={id} title={hint}>{label}</label>
        {onUpload && (
          <label className={`btn cursor-pointer px-2 py-0.5 text-[11px] ${uploading ? 'pointer-events-none opacity-60' : ''}`} title={`Answer “${label}” with a document`}>
            {uploading ? <><Loader2 size={11} className="animate-spin" /> Uploading…</> : <><Upload size={11} /> Document</>}
            <input ref={ref} type="file" className="sr-only" onChange={(e) => upload(e.target.files[0])} />
          </label>
        )}
      </div>
      <textarea id={id} rows={rows} className="input min-h-28 resize-y bg-white text-sm leading-relaxed" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {files?.length > 0 && <FileList files={files} className="mt-1.5" />}
      {children}
    </section>
  );
}

function FileList({ files, className = '' }) {
  return (
    <ul className={`space-y-1 ${className}`}>
      {files.map((f) => (
        <li key={f.id}>
          <a href={`/api/tickets/files/${f.id}`} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm hover:border-brand-500" title={`Uploaded ${fullStamp(f.created_at)}${f.uploaded_by ? ` by ${fullName(f.uploaded_by)}` : ''}`}>
            <FileText size={14} className="shrink-0 text-emerald-600" />
            <span className="min-w-0 flex-1 truncate">{f.name}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{bytes(f.size)}</span>
            <Download size={13} className="shrink-0 text-slate-400" />
          </a>
        </li>
      ))}
    </ul>
  );
}

const GATE_TONE = { draft: 'bg-slate-200 text-slate-700', failure: 'bg-red-600 text-white', review: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300', denied: 'bg-red-600 text-white', approved: 'bg-emerald-600 text-white' };
const GATE_ABOUT = {
  draft: 'Being filled in. Submit it at the foot of the form to send it to the SAC list.',
  failure: 'Submitted with a criterion not met.',
  review: 'Submitted and the criteria are met: waiting on the solution architect’s approval.',
  denied: 'Not qualified: the Technical Fit was denied.',
  approved: 'Qualified: this ticket can move into Qualified and beyond.',
};
/** Where an Initial Gate Review stands, worked out each time it's saved (or set by hand): Not submitted, Gate Failure, With SA, Denied or Approved. */
export function GateTag({ gate, className = '' }) {
  if (!gate) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[11px] font-semibold ${GATE_TONE[gate.status]} ${className}`}
      title={`${GATE_ABOUT[gate.status]}${gate.overridden ? ' This decision was set by hand by a BD lead or an Exec Ldr.' : ''}`}>
      {gate.status === 'approved' && <Check size={11} />}{(gate.status === 'failure' || gate.status === 'denied') && <X size={11} />} {gate.label}{gate.overridden ? ' (override)' : ''}
    </span>
  );
}

/**
 * One answer among a few, as a row of buttons. Pressing the one that's picked clears it. `onPoint(value | null)` says which
 * one the pointer (or keyboard focus) is on, so the row can explain it.
 */
function Choice({ options, value, onChange, label, onPoint }) {
  return (
    <span role="group" aria-label={label} className="inline-flex shrink-0 overflow-hidden rounded-md ring-1 ring-slate-300" onMouseLeave={() => onPoint?.(null)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? undefined : o.value)} title={o.title}
            onMouseEnter={() => onPoint?.(o.value)} onFocus={() => onPoint?.(o.value)} onBlur={() => onPoint?.(null)}
            className={`min-w-8 border-l border-slate-300 px-2 py-1 text-xs font-semibold first:border-l-0 ${on ? (o.tone || 'bg-brand-600 text-white') : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{o.label}</button>
        );
      })}
    </span>
  );
}
const YES_NO = [{ value: 'yes', label: 'Yes', tone: 'bg-emerald-600 text-white' }, { value: 'no', label: 'No', tone: 'bg-red-600 text-white' }];

/**
 * The qualification checklist of an Initial Gate Review: three yes / no gates, three tests scored 1 to 5, and the links and
 * documents behind the answers. `onAnswer(key, value)` sets one (undefined clears it). The answers save with the event; links and documents save straight away.
 */
function Qualification({ id, value, onAnswer, rule, files, canRemove, onRemove, onLink, onUpload }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-2.5" aria-labelledby={`${id}-title`}>
      <div id={`${id}-title`} className="text-xs font-semibold text-slate-700">Qualification</div>
      <p className="mt-0.5 text-[11px] text-slate-500">{rule}</p>
      <ol className="mt-2 divide-y divide-slate-100">
        {QUALIFICATION.map((q) => <QualificationTest key={q.key} test={q} value={value[q.key]} onChange={(v) => onAnswer(q.key, v)} />)}
      </ol>
      <SaFiles files={files} className="mt-1" canRemove={canRemove} onRemove={onRemove} />
      <SaAttach className="mt-1.5" onLink={onLink} onUpload={onUpload} />
    </section>
  );
}

/** One test of the checklist. Pointing at a score swaps the line under its name for what that score means, in blue. */
function QualificationTest({ test: q, value, onChange }) {
  const [pointed, setPointed] = useState(null);
  const meaning = q.scale?.[pointed];
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{q.n}. {q.label}</div>
        {meaning
          ? <p className="mt-0.5 text-[11px] leading-snug font-medium text-blue-600" aria-live="polite"><span className="font-bold">{pointed}:</span> {meaning}</p>
          : <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{q.hint}</p>}
      </div>
      {q.kind === 'gate'
        ? <Choice options={YES_NO} value={value} onChange={onChange} label={`${q.label}: yes or no`} />
        : <Choice options={QUAL_SCORES.map((n) => ({ value: n, label: String(n), title: q.scale?.[n] }))} value={value} onChange={onChange} onPoint={setPointed} label={`${q.label}: score from 1 to 5`} />}
    </li>
  );
}

/**
 * A staffing event open for editing. What it is, when it's due, how critical and a gate's decision are the ticket owner's
 * (or an admin's); the request, the blocks of work, who was there and done are anyone's, so solution architects answer here.
 */
function ProcessStepEditor({ step: s, user, userOptions, users, gateRule, onDirty, apply, onDeleted }) {
  const { readOnly } = useContext(TicketAccess);
  const [form, setForm] = useState(() => stepForm(s));
  const [saved, setSaved] = useState(() => JSON.stringify(stepForm(s)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPeople, setShowPeople] = useState(() => REVIEW_AREAS.some((a) => s.reviews[a.key].people.length || s.reviews[a.key].notes));
  const [showNotes, setShowNotes] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  useEffect(() => { onDirty(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setField = (k, v) => setForm((f) => ({ ...f, fields: { ...f.fields, [k]: v } }));
  // An answer on the qualification checklist; undefined clears it.
  const setAnswer = (k, v) => setForm((f) => { const { [k]: _, ...rest } = f.qualification; return { ...f, qualification: v === undefined ? rest : { ...rest, [k]: v } }; });
  const setReview = (area, k, v) => setForm((f) => ({ ...f, reviews: { ...f.reviews, [area]: { ...f.reviews[area], [k]: v } } }));
  // Only people who were there can have approved.
  // On an Initial Gate Review the Technical Fit is approved on a named architect's behalf: with none left, the approval goes.
  const setPeople = (area, v) => setForm((f) => ({
    ...f,
    sa_response: area === 'technical' && !v.length && f.sa_response === 'approve' && milestoneOf(f.step_type).qualifies ? '' : f.sa_response,
    reviews: { ...f.reviews, [area]: { ...f.reviews[area], people: v, approved: f.reviews[area].approved.filter((id) => v.includes(id)) } },
  }));
  const def = milestoneOf(form.step_type);
  const architects = form.reviews.technical.people.map((id) => users.find((u) => u.id === id)).filter(Boolean); // the solution architects named on it
  const mayOverride = canOverrideGate(users.find((u) => u.id === user.id)); // a BD lead or an Exec Ldr
  // An earlier milestone keeps its type in the list; new ones are staffing events only.
  const types = PROCESS_TYPES.includes(s.step_type) ? PROCESS_TYPES : [s.step_type, ...PROCESS_TYPES];

  const save = async (patch = {}) => {
    setBusy(true);
    setError('');
    try {
      const d = await apply(api.put(`/tickets/process/${s.id}`, { ...form, ...patch }));
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
    if (!confirm(`Delete this ${s.step_type} staffing event? Its documents stay on the ticket.`)) return;
    try { await apply(api.del(`/tickets/process/${s.id}`)); onDeleted(); } catch (e) { setError(e.message); }
  };
  const upload = async (file, field = null) => {
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try { await apply(api.post(`/tickets/process/${s.id}/files${field ? `?field=${encodeURIComponent(field)}` : ''}`, fd)); } catch (e) { setError(e.message); }
  };
  // Links and documents for the Request (BD Notes), the Solution Architect Response and the qualification checklist.
  const attach = (field) => ({
    files: s.files.filter((f) => f.field === field),
    canRemove: (f) => !readOnly || f.uploaded_by?.id === user.id,
    onRemove: (f) => apply(api.del(`/tickets/process/files/${f.id}`)).catch((e) => setError(e.message)),
    onLink: (url, name) => apply(api.post(`/tickets/process/${s.id}/links`, { url, name, field })),
    onUpload: (file) => { const fd = new FormData(); fd.append('file', file); return apply(api.post(`/tickets/process/${s.id}/files?field=${field}`, fd)); },
  });
  const request = attach(REQUEST_FIELD);
  const sa = attach(SA_FIELD);
  const otherFiles = s.files.filter((f) => !f.field || (!SHARED_FIELDS.includes(f.field) && !def.fields.some(([k]) => k === f.field)));
  // Who can be picked for each of the people at the top: those the role allows, and anyone already there (so they can come off).
  const picks = (key) => users.filter((u) => STAFF_PICKS[key].can(u) || form.reviews[key].people.includes(u.id)).map((u) => ({ value: u.id, label: fullName(u), sub: u.title || u.team_name }));
  const written = def.fields.filter(([k]) => form.fields[k] || s.files.some((f) => f.field === k)).length + (def.pricing && form.pricing ? 1 : 0);
  const pricingBlock = def.pricing && (
    <WorkBlock key="pricing" id={`ps-pricing-${s.id}`} label="Price considerations" rows={3} value={form.pricing} onChange={(v) => set('pricing', v)}
      placeholder="Initial price, ROM, price-to-win, margin, B&P budget…" />
  );
  const blocks = (
    <>
      {def.fields.map(([key, label, hint]) => (
        <Fragment key={key}>
          {def.pricingBefore === key && pricingBlock}
          <WorkBlock id={`ps-f-${s.id}-${key}`} label={label} hint={hint} value={form.fields[key] || ''} onChange={(v) => setField(key, v)}
            files={s.files.filter((f) => f.field === key)} onUpload={(file) => upload(file, key)} placeholder={`${hint || 'Write it here'}. Or answer with a document.`} />
        </Fragment>
      ))}
      {!def.fields.some(([k]) => k === def.pricingBefore) && pricingBlock}
    </>
  );

  return (
    <div className="space-y-4 border-t border-slate-100 px-3 pt-3 pb-3">
      {/* Who's on it, picked by typing a name: each box offers only the people its role allows. */}
      {def.staff && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {def.staff.map((key) => (
            <div key={key}>
              <span className="mb-0.5 block text-[11px] font-medium text-slate-600">{STAFF_PICKS[key].label}</span>
              <MultiSelect compact options={picks(key)} value={form.reviews[key].people} onChange={(v) => setPeople(key, v)} placeholder={STAFF_PICKS[key].placeholder} />
            </div>
          ))}
        </div>
      )}
      {/* What it is, when it's due and how critical: the ticket owner's. */}
      <fieldset disabled={readOnly} className="min-w-0 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-type-${s.id}`}>Staffing event</label>
            <select id={`ps-type-${s.id}`} className="input py-1.5 text-sm" value={form.step_type} onChange={(e) => set('step_type', e.target.value)}>
              {types.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-date-${s.id}`}>Due date</label>
            <input id={`ps-date-${s.id}`} type="date" className="input py-1.5 text-sm" value={form.step_date} onChange={(e) => set('step_date', e.target.value)} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-crit-${s.id}`}>How critical</label>
            <select id={`ps-crit-${s.id}`} className="input py-1.5 text-sm" value={form.criticality} onChange={(e) => set('criticality', e.target.value)}>
              {CRITICALITY.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {def.about && <p className="text-[11px] text-slate-500">{def.phase} · {def.about}{def.tag ? ` · tagged ${tagName(def.tag)}` : ''}</p>}
        {def.gate && !def.qualifies && (
          <div>
            <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-decision-${s.id}`}>Gate decision</label>
            <select id={`ps-decision-${s.id}`} className="input py-1.5 text-sm" value={form.decision} onChange={(e) => set('decision', e.target.value)}>
              <option value="">Not decided yet</option>
              {DECISIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
        )}
      </fieldset>

      {/* The decision shows in the card's header. A BD lead or an Exec Ldr can set it by hand, whatever the answers come to. */}
      {def.qualifies && mayOverride && (
        <div className="flex items-center justify-end gap-1.5">
          {s.gate?.overridden && <button type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => save({ gate_override: '' })} title="Hand the decision back to the answers">Back to automatic</button>}
          <button type="button" className="btn px-2 py-1 text-xs" disabled={busy} onClick={() => save({ gate_override: s.gate?.result === 'approved' ? 'denied' : 'approved' })}
            title="BD leads and Exec Ldrs only: set the gate decision by hand, whatever the answers come to">
            Override to {s.gate?.result === 'approved' ? 'Denied' : 'Approved'}
          </button>
        </div>
      )}

      <WorkBlock id={`ps-notes-${s.id}`} label={def.requestLabel || 'Request'} rows={4} value={form.notes} onChange={(v) => set('notes', v)}
        placeholder={def.requestLabel ? 'BD’s notes on the lead: what it is, what’s needed from the solution architect, the customer’s deadline, open questions…' : "What's needed from the solution architect: the ask, the customer's deadline, open questions…"}>
        <SaFiles files={request.files} className="mt-1.5" canRemove={request.canRemove} onRemove={request.onRemove} />
        <SaAttach className="mt-1.5" onLink={request.onLink} onUpload={request.onUpload} />
      </WorkBlock>

      {/* The Solution Architect Response: the architect's notes, links and documents, then where they landed. Anyone can write it. */}
      <section className="rounded-lg border border-brand-100 bg-brand-50/40 p-2.5">
        <div className="mb-1.5 text-xs font-semibold text-slate-700">{def.saLabel || 'Solution Architect Response'}</div>
        <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`ps-sa-${s.id}`}>SA Notes</label>
        <textarea id={`ps-sa-${s.id}`} rows={4} className="input min-h-24 resize-y bg-white text-sm leading-relaxed" value={form.sa_notes} onChange={(e) => set('sa_notes', e.target.value)}
          placeholder="The solution architect's thoughts on the request. Add a link or a document below." />
        <SaFiles files={sa.files} className="mt-1.5" canRemove={sa.canRemove} onRemove={sa.onRemove} />
        <SaAttach className="mt-1.5" onLink={sa.onLink} onUpload={sa.onUpload} />
        <SaChecks className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-brand-100 pt-2" value={form.sa_response} onChange={(v) => set('sa_response', v)} about={s.step_type}
          blocked={def.qualifies && !architects.length ? { approve: NEEDS_ARCHITECT } : {}} />
        {def.qualifies && !architects.length && form.sa_response !== 'approve' && <p className="mt-1 text-[11px] text-slate-500">To approve, first pick the solution architect at the top of this form.</p>}
        {/* Whoever ticks Approve does it on the named architect's behalf; a saved approval keeps the name of who ticked it. */}
        {def.qualifies && form.sa_response === 'approve' && (
          <SaApprovedNote className="mt-1" architects={architects} by={s.sa_response === 'approve' && s.sa_response_by ? s.sa_response_by : users.find((u) => u.id === user.id) || user} />
        )}
      </section>

      {def.qualifies && <Qualification id={`ps-qual-${s.id}`} value={form.qualification} onAnswer={setAnswer} rule={gateRule} {...attach(QUAL_FIELD)} />}

      {/* The write-up: folded away under its own title on an Initial Gate Review, laid out in full on the others. */}
      {def.notesTitle ? (
        <section>
          <button type="button" onClick={() => setShowNotes(!showNotes)} aria-expanded={showNotes}
            className="flex w-full items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-xs font-semibold text-slate-700 hover:border-brand-500">
            {showNotes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{def.notesTitle}
            <span className="ml-auto font-normal text-slate-400">{written} of {def.fields.length + (def.pricing ? 1 : 0)} written</span>
          </button>
          {showNotes && <div className="mt-2 space-y-4">{blocks}</div>}
        </section>
      ) : blocks}

      {!def.staff && (
      <section>
        <button type="button" onClick={() => setShowPeople(!showPeople)} aria-expanded={showPeople}
          className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase hover:text-slate-800">
          {showPeople ? <ChevronDown size={12} /> : <ChevronRight size={12} />}<Users size={12} /> Who’s staffed, who was there, and who approved
        </button>
        {showPeople && (
        <div className="space-y-2.5">
          {REVIEW_AREAS.map((a) => {
            const r = form.reviews[a.key];
            const expected = a.at.includes(form.step_type);
            const there = userOptions.filter((o) => r.people.includes(o.value));
            return (
              <div key={a.key} className={`rounded-md p-2.5 ${expected ? 'bg-brand-50/60 ring-1 ring-brand-100' : 'bg-slate-50'}`}>
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs font-semibold text-slate-700">{a.label}</span>
                  {expected && <span className="text-[10px] font-medium text-brand-700" title={a.about}>Expected at this event</span>}
                </div>
                <MultiSelect compact options={userOptions} value={r.people} onChange={(v) => setPeople(a.key, v)} placeholder={a.key === 'technical' ? 'Solution architects staffed…' : 'Who was there…'} />
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
        )}
      </section>
      )}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Other documents</span>
          <UploadButton onUpload={(file) => upload(file)} />
        </div>
        {otherFiles.length ? <FileList files={otherFiles} /> : <p className="text-xs text-slate-400">None. Uploads also appear on the ticket timeline.</p>}
      </section>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className={`text-[11px] ${error ? 'text-red-600' : dirty ? 'text-amber-700' : 'text-slate-400'}`}>
          {error || (dirty ? 'Unsaved changes' : s.updated_at ? `Saved ${stamp(s.updated_at)}${s.updated_by ? ` by ${fullName(s.updated_by)}` : ''}` : `Added ${stamp(s.created_at)}${s.author ? ` by ${fullName(s.author)}` : ''}`)}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {!readOnly && (s.author?.id === user.id || user.role === 'admin') && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500 hover:text-red-600" onClick={remove} aria-label="Delete staffing event" title="Delete staffing event"><Trash2 size={13} /></button>
          )}
          {!s.draft && (
            <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => save({ done: !form.done })} disabled={busy}
              title={form.done ? (def.qualifies ? 'Reopen it to make changes: it has to be submitted again to go back to the SAC list' : 'Put it back on the SAC list') : 'Mark it done: it leaves the SAC list'}>
              {form.done ? <><RotateCcw size={12} /> Reopen</> : <><Check size={12} /> Done</>}
            </button>
          )}
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => save()} disabled={!dirty || busy}>
            {busy ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save'}
          </button>
          {def.qualifies && !s.draft && !s.done && (
            <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => save({ recall: true })} disabled={busy}
              title={`Take it back off the SAC list to work on it. The ${tagName('Initial Gate')} tag comes off the ticket until it’s submitted again.`}>
              <RotateCcw size={12} /> Recall from SAC
            </button>
          )}
          {s.draft && (
            <button type="button" className="btn-primary bg-emerald-600 px-3 py-1.5 text-xs hover:bg-emerald-700" onClick={() => save({ submit: true })} disabled={busy}
              title="Save it and send it to the SAC list for the solution architect’s approval. The ticket is tagged Initial Gate until then.">
              Submit to SAC
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function UploadButton({ onUpload }) {
  const [uploading, setUploading] = useState(false);
  const ref = useRef(null);
  return (
    <label className={`btn cursor-pointer px-2.5 py-1 text-xs ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
      {uploading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : <><Upload size={12} /> Upload</>}
      <input ref={ref} type="file" className="sr-only" onChange={async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploading(true);
        try { await onUpload(file); } finally { setUploading(false); if (ref.current) ref.current.value = ''; }
      }} />
    </label>
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

/**
 * A pipeline ticket's strategy: a list of obstacles, each with the strategies for getting past it. "Add a new strategy" at
 * the top opens two boxes, Obstacle and Strategy, which together start a new one; more strategies can be added to any
 * obstacle. An obstacle that's overcome is crossed off, with what came of it (Outcome), and kept underneath for context.
 * The strategies of the obstacles still open are what Close to closing shows as the ticket's status note, with the notes
 * picked for it. Each change is saved as it's made; only the ticket's owner or an admin makes them.
 */
function StrategyDrawer({ ticket, onClose, onChanged, onDirty }) {
  const [plan, setPlan] = usePlan(ticket.id);
  const { readOnly } = useContext(TicketAccess);
  const [draft, setDraft] = useState(null); // the Add a new strategy boxes, when open: { obstacle, strategy }
  const [editing, setEditing] = useState(null); // the one text being written elsewhere: 'o12' (an obstacle), 's4' (a strategy), 'add12' (a new strategy for obstacle 12), 'x12' (crossing 12 off), 'out12' (its outcome)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = !!draft && !!(draft.obstacle.trim() || draft.strategy.trim());
  useEffect(() => { onDirty?.(dirty || !!editing); }, [dirty, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change answers with the list as it now stands.
  const run = async (fn) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const r = await fn();
      setPlan((p) => ({ ...p, ...r }));
      setEditing(null);
      onChanged();
      return true;
    } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const add = async () => { if (await run(() => api.post(`/tickets/${ticket.id}/obstacles`, draft))) setDraft(null); };
  const removeObstacle = (o) => {
    const n = o.strategies.length;
    if (confirm(`Delete this obstacle${n ? ` and its ${n === 1 ? 'strategy' : `${n} strategies`}` : ''}? To keep it for context, cross it off instead.`)) run(() => api.del(`/tickets/obstacles/${o.id}`));
  };
  const obstacles = plan?.obstacles || [];
  const open = obstacles.filter((o) => !o.resolved_at);
  const done = obstacles.filter((o) => o.resolved_at);
  const box = 'input resize-y text-sm leading-relaxed';

  const strategyList = (o, muted) => (
    <ul className="space-y-1.5">
      {o.strategies.map((s) => (editing === `s${s.id}` ? (
        <li key={s.id}><InlineText initial={s.body} label="Strategy" busy={busy} onCancel={() => setEditing(null)} onSave={(body) => run(() => api.put(`/tickets/strategies/${s.id}`, { body }))} /></li>
      ) : (
        <li key={s.id} className="group flex items-start gap-2">
          <ChessPawn size={13} className={`mt-0.5 shrink-0 ${muted ? 'text-slate-300' : 'text-brand-600'}`} />
          <div className="min-w-0 flex-1">
            <p className={`text-sm break-words whitespace-pre-wrap ${muted ? 'text-slate-500' : 'text-slate-800'}`}>{s.body}</p>
            <p className="text-[11px] text-slate-400">{[s.by, stamp(s.created_at), s.updated_at && 'edited'].filter(Boolean).join(' · ')}</p>
          </div>
          {!readOnly && (
            <span className="flex shrink-0 gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setEditing(`s${s.id}`)} aria-label="Edit this strategy" title="Edit"><PenLine size={13} /></button>
              <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={busy} aria-label="Delete this strategy" title="Delete"
                onClick={() => confirm('Delete this strategy?') && run(() => api.del(`/tickets/strategies/${s.id}`))}><Trash2 size={13} /></button>
            </span>
          )}
        </li>
      )))}
      {!o.strategies.length && <li className="text-xs text-slate-400">No strategy for this yet.</li>}
    </ul>
  );

  return (
    <DrawerShell title="Strategy" subtitle="What stands in the way, and how we get past it" onClose={onClose} lockable
      footer={plan && (
        <p className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>
          {error || (plan.strategy_updated_at ? <><Check size={11} className="mr-0.5 inline" />Saved {stamp(plan.strategy_updated_at)}{plan.strategy_updated_by ? ` by ${plan.strategy_updated_by}` : ''}</> : 'Each change is saved as you make it.')}
        </p>
      )}>
      {plan ? (
        <div className="space-y-5">
          {!readOnly && !draft && (
            <button type="button" className="btn-primary w-full justify-center" onClick={() => { setDraft({ obstacle: '', strategy: '' }); setEditing(null); }}>
              <Plus size={15} /> Add a new strategy
            </button>
          )}
          {draft && (
            <section className="space-y-3 rounded-lg border border-brand-500 bg-white p-3 ring-2 ring-brand-100">
              <div>
                <label className="label" htmlFor="st-obstacle">Obstacle</label>
                <textarea id="st-obstacle" className={`${box} min-h-20`} value={draft.obstacle} autoFocus maxLength={4000} onChange={(e) => setDraft({ ...draft, obstacle: e.target.value })}
                  placeholder="What stands between us and the win: an incumbent, a budget gap, a missing relationship, a competing vehicle…" />
              </div>
              <div>
                <label className="label" htmlFor="st-strategy">Strategy</label>
                <textarea id="st-strategy" className={`${box} min-h-24`} value={draft.strategy} maxLength={4000} onChange={(e) => setDraft({ ...draft, strategy: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), dirty && add())}
                  placeholder="How we get past it: the win theme, who we bring in, what we do next…" />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost h-8 py-0 text-sm" onClick={() => (!dirty || confirm('Discard this strategy?')) && setDraft(null)}>Cancel</button>
                <button type="button" className="btn-primary h-8 py-0 text-sm" onClick={add} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><ChessPawn size={13} /> Open strategies <span className="font-normal text-slate-400 normal-case">· shown in the Close to closing status note</span></h4>
            {!open.length && <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400">{done.length ? 'Every obstacle is crossed off.' : readOnly ? 'No strategy yet.' : 'No strategy yet. Add the first obstacle and how we get past it.'}</p>}
            {open.map((o) => (
              <article key={o.id} className="rounded-lg border border-slate-200 bg-white">
                <header className="group flex items-start gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold tracking-wide text-slate-400 uppercase">Obstacle</div>
                    {editing === `o${o.id}`
                      ? <InlineText initial={o.body} label="Obstacle" busy={busy} onCancel={() => setEditing(null)} onSave={(body) => run(() => api.put(`/tickets/obstacles/${o.id}`, { body }))} />
                      : o.body ? <p className="text-sm font-medium break-words whitespace-pre-wrap text-slate-900">{o.body}</p>
                        : <p className="text-sm text-slate-400 italic">No obstacle named</p>}
                  </div>
                  {!readOnly && editing !== `o${o.id}` && (
                    <span className="flex shrink-0 items-center gap-0.5">
                      <button type="button" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" onClick={() => setEditing(`o${o.id}`)} aria-label="Edit this obstacle" title={o.body ? 'Edit' : 'Name the obstacle'}><PenLine size={13} /></button>
                      <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={busy} onClick={() => removeObstacle(o)} aria-label="Delete this obstacle" title="Delete"><Trash2 size={13} /></button>
                      <button type="button" className="ml-1 inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100" onClick={() => setEditing(`x${o.id}`)}
                        title="Overcome: cross it off. It’s kept underneath for context."><Check size={12} /> Cross off</button>
                    </span>
                  )}
                </header>
                <div className="space-y-2.5 px-3 py-2.5">
                  {strategyList(o, false)}
                  {editing === `add${o.id}` && <InlineText initial="" label="New strategy" placeholder="Another way past this obstacle…" busy={busy} onCancel={() => setEditing(null)} onSave={(body) => run(() => api.post(`/tickets/obstacles/${o.id}/strategies`, { body }))} />}
                  {!readOnly && editing !== `add${o.id}` && editing !== `x${o.id}` && (
                    <button type="button" className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline" onClick={() => setEditing(`add${o.id}`)}><Plus size={12} /> Add a strategy</button>
                  )}
                  {editing === `x${o.id}` && (
                    <div className="space-y-1 rounded-md bg-emerald-50/60 p-2">
                      <div className="text-[11px] font-semibold text-emerald-900">Outcome <span className="font-normal text-emerald-800/70">· what came of it (you can leave this blank)</span></div>
                      <InlineText initial="" label="Outcome" placeholder="How it was overcome, and what we learned…" allowEmpty saveLabel="Cross off" busy={busy} onCancel={() => setEditing(null)}
                        onSave={(outcome) => run(() => api.put(`/tickets/obstacles/${o.id}`, { resolved: true, outcome }))} />
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>

          {done.length > 0 && (
            <section className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Check size={13} /> Overcome <span className="font-normal text-slate-400 normal-case">· kept for context</span></h4>
              {done.map((o) => (
                <article key={o.id} className="rounded-lg border border-slate-200 bg-slate-50/70">
                  <header className="flex items-start gap-2 px-3 pt-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm break-words whitespace-pre-wrap text-slate-500 line-through decoration-slate-400">{o.body || 'No obstacle named'}</p>
                      <p className="text-[11px] text-slate-400">Crossed off {[stamp(o.resolved_at), o.resolved_by && `by ${o.resolved_by}`].filter(Boolean).join(' ')}</p>
                    </div>
                    {!readOnly && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" disabled={busy} onClick={() => removeObstacle(o)} aria-label="Delete this obstacle" title="Delete"><Trash2 size={13} /></button>
                        <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-white" disabled={busy}
                          onClick={() => run(() => api.put(`/tickets/obstacles/${o.id}`, { resolved: false }))} title="It’s in the way again: open it, with its strategies"><RotateCcw size={12} /> Reopen</button>
                      </span>
                    )}
                  </header>
                  <div className="space-y-2 px-3 py-2">
                    {o.strategies.length > 0 && strategyList(o, true)}
                    {editing === `out${o.id}` ? (
                      <InlineText initial={o.outcome} label="Outcome" placeholder="How it was overcome, and what we learned…" allowEmpty busy={busy} onCancel={() => setEditing(null)}
                        onSave={(outcome) => run(() => api.put(`/tickets/obstacles/${o.id}`, { outcome }))} />
                    ) : (
                      <div className="group flex items-start gap-2 rounded-md bg-emerald-50/70 px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-semibold tracking-wide text-emerald-800 uppercase">Outcome</div>
                          {o.outcome ? <p className="text-sm break-words whitespace-pre-wrap text-slate-800">{o.outcome}</p> : <p className="text-sm text-slate-400 italic">None written</p>}
                        </div>
                        {!readOnly && <button type="button" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700" onClick={() => setEditing(`out${o.id}`)} aria-label="Edit the outcome" title={o.outcome ? 'Edit' : 'Add the outcome'}><PenLine size={13} /></button>}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </section>
          )}
          <CrmSection organization={ticket.organization} ticketId={ticket.id} />
          <SuggestedStrategy />
        </div>
      ) : <p className="text-sm text-slate-400">Loading…</p>}
    </DrawerShell>
  );
}

/** A text being written in place: ⌘/Ctrl+Enter or the button saves it, Escape or Cancel drops it. `allowEmpty` lets it be saved blank. */
function InlineText({ initial = '', label, placeholder, onSave, onCancel, busy, allowEmpty = false, saveLabel = 'Save' }) {
  const [text, setText] = useState(initial);
  const ok = allowEmpty || !!text.trim();
  const save = () => { if (ok && !busy) onSave(text.trim()); };
  return (
    <div className="space-y-1.5">
      <textarea className="input min-h-16 resize-y text-sm leading-relaxed" value={text} autoFocus aria-label={label} placeholder={placeholder} maxLength={4000} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost h-7 py-0 text-xs" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn-primary h-7 py-0 text-xs" onClick={save} disabled={!ok || busy}>{busy ? 'Saving…' : saveLabel}</button>
      </div>
    </div>
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
  const [recent, setRecent] = useState(null); // the ticket's activities and comments, newest first, for Pursuit momentum
  const [weights, setWeights] = useState(DEFAULT_PWIN_WEIGHTS);
  const [gates, setGates] = useState(DEFAULT_PWIN_GATES);
  useEffect(() => { api.get('/tickets/pwin-weights').then((d) => { setWeights(d.weights); setGates(d.gates); }); }, []);
  useEffect(() => {
    if (plan && draft === null) { setDraft(plan.assessment || {}); saved.current = JSON.stringify(plan.assessment || {}); }
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    api.get(`/tickets/${ticket.id}/timeline`).then((d) => setRecent(d.events.filter((e) => e.type === 'activity' || e.type === 'comment')
      .sort((a, b) => String(b.at).localeCompare(String(a.at))))).catch(() => setRecent([]));
  }, [ticket.id]);

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
    <DrawerShell title="PWIN Assessment" subtitle="Do we have a real shot at winning?" onClose={onClose} lockable
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
              A weighted probability of win. Rate each area 1–5: <b>1</b> we know nothing and have no access or relationships · <b>5</b> the ideal
              position. Point at a number to see what it means for that area. Ratings below 5 cost more the further they fall, and any area below 3 cuts the
              whole score (a must-have cuts it hard). Areas not yet rated count as 1. Weights and must-haves are set in BD Pipeline › Settings.
            </p>
          </section>

          {CRITERIA.map((c, n) => {
            const entry = draft[c.key] || {};
            return (
              <section key={c.key} className="@container rounded-lg border border-slate-200 bg-white p-3">
                <PwinAreaHead n={n + 1} area={c} share={shares[c.key]} value={entry.score} onChange={(v) => setScore(c.key, v)} />
                <PwinAreaDetails area={c} answers={entry.answers}>
                {c.recent && <RecentActivity events={recent} count={c.recent} />}
                <div className={c.prompts.length ? 'mt-3 space-y-2.5' : 'hidden'}>
                  {c.prompts.map((p) => (
                    <div key={p.key}>
                      <label className="mb-0.5 block text-[11px] font-medium text-slate-600" htmlFor={`a-${c.key}-${p.key}`}>{p.label}</label>
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
                </PwinAreaDetails>
              </section>
            );
          })}
        </div>
      )}
    </DrawerShell>
  );
}

/** The ticket's latest activities and comments, each with its date: the evidence for Pursuit momentum. */
function RecentActivity({ events, count }) {
  if (!events) return <p className="mt-3 text-xs text-slate-400">Loading…</p>;
  if (!events.length) return <p className="mt-3 text-xs text-slate-400">No activities or comments on this ticket yet.</p>;
  return (
    <div className="mt-3">
      <span className="mb-1 block text-[11px] font-medium text-slate-600">Last {Math.min(count, events.length)} activities and comments</span>
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {events.slice(0, count).map((e) => {
          const a = e.activity;
          const m = e.comment;
          return (
            <li key={`${e.type}-${a?.id ?? m?.id}`} className="flex items-start gap-2 px-2.5 py-1.5 text-xs">
              <span className="w-20 shrink-0 text-slate-500 tabular-nums" title={fullStamp(e.at)}>{parseDay(e.at)}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-slate-700">{a ? a.activity_type : m.kind === 'note' ? 'Note' : 'Comment'}</span>
                <span className="text-slate-400">{e.author ? ` · ${fullName(e.author)}` : ''}{a?.done ? ' · done' : ''}</span>
                <span className="line-clamp-2 break-words text-slate-600">{a ? a.subject : m.body}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
const parseDay = (at) => new Date(`${String(at).replace(' ', 'T')}Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Five buttons, 1–5. Clicking the selected score clears it. */
/**
 * The top of one PWIN area: its title with its share of the score, then the line that says what it covers, then the 1 to 5
 * rating. Pointing at a rating (or tabbing to it) swaps that line for what the rating means for this area, in blue, as the
 * Initial Gate Review's checklist does.
 */
function PwinAreaHead({ n, area: c, share, value, onChange }) {
  const [pointed, setPointed] = useState(null);
  const meaning = c.scale?.[pointed];
  // In a pane wide enough (its section is the container), the rating sits to the right of the title and its line.
  return (
    <div className="flex flex-col gap-1.5 @md:flex-row @md:items-start @md:justify-between @md:gap-4">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-slate-800">
          {n}. {c.title} <span className="font-medium text-slate-500 tabular-nums" title="This area’s share of the PWIN score">· {Math.round(share)}%</span>
        </h4>
        {meaning
          ? <p className="mt-0.5 min-h-8 text-[11px] leading-snug font-medium text-blue-600" aria-live="polite"><span className="font-bold">{pointed}:</span> {meaning}</p>
          : <p className="mt-0.5 min-h-8 text-[11px] leading-snug text-slate-500">{c.blurb}</p>}
      </div>
      <ScorePicker value={value} onChange={onChange} onPoint={setPointed} label={`${c.title}: rating from 1 to 5`} titles={c.scale} />
    </div>
  );
}

/**
 * What's written under a PWIN area's rating (its prompts, or the recent activity for Pursuit momentum), behind a line that
 * opens and closes it. It starts closed, unless something is already written there.
 */
function PwinAreaDetails({ area: c, answers, children }) {
  const filled = c.prompts.filter((p) => String(answers?.[p.key] ?? '').trim()).length;
  const [open, setOpen] = useState(filled > 0);
  const what = c.prompts.length ? 'Notes and evidence' : 'Recent activity';
  return (
    <div className="mt-2 border-t border-slate-100 pt-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1 text-left text-[11px] font-medium text-slate-500 hover:text-slate-800">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {what}
        {c.prompts.length > 0 && <span className="font-normal text-slate-400">· {filled} of {c.prompts.length} filled in</span>}
      </button>
      {open && children}
    </div>
  );
}

/** A 1 to 5 rating. `onPoint(n | null)` says which number the pointer or keyboard focus is on. */
function ScorePicker({ value, onChange, onPoint, label = 'Score', titles = SCORE_LABELS }) {
  return (
    <div className="flex shrink-0 gap-1" role="radiogroup" aria-label={label} onMouseLeave={() => onPoint?.(null)}>
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} type="button" role="radio" aria-checked={value === s} onClick={() => onChange(s)} title={`${s}: ${titles?.[s] || SCORE_LABELS[s]}`}
          onMouseEnter={() => onPoint?.(s)} onFocus={() => onPoint?.(s)} onBlur={() => onPoint?.(null)}
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
      <span className="label">{kitFieldLabel(f.name)}</span>
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
                <Row label="Status">{{ open: 'Open', won: 'Paid', lost: 'Lost' }[data.deal_status] || 'Open'}{data.won_at ? ` · ${stamp(data.won_at)}` : data.lost_at ? ` · ${stamp(data.lost_at)}` : ''}</Row>
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
                {synced && data.probability_synced === false && <span className="mt-1 block text-xs text-slate-500">Stays in KIT: Pipedrive has deal probability turned off for this pipeline.</span>}
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
              <input className="input" value={form.source} onChange={set('source')} placeholder="Where the deal came from" aria-label="Source" />
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
