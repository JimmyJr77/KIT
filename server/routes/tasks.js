// The Task view on Priorities. A task is an activity with its subtasks. Three looks at the same work: one person's tasks in
// sections (this week's priorities, by due date, strategic priority tickets, then each of their tiers), a team's numbers
// by member, and everything by pipeline ticket. Tasks are the ones assigned to the person on live pipeline tickets (not
// yet won, lost or archived), except this week's priorities, which are whatever is on the person's cards.
import { Router } from 'express';
import { db } from '../db.js';
import { openOrder, subtasksOf } from '../activities.js';
import { localToday } from '../financials.js';
import { addDays } from '../../src/lib/travelCalc.js';
import { priorityAccounts } from './priorityAccounts.js';
import { weekStartFor } from './priorities.js';

const r = Router();
const LIVE = "t.ticket_type IN ('bid', 'account') AND t.done_at IS NULL AND t.archived_at IS NULL";
const usersFrom = (q) => [...new Set(String(q.users || '').split(',').map(Number).filter(Boolean))];

/** Tasks matching `where`: open ones in their ticket's priority order, then done ones, latest first. */
function tasks(where, params, withDone) {
  const rows = db.prepare(`SELECT k.id, k.ticket_id, k.text AS subject, k.activity_type, k.due_date, k.due_time, k.duration, k.flagged, k.waiting_client, k.done,
      u.first_name || ' ' || u.last_name AS who, t.opportunity_title AS ticket, t.organization, t.pipeline_status AS stage
    FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN users u ON u.id = k.assignee_id
    WHERE ${where} ${withDone ? '' : 'AND k.done = 0'}
    ORDER BY k.done, CASE WHEN k.done THEN k.done_at END DESC, k.position, k.id`).all(...params);
  const subs = subtasksOf(rows.map((a) => a.id)).filter((x) => withDone || !x.done);
  const nextSteps = new Map();
  const nextOf = (ticket) => {
    if (!nextSteps.has(ticket)) nextSteps.set(ticket, openOrder(ticket)[0]);
    return nextSteps.get(ticket);
  };
  return rows.map((a) => ({
    ...a, done: !!a.done, flagged: !!a.flagged, waiting_client: !!a.waiting_client, next: a.id === nextOf(a.ticket_id),
    subtasks: subs.filter((x) => x.task_id === a.id),
  }));
}
const assigned = (ids, withDone) => tasks(`k.assignee_id IN (SELECT value FROM json_each(?)) AND ${LIVE}`, [JSON.stringify(ids)], withDone);

/** This week's priority cards for someone, in their lane's order, across their teams' weeks. */
function weekCards(userId) {
  const today = localToday();
  return db.prepare('SELECT id, checkin_dow FROM teams').all().flatMap((team) => db.prepare(`SELECT c.id, c.activity_id, c.is_planned, c.completed
    FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id JOIN tickets t ON t.id = c.ticket_id
    WHERE a.user_id = ? AND c.team_id = ? AND c.week_start = ? AND c.archived_at IS NULL AND t.archived_at IS NULL ORDER BY a.position, c.id`)
    .all(userId, team.id, weekStartFor(today, team.checkin_dow)));
}

/** The ticket ids under a tier, in order: its accounts as sorted, and each account's own activities then its tickets as sorted. */
const tierTickets = (tier) => [...new Set(tier.accounts.flatMap((a) => [a.ticket_id, ...a.tickets.map((t) => t.id)]).filter(Boolean))];
/** `ids` in order, each ticket's tasks in turn. */
const onTickets = (all, ids) => ids.flatMap((id) => all.filter((a) => a.ticket_id === id));

/** ?users=1,2: everything by pipeline ticket, soonest open due date first. ?done=1 includes completed tasks. */
r.get('/', (req, res) => {
  const tickets = new Map();
  assigned(usersFrom(req.query), req.query.done === '1').forEach((a) => {
    if (!tickets.has(a.ticket_id)) tickets.set(a.ticket_id, { id: a.ticket_id, title: a.ticket, organization: a.organization, stage: a.stage, tasks: [] });
    tickets.get(a.ticket_id).tasks.push(a);
  });
  const soonest = (t) => {
    const open = t.tasks.filter((a) => !a.done);
    return open.length ? open.map((a) => a.due_date).filter(Boolean).sort()[0] || '9998' : '9999';
  };
  res.json({ tickets: [...tickets.values()].sort((a, b) => soonest(a).localeCompare(soonest(b)) || a.title.localeCompare(b.title)) });
});

