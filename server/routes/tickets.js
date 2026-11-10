// Master tickets: the list of a user's tickets, each ticket's full timeline,
// question/comment threads, and document uploads.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting, withTeams, defaultAssignment, pipelineTicketsClosed, PIPELINE_TICKETS_CLOSED } from '../db.js';
import { requireAdmin } from '../auth.js';
import { CRITERIA, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin } from '../../src/lib/assessment.js';
import { LANES, laneFor, isArchived } from '../../src/lib/lanes.js';
import { recordWork, recordTicketUpdate } from '../worklog.js';
import { notifyMentions, notifyTicketOwner } from '../mentions.js';
import { ticketFields } from './priorities.js';
import { statusesFor, listPipelines, defaultPipeline, pipelineForNew, kitPipelineAllowed, KIT_PIPELINE_CLOSED } from '../pipelines.js';
import '../sample/registry.js'; // sample_rows, so sample tickets aren't moved off KIT's own pipeline
import { queueDelete } from '../services/pipedrive.js';
import { fieldsOf, customDealFields } from '../services/pipedriveFields.js';
import { PROCESS_TYPES, DECISIONS, cleanReviews } from '../../src/lib/process.js';
import { NEXT_STEP_SQL } from '../activities.js';
import { canEditTicket, ownerOnlyMessage } from '../../src/lib/ticketAccess.js';
import { focusTickets } from '../focus.js';

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
  kind: m.kind, body: m.body, pinned: !!m.pinned, created_at: m.created_at, updated_at: m.updated_at ?? null, author: author(m), synced: !!m.pipedrive_id,
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

/** Why `user` can't change `ticket`, or null when they can (its owner, or an admin). */
export function ticketEditDenied(user, ticket) {
  if (canEditTicket(user, ticket)) return null;
  const o = ticket?.created_by && db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(ticket.created_by);
  return ownerOnlyMessage(o ? `${o.first_name} ${o.last_name}` : null);
}

/**
 * Lets the request through only for the ticket's owner or an admin. `ticketIdOf(req)` finds the ticket: by default the
 * `:id` in the path; for a step, file, product or installment, the ticket it belongs to.
 */
const ownerOnly = (ticketIdOf = (req) => req.params.id) => (req, res, next) => {
  const t = ticketRow(ticketIdOf(req));
  if (!t) return res.status(404).json({ error: 'Not found' });
  const denied = ticketEditDenied(req.user, t);
  if (denied) return res.status(403).json({ error: denied });
  next();
};
const ticketOf = (table, param) => (req) => db.prepare(`SELECT ticket_id FROM ${table} WHERE id = ?`).get(req.params[param])?.ticket_id;
const ofStep = ticketOf('ticket_process_steps', 'pid');
const ofFile = ticketOf('ticket_files', 'id');
const ofProduct = ticketOf('ticket_products', 'pid');
const ofInstallment = ticketOf('ticket_installments', 'iid');
const ofComment = ticketOf('ticket_comments', 'id');

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
const ticketPwin = (t, model = pwinModel()) => (t.ticket_type !== 'bid' ? null : pwin(json.parse(t.assessment, {}), model.weights, model.gates));

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

/** Admins. Body: { closed }. Whether anyone can create pipeline tickets in KIT; everyone reads it from /priorities/meta. */
r.put('/pipeline-creation', requireAdmin, (req, res) => {
  setSetting('pipeline_tickets_closed', req.body?.closed ? '1' : '0');
  res.json({ closed: pipelineTicketsClosed() });
});

// Pipeline tickets still on KIT's own pipeline (sample data aside): the ones to move once it's turned off.
const ON_KIT_PIPELINE = "ticket_type = 'bid' AND pipeline_id IS NULL AND id NOT IN (SELECT row_id FROM sample_rows WHERE tbl = 'tickets')";
const kitPipelineOut = () => {
  const kit = listPipelines()[0];
  return {
    allowed: kitPipelineAllowed(), closed: !!kit.closed, hasPipedrive: listPipelines().length > 1, default: defaultPipeline().name,
    tickets: db.prepare(`SELECT id, opportunity_title AS title FROM tickets WHERE ${ON_KIT_PIPELINE} ORDER BY opportunity_title COLLATE NOCASE`).all(),
  };
};

/** Admins: whether KIT's own pipeline takes tickets, where new ones go instead, and the tickets still on it. */
r.get('/kit-pipeline', requireAdmin, (req, res) => res.json(kitPipelineOut()));

/** Admins. Body: { allowed }. Off, new pipeline tickets go on Pipedrive's first pipeline and none can be moved to KIT's own. */
r.put('/kit-pipeline', requireAdmin, (req, res) => {
  setSetting('kit_pipeline_allowed', req.body?.allowed ? '1' : '0');
  res.json(kitPipelineOut());
});

/** Admins: move every ticket on KIT's own pipeline (while it's off) to the default one, keeping a stage both have. */
r.post('/kit-pipeline/move', requireAdmin, (req, res) => {
  const to = defaultPipeline();
  if (to.id == null) return res.status(400).json({ error: 'The KIT pipeline is on, so there’s nowhere to move its tickets' });
  db.transaction(() => {
    for (const t of db.prepare(`SELECT id, pipeline_status FROM tickets WHERE ${ON_KIT_PIPELINE}`).all()) {
      const stage = !t.pipeline_status || to.statuses.includes(t.pipeline_status) ? t.pipeline_status : to.statuses[0];
      db.prepare("UPDATE tickets SET pipeline_id = ?, pipeline_status = ?, updated_at = datetime('now') WHERE id = ?").run(to.id, stage, t.id);
    }
  })();
  res.json(kitPipelineOut());
});

