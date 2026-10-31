// Team dashboard: weekly close-out per person, work added while priorities were
// still open, every checklist item by master ticket, and the pipeline totals.
import { Router } from 'express';
import { db, json, withTeams } from '../db.js';
import { PIPELINE_STATUSES, weekStartFor } from './priorities.js';
import { bids, contracts, expected, byStage, bookingsByQuarter, backlog, targets, quarterRange, OPEN_STAGES, QUALIFIED_STAGES } from '../financials.js';
import { quarterFor } from '../../src/lib/travelCalc.js';

const r = Router();
const localToday = () => new Date().toLocaleDateString('en-CA');

r.get('/', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams').all();
  const currentWeek = Object.fromEntries(teams.map((t) => [t.id, weekStartFor(localToday(), t.checkin_dow)]));

  const users = withTeams(db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title
    FROM users u WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all());
  const rows = db.prepare(`SELECT c.id, c.ticket_id, c.team_id, c.week_start, c.title, c.is_planned, c.completed, c.checklist,
      a.user_id, a.position, t.opportunity_title, t.pipeline_status
    FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id JOIN tickets t ON t.id = c.ticket_id
    ORDER BY c.week_start DESC, a.position`).all();

  const byUser = new Map(users.map((u) => [u.id, { ...u, weeks: new Map(), tickets: new Map() }]));
  rows.forEach((c) => {
    const u = byUser.get(c.user_id);
    if (!u) return;
    // Weekly tallies. Future weeks haven't happened yet, so they're left out.
    if (c.week_start <= (currentWeek[c.team_id] || localToday())) {
      const key = `${c.team_id}|${c.week_start}`;
      if (!u.weeks.has(key)) u.weeks.set(key, { week_start: c.week_start, current: c.week_start === currentWeek[c.team_id], planned: 0, completed: 0, work: 0 });
      const w = u.weeks.get(key);
      if (c.is_planned) { w.planned += 1; if (c.completed) w.completed += 1; } else w.work += 1;
    }
    // Checklist items, grouped by master ticket.
    const items = json.parse(c.checklist, []);
    if (items.length) {
      if (!u.tickets.has(c.ticket_id)) u.tickets.set(c.ticket_id, { ticket_id: c.ticket_id, title: c.opportunity_title, status: c.pipeline_status, cards: [] });
      u.tickets.get(c.ticket_id).cards.push({ id: c.id, title: c.title, week_start: c.week_start, is_planned: !!c.is_planned, completed: !!c.completed, items });
    }
  });

  // Additional work logged while planning was closed counts as work for that week.
  db.prepare('SELECT user_id, team_id, week_start, COUNT(*) AS n FROM work_log GROUP BY user_id, team_id, week_start').all().forEach((l) => {
    const u = byUser.get(l.user_id);
    if (!u || l.week_start > (currentWeek[l.team_id] || localToday())) return;
    const key = `${l.team_id}|${l.week_start}`;
    if (!u.weeks.has(key)) u.weeks.set(key, { week_start: l.week_start, current: l.week_start === currentWeek[l.team_id], planned: 0, completed: 0, work: 0 });
    u.weeks.get(key).work += l.n;
  });

  const people = [...byUser.values()].map(({ weeks, tickets, ...u }) => ({
    ...u,
    weeks: [...weeks.values()].sort((a, b) => (a.week_start < b.week_start ? 1 : -1)),
    tickets: [...tickets.values()].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
  }));

  const pipelineRows = db.prepare("SELECT pipeline_status, COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM tickets WHERE ticket_type = 'bid' GROUP BY pipeline_status").all();
  const pipeline = [...PIPELINE_STATUSES, null].map((status) => {
    const p = pipelineRows.find((x) => (x.pipeline_status || null) === status);
    return { status, count: p?.count || 0, value: p?.value || 0 };
  });

  res.json({
    people,
    pipeline,
    totals: { tickets: pipeline.reduce((n, p) => n + p.count, 0), value: pipeline.reduce((n, p) => n + p.value, 0) },
  });
});

/** Whether someone is a BD director: on the BD team, or the director on any bid. */
const isDirector = (id) => !!db.prepare(`SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD'
  UNION SELECT 1 FROM tickets WHERE bd_director_id = ?`).get(id, id);

/** Bookings against target for one director (or everyone, with null) this quarter and this year. */
function bookingsVsTarget(director) {
  const today = localToday();
  const year = Number(today.slice(0, 4));
  const q = Number(quarterFor(today).slice(-1));
  const deals = contracts({ director });
  const t = targets(year, director);
  const { start } = quarterRange(quarterFor(today));
  const booked = (from) => deals.filter((p) => p.awarded_on >= from && p.awarded_on <= today).reduce((s, p) => s + (p.value || 0), 0);
  return {
    quarter: { label: quarterFor(today), booked: booked(start), target: t.quarters[q - 1] },
    year: { label: String(year), booked: booked(`${year}-01-01`), target: t.total },
  };
}

