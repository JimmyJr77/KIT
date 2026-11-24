// Master tickets: the list of a user's tickets, each ticket's full timeline,
// question/comment threads, and document uploads.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting, withTeams, defaultAssignment, pipelineTicketsClosed, PIPELINE_TICKETS_CLOSED, BD_DIRECTOR_IDS } from '../db.js';
import { requireAdmin } from '../auth.js';
import { CRITERIA, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, pwin } from '../../src/lib/assessment.js';
import { LANES, laneFor, isArchived } from '../../src/lib/lanes.js';
import { recordWork, recordTicketUpdate } from '../worklog.js';
import { recordAction, UNDO_HEADER } from '../actions.js';
import { notifyMentions, notifyTicketOwner } from '../mentions.js';
import { ticketFields } from './priorities.js';
import { statusesFor, listPipelines, defaultPipeline, pipelineForNew, kitPipelineAllowed, KIT_PIPELINE_CLOSED, reportStager } from '../pipelines.js';
import '../sample/registry.js'; // sample_rows, so sample tickets aren't moved off KIT's own pipeline
import { queueDelete } from '../services/pipedrive.js';
import { fieldsOf, customDealFields, fieldValue } from '../services/pipedriveFields.js';
import { PROCESS_TYPES, DECISIONS, SA_RESPONSES, SHARED_FIELDS, cleanReviews, cleanFields, cleanQualification, GATE_OVERRIDES, gateDecision, gateRuleText, QUALIFICATION, milestoneOf } from '../../src/lib/process.js';
import { listObstacles, strategyText } from '../strategy.js';
import { addStaffingEvent, queueFromTags, isCriticality, settleTag, staffFromTags, gateFlagger, gateOut, mayOverrideGate, ensureGateDraft, gateRule, saveGateRule, mayEditGateRule } from '../staffing.js';
import { NEXT_STEP_SQL } from '../activities.js';
import { canEditTicket, ownerOnlyMessage } from '../../src/lib/ticketAccess.js';
import { focusTickets } from '../focus.js';
import { sourceFromEvent, linkGoogleSolution } from '../leads.js';

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

export const COMMENT_SQL = `SELECT m.*, u.first_name, u.last_name, c.title AS card_title, tk.opportunity_title AS ticket_title, ps.step_type AS process_step_type,
    (SELECT COUNT(*) FROM ticket_comments x WHERE x.parent_id = m.id) AS reply_count,
    (SELECT MAX(x.created_at) FROM ticket_comments x WHERE x.parent_id = m.id) AS last_reply_at,
    (SELECT GROUP_CONCAT(a.user_id) FROM card_assignees a WHERE a.card_id = m.card_id) AS card_assignee_ids
  FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id LEFT JOIN priority_cards c ON c.id = m.card_id
  JOIN tickets tk ON tk.id = m.ticket_id LEFT JOIN ticket_process_steps ps ON ps.id = m.process_step_id`;

export const commentOut = (m) => ({
  id: m.id, ticket_id: m.ticket_id, ticket_title: m.ticket_title, card_id: m.card_id, card_title: m.card_title, parent_id: m.parent_id,
  kind: m.kind, body: m.body, pinned: !!m.pinned, created_at: m.created_at, updated_at: m.updated_at ?? null, author: author(m), synced: !!m.pipedrive_id,
  target_type: m.target_type ?? null, target_id: m.target_id ?? null,
  step: m.process_step_type ? { id: m.process_step_id, type: m.process_step_type } : null, // the staffing event a SAC note is about
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
/**
 * Whether `user` may change a ticket's strategy (its obstacles and strategies): whoever may change the ticket (its owner,
 * an admin), a BD lead, the ticket's BD director, and a BD director who has the ticket's territory. It doesn't matter who wrote the obstacle or strategy.
 */
export function canEditStrategy(user, t) {
  if (!user || !t) return false;
  if (canEditTicket(user, t)) return true;
  if (db.prepare("SELECT 1 FROM user_teams ut JOIN teams tm ON tm.id = ut.team_id WHERE ut.user_id = ? AND tm.name = 'BD' AND ut.role = 'lead'").get(user.id)) return true;
  if (t.bd_director_id != null && Number(t.bd_director_id) === Number(user.id)) return true;
  return !!t.territory_id && !!db.prepare(`SELECT 1 FROM user_territories WHERE user_id = ? AND territory_id = ? AND user_id IN (${BD_DIRECTOR_IDS})`).get(user.id, t.territory_id);
}
const strategyOnly = (ticketIdOf = (req) => req.params.id) => (req, res, next) => {
  const t = ticketRow(ticketIdOf(req));
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!canEditStrategy(req.user, t)) return res.status(403).json({ error: 'Only the ticket’s owner, its BD director, a BD director on its territory, a BD lead or an admin can change its strategy. You can still comment on it.' });
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

// ---- What makes a qualified lead: the rule an Initial Gate Review is decided by. Anyone reads it; admins and BD team leads set it.
const gateRuleOut = (user) => ({ rule: gateRule(), text: gateRuleText(gateRule()), tests: QUALIFICATION, can_edit: mayEditGateRule(user) });
r.get('/gate-rule', (req, res) => res.json(gateRuleOut(req.user)));

/**
 * Body: { yes: [yes/no test keys that must be a Yes], min: { [scored test]: 0-5, 0 for not counted }, sa: whether the
 * architect must approve }. It decides every review from then on, open or done: the tags on tickets follow at once.
 */
r.put('/gate-rule', (req, res) => {
  if (!mayEditGateRule(req.user)) return res.status(403).json({ error: 'Only an admin or a BD team lead can change what makes a qualified lead' });
  const min = req.body?.min || {};
  if (Object.values(min).some((v) => !Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 5)) return res.status(400).json({ error: 'Each score must be 1 to 5, or not counted' });
  saveGateRule(req.body);
  res.json(gateRuleOut(req.user));
});

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
  // The personal alias this person has each ticket in, while the ticket is still in that alias's stage.
  const aliasOf = new Map(db.prepare(`SELECT p.ticket_id, p.alias_id FROM stage_alias_tickets p JOIN stage_aliases a ON a.id = p.alias_id JOIN tickets t ON t.id = p.ticket_id
    WHERE p.user_id = ? AND t.pipeline_id IS a.pipeline_id AND t.pipeline_status = a.stage`).all(req.user.id).map((x) => [x.ticket_id, x.alias_id]));
  const gateFlags = gateFlagger();
  res.json({ tickets: rows.filter((t) => !focus || focus.has(t.id)).map((t) => {
    const lane = laneFor(t);
    return { ...t, ...gateFlags(t), alias_id: aliasOf.get(t.id) ?? null, labels: json.parse(t.labels, []), next_step: json.parse(t.next_step, null), tasks: tasks[t.id] || { open: 0, done: 0 }, pwin: ticketPwin(t, model), lane, archived: isArchived(t, lane) };
  }) });
});

