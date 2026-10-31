// BD financial figures, shared by the dashboards, the BD report card and the reports. All money is in dollars.
//   Pipeline: open bids, by stage. Qualified pipeline: open bids from Qualified onward.
//   Expected revenue: each open bid's value × its PWIN, by the quarter of its projected win date. Bids without a PWIN
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

export const OPEN_STAGES = ['Identified', 'Qualified', 'Capture', 'Proposal', 'Submitted'];
export const QUALIFIED_STAGES = ['Qualified', 'Capture', 'Proposal', 'Submitted'];
export const CLOSED_STAGES = ['Awarded', 'Lost', 'No Bid'];
export const localToday = () => new Date().toLocaleDateString('en-CA');

/** `count` quarters starting `offset` quarters from the one containing `date` ("2026 Q4", …). */
export function quarters(count, offset = 0, date = localToday()) {
  const [y, q] = quarterFor(date).split(' Q').map(Number);
  const start = y * 4 + (q - 1) + offset;
  return Array.from({ length: count }, (_, i) => `${Math.floor((start + i) / 4)} Q${((start + i) % 4) + 1}`);
}
const sum = (rows, f) => rows.reduce((s, r) => s + (f(r) || 0), 0);

/** Filters a BD query can carry: one director and/or one territory. */
export function filtersFrom(q = {}) {
  return { director: Number(q.director) || null, territory: Number(q.territory) || null };
}
const matches = (t, f) => (!f.director || t.bd_director_id === f.director) && (!f.territory || t.territory_id === f.territory);

/** Every bid ticket with its director and territory names and its PWIN (0–1, or null). */
export function bids(f = {}) {
  const model = pwinModel();
  return db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.pipeline_status, t.value, t.bd_director_id, t.territory_id,
      t.projected_win_date, t.win_date_undetermined, t.assessment, t.created_at, t.done_at,
      d.first_name || ' ' || d.last_name AS director_name, tr.name AS territory_name
    FROM tickets t LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.ticket_type = 'bid'`).all()
    .filter((t) => matches(t, f))
    .map((t) => {
      const p = pwin(json.parse(t.assessment, {}), model.weights, model.gates);
      const { assessment, ...rest } = t;
      return { ...rest, pwin: p ? p.score / 100 : null };
    });
}
const isOpen = (t) => !CLOSED_STAGES.includes(t.pipeline_status);
const weighted = (t) => (t.value || 0) * (t.pwin ?? 1);

/** Value and count in each pipeline stage (open and closed), in stage order; bids with no stage last. */
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
 * Expected revenue from open bids by the quarter of their projected win date, for the next `count` quarters, with
 * PWIN-adjusted and unadjusted money apart. Bids beyond that are "Later"; the rest fall in three pools: undetermined
 * (flagged so), overdue (the date has passed but the bid is still open), and no date (never set).
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

/** Won contracts with their director, territory, funding and billing (filtered like bids). */
export function contracts(f = {}) {
  const rows = db.prepare(`SELECT p.*, t.bd_director_id, t.territory_id, d.first_name || ' ' || d.last_name AS director_name, tr.name AS territory_name
    FROM delivery_programs p LEFT JOIN tickets t ON t.id = p.ticket_id LEFT JOIN users d ON d.id = t.bd_director_id
    LEFT JOIN territories tr ON tr.id = t.territory_id`).all().filter((p) => matches(p, f));
  const entries = db.prepare('SELECT * FROM program_entries').all();
  return rows.map((p) => {
    const mine = entries.filter((e) => e.program_id === p.id);
    const funded = sum(mine.filter((e) => e.kind === 'funding'), (e) => e.amount);
    return { ...p, awarded_on: p.awarded_at.slice(0, 10), funded, billed: sum(mine.filter((e) => e.kind === 'billing'), (e) => e.amount),
      billings: mine.filter((e) => e.kind === 'billing') };
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

/** Booking targets for a year: per director (quarter 1–4, and the year, which is the sum of quarters when not set). */
export function targets(year, director = null) {
  const rows = db.prepare('SELECT * FROM booking_targets WHERE year = ?').all(year).filter((t) => !director || t.user_id === director);
  const ids = [...new Set(rows.map((t) => t.user_id))];
  const quarter = (q) => sum(rows.filter((t) => t.quarter === q), (t) => t.amount);
  const yearTotal = sum(ids, (id) => {
    const own = rows.find((t) => t.user_id === id && t.quarter === 0);
    return own ? own.amount : sum(rows.filter((t) => t.user_id === id && t.quarter > 0), (t) => t.amount);
  });
  return { year, quarters: [1, 2, 3, 4].map(quarter), total: yearTotal };
}

/**
 * The pipeline as it stood at the end of each interval between `from` and `to`, from the ticket history.
 * by: stage (open stages) | director | territory (qualified pipeline). interval: week | month | quarter | year.
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
    FROM ticket_history h LEFT JOIN users d ON d.id = h.bd_director_id LEFT JOIN territories tr ON tr.id = h.territory_id
    ORDER BY h.ticket_id, h.changed_at, h.id`).all();
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
