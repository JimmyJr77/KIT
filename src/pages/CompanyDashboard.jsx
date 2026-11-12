import { useState } from 'react';
import { useApi } from '../lib/data.js';
import { fullName, todayIso } from '../lib/format.js';
import { StatTile, ChartCard, BarList, StackedColumns, SERIES, compact, fullMoney } from '../components/Charts.jsx';
import BdDashboard from '../components/BdDashboard.jsx';
import PriorityAccounts from '../components/PriorityAccounts.jsx';
import MarketingSpend from '../components/MarketingSpend.jsx';
import { isBdDirector } from '../lib/bd.js';

/**
 * The Company dashboard: pick a team, and then anyone on it. BD (the team, or one person on it) gets the BD dashboard:
 * to-do highlights, top-level metrics, BD numbers and the report card, the same views each BD director has on their own
 * dashboard, plus their priority accounts. Other teams get their to-do highlights and their own figures: Marketing its
 * spend, Operations the contracts it delivers, every team its travel. "All teams" compares them.
 */
export default function CompanyDashboard() {
  const teams = useApi('/teams').data?.teams || [];
  const users = useApi('/users').data?.users || [];
  const territories = useApi('/territories').data?.territories || [];
  const [team, setTeam] = useState('BD');
  const [person, setPerson] = useState('');
  const [territory, setTerritory] = useState('');
  const teamRow = teams.find((t) => t.name === team);
  // BD's people picker lists the BD directors only (BD Team's "BD numbers" switch).
  const members = users.filter((u) => (team === 'BD' ? isBdDirector(u) : u.teams?.some((t) => t.name === team))).sort((a, b) => fullName(a).localeCompare(fullName(b), undefined, { sensitivity: 'base' }));
  const chosen = members.find((u) => u.id === Number(person));
  const isBd = team === 'BD';
  const pickTeam = (name) => { setTeam(name); setPerson(''); setTerritory(''); };

  return (
    <div className="space-y-6">
      {/* One row of filters; everything below follows them. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <label className="label" htmlFor="cd-team">Team</label>
          <select id="cd-team" className="input" value={team} onChange={(e) => pickTeam(e.target.value)}>
            <option value="all">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
        </div>
        {team !== 'all' && (
          <div className="w-56">
            <label className="label" htmlFor="cd-person">Person</label>
            <select id="cd-person" className="input" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">All {team}</option>
              {members.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          </div>
        )}
        {isBd && (
          <div className="w-56">
            <label className="label" htmlFor="cd-territory">Territory</label>
            <select id="cd-territory" className="input" value={territory} onChange={(e) => setTerritory(e.target.value)} title="Narrows the money (pipeline, bookings, revenue, marketing), not the to-do highlights">
              <option value="">All territories</option>
              {territories.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {team === 'all' ? <TeamFinancials team="all" /> : !teamRow ? null : chosen ? (
        <BdDashboard key={`p${chosen.id}${territory}`} director={chosen.id} territory={territory}
          header={(d) => d.isDirector && <PriorityAccounts userId={chosen.id} name={fullName(chosen)} readOnly />}>
          {team === 'Marketing' && <Titled title="Marketing spend"><MarketingSpend entries={false} /></Titled>}
        </BdDashboard>
      ) : (
        <BdDashboard key={`t${teamRow.id}${territory}`} team={teamRow.id} territory={territory}>
          {team === 'Marketing' && <Titled title="Marketing spend"><MarketingSpend entries={false} /></Titled>}
          {!isBd && <Titled title={`${team} figures`}><TeamFinancials team={team} /></Titled>}
        </BdDashboard>
      )}
    </div>
  );
}

function Titled({ title, children }) {
  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
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
          <StatTile label={`Marketing: spent in ${todayIso().slice(0, 4)}`} value={compact(data.marketing.year)} />
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
