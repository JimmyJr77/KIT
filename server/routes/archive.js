// The archive: tickets (bid and work) and priority cards taken off the boards, one by one or all at once as a dataset.
// Anyone can archive and restore single items; archiving everything, loading a dataset back and deleting for good are
// for admins, and only what's already archived can be deleted.
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db, json } from '../db.js';
import { laneFor, isArchived } from '../../src/lib/lanes.js';
import { archiveRows, restoreRows, deleteRows, archivedRowCounts } from '../sample/registry.js';
import { resetSample } from '../sample/index.js';

const r = Router();
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(Number).filter(Boolean))];

/** Archived tickets: archived by hand, or Done long enough to archive themselves. */
function archivedTickets() {
  return db.prepare(`SELECT t.*, u.first_name AS owner_first, u.last_name AS owner_last,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count
    FROM tickets t LEFT JOIN users u ON u.id = COALESCE(t.bd_director_id, t.created_by) WHERE t.archive_set_id IS NULL`).all()
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
    WHERE c.archived_at IS NOT NULL AND c.archive_set_id IS NULL ORDER BY c.archived_at DESC`).all();
  const people = db.prepare(`SELECT a.card_id, u.first_name, u.last_name FROM card_assignees a JOIN users u ON u.id = a.user_id
    JOIN priority_cards c ON c.id = a.card_id WHERE c.archived_at IS NOT NULL`).all();
  return cards.map(({ checklist, ...c }) => ({
    ...c, tasks: json.parse(checklist, []).length,
    assignees: people.filter((p) => p.card_id === c.id).map((p) => `${p.first_name} ${p.last_name}`),
  }));
}

// ---- Datasets ("Archive all")

// Real records only: the sample data is never archived with everything else.
const notSample = (alias, tbl) => `${alias}.id NOT IN (SELECT row_id FROM sample_rows WHERE tbl = '${tbl}')`;

/** What "Archive all" would take: every real ticket and priority card still on the boards. */
function liveItems() {
  const archived = new Set(archivedTickets().map((t) => t.id));
  const tickets = db.prepare(`SELECT t.* FROM tickets t WHERE t.archived_at IS NULL AND t.archive_set_id IS NULL AND ${notSample('t', 'tickets')}`).all()
    .filter((t) => !archived.has(t.id) && !isArchived(t, laneFor({ ...t, last_activity: t.updated_at })));
  const ids = JSON.stringify(tickets.map((t) => t.id));
  // Cards still on the boards, plus every card on a ticket being archived.
  const cards = db.prepare(`SELECT c.id FROM priority_cards c WHERE c.archive_set_id IS NULL AND ${notSample('c', 'priority_cards')}
    AND (c.archived_at IS NULL OR c.ticket_id IN (SELECT value FROM json_each(?)))`).all(ids).map((c) => c.id);
  return { tickets, cards };
}

// Everything else a full reset archives along with the tickets and priority cards: the CRM, events, travel, contracts
// and their funding and billing, actual travel spend, booking targets, account objectives, forecasts, marketing and its spend, alerts, work logs and priority account lists.
// People, teams, territories and settings stay.
const RESET_TABLES = ['contacts', 'contact_interactions', 'ticket_contacts', 'task_participants', 'events', 'event_attendees', 'event_reps', 'event_support_requests', 'support_needs', 'support_need_tickets',
  'trips', 'travel_actuals', 'delivery_programs', 'delivery_team', 'program_entries', 'booking_targets', 'account_objectives', 'forecast_snapshots',
  'marketing_assets', 'marketing_copy', 'marketing_spend', 'alerts', 'work_log',
  'priority_tiers', 'priority_accounts', 'priority_account_tickets', 'priority_list_tickets'];

function datasets() {
  const other = archivedRowCounts();
  return db.prepare(`SELECT s.id, s.name, s.created_at, u.first_name || ' ' || u.last_name AS created_by_name,
      (SELECT COUNT(*) FROM tickets t WHERE t.archive_set_id = s.id AND t.ticket_type = 'bid') AS bid,
      (SELECT COUNT(*) FROM tickets t WHERE t.archive_set_id = s.id AND t.ticket_type = 'work') AS work,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.archive_set_id = s.id) AS cards,
      (SELECT COUNT(*) FROM ticket_files f JOIN tickets t ON t.id = f.ticket_id WHERE t.archive_set_id = s.id) AS files
    FROM archive_sets s LEFT JOIN users u ON u.id = s.created_by ORDER BY s.created_at DESC, s.id DESC`).all()
    .map((d) => {
      const o = other[d.id] || {};
      return { ...d, full_reset: !!other[d.id], contacts: o.contacts || 0, events: o.events || 0, trips: o.trips || 0, contracts: o.delivery_programs || 0, targets: o.booking_targets || 0, objectives: o.account_objectives || 0 };
    });
}

/** Archives the live tickets and cards into a new dataset. */
function archiveLive(name, userId) {
  const live = liveItems();
  return db.transaction(() => {
    const setId = db.prepare('INSERT INTO archive_sets (name, created_by) VALUES (?, ?)').run(name, userId).lastInsertRowid;
    db.prepare("UPDATE tickets SET archived_at = datetime('now'), archive_set_id = ? WHERE id IN (SELECT value FROM json_each(?))")
      .run(setId, JSON.stringify(live.tickets.map((t) => t.id)));
    db.prepare("UPDATE priority_cards SET archived_at = COALESCE(archived_at, datetime('now')), archive_set_id = ? WHERE id IN (SELECT value FROM json_each(?))")
      .run(setId, JSON.stringify(live.cards));
    return setId;
  })();
}
const today = () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

r.get('/', (req, res) => {
  const live = liveItems();
  res.json({
    tickets: archivedTickets(), cards: archivedCards(), datasets: datasets(), canDelete: req.user.role === 'admin',
    live: { bid: live.tickets.filter((t) => t.ticket_type === 'bid').length, work: live.tickets.filter((t) => t.ticket_type === 'work').length, cards: live.cards.length },
  });
});

/** Body: { name }. Archives every real ticket and priority card on the boards as one dataset. Admins only. */
r.post('/all', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can archive everything' });
  const live = liveItems();
  if (!live.tickets.length && !live.cards.length) return res.status(400).json({ error: 'There’s nothing on the boards to archive' });
  const id = archiveLive(String(req.body?.name || '').trim() || `Archive of ${today()}`, req.user.id);
  res.json({ dataset: datasets().find((d) => d.id === id) });
});

/**
 * Body: { confirm: 'RESET' }. Full reset, admins only: archives all real work data as one dataset (tickets and priority
 * cards, plus everything in RESET_TABLES), then reloads a fresh copy of the sample data, still shown or hidden as it was.
 * Nothing is deleted; load the dataset back from the archive to undo it.
 */
r.post('/reset', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can reset KIT' });
  if (req.body?.confirm !== 'RESET') return res.status(400).json({ error: 'Type RESET to confirm' });
  const id = archiveLive(`Full reset of ${today()}`, req.user.id);
  archiveRows(id, RESET_TABLES);
  try {
    resetSample();
  } catch (e) {
    console.error(`Full reset: couldn't reload the sample data: ${e.message}`);
  }
  res.json({ dataset: datasets().find((d) => d.id === id) });
});

