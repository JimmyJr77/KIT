// Delivery: contracts we've won. Each program is copied from an Awarded pipeline ticket (see the delivery_on_award
// triggers in db.js), then assigned a Program Manager and a delivery team. Funding received and revenue billed are
// recorded against it as entries, which make up its funded / unfunded backlog and the "bill" side of book-to-bill.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { inBooks } from '../financials.js';
import { CONTRACT_DOC_TYPES, ADDITIONAL_DOCS } from '../../src/lib/process.js';

const r = Router();
const STATUSES = ['Active', 'Complete'];

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function programsOut(rows) {
  const team = db.prepare(`SELECT m.*, u.first_name, u.last_name, u.title FROM delivery_team m
    LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at, m.id`).all();
  const entries = db.prepare(`SELECT e.*, u.first_name, u.last_name FROM program_entries e
    LEFT JOIN users u ON u.id = e.created_by ORDER BY e.entry_date DESC, e.id DESC`).all();
  const files = db.prepare(`SELECT f.*, u.first_name, u.last_name FROM delivery_files f
    LEFT JOIN users u ON u.id = f.uploaded_by ORDER BY f.created_at, f.id`).all();
  return rows.map((p) => ({
    id: p.id, ticket_id: p.ticket_id, ticket_exists: !!p.ticket_title, name: p.name, organization: p.organization,
    account_type: p.account_type, value: p.value, awarded_at: p.awarded_at, status: p.status, notes: p.notes, updated_at: p.updated_at,
    held_at: p.held_at, ticket_stage: p.ticket_stage,
    bd_director: p.dir_first ? { id: p.bd_director_id, first_name: p.dir_first, last_name: p.dir_last } : null, territory_name: p.territory_name,
    ...money(p, entries.filter((e) => e.program_id === p.id)),
    program_manager: p.pm_first ? { id: p.program_manager_id, first_name: p.pm_first, last_name: p.pm_last } : null,
    technical_lead: p.tl_first ? { id: p.technical_lead_id, first_name: p.tl_first, last_name: p.tl_last } : null,
    team: team.filter((m) => m.program_id === p.id).map((m) => ({
      id: m.id, role: m.role,
      user: m.user_id && m.first_name ? { id: m.user_id, first_name: m.first_name, last_name: m.last_name, title: m.title } : null,
      name: m.user_id && m.first_name ? `${m.first_name} ${m.last_name}` : m.name,
    })),
    files: files.filter((f) => f.program_id === p.id).map((f) => ({
      id: f.id, doc_type: f.doc_type, name: f.original_name, size: f.size, created_at: f.created_at,
      uploaded_by: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null,
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
const SELECT = `SELECT p.*, u.first_name AS pm_first, u.last_name AS pm_last, l.first_name AS tl_first, l.last_name AS tl_last, t.opportunity_title AS ticket_title, t.pipeline_status AS ticket_stage,
    t.bd_director_id, d.first_name AS dir_first, d.last_name AS dir_last, tr.name AS territory_name
  FROM delivery_programs p LEFT JOIN users u ON u.id = p.program_manager_id LEFT JOIN users l ON l.id = p.technical_lead_id LEFT JOIN tickets t ON t.id = p.ticket_id
  LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id`;
// A contract is listed while its pipeline ticket is in the books: archiving the ticket takes the contract with it until the ticket is restored.
const LIVE = `t.id IS NOT NULL AND ${inBooks()}`;
const one = (id) => programsOut(db.prepare(`${SELECT} WHERE p.id = ?`).all(id))[0] || null;

/** Tell someone they've been put on a won contract: as its Program Manager or Technical Lead, or on its delivery team (with their role). */
function alertAssigned(userId, actor, programId, kind, role) {
  db.prepare('INSERT INTO alerts (user_id, actor_id, kind, program_id, excerpt) VALUES (?, ?, ?, ?, ?)').run(userId, actor.id, kind, programId, role || null);
}

/** status: active (default) | complete | held | all. Newest wins first. Held contracts are only in held and all. */
r.get('/', (req, res) => {
  const status = { active: 'Active', complete: 'Complete' }[req.query.status];
  const held = req.query.status === 'held';
  const rows = db.prepare(`${SELECT} WHERE ${LIVE} ${held ? 'AND p.held_at IS NOT NULL' : ''} ${status ? 'AND p.held_at IS NULL AND p.status = ?' : ''}
    ORDER BY p.awarded_at DESC, p.id DESC`).all(...(status ? [status] : []));
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM delivery_programs p LEFT JOIN tickets t ON t.id = p.ticket_id WHERE ${LIVE} AND p.held_at IS NOT NULL`).get();
  res.json({ programs: programsOut(rows), held: n });
});

/** Which Closed deals group a pipeline ticket is in, or null if it's still open (a held contract's ticket stays open until it's decided). */
function closedGroup(t) {
  if (t.pipeline_status === 'Lost') return 'lost';
  if (t.archived_at) return 'other'; // taken off the board by hand, which also takes any contract out of Delivery
  if (t.program_id && !t.held_at) return t.program_status === 'Complete' ? 'executed' : 'execution';
  return t.pipeline_status === 'Awarded' ? 'execution' : null;
}

/** Every closed pipeline deal: lost, in execution (awarded and in delivery), executed (delivery finished), or other (archived from the board). */
r.get('/closed', (req, res) => {
  const rows = db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.value, t.pipeline_status, t.lost_reason, t.done_at, t.archived_at,
      t.bd_director_id, d.first_name AS director_first_name, d.last_name AS director_last_name, tr.name AS territory_name,
      p.id AS program_id, p.status AS program_status, p.held_at, p.value AS contract_value, p.awarded_at, COALESCE(p.completed_at, p.updated_at) AS completed_at
    FROM tickets t LEFT JOIN delivery_programs p ON p.ticket_id = t.id
    LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id
    WHERE t.ticket_type = 'bid' AND t.archive_set_id IS NULL`).all();
  const closedOn = { lost: (t) => t.done_at, execution: (t) => t.awarded_at || t.done_at, executed: (t) => t.completed_at, other: (t) => t.archived_at };
  res.json({
    deals: rows.flatMap((t) => {
      const group = closedGroup(t);
      return group ? [{ ...t, group, closed_on: closedOn[group](t), amount: t.contract_value ?? t.value }] : [];
    }),
  });
});

/** A held contract is a real one after all: back in the numbers, even though its pipeline ticket isn't Awarded. */
r.post('/:id/keep', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  if (!p.held_at) return res.status(400).json({ error: 'This contract isn’t on hold' });
  db.prepare("UPDATE delivery_programs SET held_at = NULL, kept_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(p.id);
  res.json({ program: one(p.id) });
});

/** A held contract was never real: gone for good, with its team, funding, billing and documents. Its pipeline ticket stays. */
r.delete('/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  if (!p.held_at) return res.status(400).json({ error: 'Only a contract on hold can be deleted' });
  const files = db.prepare('SELECT stored_name FROM delivery_files WHERE program_id = ?').all(p.id);
  db.prepare('DELETE FROM delivery_programs WHERE id = ?').run(p.id);
  files.forEach((f) => fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }));
  res.json({ ok: true });
});

/** Body may hold: program_manager_id and technical_lead_id (null to clear), status, notes, value (the contract value; null to clear). */
r.put('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  const next = { ...p };
  for (const field of ['program_manager_id', 'technical_lead_id']) {
    if (!(field in b)) continue;
    const id = Number(b[field]) || null;
    if (id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) return res.status(400).json({ error: 'Unknown person' });
    next[field] = id;
  }
  if ('status' in b) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status must be Active or Complete' });
    next.status = b.status;
  }
  if ('notes' in b) next.notes = String(b.notes || '').trim() || null;
  if ('value' in b) {
    next.value = b.value === '' || b.value == null ? null : Number(b.value);
    if (next.value != null && !(next.value >= 0)) return res.status(400).json({ error: 'Contract value must be a positive number' });
  }
  db.prepare(`UPDATE delivery_programs SET program_manager_id = ?, technical_lead_id = ?, status = ?, notes = ?, value = ?, updated_at = datetime('now'),
    completed_at = CASE WHEN ? = 'Active' THEN NULL WHEN status = 'Active' THEN datetime('now') ELSE completed_at END WHERE id = ?`)
    .run(next.program_manager_id, next.technical_lead_id, next.status, next.notes, next.value, next.status, p.id);
  if (next.program_manager_id && next.program_manager_id !== p.program_manager_id) alertAssigned(next.program_manager_id, req.user, p.id, 'delivery_pm');
  if (next.technical_lead_id && next.technical_lead_id !== p.technical_lead_id) alertAssigned(next.technical_lead_id, req.user, p.id, 'delivery_tl');
  res.json({ program: one(p.id) });
});

/** Add someone to the delivery team. Body: { user_id } for a KIT user, or { name } for someone outside KIT; plus an optional role. */
r.post('/:id/team', (req, res) => {
  if (!db.prepare('SELECT 1 FROM delivery_programs WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Program not found' });
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
  db.prepare("UPDATE delivery_programs SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ program: one(req.params.id) });
});

r.delete('/team/:memberId', (req, res) => {
  const m = db.prepare('SELECT * FROM delivery_team WHERE id = ?').get(req.params.memberId);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM delivery_team WHERE id = ?').run(m.id);
  res.json({ program: one(m.program_id) });
});

/** Add a document. Form fields: file, doc_type (one of CONTRACT_DOC_TYPES, or Additional). */
r.post('/:id/files', upload.single('file'), (req, res) => {
  const refuse = (status, error) => {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    res.status(status).json({ error });
  };
  if (!req.file) return refuse(400, 'Choose a file to upload');
  if (!db.prepare('SELECT 1 FROM delivery_programs WHERE id = ?').get(req.params.id)) return refuse(404, 'Program not found');
  const type = req.body?.doc_type;
  if (type !== ADDITIONAL_DOCS && !CONTRACT_DOC_TYPES.includes(type)) return refuse(400, 'Choose a document type');
  db.prepare('INSERT INTO delivery_files (program_id, doc_type, original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(req.params.id, type, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id);
  db.prepare("UPDATE delivery_programs SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ program: one(req.params.id) });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM delivery_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});

r.delete('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM delivery_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (f.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the person who added this file can delete it' });
  db.prepare('DELETE FROM delivery_files WHERE id = ?').run(f.id);
  fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
  res.json({ program: one(f.program_id) });
});

/** Record funding received or revenue billed. Body: { kind: 'funding' | 'billing', amount, entry_date, note? }. */
r.post('/:id/entries', (req, res) => {
  if (!db.prepare('SELECT 1 FROM delivery_programs WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  if (!['funding', 'billing'].includes(b.kind)) return res.status(400).json({ error: 'Choose funding or billing' });
  const amount = Number(b.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter an amount above zero' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.entry_date || '')) return res.status(400).json({ error: 'Enter a date' });
  db.prepare('INSERT INTO program_entries (program_id, kind, amount, entry_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, b.kind, amount, b.entry_date, String(b.note || '').trim() || null, req.user.id);
  db.prepare("UPDATE delivery_programs SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ program: one(req.params.id) });
});

r.delete('/entries/:entryId', (req, res) => {
  const e = db.prepare('SELECT * FROM program_entries WHERE id = ?').get(req.params.entryId);
  if (!e) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM program_entries WHERE id = ?').run(e.id);
  res.json({ program: one(e.program_id) });
});

export default r;
