import { Link } from 'react-router-dom';
import { CalendarDays, Flag, ListChecks, Plane, AlertTriangle } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { useAuth } from '../lib/auth.jsx';
import ReportCard from '../components/ReportCard.jsx';
import { shortDate, todayIso } from '../lib/format.js';
import { locationLabel } from '../components/LocationInput.jsx';
import { StatTile, Meter, ChartCard, StackedColumns, SERIES, compact, fullMoney } from '../components/Charts.jsx';

const day = (iso) => shortDate(iso, { month: 'short', day: 'numeric' });

/** Your own things: this week's priorities and tasks, trips, events, alerts, account objectives, and (BD directors) your numbers. */
export default function MyDashboard() {
  const { user } = useAuth();
  const { data } = useApi('/dashboard/me');
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const p = data.priorities;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
        <StatTile label="Priorities closed this week" value={`${p.completed} of ${p.planned}`} sub={p.work ? `${p.work} more added after planning` : 'Across your teams'}>
          <Meter value={p.completed} target={p.planned || null} format={String} noun="planned" label="Share of this week's planned priorities you've completed" />
        </StatTile>
        <StatTile label="Open tasks" value={p.tasksOpen} sub={`${p.tasksDone} done this week`} />
        <StatTile label="Unread alerts" value={data.alerts} sub={<Link to="/alerts" className="text-brand-700 hover:underline">Open alerts</Link>} />
        <StatTile label="Upcoming trips" value={data.trips.length} sub={data.trips[0] ? `Next: ${day(data.trips[0].date_from)}` : 'None planned'} />
      </div>

      {data.bd && <MyNumbers bd={data.bd} />}
      {data.bd && <ReportCard director={user.id} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard icon={ListChecks} title="Open priorities this week" empty="Nothing open. Nice." link={['/priorities', 'Weekly Priorities']}
          items={p.open.map((c) => ({ key: c.id, title: c.title || 'Untitled priority', sub: [c.ticket, c.due_date && `due ${day(c.due_date)}`].filter(Boolean).join(' · '),
            warn: c.due_date && c.due_date < todayIso() })) } />
        <ListCard icon={Flag} title="Your account objectives" empty={data.bd ? 'No open objectives. Add one under CRM › Account objectives.' : 'None assigned to you.'}
          link={['/crm', 'CRM']} items={data.objectives.map((o) => ({ key: o.id, title: o.objective, sub: [o.organization, o.status, o.target_date && `by ${day(o.target_date)}`].filter(Boolean).join(' · '),
            warn: o.target_date && o.target_date < todayIso() }))} />
        <ListCard icon={Plane} title="Your upcoming trips" empty="No trips planned." link={['/travel', 'Travel']}
          items={data.trips.map((t) => ({ key: t.id, title: locationLabel(t.location_to) || 'Trip', sub: `${day(t.date_from)} – ${day(t.date_to)} · ${compact(t.total_estimate)} estimated` }))} />
        <ListCard icon={CalendarDays} title="Events you're attending" empty="No upcoming events." link={['/events', 'Events']}
          items={data.events.map((e) => ({ key: e.id, title: e.name, sub: `${day(e.date_from)} – ${day(e.date_to)}` }))} />
      </div>
    </div>
  );
}

/** A BD director's own pipeline, bookings against target, and forecast. */
function MyNumbers({ bd }) {
  const q = bd.expected.quarters;
  const pools = [['Undetermined', bd.expected.undetermined], ['Overdue', bd.expected.overdue], ['No date set', bd.expected.unscheduled]].filter(([, b]) => b.count);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800">Your BD numbers</h2>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
        <StatTile label={`Booked in ${bd.bookings.quarter.label}`} value={compact(bd.bookings.quarter.booked)}>
          <Meter value={bd.bookings.quarter.booked} target={bd.bookings.quarter.target} />
        </StatTile>
        <StatTile label={`Booked in ${bd.bookings.year.label}`} value={compact(bd.bookings.year.booked)}>
          <Meter value={bd.bookings.year.booked} target={bd.bookings.year.target} />
        </StatTile>
        <StatTile label="Your open pipeline" value={compact(bd.open.value)} sub={`${bd.open.count} open bid${bd.open.count === 1 ? '' : 's'}`} />
        <StatTile label="Your qualified pipeline" value={compact(bd.qualified.value)} sub={`${bd.qualified.count} bid${bd.qualified.count === 1 ? '' : 's'}, Qualified onward`} />
      </div>
      <ChartCard title="Your expected revenue by quarter" subtitle="Open bids by projected win date. PWIN-adjusted bids count at value × PWIN; bids without a PWIN count at full value."
        table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'adj', label: 'PWIN-adjusted', align: 'right', format: fullMoney }, { key: 'raw', label: 'No PWIN (full value)', align: 'right', format: fullMoney }, { key: 'count', label: 'Bids', align: 'right' }],
          rows: q.map((x) => ({ quarter: x.quarter, adj: x.adjusted.weighted, raw: x.unadjusted.value, count: x.count })) }}>
        <StackedColumns categories={q.map((x) => x.quarter)} height={140}
          series={[{ key: 'adj', label: 'PWIN-adjusted', color: SERIES[0], values: q.map((x) => x.adjusted.weighted) },
            { key: 'raw', label: 'No PWIN (full value)', color: SERIES[1], values: q.map((x) => x.unadjusted.value) }]} />
        {pools.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">Not in a quarter: {pools.map(([l, b]) => `${l} ${compact(b.value)} (${b.count})`).join(' · ')}</p>
        )}
      </ChartCard>
      {bd.needsDate.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={14} /> {bd.needsDate.length} of your open bids {bd.needsDate.length === 1 ? 'has' : 'have'} no projected win date:
          {bd.needsDate.map((t, i) => <span key={t.id}><Link className="font-medium underline" to={`/tickets?open=${t.id}`}>{t.title}</Link>{i < bd.needsDate.length - 1 ? ',' : ''}</span>)}
        </p>
      )}
    </section>
  );
}

function ListCard({ icon: Icon, title, items, empty, link }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-2 flex items-center gap-2">
        <Icon size={15} className="text-brand-600" />
        <h3 className="mr-auto text-sm font-semibold text-slate-800">{title}</h3>
        {link && <Link to={link[0]} className="text-xs text-brand-700 hover:underline">{link[1]}</Link>}
      </header>
      {items.length ? (
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.key} className="py-2">
              <div className="truncate text-sm text-slate-800">{i.title}</div>
              <div className={`truncate text-xs ${i.warn ? 'font-medium text-red-700' : 'text-slate-500'}`}>{i.sub}{i.warn && ' · overdue'}</div>
            </li>
          ))}
        </ul>
      ) : <p className="py-3 text-sm text-slate-400">{empty}</p>}
    </section>
  );
}