/**
 * Create a ticket on its own, without a priority. Body: { ticket_type: 'bid' | 'work', opportunity_title, organization,
 * account_type, pipeline_status, value, bd_director_id, territory_id }. A pipeline ticket left without a director or territory
 * gets the defaults (see defaultAssignment). With `source_event_id`, a pipeline ticket came out of that event: it's tied
 * to it and tagged with its lead sources (see server/leads.js).
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
  // Pipedrive's deal fields filled in on the form ({ fields: { <field key>: text } }), kept as the deal's custom fields.
  const dealFields = type === 'bid' ? mergeDealFields([], req.body?.fields) : { list: [] };
  if (dealFields.error) return res.status(400).json({ error: dealFields.error });
  if (pipeline && fields.pipeline_status && !pipeline.statuses.includes(fields.pipeline_status)) fields.pipeline_status = null;
  const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, work_team_id, value, ticket_type, created_by,
      bd_director_id, territory_id, projected_win_date, win_date_undetermined, pipeline_id)
    VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @work_team_id, @value, @ticket_type, @created_by,
      @bd_director_id, @territory_id, @projected_win_date, @win_date_undetermined, @pipeline_id)`)
    .run({ ...fields, ...assign, ticket_type: type, created_by: req.user.id, pipeline_id: pipeline?.id ?? null }).lastInsertRowid;
  if (type === 'bid') {
    if (dealFields.list.length) db.prepare('UPDATE tickets SET custom_fields = ? WHERE id = ?').run(json.str(dealFields.list), id);
    if (String(req.body?.gov_lead ?? '').trim()) setGovLead(ticketRow(id), req.body.gov_lead, req.user.id);
    linkGoogleSolution(id, 'field');
  }
  recordWork(req.user, { kind: 'ticket', ticket_id: id, summary: fields.opportunity_title });
  const eventId = type === 'bid' && Number(req.body?.source_event_id);
  if (eventId && db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) sourceFromEvent(id, eventId, req.user.id);
  res.json({ ticket: ticketRow(id) });
});

/**
 * A ticket's custom_fields list with Pipedrive deal fields set from a { <field key>: text } map: a blank value takes the
 * field off, keys Pipedrive doesn't have are ignored, and a choice Pipedrive doesn't offer gives { error }.
 */
function mergeDealFields(existing, values) {
  const list = Array.isArray(existing) ? [...existing] : [];
  if (!values || typeof values !== 'object') return { list };
  const defs = new Map(customDealFields().map((f) => [f.key, f]));
  for (const [key, raw] of Object.entries(values)) {
    const field = defs.get(key);
    if (!field) continue;
    const value = String(raw ?? '').trim();
    const checked = value ? fieldValue(field, value) : null;
    if (checked?.error) return { error: checked.error };
    const at = list.findIndex((f) => f.key === key);
    if (!value) { if (at >= 0) list.splice(at, 1); } else if (at >= 0) list[at] = { key, name: field.name, value };
    else list.push({ key, name: field.name, value });
  }
  return { list };
}

/**
 * The Gov/Client Lead: the ticket's primary contact (Pipedrive's contact person on the deal), by name. Someone already in
 * the CRM under that name is used (on this ticket first, then at its organization); anyone else is added to the CRM at
 * the ticket's organization. A blank name leaves the ticket without a lead; the person stays on it and in the CRM.
 */
function setGovLead(t, name, userId) {
  const n = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const FULL = "lower(trim(c.first_name || ' ' || COALESCE(c.last_name, '')))";
  const current = db.prepare(`SELECT ${FULL} AS name FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id WHERE tc.ticket_id = ? AND tc.is_primary = 1`).get(t.id);
  if ((current?.name || '') === n.toLowerCase()) return;
  db.prepare('UPDATE ticket_contacts SET is_primary = 0 WHERE ticket_id = ?').run(t.id);
  if (!n) return;
  const named = db.prepare(`SELECT c.id, c.organization, (SELECT 1 FROM ticket_contacts x WHERE x.ticket_id = @t AND x.contact_id = c.id) AS linked
    FROM contacts c WHERE ${FULL} = lower(@n) ORDER BY c.id`).all({ t: t.id, n });
  const org = String(t.organization || '').toLowerCase();
  let id = (named.find((c) => c.linked) || named.find((c) => org && String(c.organization || '').toLowerCase() === org) || named[0])?.id;
  if (!id) {
    const [first, ...rest] = n.split(' ');
    const orgId = t.organization_id ?? (t.organization ? db.prepare('SELECT id FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(t.organization)?.id
      ?? db.prepare('INSERT INTO organizations (name) VALUES (?)').run(t.organization).lastInsertRowid : null);
    id = db.prepare(`INSERT INTO contacts (first_name, last_name, organization, organization_id, labels, created_by) VALUES (?, ?, ?, ?, '[]', ?)`)
      .run(first, rest.join(' ') || null, t.organization || null, orgId, userId).lastInsertRowid;
  }
  db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id, added_by) VALUES (?, ?, ?)').run(t.id, id, userId);
  db.prepare('UPDATE ticket_contacts SET is_primary = 1 WHERE ticket_id = ? AND contact_id = ?').run(t.id, id);
}

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

