// Account development objectives: what a BD director is working toward with a customer, such as access to a
// decision maker, a capability briefing, or shaping a requirement. Feeds the BD report card's account development measure.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
export const OBJECTIVE_STATUSES = ['Not started', 'In progress', 'Achieved', 'Missed'];
const DONE = ['Achieved', 'Missed'];

const SELECT = `SELECT o.*, u.first_name AS owner_first, u.last_name AS owner_last, t.name AS territory_name
  FROM account_objectives o LEFT JOIN users u ON u.id = o.owner_id LEFT JOIN territories t ON t.id = o.territory_id`;
const out = (o) => ({
  ...o, owner: o.owner_first ? { id: o.owner_id, first_name: o.owner_first, last_name: o.owner_last } : null,
  owner_first: undefined, owner_last: undefined,
});

/** ?owner=<user id>&territory=<id>&status=open|done. Open ones first, soonest target date first. */
r.get('/', (req, res) => {
  const where = [];
  const p = {};
  if (Number(req.query.owner)) { where.push('o.owner_id = @owner'); p.owner = Number(req.query.owner); }
  if (Number(req.query.territory)) { where.push('o.territory_id = @territory'); p.territory = Number(req.query.territory); }
  if (req.query.status === 'open') where.push("o.status NOT IN ('Achieved', 'Missed')");
  if (req.query.status === 'done') where.push("o.status IN ('Achieved', 'Missed')");
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY o.status IN ('Achieved', 'Missed'), o.target_date IS NULL, o.target_date, o.organization`).all(p);
  // Organizations already known from contacts and tickets, to pick from.
  const organizations = db.prepare(`SELECT organization FROM contacts WHERE organization IS NOT NULL AND organization != ''
    UNION SELECT organization FROM tickets WHERE organization IS NOT NULL AND organization != ''
    UNION SELECT organization FROM account_objectives ORDER BY 1`).all().map((x) => x.organization);
  res.json({ objectives: rows.map(out), statuses: OBJECTIVE_STATUSES, organizations });
});

function fields(b = {}) {
  const s = (v) => String(v ?? '').trim();
  const f = {
    organization: s(b.organization), objective: s(b.objective), notes: s(b.notes) || null,
    owner_id: Number(b.owner_id) || null, territory_id: Number(b.territory_id) || null,
    target_date: /^\d{4}-\d{2}-\d{2}$/.test(b.target_date || '') ? b.target_date : null,
    status: OBJECTIVE_STATUSES.includes(b.status) ? b.status : 'Not started',
  };
  if (!f.organization) return { error: 'Name the customer organization' };
  if (!f.objective) return { error: 'Describe the objective' };
  return { f };
}

r.post('/', (req, res) => {
  const { f, error } = fields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare(`INSERT INTO account_objectives (organization, objective, notes, owner_id, territory_id, target_date, status, created_by, completed_at)
    VALUES (@organization, @objective, @notes, @owner_id, @territory_id, @target_date, @status, @created_by, CASE WHEN @done THEN datetime('now') END)`)
    .run({ ...f, created_by: req.user.id, done: DONE.includes(f.status) ? 1 : 0 }).lastInsertRowid;
  res.json({ objective: out(db.prepare(`${SELECT} WHERE o.id = ?`).get(id)) });
});

r.put('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM account_objectives WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Objective not found' });
  const { f, error } = fields({ ...o, ...req.body });
  if (error) return res.status(400).json({ error });
  // Reaching Achieved or Missed stamps when; reopening clears it.
  const completed = DONE.includes(f.status) ? (DONE.includes(o.status) ? o.completed_at : new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
  db.prepare(`UPDATE account_objectives SET organization = @organization, objective = @objective, notes = @notes, owner_id = @owner_id,
    territory_id = @territory_id, target_date = @target_date, status = @status, completed_at = @completed, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...f, completed, id: o.id });
  res.json({ objective: out(db.prepare(`${SELECT} WHERE o.id = ?`).get(o.id)) });
});

r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM account_objectives WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
