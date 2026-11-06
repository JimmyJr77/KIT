import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, Sparkles, CircleCheck, CircleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { stamp } from '../lib/format.js';
import LessonRange, { inRange, rangeLabel, quickRanges } from './LessonRange.jsx';

const PERIODS = [['auto', 'Months or quarters'], ['month', 'Months'], ['quarter', 'Quarters']];
const TREND = {
  rising: ['Rising', 'bg-red-50 text-red-700', ArrowUpRight], falling: ['Falling', 'bg-emerald-50 text-emerald-700', ArrowDownRight],
  steady: ['Steady', 'bg-slate-100 text-slate-600', Minus], new: ['New', 'bg-amber-50 text-amber-800', Sparkles], gone: ['Gone', 'bg-emerald-50 text-emerald-700', CircleCheck],
};

const Nums = ({ list }) => (list?.length ? <span className="ml-1 text-xs text-slate-400 tabular-nums">{list.join(', ')}</span> : null);
const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</h3>
    {children}
  </section>
);
const Empty = ({ children }) => <p className="text-sm text-slate-400">{children}</p>;

/** The counts per period, from the data. The model's text never changes these. */
function PeriodTable({ stats }) {
  const tags = useMemo(() => Object.entries(stats.tag_totals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t), [stats]);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2">Period</th>
            <th className="px-2 py-2 text-right">Lessons</th>
            <th className="px-2 py-2 text-right text-emerald-700">Good</th>
            <th className="px-2 py-2 text-right text-red-700">Bad</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">Bad, solved</th>
            <th className="px-2 py-2 text-right whitespace-nowrap">Bad, no solution</th>
            {tags.map((t) => <th key={t} className="px-2 py-2 text-right whitespace-nowrap">{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {stats.periods.map((p) => (
            <tr key={p.key} className="border-t border-slate-100 tabular-nums">
              <td className="px-3 py-1.5 font-medium whitespace-nowrap text-slate-700">{p.label}</td>
              <td className="px-2 py-1.5 text-right">{p.total}</td>
              <td className="px-2 py-1.5 text-right">{p.good}</td>
              <td className="px-2 py-1.5 text-right">{p.bad}</td>
              <td className="px-2 py-1.5 text-right">{p.bad_with_solution}</td>
              <td className="px-2 py-1.5 text-right">{p.bad_without_solution}</td>
              {tags.map((t) => <td key={t} className={`px-2 py-1.5 text-right ${p.tags[t] ? '' : 'text-slate-300'}`}>{p.tags[t] || '·'}</td>)}
            </tr>
          ))}
          <tr className="border-t border-slate-200 bg-slate-50 font-semibold tabular-nums">
            <td className="px-3 py-1.5">All</td>
            <td className="px-2 py-1.5 text-right">{stats.generated_for.lessons}</td>
            <td className="px-2 py-1.5 text-right">{stats.generated_for.good}</td>
            <td className="px-2 py-1.5 text-right">{stats.generated_for.bad}</td>
            <td className="px-2 py-1.5 text-right">{stats.generated_for.bad_with_solution}</td>
            <td className="px-2 py-1.5 text-right">{stats.generated_for.bad_without_solution}</td>
            {tags.map((t) => <td key={t} className="px-2 py-1.5 text-right">{stats.tag_totals[t]}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Tags with bad lessons in more than one period, and whether the fix stuck: from the data. */
function Recurring({ stats }) {
  if (!stats.recurring.length) return <Empty>No tag has bad lessons in more than one period.</Empty>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {stats.recurring.map((t) => (
        <li key={t.tag} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-800">{t.tag}</span>
            <span className="text-xs text-slate-500">{t.bad} bad · {t.good} good</span>
            {t.recurred_after_fix && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700"><CircleAlert size={11} /> Came back after a fix</span>}
            {!t.recurred_after_fix && t.good_after_last_bad && <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><CircleCheck size={11} /> Good lesson since</span>}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Bad in {t.bad_periods.join(', ')}{t.bad_without_solution ? ` · ${t.bad_without_solution} without a solution` : ''}</div>
          <Nums list={t.lesson_numbers} />
        </li>
      ))}
    </ul>
  );
}

function Report({ r }) {
  const Items = ({ list, render, empty }) => (list?.length ? <ul className="space-y-2">{list.map((it, i) => <li key={i} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">{render(it)}</li>)}</ul> : <Empty>{empty}</Empty>);
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-900">{r.headline}</h3>
        <p className="mt-1 text-sm text-slate-700">{r.overview}</p>
      </div>
      <Section title="Problem areas and tags">
        <Items list={r.problem_areas} empty="No problem areas called out." render={(a) => {
          const [label, cls, Icon] = TREND[a.trend] || TREND.steady;
          return (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{a.theme}</span>
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}><Icon size={11} /> {label}</span>
                {a.tags?.map((t) => <span key={t} className="chip">{t}</span>)}
                <Nums list={a.lesson_numbers} />
              </div>
              <p className="mt-1 text-slate-600">{a.assessment}</p>
            </>
          );
        }} />
      </Section>
      <Section title="Solutioning">
        <p className="text-sm text-slate-700">{r.solutioning?.assessment}</p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CircleCheck size={14} /> Problems that got a solution</div>
            <Items list={r.solutioning?.solved} empty="None in this range." render={(s) => (
              <>
                <div className="font-medium text-slate-800">{s.problem} <Nums list={s.lesson_numbers} /></div>
                <p className="mt-1 text-slate-600"><span className="font-medium text-slate-500">Recorded by the team:</span> {s.what_the_team_did}</p>
                {s.evidence_it_stuck && <p className="mt-1 text-slate-600"><span className="font-medium text-slate-500">Did it stick:</span> {s.evidence_it_stuck}</p>}
              </>
            )} />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-sm font-medium text-red-700"><CircleAlert size={14} /> Recurring without a solution</div>
            <Items list={r.solutioning?.recurring_without_solution} empty="None in this range." render={(s) => (
              <>
                <div className="font-medium text-slate-800">{s.problem} <Nums list={s.lesson_numbers} /></div>
                <p className="mt-1 text-slate-600"><span className="font-medium text-slate-500">Why it persists:</span> {s.why_it_persists}</p>
                {s.kit_suggestion && <p className="mt-1 rounded-md bg-brand-50 px-2 py-1 text-brand-800"><span className="font-medium">KIT’s suggestion:</span> {s.kit_suggestion}</p>}
              </>
            )} />
          </div>
        </div>
      </Section>
      <Section title="Change over time">
        <div className="grid gap-4 lg:grid-cols-3">
          {[['improved', 'Improved', 'text-emerald-700', ArrowUpRight], ['worsened', 'Got worse', 'text-red-700', ArrowDownRight], ['new_this_range', 'New', 'text-amber-800', Sparkles]].map(([key, label, cls, Icon]) => (
            <div key={key} className="space-y-2">
              <div className={`flex items-center gap-1.5 text-sm font-medium ${cls}`}><Icon size={14} /> {label}</div>
              <Items list={r.change_over_time?.[key]} empty="Nothing to report." render={(c) => (
                <>
                  <div className="font-medium text-slate-800">{c.item} <Nums list={c.lesson_numbers} /></div>
                  <p className="mt-1 text-slate-600">{c.evidence}</p>
                </>
              )} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="Period by period">
        <Items list={r.periods} empty="No period notes." render={(p) => <><span className="font-medium text-slate-800">{p.period}:</span> <span className="text-slate-600">{p.summary}</span></>} />
      </Section>
      {r.kit_recommendations?.length > 0 && (
        <Section title="KIT’s recommendations">
          <ul className="list-disc space-y-1 rounded-lg bg-brand-50 px-3 py-2 pl-7 text-sm text-brand-900">
            {r.kit_recommendations.map((k, i) => <li key={i}>{k}</li>)}
          </ul>
        </Section>
      )}
    </div>
  );
}

/**
 * The trend report over the lessons in a date range, period by period. The latest generated report is kept on the server
 * and shown on return; Regenerate asks KIT again. The counts come from the lessons; KIT's text reads them.
 */
export default function LessonTrends({ lessons }) {
  const [range, setRange] = useState(quickRanges()[3][1]);
  const [period, setPeriod] = useState('auto');
  const [state, setState] = useState({ report: null, gemini: true, loading: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/lessons/trends').then((d) => {
      setState({ report: d.report, gemini: d.gemini, loading: false });
      if (d.report) { setRange({ from: d.report.from || '', to: d.report.to || '' }); setPeriod(d.report.period); }
    }).catch((e) => { setState({ report: null, gemini: true, loading: false }); setError(e.message); });
  }, []);

  const scoped = useMemo(() => inRange(lessons || [], range), [lessons, range]);
  const generate = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/lessons/trends', { from: range.from || null, to: range.to || null, period });
      setState((s) => ({ ...s, report: d.report }));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const report = state.report;
  const sameRange = report && (report.from || '') === range.from && (report.to || '') === range.to;
  return (
    <div className="space-y-5">
      <div className="panel space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="section-title mr-auto flex items-center gap-2"><TrendingUp size={16} className="text-brand-600" /> Trends</h2>
          <select className="input h-8 w-44 py-0 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Split into" disabled={busy}>
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button type="button" className="btn-primary" onClick={generate} disabled={busy || !state.gemini || state.loading || scoped.length < 2}>
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> {busy ? 'Generating…' : report ? 'Regenerate' : 'Generate report'}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          How the problem areas and tags trend period by period, how solutioning has gone (what got a solution, what keeps coming back without one),
          and what improved, got worse or is new. The counts are computed from the lessons; KIT writes the assessment around them.
        </p>
        <LessonRange value={range} onChange={setRange} disabled={busy} />
        <div className="text-xs font-medium text-brand-700">
          {scoped.length} lesson{scoped.length === 1 ? '' : 's'} {rangeLabel(range)}{scoped.length < 2 ? ' · KIT needs at least two to see a trend' : ''}
        </div>
        {!state.gemini && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">KIT’s trend report isn’t set up on this server: Gemini needs a GEMINI_API_KEY.</p>}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>

      {state.loading ? <p className="text-sm text-slate-400">Loading the latest report…</p> : !report ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <TrendingUp size={28} className="mx-auto mb-2 text-slate-300" />
          No trend report yet. Choose a range and generate one.
        </div>
      ) : (
        <div className="panel space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            <span>Generated {stamp(report.generated_at)}{report.generated_by ? ` by ${report.generated_by}` : ''}</span>
            <span>·</span>
            <span>{report.stats.generated_for.lessons} lessons {rangeLabel({ from: report.from || '', to: report.to || '' })}, by {report.period === 'quarter' ? 'quarter' : 'month'}</span>
            {report.model && <><span>·</span><span>{report.model}</span></>}
            {!sameRange && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">The range above differs from this report’s. Regenerate to update it.</span>}
          </div>
          <Section title="Lessons per period, from the data">
            <PeriodTable stats={report.stats} />
          </Section>
          <Section title="Recurring themes, from the data">
            <Recurring stats={report.stats} />
          </Section>
          <div className="border-t border-slate-200 pt-5">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Sparkles size={13} className="text-brand-600" /> KIT’s assessment</div>
            <Report r={report.report} />
          </div>
        </div>
      )}
    </div>
  );
}
