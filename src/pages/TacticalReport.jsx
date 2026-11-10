import { Link } from 'react-router-dom';
import { shortDate } from '../lib/format.js';
import { LineChart, StackedColumns, SERIES, compact } from '../components/Charts.jsx';
import { nameOnLight } from '../lib/brand.js';
import { tacticalSections, personColumns, totalRow, signed, weekLabel, toneOf, STAGE_COLORS } from '../lib/tactical.js';

const toneClass = (n) => (toneOf(n) > 0 ? 'text-emerald-700' : toneOf(n) < 0 ? 'text-red-700' : '');

/**
 * The Tactical Meeting Report on screen, in the deck's order (it prints the same way): the overview (the week's numbers
 * and the qualified pipeline by stage, week by week), the same numbers by person with the qualified pipeline by person, and
 * the cheat sheet of tickets behind them.
 */
export default function TacticalReport({ r }) {
  const team = !r.scope.director;
  const { tiles, sections } = tacticalSections(r, team);
  const q = r.qualified;
  const weeks = r.stages.points.map((d) => shortDate(d));
  const stageSeries = r.stages.series.map((s) => ({ ...s, color: STAGE_COLORS[s.key] }));
  const lines = team ? q.people.map((p, i) => ({ key: String(p.id), label: p.name, values: p.values, color: SERIES[i % SERIES.length] }))
    : [{ key: 'me', label: r.scope.label, values: q.total.values, color: SERIES[0] }];
  const cols = personColumns();
  const rows = team ? r.byPerson : r.byPerson.filter((p) => p.id === r.scope.director);
  return (
    <article className="mx-auto max-w-6xl space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between gap-4">
          <img src={nameOnLight} alt="Knexus" className="h-6 w-auto" />
          <div className="text-xs font-semibold tracking-wide text-brand-700 uppercase">KIT · Tactical Meeting Report</div>
        </div>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">Tactical Meeting Report</h1>
        <p className="text-sm text-slate-500">{r.scope.label} · week of {weekLabel(r.week)}</p>
      </header>

      {/* 1. Overview */}
      <section className="space-y-4 break-inside-avoid">
        <h2 className="text-base font-semibold text-slate-900">{team ? 'Team overview' : 'Overview'}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
          {tiles.map((t) => (
            <div key={t.key} className="rounded-lg border border-slate-200 p-3">
              <div className="text-[11px] font-medium text-slate-500">{t.label}</div>
              <div className="text-xl font-bold text-slate-900 tabular-nums">{t.value}</div>
              <div className={`text-[11px] text-slate-500 ${toneClass(t.tone)}`}>{t.note}</div>
            </div>
          ))}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Pipeline value by stage, week by week</h3>
          <p className="mb-2 text-[11px] text-slate-500">
            Qualified onward, as it stood at the end of each week · {compact(r.stages.now)} now, <span className={toneClass(r.stages.change)}>{signed(r.stages.change)}</span> this week
          </p>
          <StackedColumns categories={weeks} series={stageSeries} height={220} />
        </div>
      </section>

      {/* 2. By person */}
      <section className="space-y-4 border-t border-slate-200 pt-4 break-inside-avoid print:break-before-page print:border-0">
        <h2 className="text-base font-semibold text-slate-900">By person</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] text-slate-500">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Person</th>
                {cols.map((c) => <th key={c.key} className="py-1.5 pr-3 text-right font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id ?? 'none'} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 text-slate-800">{p.name}</td>
                  {cols.map((c) => <td key={c.key} className={`py-1.5 pr-3 text-right whitespace-nowrap tabular-nums ${c.tone ? toneClass(c.tone(p)) || 'text-slate-400' : ''}`}>{c.value(p)}</td>)}
                </tr>
              ))}
              {team && (
                <tr className="border-t border-slate-300 font-semibold">
                  <td className="py-1.5 pr-3">Total</td>
                  {cols.map((c) => <td key={c.key} className={`py-1.5 pr-3 text-right whitespace-nowrap tabular-nums ${c.tone ? toneClass(c.tone(totalRow(r))) : ''}`}>{c.value(totalRow(r))}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Qualified pipeline by week{team ? ', by person' : ''}</h3>
          <p className="mb-2 text-[11px] text-slate-500">Qualified onward, as it stood at the end of each week.</p>
          {q.points.length ? (
            <>
              <LineChart points={q.points} labels={q.points.map((d) => shortDate(d))} series={lines} height={240} />
            </>
          ) : <p className="text-sm text-slate-400">No qualified pipeline yet.</p>}
        </div>
      </section>

      {/* 3. Cheat sheet */}
      <section className="border-t border-slate-200 pt-4 print:break-before-page print:border-0">
        <h2 className="text-base font-semibold text-slate-900">Cheat sheet</h2>
        <p className="mb-2 text-[11px] text-slate-500">The tickets behind each number this week.</p>
        <div className="gap-6 md:columns-2 print:columns-2">
          {sections.map((s) => (
            <div key={s.key} className="mb-3 break-inside-avoid-column">
              <h3 className="text-xs font-semibold text-brand-700">{s.title} <span className="font-normal text-slate-400">({s.items.length})</span></h3>
              {s.items.length ? (
                <ul className="mt-0.5 space-y-0.5">
                  {s.items.map((x) => (
                    <li key={x.key} className="text-xs leading-snug">
                      <Link to={`/tickets?open=${x.id}`} className="font-medium text-slate-800 hover:text-brand-700 hover:underline">{x.title}</Link>
                      {x.detail && <span className="text-slate-500"> · {x.detail}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-slate-400">None.</p>}
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
