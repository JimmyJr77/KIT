// The Tactical Meeting Report: one week of pipeline movement, for the BD team or one BD director.
//   Qualified pipeline value by stage (Qualified onward; Prospecting isn't measured), week by week, for the whole scope;
//   and the qualified pipeline week by week, by person
//   (both as they stood at each week's end, from the ticket history).
//   What moved that week: won (into Awarded), lost, moved forward (left to right on the board), downgraded (moved back a
//   stage), removed from the board (archived here or in Pipedrive, or deleted in Pipedrive), and next steps completed.
// The week runs Monday to Sunday. The week's numbers come for the whole scope and for each person (by BD director). Each
// list names its tickets, so the report carries its own cheat sheet.
import { db } from './db.js';
import { trends, localToday, inBooks, QUALIFIED_STAGES } from './financials.js';
import { listPipelines } from './pipelines.js';
import { directors } from './reportCard.js';
import { weekStartFor } from './routes/priorities.js';
import { addDays } from '../src/lib/travelCalc.js';

const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0);
const day = (d) => (d ? d.slice(0, 10) : null);

/** The Monday starting the week that holds `date`. */
export const mondayOf = (date) => weekStartFor(date, 1);

/**
 * The pipeline tickets that `keep` accepts which moved between `from` and `to` (dates, both included): their stage
 * changed, or they were won or lost. Each counts once, by where it ended up against where it stood before its first move:
 * won, lost, forward or back (a stage or more), or just moved (it came back to where it started). A new pipeline ticket
 * hasn't moved; its first stage is where it starts. `removed` also lists the tickets taken off the board in the week.
 * With `inBooksOnly`, tickets archived since are left out (as on the dashboard).
 */
