import { useState } from 'react';
import { Printer, Presentation, Loader2 } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, todayIso, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { BarList, StackedColumns, DataTable, SERIES, compact, pct } from '../components/Charts.jsx';
import { periods, periodQuery, isYearChoice, formatValue, StatusChip, StalledByStage } from '../components/ReportCard.jsx';
import YearBasisToggle from '../components/YearBasisToggle.jsx';
import { useYearBasis } from '../lib/yearBasis.js';
import ReportTrends from './ReportTrends.jsx';
import TacticalReport from './TacticalReport.jsx';
import PipelineByPerson from '../components/PipelineByPerson.jsx';
import { BookToBill } from '../components/BdDashboard.jsx';
import { nameOnLight, nameOnDark } from '../lib/brand.js';
import { isBdDirector } from '../lib/bd.js';

const shortQuarter = (q) => `Q${q.slice(-1)} '${q.slice(2, 4)}`;
/** The Monday of this week and the twelve before it, newest first. */
function recentWeeks() {
  const d = new Date(`${todayIso()}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 13 }, (_, i) => {
    const m = new Date(d);
    m.setDate(d.getDate() - 7 * i);
    return m.toLocaleDateString('en-CA');
  });
}

/**
 * The BD report: the report card for a period, and the pipeline, forecast, bookings, backlog and book-to-bill behind it,
 * for the team or one BD director. Prints cleanly (Print / Save as PDF) and downloads as an editable PowerPoint deck.
 * Change over time shows the same measures week by week instead. The Tactical Meeting Report is one week's pipeline
 * movement, with a cheat sheet of the tickets behind it, and downloads as a single slide.
 */
export default function Reports() {
  const users = useApi('/users').data?.users || [];
  const directors = users.filter(isBdDirector);
  const [basis] = useYearBasis();
  const options = periods(basis);
  const [view, setView] = useState('report'); // report | trends | tactical
  const weekOptions = recentWeeks();
  const [week, setWeek] = useState(weekOptions[0]);
  const [weeks, setWeeks] = useState(13);
  const [choice, setChoice] = useState('q');
  // With Focus on the report is your own (the server gives nothing else), so there's no one to pick.
  const { user } = useAuth();
  const [picked, setDirector] = useState('');
  const director = user.focus ? String(user.id) : picked;
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const p = options.find((o) => o.key === choice);

  const bdQs = director ? `?director=${director}` : '';
  const cardQs = periodQuery(p);
  if (director) cardQs.set('director', director);
  const bd = useApi(`/financials/bd${bdQs}`).data;
  const rc = useApi(`/financials/report-card?${cardQs}`).data;
  const who = director ? fullName(users.find((u) => u.id === Number(director))) : 'BD team';
  const ready = bd && rc;
  const report = ready && { bd, card: rc.card, directors: rc.directors, scope: who, period: p.value, prepared: todayIso() };
  const tacticalQs = new URLSearchParams({ week, weeks: String(weeks) });
  if (director) tacticalQs.set('director', director);
  const tactical = useApi(view === 'tactical' ? `/financials/tactical?${tacticalQs}` : null).data;
  const tacticalReady = view === 'tactical' && tactical && tactical.week.start === week;

  const downloadDeck = async () => {
    setBuilding(true);
    setError('');
    try {
      // Loaded only when needed: the PowerPoint library is large.
      if (view === 'tactical') {
        const [{ default: PptxGenJS }, { buildTacticalDeck }] = await Promise.all([import('pptxgenjs'), import('../lib/tacticalDeck.js')]);
        const deck = buildTacticalDeck(new PptxGenJS(), tactical, { nameOnLight });
        await deck.writeFile({ fileName: `Tactical Meeting Report ${who} ${tactical.week.start}.pptx` });
        return;
      }
      const [{ default: PptxGenJS }, { buildDeck }] = await Promise.all([import('pptxgenjs'), import('../lib/bdDeck.js')]);
      const deck = buildDeck(new PptxGenJS(), report, { nameOnLight, nameOnDark });
      await deck.writeFile({ fileName: `BD report ${who} ${p.value}.pptx` });
    } catch (e) {
      setError(`Couldn't build the PowerPoint: ${e.message}`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="space-y-6 p-8 print:space-y-4 print:p-0">
      <div className="print:hidden">
        <PageHeader title="Reports" subtitle="The BD report: report card, pipeline, forecast, bookings and backlog. Print it or take it to PowerPoint.">
          <button type="button" className="btn" onClick={() => window.print()} disabled={view === 'tactical' ? !tacticalReady : !ready}><Printer size={15} /> Print / Save as PDF</button>
          <button type="button" className="btn-primary" onClick={downloadDeck} disabled={(view === 'tactical' ? !tacticalReady : !ready) || building || view === 'trends'}
            title={view === 'trends' ? 'The PowerPoint covers the BD report and the Tactical Meeting Report' : view === 'tactical' ? 'Slide 1: the numbers and the chart. Slide 2: the cheat sheet' : undefined}>
            {building ? <Loader2 size={15} className="animate-spin" /> : <Presentation size={15} />} Download PowerPoint
          </button>
        </PageHeader>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Report</label>
            <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="radiogroup" aria-label="Report">
              {[['report', 'BD report'], ['trends', 'Change over time'], ['tactical', 'Tactical Meeting Report']].map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
                  className={`rounded px-3 ${view === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
              ))}
            </div>
          </div>
          {view === 'report' ? (
            <>
              <div className="w-72">
                <label className="label">Period</label>
                <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
                  {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
              </div>
              {isYearChoice(choice) && (
                <div>
                  <label className="label">Year</label>
                  <YearBasisToggle className="h-[38px] items-center text-sm" />
                </div>
              )}
            </>
          ) : (
            <>
            {view === 'tactical' && (
              <div className="w-60">
                <label className="label">Week</label>
                <select className="input" value={week} onChange={(e) => setWeek(e.target.value)}>
                  {weekOptions.map((w, i) => {
                    const end = new Date(`${w}T12:00:00`);
                    end.setDate(end.getDate() + 6);
                    return <option key={w} value={w}>{i === 0 ? 'This week · ' : i === 1 ? 'Last week · ' : ''}{shortDate(w)} – {shortDate(end.toLocaleDateString('en-CA'))}</option>;
                  })}
                </select>
              </div>
            )}
            <div className="w-48">
              <label className="label">{view === 'tactical' ? 'Chart' : 'Timeline'}</label>
              <select className="input" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {[13, 26, 52].map((n) => <option key={n} value={n}>Last {n} weeks</option>)}
              </select>
            </div>
            </>
          )}
          <div className="w-56">
            <label className="label">For</label>
            {user.focus ? (
              <select className="input" value={director} disabled title="Focus is on, so this is your own report. Turn it off in Settings to see the team or someone else.">
                <option value={director}>{fullName(user)}</option>
              </select>
            ) : (
              <select className="input" value={director} onChange={(e) => setDirector(e.target.value)}>
                <option value="">The whole BD team</option>
                {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
              </select>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {view === 'tactical' ? (tacticalReady ? <TacticalReport r={tactical} /> : <p className="text-sm text-slate-400">Loading…</p>)
        : view === 'trends' ? <ReportTrends weeks={weeks} director={director} who={who} />
        : !ready ? <p className="text-sm text-slate-400">Loading…</p> : <Report r={report} />}
    </div>
  );
}

/** The report itself: screen and print share it. */
function Report({ r }) {
  const { bd, card } = r;
  const q = bd.expected.quarters;
  const m = Object.fromEntries(card.measures.map((x) => [x.key, x]));
  const stalled = m.progression.stalled;
  return (
    <article className="mx-auto max-w-5xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="border-b border-slate-200 pb-4">
        <div className="flex items-center justify-between gap-4">
          <img src={nameOnLight} alt="Knexus" className="h-6 w-auto" />
          <div className="text-xs font-semibold tracking-wide text-brand-700 uppercase">KIT · BD report</div>
        </div>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">{r.scope} · {r.period}</h1>
        <p className="text-sm text-slate-500">Prepared {shortDate(r.prepared, { month: 'long', day: 'numeric', year: 'numeric' })}. Pipeline figures are as of today; the report card covers {r.period}.</p>
      </header>

      <Section title="At a glance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
          <Figure label={`Booked, ${r.period}`} value={compact(m.bookings.amount)} note={m.bookings.target ? `${pct(m.bookings.value)} of ${compact(m.bookings.target)} target` : 'No target set'} />
          <Figure label="Qualified pipeline" value={compact(bd.qualified.value)}
            note={bd.qualified.target?.amount ? `${bd.qualified.count} PL tickets · ${pct(bd.qualified.value / bd.qualified.target.amount)} of ${compact(bd.qualified.target.amount)} ${bd.qualified.target.quarter} target` : `${bd.qualified.count} PL tickets`} />
          <Figure label="Expected, next 4 quarters" value={compact(q.reduce((s, x) => s + x.weighted, 0))} note={`PWIN-weighted · ${compact(bd.expected.undetermined.value)} undetermined`} />
          <Figure label="Backlog" value={compact(bd.backlog.total)} note={`${compact(bd.backlog.fundedBacklog)} funded · ${compact(bd.backlog.unfundedBacklog)} unfunded`} />
        </div>
      </Section>

      <Section title={`Report card · ${r.period}`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500 uppercase"><tr><th className="py-1.5 pr-3">Measure</th><th className="py-1.5 pr-3 text-right">Result</th><th className="py-1.5 pr-3">Status</th><th className="py-1.5">Detail</th></tr></thead>
          <tbody>
            {card.measures.map((x) => (
              <tr key={x.key} className="border-t border-slate-100 align-top">
                <td className="py-2 pr-3"><div className="font-medium text-slate-800">{x.title}</div><div className="text-[11px] text-slate-500 italic">{x.question}</div></td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">{formatValue(x)}</td>
                <td className="py-2 pr-3"><StatusChip status={x.status} /></td>
                <td className="py-2 text-xs text-slate-600">{x.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {r.directors && (
        <Section title="Report card by BD director">
          <DataTable columns={[{ key: 'name', label: 'BD director' }, ...card.measures.map((x) => ({ key: x.key, label: x.title, align: 'right' }))]}
            rows={r.directors.map(({ director: d, card: c }) => ({
              name: fullName(d),
              ...Object.fromEntries(c.measures.map((x) => [x.key, <span key={x.key} className="inline-flex items-center gap-1">{formatValue(x)} <StatusChip status={x.status} compactLabel /></span>])),
            }))} />
        </Section>
      )}

      <Section title="Pipeline by stage">
        <BarList rows={bd.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.value, sub: `${s.count}` }))} />
      </Section>

      {/* Each pair is its own block, so a row of two moves to the next sheet together. */}
      <div className="grid gap-6 break-inside-avoid lg:grid-cols-2 print:grid-cols-2">
        <Section title="Qualified pipeline by territory">
          <BarList rows={bd.qualifiedByTerritory.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified pipeline tickets." />
        </Section>
        <Section title="Qualified pipeline by BD director">
          <BarList rows={bd.qualifiedByDirector.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified pipeline tickets." />
        </Section>
      </div>

      <div className="grid gap-6 break-inside-avoid lg:grid-cols-2 print:grid-cols-2">
        <Section title="Projected bookings by quarter">
          <StackedColumns categories={q.map((x) => x.quarter)} height={130}
            series={[{ key: 'adj', label: 'PWIN-adjusted', color: SERIES[0], values: q.map((x) => x.adjusted.weighted) }, { key: 'raw', label: 'No PWIN (full value)', color: SERIES[1], values: q.map((x) => x.unadjusted.value) }]} />
          <p className="mt-2 text-xs text-slate-500">
            Not in a quarter: undetermined {compact(bd.expected.undetermined.value)} ({bd.expected.undetermined.count}) · later {compact(bd.expected.later.value)} · overdue {compact(bd.expected.overdue.value)} · no date {compact(bd.expected.unscheduled.value)}
          </p>
        </Section>
        <Section title="Bookings by quarter, funded and unfunded">
          <StackedColumns categories={bd.bookings.byQuarter.map((x) => shortQuarter(x.quarter))} height={130}
            series={[{ key: 'funded', label: 'Funded', color: SERIES[0], values: bd.bookings.byQuarter.map((x) => x.funded) }, { key: 'unfunded', label: 'Unfunded', color: SERIES[1], values: bd.bookings.byQuarter.map((x) => x.unfunded) }]} />
        </Section>
      </div>

      <PipelineByPerson data={bd.qualifiedByPerson} className="break-inside-avoid" />
      <div className="break-inside-avoid"><BookToBill b2b={bd.bookToBill} /></div>

      {stalled.length > 0 && <div className="break-inside-avoid"><StalledByStage measure={m.progression} showDirector /></div>}
    </article>
  );
}

function Section({ title, children }) {
  return (
    <section className="break-inside-avoid">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, note }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className="text-xl font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[11px] text-slate-500">{note}</div>
    </div>
  );
}
