// CRM: contacts, their interaction log, and the tickets they're involved in. Contacts added from a
// ticket are linked to it, and every contact appears on the master CRM page.
import { Router } from 'express';
import { db, json } from '../db.js';
import { ticketEditDenied } from './tickets.js';
import { OBJECTIVE_SQL, objectiveHasWord, objectiveOut } from './objectives.js';

const r = Router();

const LIST_SQL = `SELECT c.*, u.first_name AS by_first, u.last_name AS by_last,
    (SELECT COUNT(*) FROM contact_interactions i WHERE i.contact_id = c.id) AS interaction_count,
    (SELECT MAX(i.created_at) FROM contact_interactions i WHERE i.contact_id = c.id) AS last_interaction_at
  FROM contacts c LEFT JOIN users u ON u.id = c.created_by`;

/** Everything searchable on a contact: their fields, labels and tickets, and their interaction log. */
const CONTACT_TEXT = `c.first_name || ' ' || COALESCE(c.last_name, '') || ' ' || COALESCE(c.organization, '') || ' ' || COALESCE(c.role, '') || ' ' ||
  COALESCE(c.email, '') || ' ' || COALESCE(c.phone, '') || ' ' || COALESCE(c.notes, '') || ' ' || COALESCE(c.labels, '') || ' ' ||
  COALESCE((SELECT group_concat(k.opportunity_title, ' ') FROM ticket_contacts tc JOIN tickets k ON k.id = tc.ticket_id WHERE tc.contact_id = c.id AND k.ticket_type != 'account'), '') || ' ' ||
  COALESCE((SELECT group_concat(i.body, ' ') FROM contact_interactions i WHERE i.contact_id = c.id), '')`;
/** SQL for "this text is somewhere on the contact", for the search box: any case, any part of a word. */
const contactHas = (param) => `instr(lower(${CONTACT_TEXT}), lower(${param})) > 0`;
/** SQL for "this name is on the contact as whole words", for filtering to an organization. */
const contactHasWord = (param) => `has_word(${CONTACT_TEXT}, ${param})`;

