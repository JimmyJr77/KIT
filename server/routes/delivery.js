// Delivery: contracts we've won. Each program is copied from a won pipeline ticket (see the delivery_on_won triggers in
// db.js), then assigned a Program Manager and a delivery team. Funding received and revenue billed are recorded against it
// as entries, which make up its funded / unfunded backlog and the "bill" side of book-to-bill.
//
// A contract's Pipedrive project is its delivery record: the overview (description, dates, phase, status, owner,
// labels), the plan (tasks and activities), notes and documents all come from and go back to Pipedrive.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db, json } from '../db.js';
import { requireAdmin } from '../auth.js';
import { inBooks } from '../financials.js';
import { CONTRACT_DOC_TYPES, ADDITIONAL_DOCS } from '../../src/lib/process.js';
import { queueDelete, ACTIVITY_TYPES } from '../services/pipedrive.js';
import { createProject } from '../services/pipedriveSend.js';
import { PROJECT_STATUS_OF } from '../services/pipedriveProjects.js';
import { fieldsOf } from '../services/pipedriveFields.js';

const r = Router();
const STATUSES = ['Active', 'Complete', 'Canceled'];

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const person = (row, prefix) => (row[`${prefix}_first`] ? { id: row[`${prefix}_id`], first_name: row[`${prefix}_first`], last_name: row[`${prefix}_last`] } : null);

