// Site feedback from the KITT widget in the corner of every page: anyone signed in can send a suggestion or report an
// issue; admins read the list on Admin Access.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

const r = Router();

/** Body: { message, path? }. Records who said it and the page they were on. */
r.post('/', (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Say what could be better' });
  if (message.length > 4000) return res.status(400).json({ error: 'Keep it under 4,000 characters' });
  const path = String(req.body?.path || '').slice(0, 300) || null;
  const id = db.prepare('INSERT INTO site_feedback (user_id, message, path) VALUES (?, ?, ?)').run(req.user.id, message, path).lastInsertRowid;
  res.json({ id });
});

/** Admins: every entry, newest first, with who sent it. */
r.get('/', requireAdmin, (req, res) => {
  const feedback = db.prepare(`SELECT f.id, f.message, f.path, f.created_at, u.id AS user_id, u.first_name, u.last_name, u.username
    FROM site_feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.created_at DESC, f.id DESC`).all()
    .map(({ user_id, first_name, last_name, username, ...f }) => ({ ...f, user: user_id ? { id: user_id, first_name, last_name, username } : null }));
  res.json({ feedback });
});

/** Admins: drop an entry once it's been dealt with. */
r.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM site_feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
