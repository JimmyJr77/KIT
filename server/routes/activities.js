// The Activity section on pipeline and work tickets. As in Pipedrive, an activity is a call, meeting, lunch and so on, with a
// date, the people taking part, and a checkbox for when it's done. A ticket's activities are its priorities, in order:
// the top open one is its next step. Each can have subtasks, and comments that show in the ticket's history. Priority
// cards on the Weekly Priorities board are activities placed in someone's week (see server/activities.js).
import { Router } from 'express';
import { db } from '../db.js';
import { recordWork, recordTicketUpdate } from '../worklog.js';
import { awardTokens } from '../race.js';
import {
  ACTIVITY_TYPES, ACTIVITY_PRIORITIES, nextPosition, openOrder, setOrder, subtasksOf, mirrorCards, syncMilestone,
} from '../activities.js';
import { COMMENT_SQL, commentOut } from './tickets.js';
import { queueDelete } from '../services/pipedrive.js';

const r = Router();

const TEXT = ['location', 'video_call', 'description', 'note', 'organization', 'phone', 'email', 'goals'];

const SELECT = `SELECT k.*, t.opportunity_title AS ticket_title, t.ticket_type, u.first_name || ' ' || u.last_name AS assignee_name,
    c.first_name || ' ' || c.last_name AS created_by_name
  FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN users c ON c.id = k.created_by`;
const touch = (id) => db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(id);

function withDetails(rows) {
  if (!rows.length) return [];
  const ids = JSON.stringify(rows.map((a) => a.id));
  const people = db.prepare(`SELECT p.task_id, c.id, c.first_name, c.last_name, c.organization FROM task_participants p
    JOIN contacts c ON c.id = p.contact_id WHERE p.task_id IN (SELECT value FROM json_each(?))`).all(ids);
  const subs = subtasksOf(rows.map((a) => a.id));
  const comments = db.prepare(`SELECT target_type, target_id, COUNT(*) AS n FROM ticket_comments
    WHERE parent_id IS NULL AND ((target_type = 'activity' AND target_id IN (SELECT value FROM json_each(@ids)))
      OR (target_type = 'subtask' AND target_id IN (SELECT id FROM activity_subtasks WHERE task_id IN (SELECT value FROM json_each(@ids)))))
    GROUP BY target_type, target_id`).all({ ids });
  const count = (type, id) => comments.find((c) => c.target_type === type && c.target_id === id)?.n || 0;
  const cards = db.prepare(`SELECT c.id, c.activity_id, c.week_start, c.team_id, tm.name AS team_name FROM priority_cards c
    JOIN teams tm ON tm.id = c.team_id WHERE c.archived_at IS NULL AND c.activity_id IN (SELECT value FROM json_each(?)) ORDER BY c.week_start DESC`).all(ids);
  const ranks = new Map();
  [...new Set(rows.map((a) => a.ticket_id))].forEach((t) => openOrder(t).forEach((id, i) => ranks.set(id, i + 1)));
  return rows.map(({ text, ...a }) => ({
    ...a, subject: text, activity_type: a.activity_type || 'Task', done: !!a.done, flagged: !!a.flagged, waiting_client: !!a.waiting_client, rank: ranks.get(a.id) ?? null,
    participants: people.filter((p) => p.task_id === a.id).map(({ task_id, ...c }) => c),
    subtasks: subs.filter((s) => s.task_id === a.id).map((s) => ({ ...s, comment_count: count('subtask', s.id) })),
    comment_count: count('activity', a.id),
    cards: cards.filter((c) => c.activity_id === a.id).map(({ activity_id, ...c }) => c),
  }));
}
const one = (id) => withDetails(db.prepare(`${SELECT} WHERE k.id = ?`).all(id))[0];

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
  if (has('waiting_client')) out.waiting_client = b.waiting_client ? 1 : 0;
  if (has('assignee_id')) out.assignee_id = Number(b.assignee_id) || null;
  if (has('ticket_id')) {
    const t = db.prepare('SELECT id FROM tickets WHERE id = ?').get(Number(b.ticket_id));
    if (!t) return { error: 'Link the activity to a ticket' };
    out.ticket_id = t.id;
  }
  return { data: out };
}