function withTickets(rows) {
  // A priority account's hidden ticket isn't a ticket to list here.
  const links = db.prepare(`SELECT tc.contact_id, t.id, t.opportunity_title, t.ticket_type FROM ticket_contacts tc
    JOIN tickets t ON t.id = tc.ticket_id WHERE t.ticket_type != 'account' ORDER BY t.opportunity_title`).all();
  return rows.map(({ by_first, by_last, ...c }) => ({
    ...c, labels: json.parse(c.labels, []),
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
    labels: json.str([...new Set((Array.isArray(b.labels) ? b.labels : []).map((x) => s(x)).filter(Boolean))]),
  };
  if (!f.first_name) return { error: 'First name is required' };
  if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return { error: 'That email doesn’t look right' };
  return { f };
}

/** KIT's organization row for a name (made if new), so a person's organization is Pipedrive's too. */
function organizationFor(name) {
  if (!name) return null;
  return db.prepare('SELECT id FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(name)?.id
    ?? db.prepare('INSERT INTO organizations (name) VALUES (?)').run(name).lastInsertRowid;
}

/** Every contact, alphabetical by last name. `q` finds any part of a word and `filter` whole words, each across all of a contact; with both, a contact has to match both. */
r.get('/', (req, res) => {
  const q = String(req.query.q || '').trim();
  const filter = String(req.query.filter || '').trim();
  const rows = db.prepare(`${LIST_SQL} WHERE (@q = '' OR ${contactHas('@q')}) AND (@filter = '' OR ${contactHasWord('@filter')})
    ORDER BY COALESCE(c.last_name, c.first_name) COLLATE NOCASE, c.first_name COLLATE NOCASE`).all({ q, filter });
  res.json({ contacts: withTickets(rows) });
});

/** The contacts linked to one ticket. */
/**
 * The CRM picture behind a strategy: everyone we know at an organization (plus anyone on the ticket, if given),
 * best relationship first, and the open account objectives there. ?organization=<name>&ticket=<id>. With inclusive=1 (a priority
 * account), that's anyone and anything with the name as whole words in any field, matching the CRM page's filter; otherwise the exact organization.
 */
r.get('/crm', (req, res) => {
  const org = String(req.query.organization || '').trim();
  const ticketId = Number(req.query.ticket) || null;
  const inclusive = req.query.inclusive === '1';
  const rows = db.prepare(`${LIST_SQL} WHERE (@org != '' AND ${inclusive ? contactHasWord('@org') : 'c.organization = @org COLLATE NOCASE'})
      OR c.id IN (SELECT contact_id FROM ticket_contacts WHERE ticket_id = @ticket)
    ORDER BY c.relationship DESC, COALESCE(c.last_name, c.first_name) COLLATE NOCASE`).all({ org, ticket: ticketId });
  const links = ticketId ? db.prepare('SELECT contact_id, is_primary FROM ticket_contacts WHERE ticket_id = ?').all(ticketId) : [];
  const contacts = withTickets(rows).map((c) => {
    const l = links.find((x) => x.contact_id === c.id);
    return { ...c, on_ticket: !!l, is_primary: !!l?.is_primary };
  });
  const objectives = org ? db.prepare(`${OBJECTIVE_SQL} WHERE ${inclusive ? objectiveHasWord('@org') : 'o.organization = @org COLLATE NOCASE'}
      ORDER BY o.status IN ('Achieved', 'Missed'), o.target_date IS NULL, o.target_date`).all({ org }).map(objectiveOut) : [];
  res.json({ contacts, objectives });
});

r.get('/ticket/:ticketId', (req, res) => {
  const rows = db.prepare(`${LIST_SQL} JOIN ticket_contacts tc ON tc.contact_id = c.id WHERE tc.ticket_id = ?
    ORDER BY c.relationship DESC, COALESCE(c.last_name, c.first_name) COLLATE NOCASE`).all(req.params.ticketId);
  const primary = db.prepare('SELECT contact_id FROM ticket_contacts WHERE ticket_id = ? AND is_primary = 1').get(req.params.ticketId)?.contact_id;
  res.json({ contacts: withTickets(rows).map((c) => ({ ...c, is_primary: c.id === primary })) });
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
  const onTicket = Number(req.body?.ticket_id) && db.prepare('SELECT * FROM tickets WHERE id = ?').get(Number(req.body.ticket_id));
  const denied = onTicket && ticketEditDenied(req.user, onTicket);
  if (denied) return res.status(403).json({ error: denied });
  const id = db.prepare(`INSERT INTO contacts (first_name, last_name, organization, organization_id, role, email, phone, relationship, notes, labels, created_by)
    VALUES (@first_name, @last_name, @organization, @organization_id, @role, @email, @phone, @relationship, @notes, @labels, @created_by)`)
    .run({ ...f, organization_id: organizationFor(f.organization), created_by: req.user.id }).lastInsertRowid;
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
  // On a person from Pipedrive, a change to a field Pipedrive holds waits to be sent.
  db.prepare(`UPDATE contacts SET first_name=@first_name, last_name=@last_name, organization=@organization, organization_id=@organization_id, role=@role, email=@email,
    phone=@phone, relationship=@relationship, notes=@notes, labels=@labels, updated_at=datetime('now'), pipedrive_pending=(pipedrive_id IS NOT NULL) WHERE id=@id`)
    .run({ ...f, organization_id: organizationFor(f.organization), id: Number(req.params.id) });
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

// ---- Ticket links: who's on a ticket is the ticket owner's (or an admin's) to change.

const ticketOwnerOnly = (req, res, next) => {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.ticketId);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const denied = ticketEditDenied(req.user, t);
  if (denied) return res.status(403).json({ error: denied });
  next();
};

r.put('/:id/tickets/:ticketId', ticketOwnerOnly, (req, res) => {
  if (!db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Contact not found' });
  if (!db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(req.params.ticketId)) return res.status(404).json({ error: 'Ticket not found' });
  db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id, added_by) VALUES (?, ?, ?)').run(req.params.ticketId, req.params.id, req.user.id);
  touchTicket(req.params.ticketId);
  res.json({ contact: one(req.params.id) });
});

/** Make a linked contact the ticket's primary contact (Pipedrive's deal contact person), or with `{ primary: false }` clear it. */
r.put('/:id/tickets/:ticketId/primary', ticketOwnerOnly, (req, res) => {
  if (!db.prepare('SELECT 1 FROM ticket_contacts WHERE ticket_id = ? AND contact_id = ?').get(req.params.ticketId, req.params.id)) {
    return res.status(404).json({ error: 'That contact isn’t on this ticket' });
  }
  db.transaction(() => {
    db.prepare('UPDATE ticket_contacts SET is_primary = 0 WHERE ticket_id = ?').run(req.params.ticketId);
    if (req.body?.primary !== false) db.prepare('UPDATE ticket_contacts SET is_primary = 1 WHERE ticket_id = ? AND contact_id = ?').run(req.params.ticketId, req.params.id);
  })();
  touchTicket(req.params.ticketId);
  res.json({ ok: true });
});

/** Take a contact off a ticket. They stay in the CRM. */
r.delete('/:id/tickets/:ticketId', ticketOwnerOnly, (req, res) => {
  db.prepare('DELETE FROM ticket_contacts WHERE ticket_id = ? AND contact_id = ?').run(req.params.ticketId, req.params.id);
  touchTicket(req.params.ticketId);
  res.json({ contact: one(req.params.id) });
});

export default r;
