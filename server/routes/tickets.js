// Master tickets: the list of a user's tickets, each ticket's full timeline,
// question/comment threads, and document uploads.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting } from '../db.js';
import { CRITERIA, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin } from '../../src/lib/assessment.js';
import { LANES, laneFor, isArchived } from '../../src/lib/lanes.js';
import { recordWork } from '../worklog.js';
import { notifyMentions } from '../mentions.js';
import { PIPELINE_STATUSES, ticketFields } from './priorities.js';

const r = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const KINDS = ['question', 'comment'];
const author = (row, prefix = '') => (row[`${prefix}first_name`]
  ? { id: row[`${prefix}author_id`] ?? row.author_id, first_name: row[`${prefix}first_name`], last_name: row[`${prefix}last_name`] }
  : null);

const COMMENT_SQL = `SELECT m.*, u.first_name, u.last_name, c.title AS card_title, tk.opportunity_title AS ticket_title,
    (SELECT COUNT(*) FROM ticket_comments x WHERE x.parent_id = m.id) AS reply_count,
    (SELECT MAX(x.created_at) FROM ticket_comments x WHERE x.parent_id = m.id) AS last_reply_at,
    (SELECT GROUP_CONCAT(a.user_id) FROM card_assignees a WHERE a.card_id = m.card_id) AS card_assignee_ids
  FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id LEFT JOIN priority_cards c ON c.id = m.card_id
  JOIN tickets tk ON tk.id = m.ticket_id`;

const commentOut = (m) => ({
  id: m.id, ticket_id: m.ticket_id, ticket_title: m.ticket_title, card_id: m.card_id, card_title: m.card_title, parent_id: m.parent_id,
  kind: m.kind, body: m.body, created_at: m.created_at, updated_at: m.updated_at ?? null, author: author(m),
  target_type: m.target_type ?? null, target_id: m.target_id ?? null,
  reply_count: m.reply_count ?? 0, last_reply_at: m.last_reply_at ?? null,
  card_assignee_ids: m.card_assignee_ids ? String(m.card_assignee_ids).split(',').map(Number) : [],
});

/** Top-level comments about a priority on the given master tickets, newest first. Ticket-wide comments are left out. */
export function loadThreads(ticketIds) {
  if (!ticketIds.length) return [];
  return db.prepare(`${COMMENT_SQL} WHERE m.parent_id IS NULL AND m.card_id IS NOT NULL AND m.ticket_id IN (${ticketIds.map(() => '?').join(',')})
    ORDER BY m.created_at DESC, m.id DESC`).all(...ticketIds).map(commentOut);
}

const ticketRow = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);

// ---- A user's master tickets

// ---- PWIN settings: weights and must-have areas (one set for everyone, kept in settings)

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/** The PWIN model in use: saved custom weights and must-haves, or the defaults. */
export function pwinModel() {
  const saved = json.parse(getSetting('pwin_weights'), null);
  const gates = json.parse(getSetting('pwin_gates'), null);
  return {
    weights: Object.fromEntries(CRITERIA.map((c) => [c.key, Number.isFinite(saved?.[c.key]) ? saved[c.key] : DEFAULT_PWIN_WEIGHTS[c.key]])),
    gates: Array.isArray(gates) ? gates.filter((k) => CRITERIA.some((c) => c.key === k)) : DEFAULT_PWIN_GATES,
  };
}
const ticketPwin = (t, model = pwinModel()) => (t.ticket_type === 'work' ? null : pwin(json.parse(t.assessment, {}), model.weights, model.gates));

function weightsOut() {
  const { weights, gates } = pwinModel();
  const by = Number(getSetting('pwin_weights_updated_by'));
  const u = by && db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(by);
  return {
    weights,
    gates,
    defaults: DEFAULT_PWIN_WEIGHTS,
    default_gates: DEFAULT_PWIN_GATES,
    custom: CRITERIA.some((c) => weights[c.key] !== DEFAULT_PWIN_WEIGHTS[c.key]) || !sameSet(gates, DEFAULT_PWIN_GATES),
    updated_at: getSetting('pwin_weights_updated_at') || null,
    updated_by: u ? `${u.first_name} ${u.last_name}` : null,
  };
}

