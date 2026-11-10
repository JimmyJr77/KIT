// Support requests from Weekly Priorities: the help someone needs with a priority, asked from inside it. Everyone @mentioned in a
// request, one by one or as a whole team ("@Marketing"), gets an alert. Anyone can turn a request into a work ticket.
// When one already exists they're told so and can open it or make their own, so a request can have several tickets.
import { Router } from 'express';
import { db } from '../db.js';
import { recordWork } from '../worklog.js';
import { mentionedPeople } from '../mentions.js';

const r = Router();

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const person = (id, first, last) => (first ? { id, first_name: first, last_name: last } : null);

/** Requests with who asked, the priority they're for, and the tickets made from them. */
function withDetails(rows) {
  if (!rows.length) return [];
  const tickets = db.prepare(`SELECT st.need_id, st.created_at, t.id, t.opportunity_title, u.id AS uid, u.first_name, u.last_name
    FROM support_need_tickets st JOIN tickets t ON t.id = st.ticket_id LEFT JOIN users u ON u.id = st.created_by
    WHERE st.need_id IN (SELECT value FROM json_each(?)) ORDER BY st.created_at, t.id`).all(JSON.stringify(rows.map((n) => n.id)));
  return rows.map((n) => ({
    id: n.id, body: n.body, created_at: n.created_at, closed_at: n.closed_at,
    requester: person(n.requested_by, n.req_first, n.req_last),
    card: n.card_id ? { id: n.card_id, title: n.card_title, ticket_id: n.card_ticket_id, ticket_title: n.card_ticket_title, activity_id: n.card_activity_id } : null,
    tickets: tickets.filter((t) => t.need_id === n.id)
      .map((t) => ({ id: t.id, title: t.opportunity_title, created_at: t.created_at, created_by: person(t.uid, t.first_name, t.last_name) })),
  }));
}
const SELECT = `SELECT n.*, u.first_name AS req_first, u.last_name AS req_last, c.title AS card_title, c.ticket_id AS card_ticket_id,
    c.activity_id AS card_activity_id, t.opportunity_title AS card_ticket_title
  FROM support_needs n LEFT JOIN users u ON u.id = n.requested_by LEFT JOIN priority_cards c ON c.id = n.card_id
  LEFT JOIN tickets t ON t.id = c.ticket_id`;
const one = (id) => withDetails(db.prepare(`${SELECT} WHERE n.id = ?`).all(id))[0];

/**
 * Each card's support requests (open first), keyed by card id. A request asked on a card stays with the priority when
 * it rolls into the next week (the new card shares its activity), showing on every week it was open in.
 */
export function supportForCards(cards) {
  const out = new Map(cards.map((c) => [c.id, []]));
  if (!cards.length) return out;
  const acts = cards.map((c) => c.activity_id).filter(Boolean);
  const rows = withDetails(db.prepare(`${SELECT} WHERE n.card_id IN (SELECT value FROM json_each(?)) OR c.activity_id IN (SELECT value FROM json_each(?))
    ORDER BY (n.closed_at IS NOT NULL), n.created_at DESC`).all(JSON.stringify(cards.map((c) => c.id)), JSON.stringify(acts)));
  for (const c of cards) {
    const end = addDays(c.week_start, 6);
    out.set(c.id, rows.filter((n) => (n.card.id === c.id || (c.activity_id && n.card.activity_id === c.activity_id))
      && n.created_at.slice(0, 10) <= end && (!n.closed_at || n.closed_at.slice(0, 10) >= c.week_start)));
  }
  return out;
}

/** A priority card's support requests: GET /support?card=ID. */
r.get('/', (req, res) => {
  const card = db.prepare('SELECT id, activity_id, week_start FROM priority_cards WHERE id = ?').get(Number(req.query.card));
  if (!card) return res.status(404).json({ error: 'Priority not found' });
  res.json({ requests: supportForCards([card]).get(card.id) });
});

const alertInsert = () => db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, card_id, support_id, excerpt)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

/** Body: { body, card_id }. Alerts everyone it mentions, but not the person asking. */
r.post('/', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Say what support you need' });
  const card = Number(req.body?.card_id) ? db.prepare('SELECT id, ticket_id FROM priority_cards WHERE id = ?').get(Number(req.body.card_id)) : null;
  if (!card) return res.status(400).json({ error: 'Ask for support from inside a priority' });
  const people = mentionedPeople(body).filter((u) => u.id !== req.user.id);
  const id = db.transaction(() => {
    const newId = db.prepare('INSERT INTO support_needs (body, requested_by, card_id) VALUES (?, ?, ?)').run(body, req.user.id, card?.id ?? null).lastInsertRowid;
    const alert = alertInsert();
    people.forEach((u) => alert.run(u.id, req.user.id, 'support_need', card?.ticket_id ?? null, card?.id ?? null, newId, body.slice(0, 400)));
    return newId;
  })();
  res.json({ request: one(id), notified: people.length });
});

