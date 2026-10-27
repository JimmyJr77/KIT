import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, CalendarDays, Plane, ExternalLink, Check, MapPin, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, formatPhoneInput, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import LocationInput, { EMPTY_LOCATION, locationLabel } from '../components/LocationInput.jsx';

const money = (n) => usd(n).replace('.00', '');
const dateRange = (e) => {
  const year = { month: 'short', day: 'numeric', year: 'numeric' };
  if (e.date_from === e.date_to) return shortDate(e.date_from, year);
  return `${shortDate(e.date_from)} – ${shortDate(e.date_to, year)}`;
};
const EMPTY_EVENT = {
  name: '', date_from: '', date_to: '', description: '', goal: '', fee: '', website: '',
  poc_name: '', poc_phone: '', address: '', location: { ...EMPTY_LOCATION },
};

/** Conferences, industry days, and other events: who's going, and a one-click start on a travel estimate. */
export default function Events() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState('upcoming');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState(null);
  const [open, setOpen] = useState(null); // an event, or EMPTY_EVENT for a new one

  const load = () => api.get(`/events?scope=${scope}`).then((d) => setEvents(d.events));
  useEffect(() => { load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (events || []).filter((e) => {
    const s = q.trim().toLowerCase();
    return !s || [e.name, e.description, e.goal, locationLabel(e.location), e.address].filter(Boolean).join(' ').toLowerCase().includes(s);
  });

  const setAttending = async (e, attending) => {
    const r = await api.put(`/events/${e.id}/attending`, { attending });
    setEvents((xs) => xs.map((x) => (x.id === e.id ? r.event : x)));
    if (open?.id === e.id) setOpen(r.event);
  };

  // Start a travel estimate from the event, and count the planner as attending.
  const planTravel = async (e) => {
    if (!e.attendees.some((a) => a.id === user.id)) await api.put(`/events/${e.id}/attending`, { attending: true });
    navigate('/travel', { state: { fromEvent: e } });
  };

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Events" subtitle="Conferences, industry days, and other events worth attending.">
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)}
              className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search events…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => setOpen({ ...EMPTY_EVENT })} title="New event" aria-label="New event"
          className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
      </div>

      {events && !shown.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <CalendarDays size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'No events match your search.' : scope === 'past' ? 'No past events.' : 'No upcoming events yet. Click + to add one.'}
        </div>
      )}

      {shown.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3">Event</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Goal / benefit</th>
                <th className="px-4 py-3 text-right">Fee</th><th className="px-4 py-3">Knexus attendees</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const going = e.attendees.some((a) => a.id === user.id);
                return (
                  <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{e.name}</div>
                      {locationLabel(e.location) && <div className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={11} /> {locationLabel(e.location)}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{dateRange(e)}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-600"><p className="line-clamp-2">{e.goal || <span className="text-slate-300">—</span>}</p></td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{e.fee != null ? money(e.fee) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {e.attendees.length ? (
                        <div className="flex items-center gap-1.5">
                          <span className="flex -space-x-1.5">{e.attendees.slice(0, 5).map((a) => <Avatar key={a.id} user={a} size="xs" className="ring-2 ring-white" />)}</span>
                          <span className="text-xs text-slate-500">{e.attendees.length}</span>
                        </div>
                      ) : <span className="text-xs text-slate-300">No one yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <button type="button" onClick={() => setAttending(e, !going)}
                        className={`btn px-2.5 py-1 text-xs ${going ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : ''}`}>
                        {going ? <><Check size={13} /> Attending</> : 'I’m attending'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <EventPanel key={open.id ?? 'new'} event={open} onClose={() => setOpen(null)} onAttend={setAttending} onPlanTravel={planTravel}
          onSaved={(e) => { load(); setOpen(e); }} onDeleted={() => { setOpen(null); load(); }} />
      )}
    </div>
  );
}

