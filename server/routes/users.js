import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin, publicUser, formatPhone, digitsOnly, checkPassword, hashPassword } from '../auth.js';
import { uniqueMessage } from './auth.js';

const r = Router();

export function validateProfile(body = {}) {
  const s = (v) => (v == null ? '' : String(v).trim());
  const data = {
    first_name: s(body.first_name),
    last_name: s(body.last_name),
    email: s(body.email).toLowerCase(),
    username: s(body.username),
    title: s(body.title) || null,
    team_id: body.team_id ? Number(body.team_id) : null,
    phone: null,
    phone_digits: null,
  };
  if (!data.first_name || !data.last_name) return { error: 'First and last name are required' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return { error: 'A valid email is required' };
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(data.username)) return { error: 'Username must be 3-32 letters, numbers, dot, dash or underscore' };
  if (s(body.phone)) {
    data.phone = formatPhone(body.phone);
    if (!data.phone) return { error: 'Phone number must have 10 digits' };
    data.phone_digits = digitsOnly(data.phone);
  }
  return { data };
}

const LIST_SQL = `SELECT u.*, t.name AS team_name FROM users u LEFT JOIN teams t ON t.id = u.team_id`;

r.get('/', (req, res) => {
  const rows = db.prepare(`${LIST_SQL} WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all();
  res.json({ users: rows.map(publicUser) });
});

function updateUser(id, body, res, { allowRole }) {
  const { data, error } = validateProfile(body);
  if (error) return res.status(400).json({ error });
  const role = allowRole && ['admin', 'member'].includes(body.role) ? body.role : undefined;
  try {
    db.prepare(`UPDATE users SET first_name=@first_name, last_name=@last_name, email=@email, phone=@phone,
      phone_digits=@phone_digits, username=@username, title=@title, team_id=@team_id
      ${role ? ', role=@role' : ''} WHERE id=@id`).run({ ...data, id, ...(role ? { role } : {}) });
    res.json({ user: publicUser(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(id)) });
  } catch (e) {
    res.status(409).json({ error: uniqueMessage(e) });
  }
}

r.put('/me', (req, res) => {
  // If the email changes it must still be on the approved list.
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email && email !== req.user.email.toLowerCase() &&
      !db.prepare('SELECT 1 FROM approved_accounts WHERE email = ?').get(email)) {
    return res.status(403).json({ error: 'New email must be approved by an admin first' });
  }
  updateUser(req.user.id, req.body, res, { allowRole: false });
});

r.put('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!checkPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

r.put('/:id', requireAdmin, (req, res) => updateUser(Number(req.params.id), req.body, res, { allowRole: true }));

r.delete('/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself" });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Approved accounts (admin) ----
r.get('/approved', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.id AS user_id, u.first_name, u.last_name
    FROM approved_accounts a LEFT JOIN users u ON u.email = a.email AND u.active = 1 ORDER BY a.email`).all();
  res.json({ approved: rows });
});

r.post('/approved', requireAdmin, (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'member';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
  db.prepare(`INSERT INTO approved_accounts (email, role, added_by) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET role = excluded.role`).run(email, role, req.user.id);
  db.prepare('UPDATE users SET active = 1 WHERE email = ?').run(email);
  res.json({ ok: true });
});

r.delete('/approved/:email', requireAdmin, (req, res) => {
  if (req.params.email.toLowerCase() === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't revoke your own access" });
  }
  db.prepare('DELETE FROM approved_accounts WHERE email = ?').run(req.params.email);
  res.json({ ok: true });
});

export default r;
