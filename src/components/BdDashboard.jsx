import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Flag, ListChecks, Plane, AlertTriangle, Info } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { shortDate, todayIso } from '../lib/format.js';
import { locationLabel } from './LocationInput.jsx';
import ReportCard from './ReportCard.jsx';
import YearBasisToggle from './YearBasisToggle.jsx';
import { useYearBasis } from '../lib/yearBasis.js';
import PipelineByPerson from './PipelineByPerson.jsx';
import { StatTile, Meter, ViewCard, ChartCard, DataTable, BarList, StackedColumns, LineChart, SERIES, compact, fullMoney, pct } from './Charts.jsx';

const day = (iso) => shortDate(iso, { month: 'short', day: 'numeric' });
const ratio = (r) => (r == null || !Number.isFinite(r) ? '—' : `${r.toFixed(2)}×`);
const axisRatio = (r) => `${Number(r.toFixed(1))}×`;
/** "2026 Q3" → "Q3 '26", for tight axes. */
const shortQuarter = (q) => `Q${q.slice(-1)} '${q.slice(2, 4)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A share that can be small (expenses against revenue): one decimal under 10%. */
const share = (r) => (r == null || !Number.isFinite(r) ? '—' : r < 0.1 ? `${(r * 100).toFixed(1)}%` : pct(r));

/**
 * The BD dashboard for one person (`director`) or a team (`team`), optionally narrowed to a territory: to-do highlights,
 * top-level metrics, BD numbers and the report card. `self` is true when it's the viewer's own (My dashboard). Someone
 * who isn't in BD (not on the team and directing no pipeline tickets), or a team other than BD, gets the to-do highlights only.
 * `header(data)` renders above everything; `children` sit between the to-do highlights and the numbers.
 */
export default function BdDashboard({ director, team, territory, self = false, header, children }) {
  const qs = new URLSearchParams();
  if (director) qs.set('director', director);
  if (team) qs.set('team', team);
  if (territory) qs.set('territory', territory);
  const [basis] = useYearBasis();
  if (basis === 't4q') qs.set('basis', 't4q');
  const { data, error } = useApi(`/dashboard/bd?${qs}`);
  if (error) return <p className="text-sm text-red-600">{error.message || String(error)}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const isTeam = data.scope.kind === 'team';
  const who = self ? 'you' : isTeam ? `the ${data.scope.label} team` : data.scope.label;
  const money = data.isDirector !== false;
  return (
    <div className="space-y-8">
      {header?.(data)}
      <TodoHighlights todo={data.todo} isTeam={isTeam} self={self} who={who} teamLabel={data.scope.label} />
      {children}
      {money && (
        <>
          <TopMetrics top={data.top} people={data.people} territory={territory} />
          <BdNumbers numbers={data.numbers} isTeam={isTeam} />
          <section className="space-y-3">
            <ReportCard key={director || team} director={isTeam ? undefined : data.scope.director} who={data.scope.label}
              title={isTeam ? `${data.scope.label} report card` : self ? 'Your BD report card' : `${data.scope.label}'s BD report card`} />
          </section>
        </>
      )}
    </div>
  );
}

function SectionHead({ title, note, children }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {note && <p className="text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </div>
  );
}

// ---- To-do highlights

