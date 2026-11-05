import { shortDate } from '../lib/format.js';
import { ViewCard, LineChart, BarList, compact, fullMoney } from './Charts.jsx';

// "+$1.2M" / "−$300K" / "—" for no change; colored by direction.
function Delta({ n }) {
  if (!n) return <span className="text-slate-400">—</span>;
  return <span className={n > 0 ? 'text-emerald-700' : 'text-red-700'}>{n > 0 ? '+' : '−'}{compact(Math.abs(n))}</span>;
}

const WEEKS_SHOWN = 4;

/**
 * Qualified pipeline week to week for each person ({ points, people: [{ id, name, values }] }). The table reads across:
 * where each stood four weeks ago, each week's change, and where they stand now, then the change over 8 and 12 weeks.
 */
export default function PipelineByPerson({ data, className = '' }) {
  if (!data?.people.length) return null;
  const { points, people } = data;
  const last = points.length - 1;
  const back = (k) => Math.max(0, last - k); // the point k weeks before now, or the earliest there is
  const start = back(WEEKS_SHOWN);
  const steps = Array.from({ length: last - start }, (_, i) => start + i + 1); // the points each weekly change ends at
  const rows = people.map((p) => ({
    key: p.id, name: p.name, start: p.values[start], now: p.values[last],
    ...Object.fromEntries(steps.map((i) => [`w${i}`, p.values[i] - p.values[i - 1]])),
    eight: p.values[last] - p.values[back(8)], twelve: p.values[last] - p.values[back(12)],
  }));
  const total = (k) => rows.reduce((t, r) => t + r[k], 0);
  const one = people.length === 1;
  const delta = (n) => <Delta n={n} />;
  const changes = ['start', ...steps.map((i) => `w${i}`), 'now', 'eight', 'twelve'];
  return (
    <ViewCard className={className} initial={one ? 'timeline' : 'table'}
      title={one ? 'Qualified pipeline, week to week' : 'Qualified pipeline by person, week to week'}
      subtitle="Qualified onward, as it stood at the end of each week. Reads across: the start, each week's change, then this week. 8 and 12 weeks are the change over that span."
      table={{
        columns: [{ key: 'name', label: 'Person' }, { key: 'start', label: `Start ${shortDate(points[start])}`, align: 'right', format: compact },
          ...steps.map((i) => ({ key: `w${i}`, label: shortDate(points[i]), align: 'right', format: delta })),
          { key: 'now', label: 'This week', align: 'right', format: (n) => <span className="font-semibold">{compact(n)}</span> },
          { key: 'eight', label: '8 weeks', align: 'right', format: delta }, { key: 'twelve', label: '12 weeks', align: 'right', format: delta }],
        rows,
        foot: one ? undefined : { name: 'Total', ...Object.fromEntries(changes.map((k) => [k, total(k)])) },
      }}
      bar={<BarList rows={rows.map((r) => ({ key: r.key, label: r.name, value: r.now }))} empty="No qualified pipeline." />}
      timeline={<LineChart points={points} labels={points.map((d) => shortDate(d))} height={200}
        series={people.map((p) => ({ key: String(p.id), label: p.name, values: p.values }))} />} />
  );
}