/**
 * Master tickets. scope: mine (default) | all. Outside "mine", `team` keeps tickets whose owner is
 * on that team. In any scope, `owners` (comma-separated user ids) keeps those owners' tickets and `types`
 * (comma-separated account types) keeps those account types. Someone with focus on gets only the tickets they're tied to
 * or mentioned in (see server/focus.js), unless they ask for tickets by id.
 */
r.get('/', (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  const q = `%${req.query.q || ''}%`;
  const team = scope !== 'mine' && Number(req.query.team) ? Number(req.query.team) : null;
  const owners = String(req.query.owners || '').split(',').map(Number).filter(Boolean);
  const types = String(req.query.types || '').split(',').filter(Boolean);
  const kind = ['bid', 'work'].includes(req.query.kind) ? req.query.kind : null; // pipeline or work tickets only
  const territories = String(req.query.territories || '').split(',').map(Number).filter(Boolean);
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean); // just these tickets
  const rows = db.prepare(`SELECT t.*, o.first_name AS owner_first_name, o.last_name AS owner_last_name,
      d.first_name AS director_first_name, d.last_name AS director_last_name, tr.name AS territory_name, tr.position AS territory_position,
      (SELECT GROUP_CONCAT(name, ', ') FROM (SELECT tm.name FROM user_teams ut JOIN teams tm ON tm.id = ut.team_id
        WHERE ut.user_id = o.id ORDER BY tm.name)) AS owner_team,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'question') AS question_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind IN ('comment', 'note')) AS comment_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count,
      (SELECT GROUP_CONCAT(u.first_name || ' ' || u.last_name, ', ') FROM priority_list_tickets pl JOIN users u ON u.id = pl.user_id
        WHERE pl.ticket_id = t.id) AS priority_of,
      ${NEXT_STEP_SQL} AS next_step,
      MAX(t.updated_at,
        COALESCE((SELECT MAX(c.updated_at) FROM priority_cards c WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(MAX(m.created_at, COALESCE(m.updated_at, ''))) FROM ticket_comments m WHERE m.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(f.created_at) FROM ticket_files f WHERE f.ticket_id = t.id), '')) AS last_activity
    FROM tickets t LEFT JOIN users o ON o.id = t.created_by LEFT JOIN users d ON d.id = t.bd_director_id
      LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.archive_set_id IS NULL AND t.ticket_type != 'account' AND (t.opportunity_title LIKE @q OR t.organization LIKE @q)
      AND (@mine = 0 OR t.created_by = @me OR t.bd_director_id = @me OR EXISTS (SELECT 1 FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
        WHERE c.ticket_id = t.id AND a.user_id = @me))
      AND (@team IS NULL OR EXISTS (SELECT 1 FROM user_teams ut WHERE ut.user_id = o.id AND ut.team_id = @team))
      AND (@owners = '[]' OR t.created_by IN (SELECT value FROM json_each(@owners)))
      AND (@types = '[]' OR t.account_type IN (SELECT value FROM json_each(@types)))
      AND (@kind IS NULL OR t.ticket_type = @kind)
      AND (@territories = '[]' OR t.territory_id IN (SELECT value FROM json_each(@territories)))
      AND (@ids = '[]' OR t.id IN (SELECT value FROM json_each(@ids)))
    ORDER BY last_activity DESC`).all({ q, mine: scope === 'mine' ? 1 : 0, me: req.user.id, team, owners: JSON.stringify(owners), types: JSON.stringify(types), kind,
      territories: JSON.stringify(territories), ids: JSON.stringify(ids) });
  // Task counts: each ticket's activities and their subtasks.
  const tasks = {};
  db.prepare(`SELECT ticket_id, done FROM ticket_tasks UNION ALL
    SELECT k.ticket_id, s.done FROM activity_subtasks s JOIN ticket_tasks k ON k.id = s.task_id`).all().forEach((k) => {
    const t = (tasks[k.ticket_id] ||= { open: 0, done: 0 });
    t[k.done ? 'done' : 'open'] += 1;
  });
  const model = pwinModel();
  const focus = ids.length ? null : focusTickets(req.user);
  res.json({ tickets: rows.filter((t) => !focus || focus.has(t.id)).map((t) => {
    const lane = laneFor(t);
    return { ...t, labels: json.parse(t.labels, []), next_step: json.parse(t.next_step, null), tasks: tasks[t.id] || { open: 0, done: 0 }, pwin: ticketPwin(t, model), lane, archived: isArchived(t, lane) };
  }) });
});

/**
 * Create a ticket on its own, without a priority. Body: { ticket_type: 'bid' | 'work', opportunity_title, organization,
 * account_type, pipeline_status, value, bd_director_id, territory_id }. A pipeline ticket left without a director or territory
 * gets the defaults (see defaultAssignment).
 */
