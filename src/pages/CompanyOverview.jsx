import { Link } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { shortDate } from '../lib/format.js';
import { StatTile, Meter, ChartCard, BarList, StackedColumns, SERIES, compact, fullMoney, pct } from '../components/Charts.jsx';

const day = (iso) => shortDate(iso, { month: 'short', day: 'numeric' });

/** The whole company at a glance: bookings against target, pipeline, backlog, delivery, priorities, travel and events. */
export default function CompanyOverview() {
  const { data } = useApi('/dashboard/overview');
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const { pipeline: pl, bookings: bk, backlog: bl } = data;
  const bq = data.bookingsByQuarter;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
        <StatTile label={`Booked in ${bk.quarter.label}`} value={compact(bk.quarter.booked)}><Meter value={bk.quarter.booked} target={bk.quarter.target} /></StatTile>
        <StatTile label={`Booked in ${bk.year.label}`} value={compact(bk.year.booked)}><Meter value={bk.year.booked} target={bk.year.target} /></StatTile>
        <StatTile label="Qualified pipeline" value={compact(pl.qualified.value)} sub={`${pl.qualified.count} bids, Qualified onward · ${compact(pl.open.value)} open in all`} />
        <StatTile label="Expected next 4 quarters" value={compact(pl.forecastNext4)} sub={`PWIN-weighted · ${compact(pl.undetermined)} more undetermined`} />
        <StatTile label="Backlog" value={compact(bl.total)} sub={`${compact(bl.fundedBacklog)} funded · ${compact(bl.unfundedBacklog)} unfunded`} />
        <StatTile label="Active contracts" value={data.delivery.active}
          sub={data.delivery.needsPm ? <Link to="/delivery" className="font-medium text-amber-700 hover:underline">{data.delivery.needsPm} need a Program Manager</Link> : `${compact(data.delivery.billedThisQuarter)} billed this quarter`} />
        <StatTile label="Priorities closed this week" value={`${data.priorities.completed} of ${data.priorities.planned}`} sub={`${pct(data.priorities.planned ? data.priorities.completed / data.priorities.planned : null)} close-out · ${data.priorities.work} added after planning`} />
        <StatTile label="Travel this quarter" value={compact(data.travel.thisQuarter)} sub="Estimated trip spend" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Open pipeline by stage" subtitle="Value of open bids in each stage"
          table={{ columns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Bids', align: 'right' }, { key: 'value', label: 'Value', align: 'right', format: fullMoney }], rows: pl.stages }}>
          <BarList rows={pl.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.value, sub: `${s.count} bid${s.count === 1 ? '' : 's'}` }))} />
        </ChartCard>
        <ChartCard title="Bookings, last four quarters" subtitle="Contracts won, and how much of each quarter's wins is funded so far"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'count', label: 'Wins', align: 'right' }, { key: 'funded', label: 'Funded', align: 'right', format: fullMoney }, { key: 'unfunded', label: 'Unfunded', align: 'right', format: fullMoney }, { key: 'value', label: 'Booked', align: 'right', format: fullMoney }], rows: bq }}>
          <StackedColumns categories={bq.map((q) => q.quarter)} height={150}
            series={[{ key: 'funded', label: 'Funded', color: SERIES[0], values: bq.map((q) => q.funded) }, { key: 'unfunded', label: 'Unfunded', color: SERIES[1], values: bq.map((q) => q.unfunded) }]} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="People by team" subtitle={`${data.people} people; someone on two teams counts in both`}>
          <BarList rows={data.teams.map((t) => ({ key: t.id, label: t.name, value: t.people }))} format={(n) => String(n)} />
        </ChartCard>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <header className="mb-2 flex items-center gap-2">
            <CalendarDays size={15} className="text-brand-600" />
            <h3 className="mr-auto text-sm font-semibold text-slate-800">Upcoming events</h3>
            <Link to="/events" className="text-xs text-brand-700 hover:underline">Events</Link>
          </header>
          {data.events.length ? (
            <ul className="divide-y divide-slate-100">
              {data.events.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-slate-800">{e.name}</span>
                  <span className="shrink-0 text-xs text-slate-500">{day(e.date_from)} · {e.attendees} going</span>
                </li>
              ))}
            </ul>
          ) : <p className="py-3 text-sm text-slate-400">No upcoming events.</p>}
        </section>
      </div>
    </div>
  );
}
