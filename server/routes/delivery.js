// Delivery: contracts we've won. Each program is copied from an Awarded bid ticket (see the delivery_on_award
// triggers in db.js), then assigned a Program Manager and a delivery team. Funding received and revenue billed are
// recorded against it as entries, which make up its funded / unfunded backlog and the "bill" side of book-to-bill.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
const STATUSES = ['Active', 'Complete'];

function programsOut(rows) {
  const team = db.prepare(`SELECT m.*, u.first_name, u.last_name, u.title FROM delivery_team m
    LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at, m.id`).all();
  const entries = db.prepare(`SELECT e.*, u.first_name, u.last_name FROM program_entries e
    LEFT JOIN users u ON u.id = e.created_by ORDER BY e.entry_date DESC, e.id DESC`).all();
  return rows.map((p) => ({
    id: p.id, ticket_id: p.ticket_id, ticket_exists: !!p.ticket_title, name: p.name, organization: p.organization,
    account_type: p.account_type, value: p.value, awarded_at: p.awarded_at, status: p.status, notes: p.notes, updated_at: p.updated_at,
    bd_director: p.dir_first ? { id: p.bd_director_id, first_name: p.dir_first, last_name: p.dir_last } : null, territory_name: p.territory_name,
    ...money(p, entries.filter((e) => e.program_id === p.id)),
    program_manager: p.pm_first ? { id: p.program_manager_id, first_name: p.pm_first, last_name: p.pm_last } : null,
    team: team.filter((m) => m.program_id === p.id).map((m) => ({
      id: m.id, role: m.role,
      user: m.user_id && m.first_name ? { id: m.user_id, first_name: m.first_name, last_name: m.last_name, title: m.title } : null,
      name: m.user_id && m.first_name ? `${m.first_name} ${m.last_name}` : m.name,
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
// The BD director and territory come from the bid ticket the contract was won from.
const SELECT = `SELECT p.*, u.first_name AS pm_first, u.last_name AS pm_last, t.opportunity_title AS ticket_title,
    t.bd_director_id, d.first_name AS dir_first, d.last_name AS dir_last, tr.name AS territory_name
  FROM delivery_programs p LEFT JOIN users u ON u.id = p.program_manager_id LEFT JOIN tickets t ON t.id = p.ticket_id
  LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id`;
const one = (id) => programsOut(db.prepare(`${SELECT} WHERE p.id = ?`).all(id))[0] || null;

/** Tell someone they've been put on a won contract: as its Program Manager, or on its delivery team (with their role). */
function alertAssigned(userId, actor, programId, kind, role) {
  db.prepare('INSERT INTO alerts (user_id, actor_id, kind, program_id, excerpt) VALUES (?, ?, ?, ?, ?)').run(userId, actor.id, kind, programId, role || null);
}

/** status: active (default) | complete | all. Newest wins first. */
r.get('/', (req, res) => {
  const status = { active: 'Active', complete: 'Complete' }[req.query.status];
  const rows = db.prepare(`${SELECT} ${status ? 'WHERE p.status = ?' : ''} ORDER BY p.awarded_at DESC, p.id DESC`).all(...(status ? [status] : []));
  res.json({ programs: programsOut(rows) });
});

/** Body may hold: program_manager_id (null to clear), status, notes, value (the contract value; null to clear). */
r.put('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Program not found' });
  const b = req.body || {};
  const next = { ...p };
  if ('program_manager_id' in b) {
    const id = Number(b.program_manager_id) || null;
    if (id && !db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(id)) return res.status(400).json({ error: 'Unknown person' });
    next.program_manager_id = id;
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
  db.prepare("UPDATE delivery_programs SET program_manager_id = ?, status = ?, notes = ?, value = ?, updated_at = datetime('now') WHERE id = ?")
    .run(next.program_manager_id, next.status, next.notes, next.value, p.id);
  if (next.program_manager_id && next.program_manager_id !== p.program_manager_id) alertAssigned(next.program_manager_id, req.user, p.id, 'delivery_pm');
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
