// CRM: contacts, their interaction log, and the tickets they're involved in. Contacts added from a
// ticket are linked to it, and every contact appears on the master CRM page.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

const LIST_SQL = `SELECT c.*, u.first_name AS by_first, u.last_name AS by_last,
    (SELECT COUNT(*) FROM contact_interactions i WHERE i.contact_id = c.id) AS interaction_count,
    (SELECT MAX(i.created_at) FROM contact_interactions i WHERE i.contact_id = c.id) AS last_interaction_at
  FROM contacts c LEFT JOIN users u ON u.id = c.created_by`;

function withTickets(rows) {
  const links = db.prepare(`SELECT tc.contact_id, t.id, t.opportunity_title, t.ticket_type FROM ticket_contacts tc
    JOIN tickets t ON t.id = tc.ticket_id ORDER BY t.opportunity_title`).all();
  return rows.map(({ by_first, by_last, ...c }) => ({
    ...c,
    created_by_user: by_first ? { id: c.created_by, first_name: by_first, last_name: by_last } : null,
    tickets: links.filter((l) => l.contact_id === c.id).map(({ contact_id, ...t }) => t),
  }));
}
const one = (id) => withTickets(db.prepare(`${LIST_SQL} WHERE c.id = ?`).all(id))[0] || null;
const touchTicket = (id) => db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(id);

function fields(b = {}) {
  const s = (v) => (v == null ? '' : String(v).trim());
  const f = {
    first_name: s(b.first_name),
    last_name: s(b.last_name) || null,
    organization: s(b.organization) || null,
    role: s(b.role) || null,
    email: s(b.email) || null,
    phone: s(b.phone) || null,
    relationship: Math.max(0, Math.min(5, Math.round(Number(b.relationship) || 0))),
    notes: s(b.notes) || null,
  };
  if (!f.first_name) return { error: 'First name is required' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return { error: 'That email doesn’t look right' };
  return { f };
}

/** Every contact, alphabetical by last name. `q` searches name, organization, role, email, and notes. */
r.get('/', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  const rows = db.prepare(`${LIST_SQL} WHERE (c.first_name || ' ' || COALESCE(c.last_name, '') || ' ' || COALESCE(c.organization, '') || ' ' ||
      COALESCE(c.role, '') || ' ' || COALESCE(c.email, '') || ' ' || COALESCE(c.notes, '')) LIKE ?
    ORDER BY COALESCE(c.last_name, c.first_name) COLLATE NOCASE, c.first_name COLLATE NOCASE`).all(q);
  res.json({ contacts: withTickets(rows) });
});

/** The contacts linked to one ticket. */
r.get('/ticket/:ticketId', (req, res) => {
  const rows = db.prepare(`${LIST_SQL} JOIN ticket_contacts tc ON tc.contact_id = c.id WHERE tc.ticket_id = ?
    ORDER BY c.relationship DESC, COALESCE(c.last_name, c.first_name) COLLATE NOCASE`).all(req.params.ticketId);
  res.json({ contacts: withTickets(rows) });
});

/** One contact with its interaction log, newest first. */
r.get('/:id', (req, res) => {
  const c = one(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  const interactions = db.prepare(`SELECT i.*, u.first_name, u.last_name FROM contact_interactions i
    LEFT JOIN users u ON u.id = i.author_id WHERE i.contact_id = ? ORDER BY i.created_at DESC, i.id DESC`).all(c.id)
    .map((i) => ({ id: i.id, body: i.body, created_at: i.created_at, author: i.first_name ? { id: i.author_id, first_name: i.first_name, last_name: i.last_name } : null }));
  res.json({ contact: c, interactions });
});

/** Add a contact. With `ticket_id`, it's also linked to that ticket; `interactions` (newest first) are logged with it. */
r.post('/', (req, res) => {
  const { f, error } = fields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare(`INSERT INTO contacts (first_name, last_name, organization, role, email, phone, relationship, notes, created_by)
    VALUES (@first_name, @last_name, @organization, @role, @email, @phone, @relationship, @notes, @created_by)`).run({ ...f, created_by: req.user.id }).lastInsertRowid;
  // Interaction notes written while adding the person, newest first; saved oldest first so the order holds.
  const notes = (Array.isArray(req.body?.interactions) ? req.body.interactions : []).map((n) => String(n || '').trim()).filter(Boolean);
  const addNote = db.prepare("INSERT INTO contact_interactions (contact_id, body, author_id, created_at) VALUES (?, ?, ?, datetime('now', ?))");
  notes.reverse().forEach((body, i) => addNote.run(id, body, req.user.id, `+${i} seconds`));
  const ticketId = Number(req.body?.ticket_id);
  if (ticketId && db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId)) {
    db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id, added_by) VALUES (?, ?, ?)').run(ticketId, id, req.user.id);
    touchTicket(ticketId);
  }
  res.json({ contact: one(id) });
});

r.put('/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  const { f, error } = fields(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE contacts SET first_name=@first_name, last_name=@last_name, organization=@organization, role=@role, email=@email,
    phone=@phone, relationship=@relationship, notes=@notes, updated_at=datetime('now') WHERE id=@id`).run({ ...f, id: Number(req.params.id) });
  res.json({ contact: one(req.params.id) });
});

/** Only whoever added a contact, or an admin, can delete it. */
r.delete('/:id', (req, res) => {
  const c = db.prepare('SELECT * FROM contacts WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Contact not found' });
  if (c.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only whoever added this contact can delete it' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(c.id);
  res.json({ ok: true });
});

// ---- Interactions

r.post('/:id/interactions', (req, res) => {
  if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write the note first' });
  db.prepare('INSERT INTO contact_interactions (contact_id, body, author_id) VALUES (?, ?, ?)').run(req.params.id, body, req.user.id);
  db.prepare("UPDATE contacts SET updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

r.delete('/interactions/:iid', (req, res) => {
  const i = db.prepare('SELECT * FROM contact_interactions WHERE id = ?').get(req.params.iid);
  if (!i) return res.status(404).json({ error: 'Note not found' });
  if (i.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this note' });
  db.prepare('DELETE FROM contact_interactions WHERE id = ?').run(i.id);
  res.json({ ok: true });
});

// ---- Ticket links

r.put('/:id/tickets/:ticketId', (req, res) => {
  if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  if (!db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(req.params.ticketId)) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id, added_by) VALUES (?, ?, ?)').run(req.params.ticketId, req.params.id, req.user.id);
  touchTicket(req.params.ticketId);
  res.json({ contact: one(req.params.id) });
});

/** Take a contact off a ticket. They stay in the CRM. */
r.delete('/:id/tickets/:ticketId', (req, res) => {
  db.prepare('DELETE FROM ticket_contacts WHERE ticket_id = ? AND contact_id = ?').run(req.params.ticketId, req.params.id);
  touchTicket(req.params.ticketId);
  res.json({ contact: one(req.params.id) });
});

export default r;
