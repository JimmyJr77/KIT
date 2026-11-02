import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, CalendarDays, Plane, ExternalLink, Check, MapPin, Trash2, Megaphone, Ticket, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, formatPhoneInput, shortDate, stamp, fullStamp } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { useApi } from '../lib/data.js';
import MultiSelect from '../components/MultiSelect.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import LocationInput, { EMPTY_LOCATION, locationLabel } from '../components/LocationInput.jsx';
import { PotentialEvents, EventSearch } from './EventScout.jsx';

const money = (n) => usd(n).replace('.00', '');
const dateRange = (e) => {
  const year = { month: 'short', day: 'numeric', year: 'numeric' };
  if (e.date_from === e.date_to) return shortDate(e.date_from, year);
  return `${shortDate(e.date_from)} – ${shortDate(e.date_to, year)}`;
};
const EMPTY_EVENT = {
  name: '', date_from: '', date_to: '', description: '', goal: '', notes: '', rep_ids: [], fee: '', website: '',
  poc_name: '', poc_phone: '', address: '', location: { ...EMPTY_LOCATION },
};
/** A new event, filled in from a potential event or a search suggestion. */
const asEvent = (c) => ({
  ...EMPTY_EVENT,
  ...Object.fromEntries(Object.keys(EMPTY_EVENT).filter((k) => c[k] != null && k !== 'rep_ids').map((k) => [k, c[k]])),
  date_to: c.date_to || c.date_from || '', location: { ...EMPTY_LOCATION, ...c.location },
});

