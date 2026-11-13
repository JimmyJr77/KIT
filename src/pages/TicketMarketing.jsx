import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Megaphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate } from '../lib/format.js';
import { fullMoney } from '../components/Charts.jsx';
import { LabelChip, useLabels } from '../components/Labels.jsx';
import { MarketingButton } from '../components/MarketingRequestForm.jsx';
import { RequestTies } from '../components/MarketingImpact.jsx';
import { DrawerShell } from './TicketPlanning.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const heading = 'mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase';

/**
 * Marketing on a ticket: where its lead came from, the events it's tied to, the marketing requests for it (and a button
 * to make one), and the marketing dollars recorded against it.
 */
export function MarketingDrawer({ ticket, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const labels = useLabels();
  const load = () => api.get(`/marketing/ticket/${ticket.id}`).then(setData);
  useEffect(() => { load(); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const isBid = ticket.ticket_type === 'bid';
  const sources = (ticket.labels || []).filter((l) => labels.some((x) => x.kind && x.name.toLowerCase() === l.toLowerCase()));

  return (
    <DrawerShell title="Marketing" subtitle={ticket.opportunity_title} onClose={onClose}
      footer={<MarketingButton ticket={ticket} className="btn-primary w-full" onSaved={() => { load(); onChanged?.(); }} />}>
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-5">
          {isBid && (
            <section>
              <h4 className={heading}>Lead source</h4>
              {sources.length
                ? <div className="flex flex-wrap gap-1">{sources.map((l) => <LabelChip key={l} name={l} />)}</div>
                : <p className="text-xs text-slate-400">No lead source yet. Its owner can add Event Lead, Google Lead, Marketing Lead or BD Lead with the ticket’s tags.</p>}
            </section>
          )}
          {isBid && (
            <section>
              <h4 className={heading}>Events</h4>
              {data.events.length ? (
                <ul className="space-y-1">
                  {data.events.map((e) => (
                    <li key={e.id} className="flex items-center gap-2 text-sm">
                      <Link to={`/events?open=${e.id}`} className="flex min-w-0 items-center gap-1 text-sky-700 hover:underline"><CalendarDays size={13} className="shrink-0" /> <span className="truncate">{e.name}</span></Link>
                      <span className="shrink-0 text-xs text-slate-400">{longDate(e.date_from)}</span>
                      {e.sourced && <span className="shrink-0 rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-violet-800">Came out of it</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-400">Not tied to an event. Tie it from the event, under Leads and opportunities.</p>}
            </section>
          )}
          <section>
            <h4 className={heading}>Marketing requests</h4>
            {data.requests.length ? (
              <ul className="space-y-2">
                {data.requests.map((r) => (
                  <li key={r.id} className="rounded-md bg-white p-2.5 text-sm ring-1 ring-slate-200">
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
                ))}
              </ul>
            ) : <p className="flex items-center gap-1.5 text-xs text-slate-400"><Megaphone size={13} /> Nothing asked of Marketing for this ticket yet.</p>}
          </section>
          {isBid && (
            <section>
              <h4 className={heading}>Marketing dollars {data.spent > 0 && <span className="ml-1 font-bold text-slate-800 normal-case">{fullMoney(data.spent)}</span>}</h4>
              {data.spend.length ? (
                <ul className="space-y-1 text-sm">
                  {data.spend.map((s) => (
                    <li key={s.id} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700">{s.description} <span className="text-xs text-slate-400">{longDate(s.spent_on)}</span></span>
                      <span className="shrink-0 font-medium tabular-nums">{fullMoney(s.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-400">No spend recorded against this ticket. Its events’ marketing dollars count toward it too; see Marketing › Tracking.</p>}
            </section>
          )}
        </div>
      )}
    </DrawerShell>
  );
}