/**
 * Body: { title }. Renames a pipeline or work ticket. On a Pipedrive deal the new title goes with the next send, like any
 * other deal field.
 */
r.put('/:id/title', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type === 'account') return res.status(400).json({ error: 'A priority account is renamed from its account, not here' });
  const title = String(req.body?.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 255);
  if (!title) return res.status(400).json({ error: 'Give the ticket a name' });
  if (title !== t.opportunity_title) {
    db.prepare("UPDATE tickets SET opportunity_title = ?, updated_at = datetime('now') WHERE id = ?").run(title, t.id);
    recordTicketUpdate(req.user, t, 'Name');
    recordAction(req, { ticket_id: t.id, summary: `Renamed to ${title} (from ${t.opportunity_title})`,
      undo: { method: 'PUT', path: `/tickets/${t.id}/title`, body: { title: t.opportunity_title } }, guard: { table: 'tickets', id: t.id, fields: { opportunity_title: title } } });
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
    obstacles: listObstacles(t.id), strategy_updated_at: t.strategy_updated_at, strategy_updated_by: nameOf(t.strategy_updated_by),
    can_edit_strategy: canEditStrategy(req.user, t),
    assessment: json.parse(t.assessment, {}), assessment_updated_at: t.assessment_updated_at, assessment_updated_by: nameOf(t.assessment_updated_by),
  });
});

// ---- Strategy: obstacles, each with its strategies (server/strategy.js). The ticket's owner, its BD director,
// a BD director on its territory, a BD lead or an admin changes them (canEditStrategy).
const ofObstacle = ticketOf('ticket_obstacles', 'oid');
const ofStrategy = (req) => db.prepare('SELECT o.ticket_id FROM ticket_strategies s JOIN ticket_obstacles o ON o.id = s.obstacle_id WHERE s.id = ?').get(req.params.sid)?.ticket_id;
const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
/** After a change to a ticket's strategy: who and when, the ticket's history, and the list as it now stands. */
const strategySaved = (req, res, ticketId, what = 'Win strategy') => {
  db.prepare("UPDATE tickets SET strategy_updated_at = datetime('now'), strategy_updated_by = ?, updated_at = datetime('now') WHERE id = ?").run(req.user.id, ticketId);
  const t = ticketRow(ticketId);
  recordTicketUpdate(req.user, t, what);
  res.json({ obstacles: listObstacles(ticketId), strategy_updated_at: t.strategy_updated_at, strategy_updated_by: nameOf(req.user.id) });
};

/** Body: { obstacle, strategy }. A new obstacle with its first strategy; either may be left blank, not both. */
r.post('/:id/obstacles', strategyOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets have a strategy' });
  const obstacle = text(req.body?.obstacle);
  const strategy = text(req.body?.strategy);
  if (!obstacle && !strategy) return res.status(400).json({ error: 'Write the obstacle, the strategy, or both' });
  db.transaction(() => {
    const oid = db.prepare('INSERT INTO ticket_obstacles (ticket_id, body, position, created_by) VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM ticket_obstacles WHERE ticket_id = ?), ?)')
      .run(t.id, obstacle, t.id, req.user.id).lastInsertRowid;
    if (strategy) db.prepare('INSERT INTO ticket_strategies (obstacle_id, body, created_by) VALUES (?, ?, ?)').run(oid, strategy, req.user.id);
  })();
  strategySaved(req, res, t.id, 'Win strategy: obstacle added');
});

/**
 * Body: any of { body, resolved, outcome }. `resolved` true crosses the obstacle off (it's kept, with `outcome`: what came
 * of it), false opens it again. `outcome` on its own changes what a crossed-off one says.
 */
r.put('/obstacles/:oid', strategyOnly(ofObstacle), (req, res) => {
  const o = db.prepare('SELECT * FROM ticket_obstacles WHERE id = ?').get(req.params.oid);
  const b = req.body || {};
  const body = 'body' in b ? text(b.body) : o.body;
  if (!body && !db.prepare('SELECT 1 FROM ticket_strategies WHERE obstacle_id = ?').get(o.id)) return res.status(400).json({ error: 'Write the obstacle' });
  const resolved = 'resolved' in b ? !!b.resolved : !!o.resolved_at;
  const outcome = resolved ? ('outcome' in b ? text(b.outcome) : o.outcome || '') : null;
  db.prepare(`UPDATE ticket_obstacles SET body = ?, outcome = ?, updated_at = datetime('now'),
      resolved_at = CASE WHEN ? THEN COALESCE(resolved_at, datetime('now')) ELSE NULL END, resolved_by = CASE WHEN ? THEN COALESCE(resolved_by, ?) ELSE NULL END WHERE id = ?`)
    .run(body, outcome || null, resolved ? 1 : 0, resolved ? 1 : 0, req.user.id, o.id);
  strategySaved(req, res, o.ticket_id, resolved && !o.resolved_at ? 'Win strategy: obstacle crossed off' : !resolved && o.resolved_at ? 'Win strategy: obstacle reopened' : 'Win strategy');
});

