import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Printer, Presentation, Loader2 } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { fullName, todayIso, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { BarList, StackedColumns, DataTable, SERIES, compact, fullMoney, pct } from '../components/Charts.jsx';
import { periods, formatValue, StatusChip } from '../components/ReportCard.jsx';

const ratio = (r) => (r == null ? '—' : `${r.toFixed(2)}×`);
const shortQuarter = (q) => `Q${q.slice(-1)} '${q.slice(2, 4)}`;

/**
 * The BD report: the report card for a period, and the pipeline, forecast, bookings, backlog and book-to-bill behind it,
 * for the team or one BD director. Prints cleanly (Print / Save as PDF) and downloads as an editable PowerPoint deck.
 */
export default function Reports() {
  const users = useApi('/users').data?.users || [];
  const directors = users.filter((u) => u.teams?.some((t) => t.name === 'BD'));
  const options = periods();
  const [choice, setChoice] = useState('q');
  const [director, setDirector] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const p = options.find((o) => o.key === choice);

  const bdQs = director ? `?director=${director}` : '';
  const cardQs = new URLSearchParams({ kind: p.kind, label: p.value });
  if (director) cardQs.set('director', director);
  const bd = useApi(`/financials/bd${bdQs}`).data;
  const rc = useApi(`/financials/report-card?${cardQs}`).data;
  const who = director ? fullName(users.find((u) => u.id === Number(director))) : 'BD team';
  const ready = bd && rc;
  const report = ready && { bd, card: rc.card, directors: rc.directors, scope: who, period: p.value, prepared: todayIso() };

  const downloadDeck = async () => {
    setBuilding(true);
    setError('');
    try {
      // Loaded only when needed: the PowerPoint library is large.
      const [{ default: PptxGenJS }, { buildDeck }] = await Promise.all([import('pptxgenjs'), import('../lib/bdDeck.js')]);
      const deck = buildDeck(new PptxGenJS(), report);
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
          <button type="button" className="btn" onClick={() => window.print()} disabled={!ready}><Printer size={15} /> Print / Save as PDF</button>
          <button type="button" className="btn-primary" onClick={downloadDeck} disabled={!ready || building}>
            {building ? <Loader2 size={15} className="animate-spin" /> : <Presentation size={15} />} Download PowerPoint
          </button>
        </PageHeader>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-60">
            <label className="label">Period</label>
            <select className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div className="w-56">
            <label className="label">For</label>
            <select className="input" value={director} onChange={(e) => setDirector(e.target.value)}>
              <option value="">The whole BD team</option>
              {directors.map((u) => <option key={u.id} value={u.id}>{fullName(u)}</option>)}
            </select>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>

      {!ready ? <p className="text-sm text-slate-400">Loading…</p> : <Report r={report} />}
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
        <div className="text-xs font-semibold tracking-wide text-brand-700 uppercase">KIT · BD report</div>
        <h1 className="mt-1 text-2xl font-bold text-slate-900">{r.scope} · {r.period}</h1>
        <p className="text-sm text-slate-500">Prepared {shortDate(r.prepared, { month: 'long', day: 'numeric', year: 'numeric' })}. Pipeline figures are as of today; the report card covers {r.period}.</p>
      </header>

      <Section title="At a glance">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4">
          <Figure label={`Booked, ${r.period}`} value={compact(m.bookings.amount)} note={m.bookings.target ? `${pct(m.bookings.value)} of ${compact(m.bookings.target)} target` : 'No target set'} />
          <Figure label="Qualified pipeline" value={compact(bd.qualified.value)} note={`${bd.qualified.count} bids`} />
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

      <div className="grid gap-6 lg:grid-cols-2 print:grid-cols-2">
        <Section title="Pipeline by stage">
          <BarList rows={bd.stages.map((s) => ({ key: s.stage, label: s.stage, value: s.value, sub: `${s.count}` }))} />
        </Section>
        <Section title="Expected revenue by quarter">
          <StackedColumns categories={q.map((x) => x.quarter)} height={130}
            series={[{ key: 'adj', label: 'PWIN-adjusted', color: SERIES[0], values: q.map((x) => x.adjusted.weighted) }, { key: 'raw', label: 'No PWIN (full value)', color: SERIES[1], values: q.map((x) => x.unadjusted.value) }]} />
          <p className="mt-2 text-xs text-slate-500">
            Not in a quarter: undetermined {compact(bd.expected.undetermined.value)} ({bd.expected.undetermined.count}) · later {compact(bd.expected.later.value)} · overdue {compact(bd.expected.overdue.value)} · no date {compact(bd.expected.unscheduled.value)}
          </p>
        </Section>
        <Section title="Qualified pipeline by territory">
          <BarList rows={bd.qualifiedByTerritory.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified bids." />
        </Section>
        <Section title="Qualified pipeline by BD director">
          <BarList rows={bd.qualifiedByDirector.map((t) => ({ key: t.name, label: t.name, value: t.value, sub: `${t.count}` }))} empty="No qualified bids." />
        </Section>
        <Section title="Bookings by quarter, funded and unfunded">
          <StackedColumns categories={bd.bookings.byQuarter.map((x) => shortQuarter(x.quarter))} height={130}
            series={[{ key: 'funded', label: 'Funded', color: SERIES[0], values: bd.bookings.byQuarter.map((x) => x.funded) }, { key: 'unfunded', label: 'Unfunded', color: SERIES[1], values: bd.bookings.byQuarter.map((x) => x.unfunded) }]} />
        </Section>
        <Section title="Backlog and book-to-bill">
          <DataTable columns={[{ key: 'k', label: '' }, { key: 'v', label: '', align: 'right' }]} rows={[
            { k: 'Active contracts', v: bd.backlog.contracts },
            { k: 'Funded backlog', v: fullMoney(bd.backlog.fundedBacklog) },
            { k: 'Unfunded backlog', v: fullMoney(bd.backlog.unfundedBacklog) },
            { k: 'Billed to date', v: fullMoney(bd.backlog.billed) },
            { k: 'Book-to-bill, year to date', v: ratio(bd.bookToBill.ytd.ratio) },
            { k: 'Book-to-bill, last 12 months', v: ratio(bd.bookToBill.ttm.ratio) },
          ]} />
        </Section>
      </div>

      {stalled.length > 0 && (
        <Section title={`Stalled pursuits (${stalled.length})`}>
          <DataTable columns={[{ key: 'title', label: 'Bid' }, { key: 'stage', label: 'Stage' }, { key: 'director', label: 'BD director' },
            { key: 'value', label: 'Value', align: 'right', format: compact }, { key: 'days', label: 'Days since stage change', align: 'right' }]}
            rows={stalled.map((x) => ({ ...x, title: <Link to={`/tickets?open=${x.id}`} className="hover:underline">{x.title}</Link>, director: x.director || '—' }))} />
        </Section>
      )}
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