export function weekMoves({ keep = () => true, from, to, inBooksOnly = false }) {
  const order = new Map(listPipelines().map((p) => [p.id, p.statuses.filter((x) => x !== 'Awarded' && x !== 'Lost')]));
  const list = db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.pipeline_id, t.pipeline_status, t.value, t.bd_director_id,
      t.deal_status, t.won_at, t.lost_at, t.lost_reason, t.archived_at, t.pipedrive_archived_at, t.pipedrive_deleted_at,
      d.first_name || ' ' || d.last_name AS director
    FROM tickets t LEFT JOIN users d ON d.id = t.bd_director_id
    WHERE t.ticket_type = 'bid' AND ${inBooksOnly ? inBooks() : 't.archive_set_id IS NULL AND (t.archived_at IS NULL OR substr(t.archived_at, 1, 10) >= @from)'}`)
    .all(inBooksOnly ? {} : { from }).filter(keep);
  const hist = new Map();
  db.prepare(`SELECT ticket_id, pipeline_status, changed_at FROM ticket_history WHERE ticket_id IN (SELECT value FROM json_each(?))
    ORDER BY ticket_id, changed_at, id`).all(JSON.stringify(list.map((t) => t.id)))
    .forEach((r) => { if (!hist.has(r.ticket_id)) hist.set(r.ticket_id, []); hist.get(r.ticket_id).push(r); });
  const within = (d) => !!d && day(d) >= from && day(d) <= to;

  const moves = [];
  const removed = [];
  for (const t of list) {
    const base = { id: t.id, title: t.opportunity_title, organization: t.organization, directorId: t.bd_director_id, director: t.director, value: t.value };
    const removedOn = day(t.archived_at);
    if (removedOn && removedOn >= from && removedOn <= to) {
      removed.push({ ...base, stage: t.pipeline_status, on: removedOn,
        how: t.pipedrive_deleted_at ? 'Deleted in Pipedrive' : t.pipedrive_archived_at ? 'Archived in Pipedrive' : 'Archived in KIT' });
    }
    const h = hist.get(t.id) || [];
    const first = h.findIndex((r, i) => i > 0 && within(r.changed_at) && r.pipeline_status !== h[i - 1].pipeline_status);
    const won = t.deal_status === 'won' && within(t.won_at);
    const lost = t.deal_status === 'lost' && within(t.lost_at);
    if (first < 0 && !won && !lost) continue;
    // Where it stood before the week's first move, and where it stood at the end of the week.
    // A close is from the last open stage before it (a ticket can sit in Awarded before it's marked won).
    const closedAt = won ? t.won_at : lost ? t.lost_at : null;
    const before = closedAt ? [...h].reverse().find((r) => r.changed_at < closedAt && !['Awarded', 'Lost'].includes(r.pipeline_status))?.pipeline_status ?? null
      : first > 0 ? h[first - 1].pipeline_status : [...h].reverse().find((r) => day(r.changed_at) < from)?.pipeline_status ?? null;
    const after = [...h].reverse().find((r) => day(r.changed_at) <= to)?.pipeline_status ?? t.pipeline_status;
    const stages = order.get(t.pipeline_id ?? null) || [];
    const a = stages.indexOf(before);
    const b = stages.indexOf(after);
    const kind = won ? 'won' : lost ? 'lost' : a >= 0 && b > a ? 'forward' : a >= 0 && b >= 0 && b < a ? 'back' : 'moved';
    moves.push({ ...base, kind, from: before, to: won ? 'Awarded' : lost ? 'Lost' : after, on: day(won ? t.won_at : lost ? t.lost_at : h[first].changed_at),
      lostReason: lost ? t.lost_reason : null });
  }
  return { moves, removed };
}

/** The same week's moves as counts (the dashboard's tile). */
export function moveCounts(opts) {
  const { moves } = weekMoves(opts);
  const n = (k) => moves.filter((m) => m.kind === k).length;
  return { moved: moves.length, forward: n('forward'), back: n('back'), won: n('won'), lost: n('lost') };
}

/** Next steps (a pipeline ticket's activities) marked done between `from` and `to`. */
function stepsDone(keep, from, to) {
  return db.prepare(`SELECT k.id, k.text, k.done_at, t.id AS ticket_id, t.opportunity_title AS title, t.organization, t.bd_director_id,
      d.first_name || ' ' || d.last_name AS director, a.first_name || ' ' || a.last_name AS assignee
    FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN users a ON a.id = k.assignee_id
    WHERE t.ticket_type = 'bid' AND t.archive_set_id IS NULL AND k.done = 1 AND substr(k.done_at, 1, 10) BETWEEN ? AND ?
    ORDER BY k.done_at`).all(from, to).filter(keep).map((k) => ({ ...k, on: day(k.done_at) }));
}

/**
 * Qualified pipeline at each week's end (Sundays), the last point being the end of the report week (or today, mid-week),
 * for each BD director (or just `director`), and the total. `weeks` points in all.
 */
function qualifiedByWeek(to, weeks, director) {
  const t = trends({ from: addDays(to, -7 * (weeks - 1)), to, interval: 'week', by: 'director', f: director ? { director } : {} });
  const ids = director ? [director] : directors().map((d) => d.id);
  const names = new Map(db.prepare('SELECT id, first_name, last_name FROM users WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids))
    .map((u) => [u.id, `${u.first_name} ${u.last_name}`]));
  const people = ids.filter((id) => names.has(id)).map((id) => ({
    id, name: names.get(id), values: t.series.find((x) => x.key === `d${id}`)?.values || t.points.map(() => 0),
  })).filter((p) => director || p.values.some((v) => v)).sort((a, b) => b.values.at(-1) - a.values.at(-1));
  const total = t.points.map((_, i) => sum(t.series, (x) => x.values[i]));
  return { points: t.points, people, total };
}

/**
 * Pipeline value in each stage from Qualified onward at each week's end (Sundays), the last point being the end of the
 * report week. Prospecting isn't measured here.
 */
function stagesByWeek(to, weeks, director) {
  const t = trends({ from: addDays(to, -7 * (weeks - 1)), to, interval: 'week', by: 'stage', f: director ? { director } : {} });
  const series = QUALIFIED_STAGES.map((stage) => ({ key: stage, label: stage, values: t.series.find((x) => x.key === stage)?.values || t.points.map(() => 0) }));
  const total = t.points.map((_, i) => sum(series, (x) => x.values[i]));
  return { points: t.points, series, total };
}

/** The week's headline numbers from its moves, removals and completed next steps. */
function countsOf(moves, removed, steps) {
  const n = (k) => moves.filter((m) => m.kind === k);
  const won = n('won');
  return {
    won: won.length, wonValue: sum(won, (x) => x.value), wonBeforeQualified: won.filter((x) => x.from && !QUALIFIED_STAGES.includes(x.from)).length,
    lost: n('lost').length, closed: won.length + n('lost').length,
    forward: n('forward').length, back: n('back').length, removed: removed.length,
    downgradedOrRemoved: new Set([...n('back'), ...removed].map((x) => x.id)).size,
    steps: steps.length, stepTickets: new Set(steps.map((s) => s.ticket_id)).size,
  };
}

/** The report for the week starting `week` (a Monday; default this week), for `director` (a user id) or the BD team. */
export function tacticalReport({ week, director = null, weeks = 13 } = {}) {
  const today = localToday();
  const start = mondayOf(week || today);
  const end = addDays(start, 6);
  const to = end < today ? end : today;
  const keep = (t) => !director || t.bd_director_id === director;
  const { moves, removed } = weekMoves({ keep, from: start, to });
  const steps = stepsDone(keep, start, to);
  const q = qualifiedByWeek(to, weeks, director);
  const stages = stagesByWeek(to, weeks, director);
  // The week's change: the end of the week against the Sunday before it (the second-last point).
  const change = (values) => (values.length > 1 ? values.at(-1) - values.at(-2) : 0);
  const of = (k) => moves.filter((m) => m.kind === k);
  const who = director ? db.prepare("SELECT first_name || ' ' || last_name AS n FROM users WHERE id = ?").get(director)?.n : 'BD team';
  const people = q.people.map((p) => ({ ...p, now: p.values.at(-1), change: change(p.values) }));

  // Each BD director's numbers (those with qualified pipeline, or anything on the week's lists). Tickets directed by
  // anyone else, or by no one, share one Others row in the team view when they have anything to show; they still count
  // in the team's totals.
  const bdIds = new Set(director ? [director] : directors().map((d) => d.id));
  const names = new Map(people.map((p) => [p.id, p.name]));
  [...moves, ...removed].forEach((x) => { if (bdIds.has(x.directorId) && !names.has(x.directorId)) names.set(x.directorId, x.director); });
  steps.forEach((x) => { if (bdIds.has(x.bd_director_id) && !names.has(x.bd_director_id)) names.set(x.bd_director_id, x.director); });
  const idOf = (x) => x.directorId ?? x.bd_director_id ?? null;
  const rowFor = (id, name, mine) => {
    const p = people.find((x) => x.id === id);
    return { id, name, qualified: p ? p.now : 0, qualifiedChange: p ? p.change : 0, ...countsOf(moves.filter(mine), removed.filter(mine), steps.filter(mine)) };
  };
  const byPerson = [...names].map(([id, name]) => rowFor(id, name, (x) => idOf(x) === id));
  if (!director) {
    const others = rowFor(null, 'Others (not a BD director)', (x) => !bdIds.has(idOf(x)));
    // Their qualified pipeline is whatever the team holds beyond the directors'.
    const rest = (i) => (q.total.at(i) ?? 0) - sum(people, (p) => p.values.at(i));
    Object.assign(others, { qualified: rest(-1), qualifiedChange: q.total.length > 1 ? rest(-1) - rest(-2) : 0 });
    if (others.qualified || others.closed || others.forward || others.downgradedOrRemoved || others.steps) byPerson.push(others);
  }

  return {
    scope: { director, label: who || 'Someone' },
    week: { start, end, to, current: today <= end },
    stages: { ...stages, now: stages.total.at(-1) ?? 0, change: change(stages.total) },
    qualified: {
      points: q.points,
      people,
      total: { values: q.total, now: q.total.at(-1) ?? 0, change: change(q.total), stages: QUALIFIED_STAGES },
    },
    counts: countsOf(moves, removed, steps),
    byPerson,
    lists: { won: of('won'), lost: of('lost'), forward: of('forward'), back: of('back'), removed, steps },
  };
}
