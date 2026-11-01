// Master tickets: the list of a user's tickets, each ticket's full timeline,
// question/comment threads, and document uploads.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting, withTeams, defaultAssignment } from '../db.js';
import { CRITERIA, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin } from '../../src/lib/assessment.js';
import { LANES, laneFor, isArchived } from '../../src/lib/lanes.js';
import { recordWork } from '../worklog.js';
import { notifyMentions } from '../mentions.js';
import { ticketFields } from './priorities.js';
import { statusesFor, listPipelines } from '../pipelines.js';
import { queueDelete } from '../services/pipedrive.js';
import { PROCESS_TYPES, cleanReviews } from '../../src/lib/process.js';
import { NEXT_STEP_SQL } from '../activities.js';

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

const KINDS = ['question', 'comment', 'note']; // a note is a Pipedrive-style note: a record kept on the deal, which can be pinned
const author = (row, prefix = '') => (row[`${prefix}first_name`]
  ? { id: row[`${prefix}author_id`] ?? row.author_id, first_name: row[`${prefix}first_name`], last_name: row[`${prefix}last_name`] }
  : null);

export const COMMENT_SQL = `SELECT m.*, u.first_name, u.last_name, c.title AS card_title, tk.opportunity_title AS ticket_title,
    (SELECT COUNT(*) FROM ticket_comments x WHERE x.parent_id = m.id) AS reply_count,
    (SELECT MAX(x.created_at) FROM ticket_comments x WHERE x.parent_id = m.id) AS last_reply_at,
    (SELECT GROUP_CONCAT(a.user_id) FROM card_assignees a WHERE a.card_id = m.card_id) AS card_assignee_ids
  FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id LEFT JOIN priority_cards c ON c.id = m.card_id
  JOIN tickets tk ON tk.id = m.ticket_id`;

