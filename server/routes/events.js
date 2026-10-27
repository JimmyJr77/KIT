// Events (conferences, industry days, …): details, who's attending, the trips planned for them,
// and marketing support requests, which the Marketing team turns into work tickets.
import { Router } from 'express';
import { db, json } from '../db.js';
import { recordWork } from '../worklog.js';

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

// ---- Marketing support

const MARKETING = 'Marketing';
const marketingTeam = () => db.prepare(`SELECT u.id, u.first_name, u.last_name FROM users u JOIN teams t ON t.id = u.team_id
  WHERE t.name = ? AND u.active = 1 ORDER BY u.last_name, u.first_name`).all(MARKETING);
/** Marketing can take support requests, and so can admins. */
const canTakeRequests = (user) => user.role === 'admin' || marketingTeam().some((u) => u.id === user.id);

const alertInsert = () => db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, event_id, request_id, excerpt)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

/** Who gets alerted for a request, and whether the signed-in user can take requests. */
r.get('/support-team', (req, res) => res.json({ team: marketingTeam(), canTake: canTakeRequests(req.user) }));

/** Ask Marketing for support at an event. Body: { details }. Everyone on the Marketing team gets an alert. */
r.post('/:id/support', (req, res) => {
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  const details = String(req.body?.details || '').trim();
  if (!details) return res.status(400).json({ error: 'Describe the support you need' });
  const rid = db.prepare('INSERT INTO event_support_requests (event_id, details, requested_by) VALUES (?, ?, ?)').run(e.id, details, req.user.id).lastInsertRowid;
  const alert = alertInsert();
  const team = marketingTeam().filter((u) => u.id !== req.user.id);
  team.forEach((u) => alert.run(u.id, req.user.id, 'support_request', null, e.id, rid, details.slice(0, 400)));
  res.json({ event: one(e.id), notified: team.length });
});

/**
 * Marketing takes a request: creates a work ticket for it, linked to the event, with the request as its first comment.
 * The requester gets an alert pointing at the new ticket.
 */
r.post('/support/:rid/accept', (req, res) => {
  const q = db.prepare('SELECT * FROM event_support_requests WHERE id = ?').get(req.params.rid);
  if (!q) return res.status(404).json({ error: 'Request not found' });
  if (q.status === 'accepted') return res.status(409).json({ error: 'Someone has already taken this request', ticket_id: q.ticket_id });
  if (!canTakeRequests(req.user)) return res.status(403).json({ error: 'Only the Marketing team can take support requests' });
  const e = db.prepare('SELECT * FROM events WHERE id = ?').get(q.event_id);
  const title = String(req.body?.title || '').trim() || `Marketing support: ${e.name}`;

  const ticketId = db.transaction(() => {
    const id = db.prepare(`INSERT INTO tickets (opportunity_title, ticket_type, event_id, created_by)
      VALUES (?, 'work', ?, ?)`).run(title, e.id, req.user.id).lastInsertRowid;
    db.prepare('INSERT INTO ticket_comments (ticket_id, kind, body, author_id) VALUES (?, ?, ?, ?)')
      .run(id, 'comment', `Marketing support requested for ${e.name}:\n${q.details}`, q.requested_by);
    db.prepare("UPDATE event_support_requests SET status = 'accepted', ticket_id = ?, accepted_by = ?, accepted_at = datetime('now') WHERE id = ?")
      .run(id, req.user.id, q.id);
    // The other Marketing alerts for this request are now handled.
    db.prepare("UPDATE alerts SET read_at = COALESCE(read_at, datetime('now')) WHERE request_id = ? AND kind = 'support_request'").run(q.id);
    if (q.requested_by && q.requested_by !== req.user.id) {
      alertInsert().run(q.requested_by, req.user.id, 'support_accepted', id, e.id, q.id, q.details.slice(0, 400));
    }
    return id;
  })();
  recordWork(req.user, { kind: 'ticket', ticket_id: ticketId, summary: title });
  res.json({ event: one(e.id), ticket_id: ticketId });
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
