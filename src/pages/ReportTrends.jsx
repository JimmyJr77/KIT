import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { shortDate } from '../lib/format.js';
import { LineChart, compact } from '../components/Charts.jsx';

// How each format reads on an axis or in a tooltip, and how a change in it reads.
const FORMATS = {
  percent: { show: (v) => `${Math.round(v * 100)}%`, change: (d) => `${d > 0 ? '+' : ''}${Math.round(d * 100)} pts` },
  ratio: { show: (v) => `${v.toFixed(1)}×`, change: (d) => `${d > 0 ? '+' : ''}${d.toFixed(1)}×` },
  money: { show: compact, change: (d) => `${d > 0 ? '+' : d < 0 ? '−' : ''}${compact(Math.abs(d))}` },
  // Counts: whole numbers on the axis (fractional ticks are left blank); a median can be ½, so tooltips keep a decimal.
  count: { show: (v) => String(Math.round(v * 10) / 10), axis: (v) => (Number.isInteger(v) ? String(v) : ''), change: (d) => `${d > 0 ? '+' : ''}${d}` },
};
// The person's own line, then the team's spread among BD directors.
const LINES = [
  { key: 'values', color: '#2a78d6', width: 2.5 },
  { key: 'high', label: 'Team high', color: '#1baf7a', dash: '5 4', width: 1.5 },
  { key: 'median', label: 'Team median', color: '#64748b', dash: '2 3', width: 1.5 },
  { key: 'low', label: 'Team low', color: '#e34948', dash: '5 4', width: 1.5 },
];

/** First and last values on a line, and the change between them. */
function change(values) {
  const known = values.filter((v) => v != null);
  if (known.length < 2) return null;
  const [from, to] = [known[0], known.at(-1)];
  return { from, to, diff: to - from, rel: from ? (to - from) / Math.abs(from) : null };
}

/**
 * Change over time: the report card's measures week by week, each with its growth or shrinkage over the timeline.
 * For one BD director, each chart also shows the team's high, median and low among directors. `embedded` leaves out the
 * report's title block, for use inside the BD report card.
 */
export default function ReportTrends({ weeks, director, who, embedded }) {
  const qs = new URLSearchParams({ weeks: String(weeks) });
  if (director) qs.set('director', director);
  const { data } = useApi(`/financials/report-trends?${qs}`);
  if (!data) return <p className="text-sm text-slate-400">Loading…</p>;
  const labels = data.weeks.map((d) => shortDate(d));
  const about = (
    <>
      Each week shows the trailing 13 weeks ending that week. Pipeline coverage is the qualified pipeline that week against
      that quarter’s target; forecast reliability is the latest finished quarter.
      {director ? ' Dashed lines are the BD team’s high, median and low among directors.' : ''}
    </>
  );
  return (
    <article className={embedded ? 'space-y-3' : 'mx-auto max-w-6xl space-y-4 print:max-w-none'}>
      {embedded ? <p className="text-xs text-slate-500">{about}</p> : (
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <div className="text-xs font-semibold tracking-wide text-brand-700 uppercase">KIT · Change over time</div>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{who} · last {weeks} weeks</h1>
          <p className="mt-1 text-sm text-slate-500">{about}</p>
        </header>
      )}
      <div className="grid gap-4 lg:grid-cols-2 print:grid-cols-2">
        {data.measures.map((m) => <Trend key={m.key} m={m} labels={labels} weeks={weeks} individual={!!director} who={who} />)}
      </div>
    </article>
  );
}

function Trend({ m, labels, weeks, individual, who }) {
  const f = FORMATS[m.format] || FORMATS.count;
  const c = change(m.values);
  const empty = !m.values.some((v) => v != null) && !(individual && m.median?.some((v) => v != null));
  const Icon = !c || c.diff === 0 ? Minus : c.diff > 0 ? TrendingUp : TrendingDown;
  const series = (individual ? LINES : LINES.slice(0, 1)).map((l) => ({ ...l, label: l.label || who, values: m[l.key] }));
  return (
    <section className="break-inside-avoid rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-800">{m.title}</h2>
          <p className="text-[11px] text-slate-500 italic">{m.question}</p>
        </div>
        {c && (
          <div className={`shrink-0 text-right ${c.diff > 0 ? 'text-emerald-700' : c.diff < 0 ? 'text-red-700' : 'text-slate-500'}`}>
            <div className="flex items-center justify-end gap-1 text-sm font-semibold tabular-nums">
              <Icon size={15} /> {f.change(c.diff)}{c.rel != null && m.format !== 'percent' && <span className="text-xs font-medium">({c.rel > 0 ? '+' : ''}{Math.round(c.rel * 100)}%)</span>}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums">{f.show(c.from)} → {f.show(c.to)} over {weeks} weeks</div>
          </div>
        )}
      </div>
      {empty ? (
        <p className="mt-6 mb-4 text-center text-sm text-slate-400">Not enough data for this measure yet.</p>
      ) : (
        <div className="mt-2">
          <LineChart points={labels} labels={labels} series={series} format={f.axis || f.show} tipFormat={(v) => f.show(v)} height={180} />
        </div>
      )}
    </section>
  );
}