r.post('/', (req, res) => {
  const type = req.body?.ticket_type === 'work' ? 'work' : 'bid';
  if (type === 'bid' && pipelineTicketsClosed()) return res.status(403).json({ error: PIPELINE_TICKETS_CLOSED });
  const tf = ticketFields(req.body);
  if (!tf.opportunity_title) return res.status(400).json({ error: type === 'work' ? 'Title is required' : 'Opportunity title is required' });
  const fields = type === 'work' ? { ...tf, pipeline_status: null, value: null } : { ...tf, work_team_id: null };
  const assign = type === 'bid' ? bidAssignment(req.body, req.user.id, fields.account_type) : NO_ASSIGNMENT;
  // A pipeline ticket can start on any pipeline that takes tickets (the default when none is chosen), in one of its stages.
  const pipeline = type === 'bid' ? pipelineForNew(req.body?.pipeline_id) : null;
  if (pipeline && fields.pipeline_status && !pipeline.statuses.includes(fields.pipeline_status)) fields.pipeline_status = null;
  const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, work_team_id, value, ticket_type, created_by,
      bd_director_id, territory_id, projected_win_date, win_date_undetermined, pipeline_id)
    VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @work_team_id, @value, @ticket_type, @created_by,
      @bd_director_id, @territory_id, @projected_win_date, @win_date_undetermined, @pipeline_id)`)
    .run({ ...fields, ...assign, ticket_type: type, created_by: req.user.id, pipeline_id: pipeline?.id ?? null }).lastInsertRowid;
  recordWork(req.user, { kind: 'ticket', ticket_id: id, summary: fields.opportunity_title });
  res.json({ ticket: ticketRow(id) });
});

/** What a work ticket (which has no director, territory or win date) is created with. */
export const NO_ASSIGNMENT = { bd_director_id: null, territory_id: null, projected_win_date: null, win_date_undetermined: 0 };

/** A pipeline ticket's BD director, territory and projected win date from a request body; defaults for a missing director or territory. */
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
 * Body: { bd_director_id?, territory_id?, projected_win_date?, win_date_undetermined? } (null clears). Who a pipeline ticket
 * belongs to and when it's expected to be won. Marking the date undetermined clears the date, and setting a date clears it.
 */
r.put('/:id/assignment', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets have a BD director and territory' });
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
  if (sets.length) {
    db.prepare(`UPDATE tickets SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(vals);
    recordTicketUpdate(req.user, t, 'BD director, territory or win date');
  }
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

r.put('/:id/strategy', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare("UPDATE tickets SET strategy = ?, strategy_updated_at = datetime('now'), strategy_updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(req.body?.strategy ?? ''), req.user.id, t.id);
  recordTicketUpdate(req.user, t, 'Win strategy');
  res.json({ ok: true, strategy_updated_at: ticketRow(t.id).strategy_updated_at, strategy_updated_by: nameOf(req.user.id) });
});

/** Body: { assessment: { [criterion]: { score: 1–5 | null, answers: { [prompt]: string } } } }. */
r.put('/:id/assessment', ownerOnly(), (req, res) => {
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
  recordTicketUpdate(req.user, t, 'Win assessment');
  res.json({ ok: true, assessment_updated_at: ticketRow(t.id).assessment_updated_at, assessment_updated_by: nameOf(req.user.id) });
});

/**
 * Swim lane changes. Body may hold:
 *   lane     move it to that lane (a pipeline ticket moved by hand is locked there)
 *   locked   lock a pipeline ticket in `lane`, or unlock it so it moves on its own again
 *   archived archive a Done ticket now, or restore an archived one to Done
 * None of this counts as activity, so it doesn't reset the ticket's timer.
 */
r.put('/:id/lane', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const lane = b.lane;
  if (lane != null && !LANES.some((l) => l.key === lane)) return res.status(400).json({ error: 'Unknown lane' });
  const set = (sql, ...args) => db.prepare(`UPDATE tickets SET ${sql} WHERE id = ?`).run(...args, t.id);

  // Pipeline tickets are read-only on the Tickets page: their lane follows the deal's activity and status.
  if (t.ticket_type === 'bid' && (lane || typeof b.locked === 'boolean')) {
    return res.status(400).json({ error: 'Pipeline tickets move on their own, from the deal’s activity and status. They can’t be moved or locked by hand.' });
  }
  if (lane) {
    set(`lane = ?, lane_locked = 0, archived_at = NULL, archive_set_id = NULL,
      done_at = CASE WHEN ? = 'done' THEN COALESCE(done_at, datetime('now')) ELSE NULL END`, lane, lane);
  }
  if (typeof b.archived === 'boolean') {
    if (b.archived) {
      // A won deal's contract is in Delivery and in the books; archiving it would silently take it out. Reopening the deal
      // puts the contract on hold first, and then the ticket can be archived or marked lost.
      if (t.ticket_type === 'bid' && t.deal_status === 'won') {
        return res.status(400).json({ error: 'A won deal can’t be archived while its contract is in Delivery. Reopen the deal first (its contract goes on hold), then archive it or mark it lost.' });
      }
      // A work ticket archived from any lane is finished: it joins the Done archive.
      if (t.ticket_type === 'work') set("archived_at = datetime('now'), lane = 'done', done_at = COALESCE(done_at, datetime('now'))");
      else set("archived_at = datetime('now')");
    } else {
      if (t.pipedrive_archived_at) return res.status(400).json({ error: 'This deal is archived in Pipedrive. Unarchive it there and it comes back on the next pull.' });
      // Restored: back on the board. A Done work ticket gets another 14 days before it archives itself again; a pipeline
      // ticket keeps the date its deal closed.
      set("archived_at = NULL, archive_set_id = NULL, done_at = CASE WHEN done_at IS NOT NULL AND ticket_type = 'work' THEN datetime('now') ELSE done_at END");
    }
  }
  if (lane || typeof b.locked === 'boolean' || typeof b.archived === 'boolean') {
    recordTicketUpdate(req.user, t, lane ? `Moved to ${LANES.find((l) => l.key === lane)?.label || lane}` : typeof b.archived === 'boolean' ? (b.archived ? 'Archived' : 'Restored') : (b.locked ? 'Locked in lane' : 'Unlocked'));
  }
  res.json({ ok: true });
});

