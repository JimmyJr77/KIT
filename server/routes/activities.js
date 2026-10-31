// The Activity section on bid tickets. As in Pipedrive, an activity is a call, meeting, lunch and so on, with a date,
// the people taking part, and a checkbox for when it's done. Activities are the ticket's general tasks (ticket_tasks),
// so they also show in the Tasks pane.
import { Router } from 'express';
import { db } from '../db.js';
import { recordWork } from '../worklog.js';

const r = Router();

export const ACTIVITY_TYPES = ['Call', 'Meeting', 'Task', 'Deadline', 'Email', 'Lunch'];
export const ACTIVITY_PRIORITIES = ['High', 'Medium', 'Low'];
const TEXT = ['location', 'video_call', 'description', 'note', 'organization', 'phone', 'email', 'goals'];

const SELECT = `SELECT k.*, t.opportunity_title AS ticket_title, u.first_name || ' ' || u.last_name AS assignee_name
  FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN users u ON u.id = k.assignee_id`;
const touch = (id) => db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(id);

function withParticipants(rows) {
  if (!rows.length) return [];
  const people = db.prepare(`SELECT p.task_id, c.id, c.first_name, c.last_name, c.organization FROM task_participants p
    JOIN contacts c ON c.id = p.contact_id WHERE p.task_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rows.map((a) => a.id)));
  return rows.map(({ text, ...a }) => ({
    ...a, subject: text, activity_type: a.activity_type || 'Task', done: !!a.done, flagged: !!a.flagged,
    participants: people.filter((p) => p.task_id === a.id).map(({ task_id, ...c }) => c),
  }));
}
const one = (id) => withParticipants(db.prepare(`${SELECT} WHERE k.id = ?`).all(id))[0];

/** Check the body and turn it into columns. `partial` updates only the fields sent (e.g. just `done`). */
function clean(b, partial) {
  const out = {};
  const has = (k) => !partial || k in b;
  if (has('subject')) {
    out.text = String(b.subject || '').trim();
    if (!out.text) return { error: 'Give the activity a subject' };
  }
  TEXT.filter(has).forEach((k) => { out[k] = String(b[k] ?? '').trim() || null; });
  if (has('activity_type')) out.activity_type = ACTIVITY_TYPES.includes(b.activity_type) ? b.activity_type : 'Task';
  if (has('priority')) out.priority = ACTIVITY_PRIORITIES.includes(b.priority) ? b.priority : null;
  if (has('due_date')) out.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
  if (has('due_time')) out.due_time = /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : null;
  if (has('duration')) out.duration = /^\d{1,2}:\d{2}$/.test(b.duration || '') && b.duration !== '00:00' ? b.duration : null;
  if (has('flagged')) out.flagged = b.flagged ? 1 : 0;
  if (has('assignee_id')) out.assignee_id = Number(b.assignee_id) || null;
  if (has('ticket_id')) {
    const t = db.prepare("SELECT id FROM tickets WHERE id = ? AND ticket_type = 'bid'").get(Number(b.ticket_id));
    if (!t) return { error: 'Link the activity to a bid ticket' };
    out.ticket_id = t.id;
  }
  return { data: out };
}

const setParticipants = (id, ids) => {
  db.prepare('DELETE FROM task_participants WHERE task_id = ?').run(id);
  const add = db.prepare('INSERT OR IGNORE INTO task_participants (task_id, contact_id) VALUES (?, ?)');
  [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))].forEach((c) => add.run(id, c));
};
const nextPosition = (ticketId) => db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_tasks WHERE ticket_id = ?').get(ticketId).p;

/** ?ticket=ID: one ticket's activities. Open ones first, soonest first, then done ones, latest first. */
r.get('/', (req, res) => {
  const ticket = Number(req.query.ticket);
  if (!ticket) return res.status(400).json({ error: 'Which ticket?' });
  const rows = db.prepare(`${SELECT} WHERE k.ticket_id = ?
    ORDER BY k.done, CASE WHEN k.done THEN k.done_at END DESC, k.due_date IS NULL, k.due_date, k.due_time IS NULL, k.due_time, k.position, k.id`).all(ticket);
  res.json({ activities: withParticipants(rows), types: ACTIVITY_TYPES, priorities: ACTIVITY_PRIORITIES });
});

r.post('/', (req, res) => {
  const { data, error } = clean(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  const id = db.transaction(() => {
    const row = { ...data, position: nextPosition(data.ticket_id), created_by: req.user.id };
    const cols = Object.keys(row);
    const newId = db.prepare(`INSERT INTO ticket_tasks (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row).lastInsertRowid;
    setParticipants(newId, req.body.participants);
    touch(data.ticket_id);
    return newId;
  })();
  res.json({ activity: one(id) });
});

/** Any of the fields, `participants` (contact ids), and `done`. Moving it to another bid ticket takes `ticket_id`. */
r.put('/:id', (req, res) => {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Activity not found' });
  const b = req.body || {};
  const { data, error } = clean(b, true);
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    if (data.ticket_id && data.ticket_id !== k.ticket_id) data.position = nextPosition(data.ticket_id);
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE ticket_tasks SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...data, id: k.id });
    if ('participants' in b) setParticipants(k.id, b.participants);
    if (typeof b.done === 'boolean' && b.done !== !!k.done) {
      db.prepare("UPDATE ticket_tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?").run(b.done ? 1 : 0, b.done ? 1 : 0, k.id);
      if (b.done) recordWork(req.user, { kind: 'task', ticket_id: data.ticket_id || k.ticket_id, summary: data.text || k.text });
    }
    touch(k.ticket_id);
    if (data.ticket_id) touch(data.ticket_id);
  })();
  res.json({ activity: one(k.id) });
});

r.delete('/:id', (req, res) => {
  const k = db.prepare('SELECT ticket_id FROM ticket_tasks WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Activity not found' });
  db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(req.params.id);
  touch(k.ticket_id);
  res.json({ ok: true });
});

export default r;
