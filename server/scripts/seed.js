// Seeds the initial admin account (and optional demo users with --demo).
import 'dotenv/config';
import { db } from '../db.js';
import { hashPassword, formatPhone, digitsOnly } from '../auth.js';

const teamId = (name) => db.prepare('SELECT id FROM teams WHERE name = ?').get(name).id;

if (process.env.NODE_ENV === 'production' &&
    (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD ||
     process.env.ADMIN_PASSWORD === 'ChangeMe123!' || process.env.ADMIN_PASSWORD.length < 12)) {
  throw new Error('Production seeding requires ADMIN_EMAIL and a non-default ADMIN_PASSWORD of at least 12 characters.');
}
if (process.env.NODE_ENV === 'production' && process.argv.includes('--demo')) {
  throw new Error('Demo accounts cannot be seeded in production.');
}

function ensureUser({ first_name, last_name, email, username, phone, title, team, role = 'member', password }) {
  db.prepare('INSERT OR IGNORE INTO approved_accounts (email, role) VALUES (?, ?)').run(email, role);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return console.log(`exists: ${email}`);
  const p = formatPhone(phone);
  db.prepare(`INSERT INTO users (first_name, last_name, email, phone, phone_digits, username, title, team_id, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(first_name, last_name, email, p, p ? digitsOnly(p) : null, username, title, teamId(team), role, hashPassword(password));
  console.log(`created: ${email} (${username})`);
}

ensureUser({
  first_name: process.env.ADMIN_FIRST_NAME || 'KIT',
  last_name: process.env.ADMIN_LAST_NAME || 'Admin',
  email: process.env.ADMIN_EMAIL || 'admin@knexus.local',
  username: process.env.ADMIN_USERNAME || 'admin',
  phone: process.env.ADMIN_PHONE || '',
  title: 'Head of Growth',
  team: 'BD',
  role: 'admin',
  password: process.env.ADMIN_PASSWORD || 'ChangeMe123!',
});

if (process.argv.includes('--demo')) {
  const demo = [
    ['Avery', 'Collins', 'BD Director'], ['Jordan', 'Reyes', 'BD Director'], ['Taylor', 'Nguyen', 'BD Director'],
    ['Morgan', 'Patel', 'BD Director'], ['Casey', 'Brooks', 'BD Director'], ['Riley', 'Kim', 'BD Director'],
  ];
  demo.forEach(([f, l, title], i) => ensureUser({
    first_name: f, last_name: l, title, team: 'BD',
    email: `${f}.${l}@knexus.local`.toLowerCase(),
    username: `${f[0]}${l}`.toLowerCase(),
    phone: `555010${String(i).padStart(4, '0')}`,
    password: 'ChangeMe123!',
  }));
}