/** Move a master ticket to another pipeline stage (null clears it). Used by the BD Pipeline board. */
r.put('/:id/stage', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type === 'work') return res.status(400).json({ error: 'Work tickets have no pipeline stage' });
  const stage = req.body?.pipeline_status ?? null;
  if (stage !== null && !statusesFor(t.pipeline_id).includes(stage)) return res.status(400).json({ error: 'Unknown pipeline stage' });
  db.transaction(() => {
    db.prepare("UPDATE tickets SET pipeline_status = ?, updated_at = datetime('now') WHERE id = ?").run(stage, t.id);
    // Lost is a closing stage: moving there loses the deal, moving out of it reopens the deal. Won is its own button.
    if (stage === 'Lost' && t.deal_status !== 'lost') setOutcome(t.id, 'lost', req.body?.lost_reason ?? t.lost_reason);
    else if (stage !== 'Lost' && t.deal_status === 'lost') setOutcome(t.id, 'open');
  })();
  recordTicketUpdate(req.user, t, stage ? `Stage: ${stage}` : 'Stage cleared');
  res.json({ ticket: ticketRow(t.id) });
});

/** Mark a pipeline ticket won, lost (with a reason) or open again. The ticket's stage follows: lost → Lost; won on KIT's own pipeline → Awarded. */
function setOutcome(id, status, lostReason = null) {
  const t = ticketRow(id);
  if (status === 'won') {
    db.prepare(`UPDATE tickets SET deal_status = 'won', won_at = COALESCE(won_at, datetime('now')), lost_at = NULL, lost_reason = NULL, done_at = COALESCE(done_at, datetime('now')),
      pipeline_status = CASE WHEN pipeline_id IS NULL THEN 'Awarded' WHEN pipeline_status = 'Lost' THEN ? ELSE pipeline_status END, updated_at = datetime('now') WHERE id = ?`)
      .run(lastOpenStage(t), id);
  } else if (status === 'lost') {
    db.prepare(`UPDATE tickets SET deal_status = 'lost', lost_at = COALESCE(lost_at, datetime('now')), won_at = NULL, lost_reason = ?, done_at = COALESCE(done_at, datetime('now')),
      pipeline_status = 'Lost', updated_at = datetime('now') WHERE id = ?`).run(String(lostReason || '').trim() || null, id);
  } else {
    db.prepare(`UPDATE tickets SET deal_status = 'open', won_at = NULL, lost_at = NULL, lost_reason = NULL, done_at = NULL, lane = NULL, lane_locked = 0,
      pipeline_status = CASE WHEN pipeline_status = 'Lost' THEN ? ELSE pipeline_status END, updated_at = datetime('now') WHERE id = ?`).run(lastOpenStage(t), id);
  }
}
/** The stage a ticket was in before it was lost, from its history; failing that, its pipeline's first stage. */
function lastOpenStage(t) {
  const last = db.prepare("SELECT pipeline_status FROM ticket_history WHERE ticket_id = ? AND pipeline_status IS NOT NULL AND pipeline_status != 'Lost' ORDER BY id DESC LIMIT 1").get(t.id);
  return last?.pipeline_status || statusesFor(t.pipeline_id)[0] || null;
}

/**
 * Body: { deal_status: 'won' | 'lost' | 'open', lost_reason? }. Won puts the ticket into Delivery as a contract; lost takes a
 * reason (Pipedrive's lost reasons are offered); open reopens a closed deal. On a Pipedrive deal the change is synced.
 */
r.put('/:id/outcome', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets are won or lost' });
  const status = req.body?.deal_status;
  if (!['won', 'lost', 'open'].includes(status)) return res.status(400).json({ error: 'Choose won, lost or open' });
  setOutcome(t.id, status, req.body?.lost_reason);
  recordWork(req.user, { kind: 'ticket', ticket_id: t.id, summary: `${t.opportunity_title}: ${status === 'open' ? 'reopened' : status}` });
  res.json({ ticket: ticketRow(t.id), program: db.prepare('SELECT id FROM delivery_programs WHERE ticket_id = ?').get(t.id) || null });
});

// ---- Full timeline of a master ticket, newest first

