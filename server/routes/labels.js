// Tags: Pipedrive's deal labels, plus any made in KIT, each with a color. Anyone can tag a ticket or make a tag;
// admins manage the list (BD Pipeline › Settings › Tags): rename, recolor and delete tags, and move any tag from one
// category (Process, Source or Other) to another. A Pipedrive label renamed or deleted here is renamed or deleted in
// Pipedrive with the next send (pipedriveSend.js), and until then pulls leave KIT's change alone (pipedrive.js); its
// color is Pipedrive's, which its API doesn't let KIT set. KIT's own process and lead source tags and Google Solution
// (labels.kind) are permanent: KIT puts them on tickets by name, so they can't be renamed, recolored or deleted.
import { Router } from 'express';
import { db, tagCategory, PROCESS_TAGS } from '../db.js';
import { requireAdmin } from '../auth.js';

const r = Router();
export const LABEL_COLORS = ['green', 'blue', 'red', 'yellow', 'purple', 'gray', 'orange', 'brown', 'pink', 'dark-gray'];

// Process tags in their own order (RFI, Paper, Initial Gate … Proposal), then the lead sources, then everything else.
const ORDER = { process: 0, source: 1, other: 2 };
const CATEGORIES = Object.keys(ORDER);
const processOrder = (l) => { const i = PROCESS_TAGS.indexOf(l.name); return i < 0 ? PROCESS_TAGS.length : i; };
const list = () => db.prepare(`SELECT l.id, l.name, l.color, l.pipedrive_id, l.pipedrive_name, l.kind, l.category AS placed,
    (SELECT COUNT(*) FROM tickets t, json_each(CASE WHEN json_valid(t.labels) THEN t.labels ELSE '[]' END) j WHERE j.value = l.name COLLATE NOCASE) AS ticket_count
  FROM labels l ORDER BY l.pipedrive_id IS NULL, l.position, l.name COLLATE NOCASE`).all()
  // pipedrive_name: what Pipedrive still calls a label renamed here, until the rename is sent.
  .map(({ placed, pipedrive_name: theirs, ...l }) => ({ ...l, category: CATEGORIES.includes(placed) ? placed : tagCategory(l.kind),
    pipedrive_name: l.pipedrive_id && theirs != null && theirs !== l.name ? theirs : null }))
  .sort((a, b) => ORDER[a.category] - ORDER[b.category] || (a.category === 'process' ? processOrder(a) - processOrder(b) : 0));

r.get('/', (req, res) => res.json({ labels: list(), colors: LABEL_COLORS }));

/** Body: { name, color, category }. The category is an admin's to choose; anyone else's tag starts under Other. */
r.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Name the tag' });
  if (db.prepare('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE').get(name)) return res.status(409).json({ error: 'There’s already a tag with that name' });
  const color = LABEL_COLORS.includes(req.body?.color) ? req.body.color : 'gray';
  const category = req.user?.role === 'admin' && CATEGORIES.includes(req.body?.category) ? req.body.category : null;
  const id = db.prepare('INSERT INTO labels (name, color, position, category) VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM labels), ?)').run(name, color, category).lastInsertRowid;
  res.json({ label: list().find((l) => l.id === id), labels: list() });
});

/**
 * Admins. Body: any of { name, color, category }. Any tag can move to another category. The permanent ones can't be
 * renamed or recolored. Tickets carrying a tag follow its rename; a Pipedrive label's rename goes to Pipedrive with the
 * next send, and its color stays Pipedrive's.
 */
r.put('/:id', requireAdmin, (req, res) => {
  const l = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Tag not found' });
  const b = req.body || {};
  if ('category' in b && !CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Pick Process, Source or Other' });
  const name = 'name' in b ? String(b.name || '').trim().slice(0, 40) : l.name;
  const color = LABEL_COLORS.includes(b.color) ? b.color : l.color;
  if ((name !== l.name || color !== l.color) && l.kind) return res.status(400).json({ error: 'This is one of KIT’s permanent tags; it can’t be renamed or recolored' });
  if (color !== l.color && l.pipedrive_id) return res.status(400).json({ error: 'This label’s color is set in Pipedrive' });
  if (!name) return res.status(400).json({ error: 'Name the tag' });
  if (name.toLowerCase() !== l.name.toLowerCase() && db.prepare('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE').get(name)) {
    return res.status(409).json({ error: 'There’s already a tag with that name' });
  }
  db.transaction(() => {
    db.prepare('UPDATE labels SET name = ?, color = ?, category = ? WHERE id = ?').run(name, color, 'category' in b ? b.category : l.category, l.id);
    if (name !== l.name) {
      db.prepare(`UPDATE tickets SET labels = (SELECT json_group_array(CASE WHEN j.value = ? COLLATE NOCASE THEN ? ELSE j.value END) FROM json_each(tickets.labels) j)
        WHERE json_valid(labels) AND EXISTS (SELECT 1 FROM json_each(tickets.labels) j WHERE j.value = ? COLLATE NOCASE)`).run(l.name, name, l.name);
    }
  })();
  res.json({ labels: list() });
});

/** Admins. Delete a tag, taking it off every ticket. A Pipedrive label is deleted in Pipedrive with the next send. */
r.delete('/:id', requireAdmin, (req, res) => {
  const l = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Tag not found' });
  if (l.kind) return res.status(400).json({ error: 'This is one of KIT’s permanent tags; it can’t be deleted' });
  db.transaction(() => {
    if (l.pipedrive_id) db.prepare('INSERT OR REPLACE INTO label_deletes (pipedrive_id, name) VALUES (?, ?)').run(l.pipedrive_id, l.pipedrive_name || l.name);
    db.prepare(`UPDATE tickets SET labels = (SELECT json_group_array(j.value) FROM json_each(tickets.labels) j WHERE j.value != ? COLLATE NOCASE)
      WHERE json_valid(labels) AND EXISTS (SELECT 1 FROM json_each(tickets.labels) j WHERE j.value = ? COLLATE NOCASE)`).run(l.name, l.name);
    db.prepare('DELETE FROM labels WHERE id = ?').run(l.id);
  })();
  res.json({ labels: list() });
});

export default r;
