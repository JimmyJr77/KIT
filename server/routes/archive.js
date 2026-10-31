// The archive: tickets (bid and work) and priority cards taken off the boards. Anyone can archive and restore;
// only admins can delete for good, and only what's already archived.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, json } from '../db.js';
import { laneFor, isArchived } from '../../src/lib/lanes.js';

const r = Router();
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(Number).filter(Boolean))];

/** Archived tickets: archived by hand, or Done long enough to archive themselves. */
function archivedTickets() {
  return db.prepare(`SELECT t.*, u.first_name AS owner_first, u.last_name AS owner_last,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count
    FROM tickets t LEFT JOIN users u ON u.id = COALESCE(t.bd_director_id, t.created_by)`).all()
    // Only Done tickets age into the archive, and whether one is Done doesn't depend on recent activity.
    .filter((t) => isArchived(t, laneFor({ ...t, last_activity: t.updated_at })))
    .map((t) => ({
      id: t.id, ticket_type: t.ticket_type, opportunity_title: t.opportunity_title, organization: t.organization,
      pipeline_status: t.pipeline_status, value: t.value, archived_at: t.archived_at, done_at: t.done_at,
      owner: t.owner_first ? `${t.owner_first} ${t.owner_last}` : null, card_count: t.card_count, file_count: t.file_count,
    }));
}

function archivedCards() {
  const cards = db.prepare(`SELECT c.id, c.title, c.week_start, c.archived_at, c.completed, c.is_planned, c.checklist, tk.opportunity_title, tk.ticket_type, tm.name AS team_name
    FROM priority_cards c JOIN tickets tk ON tk.id = c.ticket_id LEFT JOIN teams tm ON tm.id = c.team_id
    WHERE c.archived_at IS NOT NULL ORDER BY c.archived_at DESC`).all();
  const people = db.prepare(`SELECT a.card_id, u.first_name, u.last_name FROM card_assignees a JOIN users u ON u.id = a.user_id
    JOIN priority_cards c ON c.id = a.card_id WHERE c.archived_at IS NOT NULL`).all();
  return cards.map(({ checklist, ...c }) => ({
    ...c, tasks: json.parse(checklist, []).length,
    assignees: people.filter((p) => p.card_id === c.id).map((p) => `${p.first_name} ${p.last_name}`),
  }));
}

r.get('/', (req, res) => {
  res.json({ tickets: archivedTickets(), cards: archivedCards(), canDelete: req.user.role === 'admin' });
});

/** Body: { tickets: [ids], cards: [ids] }. Puts them back on the boards. */
r.post('/restore', (req, res) => {
  const t = ids(req.body?.tickets);
  const c = ids(req.body?.cards);
  db.transaction(() => {
    const tk = db.prepare("UPDATE tickets SET archived_at = NULL, done_at = CASE WHEN done_at IS NOT NULL THEN datetime('now') END WHERE id = ?");
    t.forEach((id) => tk.run(id));
    const cd = db.prepare("UPDATE priority_cards SET archived_at = NULL, updated_at = datetime('now') WHERE id = ?");
    c.forEach((id) => cd.run(id));
  })();
  res.json({ restored: { tickets: t.length, cards: c.length } });
});

/**
 * Body: { tickets: [ids], cards: [ids] }. Deletes them for good: admins only, archived items only. A ticket takes its
 * priority cards, comments, documents (and their files), tasks and history with it.
 */
r.post('/delete', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete permanently' });
  const archived = new Set(archivedTickets().map((t) => t.id));
  const t = ids(req.body?.tickets);
  const c = ids(req.body?.cards);
  if (t.some((id) => !archived.has(id))) return res.status(400).json({ error: 'Archive a ticket before deleting it' });
  if (c.length && db.prepare('SELECT COUNT(*) AS n FROM priority_cards WHERE archived_at IS NOT NULL AND id IN (SELECT value FROM json_each(?))').get(JSON.stringify(c)).n !== c.length) {
    return res.status(400).json({ error: 'Archive a priority card before deleting it' });
  }
  const files = t.length ? db.prepare('SELECT stored_name FROM ticket_files WHERE ticket_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(t)) : [];
  let cardsDeleted = 0;
  db.transaction(() => {
    const delCard = db.prepare('DELETE FROM priority_cards WHERE id IN (SELECT value FROM json_each(?))');
    cardsDeleted += delCard.run(JSON.stringify(c)).changes;
    // A ticket's cards aren't removed by the database on their own, so they go first.
    cardsDeleted += db.prepare('DELETE FROM priority_cards WHERE ticket_id IN (SELECT value FROM json_each(?))').run(JSON.stringify(t)).changes;
    db.prepare('DELETE FROM tickets WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(t));
  })();
  files.forEach((f) => fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }));
  res.json({ deleted: { tickets: t.length, cards: cardsDeleted, files: files.length } });
});

export default r;
