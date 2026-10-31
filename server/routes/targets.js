// Booking targets: what each BD director is expected to book (win) per quarter and per year. Everyone can read them,
// since the BD report card compares bookings against them; admins and BD team leads set them.
import { Router } from 'express';
import { db, canManageBd } from '../db.js';

const r = Router();

/** Everyone on BD, plus anyone else who has a target that year (e.g. someone who has since left BD). */
function directors(year) {
  return db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title FROM users u
    WHERE u.active = 1 AND (u.id IN (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD')
      OR u.id IN (SELECT user_id FROM booking_targets WHERE year = ?))
    ORDER BY u.last_name, u.first_name`).all(year);
}

/** ?year=2027 (default: this year). Targets as { user_id, quarter (0 = the year), amount }. */
r.get('/', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({
    year,
    directors: directors(year),
    targets: db.prepare('SELECT user_id, quarter, amount FROM booking_targets WHERE year = ?').all(year),
    canEdit: canManageBd(req.user),
  });
});

/** Body: { user_id, year, quarter (0-4), amount }. An empty amount clears that target. */
r.put('/', (req, res) => {
  if (!canManageBd(req.user)) return res.status(403).json({ error: 'Only admins and BD team leads can set booking targets' });
  const { user_id, year, quarter, amount } = req.body || {};
  const q = Number(quarter);
  if (!Number.isInteger(Number(year)) || !(q >= 0 && q <= 4)) return res.status(400).json({ error: 'Choose a year and quarter' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(user_id)) return res.status(404).json({ error: 'Person not found' });
  if (amount === '' || amount == null) {
    db.prepare('DELETE FROM booking_targets WHERE user_id = ? AND year = ? AND quarter = ?').run(user_id, year, q);
  } else {
    const n = Number(amount);
    if (!(n >= 0)) return res.status(400).json({ error: 'Target must be a positive number' });
    db.prepare(`INSERT INTO booking_targets (user_id, year, quarter, amount, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, year, quarter) DO UPDATE SET amount = excluded.amount, updated_by = excluded.updated_by, updated_at = datetime('now')`)
      .run(user_id, year, q, n, req.user.id);
  }
  res.json({ targets: db.prepare('SELECT user_id, quarter, amount FROM booking_targets WHERE year = ?').all(year) });
});

export default r;
