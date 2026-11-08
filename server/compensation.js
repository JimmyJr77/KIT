// The BD Director bonus plan (the "3/2/1 plan", effective July 1, 2026) applied to each director's won deals.
//
// What the plan says, and how it's modeled here:
//   Tiers (§2): a bonus of 3% of the gross revenue recognized in a contract's first year of performance, 2% in its second,
//     1% in its third, and nothing after (§4.1). Contract years run twelve months from the contract's start date.
//   Additive (§2.1): every contract runs its own clock, so the bonuses of overlapping contracts simply add up.
//   Renewals (§4.2): a new agreement, re-compete or renewal is its own won deal, so its clock starts at year 1 on its own.
//   Pre-bid approval (§3.2): a bid without the CEO's and VP of Finance's sign-off earns nothing. An admin records the
//     approval on each contract; one not recorded yet still counts, flagged, so a missing record doesn't hide money.
//   Payouts (§5): paid in June (an advance on the first half of the year) and in December, when the whole year is trued
//     up: the December payout is the year's bonus less what June paid, and those are the year's final numbers.
//   Eligibility (§6.1): a director who isn't an active full-time employee on payday forfeits the payout.
//
// Revenue. KIT's revenue is what's billed on a contract (Delivery › billing entries), the same figure the BD dashboard
// calls revenue. The plan is paid on that. To show what a director can expect, the contract's value is also spread
// evenly over its term (straight-line): a contract's expected revenue in a month is what was billed when the month is
// past and had billings, else the straight-line share. Per contract, `revenue_basis` can insist on one or the other.
// Nothing is paid on months before the plan's effective date.
//
// Projections. Beyond the deals already won, a director's open pipeline tickets dated in a coming month, weighted by
// PWIN, are the system's projection of what they'll close that month (an open ticket dated earlier rolls into this
// month). A director can put their own number on a month instead, or go back to the system's. A projected win is
// treated as a contract starting that month, spread over the deal's expected term (twelve months when unknown), and
// earns at the plan's rates like any other, so the page can show what those wins would pay.
import { db, json, getSetting, setSetting } from './db.js';
import { inBooks, localToday, bids, isOpen } from './financials.js';

export const SETTINGS_KEY = 'comp_plan';
export const DEFAULTS = { rate_y1: 3, rate_y2: 2, rate_y3: 1, effective_date: '2026-07-01' };
export const PLAN_YEARS = 3;

/** The plan's defaults: the three rates (percent) and the effective date. */
export function planSettings() {
  return { ...DEFAULTS, ...json.parse(getSetting(SETTINGS_KEY), {}) };
}

export function savePlanSettings(patch = {}) {
  const cur = planSettings();
  const next = { ...cur };
  for (const k of ['rate_y1', 'rate_y2', 'rate_y3']) {
    if (k in patch) {
      const n = Number(patch[k]);
      if (!(n >= 0 && n <= 100)) throw new Error('Rates are percents from 0 to 100');
      next[k] = n;
    }
  }
  if ('effective_date' in patch) {
    const d = patch.effective_date;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('The effective date is a date (YYYY-MM-DD)');
    next.effective_date = d || null;
  }
  setSetting(SETTINGS_KEY, json.str(next));
  return next;
}

// ---- Months. Everything runs at month granularity: a contract year is twelve months from the start date's month.
const ym = (iso) => String(iso).slice(0, 7);
const ymStart = (ym) => `${ym}-01`;
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}
function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
export const monthLabel = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const yearMonths = (year) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

// ---- Contract term, read from the deal.
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const TERM_FIELD = /expected contract term|contract term|period of performance|pop\b/i;
const POP_END_FIELD = /period of performance end|pop end/i;

/**
 * How many months "1 year, with two option years", "5 years", "12 months", "1 base + 4 option years" or "base plus 2
 * options" runs, option years included (the plan treats a five-year contract as sixty months, §4.1). Null when unreadable.
 */