const setParticipants = (id, ids) => {
  db.prepare('DELETE FROM task_participants WHERE task_id = ?').run(id);
  const add = db.prepare('INSERT OR IGNORE INTO task_participants (task_id, contact_id) VALUES (?, ?)');
  [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Boolean))].forEach((c) => add.run(id, c));
};

/** ?ticket=ID: one ticket's activities. Open ones in priority order (the first is the next step), then done ones, latest first. */
r.get('/', (req, res) => {
  const ticket = Number(req.query.ticket);
  if (!ticket) return res.status(400).json({ error: 'Which ticket?' });
  const rows = db.prepare(`${SELECT} WHERE k.ticket_id = ? ORDER BY k.done, CASE WHEN k.done THEN k.done_at END DESC, k.position, k.id`).all(ticket);
  res.json({ activities: withDetails(rows), types: ACTIVITY_TYPES, priorities: ACTIVITY_PRIORITIES });
});

/** One activity with the comments on it and its subtasks (each with its replies), oldest first. */
r.get('/:id', (req, res) => {
  const a = one(req.params.id);
  if (!a) return res.status(404).json({ error: 'Activity not found' });
  const subIds = JSON.stringify(a.subtasks.map((s) => s.id));
  const top = db.prepare(`${COMMENT_SQL} WHERE m.parent_id IS NULL AND ((m.target_type = 'activity' AND m.target_id = ?)
    OR (m.target_type = 'subtask' AND m.target_id IN (SELECT value FROM json_each(?)))) ORDER BY m.created_at, m.id`).all(a.id, subIds).map(commentOut);
  const replies = top.length ? db.prepare(`${COMMENT_SQL} WHERE m.parent_id IN (SELECT value FROM json_each(?)) ORDER BY m.created_at, m.id`)
    .all(JSON.stringify(top.map((m) => m.id))).map(commentOut) : [];
  res.json({ activity: a, comments: top.map((m) => ({ ...m, replies: replies.filter((x) => x.parent_id === m.id) })), types: ACTIVITY_TYPES, priorities: ACTIVITY_PRIORITIES });
});

