import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, BriefcaseBusiness, Ticket, Trash2, UserPlus, AlertTriangle, Landmark, ReceiptText, Plus, MapPin } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, shortDate, parseUtc, todayIso } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import UserCombobox from '../components/UserCombobox.jsx';

const money = (n) => usd(n).replace('.00', '');
const wonOn = (utc) => (utc ? shortDate(parseUtc(utc).toLocaleDateString('en-CA'), { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Contracts we've won. A bid ticket is copied here when it's Awarded, to get a Program Manager and a delivery team. */
export default function Delivery() {
  const users = useApi('/users');
  const teams = useApi('/teams');
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [programs, setPrograms] = useState(null);
  const [openId, setOpenId] = useState(null);

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
    return !s || [p.name, p.organization, p.account_type, fullName(p.program_manager), ...p.team.map((m) => m.name)].filter(Boolean).join(' ').toLowerCase().includes(s);
  });
  const open = programs?.find((p) => p.id === openId);
  const replace = (p) => setPrograms((xs) => xs.map((x) => (x.id === p.id ? p : x)));

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Delivery" subtitle="Contracts we’ve won. Each one lands here when its bid ticket is marked Awarded.">
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['active', 'Active'], ['complete', 'Complete'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setStatus(k)}
              className={`rounded px-3 ${status === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>

      <div className="relative max-w-md">
        <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
        <input className="input pl-9" placeholder="Search by contract, customer, or person…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {programs && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <BriefcaseBusiness size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'Nothing matches your search.' : status === 'complete' ? 'No completed contracts yet.' : 'No won contracts yet. Move a bid ticket to Awarded on BD Pipeline and it shows up here.'}
        </div>
      )}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
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
      </div>

      {open && (
        <ProgramPanel key={open.id} program={open} users={users.data?.users || []} teams={teams.data?.teams || []}
          onChange={replace} onClose={() => { setOpenId(null); load(); }} />
      )}
    </div>
  );
}

/** One won contract: its Program Manager, delivery team, status, and notes. Changes save as they're made. */
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
              <Ticket size={14} /> Open the bid ticket it was won from
            </Link>
          ) : <span className="text-sm text-slate-400">The original bid ticket was deleted.</span>}
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

/** How much of a contract's value is funded. */
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
        <span className="text-xs text-slate-400">Starts as the bid's value; change it to the awarded ceiling if it differs.</span>
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
