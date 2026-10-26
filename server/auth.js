import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const COOKIE = 'kit_session';

export const digitsOnly = (s) => String(s || '').replace(/\D/g, '');

export function formatPhone(s) {
  let d = digitsOnly(s);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return null;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, phone_digits, ...rest } = u;
  return rest;
}

/** Resolve a login identifier that may be an email, phone number, or username. */
export function findUserByIdentifier(identifier) {
  const id = String(identifier || '').trim();
  if (!id) return null;
  if (id.includes('@')) return db.prepare('SELECT * FROM users WHERE email = ?').get(id);
  const digits = digitsOnly(id);
  if (/^[\d\s().+-]+$/.test(id) && digits.length >= 10) {
    const d = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    return db.prepare('SELECT * FROM users WHERE phone_digits = ?').get(d);
  }
  return db.prepare('SELECT * FROM users WHERE username = ?').get(id); // COLLATE NOCASE
}

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw || '', hash);

export function setSession(res, user) {
  const token = jwt.sign({ uid: user.id }, SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

const isApproved = (email) => !!db.prepare('SELECT 1 FROM approved_accounts WHERE email = ?').get(email);

export function requireAuth(req, res, next) {
  try {
    const { uid } = jwt.verify(req.cookies?.[COOKIE] || '', SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(uid);
    if (!user || !isApproved(user.email)) return res.status(401).json({ error: 'Not authenticated' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

export { isApproved };
