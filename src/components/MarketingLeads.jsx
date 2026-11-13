import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sprout, Plus, Pencil, Hand, Ticket, CalendarDays, Trash2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { ago, fullName, fullStamp, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import Avatar from './Avatar.jsx';
import SidePanel from './SidePanel.jsx';
import MultiSelect from './MultiSelect.jsx';
import { LabelChip } from './Labels.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const stateOf = (l) => (l.ticket_id ? 'ticket' : l.closed_at ? 'closed' : l.claimed_by ? 'claimed' : 'open');
const FILTERS = [['open', 'Unclaimed'], ['claimed', 'Claimed'], ['ticket', 'Pipeline tickets'], ['all', 'All']];

/**
 * Leads Marketing feeds the team. Marketing writes each one; anyone claims a lead by putting their name on it, then turns
 * it into a pipeline ticket (or ties it to one that already exists), which is tagged as sourced by Marketing (and by its
 * event, if it came from one).
 */
export default function MarketingLeads({ onCount }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('open');
  const [editing, setEditing] = useState(null); // {} for new, a lead to edit
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [linking, setLinking] = useState(null); // the lead being tied to an existing pipeline ticket
  const [tickets, setTickets] = useState(null);
  useEffect(() => { if (linking && !tickets) api.get('/tickets?scope=all&kind=bid').then((d) => setTickets(d.tickets)); }, [linking]); // eslint-disable-line react-hooks/exhaustive-deps
  const apply = (d) => { setData((x) => ({ ...x, ...d })); onCount?.(d.leads.filter((l) => stateOf(l) === 'open').length); };
  useEffect(() => { api.get('/marketing/leads').then(apply); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (l, call) => {
    setBusy(l.id);
    setError('');
    try { return apply(await call()); } catch (e) { setError(e.message); } finally { setBusy(null); }
  };
  const claim = (l, on) => run(l, () => api.put(`/marketing/leads/${l.id}/claim`, { claim: on }));
  const makeTicket = async (l, ticketId) => {
    setBusy(l.id);
    setError('');
    try {
      const r = await api.post(`/marketing/leads/${l.id}/ticket`, ticketId ? { ticket_id: ticketId } : {});
      navigate(`/tickets?open=${r.ticket_id}`);
    } catch (e) { setError(e.message); setBusy(null); }
  };

  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const shown = data.leads.filter((l) => filter === 'all' || stateOf(l) === filter);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${filter === k ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
              {label} <span className="opacity-70">{data.leads.filter((l) => k === 'all' || stateOf(l) === k).length}</span>
            </button>
          ))}
        </div>
        {data.canManage && <button type="button" className="btn-primary" onClick={() => setEditing({})}><Plus size={15} /> Add lead</button>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!shown.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Sprout size={28} className="mx-auto mb-2 text-slate-300" />
          <p className="mx-auto max-w-md text-sm">
            {filter === 'open' ? 'No unclaimed leads.' : 'Nothing here yet.'} {data.canManage ? 'Add a lead for the team to claim.' : 'The Marketing team adds leads here for anyone to claim.'}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(22rem,1fr))] gap-4">
          {shown.map((l) => {
            const state = stateOf(l);
            const mine = l.claimed_by === user.id;
            return (
              <li key={l.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900">{l.title}</h3>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      {l.organization && <span>{l.organization}</span>}
                      {l.value != null && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{usd(l.value).replace('.00', '')}</span>}
                      {l.event_id && (
                        <button type="button" onClick={() => navigate(`/events?open=${l.event_id}`)} className="flex items-center gap-1 text-sky-700 hover:underline">
                          <CalendarDays size={12} /> {l.event_name}
                        </button>
                      )}
                    </div>
                  </div>
                  {data.canManage && state !== 'ticket' && (
                    <button type="button" className="btn-ghost p-1.5 text-slate-500" onClick={() => setEditing(l)} title="Edit lead" aria-label={`Edit ${l.title}`}><Pencil size={14} /></button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1"><LabelChip name="Marketing Lead" />{l.event_id && <LabelChip name="Event Lead" />}</div>
                {l.contact && <p className="mt-2 text-xs text-slate-600"><span className="font-medium text-slate-500">Contact:</span> {l.contact}</p>}
                {l.details && <p className="mt-2 flex-1 text-sm whitespace-pre-wrap text-slate-700">{l.details}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
                    {l.claimed_by_user ? (
                      <><Avatar user={l.claimed_by_user} size="xs" /><span className="font-medium text-slate-700">{fullName(l.claimed_by_user)}</span><span title={fullStamp(l.claimed_at)}>claimed it {ago(l.claimed_at)}</span></>
                    ) : (
                      <span title={fullStamp(l.created_at)}>{l.closed_at ? 'Set aside' : 'Unclaimed'} · from {fullName(l.created_by_user) || 'Marketing'} {ago(l.created_at)}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {state === 'ticket' && (
                      <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => navigate(`/tickets?open=${l.ticket_id}`)}>
                        <Ticket size={13} /> {l.ticket_status === 'won' ? 'Won' : l.ticket_status === 'lost' ? 'Lost' : 'Open'} pipeline ticket
                      </button>
                    )}
                    {(state === 'open' || state === 'closed') && (
                      <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => claim(l, true)} disabled={busy === l.id}><Hand size={13} /> Claim it</button>
                    )}
                    {state === 'claimed' && (mine || data.canManage) && (
                      <>
                        <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500" onClick={() => claim(l, false)} disabled={busy === l.id}>Release</button>
                        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setLinking(linking === l.id ? null : l.id)} disabled={busy === l.id}
                          title="The deal already exists: tie this lead to its pipeline ticket">Tie to a ticket</button>
                        {!data.pipelineTicketsClosed && (
                          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => makeTicket(l)} disabled={busy === l.id}>
                            {busy === l.id ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : <><Ticket size={13} /> Create pipeline ticket</>}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {linking === l.id && state === 'claimed' && (
                  <div className="mt-2">
                    <MultiSelect options={(tickets || []).filter((t) => !t.archived).map((t) => ({ value: t.id, label: t.opportunity_title, sub: t.organization || undefined }))}
                      value={[]} onChange={(v) => makeTicket(l, v[0])} placeholder={tickets ? 'Search pipeline tickets…' : 'Loading…'} />
                    <p className="mt-1 text-[11px] text-slate-400">The ticket is tagged Marketing Lead{l.event_id ? ' and Event Lead' : ''}.</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && <LeadForm key={editing.id ?? 'new'} lead={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={(d) => { apply(d); setEditing(null); }} />}
    </div>
  );
}

function LeadForm({ lead, onClose, onSaved }) {
  const [f, setF] = useState({
    title: lead?.title || '', organization: lead?.organization || '', contact: lead?.contact || '', details: lead?.details || '',
    value: lead?.value ?? '', event_id: lead?.event_id || '', closed: !!lead?.closed_at,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const events = useApi('/events?scope=all').data?.events || [];
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = async () => {
    setBusy(true);
    setError('');
    try { onSaved(await (lead ? api.put(`/marketing/leads/${lead.id}`, f) : api.post('/marketing/leads', f))); } catch (e) { setError(e.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Delete the lead “${lead.title}”?`)) return;
    setBusy(true);
    try { onSaved(await api.del(`/marketing/leads/${lead.id}`)); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <SidePanel title={lead ? 'Edit lead' : 'Add a lead'} subtitle="Anyone on the team can claim it and turn it into a pipeline ticket" onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-2">
          {lead ? <button type="button" className="btn-danger" onClick={remove} disabled={busy}><Trash2 size={15} /> Delete</button> : <span />}
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-red-600">{error}</span>}
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !f.title.trim()}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <Field label="Lead *"><input className="input" autoFocus value={f.title} onChange={set('title')} placeholder="e.g. Army G-6 wants a demo of the analytics tool" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Organization"><input className="input" value={f.organization} onChange={set('organization')} placeholder="Agency or company" /></Field>
          <Field label="Rough value ($)"><input className="input" inputMode="decimal" value={f.value} onChange={set('value')} /></Field>
        </div>
        <Field label="Who to talk to"><input className="input" value={f.contact} onChange={set('contact')} placeholder="Name, title, email or phone" /></Field>
        <Field label="Event it came from">
          <select className="input" value={f.event_id} onChange={set('event_id')}>
            <option value="">None</option>
            {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} · {longDate(ev.date_from)}</option>)}
          </select>
        </Field>
        <Field label="Details"><textarea className="input min-h-32" value={f.details} onChange={set('details')} placeholder="How it came in, what they asked for, and what to do next." /></Field>
        {lead && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={f.closed} onChange={set('closed')} /> Set aside (not worth pursuing)
          </label>
        )}
      </div>
    </SidePanel>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