/** A ticket as the timeline shows it, with everything that has happened on it, newest first; null for an unknown ticket. */
export function ticketTimeline(id) {
  const t = db.prepare(`SELECT t.*, u.first_name, u.last_name, e.name AS event_name, m.name AS work_team_name FROM tickets t
    LEFT JOIN users u ON u.id = t.created_by LEFT JOIN events e ON e.id = t.event_id LEFT JOIN teams m ON m.id = t.work_team_id WHERE t.id = ?`).get(id);
  if (!t) return null;
  const ticket = { id: t.id, ticket_type: t.ticket_type, owner_id: t.created_by, created_by: t.created_by, owner_name: t.first_name ? `${t.first_name} ${t.last_name}` : null, opportunity_title: t.opportunity_title, organization: t.organization, pipeline_status: t.pipeline_status, value: t.value, created_at: t.created_at,
    pwin: ticketPwin(t), event_id: t.event_id ?? null, event_name: t.event_name ?? null,
    team_name: t.ticket_type === 'bid' ? 'BD' : t.work_team_name ?? null,
    // Whether it has left the board: archived by hand, or Done long enough (being Done doesn't depend on recent activity).
    archived: isArchived(t, laneFor({ ...t, last_activity: t.updated_at })),
    pipedrive_archived_at: t.pipedrive_archived_at ?? null, pipedrive_deleted_at: t.pipedrive_deleted_at ?? null,
    bd_director_id: t.bd_director_id ?? null, territory_id: t.territory_id ?? null,
    projected_win_date: t.projected_win_date ?? null, win_date_undetermined: !!t.win_date_undetermined,
    lost_reason: t.lost_reason ?? null, probability: t.probability ?? null, currency: t.currency ?? null,
    labels: json.parse(t.labels, []), source: t.source ?? null, deal_status: t.deal_status || 'open', won_at: t.won_at ?? null, lost_at: t.lost_at ?? null,
    pipeline_id: t.pipeline_id ?? null, pipedrive_id: t.pipedrive_id ?? null, organization_id: t.organization_id ?? null,
    lost_reasons: (fieldsOf('deal').find((f) => f.key === 'lost_reason')?.options || []).map((o) => o.label) };
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
      file: { id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type, step_type: f.step_type ?? null, step_id: f.process_step_id ?? null, url: f.url ?? null, email_id: f.email_id ?? null, synced: !!(f.pipedrive_id || f.pipedrive_note_id) },
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
  return { ticket, events, row: t };
}

