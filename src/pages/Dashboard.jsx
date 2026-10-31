import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Package, Check, Square, ChevronRight } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { fullName, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import Avatar from '../components/Avatar.jsx';
import MyDashboard from './MyDashboard.jsx';
import CompanyOverview from './CompanyOverview.jsx';
import Financials from './Financials.jsx';
import ReportCard from '../components/ReportCard.jsx';

const money = (n) => usd(n).replace('.00', '');
const pct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`);
const num = (n) => (n == null ? '—' : n.toFixed(1).replace('.0', ''));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Weekly averages for one person from their per-week tallies. */
function summarize(weeks) {
  const withPriorities = weeks.filter((w) => w.planned > 0);
  const stillOpen = withPriorities.filter((w) => w.completed < w.planned);
  return {
    weeks: weeks.length,
    priorityWeeks: withPriorities.length,
    closeout: mean(withPriorities.map((w) => w.completed / w.planned)),
    plannedPerWeek: mean(withPriorities.map((w) => w.planned)),
    completedPerWeek: mean(withPriorities.map((w) => w.completed)),
    openWeeks: stillOpen.length,
    workWhileOpen: mean(stillOpen.map((w) => w.work)),
  };
}

const TABS = [
  ['me', 'My dashboard', MyDashboard],
  ['overview', 'Company overview', CompanyOverview],
  ['financials', 'Financials', Financials],
  ['team', 'Team', TeamDashboard],
];

/** Dashboards: your own, the company at a glance, financials by team, and team priority close-out. The tab is in the URL. */
export default function Dashboard() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(([k]) => k === params.get('tab')) || TABS[0];
  const Body = tab[2];
  return (
    <div className="space-y-6 p-8">
      <PageHeader title="Dashboard" subtitle={{
        me: 'Your priorities, tasks, trips and numbers.',
        overview: 'The whole company at a glance.',
        financials: 'Pipeline, forecast, bookings, backlog and book-to-bill, by team.',
        team: 'Priority close-out, work added while priorities were open, and checklists.',
      }[tab[0]]}>
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="tablist" aria-label="Dashboards">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab[0] === k} onClick={() => setParams(k === 'me' ? {} : { tab: k })}
              className={`rounded px-3 whitespace-nowrap ${tab[0] === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>
      <Body />
    </div>
  );
}

/** Team priority close-out (the original dashboard). */
function TeamDashboard() {
  const { data } = useApi('/dashboard');
  const teams = useApi('/teams');
  const [teamId, setTeamId] = useState('all');
  const [includeCurrent, setIncludeCurrent] = useState(false);

  const people = useMemo(() => (data?.people || [])
    .filter((p) => teamId === 'all' || (p.team_ids || []).includes(Number(teamId)))
    .map((p) => ({ ...p, stats: summarize(p.weeks.filter((w) => includeCurrent || !w.current)) })), [data, teamId, includeCurrent]);

  const teamCloseout = mean(people.map((p) => p.stats.closeout).filter((x) => x != null));
  const teamWork = mean(people.map((p) => p.stats.workWhileOpen).filter((x) => x != null));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-52">
          <label className="label">Team</label>
          <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="all">All</option>
            {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-600">
          <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={includeCurrent} onChange={(e) => setIncludeCurrent(e.target.checked)} />
          Include this week (still in progress)
        </label>
      </div>

      {/* BD's report card: the team's measures and each director's, shown for BD and for everyone. */}
      {(teamId === 'all' || teams.data?.teams.find((t) => t.id === Number(teamId))?.name === 'BD') && <ReportCard />}

      {data && (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
            <Tile label="Bid tickets" value={data.totals.tickets} sub="All pipeline statuses" />
            <Tile label="Pipeline value" value={money(data.totals.value)} sub="Sum of every bid ticket" />
            <Tile label="Avg priority close-out" value={pct(teamCloseout)} sub="Per person, per week" />
            <Tile label="Avg work while priorities open" value={num(teamWork)} sub="Work tickets per week" />
          </div>

          <Section title="Weekly close-out by person"
            note="Close-out is the share of a week’s planned priorities marked complete. Work (work tickets plus additional work logged while planning was closed) is only counted in weeks where at least one priority stayed incomplete.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                    <Th>Person</Th>
                    <Th right>Weeks</Th>
                    <Th right>Priorities / wk</Th>
                    <Th>Avg close-out</Th>
                    <Th right>Closed / wk</Th>
                    <Th right>Weeks left open</Th>
                    <Th right>Work added / wk when open</Th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar user={p} />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-800">{fullName(p)}</div>
                            <div className="text-xs text-slate-500">{[p.title, p.team_name].filter(Boolean).join(' · ')}</div>
                          </div>
                        </div>
                      </td>
                      <Td right>{p.stats.priorityWeeks}</Td>
                      <Td right>{num(p.stats.plannedPerWeek)}</Td>
                      <td className="py-2.5 pr-3">
                        <Bar value={p.stats.closeout} label={pct(p.stats.closeout)}
                          title={p.stats.closeout == null ? 'No weeks with priorities yet' : `${pct(p.stats.closeout)} of planned priorities closed per week, across ${p.stats.priorityWeeks} week${p.stats.priorityWeeks === 1 ? '' : 's'}`} />
                      </td>
                      <Td right>{num(p.stats.completedPerWeek)}</Td>
                      <Td right>{p.stats.openWeeks}</Td>
                      <Td right>{num(p.stats.workWhileOpen)}</Td>
                    </tr>
                  ))}
                  {!people.length && <tr><td colSpan={7} className="py-8 text-center text-slate-400">No one on this team yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Pipeline" note={`${data.totals.tickets} bid ticket${data.totals.tickets === 1 ? '' : 's'} worth ${money(data.totals.value)} in total.`}>
            <Pipeline rows={data.pipeline} />
          </Section>

          <Section title="Checklist items by master ticket" note="Every task on each person’s priorities and work, grouped by master ticket.">
            <div className="space-y-2">
              {people.map((p) => <PersonChecklists key={p.id} person={p} />)}
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {note && <p className="mt-0.5 mb-4 text-xs text-slate-500">{note}</p>}
      {children}
    </section>
  );
}