/** Conferences, industry days, and other events: who's going, and a one-click start on a travel estimate. */
export default function Events() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scope, setScope] = useState('upcoming');
  const [q, setQ] = useState('');
  const [events, setEvents] = useState(null);
  const [open, setOpen] = useState(null); // an event, or EMPTY_EVENT for a new one
  const [scout, setScout] = useState({ candidates: null, configured: true });
  const [adding, setAdding] = useState(null); // { candidateId, onDone } while a potential event is being added to Events

  const load = () => api.get(`/events?scope=${scope}`).then((d) => setEvents(d.events));
  useEffect(() => { load(); }, [scope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.get('/event-scout').then(setScout); }, []);
  const setCandidates = (fn) => setScout((x) => ({ ...x, candidates: typeof fn === 'function' ? fn(x.candidates || []) : fn }));

  // Adding a potential event or a search suggestion opens it as a new event to check and save.
  const addToEvents = (c, onDone) => { setAdding({ candidateId: onDone ? null : c.id, onDone }); setOpen(asEvent(c)); };
  const openEvent = (id) => api.get('/events?scope=all').then((d) => { const e = d.events.find((x) => x.id === id); if (e) setOpen(e); });
  const saved = async (e) => {
    if (adding && !open?.id) {
      if (adding.candidateId) {
        await api.put(`/event-scout/${adding.candidateId}/added`, { event_id: e.id });
        setCandidates((xs) => xs.filter((x) => x.id !== adding.candidateId));
      }
      adding.onDone?.();
      setAdding(null);
    }
    load();
    setOpen(e);
  };

  // Links from alerts land here with ?open=<event id>.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(params.get('open'));
    if (!id) return;
    api.get('/events?scope=all').then((d) => {
      const e = d.events.find((x) => x.id === id);
      if (e) setOpen(e);
      setParams({}, { replace: true });
    });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (events || []).filter((e) => {
    const s = q.trim().toLowerCase();
    return !s || [e.name, e.description, e.goal, e.notes, ...(e.reps || []).map(fullName), locationLabel(e.location), e.address].filter(Boolean).join(' ').toLowerCase().includes(s);
  });

  const [dialog, setDialog] = useState(null); // { title, body, buttons, resolve }
  const ask = (d) => new Promise((resolve) => setDialog({ ...d, resolve }));
  const put = async (e, body) => {
    const r = await api.put(`/events/${e.id}/attending`, body);
    setEvents((xs) => xs.map((x) => (x.id === e.id ? r.event : x)));
    if (open?.id === e.id) setOpen(r.event);
    return r.event;
  };

  /**
   * Going and maybe both come with a travel request. Signing up asks whether you'll expense anything (no expenses, no
   * sign-up), then opens your travel request on the Travel page. Switching between going and maybe keeps the request;
   * taking yourself off asks whether to erase it.
   */
  const setAttendance = async (e, status) => {
    const mine = e.attendees.find((a) => a.id === user.id);
    if (mine?.status === status) {
      let erase = false;
      if (mine.trip) {
        const a = await ask({ title: 'Erase your travel request?', body: `You’re taking yourself off “${e.name}”. Do you also want to erase your travel request for it?`,
          buttons: [['cancel', 'Cancel'], ['keep', 'Keep request'], ['erase', 'Erase request', 'danger']] });
        if (a === 'cancel') return;
        erase = a === 'erase';
      }
      return put(e, { status: null, erase_trip: erase });
    }
    if (mine) return put(e, { status });
    const a = await ask({ title: 'Will you expense anything?', body: `Do you expect to expense anything to the company for “${e.name}”: travel, lodging, meals, or the event fee?`,
      buttons: [['cancel', 'Cancel'], ['no', 'No'], ['yes', 'Yes', 'primary']] });
    if (a === 'no') {
      return ask({ title: 'Attendance not recorded', body: 'Signing up for an event comes with a travel request for what you’ll expense to the company. Since you don’t expect to expense anything, you haven’t been signed up.',
        buttons: [['ok', 'OK', 'primary']] });
    }
    if (a !== 'yes') return;
    const ev = await put(e, { status });
    const trip = ev.attendees.find((x) => x.id === user.id)?.trip;
    navigate('/travel', { state: trip ? { openTrip: trip.id } : { fromEvent: ev } });
  };

  // Start a travel estimate from the event, and count the planner as going.
  const planTravel = async (e) => {
    if (!e.attendees.some((a) => a.id === user.id)) await api.put(`/events/${e.id}/attending`, { status: 'going' });
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
                <th className="px-4 py-3">Event</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Knexus rep/POC</th><th className="px-4 py-3">Goal / benefit</th>
                <th className="px-4 py-3 text-right">Fee</th><th className="px-4 py-3">Knexus attendees</th><th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const maybes = e.attendees.filter((a) => a.status === 'maybe').length;
                return (
                  <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{e.name}</div>
                      {locationLabel(e.location) && <div className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={11} /> {locationLabel(e.location)}</div>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-700">{dateRange(e)}</td>
                    <td className="px-4 py-3 text-slate-700">{e.reps?.length ? e.reps.map(fullName).join(', ') : <span className="text-slate-300">—</span>}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-600"><p className="line-clamp-2">{e.goal || <span className="text-slate-300">—</span>}</p></td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{e.fee != null ? money(e.fee) : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3">
                      {e.attendees.length ? (
                        <div className="flex items-center gap-1.5">
                          <span className="flex -space-x-1.5">{e.attendees.slice(0, 5).map((a) => <AttendeeAvatar key={a.id} user={a} />)}</span>
                          <span className="text-xs text-slate-500">{[e.attendees.length - maybes || null, maybes && `${maybes} maybe`].filter(Boolean).join(' + ')}</span>
                        </div>
                      ) : <span className="text-xs text-slate-300">No one yet</span>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                      <AttendButtons event={e} userId={user.id} onSet={setAttendance} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <EventPanel key={open.id ?? `new-${open.name}`} event={open} onClose={() => { setOpen(null); setAdding(null); }} onAttend={setAttendance} onPlanTravel={planTravel}
          onUpdated={(e) => { setOpen(e); setEvents((xs) => xs?.map((x) => (x.id === e.id ? e : x))); }}
          onSaved={saved} onDeleted={() => { setOpen(null); load(); }} />
      )}
      {dialog && <Dialog {...dialog} onAnswer={(v) => { setDialog(null); dialog.resolve(v); }} />}

      <PotentialEvents candidates={scout.candidates} setCandidates={setCandidates} configured={scout.configured} onAddToEvents={(c) => addToEvents(c)} />
      <EventSearch configured={scout.configured} onAddToEvents={addToEvents} onOpenEvent={openEvent}
        onAddedToPotential={(c) => setCandidates((xs) => [...xs, c])} />
    </div>
  );
}