function programsOut(rows) {
  const team = db.prepare(`SELECT m.*, u.first_name, u.last_name, u.title FROM delivery_team m
    LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at, m.id`).all();
  const entries = db.prepare(`SELECT e.*, u.first_name, u.last_name FROM program_entries e
    LEFT JOIN users u ON u.id = e.created_by ORDER BY e.entry_date DESC, e.id DESC`).all();
  const files = db.prepare(`SELECT f.*, u.first_name, u.last_name FROM delivery_files f
    LEFT JOIN users u ON u.id = f.uploaded_by ORDER BY f.created_at, f.id`).all();
  const tasks = db.prepare(`SELECT k.*, u.first_name AS a_first, u.last_name AS a_last, u.id AS a_id FROM delivery_tasks k
    LEFT JOIN users u ON u.id = k.assignee_id ORDER BY k.done, k.due_date IS NULL, k.due_date, k.position, k.id`).all();
  const notes = db.prepare(`SELECT n.*, u.first_name AS au_first, u.last_name AS au_last, u.id AS au_id FROM delivery_notes n
    LEFT JOIN users u ON u.id = n.author_id ORDER BY n.pinned DESC, n.created_at DESC, n.id DESC`).all();
  const installments = db.prepare('SELECT * FROM ticket_installments ORDER BY billing_date, id').all();
  const products = db.prepare('SELECT * FROM ticket_products ORDER BY position, id').all();
  const phases = db.prepare('SELECT id, name FROM delivery_phases').all();
  return rows.map((p) => ({
    id: p.id, ticket_id: p.ticket_id, ticket_exists: !!p.ticket_title, name: p.name, organization: p.organization,
    account_type: p.account_type, value: p.value, awarded_at: p.awarded_at, status: p.status, notes: p.notes, updated_at: p.updated_at, completed_at: p.completed_at,
    held_at: p.held_at, ticket_stage: p.ticket_stage, deal_status: p.deal_status, pipedrive_deal_id: p.pipedrive_deal_id,
    bd_director: p.dir_first ? { id: p.bd_director_id, first_name: p.dir_first, last_name: p.dir_last } : null, territory_name: p.territory_name,
    // The Pipedrive project: its status as Pipedrive has it, phase, dates, owner and labels.
    project: {
      pipedrive_id: p.pipedrive_project_id, status: p.project_status, phase_id: p.phase_id, phase: phases.find((x) => x.id === p.phase_id)?.name || null,
      start_date: p.start_date, end_date: p.end_date, labels: json.parse(p.labels, []), health_status: p.health_status, archived_at: p.project_archived_at,
      owner: p.own_first ? { id: p.owner_id, first_name: p.own_first, last_name: p.own_last } : null, pending: !!p.pipedrive_pending,
    },
    ...money(p, entries.filter((e) => e.program_id === p.id)),
    installments: installments.filter((i) => i.ticket_id === p.ticket_id).map((i) => ({ id: i.id, description: i.description, amount: i.amount, billing_date: i.billing_date, synced: !!i.pipedrive_id })),
    products: products.filter((x) => x.ticket_id === p.ticket_id).map((x) => ({ id: x.id, name: x.name, quantity: x.quantity, item_price: x.item_price, discount: x.discount, sum: x.sum, billing_frequency: x.billing_frequency })),
    program_manager: p.pm_first ? { id: p.program_manager_id, first_name: p.pm_first, last_name: p.pm_last } : null,
    contracting_officer: p.contracting_officer, cor: p.cor, gov_tech_lead: p.gov_tech_lead,
    technical_lead: p.tl_first ? { id: p.technical_lead_id, first_name: p.tl_first, last_name: p.tl_last } : null,
    team: team.filter((m) => m.program_id === p.id).map((m) => ({
      id: m.id, role: m.role,
      user: m.user_id && m.first_name ? { id: m.user_id, first_name: m.first_name, last_name: m.last_name, title: m.title } : null,
      name: m.user_id && m.first_name ? `${m.first_name} ${m.last_name}` : m.name,
    })),
    files: files.filter((f) => f.program_id === p.id).map((f) => ({
      id: f.id, doc_type: f.doc_type, name: f.original_name, size: f.size, created_at: f.created_at, synced: !!f.pipedrive_id, url: f.url ?? null,
      uploaded_by: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null,
    })),
    tasks: tasks.filter((k) => k.program_id === p.id).map((k) => ({
      id: k.id, parent_id: k.parent_id, kind: k.kind, title: k.title, description: k.description, activity_type: k.activity_type, due_date: k.due_date, due_time: k.due_time,
      done: !!k.done, done_at: k.done_at, assignee: person(k, 'a'), synced: !!k.pipedrive_id, pending: !!k.pipedrive_pending, created_at: k.created_at,
    })),
    project_notes: notes.filter((n) => n.program_id === p.id).map((n) => ({
      id: n.id, body: n.body, pinned: !!n.pinned, created_at: n.created_at, updated_at: n.updated_at, author: person(n, 'au'), synced: !!n.pipedrive_id,
    })),
  }));
}
/** A program's funding and billing entries, with totals: funded, unfunded (value not yet funded) and billed. */
function money(p, entries) {
  const sum = (kind) => entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0);
  const funded = sum('funding');
  return {
    funded, unfunded: p.value != null ? Math.max(p.value - funded, 0) : null, billed: sum('billing'),
    entries: entries.map((e) => ({
      id: e.id, kind: e.kind, amount: e.amount, entry_date: e.entry_date, note: e.note, created_at: e.created_at,
      created_by: e.first_name ? { id: e.created_by, first_name: e.first_name, last_name: e.last_name } : null,
    })),
  };
}
// The BD director and territory come from the pipeline ticket the contract was won from.
const SELECT = `SELECT p.*, u.first_name AS pm_first, u.last_name AS pm_last, l.first_name AS tl_first, l.last_name AS tl_last, ow.first_name AS own_first, ow.last_name AS own_last,
    t.opportunity_title AS ticket_title, t.pipeline_status AS ticket_stage, t.deal_status, t.pipedrive_id AS pipedrive_deal_id,
    t.bd_director_id, d.first_name AS dir_first, d.last_name AS dir_last, tr.name AS territory_name
  FROM delivery_programs p LEFT JOIN users u ON u.id = p.program_manager_id LEFT JOIN users l ON l.id = p.technical_lead_id LEFT JOIN users ow ON ow.id = p.owner_id
  LEFT JOIN tickets t ON t.id = p.ticket_id LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id`;
