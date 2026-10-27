// A user's alerts: @mentions, marketing support requests for events, and being put on a won contract in Delivery. Ones about a priority come first,
// then the rest, each newest first.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();

r.get('/', (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.first_name, u.last_name, t.opportunity_title AS ticket_title, t.ticket_type, c.title AS card_title,
      m.parent_id AS comment_parent_id, e.name AS event_name, e.date_from AS event_date_from, e.date_to AS event_date_to,
      q.status AS request_status, q.ticket_id AS request_ticket_id, dp.name AS program_name, dp.organization AS program_organization
    FROM alerts a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN priority_cards c ON c.id = a.card_id LEFT JOIN ticket_comments m ON m.id = a.comment_id
    LEFT JOIN events e ON e.id = a.event_id LEFT JOIN event_support_requests q ON q.id = a.request_id
    LEFT JOIN delivery_programs dp ON dp.id = a.program_id
    WHERE a.user_id = ? ORDER BY (a.card_id IS NULL), a.created_at DESC, a.id DESC LIMIT 200`).all(req.user.id);
  res.json({
    alerts: rows.map((a) => ({
      id: a.id, kind: a.kind, excerpt: a.excerpt, created_at: a.created_at, read: !!a.read_at,
      ticket_id: a.ticket_id, ticket_title: a.ticket_title, ticket_type: a.ticket_type, card_id: a.card_id, card_title: a.card_title,
      comment_id: a.comment_id, thread_id: a.comment_parent_id || a.comment_id, note_id: a.note_id,
      actor: a.first_name ? { id: a.actor_id, first_name: a.first_name, last_name: a.last_name } : null,
      event_id: a.event_id, event_name: a.event_name, event_date_from: a.event_date_from, event_date_to: a.event_date_to,
      request_id: a.request_id, request_status: a.request_status, request_ticket_id: a.request_ticket_id,
      program_id: a.program_id, program_name: a.program_name, program_organization: a.program_organization,
    })),
  });
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
