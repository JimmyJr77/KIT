// Events (conferences, industry days, …): details, who's attending, the trips planned for them,
// and marketing support requests, which the Marketing team turns into work tickets.
import { Router } from 'express';
import { db, json } from '../db.js';
import { marketingTeam, isMarketing, createRequest, acceptRequest } from './marketing.js';

const r = Router();

function eventsOut(rows) {
  const attendees = db.prepare(`SELECT a.event_id, u.id, u.first_name, u.last_name, u.title FROM event_attendees a
    JOIN users u ON u.id = a.user_id ORDER BY u.last_name, u.first_name`).all();
  const trips = db.prepare('SELECT event_id, COUNT(*) AS n FROM trips WHERE event_id IS NOT NULL GROUP BY event_id').all();
  const requests = db.prepare(`SELECT r.*, q.first_name AS req_first, q.last_name AS req_last, k.first_name AS acc_first, k.last_name AS acc_last,
      t.opportunity_title AS ticket_title
    FROM event_support_requests r LEFT JOIN users q ON q.id = r.requested_by LEFT JOIN users k ON k.id = r.accepted_by
    LEFT JOIN tickets t ON t.id = r.ticket_id ORDER BY r.created_at DESC, r.id DESC`).all();
  return rows.map((e) => ({
    ...e,
    location: json.parse(e.location, {}),
    attendees: attendees.filter((a) => a.event_id === e.id).map(({ event_id, ...u }) => u),
    trip_count: trips.find((t) => t.event_id === e.id)?.n || 0,
    support: requests.filter((x) => x.event_id === e.id).map((x) => ({
      id: x.id, details: x.details, status: x.status, created_at: x.created_at, accepted_at: x.accepted_at,
      ticket_id: x.ticket_id, ticket_title: x.ticket_title,
      requested_by: x.req_first ? { id: x.requested_by, first_name: x.req_first, last_name: x.req_last } : null,
      accepted_by: x.acc_first ? { id: x.accepted_by, first_name: x.acc_first, last_name: x.acc_last } : null,
    })),
  }));
}
const one = (id) => eventsOut(db.prepare('SELECT * FROM events WHERE id = ?').all(id))[0] || null;

function fields(b = {}) {
  const s = (v) => (v == null ? '' : String(v).trim());
  const f = {
    name: s(b.name),
    date_from: s(b.date_from),
    date_to: s(b.date_to) || s(b.date_from),
    description: s(b.description) || null,
    goal: s(b.goal) || null,
    fee: b.fee === '' || b.fee == null ? null : Number(b.fee),
    website: s(b.website) || null,
    poc_name: s(b.poc_name) || null,
    poc_phone: s(b.poc_phone) || null,
    address: s(b.address) || null,
    location: json.str(b.location && typeof b.location === 'object' ? b.location : {}),
  };
  if (!f.name) return { error: 'Event name is required' };
  if (!f.date_from) return { error: 'Date From is required' };
  if (f.date_to < f.date_from) return { error: 'Date To must be on or after Date From' };
  if (f.fee != null && (!Number.isFinite(f.fee) || f.fee < 0)) return { error: 'Fee must be a dollar amount' };
  if (f.website && !/^https?:\/\//i.test(f.website)) f.website = `https://${f.website}`;
  return { f };
}

// ---- Marketing support (shared with the Marketing page; see routes/marketing.js)

/** Who gets alerted for a request, and whether the signed-in user can take requests. */
r.get('/support-team', (req, res) => res.json({ team: marketingTeam(), canTake: isMarketing(req.user) }));

/** Ask Marketing for support at an event. Body: { details }. Everyone on the Marketing team gets an alert. */
r.post('/:id/support', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  const details = String(req.body?.details || '').trim();
  if (!details) return res.status(400).json({ error: 'Describe the support you need' });
  const { notified } = createRequest(req.user, { event_id: e.id, category: 'Event support', details });
  res.json({ event: one(e.id), notified });
});

/** Marketing takes a request: creates a work ticket for it, linked to the event. */
r.post('/support/:rid/accept', (req, res) => {
  const out = acceptRequest(req.user, req.params.rid, req.body?.title);
  if (out.error) return res.status(out.status).json({ error: out.error, ticket_id: out.ticket_id });
  res.json({ event: out.event_id ? one(out.event_id) : null, ticket_id: out.ticket_id });
});

/** scope: upcoming (default, ends today or later) | past | all. Soonest first, past ones most recent first. */
r.get('/', (req, res) => {
  const today = new Date().toLocaleDateString('en-CA');
  const scope = ['past', 'all'].includes(req.query.scope) ? req.query.scope : 'upcoming';
  const where = scope === 'upcoming' ? 'WHERE date_to >= ?' : scope === 'past' ? 'WHERE date_to < ?' : '';
  const order = scope === 'past' ? 'date_from DESC' : 'date_from ASC';
  const rows = db.prepare(`SELECT * FROM events ${where} ORDER BY ${order}, name`).all(...(where ? [today] : []));
  res.json({ events: eventsOut(rows) });
});

r.post('/', (req, res) => {
  const { f, error } = fields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare(`INSERT INTO events (name, date_from, date_to, description, goal, fee, website, poc_name, poc_phone, address, location, created_by)
    VALUES (@name, @date_from, @date_to, @description, @goal, @fee, @website, @poc_name, @poc_phone, @address, @location, @created_by)`)
    .run({ ...f, created_by: req.user.id }).lastInsertRowid;
  res.json({ event: one(id) });
});

r.put('/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Event not found' });
  const { f, error } = fields(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE events SET name=@name, date_from=@date_from, date_to=@date_to, description=@description, goal=@goal, fee=@fee,
    website=@website, poc_name=@poc_name, poc_phone=@poc_phone, address=@address, location=@location, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...f, id: Number(req.params.id) });
  res.json({ event: one(req.params.id) });
});

/** Only whoever added the event, or an admin, can delete it. */
r.delete('/:id', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  if (e.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only whoever added this event can delete it' });
  db.prepare('DELETE FROM events WHERE id = ?').run(e.id);
  res.json({ ok: true });
});

/** Sign yourself up as attending, or take yourself off. Body: { attending: boolean }. */
r.put('/:id/attending', (req, res) => {
  if (!db.prepare('SELECT 1 FROM events WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Event not found' });
  if (req.body?.attending) db.prepare('INSERT OR IGNORE INTO event_attendees (event_id, user_id) VALUES (?, ?)').run(req.params.id, req.user.id);
  else db.prepare('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ event: one(req.params.id) });
});

export default r;
