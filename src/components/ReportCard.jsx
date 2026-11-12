import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck, TriangleAlert, CircleX, CircleMinus, ClipboardCheck, Info, X } from 'lucide-react';
import { useApi } from '../lib/data.js';
import { fullName, todayIso } from '../lib/format.js';
import { compact } from './Charts.jsx';
import SidePanel from './SidePanel.jsx';
import YearBasisToggle from './YearBasisToggle.jsx';
import { useYearBasis, trailingLabel } from '../lib/yearBasis.js';
import ReportTrends from '../pages/ReportTrends.jsx';

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

const pctOf = (n) => `${Math.round(n * 100)}%`;

/**
 * What each measure assesses, how it's worked out, what each status means, and what data it needs. Thresholds come
 * from the server (`t`), so the explanation always matches the calculation.
 */
function explain(key, t) {
  return {
    bookings: {
      assesses: 'Whether we are winning enough work to hit our booking goal.',
      how: 'Contract value awarded in the period ÷ the booking target for the period. While the period is still running, the result is compared with how much of the period has passed (pace), so 50% booked halfway through the quarter is on track.',
      scale: ['At or ahead of pace (100% or more for a finished period)', 'At least 75% of pace', 'Below 75% of pace'],
      needs: 'Booking targets (Admin Access › Team Lead › Booking targets) and pipeline tickets marked won.',
    },
    newQualified: {
      assesses: 'Whether we are creating enough future growth opportunity.',
      how: 'The dollar value of pipeline tickets that first reached Qualified (or a later stage) during the period, from each pipeline ticket\'s stage history. A pipeline ticket counts once, in the period it first qualified.',
      scale: ['At least the period\'s booking target (pro-rated to pace)', 'At least half of that', 'Less than half'],
      needs: 'Pipeline tickets moved through the pipeline stages, and booking targets.',
    },
    coverage: {
      assesses: 'Whether there is enough qualified opportunity to reach the goal.',
      how: 'Qualified pipeline (open pipeline tickets from Qualified onward) ÷ the target still to book. For a finished period, the pipeline as it stood when the period began ÷ the full target. Shows "Met" once the target is reached.',
      scale: [`${t.coverage.good}× or more`, `${t.coverage.watch}× to ${t.coverage.good}×`, `Under ${t.coverage.watch}×`],
      needs: 'Pipeline stages and values on pipeline tickets, and booking targets.',
    },
    winRate: {
      assesses: 'Whether we are pursuing and winning the right work.',
      how: 'Pipeline tickets won ÷ pipeline tickets decided (won or lost) in the period, by count; the share by dollar value is shown beside it. Wins are dated by their contract\'s award date.',
      scale: [`${pctOf(t.winRate.good)} or more`, `${pctOf(t.winRate.watch)} to ${pctOf(t.winRate.good)}`, `Under ${pctOf(t.winRate.watch)}`],
      needs: 'Pipeline tickets won or lost.',
    },
    progression: {
      assesses: 'Whether pursuits are moving forward and improving our position to win.',
      how: `The number of pipeline tickets that moved forward at least one stage in the period. An open pipeline ticket is stalled if its stage hasn't changed in ${t.stalledDays} or more days, or its projected win date has passed; stalled pipeline tickets are rolled up by stage below the cards.`,
      scale: ['80% or more of open pipeline tickets are moving', '60% to 80% moving', 'Under 60% moving'],
      needs: 'Stage changes on pipeline tickets, and projected win dates.',
    },
    forecast: {
      assesses: 'Whether leadership can rely on our outlook.',
      how: 'Actual bookings in a quarter ÷ the forecast saved at the start of that quarter (value × PWIN of every open pipeline ticket projected to close in it; full value if it had no PWIN). Judged only once the quarter has ended; a year looks at its finished quarters.',
      scale: [`Within ${pctOf(t.forecast.good)} of the forecast`, `Within ${pctOf(t.forecast.watch)}`, `Off by more than ${pctOf(t.forecast.watch)}`],
      needs: 'Projected win dates on pipeline tickets (the forecast is saved automatically early each quarter) and win assessments for PWIN.',
    },
    accounts: {
      assesses: 'Whether we are building access and shaping future customer demand.',
      how: 'Account objectives achieved ÷ objectives due in the period (achieved, missed, or past their target date and still open). Open and overdue objectives are counted in the detail.',
      scale: [`${pctOf(t.objectives.good)} or more achieved`, `${pctOf(t.objectives.watch)} to ${pctOf(t.objectives.good)}`, `Under ${pctOf(t.objectives.watch)}`],
      needs: 'Account objectives with target dates (CRM › Account objectives), kept up to date.',
    },
  }[key];
}