export const commentOut = (m) => ({
  id: m.id, ticket_id: m.ticket_id, ticket_title: m.ticket_title, card_id: m.card_id, card_title: m.card_title, parent_id: m.parent_id,
  kind: m.kind, body: m.body, pinned: !!m.pinned, created_at: m.created_at, updated_at: m.updated_at ?? null, author: author(m),
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

/**
 * Master tickets. scope: mine (default) | all. Outside "mine", `team` keeps tickets whose owner is
 * on that team. In any scope, `owners` (comma-separated user ids) keeps those owners' tickets and `types`
 * (comma-separated account types) keeps those account types.
 */
r.get('/', (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const q = `%${req.query.q || ''}%`;
  const team = scope !== 'mine' && Number(req.query.team) ? Number(req.query.team) : null;
  const owners = String(req.query.owners || '').split(',').map(Number).filter(Boolean);
  const types = String(req.query.types || '').split(',').filter(Boolean);
  const kind = ['bid', 'work'].includes(req.query.kind) ? req.query.kind : null; // bid or work tickets only
  const territories = String(req.query.territories || '').split(',').map(Number).filter(Boolean);
  const rows = db.prepare(`SELECT t.*, o.first_name AS owner_first_name, o.last_name AS owner_last_name,
      d.first_name AS director_first_name, d.last_name AS director_last_name, tr.name AS territory_name, tr.position AS territory_position,
      (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT tm.name FROM user_teams ut JOIN teams tm ON tm.id = ut.team_id
        WHERE ut.user_id = o.id ORDER BY tm.name)) AS owner_team,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'question') AS question_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind IN ('comment', 'note')) AS comment_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count,
      ${NEXT_STEP_SQL} AS next_step,
      MAX(t.updated_at,
        COALESCE((SELECT MAX(c.updated_at) FROM priority_cards c WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(MAX(m.created_at, COALESCE(m.updated_at, ''))) FROM ticket_comments m WHERE m.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(f.created_at) FROM ticket_files f WHERE f.ticket_id = t.id), '')) AS last_activity
    FROM tickets t LEFT JOIN users o ON o.id = t.created_by LEFT JOIN users d ON d.id = t.bd_director_id
      LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.archive_set_id IS NULL AND (t.opportunity_title LIKE @q OR t.organization LIKE @q)
      AND (@mine = 0 OR t.created_by = @me OR t.bd_director_id = @me OR EXISTS (SELECT 1 FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
        WHERE c.ticket_id = t.id AND a.user_id = @me))
      AND (@team IS NULL OR EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = o.id AND ut.team_id = @team))
      AND (@owners = '[]' OR t.created_by IN (SELECT value FROM json_each(@owners)))
      AND (@types = '[]' OR t.account_type IN (SELECT value FROM json_each(@types)))
      AND (@kind IS NULL OR t.ticket_type = @kind)
      AND (@territories = '[]' OR t.territory_id IN (SELECT value FROM json_each(@territories)))
    ORDER BY last_activity DESC`).all({ q, mine: scope === 'mine' ? 1 : 0, me: req.user.id, team, owners: JSON.stringify(owners), types: JSON.stringify(types), kind, territories: JSON.stringify(territories) });
  // Task counts: each ticket's activities and their subtasks.
  const tasks = {};
  db.prepare(`SELECT ticket_id, done FROM ticket_tasks UNION ALL
    SELECT k.ticket_id, s.done FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id`).all().forEach((k) => {
    const t = (tasks[k.ticket_id] ||= { open: 0, done: 0 });
    t[k.done ? 'done' : 'open'] += 1;
  });
  const model = pwinModel();
  res.json({ tickets: rows.map((t) => {
    const lane = laneFor(t);
    return { ...t, labels: json.parse(t.labels, []), next_step: json.parse(t.next_step, null), tasks: tasks[t.id] || { open: 0, done: 0 }, pwin: ticketPwin(t, model), lane, archived: isArchived(t, lane) };
  }) });
});

/**
 * Create a ticket on its own, without a priority. Body: { ticket_type: 'bid' | 'work', opportunity_title, organization,
 * account_type, pipeline_status, value, bd_director_id, territory_id }. A bid ticket left without a director or territory
 * gets the defaults (see defaultAssignment).
 */
r.post('/', (req, res) => {
  const type = req.body?.ticket_type === 'work' ? 'work' : 'bid';
  const tf = ticketFields(req.body);
  if (!tf.opportunity_title) return res.status(400).json({ error: type === 'work' ? 'Title is required' : 'Opportunity title is required' });
  const fields = type === 'work' ? { ...tf, pipeline_status: null, value: null } : tf;
  const assign = type === 'bid' ? bidAssignment(req.body, req.user.id, fields.account_type) : NO_ASSIGNMENT;
  // A bid can start on any pipeline, in one of that pipeline's stages.
  const pipeline = type === 'bid' ? listPipelines().find((p) => p.id === (Number(req.body?.pipeline_id) || null)) || listPipelines()[0] : null;
  if (pipeline && fields.pipeline_status && !pipeline.statuses.includes(fields.pipeline_status)) fields.pipeline_status = null;
  const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, value, ticket_type, created_by,
      bd_director_id, territory_id, projected_win_date, win_date_undetermined, pipeline_id)
    VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @value, @ticket_type, @created_by,
      @bd_director_id, @territory_id, @projected_win_date, @win_date_undetermined, @pipeline_id)`)
    .run({ ...fields, ...assign, ticket_type: type, created_by: req.user.id, pipeline_id: pipeline?.id ?? null }).lastInsertRowid;
  recordWork(req.user, { kind: 'ticket', ticket_id: id, summary: fields.opportunity_title });
  res.json({ ticket: ticketRow(id) });
});

/** What a work ticket (which has no director, territory or win date) is created with. */
export const NO_ASSIGNMENT = { bd_director_id: null, territory_id: null, projected_win_date: null, win_date_undetermined: 0 };

/** A bid ticket's BD director, territory and projected win date from a request body; defaults for a missing director or territory. */
export function bidAssignment(body = {}, userId, accountType) {
  const d = defaultAssignment(userId, accountType);
  const has = (k) => body[k] !== undefined && body[k] !== '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.projected_win_date || '') ? body.projected_win_date : null;
  return {
    bd_director_id: has('bd_director_id') ? Number(body.bd_director_id) || null : d.bd_director_id,
    territory_id: has('territory_id') ? Number(body.territory_id) || null : d.territory_id,
    projected_win_date: date,
    win_date_undetermined: !date && body.win_date_undetermined ? 1 : 0,
  };
}

/**
 * Body: { bd_director_id?, territory_id?, projected_win_date?, win_date_undetermined? } (null clears). Who a bid ticket
 * belongs to and when it's expected to be won. Marking the date undetermined clears the date, and setting a date clears it.
 */
r.put('/:id/assignment', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only bid tickets have a BD director and territory' });
  const b = req.body || {};
  const sets = [];
  const vals = { id: t.id };
  if (b.bd_director_id !== undefined) {
    vals.d = Number(b.bd_director_id) || null;
    if (vals.d && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(vals.d)) return res.status(400).json({ error: 'Unknown person' });
    sets.push('bd_director_id = @d');
  }
  if (b.territory_id !== undefined) {
    vals.tr = Number(b.territory_id) || null;
    if (vals.tr && !db.prepare('SELECT 1 FROM territories WHERE id = ?').get(vals.tr)) return res.status(400).json({ error: 'Unknown territory' });
    sets.push('territory_id = @tr');
  }
  if (b.projected_win_date !== undefined) {
    vals.wd = b.projected_win_date || null;
    if (vals.wd && !/^\d{4}-\d{2}-\d{2}$/.test(vals.wd)) return res.status(400).json({ error: 'Projected win date must be a date' });
    sets.push('projected_win_date = @wd');
    if (vals.wd) sets.push('win_date_undetermined = 0');
  }
  if (b.win_date_undetermined !== undefined) {
    vals.wu = b.win_date_undetermined ? 1 : 0;
    sets.push('win_date_undetermined = @wu');
    if (vals.wu) sets.push('projected_win_date = NULL');
  }
  if (sets.length) db.prepare(`UPDATE tickets SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
  res.json({ ticket: ticketRow(t.id) });
});