/** Body: activity fields, `participants` (contact ids) and `subtasks` (texts). New activities go to the bottom of the ticket's list. */
r.post('/', (req, res) => {
  const { data, error } = clean(req.body || {}, false);
  if (error) return res.status(400).json({ error });
  const id = db.transaction(() => {
    const row = { ...data, position: nextPosition(data.ticket_id), created_by: req.user.id };
    const cols = Object.keys(row);
    const newId = db.prepare(`INSERT INTO ticket_tasks (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row).lastInsertRowid;
    setParticipants(newId, req.body.participants);
    const add = db.prepare('INSERT INTO activity_subtasks (task_id, text, position, created_by) VALUES (?, ?, ?, ?)');
    (Array.isArray(req.body.subtasks) ? req.body.subtasks : []).map((s) => String(s || '').trim()).filter(Boolean).forEach((s, i) => add.run(newId, s, i, req.user.id));
    touch(data.ticket_id);
    syncMilestone(data.ticket_id);
    return newId;
  })();
  recordTicketUpdate(req.user, db.prepare('SELECT id, created_by FROM tickets WHERE id = ?').get(data.ticket_id), `Activity added: ${data.text}`);
  res.json({ activity: one(id) });
});

/** Body: { ticket_id, ids }. The ticket's open activities in this order; the first is its next step. */
r.put('/order', (req, res) => {
  const ticketId = Number(req.body?.ticket_id);
  if (!db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId)) return res.status(404).json({ error: 'Ticket not found' });
  db.transaction(() => { setOrder(ticketId, Array.isArray(req.body?.ids) ? req.body.ids : []); touch(ticketId); })();
  res.json({ ok: true });
});

/** Any of the fields, `participants` (contact ids), and `done`. Moving it to another ticket takes `ticket_id`. */
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
      // Reopened, it goes back to the bottom of the open list rather than jumping the queue.
      db.prepare("UPDATE ticket_tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END, position = CASE WHEN ? THEN position ELSE ? END WHERE id = ?")
        .run(b.done ? 1 : 0, b.done ? 1 : 0, b.done ? 1 : 0, nextPosition(k.ticket_id), k.id);
      if (b.done) {
        recordWork(req.user, { kind: 'task', ticket_id: data.ticket_id || k.ticket_id, summary: data.text || k.text });
        awardTokens(req.user, 'task', k.id);
      }
    }
    mirrorCards(k.id);
    [...new Set([k.ticket_id, data.ticket_id].filter(Boolean))].forEach((t) => { touch(t); syncMilestone(t); });
  })();
  // Finishing it is logged above as a completed task; any other edit counts as an update to the ticket.
  if (!(typeof b.done === 'boolean' && b.done !== !!k.done && b.done)) {
    recordTicketUpdate(req.user, db.prepare('SELECT id, created_by FROM tickets WHERE id = ?').get(data.ticket_id || k.ticket_id), `Activity edited: ${data.text || k.text}`);
  }
  res.json({ activity: one(k.id) });
});

r.delete('/:id', (req, res) => {
  const k = db.prepare('SELECT k.ticket_id, k.pipedrive_id, t.pipedrive_id AS deal_id FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id WHERE k.id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Activity not found' });
  db.transaction(() => {
    queueDelete('activity', k.pipedrive_id, k.deal_id); // a Pipedrive activity: deleted there when an admin sends
    // Its comments stay on the ticket, as plain comments.
    db.prepare("UPDATE ticket_comments SET target_type = NULL, target_id = NULL WHERE (target_type = 'activity' AND target_id = ?) OR (target_type = 'subtask' AND target_id IN (SELECT id FROM activity_subtasks WHERE task_id = ?))")
      .run(req.params.id, req.params.id);
    db.prepare('DELETE FROM priority_cards WHERE activity_id = ?').run(req.params.id);
    db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(req.params.id);
    touch(k.ticket_id);
    syncMilestone(k.ticket_id);
  })();
  res.json({ ok: true });
});

// ---- Subtasks: the checklist under an activity

r.post('/:id/subtasks', (req, res) => {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(req.params.id);
  if (!k) return res.status(404).json({ error: 'Activity not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write the subtask first' });
  db.transaction(() => {
    const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM activity_subtasks WHERE task_id = ?').get(k.id).p;
    db.prepare('INSERT INTO activity_subtasks (task_id, text, position, created_by) VALUES (?, ?, ?, ?)').run(k.id, text, pos, req.user.id);
    mirrorCards(k.id);
    touch(k.ticket_id);
  })();
  res.json({ activity: one(k.id) });
});

/** Body: { text?, done? }. */
r.put('/subtasks/:id', (req, res) => {
  const s = db.prepare('SELECT s.*, k.ticket_id FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id WHERE s.id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Subtask not found' });
  const b = req.body || {};
  db.transaction(() => {
    if (typeof b.text === 'string') {
      if (!b.text.trim()) throw Object.assign(new Error('A subtask can’t be empty'), { status: 400 });
      db.prepare('UPDATE activity_subtasks SET text = ? WHERE id = ?').run(b.text.trim(), s.id);
    }
    if (typeof b.done === 'boolean' && b.done !== !!s.done) {
      db.prepare("UPDATE activity_subtasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?").run(b.done ? 1 : 0, b.done ? 1 : 0, s.id);
      if (b.done) {
        recordWork(req.user, { kind: 'task', ticket_id: s.ticket_id, summary: s.text });
        awardTokens(req.user, 'subtask', s.id);
      }
    }
    mirrorCards(s.task_id);
    touch(s.ticket_id);
  })();
  res.json({ activity: one(s.task_id) });
});

r.delete('/subtasks/:id', (req, res) => {
  const s = db.prepare('SELECT s.*, k.ticket_id FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id WHERE s.id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Subtask not found' });
  db.transaction(() => {
    db.prepare("UPDATE ticket_comments SET target_type = 'activity', target_id = ? WHERE target_type = 'subtask' AND target_id = ?").run(s.task_id, s.id);
    db.prepare('DELETE FROM activity_subtasks WHERE id = ?').run(s.id);
    mirrorCards(s.task_id);
    touch(s.ticket_id);
  })();
  res.json({ activity: one(s.task_id) });
});

r.use((err, req, res, next) => (err.status ? res.status(err.status).json({ error: err.message }) : next(err)));

export default r;