/** Removes an obstacle and its strategies outright (crossing it off keeps it). */
r.delete('/obstacles/:oid', strategyOnly(ofObstacle), (req, res) => {
  const o = db.prepare('SELECT * FROM ticket_obstacles WHERE id = ?').get(req.params.oid);
  db.prepare('DELETE FROM ticket_obstacles WHERE id = ?').run(o.id);
  strategySaved(req, res, o.ticket_id, 'Win strategy: obstacle removed');
});

/** Body: { body }. Another strategy for an obstacle. */
r.post('/obstacles/:oid/strategies', strategyOnly(ofObstacle), (req, res) => {
  const o = db.prepare('SELECT * FROM ticket_obstacles WHERE id = ?').get(req.params.oid);
  const body = text(req.body?.body);
  if (!body) return res.status(400).json({ error: 'Write the strategy' });
  db.prepare('INSERT INTO ticket_strategies (obstacle_id, body, created_by) VALUES (?, ?, ?)').run(o.id, body, req.user.id);
  strategySaved(req, res, o.ticket_id, 'Win strategy: strategy added');
});

/** Body: { body }. */
r.put('/strategies/:sid', strategyOnly(ofStrategy), (req, res) => {
  const body = text(req.body?.body);
  if (!body) return res.status(400).json({ error: 'Write the strategy' });
  db.prepare("UPDATE ticket_strategies SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, req.params.sid);
  strategySaved(req, res, ofStrategy(req));
});

r.delete('/strategies/:sid', strategyOnly(ofStrategy), (req, res) => {
  const ticketId = ofStrategy(req);
  db.prepare('DELETE FROM ticket_strategies WHERE id = ?').run(req.params.sid);
  strategySaved(req, res, ticketId, 'Win strategy: strategy removed');
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
        return res.status(400).json({ error: 'A paid deal can’t be archived while its contract is in Delivery. Reopen the deal first (its contract goes on hold), then archive it or mark it lost.' });
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

/**
 * Body: { before_id }. Place a pipeline ticket in its stage's priority order on the BD Pipeline board: just above
 * `before_id` (another open ticket in the same stage of the same pipeline), or last when it's null. The whole column is
 * renumbered, so tickets nobody had placed keep the order they were shown in.
 */
r.put('/:id/board-position', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets are on the board' });
  const column = db.prepare(`SELECT id FROM tickets WHERE ticket_type = 'bid' AND pipeline_id IS @p AND pipeline_status IS @s AND deal_status = 'open'
      AND archived_at IS NULL AND archive_set_id IS NULL AND id != @id
    ORDER BY board_position IS NULL, board_position, id DESC`).all({ p: t.pipeline_id, s: t.pipeline_status, id: t.id }).map((x) => x.id);
  const before = req.body?.before_id == null ? -1 : column.indexOf(Number(req.body.before_id));
  if (req.body?.before_id != null && before < 0) return res.status(400).json({ error: 'That ticket isn’t in this stage any more' });
  column.splice(before < 0 ? column.length : before, 0, t.id);
  db.transaction(() => column.forEach((id, i) => db.prepare('UPDATE tickets SET board_position = ? WHERE id = ?').run(i + 1, id)))();
  res.json({ order: column });
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
  // A recent action, unless it came out of Lost: putting it back would lose the deal again, dated today.
  if (stage !== t.pipeline_status && t.deal_status !== 'lost') {
    recordAction(req, { ticket_id: t.id, summary: `Moved to ${stage || 'no stage'}${t.pipeline_status ? ` (from ${t.pipeline_status})` : ''}`,
      undo: { method: 'PUT', path: `/tickets/${t.id}/stage`, body: { pipeline_status: t.pipeline_status } },
      guard: { table: 'tickets', id: t.id, fields: { pipeline_status: stage } } });
  }
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
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets are paid or lost' });
  const status = req.body?.deal_status;
  if (!['won', 'lost', 'open'].includes(status)) return res.status(400).json({ error: 'Choose won, lost or open' });
  setOutcome(t.id, status, req.body?.lost_reason);
  // An undo of a close also puts the ticket back in the stage it was closed from (a win on KIT's pipeline moves it to Awarded).
  if (status === 'open' && req.get(UNDO_HEADER) && statusesFor(t.pipeline_id).includes(req.body?.pipeline_status)) {
    db.prepare('UPDATE tickets SET pipeline_status = ? WHERE id = ?').run(req.body.pipeline_status, t.id);
  }
  recordWork(req.user, { kind: 'ticket', ticket_id: t.id, summary: `${t.opportunity_title}: ${status === 'open' ? 'reopened' : status === 'won' ? 'paid' : status}` });
  // A recent action when an open deal was closed: undoing it reopens the deal. Reopening isn't one, since closing it
  // again would date the win or loss today.
  if ((t.deal_status || 'open') === 'open' && status !== 'open') {
    recordAction(req, { ticket_id: t.id, summary: `Marked ${status === 'won' ? 'paid' : status}`, undo: { method: 'PUT', path: `/tickets/${t.id}/outcome`, body: { deal_status: 'open', pipeline_status: t.pipeline_status } },
      guard: { table: 'tickets', id: t.id, fields: { deal_status: status } } });
  }
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
    report_stage: reportStager().of(t.pipeline_id, t.pipeline_status), // the stage reports count it as: a blended custom stage reads as its standard one
    labels: json.parse(t.labels, []), ...gateFlagger()(t), source: t.source ?? null, deal_status: t.deal_status || 'open', won_at: t.won_at ?? null, lost_at: t.lost_at ?? null,
    pipeline_id: t.pipeline_id ?? null, pipedrive_id: t.pipedrive_id ?? null, organization_id: t.organization_id ?? null,
    lost_reasons: (fieldsOf('deal').find((f) => f.key === 'lost_reason')?.options || []).map((o) => o.label),
    // The events it's tied to: the ones it came out of first.
    events: db.prepare(`SELECT e.id, e.name, e.date_from, x.sourced FROM ticket_events x JOIN events e ON e.id = x.event_id
      WHERE x.ticket_id = ? ORDER BY x.sourced DESC, e.date_from`).all(t.id).map((e) => ({ ...e, sourced: !!e.sourced })) };
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
  // A note from the SAC list names the staffing event it's about (process_step_id).
  let stepId = null;
  if (b.process_step_id && kind === 'note') {
    stepId = db.prepare('SELECT id FROM ticket_process_steps WHERE id = ? AND ticket_id = ?').get(Number(b.process_step_id) || 0, t.id)?.id;
    if (!stepId) return res.status(400).json({ error: 'That staffing event is no longer on this ticket' });
  }
  const id = db.prepare(`INSERT INTO ticket_comments (ticket_id, card_id, parent_id, kind, body, author_id, target_type, target_id, process_step_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(t.id, cardId, parentId, kind, body, req.user.id, target?.type ?? null, target?.id ?? null, stepId).lastInsertRowid;
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

// ---- Staffing events (once milestones): RFI responses, white papers, gate reviews, SOO, SOW, ROM and proposals, each with
// its due date, criticality, blocks of work (text or documents), reviews, notes and documents. Every open one is on the SAC list.

const fileOut = (f) => ({ id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type, created_at: f.created_at, field: f.process_field ?? null, url: f.url ?? null,
  uploaded_by: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null });
const processRow = (id) => db.prepare('SELECT * FROM ticket_process_steps WHERE id = ?').get(id);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

export function listProcess(ticketId) {
  staffFromTags(ticketId); // a process tag on the ticket stands for an open event
  ensureGateDraft(ticketId); // a Prospecting lead's Initial Gate Review form is always there to fill in
  const files = db.prepare(`SELECT f.*, u.first_name, u.last_name FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by
    WHERE f.ticket_id = ? AND f.process_step_id IS NOT NULL ORDER BY f.created_at, f.id`).all(ticketId);
  const rule = gateRule();
  return db.prepare(`SELECT p.*, a.first_name, a.last_name, e.first_name AS e_first_name, e.last_name AS e_last_name, r.first_name AS r_first_name, r.last_name AS r_last_name
    FROM ticket_process_steps p LEFT JOIN users a ON a.id = p.author_id LEFT JOIN users e ON e.id = p.updated_by LEFT JOIN users r ON r.id = p.sa_response_by
    WHERE p.ticket_id = ? ORDER BY COALESCE(p.step_date, substr(p.created_at, 1, 10)), p.created_at, p.id`).all(ticketId)
    .map((p) => ({
      id: p.id, step_type: p.step_type, step_date: p.step_date, notes: p.notes || '', sa_notes: p.sa_notes || '', sa_response: p.sa_response || '', reviews: cleanReviews(json.parse(p.reviews, {})),
      decision: p.decision || '', pricing: p.pricing || '', criticality: p.criticality || 'queued', fields: json.parse(p.fields, {}),
      // An Initial Gate Review's qualification checklist, and whether it passes (the ticket can move into Qualified and beyond).
      qualification: cleanQualification(json.parse(p.qualification, {})),
      ...gateOut(p, rule),
      done: !!p.completed_at, completed_at: p.completed_at ?? null,
      created_at: p.created_at, updated_at: p.updated_at,
      author: p.first_name ? { id: p.author_id, first_name: p.first_name, last_name: p.last_name } : null,
      updated_by: p.e_first_name ? { id: p.updated_by, first_name: p.e_first_name, last_name: p.e_last_name } : null,
      sa_response_by: p.r_first_name ? { id: p.sa_response_by, first_name: p.r_first_name, last_name: p.r_last_name } : null, // who ticked the response
      files: files.filter((f) => f.process_step_id === p.id).map(fileOut),
    }));
}

r.get('/:id/process', (req, res) => {
  if (!ticketRow(req.params.id)) return res.status(404).json({ error: 'Ticket not found' });
  res.json({ steps: listProcess(req.params.id), types: PROCESS_TYPES, gate_rule: gateRuleText(gateRule()) });
});

/** Body: { step_type, step_date? (the due date), criticality? }. Staffs the ticket: the event is made, the ticket tagged for it, and it joins the SAC list. */
r.post('/:id/process', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const type = String(req.body?.step_type || '');
  if (!PROCESS_TYPES.includes(type)) return res.status(400).json({ error: 'Choose a staffing event' });
  // An Initial Gate Review starts as a form to fill in: it reaches the SAC list, and tags the ticket, when it's submitted.
  const { id } = addStaffingEvent(req.user, t.id, type, { dueDate: isoDate(req.body?.step_date), criticality: req.body?.criticality, draft: !!milestoneOf(type).qualifies });
  res.json({ id, steps: listProcess(t.id), labels: json.parse(ticketRow(t.id).labels, []) });
});

// What only the ticket's owner (or an admin) sets on a staffing event: what it is, when it's due, how critical, and a gate's decision.
const OWNER_KEYS = ['step_type', 'step_date', 'criticality', 'decision'];

/**
 * Body may hold step_type, step_date (due date), criticality, decision (Proceed, Revise, No-Bid or none), reviews, notes,
 * sa_notes and sa_response (the Solution Architect Response: approve, deny, more_info or none), pricing, fields ({ key: text }),
 * qualification (an Initial Gate Review's checklist: { key: 'yes' | 'no' | 1-5 }), submit (sends a draft Initial Gate Review
 * to the SAC list), recall (takes a submitted one back off it, a draft again) and done. Anyone can write the work (fields, reviews, notes, the response, pricing) and mark it done, so
 * solution architects answer from the SAC list; the rest is the ticket owner's or an admin's. Marking it done takes its
 * process tag off the ticket (and the event off the SAC list); reopening it puts the tag back. `architects` (user ids) sets
 * who's staffed to it, the people under Solution Architect & Technical, leaving the rest of the reviews alone.
 */
r.put('/process/:pid', (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Staffing event not found' });
  const b = req.body || {};
  const t = ticketRow(p.ticket_id);
  const changes = (k) => b[k] !== undefined && String(b[k] ?? '') !== String((k === 'decision' ? p.decision : p[k]) ?? '');
  if (OWNER_KEYS.some(changes)) {
    const denied = ticketEditDenied(req.user, t);
    if (denied) return res.status(403).json({ error: denied });
  }
  if (b.step_type !== undefined && b.step_type !== p.step_type && !PROCESS_TYPES.includes(b.step_type)) return res.status(400).json({ error: 'Choose a staffing event' });
  if (b.decision !== undefined && b.decision && !DECISIONS.includes(b.decision)) return res.status(400).json({ error: 'Choose a decision' });
  if (b.sa_response !== undefined && b.sa_response && !SA_RESPONSES.some((x) => x.key === b.sa_response)) return res.status(400).json({ error: 'Choose approve, deny or need more info' });
  // The Initial Gate's decision is worked out from the answers; only a BD lead or an Exec Ldr sets it by hand ('' hands it back).
  const overriding = b.gate_override !== undefined && String(b.gate_override || '') !== String(p.gate_override || '');
  if (overriding) {
    if (b.gate_override && !GATE_OVERRIDES.includes(b.gate_override)) return res.status(400).json({ error: 'Choose approved or denied' });
    if (!mayOverrideGate(req.user)) return res.status(403).json({ error: 'Only a BD lead or an Exec Ldr can override the gate decision' });
  }
  if (b.criticality !== undefined && !isCriticality(b.criticality)) return res.status(400).json({ error: 'Choose how critical it is' });
  const type = b.step_type ?? p.step_type;
  if (Array.isArray(b.architects) && b.reviews === undefined) {
    const reviews = cleanReviews(json.parse(p.reviews, {}));
    b.reviews = { ...reviews, technical: { ...reviews.technical, people: b.architects } };
  }
  let done = b.done === undefined ? !!p.completed_at : !!b.done;
  // An Initial Gate Review is a draft until it's submitted (`submit`), which sends it to the SAC list for the architect's
  // approval, asked for afresh each time. Approved, it closes itself and leaves the list. Reopened, it's a draft again: it
  // has to be submitted again.
  const qualifies = !!milestoneOf(type).qualifies;
  let draft = qualifies && !!p.draft;
  let saResponse = b.sa_response !== undefined ? (b.sa_response || null) : p.sa_response;
  const override = overriding ? (b.gate_override || null) : p.gate_override;
  if (qualifies) {
    if (p.completed_at && !done) draft = true;
    if (b.submit && draft) { draft = false; done = false; saResponse = null; }
    if (done) draft = false;
    if (b.recall && !done) draft = true; // taken back from the SAC list to work on: a draft again
    // The Technical Fit is approved on a named architect's behalf: nobody approves it with no solution architect picked.
    // With the last architect taken off it, an approval made on their behalf goes too.
    const hadArchitects = cleanReviews(json.parse(p.reviews, {})).technical.people.length > 0;
    const hasArchitects = cleanReviews(b.reviews !== undefined ? b.reviews : json.parse(p.reviews, {})).technical.people.length > 0;
    if (saResponse === 'approve' && !hasArchitects) {
      if (p.sa_response !== 'approve') return res.status(400).json({ error: 'Pick the solution architect who approved the Technical Fit before approving it' });
      if (hadArchitects) saResponse = null;
    }
    const gate = gateDecision({ step_type: type, qualification: b.qualification !== undefined ? b.qualification : json.parse(p.qualification, {}), sa_response: saResponse, gate_override: override, draft }, gateRule());
    if (gate.status === 'approved' && (!draft || gate.overridden)) { done = true; draft = false; } // a hand-set approval closes it wherever it stands
  }
  db.prepare(`UPDATE ticket_process_steps SET step_type = ?, step_date = ?, reviews = ?, notes = ?, sa_notes = ?, sa_response = ?, sa_response_by = ?, decision = ?, pricing = ?, criticality = ?, fields = ?, qualification = ?, gate_override = ?, gate_override_by = ?, draft = ?,
      completed_at = ?, completed_by = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`).run(
    type,
    b.step_date !== undefined ? isoDate(b.step_date) : p.step_date,
    b.reviews !== undefined ? json.str(cleanReviews(b.reviews)) : p.reviews,
    typeof b.notes === 'string' ? b.notes.trim() : p.notes,
    typeof b.sa_notes === 'string' ? b.sa_notes.trim() : p.sa_notes,
    saResponse,
    (saResponse || null) === (p.sa_response || null) ? p.sa_response_by : saResponse ? req.user.id : null,
    b.decision !== undefined ? (b.decision || null) : p.decision,
    typeof b.pricing === 'string' ? b.pricing.trim() : p.pricing,
    b.criticality ?? p.criticality,
    b.fields !== undefined ? json.str(cleanFields(type, b.fields)) : p.fields,
    b.qualification !== undefined ? json.str(cleanQualification(b.qualification)) : p.qualification,
    override,
    overriding ? (b.gate_override ? req.user.id : null) : p.gate_override_by,
    draft ? 1 : 0,
    done ? (p.completed_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null,
    done ? (p.completed_at ? p.completed_by : req.user.id) : null,
    req.user.id, p.id,
  );
  if (type !== p.step_type || done !== !!p.completed_at || draft !== !!p.draft) [...new Set([p.step_type, type])].forEach((k) => settleTag(p.ticket_id, k));
  touch(p.ticket_id);
  recordTicketUpdate(req.user, t, `Staffing event: ${type}`);
  res.json({ steps: listProcess(p.ticket_id) });
});

/**
 * Removes a staffing event outright (the SAC list's Remove): its work, architects and place in every order go with it, and its
 * process tag comes off unless another open event of its type is there. Its documents and notes stay on the ticket.
 */
r.delete('/process/:pid', ownerOnly(ofStep), (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Staffing event not found' });
  db.prepare('DELETE FROM ticket_process_steps WHERE id = ?').run(p.id);
  db.prepare("DELETE FROM work_log WHERE kind = 'process' AND ref_id = ?").run(p.id);
  settleTag(p.ticket_id, p.step_type);
  touch(p.ticket_id);
  recordTicketUpdate(req.user, ticketRow(p.ticket_id), `Staffing event removed: ${p.step_type}`);
  res.json({ steps: listProcess(p.ticket_id) });
});

/** The block of work a document or link answers: one of the event's own, the Request (BD Notes), the Solution Architect Response or the qualification checklist. */
const stepField = (p, key) => (SHARED_FIELDS.includes(key) || milestoneOf(p.step_type).fields.some(([k]) => k === key) ? String(key) : null);

/** A document for a staffing event; with ?field=<key>, the answer to one of its blocks of work (or request, sa_response, qualification). Anyone can add one. */
r.post('/process/:pid/files', upload.single('file'), (req, res) => {
  const p = processRow(req.params.pid);
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  if (!p) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: 'Staffing event not found' });
  }
  const field = stepField(p, req.query.field);
  const id = db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by, process_step_id, process_field)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(p.ticket_id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id, p.id, field).lastInsertRowid;
  recordWork(req.user, { kind: 'file', ticket_id: p.ticket_id, ref_id: id, summary: req.file.originalname });
  touch(p.ticket_id);
  res.json({ steps: listProcess(p.ticket_id) });
});

/** Body: { url, name?, field? }. A link to a document kept elsewhere (Drive, SharePoint…), for a staffing event. Anyone can add one. */
r.post('/process/:pid/links', (req, res) => {
  const p = processRow(req.params.pid);
  if (!p) return res.status(404).json({ error: 'Staffing event not found' });
  let url;
  try { url = new URL(String(req.body?.url || '').trim()); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol)) return res.status(400).json({ error: 'Paste a link that starts with https://' });
  const name = String(req.body?.name || '').trim().slice(0, 200) || (url.hostname + (url.pathname.length > 1 ? url.pathname : '')).slice(0, 200);
  const id = db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, uploaded_by, process_step_id, process_field, url)
    VALUES (?, ?, '', ?, ?, ?, ?)`).run(p.ticket_id, name, req.user.id, p.id, stepField(p, req.body?.field), url.href).lastInsertRowid;
  recordWork(req.user, { kind: 'file', ticket_id: p.ticket_id, ref_id: id, summary: name });
  touch(p.ticket_id);
  res.json({ steps: listProcess(p.ticket_id) });
});

/** Takes a link or document off a staffing event (and the ticket). Whoever added it can, as can the ticket's owner or an admin. */
r.delete('/process/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ? AND process_step_id IS NOT NULL').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  const t = ticketRow(f.ticket_id);
  if (f.uploaded_by !== req.user.id) {
    const denied = ticketEditDenied(req.user, t);
    if (denied) return res.status(403).json({ error: denied });
  }
  dropFile(req.user, f);
  touch(f.ticket_id);
  res.json({ steps: listProcess(f.ticket_id) });
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
  db.prepare(`SELECT e.id, e.name, e.date_from, e.date_to, x.sourced FROM ticket_events x JOIN events e ON e.id = x.event_id WHERE x.ticket_id = ? AND e.id IS NOT ?`)
    .all(t.id, t.event_id ?? null).forEach(({ sourced, ...e }) => lead.push({ type: 'event', at: e.date_from || t.created_at, event: e, sourced: !!sourced }));
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
    text: strategyText(t.id), updated_at: t.strategy_updated_at ?? null, updated_by: nameOf(t.strategy_updated_by),
    assessment: json.parse(t.assessment, {}), assessment_updated_at: t.assessment_updated_at ?? null, assessment_updated_by: nameOf(t.assessment_updated_by),
    pwin: ticketPwin(t), model: pwinModel(),
  };

  // An Initial Gate Review joins the timeline once it's closed out: while it's being filled in or is with the SAC it isn't a milestone yet.
  const milestones = listProcess(t.id).filter((m) => m.done || !milestoneOf(m.step_type).qualifies);
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
  dropFile(req.user, f);
  res.json({ ok: true });
});