function TodoHighlights({ todo, isTeam, self, who, teamLabel }) {
  const p = todo.priorities;
  const [allEvents, setAllEvents] = useState(false);
  const events = allEvents ? [...todo.events, ...todo.otherEvents].sort((a, b) => (a.date_from < b.date_from ? -1 : 1)) : todo.events;
  const today = todayIso();
  return (
    <section>
      <SectionHead title="To-do highlights" />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <StatTile label="Priorities closed this week" value={`${p.completed} of ${p.planned}`}
          sub={[p.work && `${p.work} more added after planning`, p.waiting && `${p.waiting} waiting on client, not counted`].filter(Boolean).join(' · ') || null}>
          <Meter value={p.completed} target={p.planned || null} format={String} noun="planned" label="Share of this week's planned priorities completed" />
        </StatTile>
        <StatTile label="Priorities closed per week" value={p.perWeek ?? '—'}
          sub={p.weeks ? `Average over the last ${p.weeks === 1 ? 'week' : `${p.weeks} weeks`} · waiting on client not counted` : 'No finished weeks yet'} />
        <StatTile label="Open tasks" value={todo.activities.open}
          sub={[todo.activities.overdue && `${todo.activities.overdue} overdue`, todo.activities.dueThisWeek && `${todo.activities.dueThisWeek} due this week`].filter(Boolean).join(' · ') || 'Activities assigned'} />
        <StatTile label="Unread alerts" value={todo.alerts} sub={self ? <Link to="/alerts" className="text-brand-700 hover:underline">Open alerts</Link> : null} />
        <StatTile label="Upcoming trips" value={todo.trips.list.length} sub={todo.trips.list.length ? `${compact(todo.trips.cost)} estimated` : 'None planned'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ListCard icon={ListChecks} title="Open priorities this week" empty="Nothing open." link={['/priorities', 'Weekly Priorities']}
          items={p.open.map((c) => ({
            key: c.id, title: c.title || 'Untitled priority', to: `/tickets?open=${c.ticket_id}`,
            sub: [c.who, c.ticket, c.due_date && `due ${day(c.due_date)}`].filter(Boolean).join(' · '), warn: c.due_date && c.due_date < today,
          }))} />
        <ListCard icon={Flag} title="Account objectives" empty="No open objectives." link={['/crm?tab=objectives', 'CRM']}
          items={todo.objectives.map((o) => ({
            key: o.id, title: o.objective, sub: [o.owner, o.organization, o.status, o.target_date && `by ${day(o.target_date)}`].filter(Boolean).join(' · '),
            warn: o.target_date && o.target_date < today,
          }))} />
        <ListCard icon={Plane} title="Upcoming trips and costs" empty="No trips planned." link={['/travel', 'Travel']}
          aside={todo.trips.list.length > 0 && <span className="text-xs font-semibold text-slate-700 tabular-nums">{fullMoney(todo.trips.cost)} estimated</span>}
          items={todo.trips.list.map((t) => ({
            key: t.id, title: [t.traveler, locationLabel(t.location_to) || 'Trip'].filter(Boolean).join(' · '),
            sub: `${day(t.date_from)} – ${day(t.date_to)}${t.purposes?.length ? ` · ${t.purposes.join(', ')}` : ''}`,
            right: fullMoney(t.total_estimate),
          }))} />
        <ListCard icon={CalendarDays} title="Upcoming events" link={['/events', 'Events']}
          empty={allEvents ? 'No upcoming events.' : `No upcoming events with ${who === 'you' ? 'you' : who} attending.`}
          aside={(
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} />
              Include events {isTeam ? `no one on ${teamLabel} is` : self ? "you aren't" : "they aren't"} attending
            </label>
          )}
          items={events.map((e) => ({
            key: e.id, title: e.name, dim: !e.attendees.length,
            sub: [`${day(e.date_from)} – ${day(e.date_to)}`, locationLabel(e.location),
              e.attendees.length ? (isTeam ? e.attendees.join(', ') : 'Attending') : `${isTeam ? `No one from ${teamLabel}` : self ? "You're not" : 'Not'} attending${e.others ? ` · ${plural(e.others, 'other')} going` : ''}`,
            ].filter(Boolean).join(' · '),
          }))} />
      </div>
    </section>
  );
}