/** View and edit one event; sign up as attending; start a travel estimate from it. */
function EventPanel({ event, onClose, onAttend, onPlanTravel, onSaved, onDeleted }) {
  const { user } = useAuth();
  const isNew = !event.id;
  const toForm = (e) => ({ ...EMPTY_EVENT, ...e, fee: e.fee ?? '', location: { ...EMPTY_LOCATION, ...e.location },
    ...Object.fromEntries(['description', 'goal', 'website', 'poc_name', 'poc_phone', 'address'].map((k) => [k, e[k] || ''])) });
  const [form, setForm] = useState(() => toForm(event));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(event));
  const going = event.attendees?.some((a) => a.id === user.id);
  const canDelete = !isNew && (event.created_by === user.id || user.role === 'admin');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const r = isNew ? await api.post('/events', form) : await api.put(`/events/${event.id}`, form);
      onSaved(r.event);
      return r.event;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const planTravel = async () => {
    const saved = dirty ? await save() : event;
    if (saved) onPlanTravel(saved);
  };
  const remove = async () => {
    if (!confirm(`Delete “${event.name}”? Trips planned from it are kept.`)) return;
    await api.del(`/events/${event.id}`);
    onDeleted();
  };
  const close = () => { if (!dirty || confirm('Discard your changes to this event?')) onClose(); };

  return (
    <SidePanel wide title={isNew ? 'New event' : event.name} subtitle={!isNew && `${dateRange(event)}${event.trip_count ? ` · ${event.trip_count} trip${event.trip_count === 1 ? '' : 's'} planned` : ''}`}
      onClose={close}
      footer={(
        <div className="space-y-2">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            {canDelete && <button type="button" className="btn-danger" onClick={remove} aria-label="Delete event" title="Delete event"><Trash2 size={15} /></button>}
            {!isNew && (
              <button type="button" className="btn" onClick={planTravel} disabled={busy} title="Start a travel estimate with this event’s dates and location">
                <Plane size={15} /> Create travel estimate
              </button>
            )}
            <button type="button" className="btn-primary flex-1" onClick={save} disabled={busy || (!isNew && !dirty)}>
              {busy ? 'Saving…' : isNew ? 'Add event' : 'Save changes'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        {!isNew && (
          <section className="rounded-lg bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Knexus attendees</span>
              <button type="button" onClick={() => onAttend(event, !going)}
                className={`btn px-2.5 py-1 text-xs ${going ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : ''}`}>
                {going ? <><Check size={13} /> You’re attending</> : 'I’m attending'}
              </button>
            </div>
            {event.attendees.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {event.attendees.map((a) => (
                  <li key={a.id} className="flex items-center gap-1.5 rounded-full bg-white py-0.5 pr-2.5 pl-0.5 text-xs ring-1 ring-slate-200">
                    <Avatar user={a} size="xs" /> {fullName(a)}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-xs text-slate-400">No one has signed up yet.</p>}
          </section>
        )}

        <Field label="Event name *"><input className="input" autoFocus={isNew} value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date from *">
            <input type="date" className="input" value={form.date_from}
              onChange={(e) => setForm((f) => ({ ...f, date_from: e.target.value, date_to: !f.date_to || f.date_to < e.target.value ? e.target.value : f.date_to }))} />
          </Field>
          <Field label="Date to"><input type="date" className="input" min={form.date_from} value={form.date_to} onChange={(e) => set('date_to', e.target.value)} /></Field>
        </div>
        <Field label="Description"><textarea className="input min-h-20" value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Goal / benefit of attendance">
          <textarea className="input min-h-20" placeholder="Who we want to meet, what we want to learn, which pursuits it supports…" value={form.goal} onChange={(e) => set('goal', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fee ($)"><input type="number" min="0" className="input" value={form.fee} onChange={(e) => set('fee', e.target.value)} /></Field>
          <Field label="Website">
            <div className="flex gap-1.5">
              <input className="input" placeholder="https://…" value={form.website} onChange={(e) => set('website', e.target.value)} />
              {event.website && !dirty && (
                <a href={event.website} target="_blank" rel="noreferrer" className="btn shrink-0 px-2" title="Open website" aria-label="Open website"><ExternalLink size={15} /></a>
              )}
            </div>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="POC name"><input className="input" value={form.poc_name} onChange={(e) => set('poc_name', e.target.value)} /></Field>
          <Field label="POC number"><input className="input" inputMode="tel" placeholder="xxx-xxx-xxxx" value={form.poc_phone} onChange={(e) => set('poc_phone', formatPhoneInput(e.target.value))} /></Field>
        </div>
        <Field label="Address"><input className="input" placeholder="Venue and street address" value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <LocationInput label="City (used for travel estimates)" value={form.location} onChange={(v) => set('location', v)} />
      </div>
    </SidePanel>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
