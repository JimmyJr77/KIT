// BD financial figures, shared by the dashboards, the BD report card and the reports. All money is in dollars.
//   Pipeline: open pipeline tickets, by stage. Qualified pipeline: open pipeline tickets from Qualified onward.
//   Projected bookings: each open pipeline ticket's value × its PWIN, by the quarter of its projected win date. Pipeline tickets without a PWIN
//     count at full value and are reported apart, so it's clear how much of the forecast is PWIN-adjusted.
//   Bookings: contracts won (delivery programs), on the day they were awarded.
//   Backlog: what's left to bill on active contracts, split into funded (funded − billed) and unfunded (value − funded).
//   Book-to-bill: bookings ÷ revenue billed over the same period.
import { db, json } from './db.js';
import { pwin } from '../src/lib/assessment.js';
import { quarterFor, addDays } from '../src/lib/travelCalc.js';
import { pwinModel } from './routes/tickets.js';
import { quarterRange } from './forecast.js';

export { quarterRange };

export const OPEN_STAGES = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation'];
export const QUALIFIED_STAGES = ['Qualified', 'Capture', 'Proposal', 'Under Evaluation'];
export const CLOSED_STAGES = ['Awarded', 'Lost'];
export const localToday = () => new Date().toLocaleDateString('en-CA');
/**
 * Whether a ticket is still in the books. Archiving a ticket (by hand or with Archive all) takes it out of every figure,
 * past and present, until it's restored; deleting it takes its contract and forecast lines with it. A closed ticket that
 * simply aged off the board after 14 days stays in: it has no archived_at, and its win or loss still happened.
 */
export const inBooks = (t = 't') => `${t}.archived_at IS NULL AND ${t}.archive_set_id IS NULL`;

/** `count` quarters starting `offset` quarters from the one containing `date` ("2026 Q4", …). */
export function quarters(count, offset = 0, date = localToday()) {
  const [y, q] = quarterFor(date).split(' Q').map(Number);
  const start = y * 4 + (q - 1) + offset;
  return Array.from({ length: count }, (_, i) => `${Math.floor((start + i) / 4)} Q${((start + i) % 4) + 1}`);
}
/**
 * Trailing four quarters: the last four finished quarters before the one containing `date` (`back` = 1 for the four
 * before those), as an alternative to a calendar year.
 */
export function trailingQuarters(back = 0, date = localToday()) {
  const qs = quarters(4, -4 * (back + 1), date);
  return { quarters: qs, start: quarterRange(qs[0]).start, end: quarterRange(qs[3]).end, label: `${qs[0]} – ${qs[3]}` };
}
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);

/** Filters a BD query can carry: one director and/or one territory. */
export function filtersFrom(q = {}) {
  return { director: Number(q.director) || null, territory: Number(q.territory) || null };
}
const matches = (t, f) => (!f.director || t.bd_director_id === f.director) && (!f.territory || t.territory_id === f.territory);

/**
 * Every pipeline ticket still in the books (see inBooks), with its director and territory names and its PWIN (0–1, or null).
 */