r.get('/pwin-weights', (req, res) => res.json(weightsOut()));

/** Body: { weights: { [criterion]: 0–100 }, gates: [criterion, ...] }. Weights are relative, so they needn't add up to 100. */
r.put('/pwin-weights', (req, res) => {
  const input = req.body?.weights || {};
  const weights = {};
  for (const c of CRITERIA) {
    const w = Number(input[c.key] ?? 0);
    if (!Number.isFinite(w) || w < 0 || w > 100) return res.status(400).json({ error: `${c.title}: weight must be 0–100` });
    weights[c.key] = Math.round(w);
  }
  if (!Object.values(weights).some(Boolean)) return res.status(400).json({ error: 'At least one area needs some weight' });
  const gates = Array.isArray(req.body?.gates) ? CRITERIA.map((c) => c.key).filter((k) => req.body.gates.includes(k)) : pwinModel().gates;
  setSetting('pwin_weights', json.str(weights));
  setSetting('pwin_gates', json.str(gates));
  setSetting('pwin_weights_updated_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
  setSetting('pwin_weights_updated_by', req.user.id);
  res.json(weightsOut());
});

/** People who own (created) at least one master ticket, for the Tickets page filter. */
r.get('/owners', (req, res) => {
  res.json({ owners: db.prepare(`SELECT u.id, u.first_name, u.last_name, u.team_id, tm.name AS team_name, COUNT(t.id) AS ticket_count
    FROM tickets t JOIN users u ON u.id = t.created_by LEFT JOIN teams tm ON tm.id = u.team_id
    GROUP BY u.id ORDER BY u.last_name, u.first_name`).all() });
});

/**
 * Master tickets. scope: mine (default) | all | filter. Outside "mine", `team` keeps tickets whose owner is
 * on that team. In any scope, `owners` (comma-separated user ids) keeps those owners' tickets and `types`
 * (comma-separated account types) keeps those account types.
 */
r.get('/', (req, res) => {
  const scope = ['all', 'filter'].includes(req.query.scope) ? req.query.scope : 'mine';
  const q = `%${req.query.q || ''}%`;
  const team = scope !== 'mine' && Number(req.query.team) ? Number(req.query.team) : null;
  const owners = String(req.query.owners || '').split(',').map(Number).filter(Boolean);
  const types = String(req.query.types || '').split(',').filter(Boolean);
  const kind = ['bid', 'work'].includes(req.query.kind) ? req.query.kind : null; // bid or work tickets only
  const rows = db.prepare(`SELECT t.*, o.first_name AS owner_first_name, o.last_name AS owner_last_name, ot.name AS owner_team,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'question') AS question_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'comment') AS comment_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count,
      MAX(t.updated_at,
        COALESCE((SELECT MAX(c.updated_at) FROM priority_cards c WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(MAX(m.created_at, COALESCE(m.updated_at, ''))) FROM ticket_comments m WHERE m.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(MAX(n.created_at, COALESCE(n.updated_at, ''))) FROM card_notes n JOIN priority_cards c ON c.id = n.card_id WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(f.created_at) FROM ticket_files f WHERE f.ticket_id = t.id), '')) AS last_activity
    FROM tickets t LEFT JOIN users o ON o.id = t.created_by LEFT JOIN teams ot ON ot.id = o.team_id
    WHERE (t.opportunity_title LIKE @q OR t.organization LIKE @q)
      AND (@mine = 0 OR t.created_by = @me OR EXISTS (SELECT 1 FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
        WHERE c.ticket_id = t.id AND a.user_id = @me))
      AND (@team IS NULL OR o.team_id = @team)
      AND (@owners = '[]' OR t.created_by IN (SELECT value FROM json_each(@owners)))
      AND (@types = '[]' OR t.account_type IN (SELECT value FROM json_each(@types)))
      AND (@kind IS NULL OR t.ticket_type = @kind)
    ORDER BY last_activity DESC`).all({ q, mine: scope === 'mine' ? 1 : 0, me: req.user.id, team, owners: JSON.stringify(owners), types: JSON.stringify(types), kind });
  // Task counts come from each card's checklist JSON.
  const lists = db.prepare('SELECT ticket_id, checklist FROM priority_cards').all();
  const tasks = {};
  lists.forEach((c) => json.parse(c.checklist, []).forEach((i) => {
    const t = (tasks[c.ticket_id] ||= { open: 0, done: 0 });
    t[i.done ? 'done' : 'open'] += 1;
  }));
  db.prepare('SELECT ticket_id, done FROM ticket_tasks').all().forEach((k) => {
    const t = (tasks[k.ticket_id] ||= { open: 0, done: 0 });
    t[k.done ? 'done' : 'open'] += 1;
  });
  const model = pwinModel();
  res.json({ tickets: rows.map((t) => {
    const lane = laneFor(t);
    return { ...t, tasks: tasks[t.id] || { open: 0, done: 0 }, pwin: ticketPwin(t, model), lane, archived: isArchived(t, lane) };
  }) });
});

/** Create a ticket on its own, without a priority. Body: { ticket_type: 'bid' | 'work', opportunity_title, organization, account_type, pipeline_status, value }. */
r.post('/', (req, res) => {
  const type = req.body?.ticket_type === 'work' ? 'work' : 'bid';
  const tf = ticketFields(req.body);
  if (!tf.opportunity_title) return res.status(400).json({ error: type === 'work' ? 'Title is required' : 'Opportunity title is required' });
  const fields = type === 'work' ? { ...tf, pipeline_status: null, value: null } : tf;
  const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, value, ticket_type, created_by)
    VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @value, @ticket_type, @created_by)`)
    .run({ ...fields, ticket_type: type, created_by: req.user.id }).lastInsertRowid;
  recordWork(req.user, { kind: 'ticket', ticket_id: id, summary: fields.opportunity_title });
  res.json({ ticket: ticketRow(id) });
});

// ---- Ticket-wide tasks, strategy and win assessment

const touch = (id) => db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(id);
const nameOf = (id) => {
  const u = id && db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(id);
  return u ? `${u.first_name} ${u.last_name}` : null;
};

/** Every task on the ticket: its own general tasks, and each priority card's checklist. */
r.get('/:id/tasks', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const general = db.prepare('SELECT id, text, done, created_at, done_at FROM ticket_tasks WHERE ticket_id = ? ORDER BY position, id').all(t.id)
    .map((x) => ({ ...x, done: !!x.done }));
  const cards = db.prepare('SELECT id, title, week_start, is_planned, completed, checklist FROM priority_cards WHERE ticket_id = ? ORDER BY week_start DESC, id')
    .all(t.id).map((c) => ({ ...c, is_planned: !!c.is_planned, completed: !!c.completed, checklist: json.parse(c.checklist, []) }))
    .filter((c) => c.checklist.length);
  res.json({ general, cards });
});

r.post('/:id/tasks', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write the task first' });
  const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_tasks WHERE ticket_id = ?').get(t.id).p;
  const id = db.prepare('INSERT INTO ticket_tasks (ticket_id, text, position, created_by) VALUES (?, ?, ?, ?)').run(t.id, text, pos, req.user.id).lastInsertRowid;
  touch(t.id);
  res.json({ task: { ...db.prepare('SELECT id, text, done, created_at, done_at FROM ticket_tasks WHERE id = ?').get(id), done: false } });
});

/** Check off or rename a general task. Finished tasks move to the end of the list. */
r.put('/tasks/:taskId', (req, res) => {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(req.params.taskId);
  if (!k) return res.status(404).json({ error: 'Task not found' });
  const b = req.body || {};
  if (typeof b.text === 'string') {
    if (!b.text.trim()) return res.status(400).json({ error: 'A task can’t be empty' });
    db.prepare('UPDATE ticket_tasks SET text = ? WHERE id = ?').run(b.text.trim(), k.id);
  }
  if (typeof b.done === 'boolean' && b.done !== !!k.done) {
    const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_tasks WHERE ticket_id = ?').get(k.ticket_id).p;
    db.prepare("UPDATE ticket_tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END, position = ? WHERE id = ?")
      .run(b.done ? 1 : 0, b.done ? 1 : 0, pos, k.id);
    if (b.done) recordWork(req.user, { kind: 'task', ticket_id: k.ticket_id, summary: k.text });
  }
  touch(k.ticket_id);
  const x = db.prepare('SELECT id, text, done, created_at, done_at FROM ticket_tasks WHERE id = ?').get(k.id);
  res.json({ task: { ...x, done: !!x.done } });
});

r.delete('/tasks/:taskId', (req, res) => {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(req.params.taskId);
  if (!k) return res.status(404).json({ error: 'Task not found' });
  db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(k.id);
  touch(k.ticket_id);
  res.json({ ok: true });
});

// ---- Next major steps

const STEP_SQL = `SELECT s.*, u.first_name, u.last_name FROM ticket_steps s LEFT JOIN users u ON u.id = s.author_id`;
const stepOut = (s) => ({
  id: s.id, text: s.text, done: !!s.done, done_at: s.done_at, is_next: !!s.is_next, created_at: s.created_at, updated_at: s.updated_at,
  author: s.first_name ? { id: s.author_id, first_name: s.first_name, last_name: s.last_name } : null,
});
const stepRow = (id) => db.prepare('SELECT * FROM ticket_steps WHERE id = ?').get(id);
const listSteps = (ticketId) => db.prepare(`${STEP_SQL} WHERE s.ticket_id = ? ORDER BY s.position, s.id DESC`).all(ticketId).map(stepOut);

/** Copy the flagged next step into the win assessment's "Next milestone". */
function syncMilestone(ticketId) {
  const next = db.prepare('SELECT text FROM ticket_steps WHERE ticket_id = ? AND is_next = 1').get(ticketId);
  if (!next) return;
  const a = json.parse(ticketRow(ticketId).assessment, {});
  a.momentum = { score: a.momentum?.score ?? null, answers: { ...(a.momentum?.answers || {}), milestone: next.text } };
  db.prepare("UPDATE tickets SET assessment = ?, assessment_updated_at = datetime('now') WHERE id = ?").run(json.str(a), ticketId);
}

r.get('/:id/steps', (req, res) => {
  if (!ticketRow(req.params.id)) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ steps: listSteps(req.params.id) });
});

/** New steps go on top. */
r.post('/:id/steps', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Describe the step first' });
  const top = db.prepare('SELECT COALESCE(MIN(position) - 1, 0) AS p FROM ticket_steps WHERE ticket_id = ?').get(t.id).p;
  const id = db.prepare('INSERT INTO ticket_steps (ticket_id, text, position, author_id) VALUES (?, ?, ?, ?)').run(t.id, text, top, req.user.id).lastInsertRowid;
  recordWork(req.user, { kind: 'step', ticket_id: t.id, ref_id: id, summary: text });
  touch(t.id);
  res.json({ steps: listSteps(t.id) });
});

/** Body: { ids: [stepId, ...] } in the new top-to-bottom order. */
r.put('/:id/steps/order', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const ids = (req.body?.ids || []).map(Number);
  const set = db.prepare('UPDATE ticket_steps SET position = ? WHERE id = ? AND ticket_id = ?');
  db.transaction(() => ids.forEach((id, i) => set.run(i, id, t.id)))();
  touch(t.id);
  res.json({ steps: listSteps(t.id) });
});

/**
 * Update one step. Body may hold: text (author only), done, next (true flags it as the next step and
 * clears any other; finishing the next step unflags it).
 */
r.put('/steps/:sid', (req, res) => {
  const s = stepRow(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Step not found' });
  const b = req.body || {};
  if (typeof b.text === 'string') {
    if (s.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can edit this step' });
    if (!b.text.trim()) return res.status(400).json({ error: 'A step can’t be empty' });
    db.prepare("UPDATE ticket_steps SET text = ?, updated_at = datetime('now') WHERE id = ?").run(b.text.trim(), s.id);
  }
  if (typeof b.done === 'boolean') {
    db.prepare("UPDATE ticket_steps SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END, is_next = CASE WHEN ? THEN 0 ELSE is_next END WHERE id = ?")
      .run(b.done ? 1 : 0, b.done ? 1 : 0, b.done ? 1 : 0, s.id);
  }
  if (typeof b.next === 'boolean') {
    db.transaction(() => {
      if (b.next) db.prepare('UPDATE ticket_steps SET is_next = 0 WHERE ticket_id = ?').run(s.ticket_id);
      db.prepare('UPDATE ticket_steps SET is_next = ?, done = CASE WHEN ? THEN 0 ELSE done END, done_at = CASE WHEN ? THEN NULL ELSE done_at END WHERE id = ?')
        .run(b.next ? 1 : 0, b.next ? 1 : 0, b.next ? 1 : 0, s.id);
    })();
  }
  syncMilestone(s.ticket_id);
  touch(s.ticket_id);
  res.json({ steps: listSteps(s.ticket_id) });
});

r.delete('/steps/:sid', (req, res) => {
  const s = stepRow(req.params.sid);
  if (!s) return res.status(404).json({ error: 'Step not found' });
  if (s.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this step' });
  db.prepare('DELETE FROM ticket_steps WHERE id = ?').run(s.id);
  db.prepare("DELETE FROM work_log WHERE kind = 'step' AND ref_id = ?").run(s.id);
  touch(s.ticket_id);
  res.json({ steps: listSteps(s.ticket_id) });
});

/** The ticket's win strategy and win assessment, with who last saved each. */
r.get('/:id/plan', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json({
    strategy: t.strategy || '', strategy_updated_at: t.strategy_updated_at, strategy_updated_by: nameOf(t.strategy_updated_by),
    assessment: json.parse(t.assessment, {}), assessment_updated_at: t.assessment_updated_at, assessment_updated_by: nameOf(t.assessment_updated_by),
  });
});

r.put('/:id/strategy', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare("UPDATE tickets SET strategy = ?, strategy_updated_at = datetime('now'), strategy_updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(req.body?.strategy ?? ''), req.user.id, t.id);
  res.json({ ok: true, strategy_updated_at: ticketRow(t.id).strategy_updated_at, strategy_updated_by: nameOf(req.user.id) });
});

/** Body: { assessment: { [criterion]: { score: 1–5 | null, answers: { [prompt]: string } } } }. */
r.put('/:id/assessment', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const input = req.body?.assessment;
  if (!input || typeof input !== 'object') return res.status(400).json({ error: 'Nothing to save' });
  const clean = {};
  for (const [key, v] of Object.entries(input)) {
    const score = Number(v?.score);
    clean[key] = {
      score: score >= 1 && score <= 5 ? Math.round(score) : null,
      answers: Object.fromEntries(Object.entries(v?.answers || {}).map(([k, a]) => [k, String(a ?? '').slice(0, 4000)])),
    };
  }
  db.prepare("UPDATE tickets SET assessment = ?, assessment_updated_at = datetime('now'), assessment_updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(json.str(clean), req.user.id, t.id);
  res.json({ ok: true, assessment_updated_at: ticketRow(t.id).assessment_updated_at, assessment_updated_by: nameOf(req.user.id) });
});

/**
 * Swim lane changes. Body may hold:
 *   lane     move it to that lane (a bid ticket moved by hand is locked there)
 *   locked   lock a bid ticket in `lane`, or unlock it so it moves on its own again
 *   archived archive a Done ticket now, or restore an archived one to Done
 * None of this counts as activity, so it doesn't reset the ticket's timer.
 */
r.put('/:id/lane', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const lane = b.lane;
  if (lane != null && !LANES.some((l) => l.key === lane)) return res.status(400).json({ error: 'Unknown lane' });
  const set = (sql, ...args) => db.prepare(`UPDATE tickets SET ${sql} WHERE id = ?`).run(...args, t.id);

  if (lane) {
    if (t.ticket_type === 'bid' && ['Awarded', 'Lost', 'No Bid'].includes(t.pipeline_status) && lane !== 'done') {
      return res.status(400).json({ error: `This bid is ${t.pipeline_status}, so it stays in Done. Change its pipeline stage to reopen it.` });
    }
    set(`lane = ?, lane_locked = ?, archived_at = NULL,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END`, lane, t.ticket_type === 'bid' ? 1 : 0, lane);
  }
  if (typeof b.locked === 'boolean' && t.ticket_type === 'bid') {
    if (b.locked) set('lane = COALESCE(?, lane), lane_locked = 1', lane || b.current || null);
    else set("lane = NULL, lane_locked = 0, done_at = CASE WHEN pipeline_status IN ('Awarded', 'Lost', 'No Bid') THEN done_at ELSE NULL END");
  }
  if (typeof b.archived === 'boolean') {
    if (b.archived) set("archived_at = datetime('now')");
    else set("archived_at = NULL, done_at = datetime('now')"); // restored: back on the board for another 14 days
  }
  res.json({ ok: true });
});

/** Move a master ticket to another pipeline stage (null clears it). Used by the BD Pipeline board. */
r.put('/:id/stage', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type === 'work') return res.status(400).json({ error: 'Work tickets have no pipeline stage' });
  const stage = req.body?.pipeline_status ?? null;
  if (stage !== null && !PIPELINE_STATUSES.includes(stage)) return res.status(400).json({ error: 'Unknown pipeline stage' });
  db.prepare("UPDATE tickets SET pipeline_status = ?, updated_at = datetime('now') WHERE id = ?").run(stage, t.id);
  res.json({ ticket: ticketRow(t.id) });
});

// ---- Full timeline of a master ticket, newest first

r.get('/:id/timeline', (req, res) => {
  const t = db.prepare(`SELECT t.*, u.first_name, u.last_name, e.name AS event_name FROM tickets t
    LEFT JOIN users u ON u.id = t.created_by LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const ticket = { id: t.id, ticket_type: t.ticket_type, owner_id: t.created_by, opportunity_title: t.opportunity_title, organization: t.organization, pipeline_status: t.pipeline_status, value: t.value, created_at: t.created_at,
    pwin: ticketPwin(t), event_id: t.event_id ?? null, event_name: t.event_name ?? null };
  const events = [{ type: 'ticket', at: t.created_at, author: t.first_name ? { id: t.created_by, first_name: t.first_name, last_name: t.last_name } : null }];

  const cards = db.prepare(`SELECT c.*, tm.name AS team_name, u.first_name, u.last_name FROM priority_cards c
    LEFT JOIN teams tm ON tm.id = c.team_id LEFT JOIN users u ON u.id = c.created_by WHERE c.ticket_id = ?`).all(t.id);
  const assignees = db.prepare(`SELECT a.card_id, u.id, u.first_name, u.last_name FROM card_assignees a
    JOIN users u ON u.id = a.user_id JOIN priority_cards c ON c.id = a.card_id WHERE c.ticket_id = ?`).all(t.id);
  cards.forEach((c) => events.push({
    type: 'card', at: c.created_at, author: c.first_name ? { id: c.created_by, first_name: c.first_name, last_name: c.last_name } : null,
    card: {
      id: c.id, title: c.title, week_start: c.week_start, team_name: c.team_name, due_date: c.due_date,
      is_planned: !!c.is_planned, completed: !!c.completed, checklist: json.parse(c.checklist, []),
      assignees: assignees.filter((a) => a.card_id === c.id).map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    },
  }));

  db.prepare(`SELECT n.*, c.title AS card_title, u.first_name, u.last_name FROM card_notes n
    JOIN priority_cards c ON c.id = n.card_id LEFT JOIN users u ON u.id = n.author_id WHERE c.ticket_id = ?`).all(t.id)
    .forEach((n) => events.push({ type: 'note', at: n.created_at, author: author(n), note: { id: n.id, body: n.body, updated_at: n.updated_at, card_id: n.card_id, card_title: n.card_title } }));

  const comments = db.prepare(`${COMMENT_SQL} WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`).all(t.id).map(commentOut);
  // Comments posted on their own are events; comments left under an item are that item's replies.
  comments.filter((m) => !m.parent_id && !m.target_type).forEach((m) => events.push({
    type: 'comment', at: m.created_at, author: m.author, comment: m, replies: comments.filter((x) => x.parent_id === m.id),
  }));

  db.prepare(`SELECT f.*, u.first_name, u.last_name FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.ticket_id = ?`).all(t.id)
    .forEach((f) => events.push({
      type: 'file', at: f.created_at, author: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null,
      file: { id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type },
    }));

  const targetId = (e) => ({ ticket: t.id, card: e.card?.id, note: e.note?.id, file: e.file?.id })[e.type];
  events.filter((e) => e.type !== 'comment').forEach((e) => {
    const top = comments.filter((m) => m.target_type === e.type && m.target_id === targetId(e));
    e.replies = top.flatMap((m) => [m, ...comments.filter((x) => x.parent_id === m.id)]);
  });

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  res.json({ ticket, events });
});