/**
 * "How the report card is configured": every measure, what it assesses, how it's worked out, its status thresholds
 * and the data it needs, in one window.
 */
function ConfigDialog({ measures, thresholds, period, onClose }) {
  const box = useRef(null);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    box.current?.focus();
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="rc-config-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl focus:outline-none">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 id="rc-config-title" className="font-semibold text-slate-900">How the BD report card is configured</h3>
            <p className="text-xs text-slate-500">Seven measures, each answering one question for the period you pick ({period}).</p>
          </div>
          <button type="button" className="btn-ghost p-1.5" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm leading-relaxed text-slate-600">
          <section className="rounded-lg bg-slate-50 p-3 text-xs">
            <div className="mb-1.5 font-semibold text-slate-800">Statuses</div>
            <p className="mb-2">Every measure gets one of four statuses, always shown with an icon and a word. Where each threshold sits is listed under each measure.</p>
            <div className="flex flex-wrap gap-2">{['good', 'watch', 'behind', 'none'].map((k) => <StatusChip key={k} status={k} />)}</div>
            <p className="mt-2">Periods: this or last quarter, this or last year, or the last 12 months through today (its target takes the share of each quarter that falls inside it). A year can be the calendar year or the trailing four quarters (the last four finished quarters, or the four before those). A period still running is judged against how much of it has passed. Pipeline figures (coverage, stalled pipeline tickets) are as of today.</p>
          </section>
          {measures.map((m, i) => {
            const e = explain(m.key, thresholds);
            return e && (
              <section key={m.key} className="rounded-lg border border-slate-200 p-3 transition-shadow">
                <h4 className="font-semibold text-slate-900">{i + 1}. {m.title}</h4>
                <p className="mb-2 text-xs text-slate-500 italic">{m.question}</p>
                <dl className="grid gap-x-3 gap-y-1.5 text-xs sm:grid-cols-[7rem_1fr]">
                  <dt className="font-semibold text-slate-700">Assesses</dt><dd>{e.assesses}</dd>
                  <dt className="font-semibold text-slate-700">How it's worked out</dt><dd>{e.how}</dd>
                  <dt className="font-semibold text-slate-700">Thresholds</dt>
                  <dd>
                    <ul className="space-y-1">
                      {['good', 'watch', 'behind'].map((k, j) => <li key={k} className="flex items-start gap-2"><StatusChip status={k} /><span className="pt-0.5">{e.scale[j]}</span></li>)}
                    </ul>
                  </dd>
                  <dt className="font-semibold text-slate-700">Needs</dt><dd>{e.needs}</dd>
                </dl>
              </section>
            );
          })}
          <p className="text-xs text-slate-400">Thresholds are set in server/reportCard.js (THRESHOLDS); ask an admin or developer to change them.</p>
        </div>
      </div>
    </div>
  );
}

/** The periods a report card can cover. With `basis` 't4q', the two years are trailing four quarters instead. */
export function periods(basis = 'calendar') {
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const q = Math.ceil(Number(today.slice(5, 7)) / 3);
  const last = q === 1 ? `${y - 1} Q4` : `${y} Q${q - 1}`;
  const years = basis === 't4q'
    ? [
      { key: 'y', label: `Last 4 quarters (${trailingLabel(today)})`, kind: 't4q', back: 0, value: trailingLabel(today) },
      { key: 'ly', label: `4 quarters before (${trailingLabel(today, 1)})`, kind: 't4q', back: 1, value: trailingLabel(today, 1) },
    ]
    : [
      { key: 'y', label: `This year (${y})`, kind: 'year', value: String(y) },
      { key: 'ly', label: `Last year (${y - 1})`, kind: 'year', value: String(y - 1) },
    ];
  return [
    { key: 'q', label: `This quarter (${y} Q${q})`, kind: 'quarter', value: `${y} Q${q}` },
    { key: 'lq', label: `Last quarter (${last})`, kind: 'quarter', value: last },
    ...years,
    { key: 'l12', label: 'Last 12 months', kind: 'last12', value: 'Last 12 months' },
  ];
}

/** The report card query for a period from periods(). */
export function periodQuery(p) {
  return new URLSearchParams(p.kind === 't4q' ? { kind: p.kind, back: p.back } : { kind: p.kind, label: p.value });
}

/** Whether a period choice covers a year, so the calendar / trailing toggle applies. */
export const isYearChoice = (key) => key === 'y' || key === 'ly';

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
 * `title` overrides the heading, and `who` names the line in Change over time.
 */
