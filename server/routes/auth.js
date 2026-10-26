import { Router } from 'express';
import { db } from '../db.js';
import {
  findUserByIdentifier, checkPassword, setSession, clearSession, requireAuth,
  publicUser, isApproved, hashPassword,
} from '../auth.js';
import { validateProfile } from './users.js';

const r = Router();

r.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const user = findUserByIdentifier(identifier);
  if (!user || !user.active || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!isApproved(user.email)) return res.status(403).json({ error: 'This account is not approved for access' });
  setSession(res, user);
  res.json({ user: publicUser(user) });
});

// First-time activation for an email an admin has approved.
r.post('/register', (req, res) => {
  const { password } = req.body || {};
  const { data, error } = validateProfile(req.body);
  if (error) return res.status(400).json({ error });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const approval = db.prepare('SELECT * FROM approved_accounts WHERE email = ?').get(data.email);
  if (!approval) return res.status(403).json({ error: 'That email has not been approved. Ask an admin for access.' });
  try {
    const info = db.prepare(`INSERT INTO users (first_name, last_name, email, phone, phone_digits, username, title, team_id, role, password_hash)
      VALUES (@first_name, @last_name, @email, @phone, @phone_digits, @username, @title, @team_id, @role, @password_hash)`)
      .run({ ...data, role: approval.role, password_hash: hashPassword(password) });
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    setSession(res, user);
    res.json({ user: publicUser(user) });
  } catch (e) {
    res.status(409).json({ error: uniqueMessage(e) });
  }
});

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

export function uniqueMessage(e) {
  const m = String(e.message);
  if (m.includes('users.email')) return 'That email is already registered';
  if (m.includes('users.username')) return 'That username is taken';
  if (m.includes('users.phone_digits')) return 'That phone number is already in use';
  return 'Could not save';
}

export default r;
