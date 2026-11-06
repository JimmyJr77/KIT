// The BD report card: are BD directors performing and winning? Seven measures for one director (or the whole team)
// over a quarter or a year. Each has a value, a plain-language detail, and a status: good, watch, or behind
// (or "none" when there isn't enough to judge). Thresholds are below so they're easy to tune.
import { db } from './db.js';
import { bids, contracts, forecastLines, targets, quartersTarget, trailingQuarters, quarterRange, localToday, QUALIFIED_STAGES, OPEN_STAGES, isOpen, isWon } from './financials.js';
import { quarterFor, addDays } from '../src/lib/travelCalc.js';

export const THRESHOLDS = {
  coverage: { good: 3, watch: 2 }, // qualified pipeline ÷ remaining target
  winRate: { good: 0.4, watch: 0.25 }, // by count
  stalledDays: 45, // an open pipeline ticket with no stage change for this long is stalled
  forecast: { good: 0.15, watch: 0.3 }, // |actual − forecast| ÷ forecast
  objectives: { good: 0.7, watch: 0.5 }, // achieved ÷ (achieved + missed + overdue)
};
const DAY = 864e5;

/**
 * A period: { kind: 'quarter' | 'year' | 't4q' | 'last12', label: '2026 Q4' | '2026' | '2025 Q4 – 2026 Q3' | 'Last 12 months',
 * start, end, quarters }, plus how much of it has passed. A 't4q' (trailing four quarters) is the four finished quarters
 * before the quarter containing `label` (an ISO date, default today), or `back` sets of four before those. A 'last12' is
 * the 365 days through today: it cuts across quarters, so `shares` says how much of each falls inside it (for the target),
 * and `quarters` leaves out the part-quarter at its start (a forecast is for a whole quarter).
 */
export function period(kind = 'quarter', label, back = 0) {
  const today = localToday();
  let p;
  if (kind === 'last12') {
    const start = addDays(today, -364);
    const span = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY + 1;
    const shares = [];
    for (let q = quarterFor(start); ;) {
      const r = quarterRange(q);
      const from = r.start > start ? r.start : start;
      const to = r.end < today ? r.end : today;
      shares.push({ quarter: q, share: span(from, to) / span(r.start, r.end), partStart: r.start < start });
      if (r.end >= today) break;
      q = quarterFor(addDays(r.end, 1));
    }
    p = { kind, noun: 'period', label: 'Last 12 months', start, end: today, shares: shares.map(({ quarter, share }) => ({ quarter, share })), quarters: shares.filter((s) => !s.partStart).map((s) => s.quarter) };
  } else if (kind === 't4q') {
    const t = trailingQuarters(back, label || today);
    p = { kind, noun: 'period', ...t };
  } else if (kind === 'year') {
    const y = label || today.slice(0, 4);
    p = { kind, noun: 'year', label: y, start: `${y}-01-01`, end: `${y}-12-31`, quarters: [1, 2, 3, 4].map((q) => `${y} Q${q}`) };
  } else {
    const q = label || quarterFor(today);
    p = { kind: 'quarter', noun: 'quarter', label: q, ...quarterRange(q), quarters: [q] };
  }
  const total = (Date.parse(p.end) - Date.parse(p.start)) / DAY + 1;
  const passed = Math.min(total, Math.max(0, (Date.parse(today) - Date.parse(p.start)) / DAY + 1));
  return { ...p, elapsed: passed / total, done: today > p.end, future: today < p.start };
}

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const status = (v, { good, watch }, higherIsBetter = true) => {
  if (v == null || Number.isNaN(v)) return 'none';
  return higherIsBetter ? (v >= good ? 'good' : v >= watch ? 'watch' : 'behind') : (v <= good ? 'good' : v <= watch ? 'watch' : 'behind');
};

/** Each pipeline ticket's stage history, oldest first. */
function histories(ids) {
  const rows = db.prepare(`SELECT ticket_id, pipeline_status, value, changed_at FROM ticket_history
    WHERE ticket_id IN (SELECT value FROM json_each(?)) ORDER BY ticket_id, changed_at, id`).all(JSON.stringify(ids));
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.ticket_id)) map.set(r.ticket_id, []); map.get(r.ticket_id).push(r); });
  return map;
}
// Stalled pursuits are tracked from Qualified through Under Evaluation: prospecting is too early to judge, and awarded is done.
export const STALL_STAGES = ['Qualified', 'Capture', 'Proposal', 'Under Evaluation'];
const rank = (s) => ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation', 'Awarded'].indexOf(s);

