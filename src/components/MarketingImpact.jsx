import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Ticket, CalendarCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, shortDate } from '../lib/format.js';
import { StatTile, ChartCard, DataTable, compact, fullMoney, pct } from './Charts.jsx';
import { LabelChip } from './Labels.jsx';

const longDate = (iso) => shortDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
const count = (b) => b.open.count + b.won.count + b.lost.count;
const winRate = (b) => (b.won.count + b.lost.count ? b.won.count / (b.won.count + b.lost.count) : null);
const STATUS_CHIP = { open: 'bg-slate-100 text-slate-600', won: 'bg-emerald-100 text-emerald-800', lost: 'bg-red-100 text-red-800' };
const INVOLVEMENT = { sourced: ['At the beginning', 'bg-violet-100 text-violet-800'], supported: ['Later on', 'bg-sky-100 text-sky-800'] };

/** Open, won and lost as "3 open · 1 won · 0 lost". */
const outcomeText = (b) => (count(b) ? [`${b.open.count} open`, `${b.won.count} won`, `${b.lost.count} lost`].join(' · ') : 'None yet');

/**
 * Marketing tracking: every marketing ask and what it's tied to, the dollars behind each, the opportunities those reach,
 * and how those opportunities turn out against the rest of the pipeline. `brief` leaves out the long lists (for dashboards).
 */
export default function MarketingImpact({ brief = false }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/marketing/impact').then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;

  const { totals: t, influence: inf } = d;
  const touched = { won: inf.sourced.won.value + inf.supported.won.value, wonCount: inf.sourced.won.count + inf.supported.won.count };
  const outcomeRows = [
    { key: 'sourced', label: 'Marketing at the beginning', hint: 'Marketing sourced the lead', ...inf.sourced },
    { key: 'supported', label: 'Marketing later on', hint: 'Marketing supported an opportunity we already had', ...inf.supported },
    { key: 'none', label: 'No marketing', hint: '', ...inf.none },
  ].map((r) => ({ ...r, openN: r.open.count, openV: r.open.value, wonN: r.won.count, wonV: r.won.value, lostN: r.lost.count, lostV: r.lost.value, rate: winRate(r) }));
  const sourceRows = d.bySource.map((r) => ({ ...r, key: r.tag, openN: r.open.count, openV: r.open.value, wonN: r.won.count, wonV: r.won.value, lostN: r.lost.count, rate: winRate(r) }));
  const outcomeColumns = [
    { key: 'openN', label: 'Open', align: 'right' }, { key: 'openV', label: 'Open value', align: 'right', format: compact },
    { key: 'wonN', label: 'Won', align: 'right' }, { key: 'wonV', label: 'Won value', align: 'right', format: compact },
    { key: 'lostN', label: 'Lost', align: 'right' }, { key: 'rate', label: 'Win rate', align: 'right', format: pct },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <StatTile label="Marketing asks" value={t.requests} sub={`${t.openRequests} waiting on Marketing`} />
        <StatTile label="Marketing dollars" value={compact(t.spend)} sub={`${compact(t.onRequests)} tied to an ask · ${compact(t.untied)} tied to nothing`} />
        <StatTile label="Opportunities marketing is on" value={d.opportunities.length}
          sub={`${count(inf.sourced)} from the beginning · ${count(inf.supported)} later on`} />
        <StatTile label="Wins marketing was part of" value={`${touched.wonCount} of ${d.all.won.count}`}
          sub={d.all.won.value ? `${compact(touched.won)} of ${compact(d.all.won.value)} won (${pct(touched.won / d.all.won.value)})` : 'No wins yet'} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Wins and losses, with and without marketing"
          subtitle="Pipeline tickets by when marketing came in: at the beginning (it sourced the lead) or later on (it supported an opportunity we had).">
          <DataTable columns={[{ key: 'label', label: 'Marketing involvement', format: (v, r) => <span title={r.hint}>{v}</span> }, ...outcomeColumns]} rows={outcomeRows} />
        </ChartCard>
        <ChartCard title="By lead source" subtitle="Where each pipeline ticket’s lead came from. A ticket with two sources counts under both.">
          <DataTable columns={[{ key: 'tag', label: 'Lead source', format: (v, r) => (r.none ? <span className="text-slate-500">{v}</span> : <LabelChip name={v} />) }, ...outcomeColumns]} rows={sourceRows} />
        </ChartCard>
      </div>

      <ChartCard title="By event" subtitle="Marketing dollars on each event, and the opportunities tied to it. “Came out of it” are the ones the event sourced.">
        {d.byEvent.length ? (
          <DataTable rows={d.byEvent.map((e) => ({ ...e, key: e.id, openN: e.open.count, wonN: e.won.count, lostN: e.lost.count, wonV: e.won.value, openV: e.open.value }))}
            columns={[
              { key: 'name', label: 'Event', format: (v, r) => <Link to={`/events?open=${r.id}`} className="text-brand-700 hover:underline">{v}</Link> },
              { key: 'date_from', label: 'Date', format: longDate },
              { key: 'spend', label: 'Marketing $', align: 'right', format: fullMoney }, { key: 'requests', label: 'Asks', align: 'right' },
              { key: 'meetings', label: 'Meetings', align: 'right' }, { key: 'tickets', label: 'Opportunities', align: 'right' },
              { key: 'sourced', label: 'Came out of it', align: 'right' }, { key: 'openV', label: 'Open value', align: 'right', format: compact },
              { key: 'wonN', label: 'Won', align: 'right' }, { key: 'wonV', label: 'Won value', align: 'right', format: compact }, { key: 'lostN', label: 'Lost', align: 'right' },
            ]} />
        ) : <p className="py-6 text-center text-sm text-slate-400">No event has marketing asks, dollars or opportunities tied to it yet.</p>}
      </ChartCard>

      {!brief && (
        <>
          <ChartCard title="Every marketing ask" subtitle="What each is tied to, the dollars recorded against it, and how its opportunities stand (the ones it names, plus its event’s).">
            {d.asks.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[60rem] text-sm">
                  <thead className="text-left text-xs text-slate-500 uppercase">
                    <tr className="border-b border-slate-200">
                      <th className="px-2 py-1.5">Ask</th><th className="px-2 py-1.5">Tied to</th><th className="px-2 py-1.5">Justification</th>
                      <th className="px-2 py-1.5 text-right">Dollars</th><th className="px-2 py-1.5">Opportunities</th><th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.asks.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 align-top last:border-0">
                        <td className="max-w-xs px-2 py-2">
                          <div className="font-medium text-slate-800">{r.title || (r.event_name ? `Support for ${r.event_name}` : 'Marketing support')}</div>
                          <div className="text-xs text-slate-500">{[r.category, fullName(r.requested_by), longDate(r.created_at.slice(0, 10))].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td className="px-2 py-2"><RequestTies request={r} /></td>
                        <td className="max-w-xs px-2 py-2 text-xs text-slate-600"><p className="line-clamp-3">{r.justification || <span className="text-slate-300">—</span>}</p></td>
                        <td className="px-2 py-2 text-right font-medium text-slate-800 tabular-nums">{r.spent ? fullMoney(r.spent) : <span className="text-slate-300">—</span>}</td>
                        <td className="px-2 py-2 text-xs whitespace-nowrap text-slate-600">{outcomeText(r.outcome)}{r.outcome.won.value > 0 && <div className="text-emerald-700">{compact(r.outcome.won.value)} won</div>}</td>
                        <td className="px-2 py-2 text-xs whitespace-nowrap">
                          {r.status === 'accepted'
                            ? <Link to={`/tickets?open=${r.ticket_id}`} className="text-brand-700 hover:underline">Work ticket</Link>
                            : <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Waiting</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="py-6 text-center text-sm text-slate-400">No marketing asks yet.</p>}
          </ChartCard>

          <ChartCard title="Opportunities marketing is on" subtitle="The dollars behind each: what’s recorded against it, plus an even share of its events’ marketing dollars.">
            {d.opportunities.length ? (
              <DataTable rows={d.opportunities.map((o) => ({ ...o, key: o.id }))}
                columns={[
                  { key: 'title', label: 'Pipeline ticket', format: (v, r) => (
                    <div className="max-w-sm"><Link to={`/tickets?open=${r.id}`} className="font-medium text-brand-700 hover:underline">{v}</Link>
                      <div className="text-xs text-slate-500">{[r.organization, r.director].filter(Boolean).join(' · ')}</div></div>
                  ) },
                  { key: 'deal_status', label: 'Status', format: (v) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CHIP[v]}`}>{v}</span> },
                  { key: 'involvement', label: 'Marketing came in', format: (v) => <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${INVOLVEMENT[v][1]}`}>{INVOLVEMENT[v][0]}</span> },
                  { key: 'lead_tags', label: 'Lead source', format: (v) => <span className="flex flex-wrap gap-1">{v.map((x) => <LabelChip key={x} name={x} />)}</span> },
                  { key: 'via', label: 'Through', format: (v) => <span className="text-xs text-slate-600">{v.join('; ') || '—'}</span> },
                  { key: 'value', label: 'Value', align: 'right', format: compact }, { key: 'dollars', label: 'Marketing $', align: 'right', format: fullMoney },
                ]} />
            ) : <p className="py-6 text-center text-sm text-slate-400">Marketing isn’t tied to any pipeline ticket yet.</p>}
          </ChartCard>
        </>
      )}
    </div>
  );
}

