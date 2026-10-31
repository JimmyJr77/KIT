import { Router } from 'express';
import { db, json, setUserTeams, withTeams } from '../db.js';
import {
  findUserByIdentifier, checkPassword, setSession, clearSession, requireAuth,
  publicUser, isApproved, hashPassword,
} from '../auth.js';
import { validateProfile, teamIdsFrom } from './users.js';

const r = Router();

r.post('/login', (req, res) => {
  const { identifier, password } = req.body || {};
  const user = findUserByIdentifier(identifier);
  if (!user || !user.active || !checkPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (!isApproved(user.email)) return res.status(403).json({ error: 'This account is not approved for access' });
  setSession(res, user);
  res.json({ user: publicUser(withTeams(user)) });
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
    const info = db.prepare(`INSERT INTO users (first_name, last_name, email, phone, phone_digits, username, title, role, password_hash)
      VALUES (@first_name, @last_name, @email, @phone, @phone_digits, @username, @title, @role, @password_hash)`)
      .run({ ...data, role: approval.role, password_hash: hashPassword(password) });
    // Teams an admin assigned to the approved email come first, then any the person picked.
    setUserTeams(info.lastInsertRowid, [...json.parse(approval.team_ids, []), ...(teamIdsFrom(req.body) || [])]);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    setSession(res, user);
    res.json({ user: publicUser(withTeams(user)) });
  } catch (e) {
    res.status(409).json({ error: uniqueMessage(e) });
  }
});

// Anyone can ask for access from the sign-in page; admins see it under Admin Access.
// A light per-address limit keeps the open form from being flooded.
const recentRequests = new Map();
r.post('/request-access', (req, res) => {
  const b = req.body || {};
  const first = String(b.first_name || '').trim().slice(0, 80);
  const last = String(b.last_name || '').trim().slice(0, 80);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const reason = String(b.reason || '').trim().slice(0, 1000);
  if (!first || !last) return res.status(400).json({ error: 'First and last name are required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  const hourAgo = Date.now() - 3600000;
  const hits = (recentRequests.get(req.ip) || []).filter((t) => t > hourAgo);
  if (hits.length >= 5) return res.status(429).json({ error: 'Too many requests. Try again later.' });
  recentRequests.set(req.ip, [...hits, Date.now()]);
  if (isApproved(email)) return res.json({ ok: true, approved: true });
  // One open request per email: asking again updates it.
  const open = db.prepare("SELECT id FROM access_requests WHERE email = ? AND status = 'pending'").get(email);
  if (open) {
    db.prepare("UPDATE access_requests SET first_name = ?, last_name = ?, reason = ?, created_at = datetime('now') WHERE id = ?").run(first, last, reason, open.id);
  } else {
    db.prepare('INSERT INTO access_requests (first_name, last_name, email, reason) VALUES (?, ?, ?, ?)').run(first, last, email, reason);
  }
  res.json({ ok: true });
});

r.post('/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(withTeams(req.user)) }));

export function uniqueMessage(e) {
  const m = String(e.message);
  if (m.includes('users.email')) return 'That email is already registered';
  if (m.includes('users.username')) return 'That username is taken';
  if (m.includes('users.phone_digits')) return 'That phone number is already in use';
  return 'Could not save';
}

export default r;