export function parseTerm(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (w) => WORDS[w]);
  const months = [...s.matchAll(/(\d+)\s*-?\s*(?:months?|mos?\b)/g)].map((m) => Number(m[1]));
  const years = [...s.matchAll(/(\d+)\s*-?\s*(?:years?|yrs?\b)/g)].map((m) => Number(m[1]));
  // "two option years", "base + 2 options", "4 option periods": each option is a year.
  const options = [...s.matchAll(/(\d+)\s*-?\s*option(?:al)?s?\s*(?:years?|yrs?|periods?)?/g)].map((m) => Number(m[1]));
  let total = months.reduce((a, b) => a + b, 0) + years.reduce((a, b) => a + b, 0) * 12 + options.reduce((a, b) => a + b, 0) * 12;
  // "base + 2 options" with no base length: a one-year base.
  if (!months.length && !years.length && options.length && /base/.test(s)) total += 12;
  return total > 0 ? total : null;
}

/** The deal's term field, parsed, from its custom fields JSON. */
const termFromFields = (customFields) => {
  const f = json.parse(customFields, []).find((x) => TERM_FIELD.test(x.name || '') && !POP_END_FIELD.test(x.name || '') && x.value);
  return { months: f ? parseTerm(f.value) : null, text: f?.value || null };
};

/** A won deal's start date and term from what's on it, with where each came from. */
function termOf(row, override) {
  const fields = json.parse(row.custom_fields, []);
  const start = override?.start_date || row.start_date || (row.won_at ? row.won_at.slice(0, 10) : null) || row.awarded_at.slice(0, 10);
  const startSource = override?.start_date ? 'set' : row.start_date ? 'contract' : 'won';
  if (override?.term_months) return { start, startSource, months: override.term_months, termSource: 'set', termText: null };
  const parsed = termFromFields(row.custom_fields);
  if (parsed.months) return { start, startSource, months: parsed.months, termSource: 'deal', termText: parsed.text };
  const popEnd = row.pop_end || fields.find((x) => POP_END_FIELD.test(x.name || '') && /^\d{4}-\d{2}-\d{2}/.test(x.value || ''))?.value;
  const end = row.end_date || popEnd;
  if (end && end > start) return { start, startSource, months: Math.max(1, monthsBetween(ym(start), ym(end)) + 1), termSource: 'dates', termText: `${start} to ${end}` };
  return { start, startSource, months: 12, termSource: 'assumed', termText: parsed.text };
}

// ---- The won deals, as the plan sees them.
const contractRows = () => db.prepare(`SELECT p.id AS program_id, p.ticket_id, p.name, p.organization, p.value, p.awarded_at, p.status, p.start_date, p.end_date, p.pop_end,
    t.opportunity_title, t.won_at, t.bd_director_id, t.custom_fields, t.territory_id, tr.name AS territory_name,
    c.start_date AS c_start, c.term_months AS c_term, c.approval, c.revenue_basis, c.excluded, c.notes AS c_notes
  FROM delivery_programs p JOIN tickets t ON t.id = p.ticket_id
  LEFT JOIN territories tr ON tr.id = t.territory_id LEFT JOIN comp_contracts c ON c.ticket_id = t.id
  WHERE ${inBooks()} AND p.held_at IS NULL AND t.deal_status = 'won' ORDER BY p.awarded_at, p.id`).all();

const billingRows = () => db.prepare("SELECT program_id, amount, entry_date FROM program_entries WHERE kind = 'billing'").all();

const rateFor = (rates, contractYear) => (contractYear === 1 ? rates.rate_y1 : contractYear === 2 ? rates.rate_y2 : contractYear === 3 ? rates.rate_y3 : 0) / 100;

/** The rate that applies to month `k` of a contract starting `startYm`, in the calendar year it falls in. */
const monthRate = (k, startYm, ratesFor, effectiveYm) => {
  const idx = monthsBetween(startYm, k);
  const contractYear = idx < 0 ? 1 : Math.floor(idx / 12) + 1;
  return { contractYear, rate: !effectiveYm || k >= effectiveYm ? rateFor(ratesFor(Number(k.slice(0, 4))), contractYear) : 0 };
};

/**
 * One contract's revenue and bonus, month by month over its term (and any billings outside it), given the rates to apply
 * in each calendar year (`ratesFor(year)`), the plan's effective month, and today. Each month carries the contract year
 * it falls in, the revenue recognized (billed), the revenue expected (billed or straight-line, per the contract's
 * basis), and the bonus on each. Months before the effective date earn nothing; an excluded or unapproved contract
 * earns nothing anywhere but still shows its revenue.
 */
