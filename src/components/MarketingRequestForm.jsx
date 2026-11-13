import { useEffect, useMemo, useRef, useState } from 'react';
import { Megaphone, CalendarDays, Ticket, CalendarCheck, CalendarPlus, X, Clock, MapPin, Paperclip, Pencil, ChevronDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate, ticketKind, todayIso } from '../lib/format.js';
import SidePanel from './SidePanel.jsx';
import MultiSelect from './MultiSelect.jsx';
import { useClickAway } from './UserCombobox.jsx';
import MeetingPanel, { meetingWhen } from './MeetingPanel.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });

/**
 * Ask Marketing for support: the one form used on the Marketing page and from every event, pipeline ticket, work ticket
 * and activity. A request has to say what it's for (an event, a ticket, or both), what's needed, why, and which leads,
 * opportunities or meetings it's about, so the marketing dollars that follow can be traced to them.
 * `eventId`, `ticket` ({ id, opportunity_title, ticket_type }) and `activity` ({ id, subject }) start it off tied to where it was opened.
 */
export default function MarketingRequestForm({ eventId = null, ticket = null, activity = null, onClose, onSaved }) {
  const [meta, setMeta] = useState(null);
  const [events, setEvents] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [form, setForm] = useState({
    title: '', category: eventId ? 'Event support' : '', due_date: '', details: '', justification: '', purpose: '',
    event_id: eventId || '', for_ticket_id: ticket?.id || '', activity_id: activity?.id || '',
    ticket_ids: ticket?.ticket_type === 'bid' ? [ticket.id] : [], meeting_ids: [],
  });
  const [purposeTouched, setPurposeTouched] = useState(false);
  const [scheduling, setScheduling] = useState(null); // null | 'new' | a meeting being edited in the scheduler pane
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    api.get('/marketing/meta').then(setMeta);
    api.get('/events?scope=all').then((d) => setEvents(d.events));
    api.get('/tickets?scope=all').then((d) => setTickets(d.tickets));
    api.get('/meetings').then((d) => setMeetings(d.meetings));
  }, []);

  const event = events.find((e) => e.id === Number(form.event_id));
  // The purpose comes from the event's goal, until someone edits it.
  useEffect(() => {
    if (!purposeTouched) setForm((f) => ({ ...f, purpose: event?.goal || '' }));
  }, [event?.id, event?.goal]); // eslint-disable-line react-hooks/exhaustive-deps

  const forTicket = tickets.find((t) => t.id === Number(form.for_ticket_id)) || (ticket && ticket.id === Number(form.for_ticket_id) ? ticket : null);
  const chooseTicket = (id) => setForm((f) => {
    const t = tickets.find((x) => x.id === Number(id));
    const ids = t && t.ticket_type === 'bid' && !f.ticket_ids.includes(t.id) ? [...f.ticket_ids, t.id] : f.ticket_ids;
    return { ...f, for_ticket_id: id, activity_id: Number(id) === ticket?.id ? activity?.id || '' : '', ticket_ids: ids };
  });

  const open = (t) => !t.archived || t.id === ticket?.id;
  const ticketOptions = useMemo(() => tickets.filter(open).map((t) => ({ value: t.id, label: t.opportunity_title, sub: t.organization || undefined, group: ticketKind(t) })), [tickets]); // eslint-disable-line react-hooks/exhaustive-deps
  const oppOptions = useMemo(() => tickets.filter((t) => t.ticket_type === 'bid' && (open(t) || form.ticket_ids.includes(t.id)))
    .map((t) => ({ value: t.id, label: t.opportunity_title, sub: [t.organization, t.deal_status !== 'open' && t.deal_status].filter(Boolean).join(' · ') || undefined })), [tickets, form.ticket_ids]); // eslint-disable-line react-hooks/exhaustive-deps
  // The event's schedule carries over on its own, and stays in step with the event after the request is sent. Other
  // meetings (the ticket's, or ones already ticked) are chosen by hand.
  const fromEvent = (m) => !!event && m.event_id === event.id;
  const listed = meetings.filter((m) => fromEvent(m) || (forTicket && m.ticket_id === forTicket.id) || form.meeting_ids.includes(m.id));
  const eventMeetings = listed.filter(fromEvent).length;
  const toggleMeeting = (id) => set('meeting_ids', form.meeting_ids.includes(id) ? form.meeting_ids.filter((x) => x !== id) : [...form.meeting_ids, id]);
  // A meeting saved in the scheduler joins the list, ticked.
  const meetingSaved = (m) => {
    setMeetings((xs) => (xs.some((x) => x.id === m.id) ? xs.map((x) => (x.id === m.id ? m : x)) : [...xs, m]).sort((x, y) => `${x.meeting_date}${x.meeting_time || '99'}`.localeCompare(`${y.meeting_date}${y.meeting_time || '99'}`)));
    setForm((f) => (f.meeting_ids.includes(m.id) || (f.event_id && m.event_id === Number(f.event_id)) ? f : { ...f, meeting_ids: [...f.meeting_ids, m.id] }));
    setScheduling(null);
  };

  const tied = !!form.event_id || !!form.for_ticket_id;
  const tiedTo = event?.name || forTicket?.opportunity_title || '';
  const named = form.ticket_ids.length + form.meeting_ids.length + eventMeetings > 0;
  const missing = !form.title.trim() ? 'Add a title' : !tied ? 'Choose the event or ticket this is for' : !form.details.trim() ? 'Say what you need'
    : !form.justification.trim() ? 'Add the justification' : !named ? 'Name a lead, opportunity or meeting' : '';

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/marketing/requests', form);
      window.dispatchEvent(new Event('kit:alerts'));
      onSaved?.(r);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <SidePanel title="Request marketing support" subtitle={meta && (meta.team.length ? `Alerts ${meta.team.map(fullName).join(', ')}` : 'No one is on the Marketing team yet')} onClose={onClose}
      onEscape={scheduling ? () => setScheduling(null) : onClose}
      rail={(
        <button type="button" onClick={() => setScheduling(scheduling ? null : 'new')} title="Meeting scheduler" aria-label="Meeting scheduler" aria-pressed={!!scheduling}
          className={`grid h-9 w-9 place-items-center rounded-md transition ${scheduling ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'}`}>
          <CalendarPlus size={18} />
        </button>
      )}
      drawer={scheduling && (
        <MeetingPanel key={scheduling.id ?? 'new'} meeting={scheduling === 'new' ? null : scheduling} event={event || null} ticket={forTicket || null}
          opportunities={oppOptions.filter((o) => form.ticket_ids.includes(o.value)).map((o) => ({ id: o.value, title: o.label }))}
          onClose={() => setScheduling(null)} onSaved={meetingSaved} />
      )}
      footer={(
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || missing}</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn-primary" onClick={submit} disabled={busy || !!missing}>
              <Megaphone size={15} /> {busy ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">What it’s for (an event, a ticket, or both) *</legend>
          <Field label="Event" icon={CalendarDays}>
            <EventPicker events={events} value={form.event_id} onChange={(id) => set('event_id', id)} />
          </Field>
          <Field label="Pipeline or work ticket" icon={Ticket}>
            {forTicket ? (
              <div className="flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{forTicket.opportunity_title} <span className="text-xs text-slate-500">{ticketKind(forTicket)}</span></span>
                <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => chooseTicket('')} aria-label="Clear the ticket"><X size={14} /></button>
              </div>
            ) : (
              <MultiSelect options={ticketOptions} value={[]} onChange={(v) => chooseTicket(v[0])} placeholder="Search tickets…" />
            )}
          </Field>
          {activity && Number(form.for_ticket_id) === ticket?.id && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!!form.activity_id} onChange={(e) => set('activity_id', e.target.checked ? activity.id : '')} />
              <CalendarCheck size={13} className="text-slate-400" /> For the activity “{activity.subject}”
            </label>
          )}
        </fieldset>

        <Field label="Title *"><input className="input" autoFocus value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Booth graphics and one-pager for AUSA" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type of help">
            <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">Choose…</option>
              {(meta?.requestCategories || []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Needed by"><input type="date" className="input" min={todayIso()} value={form.due_date} onChange={(e) => set('due_date', e.target.value)} /></Field>
        </div>
        <Field label="What you need from Marketing *">
          <textarea className="input min-h-28" value={form.details} onChange={(e) => set('details', e.target.value)}
            placeholder="What do you need, who’s it for, and where will it be used? Link any drafts or examples." />
        </Field>
        <Field label="Justification *">
          <textarea className="input min-h-20" value={form.justification} onChange={(e) => set('justification', e.target.value)}
            placeholder="Why it’s worth the time and money: the leads it should generate or the opportunity it should move." />
        </Field>
        {event && (
          <Field label="Purpose (from the event’s goal)">
            <textarea className="input min-h-16" value={form.purpose} onChange={(e) => { setPurposeTouched(true); set('purpose', e.target.value); }}
              placeholder="This event has no goal yet. Say why we’re going." />
          </Field>
        )}

        <fieldset className="space-y-3 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">The leads, opportunities or meetings it’s for (at least one) *</legend>
          <Field label="Leads and opportunities (pipeline tickets)">
            <MultiSelect options={oppOptions} value={form.ticket_ids} onChange={(v) => set('ticket_ids', v)} placeholder="Search pipeline tickets…" />
          </Field>
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="label mb-0">Meetings</span>
              <button type="button" className="btn px-2 py-1 text-xs" onClick={() => setScheduling('new')} title="Schedule a meeting: who, when, where, objectives and files">
                <CalendarPlus size={14} /> Schedule a meeting
              </button>
            </div>
            {eventMeetings > 0 && (
              <p className="mt-1 text-[11px] text-slate-500">{event.name}’s schedule comes with the request and stays in step with the event: meetings added, changed or removed there show up here.</p>
            )}
            {listed.length ? (
              <ul className="mt-1.5 space-y-1.5">
                {listed.map((m) => {
                  const auto = fromEvent(m);
                  const on = auto || form.meeting_ids.includes(m.id);
                  return (
                    <li key={m.id} className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm ${on ? 'border-brand-300 bg-brand-50/50' : 'border-slate-200 bg-white'}`}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={on} disabled={auto} onChange={() => toggleMeeting(m.id)}
                        title={auto ? 'On the event’s schedule, so it comes with the request' : undefined} aria-label={`This request is for the meeting ${m.title}`} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{m.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                          <span className="flex items-center gap-1"><Clock size={11} className="text-slate-400" /> {meetingWhen(m)}</span>
                          {m.place && <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" /> {m.place}</span>}
                          {m.files?.length > 0 && <span className="flex items-center gap-1"><Paperclip size={11} className="text-slate-400" /> {m.files.length}</span>}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-slate-500">With {m.people.map((p) => `${p.first_name} ${p.last_name || ''}`.trim()).join(', ')}</div>
                      </div>
                      <button type="button" className="btn-ghost shrink-0 p-1 text-slate-500" onClick={() => setScheduling(m)} title="Open in the scheduler" aria-label={`Edit ${m.title}`}><Pencil size={13} /></button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">
                {tiedTo ? `No meetings scheduled for ${tiedTo} yet.` : 'Choose an event or ticket to see its meetings.'} Use Schedule a meeting to set one up.
              </p>
            )}
          </div>
        </fieldset>
      </div>
    </SidePanel>
  );
}

/**
 * Pick an event by typing: upcoming events first, soonest at the top. Past events don't crowd the list, but typing finds
 * them too, marked as past.
 */
function EventPicker({ events, value, onChange }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => { setOpen(false); setQ(''); });
  const today = todayIso();
  const isPast = (e) => (e.date_to || e.date_from) < today;
  const chosen = events.find((e) => e.id === Number(value));
  const term = q.trim().toLowerCase();
  const hit = (e) => !term || `${e.name} ${longDate(e.date_from)}`.toLowerCase().includes(term);
  const upcoming = events.filter((e) => !isPast(e) && hit(e)).sort((a, b) => a.date_from.localeCompare(b.date_from));
  // Past events only once something is typed, most recent first.
  const past = term ? events.filter((e) => isPast(e) && hit(e)).sort((a, b) => b.date_from.localeCompare(a.date_from)) : [];
  const options = [...upcoming, ...past];
  const pick = (id) => { onChange(id); setOpen(false); setQ(''); };

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input className={`input truncate ${chosen && isPast(chosen) ? 'pr-24' : 'pr-14'} ${chosen && !open ? 'placeholder:text-slate-900' : ''}`} role="combobox" aria-expanded={open} aria-label="Event"
          placeholder={chosen ? `${chosen.name} · ${longDate(chosen.date_from)}` : 'Type to find an event…'}
          value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && open && options[0]) { e.preventDefault(); pick(options[0].id); }
            if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); setQ(''); }
          }} />
        <span className="absolute inset-y-0 right-2 flex items-center gap-1">
          {chosen && isPast(chosen) && !open && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">Past</span>}
          {chosen && <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => pick('')} aria-label="Clear the event"><X size={14} /></button>}
          <ChevronDown size={14} className="pointer-events-none text-slate-400" />
        </span>
      </div>
      {open && (
        <ul className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg" role="listbox">
          {options.map((e, i) => (
            <li key={e.id}>
              {isPast(e) && !isPast(options[i - 1] || {}) && (
                <div className={`px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-amber-700 uppercase ${i ? 'mt-1 border-t border-slate-100' : ''}`}>Past events</div>
              )}
              <button type="button" role="option" aria-selected={e.id === Number(value)} onClick={() => pick(e.id)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-brand-50 ${isPast(e) ? 'bg-amber-50/60 text-slate-600' : ''} ${e.id === Number(value) ? 'font-semibold' : ''}`}>
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{longDate(e.date_from)}</span>
                {isPast(e) && <span className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800">Past</span>}
              </button>
            </li>
          ))}
          {!options.length && <li className="px-3 py-2 text-sm text-slate-400">{term ? 'No event matches.' : 'No upcoming events. Type to find a past one.'}</li>}
        </ul>
      )}
    </div>
  );
}

/** A button that opens the request form tied to where it sits. */
export function MarketingButton({ eventId, ticket, activity, onSaved, className = 'btn px-2.5 py-1 text-xs', label = 'Request marketing support' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Ask the Marketing team for support"><Megaphone size={13} /> {label}</button>
      {open && <MarketingRequestForm eventId={eventId} ticket={ticket} activity={activity} onClose={() => setOpen(false)} onSaved={(r) => { setOpen(false); onSaved?.(r); }} />}
    </>
  );
}

function Field({ label, icon: Icon, children }) {
  return <div><label className="label flex items-center gap-1">{Icon && <Icon size={12} className="text-slate-400" />}{label}</label>{children}</div>;
}
