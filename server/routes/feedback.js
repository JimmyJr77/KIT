// Site feedback from the KITT widget in the corner of every page: anyone signed in can send a suggestion or report an
// issue. Developers work it like tickets in the Developer section of Admin Access: check one off when it's done, then
// archive it (archived ones can be brought back or deleted for good).
import { Router } from 'express';
import { db } from '../db.js';
import { requireDeveloper } from '../auth.js';

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

const person = (id, first_name, last_name, username) => (id ? { id, first_name, last_name, username } : null);

/** Developers: every entry, newest first, with who sent it, who checked it off, and whether it's archived. `open` counts the ones not yet done. */
r.get('/', requireDeveloper, (req, res) => {
  const feedback = db.prepare(`SELECT f.id, f.message, f.path, f.created_at, f.done_at, f.archived_at,
      u.id AS user_id, u.first_name, u.last_name, u.username,
      d.id AS d_id, d.first_name AS d_first, d.last_name AS d_last, d.username AS d_username
    FROM site_feedback f LEFT JOIN users u ON u.id = f.user_id LEFT JOIN users d ON d.id = f.done_by
    ORDER BY f.created_at DESC, f.id DESC`).all()
    .map(({ user_id, first_name, last_name, username, d_id, d_first, d_last, d_username, ...f }) => ({
      ...f, user: person(user_id, first_name, last_name, username), done_by: person(d_id, d_first, d_last, d_username),
    }));
  res.json({ feedback, open: feedback.filter((f) => !f.done_at && !f.archived_at).length });
});

/** Developers: body { done?, archived? } (booleans). Done records who checked it off; un-done clears that. */
r.put('/:id', requireDeveloper, (req, res) => {
  const f = db.prepare('SELECT id FROM site_feedback WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Feedback not found' });
  const { done, archived } = req.body || {};
  if (done === true) db.prepare("UPDATE site_feedback SET done_at = COALESCE(done_at, datetime('now')), done_by = COALESCE(done_by, ?) WHERE id = ?").run(req.user.id, f.id);
  if (done === false) db.prepare('UPDATE site_feedback SET done_at = NULL, done_by = NULL WHERE id = ?').run(f.id);
  if (archived === true) db.prepare("UPDATE site_feedback SET archived_at = COALESCE(archived_at, datetime('now')) WHERE id = ?").run(f.id);
  if (archived === false) db.prepare('UPDATE site_feedback SET archived_at = NULL WHERE id = ?').run(f.id);
  res.json({ ok: true });
});

/** Developers: archive every entry that's done. */
r.post('/archive-done', requireDeveloper, (req, res) => {
  const n = db.prepare("UPDATE site_feedback SET archived_at = datetime('now') WHERE done_at IS NOT NULL AND archived_at IS NULL").run().changes;
  res.json({ archived: n });
});

/** Developers: delete an entry for good. */
r.delete('/:id', requireDeveloper, (req, res) => {
  db.prepare('DELETE FROM site_feedback WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