function contractMonths(row, billings, ratesFor, effectiveYm, todayYm) {
  const override = { start_date: row.c_start, term_months: row.c_term };
  const term = termOf(row, override);
  const startYm = ym(term.start);
  const pays = !row.excluded && row.approval !== 'not_approved';
  const straight = (row.value || 0) / term.months;
  const basis = row.revenue_basis === 'billed' || row.revenue_basis === 'straight' ? row.revenue_basis : 'auto';
  const hasBillings = billings.length > 0;
  const byMonth = new Map();
  for (const b of billings) {
    const k = ym(b.entry_date);
    byMonth.set(k, (byMonth.get(k) || 0) + (b.amount || 0));
  }
  const keys = new Set([...Array.from({ length: term.months }, (_, i) => addMonths(startYm, i)), ...byMonth.keys()]);
  const months = [...keys].sort().map((k) => {
    const idx = monthsBetween(startYm, k);
    const inTerm = idx >= 0 && idx < term.months;
    const recognized = byMonth.get(k) || 0;
    let expected;
    if (basis === 'billed') expected = recognized;
    else if (basis === 'straight') expected = inTerm ? straight : 0;
    else expected = hasBillings && k <= todayYm ? recognized : inTerm ? straight : 0;
    const { contractYear, rate: r } = monthRate(k, startYm, ratesFor, effectiveYm);
    const rate = pays ? r : 0;
    return { month: k, year: Number(k.slice(0, 4)), half: Number(k.slice(5, 7)) <= 6 ? 1 : 2, contractYear, rate, recognized, expected, bonusRecognized: recognized * rate, bonusExpected: expected * rate };
  });
  return { term, basis, months };
}

/** The bonus a projected win of `amount`, starting `startYm` and spread over `termMonths`, pays month by month. */
function projectedMonths(amount, startYm, termMonths, ratesFor, effectiveYm) {
  const straight = amount / termMonths;
  return Array.from({ length: termMonths }, (_, i) => {
    const k = addMonths(startYm, i);
    const { rate } = monthRate(k, startYm, ratesFor, effectiveYm);
    return { month: k, year: Number(k.slice(0, 4)), half: Number(k.slice(5, 7)) <= 6 ? 1 : 2, revenue: straight, bonus: straight * rate };
  });
}

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const roll = (months) => ({
  recognized: sum(months, (m) => m.recognized), expected: sum(months, (m) => m.expected),
  bonusRecognized: sum(months, (m) => m.bonusRecognized), bonusExpected: sum(months, (m) => m.bonusExpected),
});
const rollProjected = (months) => ({ revenue: sum(months, (m) => m.revenue), bonus: sum(months, (m) => m.bonus) });

