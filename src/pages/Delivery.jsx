import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, BriefcaseBusiness, Ticket, Trash2, UserPlus, AlertTriangle, Landmark, ReceiptText, Plus, MapPin, LayoutGrid, Table2, ChevronUp, ChevronDown, ChevronsUpDown, Upload, FileText, Loader2, FolderKanban, CheckSquare, Square, Pin, StickyNote, ExternalLink, CalendarCheck, CheckCircle2, RefreshCw, Pencil, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, shortDate, parseUtc, todayIso } from '../lib/format.js';
import { CONTRACT_DOC_TYPES, ADDITIONAL_DOCS } from '../lib/process.js';
import { useAuth } from '../lib/auth.jsx';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import UserCombobox from '../components/UserCombobox.jsx';
import MultiSelect from '../components/MultiSelect.jsx';

const money = (n) => usd(n).replace('.00', '');
const wonOn = (utc) => (utc ? shortDate(parseUtc(utc).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric', year: 'numeric' }) : '');

const STATUS_STYLE = { Active: 'bg-emerald-50 text-emerald-700', Complete: 'bg-slate-100 text-slate-600', Canceled: 'bg-red-50 text-red-700' };
const PROJECT_STATUS = { open: 'Open', completed: 'Completed', canceled: 'Canceled', deleted: 'Deleted in Pipedrive' };

/** Contracts we've won. A pipeline ticket is copied here when it's marked won, to get a Program Manager, a delivery team and its Pipedrive project. */
export default function Delivery() {
  const users = useApi('/users');
  const teams = useApi('/teams');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [programs, setPrograms] = useState(null);
  const [openId, setOpenId] = useState(null);
  // Tickets (cards) or a table; the choice is remembered on this browser.
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('kit.delivery.view') || 'cards'; } catch { return 'cards'; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('kit.delivery.view', v); } catch { /* not saved */ } };

  const [held, setHeld] = useState(0);
  const [meta, setMeta] = useState({ phases: [], project_labels: [], activity_types: [] });
  const load = () => api.get(`/delivery?status=${status}`).then((d) => { setPrograms(d.programs); setHeld(d.held); setMeta({ phases: d.phases, project_labels: d.project_labels, activity_types: d.activity_types }); });
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Links from alerts land here with ?open=<program id>; show every status so the contract is found.
  const [params, setParams] = useSearchParams();
  // A won ticket links here with ?ticket=<ticket id>; the contract is found once the list has loaded.
  const [ticketWanted, setTicketWanted] = useState(null);
  useEffect(() => {
    const id = Number(params.get('open'));
    const ticket = Number(params.get('ticket'));
    if (!id && !ticket) return;
    setStatus('all');
    if (id) setOpenId(id); else setTicketWanted(ticket);
    setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ticketWanted || !programs) return;
    const p = programs.find((x) => x.ticket_id === ticketWanted);
    if (p) { setOpenId(p.id); setTicketWanted(null); }
  }, [ticketWanted, programs]);

  const shown = (programs || []).filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || [p.name, p.organization, p.account_type, fullName(p.program_manager), fullName(p.technical_lead), ...p.team.map((m) => m.name)].filter(Boolean).join(' ').toLowerCase().includes(s);
  });
  const open = programs?.find((p) => p.id === openId);
  const replace = (p) => setPrograms((xs) => xs.map((x) => (x.id === p.id ? p : x)));

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Delivery" subtitle="Contracts we’ve won. Each one lands here when its deal is marked won, with its Pipedrive project as the plan.">
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['active', 'Active'], ['complete', 'Complete'], ['canceled', 'Canceled'], ['held', `On hold${held ? ` (${held})` : ''}`], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className={`rounded px-3 ${status === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by contract, customer, or person…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="radiogroup" aria-label="View">
          {[['cards', 'Tickets', LayoutGrid], ['table', 'Table', Table2]].map(([k, l, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} title={l}
              className={`flex items-center gap-1.5 rounded px-2.5 ${view === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon size={15} /> {l}
            </button>
          ))}
        </div>
      </div>

      {status === 'held' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Contracts with information on them whose deal is no longer won. They’re saved as they were, but left out of bookings, backlog and revenue until an admin decides. If the deal is won again, the contract comes back on its own.
        </p>
      )}

      {programs && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <BriefcaseBusiness size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'Nothing matches your search.' : status === 'held' ? 'No contracts on hold.' : status === 'complete' ? 'No completed contracts yet.' : status === 'canceled' ? 'No canceled contracts.' : 'No won contracts yet. Mark a pipeline ticket won (on its ticket, or on BD Pipeline) and it shows up here.'}
        </div>
      )}

      {view === 'table' && shown.length > 0 && <ProgramTable programs={shown} openId={openId} onOpen={setOpenId} />}

      {view === 'cards' && <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
        {shown.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpenId(p.id)}
            className={`flex flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md ${openId === p.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold leading-snug text-slate-900">{p.name}</div>
                <div className="truncate text-xs text-slate-500">{[p.organization, p.account_type].filter(Boolean).join(' · ') || 'Customer not set'}</div>
              </div>
              {p.held_at ? <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">On hold · {p.deal_status === 'won' ? p.ticket_stage : 'not won'}</span>
                : p.status !== 'Active' ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  : p.project.phase && <span className="shrink-0 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title="Pipedrive project phase">{p.project.phase}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {p.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">{money(p.value)}</span>}
              <span className="text-slate-400">{p.held_at ? `Not won · ${p.ticket_stage || 'no stage'}` : `Won ${wonOn(p.awarded_at)}`}</span>
            </div>
            {p.value > 0 && <FundedBar program={p} />}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
              {p.program_manager ? (
                <span className="flex items-center gap-1.5 text-slate-700"><Avatar user={p.program_manager} size="xs" /> <span><span className="text-slate-400">PM</span> {fullName(p.program_manager)}</span></span>
              ) : (
                <span className="flex items-center gap-1 font-medium text-amber-700"><AlertTriangle size={12} /> Needs a Program Manager</span>
              )}
              <span className="flex items-center gap-1.5 text-slate-500">
                {p.tasks.length > 0 && <span className="flex items-center gap-0.5" title="Plan: tasks done"><CheckSquare size={11} /> {p.tasks.filter((k) => k.done).length}/{p.tasks.length}</span>}
                {p.team.length > 0 && <span className="flex -space-x-1.5">{p.team.slice(0, 4).map((m) => <Avatar key={m.id} user={m.user || { id: m.id, first_name: m.name, last_name: '' }} size="xs" className="ring-2 ring-white" />)}</span>}
                {p.team.length} on team
              </span>
            </div>
          </button>
        ))}
      </div>}

      {open && (
        <ProgramPanel key={open.id} program={open} users={users.data?.users || []} teams={teams.data?.teams || []} meta={meta}
          onChange={replace} onClose={() => { setOpenId(null); load(); }} onDecided={(p) => {
            if (p && status !== 'held') replace(p);
            else setOpenId(null);
            load();
          }} />
      )}
    </div>
  );
}

/** One won contract: its Pipedrive project (overview, plan, notes, documents), Program Manager, Technical Lead, delivery team and money. Changes save as they're made. */
function ProgramPanel({ program: p, users, teams, meta, onChange, onClose, onDecided }) {
  const [error, setError] = useState('');
  const [notes, setNotes] = useState(p.notes || '');
  const [member, setMember] = useState({ user_id: null, name: '', role: '' });
  const [busy, setBusy] = useState(false);

  const update = async (body) => {
    setError('');
    try { onChange((await api.put(`/delivery/${p.id}`, body)).program); } catch (e) { setError(e.message); }
  };
  const addMember = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/delivery/${p.id}/team`, member.user_id ? { user_id: member.user_id, role: member.role } : { name: member.name, role: member.role });
      onChange(r.program);
      setMember({ user_id: null, name: '', role: '' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const removeMember = async (m) => {
    if (!confirm(`Take ${m.name} off the delivery team?`)) return;
    onChange((await api.del(`/delivery/team/${m.id}`)).program);
  };
  const notesDirty = notes !== (p.notes || '');

  return (
    <SidePanel wide title={p.name} onClose={() => { if (!notesDirty || confirm('Discard your unsaved overview?')) onClose(); }}
      subtitle={[p.organization, p.value != null ? money(p.value) : null, `Won ${wonOn(p.awarded_at)}`].filter(Boolean).join(' · ')}>
      <div className="space-y-5">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {p.held_at && <HoldDecision program={p} onDecided={onDecided} onError={setError} />}

        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
          {p.ticket_exists ? (
            <Link to={`/tickets?open=${p.ticket_id}`} className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
              <Ticket size={14} /> Open the pipeline ticket it was won from
            </Link>
          ) : <span className="text-sm text-slate-400">The original pipeline ticket was deleted.</span>}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Status</span>
            <select className="input h-8 w-36 py-0 text-sm" value={p.status} onChange={(e) => update({ status: e.target.value })}>
              <option>Active</option>
              <option>Complete</option>
              <option>Canceled</option>
            </select>
          </label>
          {p.status === 'Active' ? (
            <button type="button" className="btn-primary h-8 px-3 py-0 text-xs" title="Delivery is finished. The Pipedrive project is completed too."
              onClick={() => confirm(`Mark “${p.name}” complete? Delivery is finished${p.project.pipedrive_id ? ', and its Pipedrive project is completed too' : ''}.`) && update({ status: 'Complete' })}>
              <CheckCircle2 size={14} /> Complete
            </button>
          ) : <span className="text-xs text-slate-500">{p.status === 'Complete' ? `Completed ${wonOn(p.completed_at)}` : 'Canceled'}</span>}
        </section>

        <ProjectSection program={p} meta={meta} users={users} teams={teams} onChange={onChange} onUpdate={update} onError={setError} />

        {(p.bd_director || p.territory_name) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {p.bd_director && <span>Won by <span className="font-medium text-slate-700">{fullName(p.bd_director)}</span></span>}
            {p.territory_name && <span className="flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-teal-800"><MapPin size={11} /> {p.territory_name}</span>}
          </p>
        )}

        <MoneySection program={p} onChange={onChange} onError={setError} onSaveValue={(value) => update({ value })} />

        <section>
          <h3 className="label">Program Manager</h3>
          <UserCombobox users={users} teams={teams} value={p.program_manager?.id ?? null}
            onChange={(id) => update({ program_manager_id: id || null })} placeholder="Assign a Program Manager…" />
          {!p.program_manager && <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={11} /> No Program Manager yet</p>}
        </section>

        <section>
          <h3 className="label">Technical Lead</h3>
          <UserCombobox users={users} teams={teams} value={p.technical_lead?.id ?? null}
            onChange={(id) => update({ technical_lead_id: id || null })} placeholder="Assign a Technical Lead…" />
        </section>

        <section>
          <h3 className="label">Delivery team</h3>
          {p.team.length ? (
            <ul className="mb-3 space-y-1.5">
              {p.team.map((m) => (
                <li key={m.id} className="group flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2">
                  <Avatar user={m.user || { id: m.id, first_name: m.name, last_name: '' }} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{m.name}{!m.user && <span className="ml-1.5 text-[10px] font-normal text-slate-400">outside KIT</span>}</div>
                    <div className="truncate text-xs text-slate-500">{m.role || m.user?.title || 'No role set'}</div>
                  </div>
                  <button type="button" onClick={() => removeMember(m)} aria-label={`Remove ${m.name}`} title="Remove from the team"
                    className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="mb-3 text-sm text-slate-400">No one on the delivery team yet.</p>}

          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <span className="text-xs font-semibold text-slate-600">Add someone</span>
            <UserCombobox users={users.filter((u) => !p.team.some((m) => m.user?.id === u.id))} teams={teams} value={member.user_id}
              onChange={(id) => setMember((m) => ({ ...m, user_id: id || null, name: '' }))} placeholder="Choose someone in KIT…" />
            {!member.user_id && (
              <input className="input text-sm" placeholder="…or type the name of someone outside KIT" value={member.name} onChange={(e) => setMember((m) => ({ ...m, name: e.target.value }))} />
            )}
            <div className="flex gap-2">
              <input className="input text-sm" placeholder="Role (e.g. Lead engineer, Subcontractor PM)" value={member.role}
                onChange={(e) => setMember((m) => ({ ...m, role: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && (member.user_id || member.name.trim()) && addMember()} />
              <button type="button" className="btn-primary shrink-0" onClick={addMember} disabled={busy || (!member.user_id && !member.name.trim())}>
                <UserPlus size={15} /> Add
              </button>
            </div>
          </div>
        </section>

        <PlanSection program={p} meta={meta} users={users} teams={teams} onChange={onChange} onError={setError} />

        <ContractDocuments program={p} onChange={onChange} onError={setError} />

        <ProjectNotes program={p} onChange={onChange} onError={setError} />

        <section>
          <h3 className="label">Overview</h3>
          <p className="mb-1 text-[11px] text-slate-400">{p.project.pipedrive_id ? 'The Pipedrive project’s description. Saved here, it updates in Pipedrive.' : 'Period of performance, kickoff date, key deliverables…'}</p>
          <textarea className="input min-h-24 text-sm" placeholder="Period of performance, kickoff date, key deliverables…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {notesDirty && (
            <div className="mt-1.5 flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={() => setNotes(p.notes || '')}>Cancel</button>
              <button type="button" className="btn-primary text-xs" onClick={() => update({ notes })}>Save overview</button>
            </div>
          )}
        </section>
      </div>
    </SidePanel>
  );
}


/**
 * The contract's Pipedrive project: its link, status as Pipedrive has it, phase on the Delivery board, dates, owner and labels.
 * Each change saves right away and goes to Pipedrive. A contract without a project can have one made.
 */
function ProjectSection({ program: p, meta, users, teams, onUpdate, onChange, onError }) {
  const [busy, setBusy] = useState(false);
  const pr = p.project;
  const create = async () => {
    if (!confirm(`Make a Pipedrive project for “${p.name}”, linked to its won deal? Its plan, notes and documents then sync both ways.`)) return;
    setBusy(true); onError('');
    try { onChange((await api.post(`/delivery/${p.id}/project`, {})).program); } catch (e) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="label mb-0 flex items-center gap-1.5"><FolderKanban size={14} className="text-brand-600" /> Pipedrive project</h3>
        {pr.pipedrive_id && pr.status !== 'deleted' ? (
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-medium ${pr.status === 'completed' ? 'bg-slate-100 text-slate-600' : pr.status === 'canceled' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{PROJECT_STATUS[pr.status] || pr.status}</span>
            {pr.pending && <span className="text-amber-700" title="A change made here is waiting to go to Pipedrive">Syncing…</span>}
            <a href={`https://app.pipedrive.com/projects/${pr.pipedrive_id}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-700 hover:underline"><ExternalLink size={12} /> Open in Pipedrive</a>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {pr.status === 'deleted' ? 'Its project was deleted in Pipedrive.' : 'No Pipedrive project yet.'}
            {p.pipedrive_deal_id && <button type="button" className="btn px-2 py-1 text-xs" onClick={create} disabled={busy}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create project in Pipedrive</button>}
          </span>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="w-16 shrink-0">Phase</span>
          <select className="input min-w-0 py-1 text-sm" value={pr.phase_id ?? ''} onChange={(e) => onUpdate({ phase_id: e.target.value || null })}>
            <option value="">No phase</option>
            {meta.phases.map((ph) => <option key={ph.id} value={ph.id}>{ph.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="w-16 shrink-0">Owner</span>
          <span className="min-w-0 flex-1"><UserCombobox users={users} teams={teams} value={pr.owner?.id ?? null} onChange={(id) => onUpdate({ owner_id: id || null })} placeholder="Project owner…" /></span>
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="w-16 shrink-0">Start</span>
          <input type="date" className="input min-w-0 py-1 text-sm" value={pr.start_date || ''} onChange={(e) => onUpdate({ start_date: e.target.value || null })} />
        </label>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="w-16 shrink-0">End</span>
          <input type="date" className="input min-w-0 py-1 text-sm" value={pr.end_date || ''} onChange={(e) => onUpdate({ end_date: e.target.value || null })} />
        </label>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-500 sm:col-span-2">
          <span className="w-16 shrink-0">Labels</span>
          <span className="min-w-0 flex-1">
            <MultiSelect compact options={[...meta.project_labels, ...pr.labels.filter((l) => !meta.project_labels.includes(l))].map((l) => ({ value: l, label: l }))} value={pr.labels}
              onChange={(v) => onUpdate({ labels: v })} placeholder="Project labels…" />
          </span>
        </div>
      </div>
      {p.installments.length > 0 && (
        <div className="text-xs text-slate-600">
          <span className="font-medium text-slate-500">Payment schedule (Pipedrive installments):</span>{' '}
          {p.installments.map((i) => `${money(i.amount)} on ${shortDate(i.billing_date, { month: 'short', day: 'numeric', year: 'numeric' })}${i.description ? ` (${i.description})` : ''}`).join(' · ')}
          {' '}· total {money(p.installments.reduce((s, i) => s + (i.amount || 0), 0))}
        </div>
      )}
    </section>
  );
}

/** The plan: the project's tasks (with subtasks) and activities, ticked off here or in Pipedrive. */
function PlanSection({ program: p, meta, users, teams, onChange, onError }) {
  const [draft, setDraft] = useState({ title: '', kind: 'task', due_date: '', assignee_id: null, parent_id: null, activity_type: 'Task' });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const call = async (fn) => { onError(''); setBusy(true); try { onChange((await fn()).program); } catch (e) { onError(e.message); } finally { setBusy(false); } };
  const add = () => {
    if (!draft.title.trim()) return;
    call(() => api.post(`/delivery/${p.id}/tasks`, draft)).then(() => setDraft((d) => ({ ...d, title: '', due_date: '', parent_id: null })));
  };
  const toggle = (k) => call(() => api.put(`/delivery/tasks/${k.id}`, { done: !k.done }));
  const remove = (k) => confirm(`Delete “${k.title}”?${k.synced ? ' It’s deleted from the Pipedrive project too.' : ''}`) && call(() => api.del(`/delivery/tasks/${k.id}`));
  const save = () => call(() => api.put(`/delivery/tasks/${editing.id}`, editing)).then(() => setEditing(null));
  const top = p.tasks.filter((k) => !k.parent_id);
  const subs = (id) => p.tasks.filter((k) => k.parent_id === id);
  const done = p.tasks.filter((k) => k.done).length;
  const row = (k, sub) => (
    <li key={k.id} className={`group flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50 ${sub ? 'ml-7' : ''}`}>
      <button type="button" onClick={() => toggle(k)} disabled={busy} aria-label={k.done ? 'Mark not done' : 'Mark done'} className={`mt-0.5 shrink-0 ${k.done ? 'text-emerald-600' : 'text-slate-300 hover:text-slate-500'}`}>
        {k.done ? <CheckSquare size={16} /> : <Square size={16} />}
      </button>
      {editing?.id === k.id ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <input className="input min-w-40 flex-1 py-1 text-sm" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && save()} autoFocus />
          <input type="date" className="input w-36 py-1 text-sm" value={editing.due_date || ''} onChange={(e) => setEditing({ ...editing, due_date: e.target.value })} />
          <button type="button" className="btn-primary px-2 py-1 text-xs" onClick={save} disabled={busy}>Save</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <div className={`flex flex-wrap items-center gap-1.5 ${k.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
              {k.kind === 'activity' && <CalendarCheck size={12} className="shrink-0 text-violet-600" title={k.activity_type || 'Activity'} />}
              <span className="truncate">{k.title}</span>
              {k.pending && <span className="text-[10px] text-amber-700" title="Waiting to go to Pipedrive">syncing</span>}
            </div>
            <div className="text-[11px] text-slate-500">
              {[k.kind === 'activity' ? k.activity_type : null, k.due_date && `due ${shortDate(k.due_date, { month: 'short', day: 'numeric' })}${k.due_time ? ` ${k.due_time}` : ''}`,
                k.assignee && fullName(k.assignee), k.done && k.done_at && `done ${wonOn(k.done_at)}`].filter(Boolean).join(' · ')}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
            {!sub && k.kind === 'task' && <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-brand-700" title="Add a subtask" onClick={() => setDraft((d) => ({ ...d, kind: 'task', parent_id: k.id }))}><Plus size={13} /></button>}
            <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-brand-700" title="Edit" onClick={() => setEditing({ id: k.id, title: k.title, due_date: k.due_date || '' })}><Pencil size={13} /></button>
            <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" title="Delete" onClick={() => remove(k)}><Trash2 size={13} /></button>
          </span>
        </>
      )}
    </li>
  );
  const parent = draft.parent_id ? p.tasks.find((k) => k.id === draft.parent_id) : null;
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="label mb-0">Plan</h3>
        <span className="text-xs text-slate-500">{p.tasks.length ? `${done} of ${p.tasks.length} done` : 'Tasks and activities on the Pipedrive project'}</span>
      </div>
      {p.tasks.length > 0 && (
        <ul className="mb-2 rounded-lg border border-slate-200 bg-white p-1">
          {top.map((k) => [row(k, false), ...subs(k.id).map((s) => row(s, true))])}
        </ul>
      )}
      <div className="space-y-1.5 rounded-lg bg-slate-50 p-3">
        {parent && <div className="flex items-center gap-1 text-xs text-slate-600">Subtask of <b>{parent.title}</b> <button type="button" className="btn-ghost p-0.5" onClick={() => setDraft((d) => ({ ...d, parent_id: null }))} aria-label="Not a subtask"><X size={12} /></button></div>}
        <div className="flex flex-wrap gap-1.5">
          <select className="input w-28 py-1 text-sm" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value, parent_id: null })} aria-label="Kind" disabled={!!parent}>
            <option value="task">Task</option>
            <option value="activity">Activity</option>
          </select>
          {draft.kind === 'activity' && (
            <select className="input w-28 py-1 text-sm" value={draft.activity_type} onChange={(e) => setDraft({ ...draft, activity_type: e.target.value })} aria-label="Activity type">
              {meta.activity_types.map((t) => <option key={t}>{t}</option>)}
            </select>
          )}
          <input className="input min-w-40 flex-1 py-1 text-sm" placeholder={draft.kind === 'activity' ? 'Activity subject' : parent ? 'Subtask' : 'Task'} value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <input type="date" className="input w-36 py-1 text-sm" value={draft.due_date} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} aria-label="Due date" />
          <span className="w-48"><UserCombobox users={users} teams={teams} value={draft.assignee_id} onChange={(id) => setDraft({ ...draft, assignee_id: id || null })} placeholder="Assignee…" /></span>
          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={add} disabled={busy || !draft.title.trim()}><Plus size={14} /> Add</button>
        </div>
      </div>
    </section>
  );
}

/** Notes on the project, as Pipedrive keeps them: written here or there, pinned on top. */
function ProjectNotes({ program: p, onChange, onError }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const call = async (fn) => { onError(''); setBusy(true); try { onChange((await fn()).program); } catch (e) { onError(e.message); } finally { setBusy(false); } };
  const add = () => text.trim() && call(() => api.post(`/delivery/${p.id}/notes`, { body: text })).then(() => setText(''));
  return (
    <section>
      <h3 className="label flex items-center gap-1.5"><StickyNote size={14} className="text-amber-600" /> Project notes</h3>
      <div className="rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <textarea rows={2} className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-0 focus:outline-none"
          placeholder="A note on the project (it goes to Pipedrive too)…" value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }} />
        {text.trim() && (
          <div className="flex items-center justify-end border-t border-slate-100 px-3 py-1.5">
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={add} disabled={busy}>Add note</button>
          </div>
        )}
      </div>
      {p.project_notes.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {p.project_notes.map((n) => (
            <li key={n.id} className="group rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                {n.pinned && <Pin size={11} className="text-amber-600" />}
                <span className="font-medium text-slate-700">{n.author ? fullName(n.author) : 'Pipedrive'}</span> · {wonOn(n.created_at)}{n.updated_at ? ' · edited' : ''}
                {n.synced && <RefreshCw size={10} className="text-slate-400" title="In Pipedrive too" />}
                <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-amber-600" title={n.pinned ? 'Unpin' : 'Pin'} onClick={() => call(() => api.put(`/delivery/notes/${n.id}`, { pinned: !n.pinned }))}><Pin size={12} /></button>
                  {(!n.author || n.author.id === user.id || user.role === 'admin') && (
                    <>
                      <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-brand-700" title="Edit" onClick={() => setEditing({ id: n.id, body: n.body })}><Pencil size={12} /></button>
                      <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" title="Delete" onClick={() => confirm(`Delete this note?${n.synced ? ' It’s deleted from the Pipedrive project too.' : ''}`) && call(() => api.del(`/delivery/notes/${n.id}`))}><Trash2 size={12} /></button>
                    </>
                  )}
                </span>
              </div>
              {editing?.id === n.id ? (
                <div className="mt-1 space-y-1">
                  <textarea rows={3} className="input text-sm" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} autoFocus />
                  <div className="flex justify-end gap-1.5">
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                    <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={busy} onClick={() => call(() => api.put(`/delivery/notes/${n.id}`, { body: editing.body })).then(() => setEditing(null))}>Save</button>
                  </div>
                </div>
              ) : <p className="mt-0.5 whitespace-pre-wrap text-slate-800">{n.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A contract on hold: why, and (for admins) the two ways to settle it. */
function HoldDecision({ program: p, onDecided, onError }) {
  const { user } = useAuth();
  const keep = async () => {
    if (!confirm(`Keep “${p.name}” as a contract? It goes back into bookings, backlog and revenue, even though its deal isn’t won.`)) return;
    try { onDecided((await api.post(`/delivery/${p.id}/keep`)).program); } catch (e) { onError(e.message); }
  };
  const remove = async () => {
    const parts = [p.team.length && `${p.team.length} on the team`, p.funded > 0 && `${money(p.funded)} funding`, p.billed > 0 && `${money(p.billed)} billing`, p.files.length && `${p.files.length} document${p.files.length === 1 ? '' : 's'}`].filter(Boolean);
    if (!confirm(`Delete “${p.name}” for good?${parts.length ? ` This also deletes ${parts.join(', ')}.` : ''} Its pipeline ticket stays. This can’t be undone.`)) return;
    try { await api.del(`/delivery/${p.id}`); onDecided(null); } catch (e) { onError(e.message); }
  };
  return (
    <section className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p className="flex items-start gap-1.5 font-medium"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> On hold since {wonOn(p.held_at)}: its deal is no longer won ({p.deal_status === 'lost' ? 'lost' : 'reopened'}, in {p.ticket_stage || 'no stage'}).</p>
      <p className="mt-1 text-xs">Everything here is saved, but it isn’t counted in bookings, backlog or revenue. If the deal is won again, this comes back on its own.</p>
      {user.role === 'admin' ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary text-xs" onClick={keep}>Keep as a contract</button>
          <button type="button" className="btn text-xs text-red-700" onClick={remove}><Trash2 size={13} /> Delete contract</button>
        </div>
      ) : <p className="mt-1 text-xs">An admin decides whether to keep or delete it.</p>}
    </section>
  );
}

const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
/** A file's type, from its name: "PDF", "DOCX". */
const fileType = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || 'File').toUpperCase();

/** Upload to one kind of document. Several files can be chosen at once; they go one at a time. */
function UploadButton({ programId, docType, label, onChange, onError }) {
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    setBusy(true);
    onError('');
    try {
      for (const file of files) {
        const fd = new FormData();
        fd.append('doc_type', docType);
        fd.append('file', file);
        onChange((await api.post(`/delivery/${programId}/files`, fd)).program);
      }
    } catch (err) { onError(err.message); } finally { setBusy(false); }
  };
  return (
    <label className={`btn cursor-pointer px-2 py-1 text-xs ${busy ? 'pointer-events-none opacity-60' : ''}`}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Upload
      <input type="file" multiple className="sr-only" aria-label={`Upload ${label}`} onChange={pick} />
    </label>
  );
}

function FileRow({ file, showType, onChange, onError }) {
  const { user } = useAuth();
  const remove = async () => {
    if (!confirm(`Delete “${file.name}”?${file.synced ? ' It’s deleted from the Pipedrive project too.' : ''}`)) return;
    onError('');
    try { onChange((await api.del(`/delivery/files/${file.id}`)).program); } catch (e) { onError(e.message); }
  };
  return (
    <li className="flex items-center gap-1">
      <a href={`/api/delivery/files/${file.id}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-brand-500"
        title={`Added ${shortDate(parseUtc(file.created_at).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric', year: 'numeric' })}${file.uploaded_by ? ` by ${fullName(file.uploaded_by)}` : ''}`}>
        <FileText size={13} className="shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1 truncate text-slate-800">{file.name}</span>
        {file.synced && <RefreshCw size={10} className="shrink-0 text-slate-400" title="In the Pipedrive project too" />}
        {showType && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500">{fileType(file.name)}</span>}
        {file.size != null && <span className="shrink-0 text-[11px] text-slate-400">{bytes(file.size)}</span>}
      </a>
      {(!file.uploaded_by || file.uploaded_by?.id === user.id || user.role === 'admin') && (
        <button type="button" className="btn-ghost shrink-0 p-1 text-slate-400 hover:text-red-600" onClick={remove} aria-label={`Delete ${file.name}`} title={file.synced ? 'Delete file (from the Pipedrive project too)' : 'Delete file'}><Trash2 size={13} /></button>
      )}
    </li>
  );
}

/** A contract's documents: a place for each kind, then Additional documents, sortable by file name or type. */
function ContractDocuments({ program: p, onChange, onError }) {
  const [sort, setSort] = useState({ by: 'name', dir: 1 });
  const props = { onChange, onError };
  const name = (f) => f.name.toLowerCase();
  const additional = p.files.filter((f) => f.doc_type === ADDITIONAL_DOCS).sort((a, b) => sort.dir * (sort.by === 'type'
    ? fileType(a.name).localeCompare(fileType(b.name)) || name(a).localeCompare(name(b))
    : name(a).localeCompare(name(b))));
  const sortButton = (by, label) => {
    const on = sort.by === by;
    const Arrow = !on ? ChevronsUpDown : sort.dir > 0 ? ChevronUp : ChevronDown;
    return (
      <button type="button" className={`flex items-center gap-0.5 text-xs ${on ? 'font-medium text-slate-700' : 'text-slate-500 hover:text-slate-700'}`}
        aria-pressed={on} onClick={() => setSort({ by, dir: on ? -sort.dir : 1 })}>{label} <Arrow size={12} /></button>
    );
  };
  return (
    <>
      <section>
        <h3 className="label">Documents</h3>
        <div className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
          {CONTRACT_DOC_TYPES.map((type) => {
            const files = p.files.filter((f) => f.doc_type === type);
            return (
              <div key={type}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-700">{type}</span>
                  <UploadButton programId={p.id} docType={type} label={type} {...props} />
                </div>
                {files.length > 0 && <ul className="space-y-1">{files.map((f) => <FileRow key={f.id} file={f} {...props} />)}</ul>}
              </div>
            );
          })}
        </div>
      </section>
      <section>
        <div className="mb-1 flex flex-wrap items-center gap-3">
          <h3 className="label mb-0 mr-auto">Additional documents</h3>
          {additional.length > 1 && <>{sortButton('name', 'File name')}{sortButton('type', 'Type')}</>}
          <UploadButton programId={p.id} docType={ADDITIONAL_DOCS} label="additional documents" {...props} />
        </div>
        {additional.length
          ? <ul className="space-y-1">{additional.map((f) => <FileRow key={f.id} file={f} showType {...props} />)}</ul>
          : <p className="text-xs text-slate-400">Anything that doesn’t fit above.</p>}
      </section>
    </>
  );
}

/** How much of a contract's value is funded. */
const SORTS = {
  name: (p) => p.name.toLowerCase(), customer: (p) => (p.organization || '~').toLowerCase(), value: (p) => p.value ?? -1,
  funded: (p) => (p.value ? p.funded / p.value : -1), billed: (p) => p.billed, won: (p) => p.awarded_at || '',
  pm: (p) => (p.program_manager ? `${p.program_manager.last_name} ${p.program_manager.first_name}` : '~').toLowerCase(), team: (p) => p.team.length,
  status: (p) => p.status, phase: (p) => p.project?.phase || '~',
};

/** The contracts as a sortable table. Selecting a row opens it in the side pane, as a card does. */
function ProgramTable({ programs, openId, onOpen }) {
  const [sort, setSort] = useState({ key: 'won', dir: 'desc' });
  const get = SORTS[sort.key];
  const sign = sort.dir === 'asc' ? 1 : -1;
  const rows = [...programs].sort((a, b) => { const x = get(a), y = get(b); return x < y ? -sign : x > y ? sign : 0; });
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : ['name', 'customer', 'pm', 'status'].includes(key) ? 'asc' : 'desc' }));
  const header = (key, label, className = '') => (
    <th className={`px-4 py-3 ${className}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[60rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr>
            {header('name', 'Contract')}{header('customer', 'Customer')}{header('value', 'Value', 'text-right')}{header('funded', 'Funded', 'text-right')}
            {header('billed', 'Billed', 'text-right')}{header('won', 'Won')}{header('pm', 'Program Manager')}{header('team', 'Team', 'text-right')}{header('phase', 'Phase')}{header('status', 'Status')}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}
              className={`cursor-pointer border-t border-slate-100 hover:bg-brand-50/40 focus:bg-brand-50/60 focus:outline-none ${openId === p.id ? 'bg-brand-50/60' : ''}`}>
              <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
              <td className="px-4 py-3 text-slate-600">{[p.organization, p.account_type].filter(Boolean).join(' · ') || '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{p.value != null ? money(Math.round(p.value)) : '—'}</td>
              <td className="px-4 py-3 text-right text-slate-600 tabular-nums" title={p.value ? `${money(p.funded)} funded` : undefined}>
                {p.value ? `${Math.min(100, Math.round((p.funded / p.value) * 100))}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{money(Math.round(p.billed))}</td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">{wonOn(p.awarded_at)}</td>
              <td className="px-4 py-3">
                {p.program_manager
                  ? <span className="flex items-center gap-1.5 text-slate-700"><Avatar user={p.program_manager} size="xs" /> {fullName(p.program_manager)}</span>
                  : <span className="flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle size={12} /> Needs a PM</span>}
              </td>
              <td className="px-4 py-3 text-right text-slate-600 tabular-nums">{p.team.length}</td>
              <td className="px-4 py-3 text-slate-600">{p.project.phase || '—'}</td>
              <td className="px-4 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${p.held_at ? 'bg-amber-100 text-amber-900' : STATUS_STYLE[p.status]}`}>{p.held_at ? 'On hold' : p.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FundedBar({ program: p }) {
  const pct = Math.min(100, Math.round((p.funded / p.value) * 100));
  return (
    <div className="mt-2" title={`${money(p.funded)} funded of ${money(p.value)}; ${money(p.unfunded)} unfunded`}>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
      <div className="mt-0.5 text-[11px] text-slate-500">{pct}% funded · {money(p.billed)} billed</div>
    </div>
  );
}

const KINDS = { funding: { label: 'Funding received', icon: Landmark, tint: 'text-emerald-700' }, billing: { label: 'Revenue billed', icon: ReceiptText, tint: 'text-sky-700' } };

/**
 * The contract's money: its value, how much of it is funded (backlog funded / unfunded), and revenue billed
 * (the "bill" side of book-to-bill). Entries are added and removed here.
 */
function MoneySection({ program: p, onChange, onError, onSaveValue }) {
  const blank = { kind: 'funding', amount: '', entry_date: todayIso(), note: '' };
  const [entry, setEntry] = useState(blank);
  const [value, setValue] = useState(p.value ?? '');
  const [busy, setBusy] = useState(false);
  const valueDirty = String(value) !== String(p.value ?? '');
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    onError('');
    try { onChange((await api.post(`/delivery/${p.id}/entries`, entry)).program); setEntry({ ...blank, kind: entry.kind }); } catch (err) { onError(err.message); } finally { setBusy(false); }
  };
  const remove = async (x) => {
    if (!confirm(`Remove this ${x.kind === 'funding' ? 'funding' : 'billing'} entry of ${money(x.amount)}?`)) return;
    onChange((await api.del(`/delivery/entries/${x.id}`)).program);
  };
  const tile = (label, amount, tint, sub) => (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="text-[11px] font-medium text-slate-500 uppercase">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${tint}`}>{amount == null ? '—' : money(amount)}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
  return (
    <section className="space-y-3">
      <h3 className="label">Funding and billing</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tile('Contract value', p.value, 'text-slate-900')}
        {tile('Funded', p.funded, 'text-emerald-700', p.value ? `${Math.round((p.funded / p.value) * 100)}% of value` : null)}
        {tile('Unfunded', p.unfunded, 'text-amber-700', 'Backlog not yet funded')}
        {tile('Billed', p.billed, 'text-sky-700', p.funded ? `${Math.round((p.billed / p.funded) * 100)}% of funded` : null)}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-slate-500">Contract value ($)</span>
        <input type="number" min="0" className="input h-8 w-44 py-0 text-sm" value={value} onChange={(e) => setValue(e.target.value)} />
        {valueDirty && <button type="button" className="btn-primary h-8 px-3 py-0 text-xs" onClick={() => onSaveValue(value)}>Save value</button>}
        <span className="text-xs text-slate-400">Starts as the pipeline ticket's value; change it to the awarded ceiling if it differs.</span>
      </label>

      {/* Type, amount and date on one line; the note and Add on the next, so nothing is squeezed in a narrow panel. */}
      <form onSubmit={add} className="space-y-2 rounded-lg bg-slate-50 p-3">
        <div className="grid gap-2 sm:grid-cols-3">
          <select className="input text-sm" value={entry.kind} onChange={(e) => setEntry({ ...entry, kind: e.target.value })} aria-label="Entry type">
            <option value="funding">Funding received</option>
            <option value="billing">Revenue billed</option>
          </select>
          <input type="number" min="0" step="0.01" className="input text-sm" placeholder="Amount ($)" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} aria-label="Amount" required />
          <input type="date" className="input text-sm" value={entry.entry_date} onChange={(e) => setEntry({ ...entry, entry_date: e.target.value })} aria-label="Date" required />
        </div>
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1 text-sm" placeholder={entry.kind === 'funding' ? 'Note, e.g. Mod P00003, FY27 increment' : 'Note, e.g. October invoice'} value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} aria-label="Note" />
          <button className="btn-primary shrink-0 text-sm" disabled={busy}><Plus size={14} /> Add</button>
        </div>
      </form>

      {p.entries.length ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {p.entries.map((x) => {
            const k = KINDS[x.kind];
            return (
              <li key={x.id} className="group flex items-center gap-3 px-3 py-2 text-sm">
                <k.icon size={15} className={`shrink-0 ${k.tint}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-slate-800"><span className={`font-semibold tabular-nums ${k.tint}`}>{money(x.amount)}</span> <span className="text-slate-500">{k.label.toLowerCase()}</span></div>
                  <div className="truncate text-xs text-slate-400">{[shortDate(x.entry_date, { month: 'short', day: 'numeric', year: 'numeric' }), x.note, x.created_by && `added by ${fullName(x.created_by)}`].filter(Boolean).join(' · ')}</div>
                </div>
                <button type="button" onClick={() => remove(x)} aria-label="Remove entry" title="Remove"
                  className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600 focus:opacity-100"><Trash2 size={14} /></button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-slate-400">No funding or billing recorded yet.</p>}
    </section>
  );
}