// A contract is listed while its pipeline ticket is in the books: archiving the ticket takes the contract with it until the ticket is restored.
const LIVE = `t.id IS NOT NULL AND ${inBooks()}`;
const one = (id) => programsOut(db.prepare(`${SELECT} WHERE p.id = ?`).all(id))[0] || null;
const programRow = (id) => db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(id);
const touch = (id) => db.prepare("UPDATE delivery_programs SET updated_at = datetime('now') WHERE id = ?").run(id);
/** A change to a field the Pipedrive project holds waits to be sent (when the contract has a project). */
const markPending = (id) => db.prepare('UPDATE delivery_programs SET pipedrive_pending = (pipedrive_project_id IS NOT NULL) WHERE id = ?').run(id);

/** Tell someone they've been put on a won contract: as its Program Manager or Technical Lead, or on its delivery team (with their role). */
function alertAssigned(userId, actor, programId, kind, role) {
  db.prepare('INSERT INTO alerts (user_id, actor_id, kind, program_id, excerpt) VALUES (?, ?, ?, ?, ?)').run(userId, actor.id, kind, programId, role || null);
}

/** status: active (default) | complete | canceled | held | all. Newest wins first. Held contracts are only in held and all. */
r.get('/', (req, res) => {
  const status = { active: 'Active', complete: 'Complete', canceled: 'Canceled' }[req.query.status];
  const held = req.query.status === 'held';
  const rows = db.prepare(`${SELECT} WHERE ${LIVE} ${held ? 'AND p.held_at IS NOT NULL' : ''} ${status ? 'AND p.held_at IS NULL AND p.status = ?' : ''}
    ORDER BY p.awarded_at DESC, p.id DESC`).all(...(status ? [status] : []));
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM delivery_programs p LEFT JOIN tickets t ON t.id = p.ticket_id WHERE ${LIVE} AND p.held_at IS NOT NULL`).get();
  res.json({ programs: programsOut(rows), held: n, phases: db.prepare('SELECT id, name, position FROM delivery_phases ORDER BY position, id').all(),
    project_labels: (fieldsOf('project').find((f) => f.key === 'labels' || f.name === 'Labels')?.options || []).map((o) => o.label), activity_types: Object.values(ACTIVITY_TYPES) });
});

/** A contract whose funding received covers its value. */
const fullyFunded = (t) => !!t.program_id && t.contract_value > 0 && t.funded >= t.contract_value;
/**
 * Which Closed deals group a pipeline ticket is in, or null if it's still open (a held contract's ticket stays open until
 * it's decided). Other is for deals that left the pipeline with no outcome: archived here while open, or archived or deleted
 * in Pipedrive (which takes a won deal out of Delivery too). A won deal can't be archived here: it's reopened first.
 */
function closedGroup(t) {
  if (t.deal_status === 'lost') return 'lost';
  if (t.archived_at) return 'other';
  if (t.deal_status === 'won') return t.program_id && !t.held_at && (t.program_status !== 'Active' || fullyFunded(t)) ? 'executed' : 'execution';
  return null;
}
const removedHow = (t) => (t.pipedrive_deleted_at ? 'Deleted in Pipedrive' : t.pipedrive_archived_at ? 'Archived in Pipedrive' : 'Archived here');

/**
 * Every closed pipeline deal: lost, in execution (won and in delivery), executed (the contract is Complete or canceled, or
 * fully funded), or other (left the pipeline with no outcome). A won deal that Pipedrive archived or deleted after funding
 * was recorded on its contract is flagged as a discrepancy: it may be gone, or it may just have been tidied away once funded.
 */
r.get('/closed', (req, res) => {
  const rows = db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.value, t.pipeline_status, t.deal_status, t.lost_reason, t.done_at, t.archived_at, t.won_at, t.lost_at,
      t.pipedrive_archived_at, t.pipedrive_deleted_at, t.bd_director_id, d.first_name AS director_first_name, d.last_name AS director_last_name, tr.name AS territory_name,
      p.id AS program_id, p.status AS program_status, p.project_status, p.held_at, p.value AS contract_value, p.awarded_at, COALESCE(p.completed_at, p.updated_at) AS completed_at,
      (SELECT COALESCE(SUM(e.amount), 0) FROM program_entries e WHERE e.program_id = p.id AND e.kind = 'funding') AS funded
    FROM tickets t LEFT JOIN delivery_programs p ON p.ticket_id = t.id
    LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.ticket_type = 'bid' AND t.archive_set_id IS NULL`).all();
  const closedOn = { lost: (t) => t.lost_at || t.done_at, execution: (t) => t.won_at || t.awarded_at || t.done_at, executed: (t) => t.completed_at, other: (t) => t.archived_at };
  res.json({
    deals: rows.flatMap((t) => {
      const group = closedGroup(t);
      if (!group) return [];
      const other = group === 'other';
      return [{
        ...t, group, closed_on: closedOn[group](t), amount: t.contract_value ?? t.value, fully_funded: fullyFunded(t),
        removed_how: other ? removedHow(t) : null,
        discrepancy: other && t.deal_status === 'won' && t.funded > 0 && !!(t.pipedrive_archived_at || t.pipedrive_deleted_at),
      }];
    }),
  });
});