/** Everyone on the BD team (active), A–Z by last name. */
export const bdMembers = () => db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title FROM users u
  WHERE u.active = 1 AND u.id IN (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD')
  ORDER BY u.last_name, u.first_name`).all();

const planRows = (year) => db.prepare('SELECT * FROM comp_plans WHERE plan_year = ?').all(year);

/** A director's rates for a calendar year: their plan row's, else the plan's defaults. */
function ratesIn(plansByYear, userId, year, defaults) {
  const p = plansByYear.get(year)?.find((x) => x.user_id === userId);
  return { rate_y1: p?.rate_y1 ?? defaults.rate_y1, rate_y2: p?.rate_y2 ?? defaults.rate_y2, rate_y3: p?.rate_y3 ?? defaults.rate_y3 };
}

/**
 * The months of `year` still to come (this month included), and the open pipeline tickets that project into each: the
 * ones dated in the month, PWIN-weighted, plus (in this month) any dated earlier that are still open.
 */
function pipelineByMonth(year, todayYm, open) {
  const months = yearMonths(year).filter((k) => k >= todayYm);
  return months.map((k) => {
    const deals = open.filter((t) => (ym(t.projected_win_date) > todayYm ? ym(t.projected_win_date) : todayYm) === k)
      .map((t) => ({ id: t.id, title: t.opportunity_title, organization: t.organization, value: t.value || 0, pwin: t.pwin, weighted: (t.value || 0) * (t.pwin ?? 1),
        term_months: t.term_months, projected_win_date: t.projected_win_date, stage: t.pipeline_status }));
    const amount = sum(deals, (d) => d.weighted);
    // The month's term, for a projection of the director's own: the pipeline's weighted-average term, else a year.
    const term = amount ? Math.max(1, Math.round(sum(deals, (d) => d.weighted * d.term_months) / amount)) : 12;
    return { month: k, label: monthLabel(k), deals, amount, count: deals.length, term };
  });
}

/**
 * The compensation picture for a plan year: each director's wins, the bonus they've earned (on billed revenue) and can
 * expect (on the contract values), its two payouts, their base salary and goals, the three-year outlook from the
 * contracts they've won so far, closings by month, projected wins for the months to come and what those would pay, and
 * the team's totals. `scope` is a list of user ids to include, or null for everyone.
 */
export function compensation(year, scope = null) {
  const today = localToday();
  const todayYm = ym(today);
  const settings = planSettings();
  const effectiveYm = settings.effective_date ? ym(settings.effective_date) : null;
  const plans = new Map([year - 1, year, year + 1, year + 2].map((y) => [y, planRows(y)]));
  const rows = contractRows();
  const billings = billingRows();
  const members = bdMembers();
  const names = new Map(db.prepare('SELECT id, first_name, last_name, title, active FROM users').all().map((u) => [u.id, u]));
  // Open, dated pipeline tickets, with each deal's expected term (twelve months when the deal doesn't say).
  const terms = new Map(db.prepare("SELECT id, custom_fields FROM tickets WHERE ticket_type = 'bid' AND deal_status = 'open'").all().map((t) => [t.id, termFromFields(t.custom_fields).months || 12]));
  const open = bids().filter((t) => isOpen(t) && t.projected_win_date && !t.win_date_undetermined && Number(t.projected_win_date.slice(0, 4)) <= year)
    .map((t) => ({ ...t, term_months: terms.get(t.id) || 12 }));
  const overrides = db.prepare('SELECT user_id, month, amount FROM comp_projections WHERE month LIKE ?').all(`${year}-%`);

  // Who's on the page: BD members with a plan row for the year or a won deal, plus anyone with a won deal (whoever's team).
  const ids = new Set([...(plans.get(year) || []).map((p) => p.user_id), ...rows.map((r) => r.bd_director_id).filter(Boolean)]);
  const directors = [...ids].filter((id) => !scope || scope.includes(id)).map((id) => {
    const u = names.get(id) || { id, first_name: 'Unknown', last_name: '', title: null, active: 0 };
    const plan = plans.get(year)?.find((p) => p.user_id === id) || null;
    const rates = ratesIn(plans, id, year, settings);
    const ratesFor = (y) => ratesIn(plans, id, y, settings);
    const contracts = rows.filter((r) => r.bd_director_id === id).map((r) => {
      const mine = billings.filter((b) => b.program_id === r.program_id);
      const { term, basis, months } = contractMonths(r, mine, ratesFor, effectiveYm, todayYm);
      const inYear = months.filter((m) => m.year === year);
      // The contract's three (or fewer) paying years, each with its span, rate and money, plus the rest at 0%.
      const years = Array.from({ length: Math.ceil(term.months / 12) }, (_, i) => {
        const ms = months.filter((m) => m.contractYear === i + 1 && monthsBetween(ym(term.start), m.month) >= 0);
        const from = addMonths(ym(term.start), i * 12);
        const to = addMonths(ym(term.start), Math.min(term.months, (i + 1) * 12) - 1);
        return { contractYear: i + 1, from: ymStart(from), to: lastDay(to), rate: rateFor(ratesFor(Number(from.slice(0, 4))), i + 1), ...roll(ms) };
      });
      return {
        ticket_id: r.ticket_id, program_id: r.program_id, title: r.opportunity_title || r.name, organization: r.organization, territory: r.territory_name,
        value: r.value || 0, won_on: (r.won_at || r.awarded_at).slice(0, 10), status: r.status,
        start_date: term.start, start_source: term.startSource, term_months: term.months, term_source: term.termSource, term_text: term.termText,
        approval: r.approval || null, excluded: !!r.excluded, revenue_basis: r.revenue_basis || null, basis, notes: r.c_notes || null,
        billed: sum(mine, (b) => b.amount), billings: mine.length,
        contractYearNow: Math.max(1, monthsBetween(ym(term.start), todayYm) < 0 ? 1 : Math.floor(monthsBetween(ym(term.start), todayYm) / 12) + 1),
        inYear: roll(inYear), years, months,
      };
    });
    const months = contracts.flatMap((c) => c.months);
    const inYear = months.filter((m) => m.year === year);
    const h1 = roll(inYear.filter((m) => m.half === 1));
    const h2 = roll(inYear.filter((m) => m.half === 2));
    const yr = roll(inYear);
    // Closings: the deals won in each month of the year.
    const closings = yearMonths(year).map((k) => {
      const won = contracts.filter((c) => ym(c.won_on) === k);
      return { month: k, label: monthLabel(k), value: sum(won, (c) => c.value), count: won.length };
    });
    // Projections: the months to come, the pipeline that projects into each, the director's own number if they set one,
    // and what the month's projected wins would pay (this year and the two after).
    const pipeline = pipelineByMonth(year, todayYm, open.filter((t) => t.bd_director_id === id));
    const projections = pipeline.map((p) => {
      const own = overrides.find((o) => o.user_id === id && o.month === p.month);
      const amount = own ? own.amount : p.amount;
      const pays = own ? projectedMonths(amount, p.month, p.term, ratesFor, effectiveYm)
        : p.deals.flatMap((d) => projectedMonths(d.weighted, p.month, d.term_months, ratesFor, effectiveYm));
      return {
        ...p, system: p.amount, user: own ? own.amount : null, amount,
        bonus: { year: sum(pays.filter((m) => m.year === year), (m) => m.bonus), h1: sum(pays.filter((m) => m.year === year && m.half === 1), (m) => m.bonus), h2: sum(pays.filter((m) => m.year === year && m.half === 2), (m) => m.bonus) },
        pays,
      };
    });
    const projectedPays = projections.flatMap((p) => p.pays);
    const projected = {
      months: projections.map(({ pays, ...p }) => p),
      amount: sum(projections, (p) => p.amount), system: sum(projections, (p) => p.system), count: sum(projections, (p) => p.count),
      overridden: projections.filter((p) => p.user != null).length,
      bonus: { h1: sum(projections, (p) => p.bonus.h1), h2: sum(projections, (p) => p.bonus.h2), year: sum(projections, (p) => p.bonus.year) },
      outlook: [year, year + 1, year + 2].map((y) => ({ year: y, ...rollProjected(projectedPays.filter((m) => m.year === y)) })),
    };
    const eligible = plan ? !!plan.eligible : true;
    const base = plan?.base_salary ?? null;
    const outlook = [year, year + 1, year + 2].map((y) => ({ year: y, ...roll(months.filter((m) => m.year === y)) }));
    const wins = contracts.filter((c) => c.won_on.startsWith(String(year)));
    return {
      id, first_name: u.first_name, last_name: u.last_name, title: u.title, active: !!u.active, onBd: members.some((m) => m.id === id),
      plan: {
        exists: !!plan, base_salary: base, rate_y1: plan?.rate_y1 ?? null, rate_y2: plan?.rate_y2 ?? null, rate_y3: plan?.rate_y3 ?? null,
        revenue_goal: plan?.revenue_goal ?? null, bonus_goal: plan?.bonus_goal ?? null, eligible, notes: plan?.notes || null, effective: rates,
      },
      wins: { count: wins.length, value: sum(wins, (c) => c.value) },
      contracts,
      periods: { h1, h2, year: yr },
      // June pays the first half's bonus as an advance; December pays the year's bonus less June: the final numbers.
      payouts: {
        june: { label: `June ${year} payout`, note: 'Advance on the first half of the year', expected: h1.bonusExpected, recognized: h1.bonusRecognized, projected: projected.bonus.h1 },
        december: { label: `December ${year} payout`, note: 'The year trued up: the full year less what June paid. Final for the year.', expected: yr.bonusExpected - h1.bonusExpected, recognized: yr.bonusRecognized - h1.bonusRecognized, projected: projected.bonus.year - projected.bonus.h1 },
      },
      total: { expected: base != null ? base + (eligible ? yr.bonusExpected : 0) : null, recognized: base != null ? base + (eligible ? yr.bonusRecognized : 0) : null },
      goals: {
        revenue: plan?.revenue_goal ? { goal: plan.revenue_goal, recognized: yr.recognized, expected: yr.expected, projected: sum(projectedPays.filter((m) => m.year === year), (m) => m.revenue) } : null,
        bonus: plan?.bonus_goal ? { goal: plan.bonus_goal, recognized: yr.bonusRecognized, expected: yr.bonusExpected, projected: projected.bonus.year } : null,
      },
      outlook, closings, projected,
    };
  }).sort((a, b) => b.periods.year.bonusExpected - a.periods.year.bonusExpected || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));

  const futureMonths = yearMonths(year).filter((k) => k >= todayYm);
  const team = {
    directors: directors.length,
    contracts: sum(directors, (d) => d.contracts.length),
    wins: { count: sum(directors, (d) => d.wins.count), value: sum(directors, (d) => d.wins.value) },
    periods: {
      h1: roll(directors.map((d) => d.periods.h1)), h2: roll(directors.map((d) => d.periods.h2)), year: roll(directors.map((d) => d.periods.year)),
    },
    salaries: sum(directors, (d) => d.plan.base_salary), withSalary: directors.filter((d) => d.plan.base_salary != null).length,
    goals: { revenue: sum(directors, (d) => d.goals.revenue?.goal), bonus: sum(directors, (d) => d.goals.bonus?.goal) },
    outlook: [year, year + 1, year + 2].map((y, i) => ({ year: y, ...roll(directors.map((d) => d.outlook[i])), projectedBonus: sum(directors, (d) => d.projected.outlook[i].bonus) })),
    closings: yearMonths(year).map((k, i) => ({ month: k, label: monthLabel(k), value: sum(directors, (d) => d.closings[i].value), count: sum(directors, (d) => d.closings[i].count) })),
    projected: {
      months: futureMonths.map((k, i) => ({ month: k, label: monthLabel(k), amount: sum(directors, (d) => d.projected.months[i]?.amount), system: sum(directors, (d) => d.projected.months[i]?.system),
        count: sum(directors, (d) => d.projected.months[i]?.count), bonusYear: sum(directors, (d) => d.projected.months[i]?.bonus.year) })),
      amount: sum(directors, (d) => d.projected.amount), system: sum(directors, (d) => d.projected.system), count: sum(directors, (d) => d.projected.count),
      overridden: sum(directors, (d) => d.projected.overridden),
      bonus: { h1: sum(directors, (d) => d.projected.bonus.h1), h2: sum(directors, (d) => d.projected.bonus.h2), year: sum(directors, (d) => d.projected.bonus.year) },
    },
    unapproved: sum(directors, (d) => d.contracts.filter((c) => !c.approval && !c.excluded).length),
    assumedTerms: sum(directors, (d) => d.contracts.filter((c) => c.term_source === 'assumed' && !c.excluded).length),
  };
  return { year, today, settings, directors, team };
}

const num = (v) => (v === '' || v == null ? null : Number(v));

/** Set a director's plan inputs for a year (any of base_salary, rate_y1..3, revenue_goal, bonus_goal, eligible, notes). */
export function savePlan(userId, year, body, by) {
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw Object.assign(new Error('Person not found'), { status: 404 });
  const cur = db.prepare('SELECT * FROM comp_plans WHERE user_id = ? AND plan_year = ?').get(userId, year) || {};
  const next = { ...cur };
  for (const k of ['base_salary', 'revenue_goal', 'bonus_goal']) {
    if (k in body) {
      const n = num(body[k]);
      if (n != null && !(n >= 0)) throw Object.assign(new Error('Amounts are positive numbers'), { status: 400 });
      next[k] = n;
    }
  }
  for (const k of ['rate_y1', 'rate_y2', 'rate_y3']) {
    if (k in body) {
      const n = num(body[k]);
      if (n != null && !(n >= 0 && n <= 100)) throw Object.assign(new Error('Rates are percents from 0 to 100'), { status: 400 });
      next[k] = n;
    }
  }
  if ('eligible' in body) next.eligible = body.eligible ? 1 : 0;
  if ('notes' in body) next.notes = String(body.notes || '').trim() || null;
  db.prepare(`INSERT INTO comp_plans (user_id, plan_year, base_salary, rate_y1, rate_y2, rate_y3, revenue_goal, bonus_goal, eligible, notes, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, plan_year) DO UPDATE SET base_salary = excluded.base_salary, rate_y1 = excluded.rate_y1, rate_y2 = excluded.rate_y2,
      rate_y3 = excluded.rate_y3, revenue_goal = excluded.revenue_goal, bonus_goal = excluded.bonus_goal, eligible = excluded.eligible,
      notes = excluded.notes, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(userId, year, next.base_salary ?? null, next.rate_y1 ?? null, next.rate_y2 ?? null, next.rate_y3 ?? null,
      next.revenue_goal ?? null, next.bonus_goal ?? null, next.eligible ?? 1, next.notes ?? null, by);
}

