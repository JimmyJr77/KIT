// Team dashboard: weekly close-out per person, work added while priorities were
// still open, every checklist item by master ticket, and the pipeline totals.
import { Router } from 'express';
import { db, json } from '../db.js';
import { PIPELINE_STATUSES, weekStartFor } from './priorities.js';

const r = Router();
const localToday = () => new Date().toLocaleDateString('en-CA');

r.get('/', (req, res) => {
  const teams = db.prepare('SELECT * FROM teams').all();
  const currentWeek = Object.fromEntries(teams.map((t) => [t.id, weekStartFor(localToday(), t.checkin_dow)]));

  const users = db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title, u.team_id, t.name AS team_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all();
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

export default r;
