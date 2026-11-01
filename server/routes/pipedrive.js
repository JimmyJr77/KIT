// Pipedrive for everyone: pull deals into KIT (admins everything, team leads their teams' deals, members their own),
// and for admins only, send chosen KIT changes to Pipedrive.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { startPull, lastPull, syncStatus } from '../services/pipedrive.js';
import { startSend, lastSend, preview, linkedTickets, SEND_KINDS } from '../services/pipedriveSend.js';

const r = Router();

const who = (u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`.trim() });
/** Everyone on the teams this person leads, them included. */
const teamOf = (userId) => [userId, ...db.prepare(`SELECT DISTINCT m.user_id FROM user_teams l JOIN user_teams m ON m.team_id = l.team_id
  WHERE l.user_id = ? AND l.role = 'lead'`).all(userId).map((x) => x.user_id)];
const leads = (userId) => !!db.prepare("SELECT 1 FROM user_teams WHERE user_id = ? AND role = 'lead'").get(userId);
/** The pulls this person may run. */
const pulls = (u) => ['mine', ...(leads(u.id) ? ['team'] : []), ...(u.role === 'admin' ? ['all'] : [])];

/** How Pipedrive stands for this person: what's running, their last pulls and (admins) the last full pull and send. */
r.get('/', (req, res) => {
  const admin = req.user.role === 'admin';
  res.json({
    ...syncStatus(), pulls: pulls(req.user), mine: lastPull(`pipedrive_last_pull_${req.user.id}`),
    ...(admin ? { last: lastPull('pipedrive_last_sync'), lastSend: lastSend() } : {}),
  });
});

/** Body: { scope: 'mine' | 'team' | 'all' }. Starts a pull in the background; poll GET / for progress and the result. */
r.post('/pull', (req, res) => {
  const scope = req.body?.scope || 'mine';
  if (!pulls(req.user).includes(scope)) return res.status(403).json({ error: 'You can’t run that pull' });
  try {
    startPull(scope === 'all' ? { kind: 'all' } : { kind: scope, userIds: scope === 'team' ? teamOf(req.user.id) : [req.user.id] }, who(req.user));
    res.json(syncStatus());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admins: sending to Pipedrive

const kindsOf = (b) => (Array.isArray(b?.kinds) ? b.kinds.filter((k) => SEND_KINDS.includes(k)) : []);
const scopeOf = (b) => ({ ...(b?.pipeline_id ? { pipeline_id: Number(b.pipeline_id) } : {}), ...(Array.isArray(b?.ticket_ids) ? { ticket_ids: b.ticket_ids } : {}) });

/** The deals KIT can send to, and their pipelines, for choosing. */
r.get('/deals', requireAdmin, (req, res) => {
  res.json({ tickets: linkedTickets(), pipelines: db.prepare('SELECT id, name FROM pipelines WHERE pipedrive_id IS NOT NULL ORDER BY position, name').all() });
});

/** Body: { kinds: [...], pipeline_id?, ticket_ids? }. What a send would do; nothing is sent or read from Pipedrive. */
r.post('/send/preview', requireAdmin, (req, res) => res.json(preview(kindsOf(req.body), scopeOf(req.body))));

/** Same body as the preview. Starts the send in the background; poll GET / for progress and the result. */
r.post('/send', requireAdmin, (req, res) => {
  try {
    startSend(kindsOf(req.body), scopeOf(req.body), who(req.user));
    res.json(syncStatus());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