/** What a request is tied to: its event, ticket, activity, and the opportunities and meetings it names. */
export function RequestTies({ request: r }) {
  const others = r.tickets.filter((t) => t.id !== r.for_ticket?.id);
  const row = 'flex items-center gap-1';
  return (
    <div className="space-y-0.5 text-xs text-slate-600">
      {r.event_id && <Link to={`/events?open=${r.event_id}`} className={`${row} text-sky-700 hover:underline`}><CalendarDays size={12} className="shrink-0" /> {r.event_name}</Link>}
      {r.for_ticket && <Link to={`/tickets?open=${r.for_ticket.id}`} className={`${row} text-brand-700 hover:underline`}><Ticket size={12} className="shrink-0" /> {r.for_ticket.title}</Link>}
      {r.activity && <div className={row}><CalendarCheck size={12} className="shrink-0 text-slate-400" /> {r.activity.subject}</div>}
      {others.map((t) => <Link key={t.id} to={`/tickets?open=${t.id}`} className={`${row} hover:underline`}><Ticket size={12} className="shrink-0 text-slate-400" /> {t.title}</Link>)}
      {r.meetings.map((m) => <div key={m.id} className={row}><CalendarCheck size={12} className="shrink-0 text-slate-400" /> {m.title} · {longDate(m.meeting_date)}</div>)}
      {!r.event_id && !r.for_ticket && !r.tickets.length && !r.meetings.length && <span className="text-slate-400">Not tied to anything</span>}
    </div>
  );
}
