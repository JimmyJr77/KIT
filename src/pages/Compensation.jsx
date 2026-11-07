import { useEffect, useState } from 'react';
import { AlertTriangle, BadgeDollarSign, ChevronDown, ChevronUp, Settings2, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { StackedColumns, SERIES, compact, fullMoney, pct } from '../components/Charts.jsx';

const money = (n) => fullMoney(n == null ? null : Math.round(n));
const rate = (n) => (n == null ? '—' : `${Number(n) % 1 ? Number(n).toFixed(1) : Number(n)}%`);
const longDate = (iso) => (iso ? shortDate(iso, { month: 'long', day: 'numeric', year: 'numeric' }) : '—');
const TIERS = [['y1', 'Year 1', SERIES[0]], ['y2', 'Year 2', SERIES[2]], ['y3', 'Year 3', SERIES[3]]];
const TERM_SOURCE = { set: 'set here', deal: 'from the deal', contract: 'from the contract', dates: 'from its dates', assumed: 'assumed' };
const START_SOURCE = { set: 'set here', contract: 'the contract start', won: 'the day it was won' };

/**
 * Compensation: the BD Director bonus plan (3/2/1) applied to each director's won deals. Bonus earned on revenue billed,
 * bonus to expect from the contracts' values, the two payouts, each director's salary and goals, and the team's totals.
 * Admins see everyone and set the inputs; everyone else sees their own.
 */
export default function Compensation() {
  const { user } = useAuth();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, reload, error } = useApi(`/compensation?year=${year}`);
  const [showSettings, setShowSettings] = useState(false);
  const [adding, setAdding] = useState('');
  const [err, setErr] = useState('');
  const canEdit = !!data?.canEdit;

  const addDirector = async (id) => {
    if (!id) return;
    setErr('');
    try { await api.put('/compensation/plans', { user_id: Number(id), plan_year: year }); setAdding(''); reload({ quiet: true }); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-6 p-8">
      <PageHeader title="Compensation" subtitle="The BD Director bonus plan (3/2/1) applied to each director's won deals: the bonus earned on revenue billed, and what to expect from the contracts won.">
        <select className="input h-9 w-28 py-0 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Plan year">
          {[-1, 0, 1, 2].map((d) => thisYear + d).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        {canEdit && (
          <button type="button" className={showSettings ? 'btn-primary' : 'btn'} onClick={() => setShowSettings((s) => !s)}>
            <Settings2 size={15} /> Plan settings
          </button>
        )}
      </PageHeader>

      {(error || err) && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error?.message || err}</p>}
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          <PlanSummary settings={data.settings} year={year} />
          {showSettings && canEdit && <PlanSettings settings={data.settings} onSaved={() => reload({ quiet: true })} onClose={() => setShowSettings(false)} />}

          {(canEdit || data.directors.length > 1) && <TeamSummary team={data.team} year={year} />}

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="section-title mr-auto flex items-center gap-2"><BadgeDollarSign size={16} className="text-brand-600" /> {canEdit ? 'BD directors' : 'Your compensation'}</h2>
              {canEdit && data.members.length > 0 && (
                <select className="input h-8 w-60 py-0 text-sm" value={adding} onChange={(e) => addDirector(e.target.value)} aria-label="Add a director">
                  <option value="">Add a director to {year}…</option>
                  {data.members.map((m) => <option key={m.id} value={m.id}>{fullName(m)}</option>)}
                </select>
              )}
            </div>
            {!data.directors.length && (
              <p className="panel text-sm text-slate-500">
                {canEdit ? `Nobody has a plan or a won deal in ${year} yet. Add a director above to set their plan inputs; their wins join on their own as deals are won.`
                  : `No compensation plan applies to you in ${year}. The plan covers BD directors' won deals.`}
              </p>
            )}
            {data.directors.map((d) => (
              <DirectorCard key={d.id} d={d} year={year} today={data.today} settings={data.settings} canEdit={canEdit} me={d.id === user.id}
                onChange={() => reload({ quiet: true })} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** The plan in one line: the tiers, when it took effect, and how it pays. */
function PlanSummary({ settings, year }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-brand-100 bg-brand-50/60 px-5 py-3 text-sm text-slate-700">
      <span className="flex items-center gap-2">
        {TIERS.map(([k, label, color], i) => (
          <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> <b className="tabular-nums">{rate(settings[`rate_${k}`])}</b> <span className="text-slate-500">of revenue in contract {label.toLowerCase()}</span>{i < 2 && <span className="text-slate-300">·</span>}</span>
        ))}
        <span className="text-slate-500">· nothing after</span>
      </span>
      <span className="text-slate-500">Uncapped and additive: every contract runs its own clock.</span>
      <span className="text-slate-500">{settings.effective_date ? `In effect from ${longDate(settings.effective_date)}.` : 'No effective date.'}</span>
      <span className="text-slate-500">Paid twice: 1H {year} in Q3 {year} as an advance, 2H in Q1 {year + 1} with the year's true-up.</span>
    </div>
  );
}

/** The plan's defaults, for admins: the three rates and the effective date. */
function PlanSettings({ settings, onSaved, onClose }) {
  const [form, setForm] = useState({ rate_y1: settings.rate_y1, rate_y2: settings.rate_y2, rate_y3: settings.rate_y3, effective_date: settings.effective_date || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try { await api.put('/compensation/settings', form); onSaved(); onClose(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="panel space-y-3" onSubmit={save}>
      <div className="flex items-center">
        <h2 className="section-title">Plan settings</h2>
        <button type="button" className="btn-ghost ml-auto p-1" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <p className="text-xs text-slate-500">The plan's default rates, as percents of the gross revenue recognized in each contract year. A director's own rates, set on their card, take precedence. Revenue recognized before the effective date earns nothing.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        {TIERS.map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`rate-${k}`}>Contract {label.toLowerCase()} rate (%)</label>
            <input id={`rate-${k}`} type="number" min="0" max="100" step="0.1" className="input" value={form[`rate_${k}`]} onChange={set(`rate_${k}`)} />
          </div>
        ))}
        <div>
          <label className="label" htmlFor="effective">Effective date</label>
          <input id="effective" type="date" className="input" value={form.effective_date} onChange={set('effective_date')} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

function Figure({ label, value, note, tone = '' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</div>
      {note && <div className="text-[11px] text-slate-500">{note}</div>}
    </div>
  );
}

/** Bonus month by month, split by the contract-year tier it's paid at. */
function BonusChart({ series }) {
  const any = series.some((m) => m.tiers.some(Boolean));
  if (!any) return <p className="py-6 text-center text-sm text-slate-400">No bonus expected in these months.</p>;
  return (
    <StackedColumns categories={series.map((m) => m.label)} height={140}
      series={TIERS.map(([k, label, color], i) => ({ key: k, label: `Contract ${label.toLowerCase()}`, color, values: series.map((m) => m.tiers[i]) }))} />
  );
}

/** The team: wins, expected and earned bonus, salaries and total compensation, the outlook, and the month-by-month chart. */
function TeamSummary({ team, year }) {
  const yr = team.periods.year;
  return (
    <section className="panel space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="section-title">BD team, {year}</h2>
        <span className="text-xs text-slate-500">{team.directors} director{team.directors === 1 ? '' : 's'} · {team.contracts} contract{team.contracts === 1 ? '' : 's'} in the plan</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label={`Won in ${year}`} value={compact(team.wins.value)} note={`${team.wins.count} deal${team.wins.count === 1 ? '' : 's'}`} />
        <Figure label={`Expected revenue, ${year}`} value={compact(yr.expected)} note={`${compact(yr.recognized)} billed so far`} />
        <Figure label={`Expected bonus, ${year}`} value={compact(yr.bonusExpected)} tone="text-brand-700" note={`1H ${compact(team.periods.h1.bonusExpected)} · 2H ${compact(team.periods.h2.bonusExpected)}`} />
        <Figure label="Bonus earned to date" value={compact(yr.bonusRecognized)} note="on revenue billed" />
        <Figure label="Salaries" value={team.withSalary ? compact(team.salaries) : '—'} note={team.withSalary ? `${team.withSalary} of ${team.directors} set` : 'none set'} />
        <Figure label={`Expected compensation`} value={team.withSalary ? compact(team.salaries + yr.bonusExpected) : compact(yr.bonusExpected)} note={team.withSalary ? 'salaries + expected bonus' : 'bonus only; no salaries set'} />
      </div>
      {(team.unapproved > 0 || team.assumedTerms > 0) && (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {team.unapproved > 0 && <>{team.unapproved} contract{team.unapproved === 1 ? ' has' : 's have'} no pre-bid approval recorded (the plan pays only bids the CEO and VP of Finance signed off); they count until an admin marks them. </>}
            {team.assumedTerms > 0 && <>{team.assumedTerms} contract{team.assumedTerms === 1 ? '' : 's'} carr{team.assumedTerms === 1 ? 'ies' : 'y'} no readable term, so a 12-month term is assumed.</>}
          </span>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-xs font-semibold text-slate-600">Expected bonus by month</h3>
          <BonusChart series={team.series} />
        </div>
        <div>
          <h3 className="mb-2 text-xs font-semibold text-slate-600">Outlook from contracts won so far</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500 uppercase"><tr><th className="py-1">Year</th><th className="py-1 text-right">Revenue</th><th className="py-1 text-right">Bonus</th></tr></thead>
            <tbody>
              {team.outlook.map((o) => (
                <tr key={o.year} className="border-t border-slate-100">
                  <td className="py-1.5">{o.year}</td>
                  <td className="py-1.5 text-right tabular-nums">{compact(o.expected)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{compact(o.bonusExpected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-500">Trailing years are what the contracts already won pay in their second and third years; new wins add to them.</p>
        </div>
      </div>
    </section>
  );
}

/** How far along a goal is: the bar fills with what's expected, the darker part with what's earned. */
function Goal({ label, g }) {
  if (!g) return null;
  const exp = Math.min(1, g.expected / g.goal);
  const rec = Math.min(1, g.recognized / g.goal);
  return (
    <div className="min-w-48 flex-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-slate-600">{label}</span>
        <span className="tabular-nums text-slate-500">{compact(g.expected)} of {compact(g.goal)} · {pct(g.expected / g.goal)}</span>
      </div>
      <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(exp * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand-200" style={{ width: `${exp * 100}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-brand-600" style={{ width: `${rec * 100}%` }} />
      </div>
    </div>
  );
}

/** One director: the headline figures, their goals, and (opened) plan inputs, payouts, outlook and contracts. */
function DirectorCard({ d, year, today, settings, canEdit, me, onChange }) {
  const [open, setOpen] = useState(me);
  const yr = d.periods.year;
  const forfeits = !d.plan.eligible;
  return (
    <article className={`panel space-y-4 ${forfeits ? 'border-amber-200' : ''}`}>
      <div className="flex flex-wrap items-start gap-4">
        <button type="button" className="flex items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          <span>
            <span className="block font-semibold text-slate-900">{fullName(d)}{me && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 uppercase">You</span>}</span>
            <span className="block text-xs text-slate-500">{d.title || 'BD director'}{!d.onBd && ' · not on the BD team'}{!d.active && ' · inactive'}</span>
          </span>
        </button>
        <div className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-right sm:grid-cols-4">
          <Headline label={`Won in ${year}`} value={compact(d.wins.value)} note={`${d.wins.count} deal${d.wins.count === 1 ? '' : 's'}`} />
          <Headline label="Expected bonus" value={compact(yr.bonusExpected)} note={`${compact(yr.bonusRecognized)} earned`} tone="text-brand-700" />
          <Headline label="Base salary" value={d.plan.base_salary != null ? compact(d.plan.base_salary) : '—'} note={d.plan.base_salary == null && canEdit ? 'set below' : ''} />
          <Headline label="Expected total" value={d.total.expected != null ? compact(d.total.expected) : compact(yr.bonusExpected)} note={d.total.expected != null ? 'salary + bonus' : 'bonus only'} />
        </div>
      </div>
      {forfeits && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Marked not eligible: the plan pays only an active full-time employee on payday, so these payouts are forfeited and left out of the total.</p>}
      {(d.goals.revenue || d.goals.bonus) && (
        <div className="flex flex-wrap gap-6">
          <Goal label={`Revenue goal, ${year}`} g={d.goals.revenue} />
          <Goal label={`Bonus goal, ${year}`} g={d.goals.bonus} />
        </div>
      )}
      {open && (
        <div className="space-y-5 border-t border-slate-100 pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-3 lg:col-span-1">
              <h3 className="text-xs font-semibold text-slate-600">Payouts</h3>
              {['h1', 'h2'].map((k) => (
                <div key={k} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium text-slate-800">{d.payouts[k].label}</span>
                    <span className="text-xs text-slate-500">paid {d.payouts[k].paidIn}</span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="text-lg font-bold tabular-nums text-slate-900">{money(d.payouts[k].expected)}</span>
                    <span className="text-xs text-slate-500">expected · {money(d.payouts[k].recognized)} on revenue billed</span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{k === 'h1' ? 'An advance on the year, from revenue recognized January through June.' : 'The full year\'s bonus less the 1H advance, after the annual books close.'}</p>
                </div>
              ))}
              <h3 className="pt-1 text-xs font-semibold text-slate-600">Outlook from contracts won so far</h3>
              <table className="w-full text-sm">
                <tbody>
                  {d.outlook.map((o) => (
                    <tr key={o.year} className="border-t border-slate-100">
                      <td className="py-1">{o.year}</td>
                      <td className="py-1 text-right text-slate-500 tabular-nums">{compact(o.expected)} revenue</td>
                      <td className="py-1 text-right font-semibold tabular-nums">{compact(o.bonusExpected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="lg:col-span-2">
              <h3 className="mb-2 text-xs font-semibold text-slate-600">Expected bonus by month, {year}</h3>
              <BonusChart series={d.series} />
            </div>
          </div>

          <PlanInputs d={d} year={year} settings={settings} canEdit={canEdit} onChange={onChange} />
          <Contracts d={d} year={year} today={today} canEdit={canEdit} onChange={onChange} />
        </div>
      )}
    </article>
  );
}

function Headline({ label, value, note, tone = '' }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-500 uppercase">{label}</div>
      <div className={`text-base font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</div>
      {note && <div className="text-[10px] text-slate-500">{note}</div>}
    </div>
  );
}

const FIELDS = [
  ['base_salary', 'Base salary ($)', 'Annual salary, so the card can show total compensation.'],
  ['revenue_goal', 'Revenue goal ($)', 'Recognized revenue on their contracts this year.'],
  ['bonus_goal', 'Bonus goal ($)', 'Bonus to earn this year.'],
];

/** The director's plan inputs for the year: salary, goals, their own rates, eligibility and notes. Admins edit; others read. */
function PlanInputs({ d, year, settings, canEdit, onChange }) {
  const p = d.plan;
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  useEffect(() => {
    setForm({ base_salary: p.base_salary ?? '', revenue_goal: p.revenue_goal ?? '', bonus_goal: p.bonus_goal ?? '', rate_y1: p.rate_y1 ?? '', rate_y2: p.rate_y2 ?? '', rate_y3: p.rate_y3 ?? '', notes: p.notes || '' });
  }, [p.base_salary, p.revenue_goal, p.bonus_goal, p.rate_y1, p.rate_y2, p.rate_y3, p.notes]);
  const save = async (patch) => {
    setError('');
    try { await api.put('/compensation/plans', { user_id: d.id, plan_year: year, ...patch }); onChange(); } catch (e) { setError(e.message); }
  };
  const commit = (k) => () => { if (String(form[k] ?? '') !== String(p[k] ?? '')) save({ [k]: form[k] }); };
  const remove = async () => {
    if (!confirm(`Clear ${fullName(d)}'s plan inputs for ${year}? Their wins stay.`)) return;
    try { await api.del(`/compensation/plans/${d.id}/${year}`); onChange(); } catch (e) { setError(e.message); }
  };

  if (!canEdit) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold text-slate-600">Your plan, {year}</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 lg:grid-cols-6">
          <Dt label="Base salary" value={p.base_salary != null ? money(p.base_salary) : 'Not set'} />
          <Dt label="Rates" value={`${rate(p.effective.rate_y1)} · ${rate(p.effective.rate_y2)} · ${rate(p.effective.rate_y3)}`} />
          <Dt label="Revenue goal" value={p.revenue_goal ? money(p.revenue_goal) : 'None'} />
          <Dt label="Bonus goal" value={p.bonus_goal ? money(p.bonus_goal) : 'None'} />
          <Dt label="Eligible" value={p.eligible ? 'Yes' : 'No'} />
          {p.notes && <Dt label="Notes" value={p.notes} />}
        </dl>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-600">Plan inputs, {year}</h3>
        <span className="text-[11px] text-slate-500">Saved as you leave each field. Rates left blank use the plan's defaults ({rate(settings.rate_y1)} · {rate(settings.rate_y2)} · {rate(settings.rate_y3)}).</span>
        {p.exists && <button type="button" className="btn-ghost ml-auto py-1 text-xs text-slate-500" onClick={remove}><Trash2 size={12} /> Clear</button>}
      </div>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {FIELDS.map(([k, label, help]) => (
          <div key={k}>
            <label className="label" htmlFor={`${k}-${d.id}`}>{label}</label>
            <input id={`${k}-${d.id}`} type="number" min="0" step="1" className="input" value={form[k] ?? ''} title={help}
              onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} onBlur={commit(k)} />
          </div>
        ))}
        {TIERS.map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`rate_${k}-${d.id}`}>{label} rate (%)</label>
            <input id={`rate_${k}-${d.id}`} type="number" min="0" max="100" step="0.1" className="input" placeholder={rate(settings[`rate_${k}`])} value={form[`rate_${k}`] ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, [`rate_${k}`]: e.target.value }))} onBlur={commit(`rate_${k}`)} />
          </div>
        ))}
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="label" htmlFor={`notes-${d.id}`}>Notes</label>
          <input id={`notes-${d.id}`} className="input" maxLength={400} value={form.notes ?? ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} onBlur={commit('notes')} />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 lg:col-span-2">
          <input type="checkbox" checked={!!p.eligible} onChange={(e) => save({ eligible: e.target.checked })} />
          Eligible (active full-time employee)
        </label>
      </div>
    </div>
  );
}

function Dt({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

const APPROVAL = { approved: ['Approved', 'bg-emerald-50 text-emerald-700'], not_approved: ['Not approved', 'bg-red-50 text-red-700'], none: ['Not recorded', 'bg-amber-50 text-amber-800'] };

/** The director's won deals as the plan sees them, with what each pays this year and over its term. */
function Contracts({ d, year, today, canEdit, onChange }) {
  const [editing, setEditing] = useState(null);
  if (!d.contracts.length) return <p className="text-sm text-slate-500">No won deals yet.</p>;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-slate-600">Won deals in the plan</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Deal</th>
              <th className="px-3 py-2">Won</th>
              <th className="px-3 py-2">Contract year 1 starts</th>
              <th className="px-3 py-2">Term</th>
              <th className="px-3 py-2">Now in</th>
              <th className="px-3 py-2 text-right">Value</th>
              <th className="px-3 py-2 text-right">Revenue {year}</th>
              <th className="px-3 py-2 text-right">Bonus {year}</th>
              <th className="px-3 py-2">Pre-bid approval</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {d.contracts.map((c) => {
              const [aLabel, aTone] = APPROVAL[c.approval || 'none'];
              const now = c.years.find((y) => y.contractYear === c.contractYearNow);
              return (
                <ContractRows key={c.ticket_id} c={c} year={year} editing={editing === c.ticket_id} canEdit={canEdit}
                  onEdit={() => setEditing(editing === c.ticket_id ? null : c.ticket_id)} onChange={onChange}
                  cells={(
                    <>
                      <td className="px-3 py-2">
                        <div className={`font-medium ${c.excluded ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{c.title}</div>
                        <div className="text-xs text-slate-500">{c.organization}{c.territory ? ` · ${c.territory}` : ''}{c.excluded ? ' · left out of the plan' : ''}</div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">{shortDate(c.won_on, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600" title={`From ${START_SOURCE[c.start_source]}`}>{shortDate(c.start_date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600" title={c.term_text || ''}>
                        {c.term_months} mo <span className={`text-xs ${c.term_source === 'assumed' ? 'text-amber-700' : 'text-slate-400'}`}>({TERM_SOURCE[c.term_source]})</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                        {c.start_date > today ? 'Not started' : c.contractYearNow > c.years.length ? 'Past its term' : <>Year {c.contractYearNow} <span className="text-xs text-slate-400">at {pct(now?.rate ?? 0)}</span></>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(c.inYear.expected)}<div className="text-[11px] text-slate-500">{money(c.inYear.recognized)} billed</div></td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(c.inYear.bonusExpected)}<div className="text-[11px] font-normal text-slate-500">{money(c.inYear.bonusRecognized)} earned</div></td>
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${aTone}`}>{aLabel}</span></td>
                    </>
                  )} />
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Revenue is what's billed on the contract in Delivery; expected revenue spreads the contract's value evenly over its term where nothing's billed yet. Contract years run twelve months from the start date; a renewal or re-compete is its own won deal and starts again at year 1.
      </p>
    </div>
  );
}

/** A contract's row, plus its per-contract-year schedule and (for admins) the edit form when opened. */
function ContractRows({ c, year, cells, editing, canEdit, onEdit, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-slate-100 align-top hover:bg-slate-50/60">
        {cells}
        {canEdit && (
          <td className="px-3 py-2 whitespace-nowrap text-right">
            <button type="button" className="btn-ghost py-1 text-xs" onClick={() => setOpen((o) => !o)}>{open ? 'Hide years' : 'Years'}</button>
            <button type="button" className={`${editing ? 'btn-primary' : 'btn-ghost'} py-1 text-xs`} onClick={onEdit}>{editing ? 'Done' : 'Edit'}</button>
          </td>
        )}
      </tr>
      {(open || !canEdit) && (
        <tr className="bg-slate-50/50">
          <td colSpan={canEdit ? 10 : 9} className="px-3 pt-0 pb-3">
            <div className="flex flex-wrap gap-2">
              {c.years.map((y) => (
                <div key={y.contractYear} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs">
                  <div className="font-semibold text-slate-700">Contract year {y.contractYear} <span className="font-normal text-slate-500">· {shortDate(y.from, { month: 'short', year: 'numeric' })} – {shortDate(y.to, { month: 'short', year: 'numeric' })} · {pct(y.rate)}</span></div>
                  <div className="tabular-nums text-slate-600">{money(y.expected)} revenue → <b className="text-slate-800">{money(y.bonusExpected)}</b> bonus{y.recognized ? ` · ${money(y.recognized)} billed` : ''}</div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
      {editing && canEdit && (
        <tr className="bg-brand-50/40">
          <td colSpan={10} className="px-3 py-3"><ContractEditor c={c} year={year} onChange={onChange} /></td>
        </tr>
      )}
    </>
  );
}

/** What the plan knows about one won deal: start, term, approval, revenue basis, and whether it's in the plan. */
function ContractEditor({ c, year, onChange }) {
  const [form, setForm] = useState({ start_date: c.start_source === 'set' ? c.start_date : '', term_months: c.term_source === 'set' ? c.term_months : '', approval: c.approval || '', revenue_basis: c.revenue_basis || '', excluded: c.excluded, notes: c.notes || '' });
  const [error, setError] = useState('');
  const save = async (patch) => {
    setError('');
    try { await api.put(`/compensation/contracts/${c.ticket_id}?year=${year}`, patch); onChange(); } catch (e) { setError(e.message); }
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="label" htmlFor={`start-${c.ticket_id}`}>Contract year 1 starts</label>
          <input id={`start-${c.ticket_id}`} type="date" className="input" value={form.start_date} onChange={set('start_date')} onBlur={() => save({ start_date: form.start_date })} />
          <p className="mt-0.5 text-[11px] text-slate-500">Blank: {START_SOURCE[c.start_source === 'set' ? 'won' : c.start_source]}.</p>
        </div>
        <div>
          <label className="label" htmlFor={`term-${c.ticket_id}`}>Term (months)</label>
          <input id={`term-${c.ticket_id}`} type="number" min="1" max="240" step="1" className="input" value={form.term_months} onChange={set('term_months')} onBlur={() => save({ term_months: form.term_months })} />
          <p className="mt-0.5 text-[11px] text-slate-500">Blank: read from the deal{c.term_text ? ` (“${c.term_text}”)` : ''}. Option years count.</p>
        </div>
        <div>
          <label className="label" htmlFor={`approval-${c.ticket_id}`}>Pre-bid approval</label>
          <select id={`approval-${c.ticket_id}`} className="input" value={form.approval} onChange={(e) => { setForm((f) => ({ ...f, approval: e.target.value })); save({ approval: e.target.value }); }}>
            <option value="">Not recorded</option>
            <option value="approved">Approved by the CEO and VP of Finance</option>
            <option value="not_approved">Not approved (earns nothing)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`basis-${c.ticket_id}`}>Revenue</label>
          <select id={`basis-${c.ticket_id}`} className="input" value={form.revenue_basis} onChange={(e) => { setForm((f) => ({ ...f, revenue_basis: e.target.value })); save({ revenue_basis: e.target.value }); }}>
            <option value="">Auto: billed where billed, else spread evenly</option>
            <option value="billed">Billed revenue only</option>
            <option value="straight">Spread evenly over the term</option>
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label" htmlFor={`cnotes-${c.ticket_id}`}>Notes</label>
          <input id={`cnotes-${c.ticket_id}`} className="input" maxLength={400} value={form.notes} onChange={set('notes')} onBlur={() => save({ notes: form.notes })} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={!!form.excluded} onChange={(e) => { setForm((f) => ({ ...f, excluded: e.target.checked })); save({ excluded: e.target.checked }); }} />
        Leave this deal out of the plan
      </label>
    </div>
  );
}
