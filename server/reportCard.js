// The BD report card: are BD directors performing and winning? Seven measures for one director (or the whole team)
// over a quarter or a year. Each has a value, a plain-language detail, and a status: good, watch, or behind
// (or "none" when there isn't enough to judge). Thresholds are below so they're easy to tune.
import { db } from './db.js';
import { bids, contracts, targets, quarterRange, localToday, QUALIFIED_STAGES, OPEN_STAGES } from './financials.js';
import { quarterFor } from '../src/lib/travelCalc.js';

export const THRESHOLDS = {
  coverage: { good: 3, watch: 2 }, // qualified pipeline ÷ remaining target
  winRate: { good: 0.4, watch: 0.25 }, // by count
  stalledDays: 45, // an open bid with no stage change for this long is stalled
  forecast: { good: 0.15, watch: 0.3 }, // |actual − forecast| ÷ forecast
  objectives: { good: 0.7, watch: 0.5 }, // achieved ÷ (achieved + missed + overdue)
};
const DAY = 864e5;

/** A period: { kind: 'quarter' | 'year', label: '2026 Q4' | '2026', start, end }, plus how much of it has passed. */
export function period(kind = 'quarter', label) {
  const today = localToday();
  const p = kind === 'year'
    ? { kind, label: label || today.slice(0, 4), start: `${label || today.slice(0, 4)}-01-01`, end: `${label || today.slice(0, 4)}-12-31` }
    : { kind: 'quarter', label: label || quarterFor(today), ...quarterRange(label || quarterFor(today)) };
  const total = (Date.parse(p.end) - Date.parse(p.start)) / DAY + 1;
  const passed = Math.min(total, Math.max(0, (Date.parse(today) - Date.parse(p.start)) / DAY + 1));
  return { ...p, elapsed: passed / total, done: today > p.end, future: today < p.start };
}

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const status = (v, { good, watch }, higherIsBetter = true) => {
  if (v == null || Number.isNaN(v)) return 'none';
  return higherIsBetter ? (v >= good ? 'good' : v >= watch ? 'watch' : 'behind') : (v <= good ? 'good' : v <= watch ? 'watch' : 'behind');
};

