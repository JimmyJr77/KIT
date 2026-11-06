import { todayIso } from '../lib/format.js';

/** The date a lesson counts on: its retro date, or else the day it was logged. Same rule as the server's. */
export const lessonDate = (l) => l.retro_date || String(l.created_at).slice(0, 10);
export const inRange = (lessons, { from, to }) => lessons.filter((l) => {
  const d = lessonDate(l);
  return (!from || d >= from) && (!to || d <= to);
});

const iso = (d) => d.toLocaleDateString('en-CA');
const longDate = (s) => new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** "from Jan 1 to Jun 30, 2026", "since Jan 1, 2026", "through Jun 30, 2026" or "all time". */
export function rangeLabel({ from, to }) {
  if (from && to) return `from ${longDate(from)} to ${longDate(to)}`;
  if (from) return `since ${longDate(from)}`;
  if (to) return `through ${longDate(to)}`;
  return 'all time';
}

/** The quick picks, worked out from today. */
export function quickRanges() {
  const now = new Date();
  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3); // this quarter, 0-3
  const lastQStart = new Date(y, (q - 1) * 3, 1);
  const lastQEnd = new Date(y, q * 3, 0);
  const sixMonths = new Date(y, now.getMonth() - 6, now.getDate());
  return [
    ['Last quarter', { from: iso(lastQStart), to: iso(lastQEnd) }],
    ['Last 6 months', { from: iso(sixMonths), to: todayIso() }],
    ['This year', { from: `${y}-01-01`, to: todayIso() }],
    ['All time', { from: '', to: '' }],
  ];
}

/** From and to dates with the quick picks. `value` is { from, to }, each '' for no bound. */
export default function LessonRange({ value, onChange, disabled }) {
  const picks = quickRanges();
  const active = (r) => r.from === value.from && r.to === value.to;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        From
        <input type="date" className="input h-8 w-36 py-0 text-sm" value={value.from} max={value.to || undefined} disabled={disabled}
          onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From date" />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        To
        <input type="date" className="input h-8 w-36 py-0 text-sm" value={value.to} min={value.from || undefined} disabled={disabled}
          onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
      </label>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Quick picks">
        {picks.map(([label, r]) => (
          <button key={label} type="button" disabled={disabled} aria-pressed={active(r)} onClick={() => onChange(r)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${active(r) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
