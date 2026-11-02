// Activities are a ticket's priorities, in order (ticket_tasks.position): the top open one is the ticket's next step.
// A priority card is one activity placed in someone's week, and keeps the activity's subject, due date, subtasks and
// done state as its own title, due date, checklist and completion, so everything that reads cards keeps working.
import { db, json } from './db.js';

export const ACTIVITY_TYPES = ['Call', 'Meeting', 'Task', 'Deadline', 'Email', 'Lunch'];
export const ACTIVITY_PRIORITIES = ['High', 'Medium', 'Low'];

/** Where a new activity goes on its ticket: the bottom. */
export const nextPosition = (ticketId) => db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_tasks WHERE ticket_id = ?').get(ticketId).p;

/** Open activity ids on a ticket, top priority first. */
export const openOrder = (ticketId) => db.prepare('SELECT id FROM ticket_tasks WHERE ticket_id = ? AND done = 0 ORDER BY position, id').all(ticketId).map((k) => k.id);

/** An open activity's place among its ticket's open activities (1 = the next step), or null when it's done. */
export function rankOf(activityId) {
  const k = db.prepare('SELECT ticket_id, done FROM ticket_tasks WHERE id = ?').get(activityId);
  if (!k || k.done) return null;
  return openOrder(k.ticket_id).indexOf(Number(activityId)) + 1 || null;
}

/** Put a ticket's open activities in this order (ids not listed keep their place after them); done ones follow. */
export function setOrder(ticketId, ids) {
  const open = openOrder(ticketId);
  const wanted = ids.map(Number).filter((id) => open.includes(id));
  const order = [...wanted, ...open.filter((id) => !wanted.includes(id))];
  const done = db.prepare('SELECT id FROM ticket_tasks WHERE ticket_id = ? AND done = 1 ORDER BY position, id').all(ticketId).map((k) => k.id);
  const set = db.prepare('UPDATE ticket_tasks SET position = ? WHERE id = ?');
  [...order, ...done].forEach((id, i) => set.run(i, id));
  syncMilestone(ticketId);
}

/**
 * Some of a ticket's activities, in the order given, take the places those same activities held: the rest of the list
 * doesn't move. This is how reordering priorities on the board reorders them on their ticket.
 */
export function reorderWithin(ticketId, ids) {
  const open = openOrder(ticketId);
  const moving = ids.map(Number).filter((id) => open.includes(id));
  if (moving.length < 2) return false;
  const slots = open.map((id, i) => (moving.includes(id) ? i : -1)).filter((i) => i >= 0);
  const next = [...open];
  slots.forEach((slot, n) => { next[slot] = moving[n]; });
  if (next.every((id, i) => id === open[i])) return false;
  setOrder(ticketId, next);
  return true;
}

export const subtasksOf = (activityIds) => (activityIds.length
  ? db.prepare('SELECT * FROM activity_subtasks WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY position, id').all(JSON.stringify(activityIds))
    .map((s) => ({ id: s.id, task_id: s.task_id, text: s.text, done: !!s.done, done_at: s.done_at, position: s.position }))
  : []);

/** Cards placed from this activity take its subject, due date, subtasks and done state. */
export function mirrorCards(activityId) {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(activityId);
  if (!k) return;
  const checklist = subtasksOf([k.id]).map((s) => ({ text: s.text, done: s.done }));
  db.prepare("UPDATE priority_cards SET title = ?, due_date = ?, completed = ?, checklist = ?, updated_at = datetime('now') WHERE activity_id = ?")
    .run(k.text, k.due_date, k.done ? 1 : 0, json.str(checklist), k.id);
}

/** Replace an activity's subtasks with a card checklist, matching items by position so their comments stay put. */
export function setSubtasksFromChecklist(activityId, list, userId) {
  const subs = subtasksOf([activityId]);
  const items = (Array.isArray(list) ? list : []).map((i) => ({ text: String(i.text || '').trim(), done: !!i.done })).filter((i) => i.text);
  const update = db.prepare("UPDATE activity_subtasks SET text = ?, done = ?, done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) END, position = ? WHERE id = ?");
  const add = db.prepare('INSERT INTO activity_subtasks (task_id, text, done, done_at, position, created_by) VALUES (?, ?, ?, CASE WHEN ? THEN datetime(\'now\') END, ?, ?)');
  items.forEach((i, n) => (subs[n] ? update.run(i.text, i.done ? 1 : 0, i.done ? 1 : 0, n, subs[n].id) : add.run(activityId, i.text, i.done ? 1 : 0, i.done ? 1 : 0, n, userId)));
  subs.slice(items.length).forEach((s) => db.prepare('DELETE FROM activity_subtasks WHERE id = ?').run(s.id));
}

/** The win assessment's "Next milestone" follows the ticket's next step. */
export function syncMilestone(ticketId) {
  const next = db.prepare('SELECT text FROM ticket_tasks WHERE ticket_id = ? AND done = 0 ORDER BY position, id LIMIT 1').get(ticketId);
  const t = db.prepare('SELECT assessment FROM tickets WHERE id = ?').get(ticketId);
  if (!next || !t) return;
  const a = json.parse(t.assessment, {});
  if (a.momentum?.answers?.milestone === next.text) return;
  a.momentum = { score: a.momentum?.score ?? null, answers: { ...(a.momentum?.answers || {}), milestone: next.text } };
  db.prepare('UPDATE tickets SET assessment = ? WHERE id = ?').run(json.str(a), ticketId);
}

/** SQL for a ticket's next step as JSON (or null), for ticket lists. `t` is the tickets alias. */
export const NEXT_STEP_SQL = `(SELECT json_object('id', k.id, 'subject', k.text, 'due_date', k.due_date, 'due_time', k.due_time, 'created_at', k.created_at, 'waiting_client', k.waiting_client)
  FROM ticket_tasks k WHERE k.ticket_id = t.id AND k.done = 0 ORDER BY k.position, k.id LIMIT 1)`;