/** A held contract is a real one after all: back in the numbers, even though its pipeline ticket isn't won. */
r.post('/:id/keep', requireAdmin, (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  if (!p.held_at) return res.status(400).json({ error: 'This contract isn’t on hold' });
  db.prepare("UPDATE delivery_programs SET held_at = NULL, kept_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(p.id);
  res.json({ program: one(p.id) });
});

/** A held contract was never real: gone for good, with its team, funding, billing and documents. Its pipeline ticket stays. */
r.delete('/:id', requireAdmin, (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  if (!p.held_at) return res.status(400).json({ error: 'Only a contract on hold can be deleted' });
  const files = db.prepare('SELECT stored_name, url FROM delivery_files WHERE program_id = ?').all(p.id);
  db.prepare('DELETE FROM delivery_programs WHERE id = ?').run(p.id);
  files.forEach((f) => { if (f.stored_name && !f.url) fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }); });
  res.json({ ok: true });
});

/**
 * Body may hold: program_manager_id and technical_lead_id (null to clear), status (Active | Complete | Canceled), notes (the
 * project overview), value (the contract value; null to clear), start_date, end_date, phase_id, labels [names], owner_id,
 * and the government's people by name: contracting_officer, cor, gov_tech_lead.
 * Status, overview, dates, phase, labels and owner are the Pipedrive project's and are synced.
 */
r.put('/:id', (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  const next = { ...p };
  for (const field of ['program_manager_id', 'technical_lead_id', 'owner_id']) {
    if (!(field in b)) continue;
    const id = Number(b[field]) || null;
    if (id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) return res.status(400).json({ error: 'Unknown person' });
    next[field] = id;
  }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status must be Active, Complete or Canceled' });
    next.status = b.status;
    next.project_status = PROJECT_STATUS_OF[b.status];
  }
  if ('notes' in b) next.notes = String(b.notes || '').trim() || null;
  for (const field of ['contracting_officer', 'cor', 'gov_tech_lead']) if (field in b) next[field] = String(b[field] || '').trim().slice(0, 200) || null;
  if ('value' in b) {
    next.value = b.value === '' || b.value == null ? null : Number(b.value);
    if (next.value != null && !(next.value >= 0)) return res.status(400).json({ error: 'Contract value must be a positive number' });
  }
  for (const field of ['start_date', 'end_date']) {
    if (!(field in b)) continue;
    next[field] = b[field] || null;
    if (next[field] && !/^\d{4}-\d{2}-\d{2}$/.test(next[field])) return res.status(400).json({ error: `${field === 'start_date' ? 'Start' : 'End'} date must be a date` });
  }
  if ('phase_id' in b) {
    next.phase_id = Number(b.phase_id) || null;
    if (next.phase_id && !db.prepare('SELECT 1 FROM delivery_phases WHERE id = ?').get(next.phase_id)) return res.status(400).json({ error: 'Unknown phase' });
  }
  if ('labels' in b) next.labels = json.str([...new Set((Array.isArray(b.labels) ? b.labels : []).map((x) => String(x).trim()).filter(Boolean))]);
  db.prepare(`UPDATE delivery_programs SET program_manager_id = ?, technical_lead_id = ?, owner_id = ?, status = ?, project_status = COALESCE(?, project_status), notes = ?, value = ?,
    start_date = ?, end_date = ?, phase_id = ?, labels = ?, contracting_officer = ?, cor = ?, gov_tech_lead = ?, updated_at = datetime('now'),
    completed_at = CASE WHEN ? = 'Active' THEN NULL WHEN status = 'Active' THEN datetime('now') ELSE completed_at END WHERE id = ?`)
    .run(next.program_manager_id, next.technical_lead_id, next.owner_id, next.status, next.project_status ?? null, next.notes, next.value,
      next.start_date, next.end_date, next.phase_id, next.labels, next.contracting_officer, next.cor, next.gov_tech_lead, next.status, p.id);
  if (['status', 'notes', 'start_date', 'end_date', 'phase_id', 'labels', 'owner_id'].some((k) => k in b)) markPending(p.id);
  if (next.program_manager_id && next.program_manager_id !== p.program_manager_id) alertAssigned(next.program_manager_id, req.user, p.id, 'delivery_pm');
  if (next.technical_lead_id && next.technical_lead_id !== p.technical_lead_id) alertAssigned(next.technical_lead_id, req.user, p.id, 'delivery_tl');
  res.json({ program: one(p.id) });
});

