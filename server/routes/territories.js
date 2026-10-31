// Territories: the customer areas BD directors cover. Everyone can read the list; admins and BD team leads keep it
// and say who covers which.
import { Router } from 'express';
import { db, withTeams, canManageBd, setUserTerritories } from '../db.js';
import { publicUser } from '../auth.js';

const r = Router();

const list = () => db.prepare(`SELECT t.*,
    (SELECT COUNT(*) FROM user_territories ut JOIN users u ON u.id = ut.user_id WHERE ut.territory_id = t.id AND u.active = 1) AS people,
    (SELECT COUNT(*) FROM tickets k WHERE k.territory_id = t.id) AS tickets
  FROM territories t ORDER BY t.position, t.name`).all();

r.get('/', (req, res) => res.json({ territories: list(), canManage: canManageBd(req.user) }));

function manager(req, res, next) {
  if (!canManageBd(req.user)) return res.status(403).json({ error: 'Only admins and BD team leads can change territories' });
  next();
}

const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const taken = (name, id = 0) => !!db.prepare('SELECT 1 FROM territories WHERE name = ? AND id != ?').get(name, id);

r.post('/', manager, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Name the territory' });
  if (taken(name)) return res.status(409).json({ error: `There's already a territory called ${name}` });
  const position = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS p FROM territories').get().p;
  db.prepare('INSERT INTO territories (name, position) VALUES (?, ?)').run(name, position);
  res.json({ territories: list() });
});

r.put('/:id', manager, (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Name the territory' });
  if (taken(name, Number(req.params.id))) return res.status(409).json({ error: `There's already a territory called ${name}` });
  if (!db.prepare('UPDATE territories SET name = ? WHERE id = ?').run(name, req.params.id).changes) return res.status(404).json({ error: 'Territory not found' });
  res.json({ territories: list() });
});

/** Removing a territory takes it off people and leaves its tickets without one. */
r.delete('/:id', manager, (req, res) => {
  db.transaction(() => {
    db.prepare('UPDATE tickets SET territory_id = NULL WHERE territory_id = ?').run(req.params.id);
    db.prepare('DELETE FROM user_territories WHERE territory_id = ?').run(req.params.id);
    db.prepare('DELETE FROM territories WHERE id = ?').run(req.params.id);
  })();
  res.json({ territories: list() });
});

/** Body: { territory_ids }. Sets the territories one person covers. */
r.put('/people/:userId', manager, (req, res) => {
  const id = Number(req.params.userId);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return res.status(404).json({ error: 'Person not found' });
  setUserTerritories(id, Array.isArray(req.body?.territory_ids) ? req.body.territory_ids : []);
  res.json({ user: publicUser(withTeams(db.prepare('SELECT * FROM users WHERE id = ?').get(id))) });
});

export default r;