/** Puts a whole dataset back on the boards. Admins only. */
r.post('/datasets/:id/load', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can load a dataset' });
  const set = db.prepare('SELECT id FROM archive_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'Dataset not found' });
  db.transaction(() => {
    // Done tickets get a fresh 14 days on the board before they age back into the archive.
    db.prepare("UPDATE tickets SET archived_at = NULL, archive_set_id = NULL, done_at = CASE WHEN done_at IS NOT NULL THEN datetime('now') END WHERE archive_set_id = ?").run(set.id);
    db.prepare("UPDATE priority_cards SET archived_at = NULL, archive_set_id = NULL, updated_at = datetime('now') WHERE archive_set_id = ?").run(set.id);
    restoreRows(set.id);
    db.prepare('DELETE FROM archive_sets WHERE id = ?').run(set.id);
  })();
  res.json({ ok: true });
});

/** Deletes a dataset and everything in it for good. Admins only. */
r.delete('/datasets/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can delete permanently' });
  const set = db.prepare('SELECT id FROM archive_sets WHERE id = ?').get(req.params.id);
  if (!set) return res.status(404).json({ error: 'Dataset not found' });
  const t = db.prepare('SELECT id FROM tickets WHERE archive_set_id = ? AND archived_at IS NOT NULL').all(set.id).map((x) => x.id);
  const c = db.prepare('SELECT id FROM priority_cards WHERE archive_set_id = ? AND archived_at IS NOT NULL').all(set.id).map((x) => x.id);
  const deleted = removeForGood(t, c);
  deleteRows(set.id);
  db.prepare('DELETE FROM archive_sets WHERE id = ?').run(set.id);
  res.json({ deleted });
});

// ---- Single items

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
  res.json({ deleted: removeForGood(t, c) });
});

/** Deletes tickets (with their priority cards, comments, documents and their files, tasks and history) and cards. */
function removeForGood(t, c) {
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
  return { tickets: t.length, cards: cardsDeleted, files: files.length };
}

export default r;
