import { useLayoutEffect, useRef, useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';

// Chart building blocks for the dashboards. Colors are the validated categorical slots, in fixed order (never cycled);
// three of them sit below 3:1 on the light surface, so every chart carries direct labels and a table view.
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const GRID = '#e7e5e4';
const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#8a8984' };

/** $1.2M, $850K, $0. */
export function compact(n) {
  if (n == null) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
export const fullMoney = (n) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));
export const pct = (n) => (n == null || !Number.isFinite(n) ? '—' : `${Math.round(n * 100)}%`);

/** A titled card with an optional table view of the same data (the chart's accessible twin). */
export function ChartCard({ title, subtitle, table, children, actions, className = '' }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      <header className="mb-3 flex items-start gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions}
        {table && (
          <button type="button" className="btn-ghost shrink-0 p-1.5 text-slate-500" onClick={() => setAsTable(!asTable)}
            title={asTable ? 'Show chart' : 'Show as a table'} aria-label={asTable ? 'Show chart' : 'Show as a table'} aria-pressed={asTable}>
            {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
          </button>
        )}
      </header>
      {asTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}

/** columns: [{ key, label, align, format }], rows: objects. */
export function DataTable({ columns, rows, foot }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500 uppercase">
          <tr>{columns.map((c) => <th key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              {columns.map((c) => <td key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.format ? c.format(r[c.key], r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot className="border-t border-slate-200 font-semibold"><tr>{columns.map((c) => <td key={c.key} className={`px-2 py-1.5 ${c.align === 'right' ? 'text-right tabular-nums' : ''}`}>{c.format && foot[c.key] != null ? c.format(foot[c.key], foot) : foot[c.key]}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

/** A big number with a label: for single headline figures, which don't need a chart. */
export function StatTile({ label, value, sub, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      {children}
    </div>
  );
}

/** Progress toward a goal: a thin bar and "x% of target". `format` prints the target (money by default). */
export function Meter({ value, target, label, format = compact, noun = 'target' }) {
  const share = target ? value / target : null;
  return (
    <div className="mt-2" title={label}>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, (share ?? 0) * 100)}%`, background: SERIES[0] }} />
      </div>
      <div className="mt-1 text-[11px] text-slate-500">{target ? `${pct(share)} of ${format(target)} ${noun}` : `No ${noun} set`}</div>
    </div>
  );
}

/** Legend: rect keys for bars/areas, line keys for lines. */
export function Legend({ items, line }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((s) => (
        <span key={s.key} className="flex items-center gap-1.5">
          {line ? <span className="inline-block h-0.5 w-3.5 rounded" style={{ background: s.color }} /> : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />}
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="pointer-events-none absolute z-20 min-w-36 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}>
      {tip.title && <div className="mb-1 text-[11px] text-slate-500">{tip.title}</div>}
      {tip.rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          {r.color && <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: r.color }} />}
          <span className="font-semibold text-slate-900 tabular-nums">{r.value}</span>
          <span className="text-slate-500">{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function useTip(ref) {
  const [tip, setTip] = useState(null);
  const show = (e, title, rows) => {
    const box = ref.current.getBoundingClientRect();
    const x = e.clientX - box.left;
    setTip({ x, y: e.clientY - box.top, flip: x > box.width * 0.6, title, rows });
  };
  return [tip, show, () => setTip(null)];
}

/**
 * Horizontal bars, one series: rows [{ key, label, value, sub? }]. Sorted as given. The value is printed at each bar's end.
 */
export function BarList({ rows, format = compact, color = SERIES[0], empty = 'Nothing yet.' }) {
  const ref = useRef(null);
  const [tip, show, hide] = useTip(ref);
  const max = Math.max(...rows.map((r) => r.value), 0);
  if (!rows.length) return <p className="py-6 text-center text-sm text-slate-400">{empty}</p>;
  return (
    <div ref={ref} className="relative space-y-2" onPointerLeave={hide}>
      {rows.map((r) => (
        <div key={r.key} className="group" onPointerMove={(e) => show(e, r.label, [{ label: r.sub || '', value: fullMoney(r.value) }])}
          tabIndex={0} onFocus={(e) => show({ clientX: e.currentTarget.getBoundingClientRect().left + 40, clientY: e.currentTarget.getBoundingClientRect().top + 10 }, r.label, [{ label: r.sub || '', value: fullMoney(r.value) }])} onBlur={hide}>
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-slate-700">{r.label}</span>
            <span className="shrink-0 font-semibold text-slate-900 tabular-nums">{format(r.value)}{r.sub && <span className="ml-1 font-normal text-slate-400">{r.sub}</span>}</span>
          </div>
          <div className="h-2.5 rounded-r bg-slate-50">
            <div className="h-full rounded-r transition-[filter] group-hover:brightness-110" style={{ width: `${max ? Math.max(1, (r.value / max) * 100) : 0}%`, background: color }} />
          </div>
        </div>
      ))}
      <Tooltip tip={tip} />
    </div>
  );
}

/**
 * Vertical stacked columns: categories along the bottom, `series` [{ key, label, color, values[] }] stacked bottom-up
 * with 2px gaps; each column's total is printed above it. Hover any segment for its value.
 */
export function StackedColumns({ categories, series, format = compact, height = 180 }) {
  const ref = useRef(null);
  const [tip, show, hide] = useTip(ref);
  const totals = categories.map((_, i) => series.reduce((s, x) => s + (x.values[i] || 0), 0));
  const max = Math.max(...totals, 0) || 1;
  const gap = categories.length > 6 ? 'gap-1' : 'gap-3'; // many columns: narrower gutters so labels fit
  return (
    <div>
      <div ref={ref} className="relative" onPointerLeave={hide}>
        <div className={`flex items-end ${gap} border-b px-1`} style={{ height: height + 20, borderColor: GRID }}>
          {categories.map((c, i) => (
            <div key={c} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="mb-1 text-center text-[11px] font-semibold text-slate-700 tabular-nums">{totals[i] ? format(totals[i]) : ''}</div>
              <div className="mx-auto flex w-full max-w-14 flex-col-reverse gap-[2px]">
                {series.map((s, k) => {
                  const v = s.values[i] || 0;
                  if (!v) return null;
                  const topmost = series.slice(k + 1).every((x) => !x.values[i]);
                  return (
                    <div key={s.key} tabIndex={0} className={`transition-[filter] hover:brightness-110 focus:brightness-110 focus:outline-none ${topmost ? 'rounded-t' : ''}`}
                      style={{ height: Math.max(2, (v / max) * height), background: s.color }}
                      onPointerMove={(e) => show(e, c, [{ label: s.label, value: fullMoney(v), color: s.color }])}
                      onFocus={(e) => { const b = e.currentTarget.getBoundingClientRect(); show({ clientX: b.right, clientY: b.top + b.height / 2 }, c, [{ label: s.label, value: fullMoney(v), color: s.color }]); }}
                      onBlur={hide} />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Tooltip tip={tip} />
      </div>
      <div className={`flex ${gap} px-1 pt-1`}>
        {categories.map((c) => <div key={c} className="min-w-0 flex-1 text-center text-[11px] leading-tight text-slate-500">{c}</div>)}
      </div>
      {series.length > 1 && <Legend items={series} />}
    </div>
  );
}

/**
 * Lines over time: `points` (x labels) and `series` [{ key, label, values[] }]. More than eight series fold the
 * smallest into "Other". A crosshair snaps to the nearest point and lists every series there.
 */
export function LineChart({ points, labels = points, series, format = compact, height = 220 }) {
  const wrap = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // Fold anything past eight series into "Other", keeping the largest by latest value.
  let shown = [...series];
  if (shown.length > 8) {
    const ranked = [...shown].sort((a, b) => b.values[b.values.length - 1] - a.values[a.values.length - 1]);
    const keep = new Set(ranked.slice(0, 7).map((s) => s.key));
    const rest = shown.filter((s) => !keep.has(s.key));
    shown = shown.filter((s) => keep.has(s.key)).concat({ key: 'other', label: `Other (${rest.length})`, values: points.map((_, i) => rest.reduce((t, s) => t + s.values[i], 0)) });
  }
  shown = shown.map((s, i) => ({ ...s, color: SERIES[i] }));

  const pad = { l: 52, r: 16, t: 10, b: 24 };
  const w = Math.max(width, 200);
  const max = Math.max(...shown.flatMap((s) => s.values), 0) || 1;
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i) => pad.l + (points.length < 2 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / (points.length - 1));
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / top);
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor((w - pad.l) / 70))));

  const move = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  };

  return (
    <div>
      <div ref={wrap} className="relative" onPointerLeave={() => setHover(null)}>
        <svg width={w} height={height} role="img" aria-label="Line chart" onPointerMove={move} className="block touch-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
              <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize="10" fill={INK.muted}>{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % every === 0 || i === labels.length - 1) && (
            <text key={i} x={x(i)} y={height - 6} textAnchor={i === labels.length - 1 ? 'end' : 'middle'} fontSize="10" fill={INK.muted}>{l}</text>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke={INK.muted} strokeWidth="1" strokeDasharray="2 3" />}
          {shown.map((s) => (
            <path key={s.key} d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover != null && shown.map((s) => <circle key={s.key} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} stroke="#fff" strokeWidth="2" />)}
        </svg>
        {hover != null && (
          <Tooltip tip={{ x: x(hover), y: height / 2, flip: x(hover) > w * 0.6, title: labels[hover],
            rows: [...shown].sort((a, b) => b.values[hover] - a.values[hover]).map((s) => ({ label: s.label, value: fullMoney(s.values[hover]), color: s.color })) }} />
        )}
      </div>
      <Legend items={shown} line />
    </div>
  );
}

/** Round axis ticks from zero up past `max`. */
function niceTicks(max) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step);
}
