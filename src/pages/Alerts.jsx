import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ArrowRight, CheckCheck, StickyNote, Megaphone, Ticket, CalendarDays, Loader2, Handshake, Receipt, Plane } from 'lucide-react';
import { api } from '../lib/api.js';
import { ago, fullName, fullStamp, ticketKind, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import { EstimateLockPanel } from '../components/EstimateLock.jsx';
import CommentPanel, { TicketSummary } from './CommentPanel.jsx';
import SupportPanel from './SupportPanel.jsx';

/** Tell the sidebar bell to recount unread alerts. */
export const alertsChanged = () => window.dispatchEvent(new Event('kit:alerts'));

const isSupport = (a) => a.kind === 'support_request' || a.kind === 'support_accepted';
/** What a support request is about: its event, or its own title when asked for from the Marketing page. */
const supportSubject = (a) => (a.event_id ? a.event_name : a.request_title || (a.request_id ? 'a request' : 'a deleted request'));
/** Support asked for on Weekly Priorities: you were asked (support_need), or a ticket was made from yours (support_ticket). */
const isAsk = (a) => a.kind === 'support_need' || a.kind === 'support_ticket';
const isDelivery = (a) => a.kind === 'delivery_pm' || a.kind === 'delivery_tl' || a.kind === 'delivery_team';
const isTravel = (a) => a.kind === 'travel_request' || a.kind === 'travel_decision';
/** What a travel request is for: its event, or where it goes. */
const tripSubject = (a) => (!a.trip_id ? 'a deleted trip' : a.trip_event_name || [a.trip_destination?.city, a.trip_destination?.state].filter(Boolean).join(', ') || 'a trip');
const DECISION = { approved: 'approved', declined: 'declined', pending: 'is reviewing' };
/** An approved travel request: clicking it opens the trip's actual costs to enter, right here. */
const isApproved = (a) => a.kind === 'travel_decision' && a.trip_approval === 'approved' && !!a.trip_id;

/** Where an alert's "Go to comment" lands: the ticket timeline, scrolled to the item. */
const goToUrl = (a) => `/tickets?open=${a.ticket_id}&focus=${a.comment_id ? `c-${a.comment_id}` : `n-${a.note_id}`}`;

export default function Alerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState(null);
  const [open, setOpen] = useState(null);
  const [lockTrip, setLockTrip] = useState(null); // the approved trip whose actual costs are open in the side pane
  const [locked, setLocked] = useState(null); // the trip id whose actual costs were just saved, for a word of confirmation

  const load = () => api.get('/alerts').then((d) => setAlerts(d.alerts));
  useEffect(() => { load(); }, []);

  const markRead = async (a) => {
    if (a.read) return;
    setAlerts((xs) => xs.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
    await api.put(`/alerts/${a.id}/read`);
    alertsChanged();
  };
  // Delivery alerts go straight to the contract, travel alerts to the request (an approved one opens its actual costs
  // here instead); the rest open in the side pane.
  const select = (a) => {
    markRead(a);
    if (isDelivery(a)) return a.program_id && navigate(`/delivery?open=${a.program_id}`);
    if (a.kind === 'pipedrive_file_hold') return navigate('/admin');
    if (isApproved(a)) return api.get(`/travel/${a.trip_id}`).then((d) => setLockTrip(d.trip)).catch(() => navigate(`/travel?open=${a.trip_id}`));
    if (isTravel(a)) return a.trip_id && navigate(`/travel?open=${a.trip_id}`);
    setOpen(a);
  };
  const go = (a, url) => { markRead(a); navigate(url); };
  const goTo = (a) => { markRead(a); navigate(goToUrl(a)); };
  const readAll = async () => {
    await api.put('/alerts/read-all');
    setAlerts((xs) => xs.map((x) => ({ ...x, read: true })));
    alertsChanged();
  };

  const unread = (alerts || []).filter((a) => !a.read).length;

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Alerts" subtitle="@mentions, comments on your tickets, requests for your support, marketing support requests, travel requests, and contracts you’re put on in Delivery. Alerts about a priority come first, then the rest, newest first.">
        {unread > 0 && <button className="btn" onClick={readAll}><CheckCheck size={15} /> Mark all as read</button>}
      </PageHeader>

      {alerts && !alerts.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Bell size={28} className="mx-auto mb-2 text-slate-300" />
          No alerts yet. You’ll see one here when someone @mentions you, comments on a ticket you own, asks Marketing for support, or puts you on a contract in Delivery.
        </div>
      )}

      <ul className="max-w-3xl space-y-2">
        {alerts?.map((a, i) => (
          <li key={a.id}>
            {(i === 0 || !!alerts[i - 1].card_id !== !!a.card_id) && (
              <h2 className={`mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase ${i ? 'mt-6' : ''}`}>
                {a.card_id ? 'Priority alerts' : 'Other alerts'}
              </h2>
            )}
            <div role="button" tabIndex={0} onClick={() => select(a)} onKeyDown={(e) => e.key === 'Enter' && select(a)}
              className={`group flex cursor-pointer gap-3 rounded-xl border p-4 shadow-sm transition hover:border-brand-500 hover:shadow-md ${
                open?.id === a.id ? 'border-brand-500 ring-2 ring-brand-100' : a.read ? 'border-slate-200 bg-white' : 'border-brand-100 bg-brand-50/50'}`}>
              <div className="relative">
                <Avatar user={a.actor} size="md" />
                {!a.read && <span className="absolute -top-0.5 -left-0.5 h-2.5 w-2.5 rounded-full bg-brand-600 ring-2 ring-white" title="Unread" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className={a.read ? 'text-slate-600' : 'text-slate-900'}>
                    <span className="font-semibold">{a.kind === 'pipedrive_file_hold' ? 'Pipedrive' : fullName(a.actor) || 'Someone'}</span>{' '}
                    {a.kind === 'pipedrive_file_hold' ? <>deleted {a.excerpt} of KIT&apos;s files. They&apos;re held, not deleted, until an admin decides in Admin Access › Pipedrive.</>
                      : a.kind === 'support_need' ? <>needs your support{a.support_id ? '' : ' (request since deleted)'}</>
                      : a.kind === 'support_ticket' ? <>made a work ticket from your support request: <span className="font-semibold">{a.ticket_title || 'a deleted ticket'}</span></>
                      : a.kind === 'support_request' ? <>requested marketing support{a.event_id ? ' for' : ':'} <span className="font-semibold">{supportSubject(a)}</span></>
                      : a.kind === 'support_accepted' ? <>created a work ticket for your marketing support request{a.event_id ? ' on' : ':'} <span className="font-semibold">{supportSubject(a)}</span></>
                        : a.kind === 'delivery_pm' ? <>made you Program Manager for <span className="font-semibold">{a.program_name || 'a deleted contract'}</span></>
                          : a.kind === 'delivery_tl' ? <>made you Technical Lead for <span className="font-semibold">{a.program_name || 'a deleted contract'}</span></>
                          : a.kind === 'delivery_team' ? <>added you to the delivery team for <span className="font-semibold">{a.program_name || 'a deleted contract'}</span></>
                          : a.kind === 'travel_request' ? <>submitted a travel request for <span className="font-semibold">{tripSubject(a)}</span></>
                          : a.kind === 'travel_decision' ? <>{DECISION[a.trip_approval] || 'decided'} your travel request for <span className="font-semibold">{tripSubject(a)}</span></>
                        : a.kind === 'comment' ? <>{a.thread_id !== a.comment_id ? 'replied' : 'commented'} on your {a.ticket_type === 'work' ? 'work ticket' : 'pipeline ticket'} <span className="font-semibold">{a.ticket_title || 'a deleted ticket'}</span></>
                        : <>mentioned you in {a.note_id ? 'a note' : 'a comment'} on <span className="font-semibold">{a.ticket_title || 'a deleted ticket'}</span></>}
                  </span>
                  <span className="text-[11px] text-slate-400" title={fullStamp(a.created_at)}>{ago(a.created_at)}</span>
                </div>
                {a.card_title && <div className="text-xs text-slate-500">Priority: {a.card_title}</div>}
                {isTravel(a) ? (
                  <p className="mt-1 text-xs text-slate-500">
                    {[a.trip_date_from && shortDate(a.trip_date_from, { month: 'short', day: 'numeric', year: 'numeric' }),
                      a.kind === 'travel_request' && a.trip_approval && a.trip_approval !== 'pending' ? `Already ${a.trip_approval}` : null,
                      a.excerpt ? `Note: ${a.excerpt}` : null,
                      isApproved(a) ? (locked === a.trip_id ? 'Actual costs entered' : 'When the trip is done, enter what it actually cost; that locks the estimate without another approval') : null].filter(Boolean).join(' · ')}
                  </p>
                ) : isDelivery(a) ? (
                  <p className="mt-1 text-xs text-slate-500">{[a.program_organization, a.kind === 'delivery_team' && a.excerpt ? `Your role: ${a.excerpt}` : null].filter(Boolean).join(' · ')}</p>
                ) : <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-wrap text-slate-700"><MentionText text={a.excerpt} withTeams={isAsk(a)} /></p>}
                {isSupport(a) && <SupportActions alert={a} onDone={load} markRead={markRead} />}
                {isAsk(a) && a.support_id && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={(e) => { e.stopPropagation(); select(a); }}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                      <Handshake size={12} /> Open request <ArrowRight size={12} />
                    </button>
                    {a.kind === 'support_ticket' && a.ticket_id && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); markRead(a); navigate(`/tickets?open=${a.ticket_id}`); }}
                        className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                        <Ticket size={12} /> Open work ticket <ArrowRight size={12} />
                      </button>
                    )}
                    {a.kind === 'support_need' && a.support_tickets > 0 && (
                      <span className="text-[11px] text-emerald-700">{a.support_tickets === 1 ? 'A ticket was already made' : `${a.support_tickets} tickets already made`}</span>
                    )}
                  </div>
                )}
                {isApproved(a) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={(e) => { e.stopPropagation(); select(a); }}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                      <Receipt size={12} /> Enter actual costs <ArrowRight size={12} />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); go(a, `/travel?lock=${a.trip_id}`); }}
                      className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                      <Plane size={12} /> Do it on the Travel page <ArrowRight size={12} />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); go(a, `/travel?open=${a.trip_id}`); }}
                      className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:underline">
                      Open travel request <ArrowRight size={12} />
                    </button>
                  </div>
                ) : isTravel(a) && a.trip_id && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); select(a); }}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Open travel request <ArrowRight size={12} />
                  </button>
                )}
                {isDelivery(a) && a.program_id && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); select(a); }}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Open in Delivery <ArrowRight size={12} />
                  </button>
                )}
                {!isSupport(a) && !isAsk(a) && !isDelivery(a) && !isTravel(a) && a.ticket_id && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); goTo(a); }}
                    className="mt-2 flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
                    Go to {a.note_id ? 'note' : 'comment'} <ArrowRight size={12} />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {lockTrip && <EstimateLockPanel key={lockTrip.id} trip={lockTrip} onClose={() => setLockTrip(null)} onSaved={(t) => { setLockTrip(null); setLocked(t.id); }} />}
      {open && isSupport(open) && <SupportPane key={open.id} alert={open} onClose={() => setOpen(null)} onDone={load} markRead={markRead} />}
      {open && isAsk(open) && open.support_id && (
        <SupportPanel key={open.id} id={open.support_id} onClose={() => setOpen(null)} onChanged={load} />
      )}
      {open && !isSupport(open) && !isAsk(open) && (open.comment_id
        ? <CommentPanel key={open.id} threadId={open.thread_id} highlight={open.comment_id} onClose={() => setOpen(null)}
            footer={<GoButton alert={open} onGo={goTo} />} />
        : <NotePane key={open.id} alert={open} onClose={() => setOpen(null)} onGo={goTo} />)}
    </div>
  );
}