// ---- Strategy and win assessment

const touch = (id) => db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(id);
const nameOf = (id) => {
  const u = id && db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(id);
  return u ? `${u.first_name} ${u.last_name}` : null;
};

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
    if (t.ticket_type === 'bid' && ['Awarded', 'Lost'].includes(t.pipeline_status) && lane !== 'done') {
      return res.status(400).json({ error: `This bid is ${t.pipeline_status}, so it stays in Done. Change its pipeline stage to reopen it.` });
    }
    set(`lane = ?, lane_locked = ?, archived_at = NULL, archive_set_id = NULL,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END`, lane, t.ticket_type === 'bid' ? 1 : 0, lane);
  }
  if (typeof b.locked === 'boolean' && t.ticket_type === 'bid') {
    if (b.locked) set('lane = COALESCE(?, lane), lane_locked = 1', lane || b.current || null);
    else set("lane = NULL, lane_locked = 0, done_at = CASE WHEN pipeline_status IN ('Awarded', 'Lost') THEN done_at ELSE NULL END");
  }
  if (typeof b.archived === 'boolean') {
    if (b.archived) set("archived_at = datetime('now')");
    // Restored: back on the board. A Done ticket gets another 14 days before it archives itself again.
    else set("archived_at = NULL, archive_set_id = NULL, done_at = CASE WHEN done_at IS NOT NULL THEN datetime('now') END");
  }
  res.json({ ok: true });
});

/** Move a master ticket to another pipeline stage (null clears it). Used by the BD Pipeline board. */
r.put('/:id/stage', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type === 'work') return res.status(400).json({ error: 'Work tickets have no pipeline stage' });
  const stage = req.body?.pipeline_status ?? null;
  if (stage !== null && !statusesFor(t.pipeline_id).includes(stage)) return res.status(400).json({ error: 'Unknown pipeline stage' });
  db.prepare("UPDATE tickets SET pipeline_status = ?, updated_at = datetime('now') WHERE id = ?").run(stage, t.id);
  res.json({ ticket: ticketRow(t.id) });
});

// ---- Full timeline of a master ticket, newest first

