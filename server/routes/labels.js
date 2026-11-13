// Tags: Pipedrive's deal labels, plus any made in KIT, each with a color. Anyone can tag a ticket or make a tag;
// tags from Pipedrive are named and colored there. Each tag has a category (Process, Source or Other). KIT's own
// process and lead source tags and Google Solution (labels.kind) are permanent: they can't be renamed, recolored or deleted.
import { Router } from 'express';
import { db, tagCategory, PROCESS_TAGS } from '../db.js';

const r = Router();
export const LABEL_COLORS = ['green', 'blue', 'red', 'yellow', 'purple', 'gray', 'orange', 'brown', 'pink', 'dark-gray'];

// Process tags in their own order (RFI, White Paper, SOW, RFP), then the lead sources, then everything else.
const ORDER = { process: 0, source: 1, other: 2 };
const list = () => db.prepare(`SELECT l.id, l.name, l.color, l.pipedrive_id, l.kind,
    (SELECT COUNT(*) FROM tickets t, json_each(CASE WHEN json_valid(t.labels) THEN t.labels ELSE '[]' END) j WHERE j.value = l.name COLLATE NOCASE) AS ticket_count
  FROM labels l ORDER BY l.pipedrive_id IS NULL, l.position, l.name COLLATE NOCASE`).all()
  .map((l) => ({ ...l, category: tagCategory(l.kind) }))
  .sort((a, b) => ORDER[a.category] - ORDER[b.category] || (a.category === 'process' ? PROCESS_TAGS.indexOf(a.name) - PROCESS_TAGS.indexOf(b.name) : 0));

r.get('/', (req, res) => res.json({ labels: list(), colors: LABEL_COLORS }));

/** Body: { name, color }. */
r.post('/', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 40);
  if (!name) return res.status(400).json({ error: 'Name the tag' });
  if (db.prepare('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE').get(name)) return res.status(409).json({ error: 'There’s already a tag with that name' });
  const color = LABEL_COLORS.includes(req.body?.color) ? req.body.color : 'gray';
  const id = db.prepare('INSERT INTO labels (name, color, position) VALUES (?, ?, (SELECT COALESCE(MAX(position) + 1, 0) FROM labels))').run(name, color).lastInsertRowid;
  res.json({ label: list().find((l) => l.id === id), labels: list() });
});

/** Rename or recolor a tag made in KIT (Pipedrive's are changed in Pipedrive). Tickets carrying it follow a rename. */
r.put('/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Tag not found' });
  if (l.kind) return res.status(400).json({ error: 'This is one of KIT’s permanent tags; it can’t be changed' });
  if (l.pipedrive_id) return res.status(400).json({ error: 'This tag comes from Pipedrive; change it there' });
  const name = 'name' in (req.body || {}) ? String(req.body.name || '').trim().slice(0, 40) : l.name;
  if (!name) return res.status(400).json({ error: 'Name the tag' });
  if (name.toLowerCase() !== l.name.toLowerCase() && db.prepare('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE').get(name)) {
    return res.status(409).json({ error: 'There’s already a tag with that name' });
  }
  const color = LABEL_COLORS.includes(req.body?.color) ? req.body.color : l.color;
  db.transaction(() => {
    db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(name, color, l.id);
    if (name !== l.name) {
      db.prepare(`UPDATE tickets SET labels = (SELECT json_group_array(CASE WHEN j.value = ? COLLATE NOCASE THEN ? ELSE j.value END) FROM json_each(tickets.labels) j)
        WHERE json_valid(labels) AND EXISTS (SELECT 1 FROM json_each(tickets.labels) j WHERE j.value = ? COLLATE NOCASE)`).run(l.name, name, l.name);
    }
  })();
  res.json({ labels: list() });
});

/** Delete a tag made in KIT, taking it off every ticket. */
r.delete('/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM labels WHERE id = ?').get(req.params.id);
  if (!l) return res.status(404).json({ error: 'Tag not found' });
  if (l.kind) return res.status(400).json({ error: 'This is one of KIT’s permanent tags; it can’t be deleted' });
  if (l.pipedrive_id) return res.status(400).json({ error: 'This tag comes from Pipedrive; delete it there' });
  db.transaction(() => {
    db.prepare(`UPDATE tickets SET labels = (SELECT json_group_array(j.value) FROM json_each(tickets.labels) j WHERE j.value != ? COLLATE NOCASE)
      WHERE json_valid(labels) AND EXISTS (SELECT 1 FROM json_each(tickets.labels) j WHERE j.value = ? COLLATE NOCASE)`).run(l.name, l.name);
    db.prepare('DELETE FROM labels WHERE id = ?').run(l.id);
  })();
  res.json({ labels: list() });
});

export default r;