r.get('/:id', (req, res) => {
  const n = one(req.params.id);
  if (!n) return res.status(404).json({ error: 'This support request was deleted' });
  res.json({ request: n });
});

const mine = (n, user) => n.requested_by === user.id || user.role === 'admin';

/** Body: { body?, closed? }. Only the requester (or an admin) changes a request. Newly mentioned people are alerted. */
r.put('/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM support_needs WHERE id = ?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Not found' });
  if (!mine(n, req.user)) return res.status(403).json({ error: 'Only the person who asked can change this request' });
  const b = req.body || {};
  db.transaction(() => {
    if (typeof b.closed === 'boolean') db.prepare(`UPDATE support_needs SET closed_at = ${b.closed ? "COALESCE(closed_at, datetime('now'))" : 'NULL'} WHERE id = ?`).run(n.id);
    const body = typeof b.body === 'string' ? b.body.trim() : null;
    if (body && body !== n.body) {
      db.prepare('UPDATE support_needs SET body = ? WHERE id = ?').run(body, n.id);
      const before = new Set(mentionedPeople(n.body).map((u) => u.id));
      const card = n.card_id ? db.prepare('SELECT ticket_id FROM priority_cards WHERE id = ?').get(n.card_id) : null;
      const alert = alertInsert();
      mentionedPeople(body).filter((u) => u.id !== req.user.id && !before.has(u.id))
        .forEach((u) => alert.run(u.id, req.user.id, 'support_need', card?.ticket_id ?? null, n.card_id, n.id, body.slice(0, 400)));
    }
  })();
  res.json({ request: one(n.id) });
});

r.delete('/:id', (req, res) => {
  const n = db.prepare('SELECT * FROM support_needs WHERE id = ?').get(req.params.id);
  if (!n) return res.json({ ok: true });
  if (!mine(n, req.user)) return res.status(403).json({ error: 'Only the person who asked can delete this request' });
  db.prepare('DELETE FROM support_needs WHERE id = ?').run(n.id); // its alerts go with it; tickets made from it stay
  res.json({ ok: true });
});

/**
 * Turn a request into a work ticket. Body: { title?, force? }. When tickets already exist and `force` isn't set, it
 * answers 409 with them, so the person can open one or confirm they want their own. The new ticket starts with the
 * request as its first comment, from the person who asked, and they get an alert.
 */
r.post('/:id/tickets', (req, res) => {
  const n = db.prepare('SELECT * FROM support_needs WHERE id = ?').get(req.params.id);
  if (!n) return res.status(404).json({ error: 'This support request was deleted' });
  const existing = one(n.id).tickets;
  if (existing.length && !req.body?.force) {
    return res.status(409).json({ error: `A ticket was already made from this request${existing.length > 1 ? ` (${existing.length} tickets)` : ''}`, tickets: existing });
  }
  const firstLine = n.body.split('\n')[0].replace(/\s+/g, ' ').trim();
  const title = String(req.body?.title || '').trim() || `Support: ${firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine}`;
  const card = n.card_id ? db.prepare('SELECT c.title, t.opportunity_title FROM priority_cards c JOIN tickets t ON t.id = c.ticket_id WHERE c.id = ?').get(n.card_id) : null;
  const requester = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(n.requested_by);
  const header = `Support requested by ${requester ? `${requester.first_name} ${requester.last_name}` : 'someone'}${card ? ` for the priority “${card.title}” (${card.opportunity_title})` : ''}:`;
  const ticketId = db.transaction(() => {
    const id = db.prepare("INSERT INTO tickets (opportunity_title, ticket_type, created_by) VALUES (?, 'work', ?)").run(title, req.user.id).lastInsertRowid;
    db.prepare("INSERT INTO ticket_comments (ticket_id, kind, body, author_id) VALUES (?, 'comment', ?, ?)").run(id, `${header}\n${n.body}`, n.requested_by);
    db.prepare('INSERT INTO support_need_tickets (need_id, ticket_id, created_by) VALUES (?, ?, ?)').run(n.id, id, req.user.id);
    if (n.requested_by !== req.user.id) alertInsert().run(n.requested_by, req.user.id, 'support_ticket', id, null, n.id, n.body.slice(0, 400));
    return id;
  })();
  recordWork(req.user, { kind: 'ticket', ticket_id: ticketId, summary: title });
  res.json({ ticket_id: ticketId, request: one(n.id) });
});

export default r;