function ListCard({ icon: Icon, title, items, empty, link, aside }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Icon size={15} className="text-brand-600" />
        <h3 className="mr-auto text-sm font-semibold text-slate-800">{title}</h3>
        {aside}
        {link && <Link to={link[0]} className="text-xs text-brand-700 hover:underline">{link[1]}</Link>}
      </header>
      {items.length ? (
        <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
          {items.map((i) => {
            const body = (
              <>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${i.dim ? 'text-slate-500' : 'text-slate-800'}`}>{i.title}</div>
                  <div className={`truncate text-xs ${i.warn ? 'font-medium text-red-700' : 'text-slate-500'}`}>{i.sub}{i.warn && ' · overdue'}</div>
                </div>
                {i.right && <span className="shrink-0 text-xs font-medium text-slate-700 tabular-nums">{i.right}</span>}
              </>
            );
            return (
              <li key={i.key}>
                {i.to ? <Link to={i.to} className="-mx-1 flex items-center gap-3 rounded px-1 py-2 hover:bg-slate-50">{body}</Link>
                  : <div className="flex items-center gap-3 py-2">{body}</div>}
              </li>
            );
          })}
        </ul>
      ) : <p className="py-3 text-sm text-slate-400">{empty}</p>}
    </section>
  );
}

// ---- Top-level metrics

/** Two figures in one tile: this quarter and this year (or the trailing four quarters), each against a target when there is one. */
function PairTile({ label, q, y, note }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 grid grid-cols-2 gap-3">
        {[q, y].map((x) => (
          <div key={x.label} className="min-w-0">
            <div className="text-xl font-bold text-slate-900 tabular-nums">{compact(x.value)}</div>
            <div className="text-[11px] text-slate-500">{x.label}</div>
            {x.target !== undefined && <Meter value={x.value} target={x.target} />}
          </div>
        ))}
      </div>
      {note && <div className="mt-1 text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

function TopMetrics({ top, people, territory }) {
  const { qualified: ql, expected: ex, expenses: xp } = top;
  const exRows = [
    { period: xp.quarter.label, ...xp.quarter },
    { period: xp.year.label, ...xp.year },
  ];
  return (
    <section>
      <SectionHead title="Top-level metrics"
        note={top.booked.year.label.includes('–') ? 'Yearly figures cover the last four finished quarters.' : 'Yearly figures cover this calendar year to date.'}>
        <YearBasisToggle />
      </SectionHead>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(12.5rem,1fr))]">
        <StatTile label="Qualified+ pipeline" value={compact(ql.value)} sub={`${plural(ql.count, 'open PL ticket')}, Qualified onward · ${compact(ql.weighted)} PWIN-adjusted`}>
          <Meter value={ql.value} target={ql.target} noun={`${top.booked.quarter.label} target`} label="Qualified+ pipeline against this quarter's qualified pipeline target" />
          {ql.yearTarget && ql.yearTarget !== ql.target && <div className="text-[11px] text-slate-500">{compact(ql.yearTarget)} to hold at year end</div>}
          {territory && <div className="mt-1 text-[11px] text-slate-400">Targets are set per BD director, not per territory</div>}
        </StatTile>
        <PairTile label="Booked (awarded)" q={top.booked.quarter} y={top.booked.year} note={territory ? 'Targets are set per BD director, not per territory' : null} />
        <PairTile label="Revenue (billed)" q={top.revenue.quarter} y={top.revenue.year} />
        <StatTile label={`Expected bookings through ${ex.through}`} value={compact(ex.byQ4.weighted)}
          sub={`PWIN-adjusted, ${plural(ex.byQ4.count, 'Qualified+ PL ticket')} with a close date by year end`}>
          <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600" title="All PWIN-adjusted">
            <Row label="All Qualified+" value={compact(ex.all.weighted)} strong />
            <Row label={`With close date (${ex.dated.count})`} value={compact(ex.dated.weighted)} />
            <Row label={`No close date (${ex.undated.count})`} value={compact(ex.undated.weighted)} />
            {ex.overdue.count > 0 && <Row label={`Date passed (${ex.overdue.count})`} value={compact(ex.overdue.weighted)} warn />}
          </div>
        </StatTile>
        <StatTile label="Total expenses" value={compact(xp.year.total)} sub={`${xp.year.label} · ${compact(xp.quarter.total)} in ${xp.quarter.label}`}>
          <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <Row label="Travel (actual)" value={compact(xp.year.travel)} />
            <Row label="Marketing" value={compact(xp.year.marketing)} />
            <Row label="Expenses ÷ revenue" value={xp.year.ratio == null ? 'No revenue' : share(xp.year.ratio)} strong />
          </div>
        </StatTile>
        <TravelVariance months={top.travelVariance} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ViewCard title="Expenses against revenue" subtitle="Actual travel spend plus marketing spend, against revenue billed. Estimated trip cost is shown for comparison."
          initial="table"
          table={{ columns: [{ key: 'period', label: 'Period' }, { key: 'travel', label: 'Travel', align: 'right', format: fullMoney },
            { key: 'travelEstimated', label: 'Trips (est.)', align: 'right', format: fullMoney }, { key: 'marketing', label: 'Marketing', align: 'right', format: fullMoney },
            { key: 'total', label: 'Total', align: 'right', format: fullMoney }, { key: 'revenue', label: 'Revenue', align: 'right', format: fullMoney },
            { key: 'ratio', label: 'Exp. ÷ rev.', align: 'right', format: share }], rows: exRows }}
          bar={(
            <StackedColumns categories={exRows.map((r) => r.period)} height={140}
              series={[{ key: 'travel', label: 'Travel (actual)', color: SERIES[0], values: exRows.map((r) => r.travel) },
                { key: 'marketing', label: 'Marketing', color: SERIES[1], values: exRows.map((r) => r.marketing) }]} />
          )} />
        {people ? (
          <ViewCard title="Spend and results by person" subtitle={`${xp.year.label}: each person's actual travel and marketing spend, what they booked, and revenue on their contracts. Marketing tied to an event is split between the people who went.`}
            initial="table"
            table={{ columns: [{ key: 'name', label: 'Person' }, { key: 'travel', label: 'Travel', align: 'right', format: compact }, { key: 'marketing', label: 'Marketing', align: 'right', format: compact },
              { key: 'total', label: 'Total', align: 'right', format: compact }, { key: 'booked', label: 'Booked', align: 'right', format: compact },
              { key: 'revenue', label: 'Revenue', align: 'right', format: compact }], rows: people }}
            bar={<BarList rows={[...people].sort((a, b) => b.marketing - a.marketing).map((p) => ({ key: p.id, label: p.name, value: p.marketing, sub: `${compact(p.travel)} travel` }))} empty="No spend recorded." />} />
        ) : (
          <ChartCard title="Where the money goes" subtitle={xp.year.label}>
            <DataTable columns={[{ key: 'label', label: '' }, { key: 'value', label: 'Amount', align: 'right', format: fullMoney }]}
              rows={[{ label: 'Travel (actual)', value: xp.year.travel }, { label: 'Trips (estimated)', value: xp.year.travelEstimated },
                { label: 'Marketing', value: xp.year.marketing }, { label: 'Revenue billed', value: xp.year.revenue }]} />
            <p className="mt-2 text-[11px] text-slate-400">Marketing counts spend tied to this person, to their pipeline tickets, or (split evenly) to events they attended. The Marketing team records it under Marketing › Spend.</p>
          </ChartCard>
        )}
      </div>
      <SpendWatch watch={top.spendWatch} />
    </section>
  );
}

/** "+$1.2K" over the estimate, "−$800" under it, "$0" on it. */
const signed = (n) => (Math.abs(n) < 0.5 ? '$0' : `${n > 0 ? '+' : '−'}${compact(Math.abs(n))}`);

/** Travel actual against estimated, month by month: last month's variance up top, then each of the last six months. */
function TravelVariance({ months }) {
  if (!months?.length) return null;
  const last = months[months.length - 2] || months[0];
  return (
    <StatTile label="Travel: actual vs estimated" value={<span className={last.variance > 0.5 ? 'text-amber-700' : last.variance < -0.5 ? 'text-emerald-700' : ''}>{signed(last.variance)}</span>}
      sub={`${last.label} · ${compact(last.actual)} actual vs ${compact(last.estimated)} estimated`}>
      <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-xs text-slate-600" title="Each month's actual travel spend less the estimate for trips starting that month; over the estimate is positive">
        {months.map((m) => (
          <Row key={m.key} label={`${m.label}${m.current ? ' (so far)' : ''}`} value={`${signed(m.variance)} · ${compact(m.actual)} / ${compact(m.estimated)}`} warn={m.variance > 0.5} />
        ))}
      </div>
    </StatTile>
  );
}

/** The upcoming months and quarters whose spend, actual or estimated, goes over the limit; or a quiet line when none does. */
function SpendWatch({ watch: w }) {
  if (!w) return null;
  const flagged = [...w.months.map((x) => ({ ...x, kind: 'month' })), ...w.quarters.map((x) => ({ ...x, kind: 'quarter' }))];
  const limits = `${compact(w.limits.month)} in a month or ${compact(w.limits.quarter)} in a quarter`;
  const span = `the next ${w.ahead.months} months`;
  if (!flagged.length) {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <Info size={14} className="shrink-0 text-slate-400" /> No month or quarter in {span} goes over {limits}, actual or estimated.
      </p>
    );
  }
  return (
    <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Spend over the limit">
      <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <AlertTriangle size={15} className="text-amber-600" />
        <h3 className="text-sm font-semibold text-amber-900">Spend over the limit</h3>
        <span className="text-xs text-amber-800">Over {limits}, actual or estimated, in {span}. Actual is travel and marketing spend; estimated swaps in the trip estimates.</span>
      </header>
      <ul className="divide-y divide-amber-200">
        {flagged.map((x) => (
          <li key={`${x.kind}-${x.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
            <span className="text-sm font-semibold text-amber-900">{x.label}</span>
            <span className="text-xs text-amber-800 tabular-nums">{fullMoney(x.actual)} actual · {fullMoney(x.estimated)} estimated</span>
            <span className="ml-auto text-xs font-semibold text-red-700 tabular-nums">{fullMoney(Math.max(x.actual, x.estimated) - x.limit)} over the {x.kind}'s {compact(x.limit)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Row({ label, value, strong, warn }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? 'font-semibold text-slate-800' : ''} ${warn ? 'text-amber-700' : ''}`}>
      <span className="truncate">{label}</span><span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

// ---- BD numbers

function BdNumbers({ numbers: n, isTeam }) {
  const bk = n.bookings;
  const rv = n.revenue;
  const cl = n.closings;
  const ql = n.qualified;
  const pools = [['Close date passed', cl.overdue], ['Date undetermined', cl.undetermined], ['No date set', cl.unscheduled], ['Later', cl.later]].filter(([, b]) => b.count);
  const trendLabel = (d) => shortDate(d, { month: 'short', year: '2-digit' });
  const [qualBy, setQualBy] = useState('stage');
  const qualRows = qualBy === 'stage' ? ql.stages.map((s) => ({ key: s.stage, label: s.stage, count: s.count, value: s.value, weighted: s.weighted }))
    : (qualBy === 'territory' ? ql.byTerritory : ql.byDirector || []).map((g) => ({ key: g.id ?? g.name, label: g.name, count: g.count, value: g.value, weighted: g.weighted }));

  return (
    <section>
      <SectionHead title="BD numbers" note="Switch each card between a table, a bar chart and a timeline." />
      <div className="grid gap-4 lg:grid-cols-2">
        <ViewCard title="Booked (awarded)" subtitle="Contracts won each quarter, and how much of each quarter's wins is funded so far"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'count', label: 'Wins', align: 'right' }, { key: 'funded', label: 'Funded', align: 'right', format: fullMoney },
            { key: 'unfunded', label: 'Unfunded', align: 'right', format: fullMoney }, { key: 'value', label: 'Booked', align: 'right', format: fullMoney }], rows: bk }}
          bar={<StackedColumns categories={bk.map((x) => shortQuarter(x.quarter))} height={150}
            series={[{ key: 'funded', label: 'Funded', color: SERIES[0], values: bk.map((x) => x.funded) }, { key: 'unfunded', label: 'Unfunded', color: SERIES[1], values: bk.map((x) => x.unfunded) }]} />}
          timeline={<LineChart points={bk.map((x) => x.quarter)} labels={bk.map((x) => shortQuarter(x.quarter))} height={180}
            series={[{ key: 'booked', label: 'Booked', values: bk.map((x) => x.value) }]} />} />

        <ViewCard title="Recognized revenue (billed)" subtitle="Revenue billed on won contracts each quarter"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'value', label: 'Billed', align: 'right', format: fullMoney }], rows: rv }}
          bar={<StackedColumns categories={rv.map((x) => shortQuarter(x.quarter))} height={150} series={[{ key: 'rev', label: 'Revenue', color: SERIES[2], values: rv.map((x) => x.value) }]} />}
          timeline={<LineChart points={rv.map((x) => x.quarter)} labels={rv.map((x) => shortQuarter(x.quarter))} height={180}
            series={[{ key: 'rev', label: 'Revenue', values: rv.map((x) => x.value) }]} />} />

        <ViewCard className="lg:col-span-2" title="Qualified+ pipeline" subtitle={`Open pipeline tickets from Qualified onward that haven't been awarded: ${compact(ql.stages.reduce((s, x) => s + x.value, 0))} in all`}
          table={{ columns: [{ key: 'label', label: qualBy === 'stage' ? 'Stage' : qualBy === 'territory' ? 'Territory' : 'BD director' }, { key: 'count', label: 'PL tickets', align: 'right' },
            { key: 'value', label: 'Value', align: 'right', format: fullMoney }, { key: 'weighted', label: 'PWIN-adjusted', align: 'right', format: fullMoney }], rows: qualRows }}
          bar={(
            <div>
              <div className="mb-3 flex h-7 w-fit rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200" role="radiogroup" aria-label="Break down by">
                {[['stage', 'Stage'], ['territory', 'Territory'], ...(isTeam ? [['director', 'BD director']] : [])].map(([k, l]) => (
                  <button key={k} type="button" role="radio" aria-checked={qualBy === k} onClick={() => setQualBy(k)}
                    className={`rounded px-2 ${qualBy === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
                ))}
              </div>
              <BarList rows={qualRows.map((r) => ({ key: r.key, label: r.label, value: r.value, sub: `${r.count}` }))} empty="No Qualified+ pipeline tickets." />
              {qualBy === 'stage' && ql.byDirector?.length > 0 && <DirectorStages directors={ql.byDirector} />}
            </div>
          )}
          timeline={<LineChart points={ql.trend.points} labels={ql.trend.points.map(trendLabel)} height={180}
            series={[{ key: 'q', label: 'Qualified+ pipeline', values: ql.trend.values }]} />} />

        <PipelineByPerson className="lg:col-span-2" data={ql.byPerson} />

        <ViewCard className="lg:col-span-2" title="Qualified+ expected bookings by quarter"
          subtitle="Qualified+ pipeline tickets by the quarter of their projected win date. Each column's full height is their full value; pipeline tickets with a PWIN count at value × PWIN, and those without one count at full value and are shown apart."
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'count', label: 'PL tickets', align: 'right' }, { key: 'value', label: 'Full value', align: 'right', format: fullMoney },
            { key: 'adjCount', label: 'With PWIN', align: 'right' }, { key: 'adj', label: 'PWIN-adjusted', align: 'right', format: fullMoney }, { key: 'adjRaw', label: '(their full value)', align: 'right', format: fullMoney },
            { key: 'rawCount', label: 'No PWIN', align: 'right' }, { key: 'raw', label: 'No-PWIN value', align: 'right', format: fullMoney }, { key: 'total', label: 'Expected', align: 'right', format: fullMoney }],
            rows: [...cl.quarters.map((x) => [x.quarter, x]), ...pools].map(([quarter, x]) => ({ quarter, count: x.count, value: x.value, adjCount: x.adjusted.count, adj: x.adjusted.weighted,
              adjRaw: x.adjusted.value, rawCount: x.unadjusted.count, raw: x.unadjusted.value, total: x.weighted })) }}
          bar={<StackedColumns categories={cl.quarters.map((x) => `${shortQuarter(x.quarter)} · ${x.count}`)} height={150}
            series={[{ key: 'adj', label: 'PWIN-adjusted (value × PWIN)', color: SERIES[0], values: cl.quarters.map((x) => x.adjusted.weighted) },
              { key: 'raw', label: 'No PWIN yet (full value)', color: SERIES[1], values: cl.quarters.map((x) => x.unadjusted.value) },
              { key: 'cut', label: 'Taken off by PWIN', color: '#cbd5e1', values: cl.quarters.map((x) => x.adjusted.value - x.adjusted.weighted) }]} />}
          timeline={<LineChart points={cl.quarters.map((x) => x.quarter)} labels={cl.quarters.map((x) => shortQuarter(x.quarter))} height={180}
            series={[{ key: 'all', label: 'Full value', values: cl.quarters.map((x) => x.value) }, { key: 'total', label: 'Expected', values: cl.quarters.map((x) => x.weighted) },
              { key: 'adj', label: 'PWIN-adjusted', values: cl.quarters.map((x) => x.adjusted.weighted) }, { key: 'raw', label: 'No PWIN (full value)', values: cl.quarters.map((x) => x.unadjusted.value) }]} />}
          footer={pools.length > 0 && <p className="mt-3 text-xs text-slate-500">Not in a quarter: {pools.map(([l, b]) => `${l} ${compact(b.value)} (${b.count})`).join(' · ')}</p>} />
      </div>
      <BookToBill b2b={n.bookToBill} />
    </section>
  );
}

/** Each BD director's Qualified+ pipeline stage by stage, in small cards on one scale so they compare. */
function DirectorStages({ directors }) {
  const scale = Math.max(...directors.flatMap((d) => d.stages.map((s) => s.value)), 0);
  return (
    <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-3">
      {directors.map((d) => (
        <div key={d.id ?? 'none'} className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-800">{d.name}</h4>
            <span className="shrink-0 text-xs font-semibold text-slate-900 tabular-nums">{compact(d.value)}<span className="ml-1 font-normal text-slate-400">{d.count}</span></span>
          </div>
          <BarList scale={scale} rows={d.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.value, sub: `${s.count}` }))} />
        </div>
      ))}
    </div>
  );
}

// ---- Book-to-bill

export function BookToBill({ b2b }) {
  const [info, setInfo] = useState(false);
  const q = b2b.quarters;
  const bl = b2b.backlog;
  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Book-to-bill</h3>
        <button type="button" onClick={() => setInfo(!info)} aria-expanded={info}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Info size={14} /> What the three methods mean
        </button>
      </div>
      {info && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <p><strong>Book-to-bill</strong> = bookings ÷ revenue billed over the same period. Above 1.0× the backlog is growing (winning more than you burn), at 1.0× it's steady, and below 1.0× you're billing down the backlog faster than you replace it.</p>
          <p><strong>Conventional:</strong> each quarter's bookings (full contract value, on the award date) ÷ that quarter's billings. Simple, but a single large multi-year award makes it spike, then drop toward zero.</p>
          <p><strong>Trailing twelve months (TTM):</strong> the last four quarters' bookings ÷ their billings, rolled forward each quarter. It smooths out lumpy awards, so it's the best read on the trend.</p>
          <p><strong>Funded backlog:</strong> counts a booking only when the government obligates money (funding recorded on a contract under Delivery), ÷ billings. It's the most conservative view, because it ignores unfunded ceiling and option years.</p>
        </div>
      )}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))] print:grid-cols-4">
        <StatTile label="Conventional, this quarter to date" value={ratio(b2b.quarter.ratio)} sub={`${compact(b2b.quarter.booked)} booked ÷ ${compact(b2b.quarter.billed)} billed`} />
        <StatTile label="Trailing twelve months" value={ratio(b2b.ttm.ratio)} sub={`${compact(b2b.ttm.booked)} booked ÷ ${compact(b2b.ttm.billed)} billed`} />
        <StatTile label="Funded backlog, last 12 months" value={ratio(b2b.fundedTtm.ratio)} sub={`${compact(b2b.fundedTtm.funded)} funded ÷ ${compact(b2b.fundedTtm.billed)} billed`} />
        <StatTile label="Backlog" value={compact(bl.total)} sub={`${compact(bl.fundedBacklog)} funded · ${compact(bl.unfundedBacklog)} unfunded · ${plural(bl.contracts, 'active contract')}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        <ViewCard title="Book-to-bill by quarter, three ways" subtitle="Ratios over the last eight quarters; the dashed line is 1.0×. Anything above 4× runs along the top (hover for the value)." initial="timeline"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'conventional', label: 'Conventional', align: 'right', format: ratio },
            { key: 'ttm', label: 'TTM', align: 'right', format: ratio }, { key: 'fundedRatio', label: 'Funded', align: 'right', format: ratio }], rows: q }}
          bar={<StackedColumns categories={q.map((x) => shortQuarter(x.quarter))} height={150} format={axisRatio} tipFormat={ratio}
            series={[{ key: 'ttm', label: 'TTM ratio', color: SERIES[0], values: q.map((x) => x.ttm ?? 0) }]} />}
          timeline={<LineChart points={q.map((x) => x.quarter)} labels={q.map((x) => shortQuarter(x.quarter))} height={200} format={axisRatio} tipFormat={ratio}
            reference={1} referenceLabel="1.0×" ceiling={4}
            series={[{ key: 'conv', label: 'Conventional', values: q.map((x) => x.conventional) }, { key: 'ttm', label: 'Trailing 12 months', values: q.map((x) => x.ttm) },
              { key: 'funded', label: 'Funded backlog', values: q.map((x) => x.fundedRatio) }]} />} />
        <ViewCard title="What goes into it" subtitle="Booked each quarter, and billed: how much was realized in revenue that quarter" initial="bar"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'booked', label: 'Booked', align: 'right', format: fullMoney },
            { key: 'billed', label: 'Billed', align: 'right', format: fullMoney }, { key: 'ttmBooked', label: 'TTM booked', align: 'right', format: fullMoney }, { key: 'ttmBilled', label: 'TTM billed', align: 'right', format: fullMoney }], rows: q }}
          bar={(
            <div className="space-y-4">
              {[['booked', 'Booked', SERIES[0]], ['billed', 'Billed', SERIES[2]]].map(([k, l, c]) => (
                <div key={k}>
                  <div className="mb-1 text-xs font-medium text-slate-600">{l}</div>
                  <StackedColumns categories={q.map((x) => shortQuarter(x.quarter))} height={60} series={[{ key: k, label: l, color: c, values: q.map((x) => x[k]) }]} />
                </div>
              ))}
            </div>
          )}
          timeline={<LineChart points={q.map((x) => x.quarter)} labels={q.map((x) => shortQuarter(x.quarter))} height={200}
            series={[{ key: 'booked', label: 'Booked', values: q.map((x) => x.booked) }, { key: 'billed', label: 'Billed', values: q.map((x) => x.billed) }]} />} />
      </div>
      {!q.some((x) => x.billed) && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle size={14} /> No billing is recorded in these quarters, so there are no ratios yet. Record funding and billing on contracts under Delivery.
        </p>
      )}
    </div>
  );
}