/** Each bid's stage history, oldest first. */
function histories(ids) {
  const rows = db.prepare(`SELECT ticket_id, pipeline_status, value, changed_at FROM ticket_history
    WHERE ticket_id IN (SELECT value FROM json_each(?)) ORDER BY ticket_id, changed_at, id`).all(JSON.stringify(ids));
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.ticket_id)) map.set(r.ticket_id, []); map.get(r.ticket_id).push(r); });
  return map;
}
const rank = (s) => ['Identified', 'Qualified', 'Capture', 'Proposal', 'Submitted', 'Awarded'].indexOf(s);

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
  /** A bid's state at the end of `date`, from its history. */
  const stateOn = (t, date) => {
    let state = null;
    for (const r of hist.get(t.id) || []) { if (r.changed_at.slice(0, 10) <= date) state = r; else break; }
    return state;
  };

  // 1. Bookings against target. During the period, judged against pace (the share of the period that has passed).
  const booked = sum(deals.filter((d) => within(d.awarded_on)), (d) => d.value);
  const t = targets(Number(p.label.slice(0, 4)), director);
  const target = p.kind === 'year' ? t.total : t.quarters[Number(p.label.slice(-1)) - 1];
  const attainment = target ? booked / target : null;
  const pace = p.done ? 1 : Math.max(p.elapsed, 0.05);
  const bookings = {
    key: 'bookings', title: 'Bookings against target', question: 'Are we delivering?',
    value: attainment, format: 'percent', amount: booked, target,
    detail: target ? `$${fmt(booked)} booked of a $${fmt(target)} target${p.done ? '' : ` · ${Math.round(p.elapsed * 100)}% of the ${p.kind} has passed`}` : `$${fmt(booked)} booked · no target set`,
    status: target ? status(attainment / pace, { good: 1, watch: 0.75 }) : 'none',
  };

  // 2. New qualified pipeline: bids that first reached Qualified (or later) during the period.
  const entered = list.filter((tk) => {
    const rows = hist.get(tk.id) || [];
    const first = rows.find((r) => QUALIFIED_STAGES.includes(r.pipeline_status) || r.pipeline_status === 'Awarded');
    return first && within(first.changed_at);
  });
  const newQualified = {
    key: 'newQualified', title: 'New qualified pipeline', question: 'Are we creating future growth opportunities?',
    value: sum(entered, (tk) => tk.value), format: 'money', count: entered.length,
    detail: `${entered.length} bid${entered.length === 1 ? '' : 's'} reached Qualified or later this ${p.kind}`,
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

  // 4. Win rate: decisions in the period (No Bid isn't a decision on the merits, so it's left out).
  const decided = list.filter((tk) => ['Awarded', 'Lost'].includes(tk.pipeline_status) && within(closedOn(tk)));
  const won = decided.filter((tk) => tk.pipeline_status === 'Awarded');
  const winRate = {
    key: 'winRate', title: 'Win rate', question: 'Are we pursuing and winning the right work?',
    value: decided.length ? won.length / decided.length : null, format: 'percent',
    valueRate: sum(decided, (tk) => tk.value) ? sum(won, (tk) => tk.value) / sum(decided, (tk) => tk.value) : null,
    detail: decided.length ? `${won.length} won of ${decided.length} decided · $${fmt(sum(won, (tk) => tk.value))} of $${fmt(sum(decided, (tk) => tk.value))} by value` : `No bids won or lost this ${p.kind}`,
    status: status(decided.length ? won.length / decided.length : null, THRESHOLDS.winRate),
  };

  // 5. Pursuit progression: bids that moved forward a stage in the period, and open bids that have stalled.
  const open = list.filter((tk) => OPEN_STAGES.includes(tk.pipeline_status));
  const advanced = list.filter((tk) => {
    const rows = hist.get(tk.id) || [];
    return rows.some((r, i) => i > 0 && within(r.changed_at) && rank(r.pipeline_status) > rank(rows[i - 1].pipeline_status));
  });
  const stalled = open.map((tk) => {
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
    value: advanced.length, format: 'count', stalled,
    detail: `${advanced.length} bid${advanced.length === 1 ? '' : 's'} moved forward a stage · ${stalled.length} of ${open.length} open stalled (${THRESHOLDS.stalledDays}+ days without a stage change, or past their win date)`,
    status: !open.length ? 'none' : status(1 - stalled.length / open.length, { good: 0.8, watch: 0.6 }),
  };

  // 6. Forecast reliability: actual bookings against the forecast taken at the start of each quarter in the period.
  const qs = p.kind === 'year' ? [1, 2, 3, 4].map((q) => `${p.label} Q${q}`) : [p.label];
  const snaps = db.prepare('SELECT * FROM forecast_snapshots WHERE quarter IN (SELECT value FROM json_each(?))').all(JSON.stringify(qs))
    .filter((s) => !director || s.bd_director_id === director);
  const forecastQs = [...new Set(snaps.map((s) => s.quarter))].filter((q) => today > quarterRange(q).end); // finished quarters only
  const forecast = sum(snaps.filter((s) => forecastQs.includes(s.quarter)), (s) => s.weighted);
  const actual = sum(deals.filter((d) => forecastQs.some((q) => d.awarded_on >= quarterRange(q).start && d.awarded_on <= quarterRange(q).end)), (d) => d.value);
  const reliability = forecast ? actual / forecast : null;
  const inProgress = snaps.filter((s) => !forecastQs.includes(s.quarter));
  const forecastCard = {
    key: 'forecast', title: 'Forecast reliability', question: 'Can leadership rely on our outlook?',
    value: reliability, format: 'percent',
    detail: forecastQs.length ? `$${fmt(actual)} booked against a $${fmt(forecast)} forecast (${forecastQs.join(', ')})`
      : inProgress.length ? `This ${p.kind}'s forecast: $${fmt(sum(inProgress, (s) => s.weighted))}, judged when the quarter ends` : 'No forecast was captured for this period',
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
    detail: `${achieved} achieved, ${missed} missed of ${due.length} due this ${p.kind} · ${openObjectives} open${overdueObjectives ? `, ${overdueObjectives} overdue` : ''}`,
    status: judged ? status(achieved / judged, THRESHOLDS.objectives) : openObjectives ? 'watch' : 'none',
  };

  return { period: p, measures: [bookings, newQualified, coverage, winRate, progression, forecastCard, accounts] };
}

/** Everyone who directs BD work: the BD team, plus anyone named director on a bid. */
export function directors() {
  return db.prepare(`SELECT DISTINCT u.id, u.first_name, u.last_name, u.title FROM users u
    WHERE u.active = 1 AND (u.id IN (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD')
      OR u.id IN (SELECT bd_director_id FROM tickets WHERE bd_director_id IS NOT NULL))
    ORDER BY u.last_name, u.first_name`).all();
}

/** $1.2M, $850K. */
function fmt(n) {
  const a = Math.abs(n || 0);
  return a >= 1e6 ? `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n || 0)}`;
}