r.get('/:id/timeline', (req, res) => {
  const t = db.prepare(`SELECT t.*, u.first_name, u.last_name, e.name AS event_name FROM tickets t
    LEFT JOIN users u ON u.id = t.created_by LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const ticket = { id: t.id, ticket_type: t.ticket_type, owner_id: t.created_by, opportunity_title: t.opportunity_title, organization: t.organization, pipeline_status: t.pipeline_status, value: t.value, created_at: t.created_at,
    pwin: ticketPwin(t), event_id: t.event_id ?? null, event_name: t.event_name ?? null,
    // Whether it has left the board: archived by hand, or Done long enough (being Done doesn't depend on recent activity).
    archived: isArchived(t, laneFor({ ...t, last_activity: t.updated_at })),
    bd_director_id: t.bd_director_id ?? null, territory_id: t.territory_id ?? null,
    projected_win_date: t.projected_win_date ?? null, win_date_undetermined: !!t.win_date_undetermined,
    lost_reason: t.lost_reason ?? null, probability: t.probability ?? null, currency: t.currency ?? null,
    labels: json.parse(t.labels, []), source: t.source ?? null };
  const events = [{ type: 'ticket', at: t.created_at, author: t.first_name ? { id: t.created_by, first_name: t.first_name, last_name: t.last_name } : null }];

  // Each new activity (a priority made on the Weekly Priorities board is one too); subtasks aren't events.
  const activities = db.prepare(`SELECT k.id, k.text, k.activity_type, k.due_date, k.due_time, k.done, k.created_at, k.created_by, u.first_name, u.last_name,
      a.first_name AS assignee_first_name, a.last_name AS assignee_last_name,
      (SELECT GROUP_CONCAT(tm.name || ' · week of ' || c.week_start, '; ') FROM priority_cards c JOIN teams tm ON tm.id = c.team_id WHERE c.activity_id = k.id) AS priorities
    FROM ticket_tasks k LEFT JOIN users u ON u.id = k.created_by LEFT JOIN users a ON a.id = k.assignee_id WHERE k.ticket_id = ?`).all(t.id);
  activities.forEach((k) => events.push({
    type: 'activity', at: k.created_at, author: k.first_name ? { id: k.created_by, first_name: k.first_name, last_name: k.last_name } : null,
    activity: {
      id: k.id, subject: k.text, activity_type: k.activity_type || 'Task', due_date: k.due_date, due_time: k.due_time, done: !!k.done,
      assignee: k.assignee_first_name ? `${k.assignee_first_name} ${k.assignee_last_name}` : null, priorities: k.priorities,
    },
  }));
  const subjectOf = new Map(activities.map((k) => [k.id, k.text]));
  const subtasks = new Map(db.prepare('SELECT s.id, s.text, s.task_id FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id WHERE k.ticket_id = ?').all(t.id).map((x) => [x.id, x]));

  const comments = db.prepare(`${COMMENT_SQL} WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`).all(t.id).map(commentOut);
  // Comments posted on their own are events, and so are comments on an activity or subtask (marked with what they're
  // about); comments left under any other item are that item's replies.
  const aboutOf = (m) => {
    if (m.target_type === 'activity') return { activity_id: m.target_id, subject: subjectOf.get(m.target_id) ?? null };
    const sub = subtasks.get(m.target_id);
    return { activity_id: sub?.task_id ?? null, subject: subjectOf.get(sub?.task_id) ?? null, subtask: sub?.text ?? null };
  };
  comments.filter((m) => !m.parent_id && (!m.target_type || m.target_type === 'activity' || m.target_type === 'subtask')).forEach((m) => events.push({
    type: 'comment', at: m.created_at, author: m.author, comment: m.target_type ? { ...m, about: aboutOf(m) } : m, replies: comments.filter((x) => x.parent_id === m.id),
  }));

  db.prepare(`SELECT f.*, u.first_name, u.last_name, p.step_type FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by
    LEFT JOIN ticket_process_steps p ON p.id = f.process_step_id WHERE f.ticket_id = ?`).all(t.id)
    .forEach((f) => events.push({
      type: 'file', at: f.created_at, author: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null,
      file: { id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type, step_type: f.step_type ?? null, url: f.url ?? null, email_id: f.email_id ?? null },
    }));

  db.prepare('SELECT * FROM ticket_emails WHERE ticket_id = ?').all(t.id).forEach((m) => events.push({
    type: 'email', at: m.sent_at, author: null,
    email: { id: m.id, subject: m.subject, from: m.from_address, to: m.to_addresses, cc: m.cc_addresses, body: m.body },
  }));

  const targetId = (e) => ({ ticket: t.id, file: e.file?.id, email: e.email?.id })[e.type];
  events.filter((e) => e.type !== 'comment' && e.type !== 'activity').forEach((e) => {
    const top = comments.filter((m) => m.target_type === e.type && m.target_id === targetId(e));
    e.replies = top.flatMap((m) => [m, ...comments.filter((x) => x.parent_id === m.id)]);
  });

  // Newest first, with pinned notes on top.
  const pinned = (e) => (e.comment?.pinned ? 1 : 0);
  events.sort((a, b) => pinned(b) - pinned(a) || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
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
      activity: () => db.prepare('SELECT id AS activity_id FROM ticket_tasks WHERE id = ? AND ticket_id = ?').get(id, t.id),
      subtask: () => db.prepare('SELECT s.task_id AS activity_id FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id WHERE s.id = ? AND k.ticket_id = ?').get(id, t.id),
      file: () => db.prepare('SELECT 1 FROM ticket_files WHERE id = ? AND ticket_id = ?').get(id, t.id),
      email: () => db.prepare('SELECT 1 FROM ticket_emails WHERE id = ? AND ticket_id = ?').get(id, t.id),
    }[b.target_type]?.();
    if (!ok) return res.status(400).json({ error: 'That item is no longer on this ticket' });
    target = { type: b.target_type, id };
    // A comment on an activity also joins the conversation on its latest priority card.
    cardId = ok.activity_id ? db.prepare('SELECT id FROM priority_cards WHERE activity_id = ? ORDER BY week_start DESC LIMIT 1').get(ok.activity_id)?.id ?? null : null;
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
    // A Pipedrive note edited here waits for an admin to send it.
    db.prepare("UPDATE ticket_comments SET body = ?, updated_at = datetime('now'), pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?").run(body, m.id);
    notifyMentions(req.user, body, { ticket_id: m.ticket_id, card_id: m.card_id, comment_id: m.id }, m.body);
  }
  res.json({ comment: commentOut(db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(m.id)) });
});

/** Pin or unpin a note (anyone can). Pinned notes sit at the top of the timeline, as in Pipedrive. */
r.put('/comments/:id/pin', (req, res) => {
  const m = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.kind !== 'note') return res.status(400).json({ error: 'Only notes can be pinned' });
  db.prepare('UPDATE ticket_comments SET pinned = ?, pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?').run(req.body?.pinned === false ? 0 : 1, m.id);
  res.json({ comment: commentOut(db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(m.id)) });
});

r.delete('/comments/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this' });
  db.prepare('DELETE FROM ticket_comments WHERE id = ?').run(m.id);
  queueDelete('note', m.pipedrive_id, db.prepare('SELECT pipedrive_id FROM tickets WHERE id = ?').get(m.ticket_id)?.pipedrive_id);
  // Its additional-work entries go with it (replies are removed along with their thread).
  db.prepare("DELETE FROM work_log WHERE kind IN ('question', 'comment', 'reply') AND ref_id NOT IN (SELECT id FROM ticket_comments)").run();
  res.json({ ok: true });
});

// ---- Process flow: RFI, RFP, gate reviews and so on, each with its reviews, notes and documents

const fileOut = (f) => ({ id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type, created_at: f.created_at,
  uploaded_by: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null });
const processRow = (id) => db.prepare('SELECT * FROM ticket_process_steps WHERE id = ?').get(id);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

function listProcess(ticketId) {
  const files = db.prepare(`SELECT f.*, u.first_name, u.last_name FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.ticket_id = ? AND f.process_step_id IS NOT NULL ORDER BY f.created_at, f.id`).all(ticketId);
  return db.prepare(`SELECT p.*, a.first_name, a.last_name, e.first_name AS e_first_name, e.last_name AS e_last_name
    FROM ticket_process_steps p LEFT JOIN users a ON a.id = p.author_id LEFT JOIN users e ON e.id = p.updated_by
    WHERE p.ticket_id = ? ORDER BY COALESCE(p.step_date, substr(p.created_at, 1, 10)), p.created_at, p.id`).all(ticketId)
    .map((p) => ({
      id: p.id, step_type: p.step_type, step_date: p.step_date, notes: p.notes || '', reviews: cleanReviews(json.parse(p.reviews, {})),
      created_at: p.created_at, updated_at: p.updated_at,
      author: p.first_name ? { id: p.author_id, first_name: p.first_name, last_name: p.last_name } : null,
      updated_by: p.e_first_name ? { id: p.updated_by, first_name: p.e_first_name, last_name: p.e_last_name } : null,
      files: files.filter((f) => f.process_step_id === p.id).map(fileOut),
    }));
}

r.get('/:id/process', (req, res) => {
  if (!ticketRow(req.params.id)) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ steps: listProcess(req.params.id), types: PROCESS_TYPES });
});

/** Body: { step_type, step_date? }. Steps can be added in any order, at any time. */
r.post('/:id/process', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const type = String(req.body?.step_type || '');
  if (!PROCESS_TYPES.includes(type)) return res.status(400).json({ error: 'Choose a step type' });
  const id = db.prepare('INSERT INTO ticket_process_steps (ticket_id, step_type, step_date, reviews, author_id) VALUES (?, ?, ?, ?, ?)')
    .run(t.id, type, isoDate(req.body?.step_date), json.str(cleanReviews({})), req.user.id).lastInsertRowid;
  recordWork(req.user, { kind: 'process', ticket_id: t.id, ref_id: id, summary: type });
  touch(t.id);
  res.json({ id, steps: listProcess(t.id) });
});

/** Body may hold step_type, step_date, reviews and notes. Anyone can update a step. */
r.put('/process/:pid', (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Process step not found' });
  const b = req.body || {};
  if (b.step_type !== undefined && !PROCESS_TYPES.includes(b.step_type)) return res.status(400).json({ error: 'Choose a step type' });
  db.prepare(`UPDATE ticket_process_steps SET step_type = ?, step_date = ?, reviews = ?, notes = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
    b.step_type ?? p.step_type,
    b.step_date !== undefined ? isoDate(b.step_date) : p.step_date,
    b.reviews !== undefined ? json.str(cleanReviews(b.reviews)) : p.reviews,
    typeof b.notes === 'string' ? b.notes.trim() : p.notes,
    req.user.id, p.id,
  );
  touch(p.ticket_id);
  res.json({ steps: listProcess(p.ticket_id) });
});