/**
 * Buttons on a marketing support alert. Marketing sees "Create work ticket" until someone takes the request;
 * after that, and for the requester, a link to the work ticket. Both can jump to the event.
 */
function SupportActions({ alert: a, onDone, markRead, full }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ticketId = a.kind === 'support_accepted' ? a.ticket_id : a.request_ticket_id;
  const take = async (e) => {
    e.stopPropagation();
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/marketing/requests/${a.request_id}/accept`, {});
      markRead(a);
      alertsChanged();
      navigate(`/tickets?open=${r.ticket_id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
      onDone();
    }
  };
  const go = (e, url) => { e.stopPropagation(); markRead(a); navigate(url); };
  return (
    <div className={`mt-2 flex flex-wrap items-center gap-2 ${full ? 'justify-stretch' : ''}`}>
      {ticketId ? (
        <button type="button" onClick={(e) => go(e, `/tickets?open=${ticketId}`)} className={full ? 'btn-primary flex-1' : 'btn-primary px-2.5 py-1 text-xs'}>
          <Ticket size={13} /> Open work ticket
        </button>
      ) : a.request_id && (
        <button type="button" onClick={take} disabled={busy} className={full ? 'btn-primary flex-1' : 'btn-primary px-2.5 py-1 text-xs'}>
          {busy ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : <><Ticket size={13} /> Create work ticket</>}
        </button>
      )}
      {!a.event_id && a.request_id && (
        <button type="button" onClick={(e) => go(e, '/marketing?tab=requests')} className={full ? 'btn' : 'flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline'}>
          {full ? <Megaphone size={15} /> : null} Go to Marketing {!full && <ArrowRight size={12} />}
        </button>
      )}
      {a.event_id && (
        <button type="button" onClick={(e) => go(e, `/events?open=${a.event_id}`)} className={full ? 'btn' : 'flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline'}>
          {full ? <CalendarDays size={15} /> : null} Go to event {!full && <ArrowRight size={12} />}
        </button>
      )}
      {a.kind === 'support_request' && a.request_status === 'accepted' && !full && <span className="text-[11px] text-emerald-700">Taken</span>}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

/** A marketing support alert in the side pane: the event, the request, and what to do next. */
function SupportPane({ alert: a, onClose, onDone, markRead }) {
  const dates = a.event_date_from && (a.event_date_from === a.event_date_to ? shortDate(a.event_date_from) : `${shortDate(a.event_date_from)} – ${shortDate(a.event_date_to)}`);
  return (
    <SidePanel title="Marketing support" subtitle={a.kind === 'support_accepted' ? 'Your request has a work ticket' : 'A request for the Marketing team'} onClose={onClose}
      footer={<SupportActions alert={a} onDone={onDone} markRead={markRead} full />}>
      <div className="space-y-4">
        {a.event_id ? (
          <section className="rounded-lg bg-slate-50 p-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><CalendarDays size={13} /> Event</span>
            <div className="mt-1 font-semibold text-slate-900">{a.event_name || 'A deleted event'}</div>
            {dates && <div className="text-xs text-slate-500">{dates}</div>}
          </section>
        ) : (
          <section className="rounded-lg bg-slate-50 p-4">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Megaphone size={13} /> Request</span>
            <div className="mt-1 font-semibold text-slate-900">{supportSubject(a)}</div>
            {(a.request_category || a.request_due_date) && (
              <div className="text-xs text-slate-500">{[a.request_category, a.request_due_date && `Needed by ${shortDate(a.request_due_date, { month: 'short', day: 'numeric', year: 'numeric' })}`].filter(Boolean).join(' · ')}</div>
            )}
          </section>
        )}
        <section className="flex gap-3 rounded-lg p-3 ring-1 ring-slate-200">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700"><Megaphone size={15} /></span>
          <div className="min-w-0">
            <div className="text-xs">
              <span className="font-semibold text-slate-800">{a.kind === 'support_accepted' ? 'Your request' : `${fullName(a.actor) || 'Someone'} asked`}</span>{' '}
              <span className="text-slate-400">{ago(a.created_at)}</span>
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">{a.excerpt}</p>
          </div>
        </section>
        {a.kind === 'support_accepted' && (
          <p className="text-sm text-slate-600"><b>{fullName(a.actor)}</b> took it and created the work ticket <b>{a.ticket_title}</b>.</p>
        )}
        {a.kind === 'support_request' && a.request_status === 'accepted' && (
          <p className="text-sm text-emerald-700">This request has already been taken, and a work ticket exists for it.</p>
        )}
      </div>
    </SidePanel>
  );
}

function GoButton({ alert, onGo }) {
  return (
    <button className="btn-primary w-full" onClick={() => onGo(alert)}>
      Go to {alert.note_id ? 'note' : 'comment'} <ArrowRight size={15} />
    </button>
  );
}

/** A note mention: the master ticket, then the note. */
function NotePane({ alert, onClose, onGo }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/tickets/${alert.ticket_id}/timeline`).then(setData).catch(() => setData({ events: [] })); }, [alert.ticket_id]);
  const note = data?.events.find((e) => e.type === 'note' && e.note.id === alert.note_id);
  return (
    <SidePanel title="Note" subtitle={`${ticketKind(alert)} #${alert.ticket_id}`} onClose={onClose} footer={<GoButton alert={alert} onGo={onGo} />}>
      {data && (
        <div className="space-y-5">
          {data.ticket && <TicketSummary ticket={data.ticket} card={alert.card_id ? { title: alert.card_title, week_start: null } : null} />}
          <div className="flex gap-3 rounded-lg bg-amber-50/70 p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700"><StickyNote size={15} /></span>
            <div className="min-w-0">
              <div className="text-xs"><span className="font-semibold text-slate-800">{fullName(alert.actor)}</span> <span className="text-slate-400">{ago(alert.created_at)}</span></div>
              <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800"><MentionText text={note?.note.body ?? alert.excerpt} /></p>
            </div>
          </div>
        </div>
      )}
    </SidePanel>
  );
}
