import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CalendarPlus, Megaphone, Plus, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate } from '../lib/format.js';
import { fullMoney } from '../components/Charts.jsx';
import MarketingRequestForm, { MarketingButton, EventPicker } from '../components/MarketingRequestForm.jsx';
import { RequestTies } from '../components/MarketingImpact.jsx';
import { DrawerShell } from './TicketPlanning.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const heading = 'mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase';

/** A marketing request as a card: what was asked, where it stands, what it's tied to, and who asked. */
function RequestCard({ request: r, ticket }) {
  return (
    <li className="rounded-md bg-white p-2.5 text-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-slate-900">{r.title || 'Marketing support'}</div>
        {r.status === 'accepted'
          ? <Link to={`/tickets?open=${r.ticket_id}`} className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 hover:underline">Work ticket</Link>
          : <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Waiting on Marketing</span>}
      </div>
      <p className="mt-1 line-clamp-3 text-xs whitespace-pre-wrap text-slate-600">{r.details}</p>
      <div className="mt-1.5"><RequestTies request={{ ...r, for_ticket: r.for_ticket?.id === ticket.id ? null : r.for_ticket, tickets: r.tickets.filter((t) => t.id !== ticket.id) }} /></div>
      <div className="mt-1.5 text-[11px] text-slate-400">
        {fullName(r.requested_by) || 'Someone'} asked {longDate(r.created_at.slice(0, 10))}{r.spent > 0 && <span className="text-emerald-700"> · {fullMoney(r.spent)} spent</span>}
      </div>
    </li>
  );
}

/** Marketing on a ticket. A pipeline ticket has its own pane (see PipelineMarketing); a work ticket lists its requests under a button to make one. */
export function MarketingDrawer({ ticket, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const load = () => api.get(`/marketing/ticket/${ticket.id}`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ticket.ticket_type === 'bid') return <PipelineMarketing ticket={ticket} data={data} reload={load} onClose={onClose} onChanged={onChanged} />;
  return (
    <DrawerShell title="Marketing" subtitle={ticket.opportunity_title} onClose={onClose}>
      <div className="mb-4"><MarketingButton ticket={ticket} className="btn-primary w-full justify-center" onSaved={() => { load(); onChanged?.(); }} /></div>
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <section>
          <h4 className={heading}>Marketing requests</h4>
          {data.requests.length
            ? <ul className="space-y-2">{data.requests.map((r) => <RequestCard key={r.id} request={r} ticket={ticket} />)}</ul>
            : <p className="flex items-center gap-1.5 text-xs text-slate-400"><Megaphone size={13} /> Nothing asked of Marketing for this ticket yet.</p>}
        </section>
      )}
    </DrawerShell>
  );
}

/**
 * A pipeline ticket's Marketing pane: two buttons. Request marketing support opens the request form right here in the pane,
 * and once it's sent the pane shows the request as a card. Associate an event ties the ticket to an event from the list,
 * or to a new one made on the spot. The events and requests already on the ticket are listed under the buttons.
 */
function PipelineMarketing({ ticket, data, reload, onClose, onChanged }) {
  const [view, setView] = useState('home'); // home | request | event
  const [error, setError] = useState('');
  const changed = () => { reload(); onChanged?.(); };
  if (view === 'request') {
    return <MarketingRequestForm embedded ticket={ticket} onClose={() => setView('home')} onSaved={() => { changed(); setView('home'); }} />;
  }
  if (view === 'event') {
    return <AssociateEvent ticket={ticket} tied={(data?.events || []).map((e) => e.id)} onClose={() => setView('home')} onSaved={() => { changed(); setView('home'); }} />;
  }
  const untie = async (e) => {
    if (!confirm(`Take “${e.name}” off this ticket? The event itself stays.`)) return;
    setError('');
    try { await api.del(`/events/${e.id}/tickets/${ticket.id}`); changed(); } catch (x) { setError(x.message); }
  };
  return (
    <DrawerShell title="Marketing" subtitle={ticket.opportunity_title} onClose={onClose}>
      <div className="space-y-2">
        <button type="button" className="btn-primary w-full justify-center" onClick={() => setView('request')} title="Ask the Marketing team for support"><Megaphone size={15} /> Request marketing support</button>
        <button type="button" className="btn w-full justify-center" onClick={() => setView('event')} title="Tie this ticket to an event from the list, or add a new event"><CalendarPlus size={15} /> Associate an event</button>
      </div>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data?.events.length > 0 && (
        <section className="mt-5">
          <h4 className={heading}>Associated events</h4>
          <ul className="space-y-1">
            {data.events.map((e) => (
              <li key={e.id} className="group flex items-center gap-2 text-sm">
                <Link to={`/events?open=${e.id}`} className="flex min-w-0 items-center gap-1 text-sky-700 hover:underline"><CalendarDays size={13} className="shrink-0" /> <span className="truncate">{e.name}</span></Link>
                <span className="shrink-0 text-xs text-slate-400">{longDate(e.date_from)}</span>
                <button type="button" onClick={() => untie(e)} className="ml-auto shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-slate-600" title="Take this event off the ticket" aria-label={`Take ${e.name} off this ticket`}><X size={13} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {data?.requests.length > 0 && (
        <section className="mt-5">
          <h4 className={heading}>Marketing requests</h4>
          <ul className="space-y-2">{data.requests.map((r) => <RequestCard key={r.id} request={r} ticket={ticket} />)}</ul>
        </section>
      )}
    </DrawerShell>
  );
}

/** Tie a pipeline ticket to an event: pick one from the event list, or add a new one (its name and dates; the rest is filled in on the Events page). */
function AssociateEvent({ ticket, tied, onClose, onSaved }) {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', date_from: '', date_to: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/events?scope=all').then((d) => setEvents(d.events)).catch((e) => setError(e.message)); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const ready = adding ? form.name.trim() && form.date_from : !!eventId;
  const save = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError('');
    try {
      const id = adding ? (await api.post('/events', form)).event.id : eventId;
      await api.put(`/events/${id}/tickets/${ticket.id}`, {});
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <DrawerShell title="Associate an event" subtitle={ticket.opportunity_title} onClose={onClose}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-red-600">{error}</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={save} disabled={busy || !ready}><CalendarPlus size={15} /> {busy ? 'Saving…' : adding ? 'Add and associate' : 'Associate'}</button>
          </div>
        </div>
      )}>
      <button type="button" onClick={onClose} className="mb-3 flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><ArrowLeft size={13} /> Back to Marketing</button>
      {adding ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div><label className="label">Event name *</label><input className="input" autoFocus value={form.name} onChange={set('name')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Date from *</label><input type="date" className="input" value={form.date_from} onChange={set('date_from')} /></div>
            <div><label className="label">Date to</label><input type="date" className="input" min={form.date_from} value={form.date_to} onChange={set('date_to')} /></div>
          </div>
          <p className="text-xs text-slate-500">The event joins the Events list. Add its location, goal and the rest there.</p>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setAdding(false)}>Choose from the event list instead</button>
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="label">Event</label>
            <EventPicker events={events.filter((e) => !tied.includes(e.id))} value={eventId} onChange={setEventId} />
          </div>
          <button type="button" className="btn w-full justify-center text-sm" onClick={() => setAdding(true)}><Plus size={14} /> Add a new event</button>
        </div>
      )}
    </DrawerShell>
  );
}