/** The report card for one director (`director` = user id) or the whole team (null), over period `p`. */
export function reportCard(director, p) {
  const today = localToday();
  const f = { director, territory: null };
  const list = bids(f);
  const deals = contracts(f);
  const hist = histories(list.map((t) => t.id));
  const within = (d) => d && d.slice(0, 10) >= p.start && d.slice(0, 10) <= p.end;
  // A win is dated by its contract's award date (what bookings use); other closes by when the ticket closed.
  const awardedOn = new Map(deals.filter((d) => d.ticket_id).map((d) => [d.ticket_id, d.awarded_on]));
  const closedOn = (t) => awardedOn.get(t.id) || (t.done_at || '').slice(0, 10) || ((hist.get(t.id) || []).at(-1)?.changed_at || '').slice(0, 10);
  /** A pipeline ticket's state at the end of `date`, from its history. */
  const stateOn = (t, date) => {
    let state = null;
    for (const r of hist.get(t.id) || []) { if (r.changed_at.slice(0, 10) <= date) state = r; else break; }
    return state;
  };

  // 1. Bookings against target. During the period, judged against pace (the share of the period that has passed).
  const booked = sum(deals.filter((d) => within(d.awarded_on)), (d) => d.value);
  const target = p.kind === 'year' ? targets(Number(p.label), director).total
    : p.shares ? sum(p.shares, (s) => quartersTarget([s.quarter], director) * s.share) : quartersTarget(p.quarters, director);
  const attainment = target ? booked / target : null;
  const pace = p.done ? 1 : Math.max(p.elapsed, 0.05);
  const bookings = {
    key: 'bookings', title: 'Bookings against target', question: 'Are we delivering?',
    value: attainment, format: 'percent', amount: booked, target,
    detail: target ? `$${fmt(booked)} booked of a $${fmt(target)} target${p.done ? '' : ` · ${Math.round(p.elapsed * 100)}% of the ${p.noun} has passed`}` : `$${fmt(booked)} booked · no target set`,
    status: target ? status(attainment / pace, { good: 1, watch: 0.75 }) : 'none',
  };

  // 2. New qualified pipeline: pipeline tickets that first reached Qualified (or later) during the period.
  const entered = list.filter((tk) => {
    const rows = hist.get(tk.id) || [];
    const first = rows.find((r) => QUALIFIED_STAGES.includes(r.pipeline_status) || r.pipeline_status === 'Awarded');
    return first && within(first.changed_at);
  });
  const newQualified = {
    key: 'newQualified', title: 'New qualified pipeline', question: 'Are we creating future growth opportunities?',
    value: sum(entered, (tk) => tk.value), format: 'money', count: entered.length,
    detail: `${entered.length} pipeline ticket${entered.length === 1 ? '' : 's'} reached Qualified or later this ${p.noun}`,
    // Judged against the target too: a period's new qualified pipeline should be at least the period's target.
    status: target ? status(sum(entered, (tk) => tk.value) / (target * pace), { good: 1, watch: 0.5 }) : entered.length ? 'good' : 'none',
  };

  // 3. Pipeline coverage: qualified pipeline ÷ what's left of the target. During the period, today's pipeline against
  // what's still to book; for a finished period, the pipeline as it stood when the period began against the whole target.
  const asOf = p.done ? p.start : today;
  const qualifiedValue = sum(list, (tk) => {
    const st = p.done ? stateOn(tk, p.start) : tk;
    return st && QUALIFIED_STAGES.includes(st.pipeline_status) ? st.value : 0;
  });
  const remaining = target ? (p.done ? target : Math.max(target - booked, 0)) : null;
  const coverageRatio = remaining ? qualifiedValue / remaining : null;
  const coverage = {
    key: 'coverage', title: 'Pipeline coverage', question: 'Do we have enough opportunity to achieve our goal?',
    value: coverageRatio, format: 'ratio', display: target && remaining === 0 ? 'Met' : undefined,
    detail: !target ? `$${fmt(qualifiedValue)} qualified · no target set` : remaining === 0 ? `Target met · $${fmt(qualifiedValue)} qualified pipeline`
      : p.done ? `$${fmt(qualifiedValue)} qualified on ${asOf} ÷ the $${fmt(remaining)} target · aim for ${THRESHOLDS.coverage.good}×`
      : `$${fmt(qualifiedValue)} qualified ÷ $${fmt(remaining)} still to book · aim for ${THRESHOLDS.coverage.good}×`,
    status: target && remaining === 0 ? 'good' : status(coverageRatio, THRESHOLDS.coverage),
  };

  // 4. Win rate: pipeline tickets won or lost in the period.
  const decided = list.filter((tk) => !isOpen(tk) && within(closedOn(tk)));
  const won = decided.filter(isWon);
  const winRate = {
    key: 'winRate', title: 'Win rate', question: 'Are we pursuing and winning the right work?',
    value: decided.length ? won.length / decided.length : null, format: 'percent',
    valueRate: sum(decided, (tk) => tk.value) ? sum(won, (tk) => tk.value) / sum(decided, (tk) => tk.value) : null,
    detail: decided.length ? `${won.length} won of ${decided.length} decided · $${fmt(sum(won, (tk) => tk.value))} of $${fmt(sum(decided, (tk) => tk.value))} by value` : `No pipeline tickets won or lost this ${p.noun}`,
    status: status(decided.length ? won.length / decided.length : null, THRESHOLDS.winRate),
  };

  // 5. Pursuit progression: pipeline tickets that moved forward a stage in the period, and open pipeline tickets that have stalled.
  const open = list.filter((tk) => isOpen(tk) && OPEN_STAGES.includes(tk.pipeline_status));
  const advanced = list.filter((tk) => {
    const rows = hist.get(tk.id) || [];
    return rows.some((r, i) => i > 0 && within(r.changed_at) && rank(r.pipeline_status) > rank(rows[i - 1].pipeline_status));
  });
  const stalled = open.filter((tk) => STALL_STAGES.includes(tk.pipeline_status)).map((tk) => {
    const rows = hist.get(tk.id) || [];
    // The last time its stage changed.
    let last = rows[0]?.changed_at || tk.created_at;
    rows.forEach((r, i) => { if (i > 0 && r.pipeline_status !== rows[i - 1].pipeline_status) last = r.changed_at; });
    const days = Math.floor((Date.parse(today) - Date.parse(last.slice(0, 10))) / DAY);
    const overdue = tk.projected_win_date && tk.projected_win_date < today;
    return { id: tk.id, title: tk.opportunity_title, stage: tk.pipeline_status, value: tk.value, director: tk.director_name, days, overdue };
  }).filter((x) => x.days >= THRESHOLDS.stalledDays || x.overdue).sort((a, b) => b.days - a.days);
  const progression = {
    key: 'progression', title: 'Pursuit progression', question: 'Are we improving our position to win?',
    value: advanced.length, format: 'count', stalled, stalledStages: STALL_STAGES,
    detail: `${advanced.length} pipeline ticket${advanced.length === 1 ? '' : 's'} moved forward a stage · ${stalled.length} qualified-to-evaluation stalled (${THRESHOLDS.stalledDays}+ days without a stage change, or past their win date)`,
    status: !open.length ? 'none' : status(1 - stalled.length / open.length, { good: 0.8, watch: 0.6 }),
  };

  // 6. Forecast reliability: actual bookings against the forecast taken at the start of each quarter in the period.
  const qs = p.quarters;
  const snaps = forecastLines(qs).filter((s) => !director || s.bd_director_id === director);
  const forecastQs = [...new Set(snaps.map((s) => s.quarter))].filter((q) => today > quarterRange(q).end); // finished quarters only
  const forecast = sum(snaps.filter((s) => forecastQs.includes(s.quarter)), (s) => s.weighted);
  const actual = sum(deals.filter((d) => forecastQs.some((q) => d.awarded_on >= quarterRange(q).start && d.awarded_on <= quarterRange(q).end)), (d) => d.value);
  const reliability = forecast ? actual / forecast : null;
  const inProgress = snaps.filter((s) => !forecastQs.includes(s.quarter));
  const forecastCard = {
    key: 'forecast', title: 'Forecast reliability', question: 'Can leadership rely on our outlook?',
    value: reliability, format: 'percent',
    detail: forecastQs.length ? `$${fmt(actual)} booked against a $${fmt(forecast)} forecast (${forecastQs.join(', ')})`
      : inProgress.length ? `This ${p.noun}'s forecast: $${fmt(sum(inProgress, (s) => s.weighted))}, judged when the quarter ends` : 'No forecast was captured for this period',
    status: reliability == null ? 'none' : status(Math.abs(reliability - 1), THRESHOLDS.forecast, false),
  };

  // 7. Account development: objectives due in the period, achieved vs. missed or overdue.
  const objectives = db.prepare('SELECT * FROM account_objectives').all().filter((o) => !director || o.owner_id === director);
  const due = objectives.filter((o) => within(o.target_date) || (o.completed_at && within(o.completed_at)));
  const achieved = due.filter((o) => o.status === 'Achieved').length;
  const missed = due.filter((o) => o.status === 'Missed').length;
  const overdueObjectives = objectives.filter((o) => o.target_date && o.target_date < today && !['Achieved', 'Missed'].includes(o.status)).length;
  const judged = achieved + missed + due.filter((o) => o.target_date < today && !['Achieved', 'Missed'].includes(o.status)).length;
  const openObjectives = objectives.filter((o) => !['Achieved', 'Missed'].includes(o.status)).length;
  const accounts = {
    key: 'accounts', title: 'Account development', question: 'Are we building access and shaping future demand?',
    value: judged ? achieved / judged : null, format: 'percent',
    detail: `${achieved} achieved, ${missed} missed of ${due.length} due this ${p.noun} · ${openObjectives} open${overdueObjectives ? `, ${overdueObjectives} overdue` : ''}`,
    status: judged ? status(achieved / judged, THRESHOLDS.objectives) : openObjectives ? 'watch' : 'none',
  };

  return { period: p, measures: [bookings, newQualified, coverage, winRate, progression, forecastCard, accounts] };
}

