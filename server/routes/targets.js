// Booking targets: what each BD director is expected to book (win) per quarter and per year. They apply to the BD team
// only: only people on BD get one, and only theirs count. Everyone can read them, since the BD report card compares
// bookings against them; admins and BD team leads set them.
import { Router } from 'express';
import { db, canManageBd } from '../db.js';

const r = Router();

const ON_BD = "SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD'";
/** Everyone on BD. */
const directors = () => db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title FROM users u
  WHERE u.active = 1 AND u.id IN (${ON_BD}) ORDER BY u.last_name, u.first_name`).all();
/** The year's targets for people on BD. */
const targetsFor = (year) => db.prepare(`SELECT user_id, quarter, amount FROM booking_targets WHERE year = ? AND user_id IN (${ON_BD})`).all(year);

/** ?year=2027 (default: this year). Targets as { user_id, quarter (0 = the year), amount }. */
r.get('/', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({
    year,
    directors: directors(),
    targets: targetsFor(year),
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
  if (!db.prepare(`SELECT 1 FROM (${ON_BD}) WHERE user_id = ?`).get(user_id)) return res.status(400).json({ error: 'Booking targets are only for people on the BD team' });
  // A full reset may have archived a target for this quarter. Setting or clearing it takes it out of that dataset
  // first, so the change doesn't land on a hidden row.
  db.prepare(`DELETE FROM archived_rows WHERE tbl = 'booking_targets'
    AND row_id IN (SELECT rowid FROM main.booking_targets WHERE user_id = ? AND year = ? AND quarter = ?)`).run(user_id, year, q);
  if (amount === '' || amount == null) {
    db.prepare('DELETE FROM booking_targets WHERE user_id = ? AND year = ? AND quarter = ?').run(user_id, year, q);
  } else {
    const n = Number(amount);
    if (!(n >= 0)) return res.status(400).json({ error: 'Target must be a positive number' });
    db.prepare(`INSERT INTO booking_targets (user_id, year, quarter, amount, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, year, quarter) DO UPDATE SET amount = excluded.amount, updated_by = excluded.updated_by, updated_at = datetime('now')`)
      .run(user_id, year, q, n, req.user.id);
  }
  res.json({ targets: targetsFor(year) });
});

export default r;