function dropFile(user, f) {
  const deal = db.prepare('SELECT pipedrive_id FROM tickets WHERE id = ?').get(f.ticket_id)?.pipedrive_id;
  db.prepare("DELETE FROM work_log WHERE kind = 'file' AND ref_id = ?").run(f.id);
  db.prepare('DELETE FROM ticket_files WHERE id = ?').run(f.id);
  recordTicketUpdate(user, ticketRow(f.ticket_id), 'Document removed');
  queueDelete('file', f.pipedrive_id, deal);
  queueDelete('note', f.pipedrive_note_id, deal); // a linked document went as a note with its link
  if (f.stored_name && !f.url) fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
}

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
  probability_synced: db.prepare('SELECT deal_probability FROM pipelines WHERE id = ?').get(t.pipeline_id ?? -1)?.deal_probability !== 0, // false: Pipedrive has deal probability off for this pipeline
  source_origin: t.source_origin ?? null, source_origin_id: t.source_origin_id ?? null, source_channel_id: t.source_channel_id ?? null,
  deal_status: t.deal_status || 'open', won_at: t.won_at ?? null, lost_at: t.lost_at ?? null, value: t.value ?? null, projected_win_date: t.projected_win_date ?? null,
  labels: json.parse(t.labels, []), custom_fields: json.parse(t.custom_fields, []), pipedrive_id: t.pipedrive_id ?? null,
  // For the Details box at the top of the ticket: the deal at a glance, its dates, and the contract it became.
  opportunity_title: t.opportunity_title, organization_name: t.organization ?? null, pipeline_status: t.pipeline_status ?? null,
  statuses: t.ticket_type === 'bid' ? statusesFor(t.pipeline_id) : [],
  bd_director_id: t.bd_director_id ?? null, bd_director_name: nameOf(t.bd_director_id), territory_id: t.territory_id ?? null,
  territory_name: t.territory_id ? db.prepare('SELECT name FROM territories WHERE id = ?').get(t.territory_id)?.name ?? null : null,
  win_date_undetermined: !!t.win_date_undetermined, created_at: t.created_at,
  last_activity_at: db.prepare(`SELECT MAX(COALESCE(t.updated_at, t.created_at), t.created_at,
      COALESCE((SELECT MAX(MAX(m.created_at, COALESCE(m.updated_at, ''))) FROM ticket_comments m WHERE m.ticket_id = t.id), ''),
      COALESCE((SELECT MAX(f.created_at) FROM ticket_files f WHERE f.ticket_id = t.id), '')) AS at FROM tickets t WHERE t.id = ?`).get(t.id)?.at ?? t.created_at,
  delivery: db.prepare('SELECT id, name FROM delivery_programs WHERE ticket_id = ?').get(t.id) || null,
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
    if (set.labels) queueFromTags(req.user, t.id, t.labels, set.labels);
    if (Array.isArray(b.followers)) {
      db.prepare('DELETE FROM ticket_followers WHERE ticket_id = ?').run(t.id);
      const add = db.prepare('INSERT OR IGNORE INTO ticket_followers (ticket_id, user_id) SELECT ?, id FROM users WHERE id = ?');
      b.followers.forEach((u) => add.run(t.id, Number(u)));
    }
  })();
  if (set.custom_fields) linkGoogleSolution(t.id, 'field');
  else if (set.labels) linkGoogleSolution(t.id, 'tag');
  touch(t.id);
  recordTicketUpdate(req.user, t, 'Details');
  res.json(detailsOf(ticketRow(t.id)));
});