export function bids(f = {}) {
  const model = pwinModel();
  return db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.pipeline_status, t.value, t.bd_director_id, t.territory_id,
      t.projected_win_date, t.win_date_undetermined, t.assessment, t.created_at, t.done_at,
      d.first_name || ' ' || d.last_name AS director_name, tr.name AS territory_name
    FROM tickets t LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.ticket_type = 'bid' AND ${inBooks()}`).all()
    .filter((t) => matches(t, f))
    .map((t) => {
      const p = pwin(json.parse(t.assessment, {}), model.weights, model.gates);
      const { assessment, ...rest } = t;
      return { ...rest, pwin: p ? p.score / 100 : null };
    });
}
const isOpen = (t) => !CLOSED_STAGES.includes(t.pipeline_status);
const weighted = (t) => (t.value || 0) * (t.pwin ?? 1);

/** Value and count in each pipeline stage (open and closed), in stage order; pipeline tickets with no stage last. */
export function byStage(list, stages) {
  const rows = stages.map((stage) => {
    const xs = list.filter((t) => t.pipeline_status === stage);
    return { stage, count: xs.length, value: sum(xs, (t) => t.value) };
  });
  const none = list.filter((t) => !t.pipeline_status);
  if (none.length) rows.push({ stage: 'No stage', count: none.length, value: sum(none, (t) => t.value) });
  return rows;
}

/**
 * Projected bookings from open pipeline tickets by the quarter of their projected win date, for the next `count` quarters, with
 * PWIN-adjusted and unadjusted money apart. Pipeline tickets beyond that are "Later"; the rest fall in three pools: undetermined
 * (flagged so), overdue (the date has passed but the pipeline ticket is still open), and no date (never set).
 */
export function expected(list, count = 4) {
  const open = list.filter(isOpen);
  const qs = quarters(count);
  const lastEnd = quarterRange(qs[qs.length - 1]).end;
  const today = localToday();
  const bucket = (xs) => {
    const adj = xs.filter((t) => t.pwin != null);
    const raw = xs.filter((t) => t.pwin == null);
    return {
      count: xs.length, value: sum(xs, (t) => t.value), weighted: sum(xs, weighted),
      adjusted: { count: adj.length, value: sum(adj, (t) => t.value), weighted: sum(adj, weighted) },
      unadjusted: { count: raw.length, value: sum(raw, (t) => t.value) },
    };
  };
  const dated = open.filter((t) => t.projected_win_date && !t.win_date_undetermined);
  return {
    quarters: qs.map((quarter) => {
      const { start, end } = quarterRange(quarter);
      // Dates already past are overdue, not expected in this quarter.
      return { quarter, ...bucket(dated.filter((t) => t.projected_win_date >= start && t.projected_win_date <= end && t.projected_win_date >= today)) };
    }),
    later: bucket(dated.filter((t) => t.projected_win_date > lastEnd)),
    overdue: bucket(dated.filter((t) => t.projected_win_date < today)),
    undetermined: bucket(open.filter((t) => t.win_date_undetermined)),
    unscheduled: bucket(open.filter((t) => !t.projected_win_date && !t.win_date_undetermined)),
  };
}

/** Qualified pipeline (open, Qualified onward) grouped by `key` (territory or director), largest first. */
export function qualifiedBy(list, key) {
  const groups = new Map();
  list.filter((t) => QUALIFIED_STAGES.includes(t.pipeline_status)).forEach((t) => {
    const id = key === 'territory' ? t.territory_id : t.bd_director_id;
    const name = (key === 'territory' ? t.territory_name : t.director_name) || (key === 'territory' ? 'No territory' : 'No BD director');
    if (!groups.has(id)) groups.set(id, { id, name, count: 0, value: 0, weighted: 0 });
    const g = groups.get(id);
    g.count += 1; g.value += t.value || 0; g.weighted += weighted(t);
  });
  return [...groups.values()].sort((a, b) => b.value - a.value);
}

/** Won contracts with their director, territory, funding and billing (filtered like pipeline tickets). A contract counts only while its pipeline ticket is in the books, and not while it's on hold. */
export function contracts(f = {}) {
  const rows = db.prepare(`SELECT p.*, t.bd_director_id, t.territory_id, d.first_name || ' ' || d.last_name AS director_name, tr.name AS territory_name
    FROM delivery_programs p JOIN tickets t ON t.id = p.ticket_id LEFT JOIN users d ON d.id = t.bd_director_id
    LEFT JOIN territories tr ON tr.id = t.territory_id WHERE ${inBooks()} AND p.held_at IS NULL`).all().filter((p) => matches(p, f));
  const entries = db.prepare('SELECT * FROM program_entries').all();
  return rows.map((p) => {
    const mine = entries.filter((e) => e.program_id === p.id);
    const funded = sum(mine.filter((e) => e.kind === 'funding'), (e) => e.amount);
    return { ...p, awarded_on: p.awarded_at.slice(0, 10), funded, billed: sum(mine.filter((e) => e.kind === 'billing'), (e) => e.amount),
      billings: mine.filter((e) => e.kind === 'billing'), fundings: mine.filter((e) => e.kind === 'funding') };
  });
}

/** Bookings (contracts won) per quarter for the last `count` quarters, with how much of each quarter's wins is funded so far. */
export function bookingsByQuarter(list, count = 8) {
  return quarters(count, -(count - 1)).map((quarter) => {
    const { start, end } = quarterRange(quarter);
    const xs = list.filter((p) => p.awarded_on >= start && p.awarded_on <= end);
    const value = sum(xs, (p) => p.value);
    const funded = sum(xs, (p) => Math.min(p.funded, p.value || 0));
    return { quarter, count: xs.length, value, funded, unfunded: value - funded };
  });
}

/** Backlog on active contracts: contract value not yet billed, split into funded and unfunded. */
export function backlog(list) {
  const active = list.filter((p) => p.status === 'Active');
  const value = sum(active, (p) => p.value);
  const funded = sum(active, (p) => p.funded);
  const billed = sum(active, (p) => p.billed);
  return {
    contracts: active.length, value, funded, billed,
    total: Math.max(value - billed, 0),
    fundedBacklog: Math.max(funded - billed, 0),
    unfundedBacklog: Math.max(value - funded, 0),
  };
}

/** Bookings and revenue billed between two dates, and their ratio (book-to-bill). */
export function bookToBill(list, start, end) {
  const booked = sum(list.filter((p) => p.awarded_on >= start && p.awarded_on <= end), (p) => p.value);
  const billed = sum(list.flatMap((p) => p.billings).filter((e) => e.entry_date >= start && e.entry_date <= end), (e) => e.amount);
  return { booked, billed, ratio: billed ? booked / billed : null };
}

/** Book-to-bill per BD director over a period, from contracts they won. */
export function bookToBillByDirector(list, start, end) {
  const ids = [...new Set(list.map((p) => p.bd_director_id))];
  return ids.map((id) => {
    const mine = list.filter((p) => p.bd_director_id === id);
    return { id, name: mine[0]?.director_name || 'No BD director', ...bookToBill(mine, start, end) };
  }).filter((r) => r.booked || r.billed).sort((a, b) => b.booked - a.booked);
}

// Booking targets apply to the BD team only: a target counts while its person is on BD (someone who leaves BD keeps
// theirs, unused, in case they come back).
const BD_TARGETS = `SELECT * FROM booking_targets WHERE user_id IN
  (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD')`;

/** Booking targets for a year: per director (quarter 1–4, and the year, which is the sum of quarters when not set). */
export function targets(year, director = null) {
  const rows = db.prepare(`${BD_TARGETS} AND year = ?`).all(year).filter((t) => !director || t.user_id === director);
  const ids = [...new Set(rows.map((t) => t.user_id))];
  const quarter = (q) => sum(rows.filter((t) => t.quarter === q), (t) => t.amount);
  const yearTotal = sum(ids, (id) => {
    const own = rows.find((t) => t.user_id === id && t.quarter === 0);
    return own ? own.amount : sum(rows.filter((t) => t.user_id === id && t.quarter > 0), (t) => t.amount);
  });
  return { year, quarters: [1, 2, 3, 4].map(quarter), total: yearTotal };
}

/** The booking target for some quarters ("2025 Q4", …), across years. Someone with only a yearly target counts a quarter of it each quarter. */
export function quartersTarget(qs, director = null) {
  const rows = db.prepare(`${BD_TARGETS} AND year IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...new Set(qs.map((q) => Number(q.slice(0, 4))))]))
    .filter((t) => !director || t.user_id === director);
  return sum(qs, (q) => {
    const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(-1))];
    const mine = rows.filter((t) => t.year === y);
    return sum([...new Set(mine.map((t) => t.user_id))], (id) => {
      const own = mine.filter((t) => t.user_id === id);
      return own.some((t) => t.quarter > 0) ? sum(own.filter((t) => t.quarter === n), (t) => t.amount) : sum(own.filter((t) => t.quarter === 0), (t) => t.amount) / 4;
    });
  });
}

/** Forecast lines for the quarters asked for (all quarters without any), for pipeline tickets still in the books. */
export function forecastLines(qs = null) {
  return db.prepare(`SELECT s.* FROM forecast_snapshots s JOIN tickets t ON t.id = s.ticket_id WHERE ${inBooks()}
    AND (@all = 1 OR s.quarter IN (SELECT value FROM json_each(@qs)))`).all({ all: qs ? 0 : 1, qs: JSON.stringify(qs || []) });
}

/**
 * The pipeline as it stood at the end of each interval between `from` and `to`, from the ticket history.
 * by: stage (open stages) | director | territory (qualified pipeline). interval: week | month | quarter | year.
 * Only tickets still in the books count, so an archived ticket is gone from past points too, not just today's.
 */
export function trends({ from, to, interval = 'month', by = 'stage', f = {} }) {
  const points = [];
  // Each point is the last day of its interval; step from one to the next. (Date.UTC's day 0 is the month before's last day.)
  const next = (d) => {
    const [y, m] = d.split('-').map(Number);
    if (interval === 'week') return addDays(d, 7);
    if (interval === 'month') return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
    if (interval === 'quarter') return new Date(Date.UTC(y, m + 3, 0)).toISOString().slice(0, 10);
    return `${y + 1}-12-31`;
  };
  // Snap the first point to the end of its interval, then step.
  let d = interval === 'week' ? addDays(from, (7 - new Date(`${from}T00:00:00Z`).getUTCDay()) % 7)
    : interval === 'month' ? new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7), 0)).toISOString().slice(0, 10)
    : interval === 'quarter' ? quarterRange(quarterFor(from)).end
    : `${from.slice(0, 4)}-12-31`;
  while (d <= to && points.length < 260) { points.push(d); d = next(d); }
  if (!points.length || points[points.length - 1] < to) points.push(to);

  const history = db.prepare(`SELECT h.*, d.first_name || ' ' || d.last_name AS director_name, tr.name AS territory_name
    FROM ticket_history h JOIN tickets t ON t.id = h.ticket_id
      LEFT JOIN users d ON d.id = h.bd_director_id LEFT JOIN territories tr ON tr.id = h.territory_id
    WHERE ${inBooks()} ORDER BY h.ticket_id, h.changed_at, h.id`).all();
  const byTicket = new Map();
  history.forEach((h) => { if (!byTicket.has(h.ticket_id)) byTicket.set(h.ticket_id, []); byTicket.get(h.ticket_id).push(h); });

  const series = new Map();
  const keyOf = (h) => (by === 'stage' ? [h.pipeline_status || 'No stage', h.pipeline_status || 'No stage']
    : by === 'director' ? [`d${h.bd_director_id ?? 0}`, h.director_name || 'No BD director']
    : [`t${h.territory_id ?? 0}`, h.territory_name || 'No territory']);
  if (by === 'stage') OPEN_STAGES.forEach((s) => series.set(s, { key: s, label: s, values: points.map(() => 0) }));
  points.forEach((point, i) => {
    const cutoff = `${point} 23:59:59`;
    byTicket.forEach((rows) => {
      let state = null;
      for (const r of rows) { if (r.changed_at <= cutoff) state = r; else break; }
      if (!state || !matches(state, f)) return;
      const counts = by === 'stage' ? OPEN_STAGES.includes(state.pipeline_status) : QUALIFIED_STAGES.includes(state.pipeline_status);
      if (!counts) return;
      const [key, label] = keyOf(state);
      if (!series.has(key)) series.set(key, { key, label, values: points.map(() => 0) });
      series.get(key).values[i] += state.value || 0;
    });
  });
  return { points, interval, by, series: [...series.values()] };
}

/** Book-to-bill per quarter, three ways: conventional (that quarter), trailing twelve months, and funded (obligations ÷ billed). */
export function bookToBillSeries(deals, qs) {
  const funding = deals.flatMap((p) => p.fundings);
  const fundedIn = (start, end) => sum(funding.filter((e) => e.entry_date >= start && e.entry_date <= end), (e) => e.amount);
  return qs.map((q) => {
    const { start, end } = quarterRange(q);
    const ttmStart = quarterRange(quarters(1, -3, start)[0]).start;
    const conv = bookToBill(deals, start, end);
    const ttm = bookToBill(deals, ttmStart, end);
    const funded = fundedIn(start, end);
    return {
      quarter: q, booked: conv.booked, billed: conv.billed, conventional: conv.ratio,
      ttmBooked: ttm.booked, ttmBilled: ttm.billed, ttm: ttm.ratio,
      funded, fundedRatio: conv.billed ? funded / conv.billed : null,
    };
  });
}

/** Funding obligated over the last twelve months ÷ revenue billed over them: the funded-backlog book-to-bill. */
export function fundedTtm(deals, today = localToday()) {
  const start = addDays(today, -365);
  const funded = deals.flatMap((p) => p.fundings).filter((e) => e.entry_date >= start && e.entry_date <= today).reduce((t, e) => t + (e.amount || 0), 0);
  const billed = bookToBill(deals, start, today).billed;
  return { funded, billed, ratio: billed ? funded / billed : null };
}

/**
 * Qualified pipeline week by week for each of these people (BD director ids), over the last `weeks` weeks: as it stood
 * at each week's end, from the ticket history. People are listed largest pipeline first.
 */
export function pipelineByPerson({ ids = [], weeks = 13, f = {} } = {}) {
  const to = localToday();
  const t = trends({ from: addDays(to, -7 * weeks), to, interval: 'week', by: 'director', f });
  // The last point is today; drop a week's end that falls within the last seven days so each step is about a week.
  const n = t.points.length;
  if (n > 2 && addDays(t.points[n - 2], 7) > to) {
    t.points.splice(n - 2, 1);
    t.series.forEach((x) => x.values.splice(n - 2, 1));
  }
  const names = new Map(db.prepare('SELECT id, first_name, last_name FROM users WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids))
    .map((u) => [u.id, `${u.first_name} ${u.last_name}`]));
  const people = ids.map((id) => {
    const s = t.series.find((x) => x.key === `d${id}`);
    return { id, name: names.get(id) || 'Someone', values: s ? s.values : t.points.map(() => 0) };
  }).filter((p) => names.has(p.id)).sort((a, b) => b.values.at(-1) - a.values.at(-1));
  return { points: t.points, people };
}
