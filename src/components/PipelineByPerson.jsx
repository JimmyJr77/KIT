import { shortDate } from '../lib/format.js';
import { ViewCard, LineChart, BarList, compact, fullMoney } from './Charts.jsx';

// "+$1.2M" / "−$300K" / "—" for no change; colored by direction.
function Delta({ n }) {
  if (!n) return <span className="text-slate-400">—</span>;
  return <span className={n > 0 ? 'text-emerald-700' : 'text-red-700'}>{n > 0 ? '+' : '−'}{compact(Math.abs(n))}</span>;
}

/**
 * Qualified pipeline week to week for each person ({ points, people: [{ id, name, values }] }): where each stands now,
 * the change since last week and over the whole span, and each person's line.
 */
export default function PipelineByPerson({ data, className = '' }) {
  if (!data?.people.length) return null;
  const { points, people } = data;
  const last = points.length - 1;
  const span = `${last} week${last === 1 ? '' : 's'}`;
  const rows = people.map((p) => ({
    key: p.id, name: p.name, now: p.values[last],
    week: last > 0 ? p.values[last] - p.values[last - 1] : 0, span: p.values[last] - p.values[0],
  }));
  const total = (k) => rows.reduce((t, r) => t + r[k], 0);
  const one = people.length === 1;
  return (
    <ViewCard className={className} initial={one ? 'timeline' : 'table'}
      title={one ? 'Qualified pipeline, week to week' : 'Qualified pipeline by person, week to week'}
      subtitle={`Qualified onward, as it stood at the end of each week over the last ${span}`}
      table={{
        columns: [{ key: 'name', label: 'Person' }, { key: 'now', label: 'This week', align: 'right', format: fullMoney },
          { key: 'week', label: 'vs last week', align: 'right', format: (n) => <Delta n={n} /> },
          { key: 'span', label: `vs ${span} ago`, align: 'right', format: (n) => <Delta n={n} /> }],
        rows,
        foot: one ? undefined : { name: 'Total', now: total('now'), week: total('week'), span: total('span') },
      }}
      bar={<BarList rows={rows.map((r) => ({ key: r.key, label: r.name, value: r.now }))} empty="No qualified pipeline." />}
      timeline={<LineChart points={points} labels={points.map((d) => shortDate(d))} height={200}
        series={people.map((p) => ({ key: String(p.id), label: p.name, values: p.values }))} />} />
  );
}