r.get('/:id/timeline', (req, res) => {
  const tl = ticketTimeline(req.params.id);
  if (!tl) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ ticket: tl.ticket, events: tl.events });
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
  notifyTicketOwner(req.user, t, body, { ticket_id: t.id, card_id: cardId, comment_id: id });
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
r.put('/comments/:id/pin', ownerOnly(ofComment), (req, res) => {
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
      decision: p.decision || '', pricing: p.pricing || '',
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
r.post('/:id/process', ownerOnly(), (req, res) => {
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

/** Body may hold step_type, step_date, reviews, notes, decision (Proceed, Revise, No-Bid or none) and pricing. Anyone can update a milestone. */
r.put('/process/:pid', ownerOnly(ofStep), (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Process step not found' });
  const b = req.body || {};
  if (b.step_type !== undefined && !PROCESS_TYPES.includes(b.step_type)) return res.status(400).json({ error: 'Choose a milestone' });
  if (b.decision !== undefined && b.decision && !DECISIONS.includes(b.decision)) return res.status(400).json({ error: 'Choose a decision' });
  db.prepare(`UPDATE ticket_process_steps SET step_type = ?, step_date = ?, reviews = ?, notes = ?, decision = ?, pricing = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
    b.step_type ?? p.step_type,
    b.step_date !== undefined ? isoDate(b.step_date) : p.step_date,
    b.reviews !== undefined ? json.str(cleanReviews(b.reviews)) : p.reviews,
    typeof b.notes === 'string' ? b.notes.trim() : p.notes,
    b.decision !== undefined ? (b.decision || null) : p.decision,
    typeof b.pricing === 'string' ? b.pricing.trim() : p.pricing,
    req.user.id, p.id,
  );
  touch(p.ticket_id);
  recordTicketUpdate(req.user, ticketRow(p.ticket_id), `Process step: ${b.step_type ?? p.step_type}`);
  res.json({ steps: listProcess(p.ticket_id) });
});

/** Its documents stay on the ticket. */
r.delete('/process/:pid', ownerOnly(ofStep), (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Process step not found' });
  db.prepare('DELETE FROM ticket_process_steps WHERE id = ?').run(p.id);
  db.prepare("DELETE FROM work_log WHERE kind = 'process' AND ref_id = ?").run(p.id);
  touch(p.ticket_id);
  recordTicketUpdate(req.user, ticketRow(p.ticket_id), `Process step removed: ${p.step_type}`);
  res.json({ steps: listProcess(p.ticket_id) });
});

r.post('/process/:pid/files', ownerOnly(ofStep), upload.single('file'), (req, res) => {
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

// ---- Process view: the whole pursuit left to right, from how the lead came in, through strategy and shaping, to each milestone

/**
 * Everything the Process view shows for a pipeline ticket:
 *   lead: how the lead came in, oldest first (the ticket's creation and source, the event it came from, marketing spend on
 *     it, the contacts involved and what was logged with them);
 *   strategy: the ticket under each person's priority accounts (tier, account and the account strategy), where it sits on
 *     each person's priority list, the ticket's own strategy, and its win assessment and PWIN;
 *   milestones: the process steps, oldest first; events: the rest of the timeline (comments, activities, documents, emails),
 *     which the view splits by milestone date; people: everyone the milestones name, by id.
 */
r.get('/:id/process-view', (req, res) => {
  const tl = ticketTimeline(req.params.id);
  if (!tl) return res.status(404).json({ error: 'Ticket not found' });
  const t = tl.row;
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets have a process view' });
  const userRow = (id) => (id ? db.prepare('SELECT id, first_name, last_name FROM users WHERE id = ?').get(id) || null : null);
  const pipeline = listPipelines().find((p) => (p.id ?? null) === (t.pipeline_id ?? null));
  const director = userRow(t.bd_director_id);
  const ticket = {
    ...tl.ticket, owner: userRow(t.created_by), director, territory: t.territory_id ? db.prepare('SELECT name FROM territories WHERE id = ?').get(t.territory_id)?.name || null : null,
    source_origin: t.source_origin ?? null, pipeline_name: pipeline?.name || null, projected_win_date: t.projected_win_date ?? null,
    updated_at: t.updated_at, archived_at: t.archived_at ?? null,
  };

  // ---- Lead generated by
  const lead = [{ type: 'created', at: t.created_at, by: ticket.owner, source: t.source ?? null, origin: t.source_origin ?? null, pipedrive: !!t.pipedrive_id }];
  if (t.event_id) {
    const e = db.prepare('SELECT id, name, date_from, date_to FROM events WHERE id = ?').get(t.event_id);
    if (e) lead.push({ type: 'event', at: e.date_from || t.created_at, event: e });
  }
  db.prepare(`SELECT s.*, e.name AS event_name, u.first_name || ' ' || u.last_name AS user_name FROM marketing_spend s
    LEFT JOIN events e ON e.id = s.event_id LEFT JOIN users u ON u.id = s.user_id WHERE s.ticket_id = ? ORDER BY s.spent_on, s.id`).all(t.id)
    .forEach((s) => lead.push({ type: 'spend', at: s.spent_on, spend: { id: s.id, amount: s.amount, description: s.description, category: s.category, vendor: s.vendor, event_name: s.event_name, user_name: s.user_name, note: s.note } }));
  const contacts = db.prepare(`SELECT c.*, tc.created_at AS linked_at, tc.is_primary, a.first_name AS a_first, a.last_name AS a_last FROM ticket_contacts tc
    JOIN contacts c ON c.id = tc.contact_id LEFT JOIN users a ON a.id = tc.added_by WHERE tc.ticket_id = ? ORDER BY tc.created_at, c.id`).all(t.id);
  contacts.forEach((c) => {
    lead.push({ type: 'contact', at: c.linked_at, contact: { id: c.id, first_name: c.first_name, last_name: c.last_name, organization: c.organization, role: c.role, relationship: c.relationship, is_primary: !!c.is_primary },
      by: c.a_first ? `${c.a_first} ${c.a_last}` : null });
    db.prepare(`SELECT i.*, u.first_name, u.last_name FROM contact_interactions i LEFT JOIN users u ON u.id = i.author_id WHERE i.contact_id = ? ORDER BY i.created_at, i.id`).all(c.id)
      .forEach((i) => lead.push({ type: 'interaction', at: i.created_at, contact: { id: c.id, first_name: c.first_name, last_name: c.last_name }, body: i.body, by: i.first_name ? `${i.first_name} ${i.last_name}` : null }));
  });
  lead.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // ---- Strategy: tiers, priority lists, the ticket's own strategy and its assessment
  const tiers = db.prepare(`SELECT tr.user_id, tr.name AS tier, a.name AS account, pt.position,
      (SELECT group_concat(body, char(10)) FROM (SELECT body FROM account_strategies s WHERE s.account_id = a.id ORDER BY s.position, s.id)) AS account_strategy,
      (SELECT COUNT(*) FROM priority_account_tickets x WHERE x.account_id = a.id) AS account_tickets
    FROM priority_account_tickets pt JOIN priority_accounts a ON a.id = pt.account_id JOIN priority_tiers tr ON tr.id = a.tier_id
    WHERE pt.ticket_id = ? ORDER BY tr.position, a.position`).all(t.id)
    .map((x) => ({ user: userRow(x.user_id), tier: x.tier, account: x.account, account_strategy: x.account_strategy || '', position: x.position + 1, account_tickets: x.account_tickets }));
  const lists = db.prepare('SELECT user_id, position, (SELECT COUNT(*) FROM priority_list_tickets y WHERE y.user_id = l.user_id) AS total FROM priority_list_tickets l WHERE ticket_id = ?').all(t.id)
    .map((x) => ({ user: userRow(x.user_id), position: x.position + 1, total: x.total }));
  const strategy = {
    tiers, lists,
    text: t.strategy || '', updated_at: t.strategy_updated_at ?? null, updated_by: nameOf(t.strategy_updated_by),
    assessment: json.parse(t.assessment, {}), assessment_updated_at: t.assessment_updated_at ?? null, assessment_updated_by: nameOf(t.assessment_updated_by),
    pwin: ticketPwin(t), model: pwinModel(),
  };

  const milestones = listProcess(t.id);
  const people = {};
  milestones.forEach((m) => Object.values(m.reviews).forEach((a) => [...a.people, ...a.approved].forEach((id) => { if (!people[id]) people[id] = userRow(id); })));
  res.json({ ticket, lead, strategy, milestones, events: tl.events.filter((e) => e.type !== 'ticket'), people });
});

// ---- Documents

r.post('/:id/files', ownerOnly(), upload.single('file'), (req, res) => {
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

/** Only here, in KIT. A Pipedrive file isn't imported again, and goes from Pipedrive with an admin's send if that's turned on. */
r.delete('/files/:id', ownerOnly(ofFile), (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const deal = db.prepare('SELECT pipedrive_id FROM tickets WHERE id = ?').get(f.ticket_id)?.pipedrive_id;
  db.prepare("DELETE FROM work_log WHERE kind = 'file' AND ref_id = ?").run(f.id);
  db.prepare('DELETE FROM ticket_files WHERE id = ?').run(f.id);
  recordTicketUpdate(req.user, ticketRow(f.ticket_id), 'Document removed');
  queueDelete('file', f.pipedrive_id, deal);
  queueDelete('note', f.pipedrive_note_id, deal); // a linked document went as a note with its link
  if (f.stored_name && !f.url) fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
  res.json({ ok: true });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.url) return res.redirect(f.url);
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});


// ---- Deal details: the Pipedrive deal fields that have no other place on the ticket, its followers and its products.

const orgOut = (o) => (o ? { ...o, labels: json.parse(o.labels, []) } : null);
const detailsOf = (t) => ({
  lost_reason: t.lost_reason ?? null, probability: t.probability ?? null, currency: t.currency ?? null, source: t.source ?? null,
  source_origin: t.source_origin ?? null, source_origin_id: t.source_origin_id ?? null, source_channel_id: t.source_channel_id ?? null,
  deal_status: t.deal_status || 'open', won_at: t.won_at ?? null, lost_at: t.lost_at ?? null, value: t.value ?? null, projected_win_date: t.projected_win_date ?? null,
  labels: json.parse(t.labels, []), custom_fields: json.parse(t.custom_fields, []), pipedrive_id: t.pipedrive_id ?? null,
  pipeline_id: t.pipeline_id ?? null, pipelines: listPipelines().filter((p) => !p.closed || p.id === (t.pipeline_id ?? null)).map(({ id, name }) => ({ id, name })),
  // Pipedrive's field definitions, so the form shows every custom deal field with its options, and people's and organizations' labels.
  fields: { deal: customDealFields(), person: fieldsOf('person'), organization: fieldsOf('organization') },
  organization: orgOut(t.organization_id ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(t.organization_id) : null)
    || orgOut(t.organization ? db.prepare('SELECT * FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(t.organization) : null),
  people: db.prepare(`SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.role, c.labels, c.organization, c.pipedrive_id, tc.is_primary FROM ticket_contacts tc
    JOIN contacts c ON c.id = tc.contact_id WHERE tc.ticket_id = ? ORDER BY tc.is_primary DESC, c.last_name, c.first_name`).all(t.id).map((c) => ({ ...c, labels: json.parse(c.labels, []), is_primary: !!c.is_primary })),
  followers: db.prepare(`SELECT u.id, u.first_name, u.last_name FROM ticket_followers f JOIN users u ON u.id = f.user_id
    WHERE f.ticket_id = ? ORDER BY u.last_name, u.first_name`).all(t.id),
  products: db.prepare('SELECT * FROM ticket_products WHERE ticket_id = ? ORDER BY position, id').all(t.id),
  installments: db.prepare('SELECT * FROM ticket_installments WHERE ticket_id = ? ORDER BY billing_date, id').all(t.id),
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
r.put('/:id/details', ownerOnly(), (req, res) => {
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
    // Pipedrive's fields keep their key (so the change is synced); KIT-only fields are just a name and value.
    set.custom_fields = json.str((b.custom_fields || []).map((f) => ({ ...(f.key ? { key: String(f.key) } : {}), name: String(f.name ?? '').trim(), value: String(f.value ?? '').trim() }))
      .filter((f) => f.name && (f.value || !f.key)));
  }
  if ('pipeline_id' in b && (Number(b.pipeline_id) || null) !== (t.pipeline_id ?? null)) {
    const p = listPipelines().find((x) => x.id === (Number(b.pipeline_id) || null));
    if (!p) return res.status(400).json({ error: 'Unknown pipeline' });
    if (p.closed) return res.status(400).json({ error: KIT_PIPELINE_CLOSED });
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
  recordTicketUpdate(req.user, t, 'Details');
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
r.put('/:id/labels', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('UPDATE tickets SET labels = ?, labels_pending = ? WHERE id = ?').run(cleanLabels(req.body?.labels), t.pipedrive_id ? 1 : 0, t.id);
  touch(t.id);
  recordTicketUpdate(req.user, t, 'Labels');
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

r.post('/:id/products', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const { out, error } = productFields(req.body || {});
  if (error) return res.status(400).json({ error });
  const pos = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM ticket_products WHERE ticket_id = ?').get(t.id).p;
  db.prepare(`INSERT INTO ticket_products (ticket_id, name, quantity, item_price, discount, comments, position)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(t.id, out.name, out.quantity, out.item_price, out.discount, out.comments, pos);
  touch(t.id);
  recordTicketUpdate(req.user, t, 'Products');
  res.json(detailsOf(t));
});

r.put('/products/:pid', ownerOnly(ofProduct), (req, res) => {
  const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  const { out, error } = productFields(req.body || {}, true);
  if (error) return res.status(400).json({ error });
  Object.entries(out).forEach(([k, v]) => db.prepare(`UPDATE ticket_products SET ${k} = ? WHERE id = ?`).run(v, p.id));
  db.prepare('UPDATE ticket_products SET pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?').run(p.id);
  touch(p.ticket_id);
  recordTicketUpdate(req.user, ticketRow(p.ticket_id), 'Products');
  res.json(detailsOf(ticketRow(p.ticket_id)));
});

r.delete('/products/:pid', ownerOnly(ofProduct), (req, res) => {
  const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  db.prepare('DELETE FROM ticket_products WHERE id = ?').run(p.id);
  queueDelete('product', p.pipedrive_id, ticketRow(p.ticket_id)?.pipedrive_id);
  touch(p.ticket_id);
  recordTicketUpdate(req.user, ticketRow(p.ticket_id), 'Products');
  res.json(detailsOf(ticketRow(p.ticket_id)));
});

// ---- Installments: the deal's payment schedule (Pipedrive's installments), two-way.

function installmentFields(b) {
  const amount = Number(b.amount);
  if (!(amount > 0)) return { error: 'Enter an amount above zero' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.billing_date || '')) return { error: 'Enter the billing date' };
  return { out: { description: String(b.description ?? '').trim() || null, amount, billing_date: b.billing_date } };
}

r.post('/:id/installments', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const { out, error } = installmentFields(req.body || {});
  if (error) return res.status(400).json({ error });
  db.prepare('INSERT INTO ticket_installments (ticket_id, description, amount, billing_date) VALUES (?, ?, ?, ?)').run(t.id, out.description, out.amount, out.billing_date);
  touch(t.id);
  recordTicketUpdate(req.user, t, 'Funding');
  res.json(detailsOf(t));
});

r.put('/installments/:iid', ownerOnly(ofInstallment), (req, res) => {
  const i = db.prepare('SELECT * FROM ticket_installments WHERE id = ?').get(req.params.iid);
  if (!i) return res.status(404).json({ error: 'Installment not found' });
  const { out, error } = installmentFields({ ...i, ...(req.body || {}) });
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE ticket_installments SET description = ?, amount = ?, billing_date = ?, pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?')
    .run(out.description, out.amount, out.billing_date, i.id);
  touch(i.ticket_id);
  recordTicketUpdate(req.user, ticketRow(i.ticket_id), 'Funding');
  res.json(detailsOf(ticketRow(i.ticket_id)));
});

r.delete('/installments/:iid', ownerOnly(ofInstallment), (req, res) => {
  const i = db.prepare('SELECT * FROM ticket_installments WHERE id = ?').get(req.params.iid);
  if (!i) return res.status(404).json({ error: 'Installment not found' });
  db.prepare('DELETE FROM ticket_installments WHERE id = ?').run(i.id);
  queueDelete('installment', i.pipedrive_id, ticketRow(i.ticket_id)?.pipedrive_id);
  touch(i.ticket_id);
  recordTicketUpdate(req.user, ticketRow(i.ticket_id), 'Funding');
  res.json(detailsOf(ticketRow(i.ticket_id)));
});

// ---- The deal's organization: Pipedrive's organization record, edited here and synced.

/** Body: name, address, labels [names], website, linkedin, industry, annual_revenue, employee_count. Makes the organization if the ticket has none. */
r.put('/:id/organization', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const text = (v) => String(v ?? '').trim() || null;
  const name = text(b.name) || t.organization;
  if (!name) return res.status(400).json({ error: 'Name the organization' });
  const fields = {
    name, address: text(b.address), labels: json.str([...new Set((Array.isArray(b.labels) ? b.labels : []).map((x) => String(x).trim()).filter(Boolean))]),
    website: text(b.website), linkedin: text(b.linkedin), industry: text(b.industry), annual_revenue: text(b.annual_revenue),
    employee_count: b.employee_count === '' || b.employee_count == null ? null : Math.round(Number(b.employee_count)) || null,
  };
  db.transaction(() => {
    let orgId = t.organization_id;
    if (!orgId) {
      orgId = db.prepare('SELECT id FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(name)?.id
        ?? db.prepare('INSERT INTO organizations (name) VALUES (?)').run(name).lastInsertRowid;
    }
    db.prepare(`UPDATE organizations SET name = @name, address = @address, labels = @labels, website = @website, linkedin = @linkedin, industry = @industry,
      annual_revenue = @annual_revenue, employee_count = @employee_count, pipedrive_pending = 1, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id: orgId });
    db.prepare("UPDATE tickets SET organization_id = ?, organization = ?, updated_at = datetime('now') WHERE id = ?").run(orgId, name, t.id);
  })();
  recordTicketUpdate(req.user, t, 'Organization');
  res.json(detailsOf(ticketRow(t.id)));
});

export default r;
