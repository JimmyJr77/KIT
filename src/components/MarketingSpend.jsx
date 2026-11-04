import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Receipt } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, shortDate, todayIso } from '../lib/format.js';
import SidePanel from './SidePanel.jsx';
import { StatTile, ViewCard, BarList, compact, fullMoney } from './Charts.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const RANGES = [['year', 'This year'], ['12m', 'Last 12 months'], ['quarter', 'This quarter'], ['all', 'All time'], ['custom', 'Custom range']];

function rangeDates(range, custom) {
  const today = todayIso();
  const y = today.slice(0, 4);
  if (range === 'year') return { from: `${y}-01-01`, to: today };
  if (range === '12m') { const d = new Date(`${today}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 1); return { from: d.toISOString().slice(0, 10), to: today }; }
  if (range === 'quarter') { const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3); return { from: `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`, to: today }; }
  if (range === 'custom') return custom;
  return { from: '', to: '' };
}

const BREAKDOWNS = [
  ['byAccount', 'By account', 'Account'], ['byTerritory', 'By territory', 'Territory'], ['byTicket', 'By pipeline ticket', 'Pipeline ticket'],
  ['byPerson', 'By person', 'Person'], ['byEvent', 'By event', 'Event'], ['byCategory', 'By category', 'Category'],
];

/**
 * Marketing spend: what was spent and who or what it was for (an account, territory, pipeline ticket, person or event, as
 * specific as it's known), with totals each way. The Marketing team and admins add and edit entries; everyone can see them.
 * `entries` false leaves out the list of entries (for the Company dashboard).
 */
export default function MarketingSpend({ entries: showEntries = true }) {
  const [range, setRange] = useState('year');
  const [custom, setCustom] = useState({ from: `${todayIso().slice(0, 4)}-01-01`, to: todayIso() });
  const { from, to } = rangeDates(range, custom);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // {} for new, an entry to edit
  const load = () => api.get(`/marketing/spend?${new URLSearchParams({ from, to })}`).then(setData);
  useEffect(() => { load(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = data?.summary;
  const attributed = s ? s.byPerson.filter((p) => p.key).reduce((t, p) => t + p.value, 0) : 0;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input h-9 w-44" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {range === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="date" className="input h-9 w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            to
            <input type="date" className="input h-9 w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </span>
        )}
        <span className="mr-auto" />
        {data?.canManage && showEntries && <button type="button" className="btn-primary" onClick={() => setEditing({})}><Plus size={15} /> Record spend</button>}
      </div>

      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
            <StatTile label="Marketing spend" value={compact(s.total)} sub={`${s.entries} entr${s.entries === 1 ? 'y' : 'ies'}`} />
            <StatTile label="Tied to a person" value={compact(attributed)} sub="Directly, through a pipeline ticket, or split across an event's attendees" />
            <StatTile label="Tied to a pipeline ticket" value={compact(s.byTicket.filter((x) => x.key).reduce((t, x) => t + x.value, 0))} />
            <StatTile label="Company-wide" value={compact(s.byPerson.find((p) => !p.key)?.value || 0)} sub="Not tied to anyone" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {BREAKDOWNS.map(([key, title, col]) => (
              <ViewCard key={key} title={title}
                table={{ columns: [{ key: 'label', label: col }, { key: 'entries', label: 'Entries', align: 'right' }, { key: 'value', label: 'Spent', align: 'right', format: fullMoney }], rows: s[key] }}
                bar={<BarList rows={s[key].slice(0, 10).map((r) => ({ key: r.key, label: r.label, value: r.value, sub: `${r.entries}` }))} color="#eb6834" empty="No spend in this period." />} />
            ))}
          </div>
          {showEntries && <EntryList entries={data.entries} canManage={data.canManage} onEdit={setEditing} />}
        </>
      )}
      {editing && (
        <SpendForm entry={editing.id ? editing : null} categories={data?.categories || []} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

function EntryList({ entries, canManage, onEdit }) {
  if (!entries.length) {
    return (
      <div className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">
        <Receipt className="mx-auto mb-2 text-slate-300" size={28} />
        No marketing spend recorded in this period.
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase">
            <tr className="border-b border-slate-200">
              <th className="px-3 py-2">Date</th><th className="px-3 py-2">What</th><th className="px-3 py-2">For</th>
              <th className="px-3 py-2">Account · territory</th><th className="px-3 py-2 text-right">Amount</th>{canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 align-top last:border-0">
                <td className="px-3 py-2 whitespace-nowrap text-slate-600">{longDate(e.spent_on)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-800">{e.description}</div>
                  <div className="text-xs text-slate-500">{[e.category, e.vendor].filter(Boolean).join(' · ')}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  {e.event_name && <div>Event: {e.event_name}</div>}
                  {e.ticket_title && <div>Pipeline ticket: {e.ticket_title}</div>}
                  <div className="text-slate-500">{e.shares.length ? `${e.split ? 'Split: ' : ''}${e.shares.map((x) => x.name).join(', ')}` : 'Company-wide'}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-600">{[e.account, e.resolved_territory].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-800 tabular-nums">{fullMoney(e.amount)}</td>
                {canManage && <td className="px-2 py-1.5"><button type="button" className="btn-ghost p-1.5" onClick={() => onEdit(e)} aria-label={`Edit ${e.description}`}><Pencil size={14} /></button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SpendForm({ entry, categories, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    spent_on: entry?.spent_on || todayIso(), amount: entry?.amount ?? '', description: entry?.description || '', category: entry?.category || '',
    vendor: entry?.vendor || '', event_id: entry?.event_id || '', ticket_id: entry?.ticket_id || '', user_id: entry?.user_id || '',
    territory_id: entry?.territory_id || '', organization: entry?.organization || '', note: entry?.note || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticketQ, setTicketQ] = useState('');
  const events = useApi('/events?scope=all').data?.events || [];
  const users = useApi('/users').data?.users || [];
  const territories = useApi('/territories').data?.territories || [];
  const tickets = useApi('/tickets?scope=all&kind=bid').data?.tickets || [];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const ticket = tickets.find((t) => t.id === Number(f.ticket_id));
  const matches = useMemo(() => (ticketQ ? tickets.filter((t) => !t.archived_at && `${t.opportunity_title} ${t.organization || ''}`.toLowerCase().includes(ticketQ.toLowerCase())).slice(0, 50) : []), [tickets, ticketQ]);
  const people = [...users].filter((u) => u.active !== 0).sort((a, b) => fullName(a).localeCompare(fullName(b)));

  const submit = (e) => {
    e.preventDefault();
    setBusy(true);
    (entry ? api.put(`/marketing/spend/${entry.id}`, f) : api.post('/marketing/spend', f)).then(onSaved).catch((err) => { setError(err.message); setBusy(false); });
  };
  const remove = () => {
    if (!window.confirm(`Delete "${entry.description}"?`)) return;
    api.del(`/marketing/spend/${entry.id}`).then(onSaved).catch((err) => setError(err.message));
  };

  return (
    <SidePanel title={entry ? 'Edit marketing spend' : 'Record marketing spend'} subtitle="Tie it to whatever it was for; leave the rest blank." onClose={onClose}
      footer={(
        <div className="flex justify-between gap-2">
          {entry ? <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" form="spend-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}>
      <form id="spend-form" onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><input type="date" className="input" value={f.spent_on} onChange={set('spent_on')} required /></Field>
          <Field label="Amount ($)"><input className="input" inputMode="decimal" value={f.amount} onChange={set('amount')} placeholder="0" required /></Field>
        </div>
        <Field label="What it was for"><input className="input" value={f.description} onChange={set('description')} placeholder="e.g. AUSA booth sponsorship" required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={f.category} onChange={set('category')}>
              <option value="">—</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Vendor"><input className="input" value={f.vendor} onChange={set('vendor')} /></Field>
        </div>

        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">Who or what it was for (optional)</legend>
          <Field label="Event">
            <select className="input" value={f.event_id} onChange={set('event_id')}>
              <option value="">None</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} · {longDate(ev.date_from)}</option>)}
            </select>
          </Field>
          <Field label="Pipeline ticket">
            {ticket ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{ticket.opportunity_title}{ticket.organization ? ` · ${ticket.organization}` : ''}</span>
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setF({ ...f, ticket_id: '' })}>Change</button>
              </div>
            ) : (
              <div>
                <input className="input" placeholder="Search pipeline tickets" value={ticketQ} onChange={(e) => setTicketQ(e.target.value)} />
                {matches.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slate-200">
                    {matches.map((t) => (
                      <li key={t.id}>
                        <button type="button" className="block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-brand-50" onClick={() => { setF({ ...f, ticket_id: t.id }); setTicketQ(''); }}>
                          {t.opportunity_title} <span className="text-xs text-slate-500">{t.organization}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Field>
          <Field label="Person (e.g. the BD director)">
            <select className="input" value={f.user_id} onChange={set('user_id')}>
              <option value="">{ticket ? "The pipeline ticket's BD director" : f.event_id ? 'Split between who attends' : 'Nobody'}</option>
              {people.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Territory">
              <select className="input" value={f.territory_id} onChange={set('territory_id')}>
                <option value="">{ticket ? "The pipeline ticket's" : '—'}</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Account"><input className="input" value={f.organization} onChange={set('organization')} placeholder={ticket?.organization || 'Agency or organization'} /></Field>
          </div>
        </fieldset>
        <Field label="Note"><textarea className="input min-h-16" value={f.note} onChange={set('note')} /></Field>
      </form>
    </SidePanel>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
