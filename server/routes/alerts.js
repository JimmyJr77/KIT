// A user's alerts: @mentions (of them or of a team they're on), comments on tickets they own, support requests from Weekly Priorities and tickets made from yours, marketing support requests, travel requests to approve and their decisions, and being put on a won contract in Delivery. Ones about a priority come first,
// then the rest, each newest first.
import { Router } from 'express';
import { db, json } from '../db.js';
import { recentActions, unchanged, UNDO_HEADER } from '../actions.js';
import { ALERT_SQL, shapeAlert, alertEmail, alertChat, sendEmail, deliveryStatus } from '../services/alertDelivery.js';
import { postChat } from '../services/googleChat.js';

const r = Router();

function delivery(userId) {
  const u = db.prepare('SELECT email, alert_email, alert_chat, chat_space FROM users WHERE id = ?').get(userId);
  return { address: u.email, email: !!u.alert_email, chat: !!u.alert_chat, chat_connected: !!u.chat_space, server: deliveryStatus() };
}

r.get('/', (req, res) => {
  const rows = db.prepare(`${ALERT_SQL} WHERE a.user_id = ? ORDER BY (a.card_id IS NULL), a.created_at DESC, a.id DESC LIMIT 200`).all(req.user.id);
  res.json({ alerts: rows.map(shapeAlert) });
});

/** Where your alerts also go (email, Google Chat): your own switches, and whether this server sends on each. */
r.get('/delivery', (req, res) => res.json(delivery(req.user.id)));

/** Body: { email?: boolean, chat?: boolean }. Your own switches for alerts by email and in Google Chat. */
r.put('/delivery', (req, res) => {
  const { email, chat } = req.body || {};
  if ([email, chat].some((v) => v !== undefined && typeof v !== 'boolean') || (email === undefined && chat === undefined)) return res.status(400).json({ error: 'email and chat must be true or false' });
  if (email !== undefined) db.prepare('UPDATE users SET alert_email = ? WHERE id = ?').run(email ? 1 : 0, req.user.id);
  if (chat !== undefined) db.prepare('UPDATE users SET alert_chat = ? WHERE id = ?').run(chat ? 1 : 0, req.user.id);
  res.json(delivery(req.user.id));
});

/** Send yourself a sample alert on one channel ({ channel: 'email' | 'chat' }), to see that it arrives. */
r.post('/delivery/test', async (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const sample = [{ kind: 'mention', actor: { first_name: 'KIT', last_name: '' }, ticket_title: 'a test ticket', comment_id: 0, excerpt: 'This is a test alert. Real ones look like this.' }];
  try {
    if (req.body?.channel === 'chat') {
      if (!u.chat_space) return res.status(400).json({ error: 'Open the KIT app in Google Chat first, so there’s somewhere to send it' });
      await postChat(u.chat_space, alertChat(sample));
    } else {
      await sendEmail(u.email, alertEmail(sample));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
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