/** Its documents stay on the ticket. */
r.delete('/process/:pid', (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Process step not found' });
  if (p.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only whoever added this step can delete it' });
  db.prepare('DELETE FROM ticket_process_steps WHERE id = ?').run(p.id);
  db.prepare("DELETE FROM work_log WHERE kind = 'process' AND ref_id = ?").run(p.id);
  touch(p.ticket_id);
  res.json({ steps: listProcess(p.ticket_id) });
});

r.post('/process/:pid/files', upload.single('file'), (req, res) => {
  const p = processRow(req.params.pid);
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  if (!p) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: 'Process step not found' });
  }
  const id = db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by, process_step_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(p.ticket_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id, p.id).lastInsertRowid;
  recordWork(req.user, { kind: 'file', ticket_id: p.ticket_id, ref_id: id, summary: req.file.originalname });
  touch(p.ticket_id);
  res.json({ steps: listProcess(p.ticket_id) });
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
  if (f.url) return res.redirect(f.url);
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});


// ---- Deal details: the Pipedrive deal fields that have no other place on the ticket, its followers and its products.

const detailsOf = (t) => ({
  lost_reason: t.lost_reason ?? null, probability: t.probability ?? null, currency: t.currency ?? null, source: t.source ?? null,
  labels: json.parse(t.labels, []), custom_fields: json.parse(t.custom_fields, []), pipedrive_id: t.pipedrive_id ?? null,
  pipeline_id: t.pipeline_id ?? null, pipelines: listPipelines().map(({ id, name }) => ({ id, name })),
  followers: db.prepare(`SELECT u.id, u.first_name, u.last_name FROM ticket_followers f JOIN users u ON u.id = f.user_id
    WHERE f.ticket_id = ? ORDER BY u.last_name, u.first_name`).all(t.id),
  products: db.prepare('SELECT * FROM ticket_products WHERE ticket_id = ? ORDER BY position, id').all(t.id),
});

