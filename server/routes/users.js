import { Router } from 'express';
import { db, json, setUserTeams, setTeamRole, setMembershipFlags, isTeamLead, withTeams } from '../db.js';
import { requireAdmin, publicUser, formatPhone, digitsOnly, checkPassword, hashPassword } from '../auth.js';
import { uniqueMessage } from './auth.js';
import { flightPrefs, flightLimitsChanged } from '../../src/lib/travelCalc.js';
import { cleanHiddenNav } from '../../src/lib/sidebar.js';

const r = Router();

export function validateProfile(body = {}) {
  const s = (v) => (v == null ? '' : String(v).trim());
  const data = {
    first_name: s(body.first_name),
    last_name: s(body.last_name),
    email: s(body.email).toLowerCase(),
    username: s(body.username),
    title: s(body.title) || null,
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

/** The teams in a profile body: team_ids, or a single team_id from older clients. Undefined when neither is sent. */
export function teamIdsFrom(body = {}) {
  if (Array.isArray(body.team_ids)) return body.team_ids.map(Number).filter(Boolean);
  if (body.team_id !== undefined) return body.team_id ? [Number(body.team_id)] : [];
  return undefined;
}

const LIST_SQL = 'SELECT u.* FROM users u';

r.get('/', (req, res) => {
  const rows = db.prepare(`${LIST_SQL} WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all();
  res.json({ users: withTeams(rows).map(publicUser) });
});

function updateUser(id, body, res, { allowRole }) {
  const { data, error } = validateProfile(body);
  if (error) return res.status(400).json({ error });
  const role = allowRole && ['admin', 'member'].includes(body.role) ? body.role : undefined;
  // The Developer role is a flag beside the site role; only admins set it, and leaving it out keeps it as it was.
  const developer = allowRole && body.developer !== undefined ? (body.developer ? 1 : 0) : undefined;
  try {
    db.prepare(`UPDATE users SET first_name=@first_name, last_name=@last_name, email=@email, phone=@phone,
      phone_digits=@phone_digits, username=@username, title=@title
      ${role ? ', role=@role' : ''}${developer !== undefined ? ', developer=@developer' : ''} WHERE id=@id`)
      .run({ ...data, id, ...(role ? { role } : {}), ...(developer !== undefined ? { developer } : {}) });
    const teamIds = teamIdsFrom(body);
    if (teamIds) setUserTeams(id, teamIds);
    res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(id))) });
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

/**
 * Where you usually travel from and your flight limits, filled into your new trips. Body: { location, airport, flight },
 * or { declined: true } when you'd rather not keep one; either way you aren't asked again after your first trip.
 * Leaving out `flight` keeps the limits already saved.
 */
r.put('/me/travel-from', (req, res) => {
  const b = req.body || {};
  const l = b.location && typeof b.location === 'object' ? b.location : {};
  const value = b.declined ? null : {
    location: { intl: !!l.intl, city: String(l.city || '').trim(), state: String(l.state || '').trim(), country: String(l.country || '').trim() || 'United States' },
    airport: String(b.airport || '').trim(),
    flight: flightPrefs(b.flight ?? json.parse(req.user.travel_from, {}).flight),
  };
  db.prepare('UPDATE users SET travel_from = ?, travel_from_asked = 1 WHERE id = ?')
    .run(value && (value.location.city || value.airport || flightLimitsChanged(value.flight)) ? JSON.stringify(value) : null, req.user.id);
  res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(req.user.id))) });
});

/** Body: { hidden: [path] }. The sidebar pages you'd rather not see in your sidebar; they stay under More. */
r.put('/me/sidebar', (req, res) => {
  if (!Array.isArray(req.body?.hidden)) return res.status(400).json({ error: 'hidden must be a list' });
  db.prepare('UPDATE users SET hidden_nav = ? WHERE id = ?').run(JSON.stringify(cleanHiddenNav(req.body.hidden)), req.user.id);
  res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(req.user.id))) });
});

/** Body: { on: boolean }. Focus narrows the main pages to what you're tied to or mentioned in (see server/focus.js). */
r.put('/me/focus', (req, res) => {
  if (typeof req.body?.on !== 'boolean') return res.status(400).json({ error: 'on must be true or false' });
  db.prepare('UPDATE users SET focus = ? WHERE id = ?').run(req.body.on ? 1 : 0, req.user.id);
  res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(req.user.id))) });
});

r.put('/me/password', (req, res) => {
  const { current, next } = req.body || {};
  if (!checkPassword(current, req.user.password_hash)) return res.status(400).json({ error: 'Current password is incorrect' });
  if (!next || next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  res.json({ ok: true });
});

r.put('/:id', requireAdmin, (req, res) => updateUser(Number(req.params.id), req.body, res, { allowRole: true }));

/** Body: { role: 'member' | 'lead' }. Site admins can set it on any team; a team's lead can set it on their own team. */
r.put('/:id/teams/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  if (req.user.role !== 'admin' && !isTeamLead(req.user.id, teamId)) return res.status(403).json({ error: 'Only an admin or this team\'s lead can change that' });
  if (!['member', 'lead'].includes(req.body?.role)) return res.status(400).json({ error: 'Role must be member or lead' });
  if (!setTeamRole(Number(req.params.id), teamId, req.body.role)) return res.status(404).json({ error: 'They aren\'t on that team' });
  res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(req.params.id))) });
});

/**
 * What someone's place on a team counts toward. Body: any of { in_numbers, in_priorities, in_travel } (true/false).
 * Admins and the team's leads (the BD Team page).
 */
r.put('/:id/teams/:teamId/flags', (req, res) => {
  const teamId = Number(req.params.teamId);
  if (req.user.role !== 'admin' && !isTeamLead(req.user.id, teamId)) return res.status(403).json({ error: 'Only an admin or this team\'s lead can change that' });
  if (!setMembershipFlags(Number(req.params.id), teamId, req.body)) return res.status(404).json({ error: 'They aren\'t on that team' });
  res.json({ user: publicUser(withTeams(db.prepare(`${LIST_SQL} WHERE u.id = ?`).get(req.params.id))) });
});

r.delete('/:id', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: "You can't deactivate yourself" });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Approved accounts (admin) ----
r.get('/approved', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT a.*, u.id AS account_id, u.active, u.pending_activation, u.first_name, u.last_name, u.developer AS account_developer
    FROM approved_accounts a LEFT JOIN users u ON u.email = a.email ORDER BY a.email`).all();
  // Anyone with an account, even a deactivated one, keeps their teams on it (that's where PUT saves them);
  // only emails never activated keep them on the approval. Site Dev (developer) works the same way. user_id is set for active accounts only; an account the
  // Pipedrive sync made counts as waiting until its person activates it.
  const teams = new Map(withTeams(rows.filter((a) => a.account_id).map((a) => ({ id: a.account_id }))).map((u) => [u.id, u.team_ids]));
  res.json({
    approved: rows.map(({ account_id, active, pending_activation, account_developer, ...a }) => ({
      ...a, user_id: active && !pending_activation ? account_id : null, team_ids: account_id ? teams.get(account_id) : json.parse(a.team_ids, []),
      developer: account_id ? account_developer : a.developer,
    })),
  });
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

/** Body: { team_ids?, developer? }. Sets the teams and Site Dev of whoever has (or will activate) this approved email; what's left out stays as it was. */
r.put('/approved/:email', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM approved_accounts WHERE email = ?').get(req.params.email);
  if (!a) return res.status(404).json({ error: 'That email is not approved' });
  const ids = teamIdsFrom(req.body);
  const developer = req.body?.developer === undefined ? undefined : (req.body.developer ? 1 : 0);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(a.email);
  if (ids) {
    if (user) setUserTeams(user.id, ids);
    else db.prepare('UPDATE approved_accounts SET team_ids = ? WHERE email = ?').run(json.str(ids), a.email);
  }
  if (developer !== undefined) {
    db.prepare(user ? 'UPDATE users SET developer = ? WHERE id = ?' : 'UPDATE approved_accounts SET developer = ? WHERE email = ?').run(developer, user ? user.id : a.email);
  }
  res.json({ ok: true });
});

r.delete('/approved/:email', requireAdmin, (req, res) => {
  if (req.params.email.toLowerCase() === req.user.email.toLowerCase()) {
    return res.status(400).json({ error: "You can't revoke your own access" });
  }
  db.prepare('DELETE FROM approved_accounts WHERE email = ?').run(req.params.email);
  res.json({ ok: true });
});

// ---- Access requests from the sign-in page (admin) ----
r.get('/access-requests', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT q.*, h.first_name AS h_first_name, h.last_name AS h_last_name FROM access_requests q
    LEFT JOIN users h ON h.id = q.handled_by
    WHERE q.status = 'pending' OR q.handled_at >= datetime('now', '-30 days')
    ORDER BY q.status != 'pending', COALESCE(q.handled_at, q.created_at) DESC`).all();
  res.json({
    requests: rows.map(({ h_first_name, h_last_name, ...q }) => ({ ...q, handled_by: h_first_name ? { id: q.handled_by, first_name: h_first_name, last_name: h_last_name } : null })),
    pending: rows.filter((q) => q.status === 'pending').length,
  });
});

/** Approve adds the email to approved accounts so the person can activate it; decline just closes the request. */
r.post('/access-requests/:id/:action', requireAdmin, (req, res) => {
  const q = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Request not found' });
  if (q.status !== 'pending') return res.status(409).json({ error: 'This request has already been handled' });
  const action = req.params.action;
  if (action !== 'approve' && action !== 'decline') return res.status(400).json({ error: 'Unknown action' });
  db.transaction(() => {
    if (action === 'approve') {
      const role = req.body?.role === 'admin' ? 'admin' : 'member';
      db.prepare(`INSERT INTO approved_accounts (email, role, added_by) VALUES (?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET role = excluded.role`).run(q.email, role, req.user.id);
      db.prepare('UPDATE users SET active = 1 WHERE email = ?').run(q.email);
    }
    db.prepare("UPDATE access_requests SET status = ?, handled_by = ?, handled_at = datetime('now') WHERE id = ?")
      .run(action === 'approve' ? 'approved' : 'declined', req.user.id, q.id);
  })();
  res.json({ ok: true });
});

export default r;
