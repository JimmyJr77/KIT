import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, TriangleAlert, CircleX, CircleMinus, ClipboardCheck } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { fullName, todayIso } from '../lib/format.js';
import { compact } from './Charts.jsx';

// Status is never color alone: each carries an icon and a word.
export const STATUS = {
  good: { label: 'On track', icon: CircleCheck, chip: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  watch: { label: 'Watch', icon: TriangleAlert, chip: 'bg-amber-50 text-amber-900 ring-amber-200' },
  behind: { label: 'Behind', icon: CircleX, chip: 'bg-red-50 text-red-800 ring-red-200' },
  none: { label: 'Not enough data', icon: CircleMinus, chip: 'bg-slate-50 text-slate-500 ring-slate-200' },
};

export function formatValue(m) {
  if (m.display) return m.display; // e.g. "Met" when there's nothing left to cover
  if (m.value == null) return '—';
  if (m.format === 'percent') return `${Math.round(m.value * 100)}%`;
  if (m.format === 'money') return compact(m.value);
  if (m.format === 'ratio') return `${m.value.toFixed(1)}×`;
  return String(m.value);
}

/** The periods a report card can cover. */
export function periods() {
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const q = Math.ceil(Number(today.slice(5, 7)) / 3);
  const last = q === 1 ? `${y - 1} Q4` : `${y} Q${q - 1}`;
  return [
    { key: 'q', label: `This quarter (${y} Q${q})`, kind: 'quarter', value: `${y} Q${q}` },
    { key: 'lq', label: `Last quarter (${last})`, kind: 'quarter', value: last },
    { key: 'y', label: `This year (${y})`, kind: 'year', value: String(y) },
    { key: 'ly', label: `Last year (${y - 1})`, kind: 'year', value: String(y - 1) },
  ];
}

export function StatusChip({ status, compactLabel }) {
  const s = STATUS[status] || STATUS.none;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${s.chip}`} title={s.label}>
      <s.icon size={12} /> {!compactLabel && s.label}
    </span>
  );
}

/**
 * The BD report card. With `director`, that director's card; without, the team's card and a row per director.
 * `title` overrides the heading.
 */
export default function ReportCard({ director, title }) {
  const options = periods();
  const [choice, setChoice] = useState('q');
  const p = options.find((o) => o.key === choice);
  const qs = new URLSearchParams({ kind: p.kind, label: p.value });
  if (director) qs.set('director', director);
  const { data } = useApi(`/financials/report-card?${qs}`);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ClipboardCheck size={16} className="text-brand-600" /> {title || (director ? 'Your BD report card' : 'BD report card')}
        </h2>
        <select className="input h-8 w-56 py-0 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Report card period">
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className={`space-y-4 ${data ? '' : 'opacity-50'}`}>
          <Measures card={data.card} />
          <Stalled list={data.card.measures.find((m) => m.key === 'progression').stalled} showDirector={!director} />
          {data.directors && <DirectorTable rows={data.directors} />}
        </div>
      )}
    </section>
  );
}

function Measures({ card }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(14rem,1fr))]">
      {card.measures.map((m) => (
        <div key={m.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-800">{m.title}</div>
              <div className="text-[11px] text-slate-500 italic">{m.question}</div>
            </div>
            <StatusChip status={m.status} />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {formatValue(m)}
            {m.key === 'winRate' && m.valueRate != null && <span className="ml-2 text-sm font-medium text-slate-500">{Math.round(m.valueRate * 100)}% by value</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{m.detail}</p>
        </div>
      ))}
    </div>
  );
}

function Stalled({ list, showDirector }) {
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900"><TriangleAlert size={14} /> Stalled pursuits ({list.length})</h3>
      <ul className="divide-y divide-amber-100 text-sm">
        {list.map((x) => (
          <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5">
            <Link to={`/tickets?open=${x.id}`} className="font-medium text-slate-800 hover:underline">{x.title}</Link>
            <span className="text-xs text-slate-600">
              {[x.stage, compact(x.value), showDirector && x.director, `${x.days} days without a stage change`, x.overdue && 'past its projected win date'].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Each director's seven measures side by side. */
function DirectorTable({ rows }) {
  const titles = rows[0]?.card.measures.map((m) => [m.key, m.title]) || [];
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-slate-50 text-left text-[11px] text-slate-500 uppercase">
          <tr><th className="px-3 py-2">BD director</th>{titles.map(([k, t]) => <th key={k} className="px-3 py-2">{t}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(({ director: d, card }) => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-medium whitespace-nowrap text-slate-800">{fullName(d)}</td>
              {card.measures.map((m) => (
                <td key={m.key} className="px-3 py-2 whitespace-nowrap" title={m.detail}>
                  <span className="mr-1.5 font-semibold tabular-nums">{formatValue(m)}</span>
                  <StatusChip status={m.status} compactLabel />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