/**
 * The Details box at the top of a pipeline ticket. Body: any of organization (a name), value, gov_lead (a name; blank for
 * none) and fields ({ <Pipedrive field key>: text }; blank clears). These are the deal's own fields, so on a Pipedrive
 * deal each change goes with the next send; the lead is the deal's contact person, and joins the CRM.
 */
r.put('/:id/summary', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  if (t.ticket_type !== 'bid') return res.status(400).json({ error: 'Only pipeline tickets have deal details' });
  const b = req.body || {};
  const set = {};
  if ('organization' in b) {
    set.organization = String(b.organization ?? '').trim() || null;
    set.organization_id = set.organization ? db.prepare('SELECT id FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(set.organization)?.id ?? null : null;
  }
  if ('value' in b) {
    const v = b.value === '' || b.value == null ? null : Number(String(b.value).replace(/[$,\s]/g, ''));
    if (v != null && !(Number.isFinite(v) && v >= 0)) return res.status(400).json({ error: 'Value is a dollar amount, 0 or more' });
    set.value = v;
  }
  if (b.fields) {
    const merged = mergeDealFields(json.parse(t.custom_fields, []), b.fields);
    if (merged.error) return res.status(400).json({ error: merged.error });
    set.custom_fields = json.str(merged.list);
  }
  db.transaction(() => {
    if (set.organization && !set.organization_id) set.organization_id = db.prepare('INSERT INTO organizations (name) VALUES (?)').run(set.organization).lastInsertRowid;
    Object.entries(set).forEach(([k, v]) => db.prepare(`UPDATE tickets SET ${k} = ? WHERE id = ?`).run(v, t.id));
    if ('gov_lead' in b) setGovLead(ticketRow(t.id), b.gov_lead, req.user.id);
  })();
  if (set.custom_fields) linkGoogleSolution(t.id, 'field');
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

/**
 * Body: { labels: [names] }. Sets a ticket's tags. On a ticket from Pipedrive the change waits for an admin to send it. A
 * process tag newly on the ticket queues its staffing event. Returns the tags and whether any event was queued.
 */
r.put('/:id/labels', ownerOnly(), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const labels = cleanLabels(req.body?.labels);
  db.prepare('UPDATE tickets SET labels = ?, labels_pending = ? WHERE id = ?').run(labels, t.pipedrive_id ? 1 : 0, t.id);
  queueFromTags(req.user, t.id, t.labels, labels); // a process tag queues its staffing event, and so the SAC list
  linkGoogleSolution(t.id, 'tag'); // the GOOGLE DEAL tag and the deal's Google Solution field say the same thing
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