/** View and edit one event; sign up as attending; start a travel estimate from it. */
function EventPanel({ event, onClose, onAttend, onPlanTravel, onSaved, onDeleted, onUpdated }) {
  const { user } = useAuth();
  const isNew = !event.id;
  const users = useApi('/users');
  const toForm = (e) => ({ ...EMPTY_EVENT, ...e, fee: e.fee ?? '', location: { ...EMPTY_LOCATION, ...e.location },
    rep_ids: (e.reps || []).map((r) => r.id), reps: undefined, attendees: undefined, support: undefined,
    ...Object.fromEntries(['description', 'goal', 'notes', 'website', 'poc_name', 'poc_phone', 'address'].map((k) => [k, e[k] || ''])) });
  const [form, setForm] = useState(() => toForm(event));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(event));
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
              <AttendButtons event={event} userId={user.id} onSet={onAttend} />
            </div>
            {event.attendees.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {event.attendees.map((a) => (
                  <li key={a.id} className={`flex items-center gap-1.5 rounded-full bg-white py-0.5 pr-2.5 pl-0.5 text-xs ${a.status === 'maybe' ? 'border border-dashed border-slate-400' : 'ring-1 ring-slate-200'}`}
                    title={a.trip ? `Travel request ${APPROVAL[a.trip.approval] || 'saved'}` : 'No travel request yet'}>
                    <AttendeeAvatar user={a} /> {fullName(a)}
                    {a.status === 'maybe' && <span className="text-slate-400">maybe</span>}
                    {a.trip?.approval && <span className={`h-1.5 w-1.5 rounded-full ${APPROVAL_DOT[a.trip.approval]}`} />}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1.5 text-xs text-slate-400">No one has signed up yet.</p>}
          </section>
        )}

        {!isNew && <SupportSection event={event} onUpdated={onUpdated} />}

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
        <Field label="Notes">
          <textarea className="input min-h-20" placeholder="Who we're going with, sponsorships, overlaps with other events…" value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <Field label="Knexus Event Rep/POC">
          <MultiSelect options={(users.data?.users || []).filter((u) => u.active !== 0).map((u) => ({ value: u.id, label: fullName(u), sub: u.title }))}
            value={form.rep_ids} onChange={(v) => set('rep_ids', v)} placeholder="Who at Knexus owns this event…" />
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

/** Ask Marketing for support at the event; Marketing turns each request into a work ticket linked back here. */
function SupportSection({ event, onUpdated }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState(null); // { team, canTake }
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(null); // 'request' | request id being taken
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get('/events/support-team').then(setTeam); }, []);

  const request = async () => {
    if (!details.trim()) return;
    setBusy('request');
    setError('');
    try {
      const r = await api.post(`/events/${event.id}/support`, { details });
      setDetails('');
      setNote(r.notified ? `Sent to ${r.notified} ${r.notified === 1 ? 'person' : 'people'} on the Marketing team.` : 'Saved, but no one is on the Marketing team to alert yet.');
      onUpdated(r.event);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };
  const take = async (q) => {
    setBusy(q.id);
    setError('');
    try {
      const r = await api.post(`/events/support/${q.id}/accept`, {});
      onUpdated(r.event);
      navigate(`/tickets?open=${r.ticket_id}`);
    } catch (e) {
      setError(e.message);
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Megaphone size={13} /> Marketing support</h3>

      {event.support.length > 0 && (
        <ul className="mt-2 space-y-2">
          {event.support.map((q) => (
            <li key={q.id} className="rounded-md bg-slate-50 p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words whitespace-pre-wrap text-slate-800">{q.details}</p>
                {q.status === 'accepted'
                  ? <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Work ticket created</span>
                  : <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Waiting on Marketing</span>}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                <Avatar user={q.requested_by} size="xs" />
                <span>{fullName(q.requested_by) || 'Someone'} asked</span>
                <span title={fullStamp(q.created_at)}>· {stamp(q.created_at)}</span>
                {q.accepted_by && <span>· taken by {fullName(q.accepted_by)}</span>}
              </div>
              {q.ticket_id ? (
                <button type="button" onClick={() => navigate(`/tickets?open=${q.ticket_id}`)} className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                  <Ticket size={12} /> {q.ticket_title || 'Open work ticket'}
                </button>
              ) : team?.canTake && (
                <button type="button" className="btn-primary mt-2 px-2.5 py-1 text-xs" onClick={() => take(q)} disabled={!!busy}>
                  {busy === q.id ? <><Loader2 size={12} className="animate-spin" /> Creating…</> : <><Ticket size={12} /> Take it: create work ticket</>}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 space-y-2">
        <textarea className="input min-h-16 text-sm" value={details} onChange={(e) => setDetails(e.target.value)} disabled={busy === 'request'}
          placeholder="What do you need? Booth graphics, one-pagers, swag, social posts, a sponsorship…" />
        <div className="flex items-center justify-between gap-2">
          <span className={`text-[11px] ${error ? 'text-red-600' : note ? 'text-emerald-700' : 'text-slate-400'}`}>
            {error || note || (team && (team.team.length
              ? `Alerts ${team.team.map(fullName).join(', ')}`
              : 'No one is on the Marketing team yet. An admin can assign people to it under Admin Access.'))}
          </span>
          <button type="button" className="btn shrink-0 px-2.5 py-1 text-xs" onClick={request} disabled={!details.trim() || busy === 'request'}>
            <Megaphone size={13} /> {busy === 'request' ? 'Sending…' : 'Request marketing support'}
          </button>
        </div>
      </div>
    </section>
  );
}

const APPROVAL = { pending: 'awaiting approval', approved: 'approved', declined: 'declined' };
const APPROVAL_DOT = { pending: 'bg-amber-400', approved: 'bg-emerald-500', declined: 'bg-red-500' };

/** Initials for someone signed up; a dashed ring marks a maybe. */
function AttendeeAvatar({ user }) {
  return <Avatar user={user} size="xs" className={user.status === 'maybe' ? 'border-[1.5px] border-dashed border-slate-600 ring-2 ring-white' : 'ring-2 ring-white'} />;
}

/** Maybe and I'm attending: one at a time. Selecting the one you're on takes you off. */
function AttendButtons({ event, userId, onSet }) {
  const mine = event.attendees?.find((a) => a.id === userId)?.status;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" aria-pressed={mine === 'maybe'} onClick={() => onSet(event, 'maybe')}
        className={`btn px-2.5 py-1 text-xs ${mine === 'maybe' ? 'border-dashed border-slate-500 bg-slate-50 text-slate-800 hover:bg-slate-100' : ''}`}>
        {mine === 'maybe' && <Check size={13} />} Maybe
      </button>
      <button type="button" aria-pressed={mine === 'going'} onClick={() => onSet(event, 'going')}
        className={`btn px-2.5 py-1 text-xs ${mine === 'going' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : ''}`}>
        {mine === 'going' ? <><Check size={13} /> Attending</> : 'I’m attending'}
      </button>
    </span>
  );
}

/** A small modal question. buttons: [[value, label, 'primary' | 'danger']]; Escape or the backdrop answers 'cancel'. */
function Dialog({ title, body, buttons, onAnswer }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onAnswer('cancel'); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onAnswer]);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && onAnswer('cancel')}>
      <div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 id="dialog-title" className="text-base font-semibold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          {buttons.map(([value, label, kind], i) => (
            <button key={value} type="button" autoFocus={i === buttons.length - 1} onClick={() => onAnswer(value)}
              className={kind === 'primary' ? 'btn-primary' : kind === 'danger' ? 'btn-danger' : 'btn'}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="label">{label}</label>{children}</div>;
}