/**
 * The BD directors with a card of their own: active members of the BD team. Pipeline tickets directed by anyone else still count
 * toward the team's card.
 */
export function directors() {
  return db.prepare(`SELECT DISTINCT u.id, u.first_name, u.last_name, u.title FROM users u
    WHERE u.active = 1 AND u.id IN (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD')
    ORDER BY u.last_name, u.first_name`).all();
}

/** $1.2M, $850K. */
function fmt(n) {
  const a = Math.abs(n || 0);
  return a >= 1e6 ? `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n || 0)}`;
}

/**
 * Change over time: the report card's seven measures week by week, for the team and each BD director. Each week's
 * point is the trailing 13 weeks (a rolling quarter) ending that week, except pipeline coverage, which is the qualified
 * pipeline as it stood that week against that quarter's target, and forecast reliability, which is the latest quarter
 * finished by then. `weeks` is how far back the timeline goes. With `director`, that director's line plus the team's
 * high, low and median among directors; without, the team's line.
 */
export function reportTrends({ weeks = 13, director = null } = {}) {
  const today = localToday();
  const day = (d, n) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10);
  const ends = Array.from({ length: weeks }, (_, i) => day(today, -7 * (weeks - 1 - i)));
  const all = bids({});
  const allDeals = contracts({});
  const hist = histories(all.map((t) => t.id));
  const awardedOn = new Map(allDeals.filter((d) => d.ticket_id).map((d) => [d.ticket_id, d.awarded_on]));
  const closedOn = (t) => awardedOn.get(t.id) || (t.done_at || '').slice(0, 10) || ((hist.get(t.id) || []).at(-1)?.changed_at || '').slice(0, 10);
  const stateOn = (t, date) => {
    let state = null;
    for (const r of hist.get(t.id) || []) { if (r.changed_at.slice(0, 10) <= date) state = r; else break; }
    return state;
  };
  const firstQualified = new Map(all.map((t) => [t.id, (hist.get(t.id) || []).find((r) => QUALIFIED_STAGES.includes(r.pipeline_status) || r.pipeline_status === 'Awarded')?.changed_at?.slice(0, 10)]));
  const advances = new Map(all.map((t) => {
    const rows = hist.get(t.id) || [];
    return [t.id, rows.filter((r, i) => i > 0 && rank(r.pipeline_status) > rank(rows[i - 1].pipeline_status)).map((r) => r.changed_at.slice(0, 10))];
  }));
  const targetCache = new Map();
  const quarterTarget = (date, who) => {
    const k = `${quarterFor(date)}|${who}`;
    if (!targetCache.has(k)) targetCache.set(k, targets(Number(date.slice(0, 4)), who).quarters[Number(quarterFor(date).slice(-1)) - 1] || null);
    return targetCache.get(k);
  };
  const snaps = forecastLines();
  const objectives = db.prepare('SELECT * FROM account_objectives').all();
  const done = (o) => ['Achieved', 'Missed'].includes(o.status);

  /** One scope's seven series (`who` = user id, or null for the team). */
  function series(who) {
    const list = who ? all.filter((t) => t.bd_director_id === who) : all;
    const deals = who ? allDeals.filter((d) => d.bd_director_id === who) : allDeals;
    const objs = who ? objectives.filter((o) => o.owner_id === who) : objectives;
    const out = { bookings: [], newQualified: [], coverage: [], winRate: [], progression: [], forecast: [], accounts: [] };
    for (const end of ends) {
      const start = day(end, -90);
      const within = (d) => d && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
      const target = quarterTarget(end, who);
      const booked = sum(deals.filter((d) => within(d.awarded_on)), (d) => d.value);
      out.bookings.push(target ? booked / target : null);
      out.newQualified.push(sum(list.filter((t) => within(firstQualified.get(t.id))), (t) => t.value));
      const pipeline = sum(list, (t) => { const st = stateOn(t, end); return st && QUALIFIED_STAGES.includes(st.pipeline_status) ? st.value : 0; });
      out.coverage.push(target ? pipeline / target : null);
      const decided = list.filter((t) => !isOpen(t) && within(closedOn(t)));
      out.winRate.push(decided.length ? decided.filter(isWon).length / decided.length : null);
      out.progression.push(list.reduce((n, t) => n + advances.get(t.id).filter(within).length, 0));
      // The latest quarter finished by this week that has a forecast.
      const q = [...new Set(snaps.map((s) => s.quarter))].filter((x) => quarterRange(x).end < end).sort().at(-1);
      const fc = q ? sum(snaps.filter((s) => s.quarter === q && (!who || s.bd_director_id === who)), (s) => s.weighted) : 0;
      const { start: qs, end: qe } = q ? quarterRange(q) : {};
      out.forecast.push(fc ? sum(deals.filter((d) => d.awarded_on >= qs && d.awarded_on <= qe), (d) => d.value) / fc : null);
      const due = objs.filter((o) => within(o.target_date) || (o.completed_at && within(o.completed_at)));
      const judged = due.filter((o) => done(o) || o.target_date <= end).length;
      out.accounts.push(judged ? due.filter((o) => o.status === 'Achieved').length / judged : null);
    }
    return out;
  }

  const team = series(null);
  const meta = reportCard(director, period('quarter')).measures.map(({ key, title, question, format }) => ({ key, title, question, format }));
  if (!director) return { weeks: ends, measures: meta.map((m) => ({ ...m, values: team[m.key] })) };

  const mine = series(director);
  const others = directors().map((d) => series(d.id));
  const median = (xs) => {
    const s = xs.filter((v) => v != null).sort((a, b) => a - b);
    if (!s.length) return null;
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const across = (key, f) => ends.map((_, i) => {
    const xs = others.map((o) => o[key][i]).filter((v) => v != null);
    return xs.length ? f(xs) : null;
  });
  return {
    weeks: ends,
    measures: meta.map((m) => ({
      ...m, values: mine[m.key],
      high: across(m.key, (xs) => Math.max(...xs)), low: across(m.key, (xs) => Math.min(...xs)), median: across(m.key, median),
    })),
  };
}