export default function ReportCard({ director, title, who }) {
  const [basis] = useYearBasis();
  const options = periods(basis);
  const [choice, setChoice] = useState('q');
  const [view, setView] = useState('card'); // card | trends
  const [weeks, setWeeks] = useState(13);
  const p = options.find((o) => o.key === choice);
  const qs = periodQuery(p);
  if (director) qs.set('director', director);
  const { data } = useApi(`/financials/report-card?${qs}`);
  const [info, setInfo] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <ClipboardCheck size={16} className="text-brand-600" /> {title || (director ? 'Your BD report card' : 'BD report card')}
        </h2>
        <button type="button" onClick={() => setInfo(true)} className="mr-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-haspopup="dialog" title="How each measure is worked out, and its thresholds">
          <Info size={14} /> How it's configured
        </button>
        <div className="flex h-8 rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200" role="radiogroup" aria-label="Report card view">
          {[['card', 'Report card'], ['trends', 'Change over time']].map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
              className={`rounded px-2 ${view === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
        {view === 'trends' ? (
          <select className="input h-8 w-40 py-0 text-sm" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label="Timeline">
            {[13, 26, 52].map((n) => <option key={n} value={n}>Last {n} weeks</option>)}
          </select>
        ) : (
          <>
            {isYearChoice(choice) && <YearBasisToggle />}
            <select className="input h-8 w-72 py-0 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Report card period">
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </>
        )}
      </div>
      {view === 'trends' ? <ReportTrends embedded weeks={weeks} director={director} who={who || (director ? 'This director' : 'BD team')} />
        : !data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className={`space-y-4 ${data ? '' : 'opacity-50'}`}>
          <Measures card={data.card} />
          <StalledByStage measure={data.card.measures.find((m) => m.key === 'progression')} showDirector={!director} />
          {data.directors && <DirectorTable rows={data.directors} />}
        </div>
      )}
      {info && data && (
        <ConfigDialog measures={data.card.measures} thresholds={data.thresholds} period={p.value}
          onClose={() => setInfo(false)} />
      )}
    </section>
  );
}

function Measures({ card }) {
  return (
    // Cards grow to fill each row, the last one included, so the set always spans the page.
    <div className="flex flex-wrap gap-3">
      {card.measures.map((m) => (
        <div key={m.key} className="flex min-w-0 flex-1 basis-64 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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

/**
 * Stalled pursuits as one card per stage, Qualified through Under Evaluation: how many and their value. Select a card to
 * list its pipeline tickets in a side panel; select one to open its ticket.
 */
export function StalledByStage({ measure, showDirector }) {
  const [open, setOpen] = useState(null);
  const list = measure?.stalled || [];
  const stages = measure?.stalledStages || [...new Set(list.map((x) => x.stage))];
  if (!list.length) return null;
  const shown = list.filter((x) => x.stage === open);
  const total = (xs) => xs.reduce((s, x) => s + (x.value || 0), 0);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900"><TriangleAlert size={14} /> Stalled pursuits ({list.length})</h3>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4 print:grid-cols-4">
        {stages.map((stage) => {
          const xs = list.filter((x) => x.stage === stage);
          return (
            <button key={stage} type="button" disabled={!xs.length} onClick={() => setOpen(stage)} title={xs.length ? `Show the ${xs.length} stalled in ${stage}` : undefined}
              className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-left transition hover:border-amber-400 disabled:cursor-default disabled:opacity-60 disabled:hover:border-amber-100">
              <div className="text-xs font-medium text-slate-500">{stage}</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-xl font-bold tabular-nums ${xs.length ? 'text-amber-900' : 'text-slate-300'}`}>{xs.length}</span>
                {xs.length > 0 && <span className="text-xs font-medium text-slate-600 tabular-nums">{compact(total(xs))}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {open && (
        <SidePanel title={`Stalled in ${open}`} subtitle={`${shown.length} pipeline ticket${shown.length === 1 ? '' : 's'} · ${compact(total(shown))} · no stage change in 45+ days, or past the projected win date`}
          onClose={() => setOpen(null)}>
          <ul className="space-y-2">
            {shown.map((x) => (
              <li key={x.id}>
                <Link to={`/tickets?open=${x.id}`} className="block rounded-lg border border-slate-200 bg-white px-3 py-2 transition hover:border-brand-500 hover:bg-brand-50/40">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-slate-900">{x.title}</span>
                    <span className="shrink-0 text-sm font-semibold text-slate-700 tabular-nums">{compact(x.value)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {[showDirector && x.director, `${x.days} days without a stage change`, x.overdue && 'past its projected win date'].filter(Boolean).join(' · ')}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </SidePanel>
      )}
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