r.get('/:id/details', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  res.json(detailsOf(t));
});

/**
 * Body: any of lost_reason, probability (0-100), currency, source, labels [names], custom_fields [{ name, value }],
 * followers [user ids], pipeline_id (null for KIT's own). Moving to a pipeline without the ticket's stage puts it in
 * that pipeline's first stage.
 */
r.put('/:id/details', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const text = (v) => String(v ?? '').trim() || null;
  const set = {};
  if ('lost_reason' in b) set.lost_reason = text(b.lost_reason);
  if ('source' in b) set.source = text(b.source);
  if ('currency' in b) set.currency = text(b.currency)?.toUpperCase() || null;
  if ('probability' in b) {
    const p = b.probability === '' || b.probability == null ? null : Math.round(Number(b.probability));
    if (p != null && !(p >= 0 && p <= 100)) return res.status(400).json({ error: 'Probability is a percent from 0 to 100' });
    set.probability = p;
  }
  if ('labels' in b) { set.labels = cleanLabels(b.labels); set.labels_pending = t.pipedrive_id ? 1 : 0; }
  if ('custom_fields' in b) {
    set.custom_fields = json.str((b.custom_fields || []).map((f) => ({ name: String(f.name ?? '').trim(), value: String(f.value ?? '').trim() })).filter((f) => f.name));
  }
  if ('pipeline_id' in b && (Number(b.pipeline_id) || null) !== (t.pipeline_id ?? null)) {
    const p = listPipelines().find((x) => x.id === (Number(b.pipeline_id) || null));
    if (!p) return res.status(400).json({ error: 'Unknown pipeline' });
    set.pipeline_id = p.id;
    if (t.pipeline_status && !p.statuses.includes(t.pipeline_status)) set.pipeline_status = p.statuses[0];
  }
  db.transaction(() => {
    Object.entries(set).forEach(([k, v]) => db.prepare(`UPDATE tickets SET ${k} = ? WHERE id = ?`).run(v, t.id));
    if (Array.isArray(b.followers)) {
      db.prepare('DELETE FROM ticket_followers WHERE ticket_id = ?').run(t.id);
      const add = db.prepare('INSERT OR IGNORE INTO ticket_followers (ticket_id, user_id) SELECT ?, id FROM users WHERE id = ?');
      b.followers.forEach((u) => add.run(t.id, Number(u)));
    }
  })();
  touch(t.id);
  res.json(detailsOf(ticketRow(t.id)));
});