/** One person's own things: this week's priorities, tasks, tickets, trips, events, alerts, and (for BD directors) their numbers. */
r.get('/me', (req, res) => {
  const me = req.user.id;
  const today = localToday();
  const myTeams = db.prepare('SELECT t.* FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ?').all(me);
  const weeks = myTeams.map((t) => [t.id, weekStartFor(today, t.checkin_dow)]);
  const cards = weeks.flatMap(([teamId, week]) => db.prepare(`SELECT c.*, t.opportunity_title FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
    JOIN tickets t ON t.id = c.ticket_id WHERE a.user_id = ? AND c.team_id = ? AND c.week_start = ? ORDER BY a.position`).all(me, teamId, week));
  const items = cards.flatMap((c) => json.parse(c.checklist, []));
  const out = {
    priorities: {
      planned: cards.filter((c) => c.is_planned).length, completed: cards.filter((c) => c.is_planned && c.completed).length,
      work: cards.filter((c) => !c.is_planned).length, tasksOpen: items.filter((i) => !i.done).length, tasksDone: items.filter((i) => i.done).length,
      open: cards.filter((c) => !c.completed).slice(0, 6).map((c) => ({ id: c.id, title: c.title, ticket: c.opportunity_title, due_date: c.due_date })),
    },
    alerts: db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL').get(me).n,
    trips: db.prepare(`SELECT id, date_from, date_to, location_to, total_estimate FROM trips WHERE traveler_id = ? AND date_to >= ? ORDER BY date_from LIMIT 4`)
      .all(me, today).map((t) => ({ ...t, location_to: json.parse(t.location_to, {}) })),
    events: db.prepare(`SELECT e.id, e.name, e.date_from, e.date_to FROM events e JOIN event_attendees a ON a.event_id = e.id
      WHERE a.user_id = ? AND e.date_to >= ? ORDER BY e.date_from LIMIT 4`).all(me, today),
    objectives: db.prepare(`SELECT o.id, o.organization, o.objective, o.target_date, o.status FROM account_objectives o
      WHERE o.owner_id = ? AND o.status NOT IN ('Achieved', 'Missed') ORDER BY o.target_date IS NULL, o.target_date LIMIT 6`).all(me),
    bd: null,
  };
  if (isDirector(me)) {
    const list = bids({ director: me });
    const open = list.filter((t) => OPEN_STAGES.includes(t.pipeline_status));
    const qualified = list.filter((t) => QUALIFIED_STAGES.includes(t.pipeline_status));
    out.bd = {
      open: { count: open.length, value: open.reduce((s, t) => s + (t.value || 0), 0) },
      qualified: { count: qualified.length, value: qualified.reduce((s, t) => s + (t.value || 0), 0) },
      expected: expected(list),
      bookings: bookingsVsTarget(me),
      // Open bids still missing a projected win date: the director's to-do.
      needsDate: open.filter((t) => !t.projected_win_date && !t.win_date_undetermined).map((t) => ({ id: t.id, title: t.opportunity_title })),
    };
  }
  res.json(out);
});

/** The whole company at a glance: people, pipeline, forecast, bookings, backlog, delivery, travel and priorities. */
r.get('/overview', (req, res) => {
  const today = localToday();
  const list = bids();
  const deals = contracts();
  const open = list.filter((t) => OPEN_STAGES.includes(t.pipeline_status));
  const qualified = list.filter((t) => QUALIFIED_STAGES.includes(t.pipeline_status));
  const exp = expected(list);
  const q = quarterRange(quarterFor(today));
  const teams = db.prepare(`SELECT t.id, t.name, COUNT(u.id) AS people FROM teams t LEFT JOIN user_teams ut ON ut.team_id = t.id
    LEFT JOIN users u ON u.id = ut.user_id AND u.active = 1 GROUP BY t.id ORDER BY t.name`).all();
  // Priorities this week: every team's current week.
  const weekCards = db.prepare('SELECT * FROM teams').all().flatMap((t) => db.prepare('SELECT is_planned, completed FROM priority_cards WHERE team_id = ? AND week_start = ?')
    .all(t.id, weekStartFor(today, t.checkin_dow)));
  res.json({
    people: db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n,
    teams,
    pipeline: {
      open: { count: open.length, value: open.reduce((s, t) => s + (t.value || 0), 0) },
      qualified: { count: qualified.length, value: qualified.reduce((s, t) => s + (t.value || 0), 0) },
      stages: byStage(list, OPEN_STAGES),
      forecastNext4: exp.quarters.reduce((s, x) => s + x.weighted, 0),
      undetermined: exp.undetermined.value,
    },
    bookings: bookingsVsTarget(null),
    bookingsByQuarter: bookingsByQuarter(deals, 4),
    backlog: backlog(deals),
    delivery: {
      active: deals.filter((p) => p.status === 'Active').length,
      needsPm: deals.filter((p) => p.status === 'Active' && !p.program_manager_id).length,
      billedThisQuarter: deals.flatMap((p) => p.billings).filter((e) => e.entry_date >= q.start && e.entry_date <= today).reduce((s, e) => s + e.amount, 0),
    },
    travel: { thisQuarter: db.prepare('SELECT COALESCE(SUM(total_estimate), 0) AS n FROM trips WHERE quarter = ?').get(quarterFor(today)).n },
    priorities: {
      planned: weekCards.filter((c) => c.is_planned).length,
      completed: weekCards.filter((c) => c.is_planned && c.completed).length,
      work: weekCards.filter((c) => !c.is_planned).length,
    },
    events: db.prepare(`SELECT e.id, e.name, e.date_from, e.date_to, (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS attendees
      FROM events e WHERE e.date_to >= ? ORDER BY e.date_from LIMIT 4`).all(today),
  });
});

export default r;
