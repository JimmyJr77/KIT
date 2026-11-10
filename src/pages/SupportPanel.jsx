import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ticket, Loader2, ArrowRight, Trash2, CheckCircle2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ago, fullName, fullStamp } from '../lib/format.js';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';

/**
 * Right-hand pane for one support request, asked from inside a priority: what's needed, the tickets made from it, and
 * a way to make one (or your own, when one exists).
 */
export default function SupportPanel({ id, onClose, onChanged }) {
  return <RequestPane id={id} onClose={onClose} onChanged={onChanged} />;
}

function RequestPane({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const [n, setN] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get(`/support/${id}`).then((d) => setN(d.request)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = n && (n.requester?.id === user.id || user.role === 'admin');
  const setClosed = async (closed) => {
    const r = await api.put(`/support/${id}`, { closed });
    setN(r.request);
    onChanged?.();
  };
  const remove = async () => {
    if (!confirm('Delete this support request? Tickets already made from it are kept.')) return;
    await api.del(`/support/${id}`);
    onChanged?.();
    onClose();
  };

  return (
    <SidePanel title="Support request" subtitle={n && (n.closed_at ? 'Closed' : 'Open')} onClose={onClose}
      footer={n && <MakeTicket request={n} onMade={(r) => { setN(r); onChanged?.(); }} />}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {n && (
        <div className="space-y-5">
          <section className="flex gap-3 rounded-lg p-3 ring-1 ring-slate-200">
            <Avatar user={n.requester} size="md" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
                <span className="font-semibold text-slate-800">{fullName(n.requester) || 'Someone'} needs support</span>
                <span className="text-slate-400" title={fullStamp(n.created_at)}>{ago(n.created_at)}</span>
              </div>
              {n.card && <div className="mt-0.5 truncate text-xs text-slate-500" title={n.card.ticket_title}>Priority: {n.card.title} · {n.card.ticket_title}</div>}
              <p className="mt-1.5 text-[15px] break-words whitespace-pre-wrap text-slate-800"><MentionText text={n.body} /></p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {n.tickets.length ? `Work ticket${n.tickets.length === 1 ? '' : 's'} made from it` : 'Work tickets'}
            </h3>
            {n.tickets.length ? (
              <ul className="space-y-2">
                {n.tickets.map((t) => (
                  <li key={t.id}>
                    <Link to={`/tickets?open=${t.id}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-500">
                      <Ticket size={14} className="shrink-0 text-brand-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{t.title}</span>
                        <span className="block text-[11px] text-slate-500">#{t.id} · made by {t.created_by?.id === user.id ? 'you' : fullName(t.created_by) || 'someone'} {ago(t.created_at)}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-400">No ticket yet. Anyone can make one below.</p>}
          </section>

          {mine && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {n.closed_at
                ? <button className="btn" onClick={() => setClosed(false)}><RotateCcw size={15} /> Reopen</button>
                : <button className="btn" onClick={() => setClosed(true)} title="Done: it leaves your lane after this week"><CheckCircle2 size={15} /> Close request</button>}
              <button className="btn-danger" onClick={remove} title="Delete this request"><Trash2 size={15} /></button>
            </div>
          )}
        </div>
      )}
    </SidePanel>
  );
}

/**
 * Turn a request into a work ticket. When tickets were already made from it, it says so first and lets you make your
 * own anyway (the server checks again, in case one was made while the pane was open).
 */
function MakeTicket({ request: n, onMade }) {
  const firstLine = n.body.split('\n')[0].replace(/\s+/g, ' ').trim();
  const [open, setOpen] = useState(!n.tickets.length);
  const [title, setTitle] = useState(`Support: ${firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [made, setMade] = useState(null);

  const make = async (force) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.post(`/support/${n.id}/tickets`, { title, force });
      setMade(r.ticket_id);
      setOpen(false);
      onMade(r.request);
    } catch (e) {
      // Someone made one meanwhile: show it, and ask again.
      if (e.status === 409 || /already made/.test(e.message)) {
        const r = await api.get(`/support/${n.id}`);
        onMade(r.request);
        if (confirm(`${e.message}. Make your own ticket anyway?`)) return make(true);
      } else setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (made) {
    return (
      <Link to={`/tickets?open=${made}`} className="btn-primary w-full"><Ticket size={15} /> Open your new ticket <ArrowRight size={15} /></Link>
    );
  }
  if (!open) {
    return (
      <div className="space-y-2">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          {n.tickets.length === 1 ? 'A ticket was already made from this request.' : `${n.tickets.length} tickets were already made from this request.`} Open {n.tickets.length === 1 ? 'it' : 'one'} above, or make your own.
        </p>
        <button className="btn w-full" onClick={() => setOpen(true)}><Ticket size={15} /> Make my own ticket</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <label className="label">Work ticket title</label>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" onClick={() => make(n.tickets.length > 0)} disabled={busy || !title.trim()}>
        {busy ? <><Loader2 size={15} className="animate-spin" /> Making…</> : <><Ticket size={15} /> {n.tickets.length ? 'Make my own ticket' : 'Make a work ticket'}</>}
      </button>
    </div>
  );
}
