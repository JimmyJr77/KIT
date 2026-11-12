// Targets for each BD director, per quarter and per year: booking targets (what each is expected to book, i.e. win) and
// qualified pipeline targets (how much Qualified+ pipeline each is expected to hold). They apply to the BD team only:
// only people on BD get one, and only theirs count. Everyone can read them, since the BD report card and dashboards
// compare the numbers against them; admins and BD team leads set them.
import { Router } from 'express';
import { db, canManageBd, BD_DIRECTOR_IDS } from '../db.js';
import { TARGET_TABLES } from '../financials.js';

const r = Router();

const LABELS = { booking: 'Booking targets', qualified: 'Qualified pipeline targets' };
/** ?kind= or body.kind: 'booking' (the default) or 'qualified'. */
const kindOf = (v) => (v === 'qualified' ? 'qualified' : 'booking');

const ON_BD = BD_DIRECTOR_IDS;
/** The BD directors. */
const directors = () => db.prepare(`SELECT u.id, u.first_name, u.last_name, u.title FROM users u
  WHERE u.active = 1 AND u.id IN (${ON_BD}) ORDER BY u.last_name, u.first_name`).all();
/** The year's targets of one kind for people on BD. */
const targetsFor = (kind, year) => db.prepare(`SELECT user_id, quarter, amount FROM ${TARGET_TABLES[kind]} WHERE year = ? AND user_id IN (${ON_BD})`).all(year);

/** ?kind=booking|qualified&year=2027 (default: booking, this year). Targets as { user_id, quarter (0 = the year), amount }. */
r.get('/', (req, res) => {
  const kind = kindOf(req.query.kind);
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({
    kind,
    year,
    directors: directors(),
    targets: targetsFor(kind, year),
    canEdit: canManageBd(req.user),
  });
});

/** Body: { kind, user_id, year, quarter (0-4), amount }. An empty amount clears that target. */
r.put('/', (req, res) => {
  const kind = kindOf(req.body?.kind);
  const table = TARGET_TABLES[kind];
  if (!canManageBd(req.user)) return res.status(403).json({ error: `Only admins and BD team leads can set ${LABELS[kind].toLowerCase()}` });
  const { user_id, year, quarter, amount } = req.body || {};
  const q = Number(quarter);
  if (!Number.isInteger(Number(year)) || !(q >= 0 && q <= 4)) return res.status(400).json({ error: 'Choose a year and quarter' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(user_id)) return res.status(404).json({ error: 'Person not found' });
  if (!db.prepare(`SELECT 1 FROM (${ON_BD}) WHERE user_id = ?`).get(user_id)) return res.status(400).json({ error: `${LABELS[kind]} are only for people on the BD team` });
  // A full reset may have archived a target for this quarter. Setting or clearing it takes it out of that dataset
  // first, so the change doesn't land on a hidden row.
  db.prepare(`DELETE FROM archived_rows WHERE tbl = ?
    AND row_id IN (SELECT rowid FROM main.${table} WHERE user_id = ? AND year = ? AND quarter = ?)`).run(table, user_id, year, q);
  if (amount === '' || amount == null) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND year = ? AND quarter = ?`).run(user_id, year, q);
  } else {
    const n = Number(amount);
    if (!(n >= 0)) return res.status(400).json({ error: 'Target must be a positive number' });
    db.prepare(`INSERT INTO ${table} (user_id, year, quarter, amount, updated_by) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (user_id, year, quarter) DO UPDATE SET amount = excluded.amount, updated_by = excluded.updated_by, updated_at = datetime('now')`)
      .run(user_id, year, q, n, req.user.id);
  }
  res.json({ kind, targets: targetsFor(kind, year) });
});

export default r;
