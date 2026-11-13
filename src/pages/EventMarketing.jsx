import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Megaphone, Ticket, Loader2, Plus, Pencil, Trash2, Clock, MapPin, Handshake, Target, X, CalendarPlus, Paperclip } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate, stamp, fullStamp } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { canEditTicket } from '../lib/ticketAccess.js';
import Avatar from '../components/Avatar.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import { MarketingButton } from '../components/MarketingRequestForm.jsx';
import { RequestTies } from '../components/MarketingImpact.jsx';

const money = (n) => usd(n).replace('.00', '');
const dayLabel = (iso) => shortDate(iso, { weekday: 'long', month: 'short', day: 'numeric' });
const timeLabel = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : 'Time to be set');
const personName = (p) => `${p.first_name} ${p.last_name || ''}`.trim();
const heading = 'flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase';
const reload = (event, onUpdated) => api.get(`/events/${event.id}`).then((d) => onUpdated(d.event));

/** Ask Marketing for support at the event; Marketing turns each request into a work ticket linked back here. */
export function SupportSection({ event, onUpdated }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState(null); // { team, canTake }
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { api.get('/events/support-team').then(setTeam); }, []);

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
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}><Megaphone size={13} /> Marketing support</h3>
        {event.marketing_spent > 0 && <span className="rounded bg-emerald-50 px-1.5 text-xs text-emerald-700" title="Marketing dollars recorded for this event">{money(event.marketing_spent)} marketing spend</span>}
      </div>

      {event.support.length > 0 && (
        <ul className="mt-2 space-y-2">
          {event.support.map((q) => (
            <li key={q.id} className="rounded-md bg-slate-50 p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {q.title && <div className="font-semibold text-slate-900">{q.title}</div>}
                  <p className="break-words whitespace-pre-wrap text-slate-800">{q.details}</p>
                </div>
                {q.status === 'accepted'
                  ? <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">Work ticket created</span>
                  : <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Waiting on Marketing</span>}
              </div>
              {q.justification && <p className="mt-1 text-xs whitespace-pre-wrap text-slate-600"><span className="font-medium text-slate-500">Justification:</span> {q.justification}</p>}
              {(q.for_ticket || q.tickets.length > 0 || q.meetings.length > 0) && <div className="mt-1.5"><RequestTies request={{ ...q, event_id: null }} /></div>}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                <Avatar user={q.requested_by} size="xs" />
                <span>{fullName(q.requested_by) || 'Someone'} asked</span>
                <span title={fullStamp(q.created_at)}>· {stamp(q.created_at)}</span>
                {q.accepted_by && <span>· taken by {fullName(q.accepted_by)}</span>}
                {q.spent > 0 && <span className="text-emerald-700">· {money(q.spent)} spent</span>}
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-[11px] ${error ? 'text-red-600' : note ? 'text-emerald-700' : 'text-slate-400'}`}>
          {error || note || (team && (team.team.length
            ? `Alerts ${team.team.map(fullName).join(', ')}`
            : 'No one is on the Marketing team yet. An admin can assign people to it under Admin Access.'))}
        </span>
        <MarketingButton eventId={event.id} className="btn shrink-0 px-2.5 py-1 text-xs"
          onSaved={(r) => { setNote(r.notified ? `Sent to ${r.notified} ${r.notified === 1 ? 'person' : 'people'} on the Marketing team.` : 'Saved, but no one is on the Marketing team to alert yet.'); reload(event, onUpdated); }} />
      </div>
    </section>
  );
}

// ---- Meetings

/**
 * The meetings set up at an event, day by day: who with, when and where. Schedule a meeting calls `onSchedule`, which
 * opens the scheduler (components/MeetingPanel.jsx) out of the event pane's left edge. Marketing requests for the event
 * carry this schedule, as it stands.
 */
export function MeetingsSection({ event, onUpdated, onSchedule }) {
  const { user } = useAuth();
  const setEditing = onSchedule; // 'new' or a meeting: opens the scheduler, which pops out of the event pane
  const days = [...new Set(event.meetings.map((m) => m.meeting_date))];
  const remove = async (m) => {
    if (!confirm(`Delete the meeting “${m.title}”? The people stay in the CRM.`)) return;
    await api.del(`/meetings/${m.id}`);
    reload(event, onUpdated);
  };

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}><Handshake size={13} /> Meetings</h3>
        <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setEditing('new')}><CalendarPlus size={13} /> Schedule a meeting</button>
      </div>

      {!event.meetings.length && <p className="mt-1.5 text-xs text-slate-400">No meetings set up yet. Schedule who you’re meeting, when and where.</p>}
      {days.map((day) => (
        <div key={day} className="mt-3">
          <div className="text-[11px] font-semibold text-slate-500">{dayLabel(day)}</div>
          <ul className="mt-1 space-y-1.5 border-l-2 border-brand-200 pl-3">
            {event.meetings.filter((m) => m.meeting_date === day).map((m) => (
              <li key={m.id} className="rounded-md bg-slate-50 p-2.5 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900">{m.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600">
                      <span className="flex items-center gap-1"><Clock size={11} className="text-slate-400" /> {timeLabel(m.meeting_time)}</span>
                      {m.place && <span className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" /> {m.place}</span>}
                      {m.ticket_title && <span className="flex items-center gap-1"><Ticket size={11} className="text-slate-400" /> {m.ticket_title}</span>}
                    </div>
                  </div>
                  <span className="flex shrink-0 items-center">
                    <button type="button" className="btn-ghost p-1 text-slate-500" onClick={() => setEditing(m)} aria-label={`Edit ${m.title}`} title="Edit"><Pencil size={13} /></button>
                    {(m.created_by === user.id || user.role === 'admin') && (
                      <button type="button" className="btn-ghost p-1 text-slate-500 hover:text-red-600" onClick={() => remove(m)} aria-label={`Delete ${m.title}`} title="Delete"><Trash2 size={13} /></button>
                    )}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.people.map((p) => <span key={p.id} className="chip py-0 text-[11px]" title={[p.role, p.organization].filter(Boolean).join(', ')}>{personName(p)}{p.organization ? ` · ${p.organization}` : ''}</span>)}
                </div>
                {m.users.length > 0 && <div className="mt-1 text-[11px] text-slate-500">From Knexus: {m.users.map(fullName).join(', ')}</div>}
                {(m.objectives || m.notes) && <p className="mt-1 text-xs whitespace-pre-wrap text-slate-600"><span className="font-medium text-slate-500">Objectives:</span> {m.objectives || m.notes}</p>}
                {m.files.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {m.files.map((file) => <a key={file.id} href={`/api/meetings/files/${file.id}`} className="flex items-center gap-1 text-xs text-brand-700 hover:underline"><Paperclip size={11} /> {file.name}</a>)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

    </section>
  );
}

// ---- Opportunities

const STATUS_CHIP = { won: 'bg-emerald-100 text-emerald-800', lost: 'bg-red-100 text-red-800' };

/**
 * The pipeline tickets tied to an event. The event's marketing dollars count toward every one of them. A ticket made
 * here came out of the event: the event, its BD director and (when Marketing supported the event) Marketing are its lead source.
 */
export function OpportunitiesSection({ event, onUpdated }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState(null); // loaded when the picker opens
  const [mode, setMode] = useState(null); // 'link' | 'new'
  const [draft, setDraft] = useState({ opportunity_title: '', organization: '' });
  const [canSource, setCanSource] = useState(false);
  const [closed, setClosed] = useState(false); // an admin has turned off making pipeline tickets in KIT
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/events/support-team').then((d) => { setCanSource(d.canTake); setClosed(d.pipelineTicketsClosed); }); }, []);
  useEffect(() => { if (mode === 'link' && !tickets) api.get('/tickets?scope=all&kind=bid').then((d) => setTickets(d.tickets)); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (call) => {
    setBusy(true);
    setError('');
    try { const r = await call(); if (r?.event) onUpdated(r.event); return r; } catch (e) { setError(e.message); return null; } finally { setBusy(false); }
  };
  const link = (id) => run(() => api.put(`/events/${event.id}/tickets/${id}`, {})).then(() => setMode(null));
  const create = async () => {
    const r = await run(() => api.post('/tickets', { ticket_type: 'bid', ...draft, source_event_id: event.id }));
    if (!r) return;
    setDraft({ opportunity_title: '', organization: '' });
    setMode(null);
    reload(event, onUpdated);
  };
  const tied = new Set(event.tickets.map((t) => t.id));

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={heading}><Target size={13} /> Leads and opportunities</h3>
        {!mode && (
          <span className="flex gap-1.5">
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setMode('link')}>Tie a pipeline ticket</button>
            {!closed && <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setMode('new')}><Plus size={13} /> New lead from this event</button>}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Every pipeline ticket tied here is tied to this event’s marketing dollars{event.marketing_spent > 0 ? ` (${money(event.marketing_spent)} so far)` : ''}.
        {closed && ' For a lead that began here, tie its pipeline ticket and tick “Came out of this event”.'}
      </p>

      {event.tickets.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {event.tickets.map((t) => {
            const mayMark = canSource || canEditTicket(user, { created_by: t.created_by, ticket_type: 'bid' });
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-sm">
                <button type="button" className="min-w-0 truncate font-medium text-brand-700 hover:underline" onClick={() => navigate(`/tickets?open=${t.id}`)}>{t.title}</button>
                <span className="text-xs text-slate-500">{[t.organization, t.director, t.value != null && money(t.value)].filter(Boolean).join(' · ')}</span>
                {t.deal_status !== 'open' && <span className={`rounded px-1.5 text-[11px] font-semibold capitalize ${STATUS_CHIP[t.deal_status]}`}>{t.deal_status}</span>}
                <label className={`ml-auto flex items-center gap-1 text-[11px] ${mayMark ? 'text-slate-600' : 'text-slate-400'}`}
                  title={mayMark ? 'The lead began at this event: tags the ticket Event Lead' : 'Only the ticket’s owner, Marketing or an admin can say where a lead came from'}>
                  <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={t.sourced} disabled={busy || !mayMark}
                    onChange={(e) => run(() => api.put(`/events/${event.id}/tickets/${t.id}`, { sourced: e.target.checked }))} />
                  Came out of this event
                </label>
                <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Untie ${t.title}`} title="Untie from this event" disabled={busy}
                  onClick={() => run(() => api.del(`/events/${event.id}/tickets/${t.id}`))}><X size={13} /></button>
              </li>
            );
          })}
        </ul>
      )}

      {mode === 'link' && (
        <div className="mt-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <MultiSelect options={(tickets || []).filter((t) => !t.archived && !tied.has(t.id)).map((t) => ({ value: t.id, label: t.opportunity_title, sub: t.organization || undefined }))}
              value={[]} onChange={(v) => link(v[0])} placeholder={tickets ? 'Search pipeline tickets…' : 'Loading…'} />
          </div>
          <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => setMode(null)}>Done</button>
        </div>
      )}
      {mode === 'new' && (
        <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50/40 p-3">
          <div className="text-xs text-slate-600">A new pipeline ticket, yours, sourced by this event.</div>
          <input className="input" autoFocus placeholder="Opportunity title *" value={draft.opportunity_title} onChange={(e) => setDraft({ ...draft, opportunity_title: e.target.value })} aria-label="Opportunity title" />
          <input className="input" placeholder="Organization" value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} aria-label="Organization" />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setMode(null)} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={create} disabled={busy || !draft.opportunity_title.trim()}>{busy ? 'Creating…' : 'Create pipeline ticket'}</button>
          </div>
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
    </section>
  );
}
