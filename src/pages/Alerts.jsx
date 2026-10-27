import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ArrowRight, CheckCheck, StickyNote } from 'lucide-react';
import { api } from '../lib/api.js';
import { ago, fullName, fullStamp, ticketKind } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import CommentPanel, { TicketSummary } from './CommentPanel.jsx';

/** Tell the sidebar bell to recount unread alerts. */
export const alertsChanged = () => window.dispatchEvent(new Event('kit:alerts'));

/** Where an alert's "Go to comment" lands: the ticket timeline, scrolled to the item. */
const goToUrl = (a) => `/tickets?open=${a.ticket_id}&focus=${a.comment_id ? `c-${a.comment_id}` : `n-${a.note_id}`}`;

export default function Alerts() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState(null);
  const [open, setOpen] = useState(null);

  const load = () => api.get('/alerts').then((d) => setAlerts(d.alerts));
  useEffect(() => { load(); }, []);

  const markRead = async (a) => {
    if (a.read) return;
    setAlerts((xs) => xs.map((x) => (x.id === a.id ? { ...x, read: true } : x)));
    await api.put(`/alerts/${a.id}/read`);
    alertsChanged();
  };
  const select = (a) => { markRead(a); setOpen(a); };
  const goTo = (a) => { markRead(a); navigate(goToUrl(a)); };
  const readAll = async () => {
    await api.put('/alerts/read-all');
    setAlerts((xs) => xs.map((x) => ({ ...x, read: true })));
    alertsChanged();
  };

  const unread = (alerts || []).filter((a) => !a.read).length;

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Alerts" subtitle="When someone @mentions you, it shows up here. Alerts about a priority come first, then the rest, newest first.">
        {unread > 0 && <button className="btn" onClick={readAll}><CheckCheck size={15} /> Mark all as read</button>}
      </PageHeader>

      {alerts && !alerts.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Bell size={28} className="mx-auto mb-2 text-slate-300" />
          No alerts yet. You’ll see one here when someone types @ and your name.
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
                    <span className="font-semibold">{fullName(a.actor) || 'Someone'}</span> mentioned you in {a.note_id ? 'a note' : 'a comment'} on{' '}
                    <span className="font-semibold">{a.ticket_title || 'a deleted ticket'}</span>
                  </span>
                  <span className="text-[11px] text-slate-400" title={fullStamp(a.created_at)}>{ago(a.created_at)}</span>
                </div>
                {a.card_title && <div className="text-xs text-slate-500">Priority: {a.card_title}</div>}
                <p className="mt-1.5 line-clamp-3 text-sm whitespace-pre-wrap text-slate-700"><MentionText text={a.excerpt} /></p>
                {a.ticket_id && (
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

      {open && (open.comment_id
        ? <CommentPanel key={open.id} threadId={open.thread_id} highlight={open.comment_id} onClose={() => setOpen(null)}
            footer={<GoButton alert={open} onGo={goTo} />} />
        : <NotePane key={open.id} alert={open} onClose={() => setOpen(null)} onGo={goTo} />)}
    </div>
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
