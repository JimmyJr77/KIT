import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName, shortDate, todayIso } from '../lib/format.js';
import { addDays } from '../lib/travelCalc.js';
import { StatTile, Meter, ChartCard, BarList, StackedColumns, LineChart, DataTable, SERIES, compact, fullMoney, pct } from '../components/Charts.jsx';

/**
 * Financials by team. BD: pipeline by stage, expected revenue by quarter (PWIN-adjusted or not), the undetermined pool,
 * qualified pipeline by territory and director, how the pipeline changed, bookings funded / unfunded, backlog and
 * book-to-bill. Operations: the contracts it delivers. Every team: estimated travel spend.
 */
export default function Financials() {
  const teams = useApi('/teams').data?.teams || [];
  const users = useApi('/users').data?.users || [];
  const territories = useApi('/territories').data?.territories || [];
  const [team, setTeam] = useState('BD');
  const [director, setDirector] = useState('');
  const [territory, setTerritory] = useState('');
  const directors = users.filter((u) => u.teams?.some((t) => t.name === 'BD'));
  const isBd = team === 'BD';

  return (
    <div className="space-y-6">
      {/* One row of filters; everything below follows them. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label className="label">Team</label>
          <select className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        {isBd && (
          <>
            <div className="w-52">
              <label className="label">BD director</label>
              <select className="input" value={director} onChange={(e) => setDirector(e.target.value)}>
                <option value="">All BD directors</option>
                {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
              </select>
            </div>
            <div className="w-56">
              <label className="label">Territory</label>
              <select className="input" value={territory} onChange={(e) => setTerritory(e.target.value)}>
                <option value="">All territories</option>
                {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>
      {isBd ? <BdFinancials director={director} territory={territory} /> : <TeamFinancials team={team} />}
    </div>
  );
}

function BdFinancials({ director, territory }) {
  const qs = new URLSearchParams();
  if (director) qs.set('director', director);
  if (territory) qs.set('territory', territory);
  const { data } = useApi(`/financials/bd?${qs}`);
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const { expected: ex, bookings: bk, backlog: bl, bookToBill: b2b } = data;
  const q = ex.quarters;
  const forecast = q.reduce((s, x) => s + x.weighted, 0);
  // How much of the forecast's underlying bid value has a PWIN behind it (the rest counts at full value).
  const adjValue = q.reduce((s, x) => s + x.adjusted.value, 0);
  const adjustedShare = adjValue + q.reduce((s, x) => s + x.unadjusted.value, 0) ? adjValue / (adjValue + q.reduce((s, x) => s + x.unadjusted.value, 0)) : null;
  const year = bk.target.year;
  const thisQ = Number(q[0].quarter.slice(-1));
  const qTarget = bk.target.quarters[thisQ - 1];
  const qBooked = bk.byQuarter[bk.byQuarter.length - 1];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
        <StatTile label="Open pipeline" value={compact(data.open.value)} sub={`${data.open.count} bids · ${compact(data.open.weighted)} PWIN-weighted`} />
        <StatTile label="Qualified pipeline" value={compact(data.qualified.value)} sub={`${data.qualified.count} bids, Qualified onward`} />
        <StatTile label="Expected next 4 quarters" value={compact(forecast)} sub={`PWIN-weighted · ${pct(adjustedShare)} of the bid value has a PWIN`} />
        {/* Targets are set per director, so there's nothing to compare a single territory against. */}
        <StatTile label={`Booked in ${qBooked.quarter}`} value={compact(qBooked.value)} sub={territory ? 'Targets are set per BD director' : null}>
          {!territory && <Meter value={qBooked.value} target={qTarget || null} />}
        </StatTile>
        <StatTile label={`Booked in ${year}`} value={compact(bk.ytd)} sub={territory ? 'Targets are set per BD director' : null}>
          {!territory && <Meter value={bk.ytd} target={bk.target.total || null} />}
        </StatTile>
        <StatTile label="Book-to-bill, last 12 months" value={b2b.ttm.ratio == null ? '—' : `${b2b.ttm.ratio.toFixed(2)}×`} sub={`${compact(b2b.ttm.booked)} booked ÷ ${compact(b2b.ttm.billed)} billed`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Value by pipeline stage" subtitle="Every bid, open and closed"
          table={{ columns: [{ key: 'stage', label: 'Stage' }, { key: 'count', label: 'Bids', align: 'right' }, { key: 'value', label: 'Value', align: 'right', format: fullMoney }], rows: data.stages }}>
          <BarList rows={data.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.value, sub: `${s.count}` }))} />
        </ChartCard>

        <ChartCard title="Expected revenue by quarter" subtitle="Open bids by projected win date. With a PWIN: value × PWIN. Without one: full value, shown apart."
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'adj', label: 'PWIN-adjusted', align: 'right', format: fullMoney }, { key: 'adjRaw', label: '(unadjusted value)', align: 'right', format: fullMoney },
            { key: 'raw', label: 'No PWIN', align: 'right', format: fullMoney }, { key: 'count', label: 'Bids', align: 'right' }],
            rows: q.map((x) => ({ quarter: x.quarter, adj: x.adjusted.weighted, adjRaw: x.adjusted.value, raw: x.unadjusted.value, count: x.count })) }}>
          <StackedColumns categories={q.map((x) => x.quarter)} height={150}
            series={[{ key: 'adj', label: 'PWIN-adjusted (value × PWIN)', color: SERIES[0], values: q.map((x) => x.adjusted.weighted) },
              { key: 'raw', label: 'No PWIN yet (full value)', color: SERIES[1], values: q.map((x) => x.unadjusted.value) }]} />
        </ChartCard>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-slate-800">Not in a quarter</h3>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
          {[['Undetermined pool', ex.undetermined, 'Win date marked undetermined'], ['Later', ex.later, 'Expected after these four quarters'],
            ['Overdue', ex.overdue, 'Projected date passed, still open'], ['No date set', ex.unscheduled, 'Needs a projected win date']].map(([label, b, note]) => (
            <StatTile key={label} label={label} value={compact(b.value)} sub={`${b.count} bid${b.count === 1 ? '' : 's'} · ${compact(b.weighted)} weighted · ${note}`} />
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Qualified pipeline by territory" subtitle="Open bids, Qualified onward"
          table={{ columns: [{ key: 'name', label: 'Territory' }, { key: 'count', label: 'Bids', align: 'right' }, { key: 'value', label: 'Value', align: 'right', format: fullMoney }, { key: 'weighted', label: 'PWIN-weighted', align: 'right', format: fullMoney }], rows: data.qualifiedByTerritory }}>
          <BarList rows={data.qualifiedByTerritory.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified bids." />
        </ChartCard>
        <ChartCard title="Qualified pipeline by BD director" subtitle="Open bids, Qualified onward"
          table={{ columns: [{ key: 'name', label: 'BD director' }, { key: 'count', label: 'Bids', align: 'right' }, { key: 'value', label: 'Value', align: 'right', format: fullMoney }, { key: 'weighted', label: 'PWIN-weighted', align: 'right', format: fullMoney }], rows: data.qualifiedByDirector }}>
          <BarList rows={data.qualifiedByDirector.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified bids." />
        </ChartCard>
      </div>

      <PipelineTrends director={director} territory={territory} />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Bookings by quarter" subtitle="Contracts won, and how much of each quarter's wins is funded so far"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'count', label: 'Wins', align: 'right' }, { key: 'funded', label: 'Funded', align: 'right', format: fullMoney }, { key: 'unfunded', label: 'Unfunded', align: 'right', format: fullMoney }, { key: 'value', label: 'Booked', align: 'right', format: fullMoney }], rows: bk.byQuarter }}>
          <StackedColumns categories={bk.byQuarter.map((x) => shortQuarter(x.quarter))} height={150}
            series={[{ key: 'funded', label: 'Funded', color: SERIES[0], values: bk.byQuarter.map((x) => x.funded) }, { key: 'unfunded', label: 'Unfunded', color: SERIES[1], values: bk.byQuarter.map((x) => x.unfunded) }]} />
        </ChartCard>
        <ChartCard title="Backlog" subtitle={`${bl.contracts} active contract${bl.contracts === 1 ? '' : 's'}: value not yet billed`}>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Funded backlog" value={bl.fundedBacklog} note="Funded, not yet billed" />
            <Figure label="Unfunded backlog" value={bl.unfundedBacklog} note="Contract value not yet funded" />
            <Figure label="Contract value" value={bl.value} note={`${pct(bl.value ? bl.funded / bl.value : null)} funded`} />
            <Figure label="Billed to date" value={bl.billed} note={`${pct(bl.value ? bl.billed / bl.value : null)} of value`} />
          </div>
          <div className="mt-4 flex h-3 gap-[2px] overflow-hidden rounded" title="Billed, funded backlog, unfunded backlog">
            {[[bl.billed, '#9ca3af'], [bl.fundedBacklog, SERIES[0]], [bl.unfundedBacklog, SERIES[1]]].map(([v, c], i) => v > 0 && (
              <div key={i} style={{ flexGrow: v, background: c }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            {[['Billed', '#9ca3af'], ['Funded backlog', SERIES[0]], ['Unfunded backlog', SERIES[1]]].map(([l, c]) => (
              <span key={l} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>
            ))}
          </div>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Book-to-bill by quarter" subtitle="Bookings ÷ revenue billed in the same quarter; above 1× means the backlog is growing">
          <DataTable columns={[{ key: 'quarter', label: 'Quarter' }, { key: 'booked', label: 'Booked', align: 'right', format: compact },
            { key: 'billed', label: 'Billed', align: 'right', format: compact }, { key: 'ratio', label: 'Ratio', align: 'right', format: ratio }]}
            rows={b2b.byQuarter} foot={{ quarter: `${year} to date`, ...b2b.ytd }} />
        </ChartCard>
        <ChartCard title="Book-to-bill by BD director" subtitle="Last 12 months: what each director booked against what their contracts billed">
          <DataTable columns={[{ key: 'name', label: 'BD director' }, { key: 'booked', label: 'Booked', align: 'right', format: compact },
            { key: 'billed', label: 'Billed', align: 'right', format: compact }, { key: 'ratio', label: 'Ratio', align: 'right', format: ratio }]}
            rows={b2b.byDirector} />
          {!b2b.byDirector.length && <p className="py-3 text-sm text-slate-400">No bookings or billing in the last 12 months.</p>}
        </ChartCard>
      </div>
    </div>
  );
}

const ratio = (r) => (r == null ? '—' : `${r.toFixed(2)}×`);
/** "2026 Q3" → "Q3 '26", for tight axes. */
const shortQuarter = (q) => `Q${q.slice(-1)} '${q.slice(2, 4)}`;

function Figure({ label, value, note }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 tabular-nums">{compact(value)}</div>
      <div className="text-[11px] text-slate-400">{note}</div>
    </div>
  );
}

const RANGES = [['3m', 'Last 3 months', 91], ['6m', 'Last 6 months', 182], ['12m', 'Last 12 months', 365], ['ytd', 'Year to date'], ['2y', 'Last 2 years', 730], ['custom', 'Custom range']];

/** How the pipeline changed: open pipeline by stage, or qualified pipeline by director or territory, week to week and up. */
function PipelineTrends({ director, territory }) {
  const today = todayIso();
  const [range, setRange] = useState('12m');
  const [custom, setCustom] = useState({ from: addDays(today, -180), to: today });
  const [interval, setInterval] = useState('month');
  const [by, setBy] = useState('stage');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const span = RANGES.find(([k]) => k === range);
  const from = range === 'custom' ? custom.from : range === 'ytd' ? `${today.slice(0, 4)}-01-01` : addDays(today, -span[2]);
  const to = range === 'custom' ? custom.to : today;

  useEffect(() => {
    const qs = new URLSearchParams({ from, to, interval, by });
    if (director) qs.set('director', director);
    if (territory) qs.set('territory', territory);
    setError('');
    api.get(`/financials/trends?${qs}`).then(setData).catch((e) => setError(e.message));
  }, [from, to, interval, by, director, territory]);

  const label = (d) => (interval === 'year' ? d.slice(0, 4) : interval === 'quarter' ? `${d.slice(0, 4)} Q${Math.ceil(Number(d.slice(5, 7)) / 3)}`
    : shortDate(d, interval === 'month' ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' }));
  const change = useMemo(() => (data?.series || []).map((s) => ({
    label: s.label, start: s.values[0], end: s.values[s.values.length - 1], delta: s.values[s.values.length - 1] - s.values[0],
  })).sort((a, b) => b.end - a.end), [data]);

  return (
    <ChartCard title="Pipeline over time"
      subtitle={by === 'stage' ? 'Open pipeline by stage, as it stood at the end of each period' : `Qualified pipeline by ${by === 'director' ? 'BD director' : 'territory'}, as it stood at the end of each period`}
      table={data && { columns: [{ key: 'label', label: by === 'stage' ? 'Stage' : by === 'director' ? 'BD director' : 'Territory' },
        { key: 'start', label: label(data.points[0]), align: 'right', format: fullMoney }, { key: 'end', label: label(data.points[data.points.length - 1]), align: 'right', format: fullMoney },
        { key: 'delta', label: 'Change', align: 'right', format: (v) => `${v > 0 ? '+' : ''}${fullMoney(v)}` }], rows: change }}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select className="input h-8 w-40 py-0 text-sm" value={by} onChange={(e) => setBy(e.target.value)} aria-label="Break down by">
          <option value="stage">By stage</option>
          <option value="director">By BD director</option>
          <option value="territory">By territory</option>
        </select>
        <div className="flex h-8 rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-300" role="radiogroup" aria-label="Interval">
          {[['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={interval === k} onClick={() => setInterval(k)}
              className={`rounded px-2.5 ${interval === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
        <select className="input h-8 w-40 py-0 text-sm" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {range === 'custom' && (
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="date" className="input h-8 w-36 py-0 text-sm" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            to
            <input type="date" className="input h-8 w-36 py-0 text-sm" value={custom.to} min={custom.from} max={today} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </span>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && (data.series.length ? (
        <div className={data ? '' : 'opacity-50'}>
          <LineChart points={data.points} labels={data.points.map(label)} series={data.series} />
        </div>
      ) : <p className="py-6 text-center text-sm text-slate-400">No pipeline in this range.</p>)}
      <p className="mt-2 text-[11px] text-slate-400">History is recorded from when tracking started; earlier periods show each bid's first known state.</p>
    </ChartCard>
  );
}

/** Teams other than BD: estimated travel spend, and for Operations, the contracts it delivers; "All teams" compares them. */
function TeamFinancials({ team }) {
  const { data } = useApi('/financials/teams');
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const ops = data.operations;
  if (team === 'all') {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
          <StatTile label="BD: open pipeline" value={compact(data.bd.openValue)} />
          <StatTile label={`BD: booked in ${todayIso().slice(0, 4)}`} value={compact(data.bd.bookedYtd)} />
          <StatTile label="Operations: backlog" value={compact(ops.total)} sub={`${compact(ops.fundedBacklog)} funded · ${compact(ops.unfundedBacklog)} unfunded`} />
          <StatTile label="Operations: billed this quarter" value={compact(ops.billedThisQuarter)} sub={`${ops.activeContracts} active contracts`} />
        </div>
        <TravelByTeam data={data} />
      </div>
    );
  }
  const t = data.teams.find((x) => x.name === team);
  return (
    <div className="space-y-6">
      {team === 'Operations' && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr))]">
          <StatTile label="Active contracts" value={ops.activeContracts} />
          <StatTile label="Backlog" value={compact(ops.total)} sub="Contract value not yet billed" />
          <StatTile label="Funded backlog" value={compact(ops.fundedBacklog)} sub="Funded, not yet billed" />
          <StatTile label="Unfunded backlog" value={compact(ops.unfundedBacklog)} sub="Not yet funded" />
          <StatTile label="Billed this quarter" value={compact(ops.billedThisQuarter)} />
        </div>
      )}
      {t && (
        <ChartCard title={`${team} travel spend`} subtitle="Estimated cost of trips by people on this team, by quarter"
          table={{ columns: [{ key: 'quarter', label: 'Quarter' }, { key: 'value', label: 'Estimated', align: 'right', format: fullMoney }], rows: data.quarters.map((q, i) => ({ quarter: q, value: t.travel.byQuarter[i] })) }}>
          <StackedColumns categories={data.quarters} height={140} series={[{ key: 'travel', label: 'Travel', color: SERIES[0], values: t.travel.byQuarter }]} />
        </ChartCard>
      )}
      {team !== 'Operations' && <p className="text-sm text-slate-500">Pipeline, bookings and backlog are tracked for BD and Operations. Other teams show their travel spend.</p>}
    </div>
  );
}

function TravelByTeam({ data }) {
  return (
    <ChartCard title="Travel spend by team" subtitle={`Estimated trip cost, ${data.quarters[0]} – ${data.quarters[data.quarters.length - 1]}. Someone on two teams counts toward both.`}
      table={{ columns: [{ key: 'name', label: 'Team' }, ...data.quarters.map((q, i) => ({ key: `q${i}`, label: q, align: 'right', format: fullMoney })), { key: 'total', label: 'Total', align: 'right', format: fullMoney }],
        rows: data.teams.map((t) => ({ name: t.name, total: t.travel.total, ...Object.fromEntries(t.travel.byQuarter.map((v, i) => [`q${i}`, v])) })) }}>
      <BarList rows={data.teams.map((t) => ({ key: t.id, label: t.name, value: t.travel.total, sub: `${t.people} people` })).sort((a, b) => b.value - a.value)} />
    </ChartCard>
  );
}
