// Delivery: contracts we've won. Each program is copied from an Awarded bid ticket (see the delivery_on_award
// triggers in db.js), then assigned a Program Manager and a delivery team.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
const STATUSES = ['Active', 'Complete'];

function programsOut(rows) {
  const team = db.prepare(`SELECT m.*, u.first_name, u.last_name, u.title FROM delivery_team m
    LEFT JOIN users u ON u.id = m.user_id ORDER BY m.created_at, m.id`).all();
  return rows.map((p) => ({
    id: p.id, ticket_id: p.ticket_id, ticket_exists: !!p.ticket_title, name: p.name, organization: p.organization,
    account_type: p.account_type, value: p.value, awarded_at: p.awarded_at, status: p.status, notes: p.notes, updated_at: p.updated_at,
    program_manager: p.pm_first ? { id: p.program_manager_id, first_name: p.pm_first, last_name: p.pm_last } : null,
    team: team.filter((m) => m.program_id === p.id).map((m) => ({
      id: m.id, role: m.role,
      user: m.user_id && m.first_name ? { id: m.user_id, first_name: m.first_name, last_name: m.last_name, title: m.title } : null,
      name: m.user_id && m.first_name ? `${m.first_name} ${m.last_name}` : m.name,
    })),
  }));
}
const SELECT = `SELECT p.*, u.first_name AS pm_first, u.last_name AS pm_last, t.opportunity_title AS ticket_title
  FROM delivery_programs p LEFT JOIN users u ON u.id = p.program_manager_id LEFT JOIN tickets t ON t.id = p.ticket_id`;
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

/** Body may hold: program_manager_id (null to clear), status, notes. */
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
  db.prepare("UPDATE delivery_programs SET program_manager_id = ?, status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(next.program_manager_id, next.status, next.notes, p.id);
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

export default r;