export const deletePlan = (userId, year) => db.prepare('DELETE FROM comp_plans WHERE user_id = ? AND plan_year = ?').run(userId, year).changes > 0;

/** Set what the plan knows about a won deal: start_date, term_months, approval, revenue_basis, excluded, notes. */
export function saveContract(ticketId, body, by) {
  if (!db.prepare("SELECT 1 FROM tickets WHERE id = ? AND deal_status = 'won'").get(ticketId)) throw Object.assign(new Error('Won deal not found'), { status: 404 });
  const cur = db.prepare('SELECT * FROM comp_contracts WHERE ticket_id = ?').get(ticketId) || {};
  const next = { ...cur };
  if ('start_date' in body) {
    const d = body.start_date || null;
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw Object.assign(new Error('The start date is a date (YYYY-MM-DD)'), { status: 400 });
    next.start_date = d;
  }
  if ('term_months' in body) {
    const n = num(body.term_months);
    if (n != null && !(Number.isInteger(n) && n >= 1 && n <= 240)) throw Object.assign(new Error('The term is a whole number of months, 1 to 240'), { status: 400 });
    next.term_months = n;
  }
  if ('approval' in body) {
    if (body.approval && !['approved', 'not_approved'].includes(body.approval)) throw Object.assign(new Error('Approval is approved, not_approved or blank'), { status: 400 });
    next.approval = body.approval || null;
  }
  if ('revenue_basis' in body) {
    if (body.revenue_basis && !['billed', 'straight'].includes(body.revenue_basis)) throw Object.assign(new Error('Revenue basis is billed, straight or blank (auto)'), { status: 400 });
    next.revenue_basis = body.revenue_basis || null;
  }
  if ('excluded' in body) next.excluded = body.excluded ? 1 : 0;
  if ('notes' in body) next.notes = String(body.notes || '').trim() || null;
  db.prepare(`INSERT INTO comp_contracts (ticket_id, start_date, term_months, approval, revenue_basis, excluded, notes, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (ticket_id) DO UPDATE SET start_date = excluded.start_date, term_months = excluded.term_months, approval = excluded.approval,
      revenue_basis = excluded.revenue_basis, excluded = excluded.excluded, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(ticketId, next.start_date ?? null, next.term_months ?? null, next.approval ?? null, next.revenue_basis ?? null, next.excluded ?? 0, next.notes ?? null, by);
}

/** A director's own projection for a month (YYYY-MM): set it, or clear it (null amount) to go back to the system's. */
export function saveProjection(userId, month, amount, by) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw Object.assign(new Error('The month is YYYY-MM'), { status: 400 });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw Object.assign(new Error('Person not found'), { status: 404 });
  const n = num(amount);
  if (n == null) { db.prepare('DELETE FROM comp_projections WHERE user_id = ? AND month = ?').run(userId, month); return; }
  if (!(n >= 0)) throw Object.assign(new Error('A projection is a positive amount'), { status: 400 });
  db.prepare(`INSERT INTO comp_projections (user_id, month, amount, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, month) DO UPDATE SET amount = excluded.amount, updated_by = excluded.updated_by, updated_at = datetime('now')`).run(userId, month, n, by);
}

/** Back to the system's projections for every month of a year. */
export const resetProjections = (userId, year) => db.prepare('DELETE FROM comp_projections WHERE user_id = ? AND month LIKE ?').run(userId, `${year}-%`).changes;
