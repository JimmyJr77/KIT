import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, BriefcaseBusiness, Ticket, Trash2, UserPlus, AlertTriangle, Landmark, ReceiptText, Plus, MapPin, LayoutGrid, Table2, ChevronUp, ChevronDown, ChevronsUpDown, Upload, FileText, Loader2 } from 'lucide-react';
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

const money = (n) => usd(n).replace('.00', '');
const wonOn = (utc) => (utc ? shortDate(parseUtc(utc).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Contracts we've won. A pipeline ticket is copied here when it's Awarded, to get a Program Manager and a delivery team. */
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

  const load = () => api.get(`/delivery?status=${status}`).then((d) => setPrograms(d.programs));
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Links from alerts land here with ?open=<program id>; show every status so the contract is found.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get('open'));
    if (!id) return;
    setStatus('all');
    setOpenId(id);
    setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (programs || []).filter((p) => {
    const s = q.trim().toLowerCase();
    return !s || [p.name, p.organization, p.account_type, fullName(p.program_manager), fullName(p.technical_lead), ...p.team.map((m) => m.name)].filter(Boolean).join(' ').toLowerCase().includes(s);
  });
  const open = programs?.find((p) => p.id === openId);
  const replace = (p) => setPrograms((xs) => xs.map((x) => (x.id === p.id ? p : x)));

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Delivery" subtitle="Contracts we’ve won. Each one lands here when its pipeline ticket is marked Awarded.">
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['active', 'Active'], ['complete', 'Complete'], ['all', 'All']].map(([k, l]) => (
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

      {programs && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <BriefcaseBusiness size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'Nothing matches your search.' : status === 'complete' ? 'No completed contracts yet.' : 'No won contracts yet. Move a pipeline ticket to Awarded on BD Pipeline and it shows up here.'}
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
              {p.status === 'Complete' && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">Complete</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              {p.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">{money(p.value)}</span>}
              <span className="text-slate-400">Won {wonOn(p.awarded_at)}</span>
            </div>
            {p.value > 0 && <FundedBar program={p} />}
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
              {p.program_manager ? (
                <span className="flex items-center gap-1.5 text-slate-700"><Avatar user={p.program_manager} size="xs" /> <span><span className="text-slate-400">PM</span> {fullName(p.program_manager)}</span></span>
              ) : (
                <span className="flex items-center gap-1 font-medium text-amber-700"><AlertTriangle size={12} /> Needs a Program Manager</span>
              )}
              <span className="flex items-center gap-1.5 text-slate-500">
                {p.team.length > 0 && <span className="flex -space-x-1.5">{p.team.slice(0, 4).map((m) => <Avatar key={m.id} user={m.user || { id: m.id, first_name: m.name, last_name: '' }} size="xs" className="ring-2 ring-white" />)}</span>}
                {p.team.length} on team
              </span>
            </div>
          </button>
        ))}
      </div>}

      {open && (
        <ProgramPanel key={open.id} program={open} users={users.data?.users || []} teams={teams.data?.teams || []}
          onChange={replace} onClose={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
}

/** One won contract: its Program Manager, Technical Lead, delivery team, status, and notes. Changes save as they're made. */
function ProgramPanel({ program: p, users, teams, onChange, onClose }) {
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
    <SidePanel wide title={p.name} onClose={() => { if (!notesDirty || confirm('Discard your unsaved notes?')) onClose(); }}
      subtitle={[p.organization, p.value != null ? money(p.value) : null, `Won ${wonOn(p.awarded_at)}`].filter(Boolean).join(' · ')}>
      <div className="space-y-5">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

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
            </select>
          </label>
        </section>

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

        <ContractDocuments program={p} onChange={onChange} onError={setError} />

        <section>
          <h3 className="label">Notes</h3>
          <textarea className="input min-h-24 text-sm" placeholder="Period of performance, kickoff date, key deliverables…" value={notes} onChange={(e) => setNotes(e.target.value)} />
          {notesDirty && (
            <div className="mt-1.5 flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={() => setNotes(p.notes || '')}>Cancel</button>
              <button type="button" className="btn-primary text-xs" onClick={() => update({ notes })}>Save notes</button>
            </div>
          )}
        </section>
      </div>
    </SidePanel>
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
    if (!confirm(`Delete “${file.name}”?`)) return;
    onError('');
    try { onChange((await api.del(`/delivery/files/${file.id}`)).program); } catch (e) { onError(e.message); }
  };
  return (
    <li className="flex items-center gap-1">
      <a href={`/api/delivery/files/${file.id}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs hover:border-brand-500"
        title={`Added ${shortDate(parseUtc(file.created_at).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric', year: 'numeric' })}${file.uploaded_by ? ` by ${fullName(file.uploaded_by)}` : ''}`}>
        <FileText size={13} className="shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1 truncate text-slate-800">{file.name}</span>
        {showType && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-medium text-slate-500">{fileType(file.name)}</span>}
        {file.size != null && <span className="shrink-0 text-[11px] text-slate-400">{bytes(file.size)}</span>}
      </a>
      {(file.uploaded_by?.id === user.id || user.role === 'admin') && (
        <button type="button" className="btn-ghost shrink-0 p-1 text-slate-400 hover:text-red-600" onClick={remove} aria-label={`Delete ${file.name}`} title="Delete file"><Trash2 size={13} /></button>
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
  status: (p) => p.status,
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
            {header('billed', 'Billed', 'text-right')}{header('won', 'Won')}{header('pm', 'Program Manager')}{header('team', 'Team', 'text-right')}{header('status', 'Status')}
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
              <td className="px-4 py-3"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${p.status === 'Complete' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700'}`}>{p.status}</span></td>
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
