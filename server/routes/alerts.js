// A user's alerts: @mentions (of them or of a team they're on), comments on tickets they own, support requests from Weekly Priorities and tickets made from yours, marketing support requests, travel requests to approve and their decisions, and being put on a won contract in Delivery. Ones about a priority come first,
// then the rest, each newest first.
import { Router } from 'express';
import { db, json } from '../db.js';
import { recentActions, unchanged, UNDO_HEADER } from '../actions.js';

const r = Router();

r.get('/', (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.first_name, u.last_name, t.opportunity_title AS ticket_title, t.ticket_type, c.title AS card_title,
      m.parent_id AS comment_parent_id, e.name AS event_name, e.date_from AS event_date_from, e.date_to AS event_date_to,
      q.status AS request_status, q.ticket_id AS request_ticket_id, q.title AS request_title, q.category AS request_category, q.due_date AS request_due_date, dp.name AS program_name, dp.organization AS program_organization,
      tr.approval AS trip_approval, tr.date_from AS trip_date_from, tr.location_to AS trip_location_to, te.name AS trip_event_name, tm.name AS team_name,
      (SELECT COUNT(*) FROM support_need_tickets st WHERE st.need_id = a.support_id) AS support_tickets
    FROM alerts a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN priority_cards c ON c.id = a.card_id LEFT JOIN ticket_comments m ON m.id = a.comment_id
    LEFT JOIN events e ON e.id = a.event_id LEFT JOIN event_support_requests q ON q.id = a.request_id
    LEFT JOIN delivery_programs dp ON dp.id = a.program_id
    LEFT JOIN trips tr ON tr.id = a.trip_id LEFT JOIN events te ON te.id = tr.event_id LEFT JOIN teams tm ON tm.id = a.team_id
    WHERE a.user_id = ? ORDER BY (a.card_id IS NULL), a.created_at DESC, a.id DESC LIMIT 200`).all(req.user.id);
  res.json({
    alerts: rows.map((a) => ({
      id: a.id, kind: a.kind, excerpt: a.excerpt, created_at: a.created_at, read: !!a.read_at,
      ticket_id: a.ticket_id, ticket_title: a.ticket_title, ticket_type: a.ticket_type, card_id: a.card_id, card_title: a.card_title,
      comment_id: a.comment_id, thread_id: a.comment_parent_id || a.comment_id, note_id: a.note_id,
      actor: a.first_name ? { id: a.actor_id, first_name: a.first_name, last_name: a.last_name } : null,
      event_id: a.event_id, event_name: a.event_name, event_date_from: a.event_date_from, event_date_to: a.event_date_to,
      request_id: a.request_id, request_status: a.request_status, request_ticket_id: a.request_ticket_id,
      request_title: a.request_title, request_category: a.request_category, request_due_date: a.request_due_date,
      program_id: a.program_id, program_name: a.program_name, program_organization: a.program_organization,
      trip_id: a.trip_id, trip_approval: a.trip_approval, trip_date_from: a.trip_date_from, trip_event_name: a.trip_event_name,
      trip_destination: a.trip_location_to ? json.parse(a.trip_location_to, {}) : null,
      support_id: a.support_id, support_tickets: a.support_tickets,
      team_name: a.team_name, // set when a mention reached them through this team rather than by name
    })),
  });
});

/** Your own recent actions (the last week), newest first, each saying whether it can still be undone. */
r.get('/actions', (req, res) => res.json({ actions: recentActions(req.user.id) }));

/**
 * Undo one of your own actions: its reversing request runs as you, through the route that made the change, so the same
 * rules apply and Pipedrive gets the reversal on the next send. Refused once the record has changed again.
 */
r.post('/actions/:id/undo', async (req, res, next) => {
  try {
    const a = db.prepare('SELECT * FROM user_actions WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!a) return res.status(404).json({ error: 'That action isn’t on your list' });
    if (a.undone_at) return res.status(400).json({ error: 'That was already undone' });
    if (!unchanged(json.parse(a.guard, null))) return res.status(409).json({ error: 'This has been changed again since, so it can’t be undone from here. Open the ticket to change it.' });
    const undo = json.parse(a.undo, null);
    const back = await fetch(`http://127.0.0.1:${req.socket.localPort}/api${undo.path}`, {
      method: undo.method,
      headers: { 'content-type': 'application/json', cookie: req.headers.cookie || '', [UNDO_HEADER]: '1' },
      body: undo.body ? JSON.stringify(undo.body) : undefined,
    });
    if (!back.ok) {
      const why = await back.json().catch(() => ({}));
      return res.status(back.status === 401 ? 500 : back.status).json({ error: why.error || 'Couldn’t undo that' });
    }
    db.prepare("UPDATE user_actions SET undone_at = datetime('now') WHERE id = ?").run(a.id);
    res.json({ actions: recentActions(req.user.id) });
  } catch (e) { next(e); }
});

r.get('/unread', (req, res) => {
  res.json({ count: db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n });
});

r.put('/read-all', (req, res) => {
  db.prepare("UPDATE alerts SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

r.put('/:id/read', (req, res) => {
  db.prepare("UPDATE alerts SET read_at = COALESCE(read_at, datetime('now')) WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default r;