/** Tag names, deduplicated, with any new ones added to the tag list (gray until someone picks a color). */
function cleanLabels(names) {
  const known = new Map(db.prepare('SELECT name FROM labels').all().map((l) => [l.name.toLowerCase(), l.name]));
  const out = [...new Set((Array.isArray(names) ? names : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean)
    .map((n) => known.get(n.toLowerCase()) || n))];
  out.filter((n) => !known.has(n.toLowerCase())).forEach((n) => db.prepare('INSERT OR IGNORE INTO labels (name) VALUES (?)').run(n));
  return json.str(out);
}

/** Body: { labels: [names] }. Sets a ticket's tags. On a ticket from Pipedrive the change waits for an admin to send it. */
r.put('/:id/labels', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('UPDATE tickets SET labels = ?, labels_pending = ? WHERE id = ?').run(cleanLabels(req.body?.labels), t.pipedrive_id ? 1 : 0, t.id);
  touch(t.id);
  res.json({ labels: json.parse(ticketRow(t.id).labels, []) });
});

/** A product line from a request body: name, quantity, item_price, discount (percent), comments. */
function productFields(b, partial) {
  const out = {};
  if (!partial || 'name' in b) {
    out.name = String(b.name ?? '').trim();
    if (!out.name) return { error: 'Give the product a name' };
  }
  for (const k of ['quantity', 'item_price', 'discount']) {
    if (partial && !(k in b)) continue;
    const n = b[k] === '' || b[k] == null ? (k === 'quantity' ? 1 : 0) : Number(b[k]);
    if (!Number.isFinite(n) || n < 0) return { error: `${k.replace('_', ' ')} must be a number, 0 or more` };
    out[k] = n;
  }
  if (!partial || 'comments' in b) out.comments = String(b.comments ?? '').trim() || null;
  return { out };
}

r.post('/:id/products', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const { out, error } = productFields(req.body || {});
  if (error) return res.status(400).json({ error });
  const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_products WHERE ticket_id = ?').get(t.id).p;
  db.prepare(`INSERT INTO ticket_products (ticket_id, name, quantity, item_price, discount, comments, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.id, out.name, out.quantity, out.item_price, out.discount, out.comments, pos);
  touch(t.id);
  res.json(detailsOf(t));
});

r.put('/products/:pid', (req, res) => {
  const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const { out, error } = productFields(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  Object.entries(out).forEach(([k, v]) => db.prepare(`UPDATE ticket_products SET ${k} = ? WHERE id = ?`).run(v, p.id));
  touch(p.ticket_id);
  res.json(detailsOf(ticketRow(p.ticket_id)));
});

r.delete('/products/:pid', (req, res) => {
  const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM ticket_products WHERE id = ?').run(p.id);
  touch(p.ticket_id);
  res.json(detailsOf(ticketRow(p.ticket_id)));
});

export default r;