/** One person's tasks in sections. A task can sit in several. Every tier the person has gets a section, empty or not. ?done=1 includes completed tasks. */
r.get('/member/:id', (req, res) => {
  const id = Number(req.params.id);
  const withDone = req.query.done === '1';
  const all = assigned([id], withDone);
  const cardActivities = [...new Set(weekCards(id).map((c) => c.activity_id).filter(Boolean))];
  const onCards = tasks('k.id IN (SELECT value FROM json_each(?))', [JSON.stringify(cardActivities)], withDone);
  const { tiers, list } = priorityAccounts(id);
  const dated = all.filter((a) => a.due_date).sort((a, b) => a.done - b.done || (a.done ? b.due_date.localeCompare(a.due_date) : a.due_date.localeCompare(b.due_date)));
  res.json({
    sections: [
      { key: 'week', kind: 'week', title: 'This week’s priorities', tasks: cardActivities.flatMap((a) => onCards.filter((k) => k.id === a)), empty: 'No priorities assigned this week.' },
      { key: 'due', kind: 'due', title: 'By due date', tasks: dated, empty: 'No tasks with a due date.' },
      { key: 'strategic', kind: 'strategic', title: 'Strategic priority tickets', tasks: onTickets(all, list), empty: list.length ? 'No tasks on these tickets.' : 'No priority tickets chosen.' },
      ...tiers.map((t) => ({ key: `tier-${t.id}`, kind: 'tier', title: `Strategic: ${t.name}`, tasks: onTickets(all, tierTickets(t)), empty: 'No tasks on this tier’s tickets.' })),
    ],
  });
});

/** ?users=1,2: the numbers for a team's Task view, for each person and in total. A card two people share counts once in the total. */
r.get('/summary', (req, res) => {
  const ids = usersFrom(req.query);
  const today = localToday();
  const week = addDays(today, 7);
  const since = (days) => addDays(today, -days);
  const rows = db.prepare(`SELECT k.id, k.ticket_id, k.assignee_id, k.done, substr(k.done_at, 1, 10) AS done_on, k.due_date, k.waiting_client
    FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id WHERE k.assignee_id IN (SELECT value FROM json_each(?)) AND ${LIVE}`).all(JSON.stringify(ids));
  const subs = subtasksOf(rows.map((a) => a.id));
  const sharedCards = new Map();
  const people = db.prepare(`SELECT id, first_name || ' ' || last_name AS name FROM users WHERE id IN (SELECT value FROM json_each(?))
    ORDER BY last_name, first_name`).all(JSON.stringify(ids));
  const count = (xs, f) => xs.filter(f).length;
  const members = people.map((p) => {
    const mine = rows.filter((a) => a.assignee_id === p.id);
    const open = mine.filter((a) => !a.done);
    const done = mine.filter((a) => a.done);
    const taskIds = new Set(mine.map((a) => a.id));
    const mySubs = subs.filter((s) => taskIds.has(s.task_id));
    const cards = weekCards(p.id);
    cards.forEach((c) => sharedCards.set(c.id, c));
    const { tiers, list } = priorityAccounts(p.id);
    const onList = new Set(list);
    const onTiers = new Set(tiers.flatMap(tierTickets));
    return {
      id: p.id, name: p.name, open: open.length, done: done.length,
      overdue: count(open, (a) => a.due_date && a.due_date < today),
      dueSoon: count(open, (a) => a.due_date && a.due_date >= today && a.due_date <= week),
      undated: count(open, (a) => !a.due_date),
      waiting: count(open, (a) => a.waiting_client),
      weekOpen: count(cards, (c) => !c.completed), weekDone: count(cards, (c) => c.completed),
      strategic: count(open, (a) => onList.has(a.ticket_id)), tiered: count(open, (a) => onTiers.has(a.ticket_id)),
      done7: count(done, (a) => a.done_on >= since(6)), done30: count(done, (a) => a.done_on >= since(29)),
      subOpen: count(mySubs, (s) => !s.done), subDone: count(mySubs, (s) => s.done),
    };
  });
  const total = (k) => members.reduce((n, m) => n + m[k], 0);
  const cards = [...sharedCards.values()];
  res.json({
    members,
    totals: {
      ...Object.fromEntries(['open', 'done', 'overdue', 'dueSoon', 'undated', 'waiting', 'strategic', 'tiered', 'done7', 'done30', 'subOpen', 'subDone'].map((k) => [k, total(k)])),
      weekOpen: count(cards, (c) => !c.completed), weekDone: count(cards, (c) => c.completed),
    },
  });
});

export default r;