/** Make a Pipedrive project for this contract (linked to its won deal), so the plan, notes and documents sync. */
r.post('/:id/project', async (req, res) => {
  if (!programRow(req.params.id)) return res.status(404).json({ error: 'Program not found' });
  try {
    const id = await createProject(Number(req.params.id));
    res.json({ program: one(req.params.id), project_id: id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Add someone to the delivery team. Body: { user_id } for a KIT user, or { name } for someone outside KIT; plus an optional role. */
r.post('/:id/team', (req, res) => {
  if (!programRow(req.params.id)) return res.status(404).json({ error: 'Program not found' });
  const userId = Number(req.body?.user_id) || null;
  const name = String(req.body?.name || '').trim() || null;
  const role = String(req.body?.role || '').trim() || null;
  if (!userId && !name) return res.status(400).json({ error: 'Choose a person or type a name' });
  if (userId && db.prepare('SELECT 1 FROM delivery_team WHERE program_id = ? AND user_id = ?').get(req.params.id, userId)) {
    return res.status(400).json({ error: 'They’re already on the delivery team' });
  }
  db.prepare('INSERT INTO delivery_team (program_id, user_id, name, role) VALUES (?, ?, ?, ?)').run(req.params.id, userId, userId ? null : name, role);
  // People outside KIT have no account to alert.
  if (userId) alertAssigned(userId, req.user, Number(req.params.id), 'delivery_team', role);
  touch(req.params.id);
  res.json({ program: one(req.params.id) });
});

r.delete('/team/:memberId', (req, res) => {
  const m = db.prepare('SELECT * FROM delivery_team WHERE id = ?').get(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM delivery_team WHERE id = ?').run(m.id);
  res.json({ program: one(m.program_id) });
});

// ---- The plan: tasks (with subtasks) and activities on the contract's Pipedrive project

/** Body: { title, kind? ('task' | 'activity'), description?, due_date?, due_time?, assignee_id?, parent_id?, activity_type? }. */
r.post('/:id/tasks', (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  const title = String(b.title || '').trim();
  if (!title) return res.status(400).json({ error: 'Give the task a title' });
  const kind = b.kind === 'activity' ? 'activity' : 'task';
  const parent = Number(b.parent_id) || null;
  if (parent) {
    const pt = db.prepare("SELECT * FROM delivery_tasks WHERE id = ? AND program_id = ? AND kind = 'task'").get(parent, p.id);
    if (!pt) return res.status(400).json({ error: 'That parent task isn’t on this contract' });
    if (pt.parent_id) return res.status(400).json({ error: 'A subtask can’t have subtasks of its own' });
  }
  const due = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
  const time = /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : null;
  const assignee = Number(b.assignee_id) || null;
  const type = kind === 'activity' ? (Object.values(ACTIVITY_TYPES).includes(b.activity_type) ? b.activity_type : 'Task') : null;
  db.prepare(`INSERT INTO delivery_tasks (program_id, parent_id, kind, title, description, activity_type, due_date, due_time, assignee_id, position, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM delivery_tasks WHERE program_id = ?), ?)`)
    .run(p.id, kind === 'task' ? parent : null, kind, title, String(b.description || '').trim() || null, type, due, kind === 'activity' ? time : null, assignee, p.id, req.user.id);
  touch(p.id);
  res.json({ program: one(p.id) });
});

/** Body may hold title, description, done, due_date, due_time, assignee_id, activity_type. A change to a synced task waits to be sent. */
r.put('/tasks/:tid', (req, res) => {
  const k = db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(req.params.tid);
  if (!k) return res.status(404).json({ error: 'Task not found' });
  const b = req.body || {};
  const next = { ...k };
  if ('title' in b) { next.title = String(b.title || '').trim(); if (!next.title) return res.status(400).json({ error: 'A task needs a title' }); }
  if ('description' in b) next.description = String(b.description || '').trim() || null;
  if ('done' in b) next.done = b.done ? 1 : 0;
  if ('due_date' in b) next.due_date = /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null;
  if ('due_time' in b) next.due_time = /^\d{2}:\d{2}$/.test(b.due_time || '') ? b.due_time : null;
  if ('assignee_id' in b) next.assignee_id = Number(b.assignee_id) || null;
  if ('activity_type' in b && k.kind === 'activity') next.activity_type = Object.values(ACTIVITY_TYPES).includes(b.activity_type) ? b.activity_type : k.activity_type;
  db.prepare(`UPDATE delivery_tasks SET title = ?, description = ?, done = ?, done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) END, due_date = ?, due_time = ?,
    assignee_id = ?, activity_type = ?, pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?`)
    .run(next.title, next.description, next.done, next.done, next.due_date, next.due_time, next.assignee_id, next.activity_type, k.id);
  touch(k.program_id);
  res.json({ program: one(k.program_id) });
});

r.delete('/tasks/:tid', (req, res) => {
  const k = db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(req.params.tid);
  if (!k) return res.status(404).json({ error: 'Task not found' });
  const projectId = programRow(k.program_id)?.pipedrive_project_id;
  db.transaction(() => {
    // Subtasks go with their task, in Pipedrive too.
    db.prepare('SELECT pipedrive_id, kind FROM delivery_tasks WHERE parent_id = ?').all(k.id).forEach((s) => queueDelete(s.kind === 'activity' ? 'activity' : 'task', s.pipedrive_id, null, projectId));
    db.prepare('DELETE FROM delivery_tasks WHERE id = ?').run(k.id);
    queueDelete(k.kind === 'activity' ? 'activity' : 'task', k.pipedrive_id, null, projectId);
  })();
  touch(k.program_id);
  res.json({ program: one(k.program_id) });
});

// ---- Project notes

r.post('/:id/notes', (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write the note first' });
  db.prepare('INSERT INTO delivery_notes (program_id, body, author_id) VALUES (?, ?, ?)').run(p.id, body, req.user.id);
  touch(p.id);
  res.json({ program: one(p.id) });
});

/** Body: { body?, pinned? }. Only the author (or an admin) edits the text; anyone can pin. */
r.put('/notes/:nid', (req, res) => {
  const n = db.prepare('SELECT * FROM delivery_notes WHERE id = ?').get(req.params.nid);
  if (!n) return res.status(404).json({ error: 'Note not found' });
  const b = req.body || {};
  if ('body' in b) {
    if (n.author_id && n.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can edit this note' });
    const body = String(b.body || '').trim();
    if (!body) return res.status(400).json({ error: 'A note can’t be empty' });
    db.prepare("UPDATE delivery_notes SET body = ?, updated_at = datetime('now'), pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?").run(body, n.id);
  }
  if ('pinned' in b) db.prepare('UPDATE delivery_notes SET pinned = ?, pipedrive_pending = (pipedrive_id IS NOT NULL) WHERE id = ?').run(b.pinned ? 1 : 0, n.id);
  touch(n.program_id);
  res.json({ program: one(n.program_id) });
});

r.delete('/notes/:nid', (req, res) => {
  const n = db.prepare('SELECT * FROM delivery_notes WHERE id = ?').get(req.params.nid);
  if (!n) return res.status(404).json({ error: 'Note not found' });
  if (n.author_id && n.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this note' });
  db.prepare('DELETE FROM delivery_notes WHERE id = ?').run(n.id);
  queueDelete('project_note', n.pipedrive_id, null, programRow(n.program_id)?.pipedrive_project_id);
  touch(n.program_id);
  res.json({ program: one(n.program_id) });
});

// ---- Documents

/** Add a document. Form fields: file, doc_type (one of CONTRACT_DOC_TYPES, or Additional). It goes to the Pipedrive project too. */
r.post('/:id/files', upload.single('file'), (req, res) => {
  const refuse = (status, error) => {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    res.status(status).json({ error });
  };
  if (!req.file) return refuse(400, 'Choose a file to upload');
  if (!programRow(req.params.id)) return refuse(404, 'Program not found');
  const type = req.body?.doc_type;
  if (type !== ADDITIONAL_DOCS && !CONTRACT_DOC_TYPES.includes(type)) return refuse(400, 'Choose a document type');
  db.prepare('INSERT INTO delivery_files (program_id, doc_type, original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, type, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id);
  touch(req.params.id);
  res.json({ program: one(req.params.id) });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM delivery_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.url) return res.redirect(f.url);
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});

/** Deleted here and, when it came from or went to the Pipedrive project, there too. */
r.delete('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM delivery_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.uploaded_by && f.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the person who added this file can delete it' });
  db.prepare('DELETE FROM delivery_files WHERE id = ?').run(f.id);
  queueDelete('project_file', f.pipedrive_id, null, programRow(f.program_id)?.pipedrive_project_id);
  if (f.stored_name && !f.url) fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
  touch(f.program_id);
  res.json({ program: one(f.program_id) });
});

/**
 * Record funding received or revenue billed. Body: { kind: 'funding' | 'billing', amount, entry_date, note? }.
 * Funding is the deal's payment schedule: it goes on the pipeline ticket as an installment (sent to Pipedrive on the next
 * send), and the funding entry follows from that (see the funding_from_installment triggers in db.js).
 */
r.post('/:id/entries', (req, res) => {
  const p = programRow(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  if (!['funding', 'billing'].includes(b.kind)) return res.status(400).json({ error: 'Choose funding or billing' });
  const amount = Number(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount above zero' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.entry_date || '')) return res.status(400).json({ error: 'Enter a date' });
  const note = String(b.note || '').trim() || null;
  db.transaction(() => {
    if (b.kind === 'funding' && p.ticket_id) {
      const id = db.prepare('INSERT INTO ticket_installments (ticket_id, description, amount, billing_date) VALUES (?, ?, ?, ?)').run(p.ticket_id, note, amount, b.entry_date).lastInsertRowid;
      db.prepare('UPDATE program_entries SET created_by = ? WHERE installment_id = ?').run(req.user.id, id);
    } else {
      db.prepare('INSERT INTO program_entries (program_id, kind, amount, entry_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, b.kind, amount, b.entry_date, note, req.user.id);
    }
    touch(p.id);
  })();
  res.json({ program: one(p.id) });
});

/** Removes an entry. A funding entry's installment goes with it, here and (on the next send) in Pipedrive. */
r.delete('/entries/:entryId', (req, res) => {
  const e = db.prepare('SELECT * FROM program_entries WHERE id = ?').get(req.params.entryId);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    const i = e.installment_id && db.prepare('SELECT * FROM ticket_installments WHERE id = ?').get(e.installment_id);
    if (i) {
      db.prepare('DELETE FROM ticket_installments WHERE id = ?').run(i.id); // its entry goes with it
      queueDelete('installment', i.pipedrive_id, db.prepare('SELECT pipedrive_id FROM tickets WHERE id = ?').get(i.ticket_id)?.pipedrive_id);
    }
    db.prepare('DELETE FROM program_entries WHERE id = ?').run(e.id);
  })();
  res.json({ program: one(e.program_id) });
});

export default r;