const Th = ({ children, right }) => <th className={`pr-3 pb-2 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
const Td = ({ children, right }) => <td className={`py-2.5 pr-3 tabular-nums text-slate-700 ${right ? 'text-right' : ''}`}>{children}</td>;

/** A thin horizontal bar from 0 to 1 with its value beside it. */
function Bar({ value, label, title }) {
  return (
    <div className="flex items-center gap-2" title={title}>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
        {value != null && <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(value * 100, value > 0 ? 3 : 0)}%` }} />}
      </div>
      <span className="w-10 text-xs font-medium text-slate-700 tabular-nums">{label}</span>
    </div>
  );
}

function Pipeline({ rows }) {
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const maxValue = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <Th>Pipeline status</Th>
            <Th>Bid tickets</Th>
            <Th>Total value</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.status ?? 'none'} className={`border-b border-slate-100 last:border-0 ${r.count ? '' : 'text-slate-400'}`}>
              <td className="py-2.5 pr-3 font-medium">{r.status ?? <span className="italic">No status</span>}</td>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2" title={`${r.count} bid ticket${r.count === 1 ? '' : 's'} in ${r.status ?? 'no status'}`}>
                  <div className="h-2 w-28 rounded-full bg-slate-100">
                    {r.count > 0 && <div className="h-full rounded-full bg-brand-600" style={{ width: `${(r.count / maxCount) * 100}%` }} />}
                  </div>
                  <span className="w-8 text-xs font-medium tabular-nums">{r.count}</span>
                </div>
              </td>
              <td className="py-2.5 pr-3">
                <div className="flex items-center gap-2" title={`${money(r.value)} across ${r.status ?? 'no status'}`}>
                  <div className="h-2 w-28 rounded-full bg-slate-100">
                    {r.value > 0 && <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(r.value / maxValue) * 100}%` }} />}
                  </div>
                  <span className="text-xs font-medium tabular-nums">{money(r.value)}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonChecklists({ person }) {
  const items = person.tickets.flatMap((t) => t.cards.flatMap((c) => c.items));
  const done = items.filter((i) => i.done).length;
  return (
    <details className="group rounded-lg border border-slate-200 open:bg-slate-50/50">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5">
        <ChevronRight size={15} className="text-slate-400 transition group-open:rotate-90" />
        <Avatar user={person} />
        <span className="font-medium text-slate-800">{fullName(person)}</span>
        <span className="text-xs text-slate-500">
          {items.length ? `${done}/${items.length} done · ${person.tickets.length} master ticket${person.tickets.length === 1 ? '' : 's'}` : 'No checklist items'}
        </span>
      </summary>
      {person.tickets.length > 0 && (
        <div className="grid gap-3 px-3 pb-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
          {person.tickets.map((t) => (
            <div key={t.ticket_id} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-start gap-1.5">
                <Package size={14} className="mt-0.5 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-800">{t.title}</div>
                  {t.status && <div className="text-[11px] text-slate-500">{t.status}</div>}
                </div>
              </div>
              <div className="space-y-2">
                {t.cards.map((c) => (
                  <div key={c.id}>
                    <div className="text-xs font-medium text-slate-600">
                      {c.title || 'Untitled'} <span className="font-normal text-slate-400">· {c.is_planned ? 'priority' : 'work'} · week of {shortDate(c.week_start)}</span>
                    </div>
                    <ul className="mt-0.5">
                      {[...c.items.filter((i) => !i.done), ...c.items.filter((i) => i.done)].map((i, n) => (
                        <li key={n} className={`flex items-start gap-1.5 text-xs ${i.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          {i.done ? <Check size={13} className="mt-px shrink-0 text-emerald-600" /> : <Square size={13} className="mt-px shrink-0 text-slate-400" />}
                          {i.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