// ---- Questions, comments and replies

r.post('/:id/comments', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const body = String(b.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first' });
  let parentId = null;
  let cardId = Number(b.card_id) || null;
  let kind = KINDS.includes(b.kind) ? b.kind : 'comment';
  let target = null;
  if (b.target_type && !b.parent_id) {
    const id = Number(b.target_id);
    const ok = {
      ticket: () => id === t.id,
      card: () => db.prepare('SELECT 1 FROM priority_cards WHERE id = ? AND ticket_id = ?').get(id, t.id),
      note: () => db.prepare('SELECT n.card_id FROM card_notes n JOIN priority_cards c ON c.id = n.card_id WHERE n.id = ? AND c.ticket_id = ?').get(id, t.id),
      file: () => db.prepare('SELECT 1 FROM ticket_files WHERE id = ? AND ticket_id = ?').get(id, t.id),
    }[b.target_type]?.();
    if (!ok) return res.status(400).json({ error: 'That item is no longer on this ticket' });
    target = { type: b.target_type, id };
    cardId = b.target_type === 'card' ? id : b.target_type === 'note' ? ok.card_id : null;
    kind = 'comment';
  }
  if (b.parent_id) {
    const parent = db.prepare('SELECT * FROM ticket_comments WHERE id = ? AND ticket_id = ?').get(b.parent_id, t.id);
    if (!parent) return res.status(400).json({ error: 'That thread no longer exists' });
    parentId = parent.parent_id || parent.id; // replies stay one level deep
    cardId = parent.card_id;
    kind = 'reply';
  } else if (cardId && !db.prepare('SELECT 1 FROM priority_cards WHERE id = ? AND ticket_id = ?').get(cardId, t.id)) {
    return res.status(400).json({ error: 'That priority is not on this ticket' });
  }
  const id = db.prepare(`INSERT INTO ticket_comments (ticket_id, card_id, parent_id, kind, body, author_id, target_type, target_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(t.id, cardId, parentId, kind, body, req.user.id, target?.type ?? null, target?.id ?? null).lastInsertRowid;
  recordWork(req.user, { kind, ticket_id: t.id, card_id: cardId, ref_id: id, summary: body });
  notifyMentions(req.user, body, { ticket_id: t.id, card_id: cardId, comment_id: id });
  res.json({ comment: commentOut(db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(id)) });
});

/** One thread with its master ticket, priority card and replies. */
r.get('/comments/:id', (req, res) => {
  const m = db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const root = m.parent_id ? db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(m.parent_id) : m;
  const card = root.card_id ? db.prepare('SELECT id, title, week_start, due_date, completed FROM priority_cards WHERE id = ?').get(root.card_id) : null;
  res.json({
    ticket: ticketRow(root.ticket_id),
    card,
    comment: commentOut(root),
    replies: db.prepare(`${COMMENT_SQL} WHERE m.parent_id = ? ORDER BY m.created_at, m.id`).all(root.id).map(commentOut),
  });
});

/** Only a comment's author may edit it. */
r.put('/comments/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can edit this' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'A comment can’t be empty' });
  if (body !== m.body) {
    db.prepare("UPDATE ticket_comments SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, m.id);
    notifyMentions(req.user, body, { ticket_id: m.ticket_id, card_id: m.card_id, comment_id: m.id }, m.body);
  }
  res.json({ comment: commentOut(db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(m.id)) });
});

r.delete('/comments/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this' });
  db.prepare('DELETE FROM ticket_comments WHERE id = ?').run(m.id);
  // Its additional-work entries go with it (replies are removed along with their thread).
  db.prepare("DELETE FROM work_log WHERE kind IN ('question', 'comment', 'reply') AND ref_id NOT IN (SELECT id FROM ticket_comments)").run();
  res.json({ ok: true });
});

// ---- Documents

r.post('/:id/files', upload.single('file'), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  if (!t) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: 'Ticket not found' });
  }
  const id = db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(t.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id).lastInsertRowid;
  recordWork(req.user, { kind: 'file', ticket_id: t.id, ref_id: id, summary: req.file.originalname });
  res.json({ file: { id, name: req.file.originalname, size: req.file.size, mime_type: req.file.mimetype } });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});

export default r;
