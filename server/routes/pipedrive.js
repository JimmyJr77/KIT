// Pipedrive for everyone: pull deals into KIT (admins everything, team leads their teams' deals, members their own),
// and for admins only, send chosen KIT changes to Pipedrive, by hand or (for kinds set to Auto) on their own.
import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { startPull, lastPull, syncStatus, call, syncDirection, setSyncDirection, pullsAllowed, pullsBlockedReason, fileHold, decideFileHold, FILE_HOLD_AT } from '../services/pipedrive.js';
import { startSend, lastSend, preview, linkedTickets, sendModes, savedModes, setSendModes, autoStatus, SEND_KINDS, startSync, lastSync, previewDirection, fieldLabel, autoSend, unpark } from '../services/pipedriveSend.js';
import { fieldsOf } from '../services/pipedriveFields.js';
import { liveStatus, ensureLive } from '../services/pipedriveLive.js';
import { conflicts, conflictCount, resolveConflicts } from '../services/pipedriveConflicts.js';

const r = Router();

const who = (u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`.trim() });
/** Everyone on the teams this person leads, them included. */
const teamOf = (userId) => [userId, ...db.prepare(`SELECT DISTINCT m.user_id FROM user_teams l JOIN user_teams m ON m.team_id = l.team_id
  WHERE l.user_id = ? AND l.role = 'lead'`).all(userId).map((x) => x.user_id)];
const leads = (userId) => !!db.prepare("SELECT 1 FROM user_teams WHERE user_id = ? AND role = 'lead'").get(userId);
/** The pulls this person may run. */
const pulls = (u) => ['mine', ...(leads(u.id) ? ['team'] : []), ...(u.role === 'admin' ? ['all'] : [])];

/** How Pipedrive stands for this person: what's running, their last pull and (admins) the direction, last sync and send. */
r.get('/', (req, res) => {
  const admin = req.user.role === 'admin';
  res.json({
    ...syncStatus(), pulls: pullsAllowed() ? pulls(req.user) : [], pulling: pullsAllowed(), pulling_blocked: pullsAllowed() ? null : pullsBlockedReason(),
    mine: lastPull(`pipedrive_last_pull_${req.user.id}`),
    ...(admin ? { direction: syncDirection(), lastSync: lastSync(), lastSend: lastSend(), conflicts: conflictCount(),
      modes: sendModes(), savedModes: savedModes(), auto: autoStatus(), fileHold: fileHold(), fileHoldAt: FILE_HOLD_AT } : {}),
  });
});

/** Admins: what the first sync in a direction would add and delete on each side, to approve before choosing it. Reads Pipedrive; writes nothing. */
r.get('/direction/preview', requireAdmin, async (req, res) => {
  try { res.json(await previewDirection(String(req.query.direction || ''))); } catch (e) { res.status(400).json({ error: e.message }); }
});

/**
 * Admins. Body: { direction: 'to_kit' | 'to_pipedrive' | 'both' | 'selective' | 'off', sync?: true }. The direction stays
 * until an admin changes it here. Pipedrive's webhooks are made to match, and with `sync` the first sync starts right away.
 */
r.put('/direction', requireAdmin, async (req, res) => {
  const d = setSyncDirection(req.body?.direction);
  await ensureLive(req).catch((e) => console.error('Pipedrive live updates:', e.message));
  let started = false;
  let error = null;
  if (req.body?.sync && d !== 'off') {
    try { startSync(who(req.user)); started = true; } catch (e) { error = e.message; }
  }
  res.json({ direction: d, modes: sendModes(), pulling: pullsAllowed(), started, error });
});

/** Admins: the Sync button. Pulls everything, then sends everything waiting, as the direction allows. Poll GET / for progress. */
r.post('/sync', requireAdmin, (req, res) => {
  try { startSync(who(req.user)); res.json(syncStatus()); } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Admins. Body: { action: 'delete' | 'keep' }. Settles the files held when many were deleted in Pipedrive at once. */
r.post('/file-hold', requireAdmin, (req, res) => {
  if (!['delete', 'keep'].includes(req.body?.action)) return res.status(400).json({ error: 'Choose delete or keep' });
  res.json({ ...decideFileHold(req.body.action), fileHold: fileHold() });
});

/** Pipedrive's field definitions for one entity (deal | person | organization | project), for forms. */
r.get('/fields/:entity', (req, res) => {
  if (!['deal', 'person', 'organization', 'project'].includes(req.params.entity)) return res.status(404).json({ error: 'Unknown entity' });
  res.json({ fields: fieldsOf(req.params.entity) });
});

/**
 * Admins: do the numbers match? Pipedrive's deal counts and values (open, won, lost) next to KIT's, for the deals KIT has
 * from Pipedrive, plus what's only in KIT. Read live from Pipedrive; nothing is written.
 */
r.get('/parity', requireAdmin, async (req, res) => {
  try {
    const summary = async (status) => {
      const d = (await call('deals/summary', { status })).data || {};
      const usd = d.values_total?.USD || Object.values(d.values_total || {})[0] || {};
      return { count: d.total_count ?? usd.count ?? 0, value: usd.value_converted ?? usd.value ?? d.total_currency_converted_value ?? 0 };
    };
    const [open, won, lost] = await Promise.all([summary('open'), summary('won'), summary('lost')]);
    const kit = (where) => db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM tickets
      WHERE ticket_type = 'bid' AND pipedrive_id IS NOT NULL AND archive_set_id IS NULL AND pipedrive_deleted_at IS NULL AND ${where}`).get();
    const onlyKit = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(value), 0) AS value FROM tickets WHERE ticket_type = 'bid' AND pipedrive_id IS NULL AND archive_set_id IS NULL AND archived_at IS NULL
      AND id NOT IN (SELECT row_id FROM sample_rows WHERE tbl = 'tickets')`).get();
    const projects = (await call('projects', { status: 'open,completed,canceled', limit: 500 }).catch(() => ({ data: [] }))).data || [];
    const kitProjects = db.prepare('SELECT COUNT(*) AS n FROM delivery_programs WHERE pipedrive_project_id IS NOT NULL AND project_status IS NOT \'deleted\'').get().n;
    res.json({
      checked_at: new Date().toISOString(),
      deals: [
        { key: 'open', label: 'Open deals', pipedrive: open, kit: kit("deal_status = 'open' AND archived_at IS NULL") },
        { key: 'won', label: 'Won deals', pipedrive: won, kit: kit("deal_status = 'won'") },
        { key: 'lost', label: 'Lost deals', pipedrive: lost, kit: kit("deal_status = 'lost'") },
      ],
      projects: { pipedrive: projects.length, kit: kitProjects, unlinked: projects.filter((p) => !(p.deal_ids || []).length).length },
      only_kit: onlyKit,
      // Deals whose tickets were deleted in KIT and are still in Pipedrive: a pull never brings them back. (One deleted while
      // deals were being sent is deleted in Pipedrive by the next send, and leaves this count then.)
      deleted_in_kit: db.prepare("SELECT COUNT(*) AS n FROM pipedrive_deletes WHERE kind = 'deal'").get().n,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
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

/** Body: { kind: 'off' | 'manual' | 'auto', ... }. Manual and Auto kinds go with a send; Auto kinds also go on their own. */
r.put('/send/modes', requireAdmin, (req, res) => { setSendModes(req.body || {}); res.json({ modes: sendModes(), savedModes: savedModes() }); });

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

// ---- Admins: conflicts (a field changed on both sides since the last pull)

/** A field's value as a person would read it: names for people and territories, Yes/No for flags, else the value. */
function readable(field, v) {
  if (v == null || v === '') return '—';
  if (['bd_director_id', 'assignee_id', 'owner_id'].includes(field)) {
    const u = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(v);
    return u ? `${u.first_name} ${u.last_name}`.trim() : `user ${v}`;
  }
  if (field === 'territory_id') return db.prepare('SELECT name FROM territories WHERE id = ?').get(v)?.name || `territory ${v}`;
  if (typeof v === 'boolean' || ['done', 'is_enabled'].includes(field)) return v && v !== '0' ? 'Yes' : 'No';
  if (['value', 'amount', 'item_price', 'annual_revenue'].includes(field) && Number.isFinite(Number(v))) return `$${Number(v).toLocaleString('en-US')}`;
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** Every open conflict, with both values readable. */
r.get('/conflicts', requireAdmin, (req, res) => {
  res.json({
    conflicts: conflicts().map((c) => ({
      id: c.id, kind: c.kind, ticket_id: c.ticket_id, title: c.title, field: fieldLabel(c.field), found_at: c.found_at,
      kit: readable(c.field, c.kit_value), pipedrive: readable(c.field, c.pipedrive_value), was: readable(c.field, c.snapshot_value),
    })),
  });
});

/**
 * Body: { winner: 'kit' | 'pipedrive', ids?: [...] }. Settles the named conflicts (all of them without ids): KIT's value
 * goes to Pipedrive with the next auto sync or push, or Pipedrive's is written into KIT.
 */
r.post('/conflicts/resolve', requireAdmin, (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
    const settled = resolveConflicts(req.body?.winner, ids);
    if (req.body?.winner === 'kit') { unpark(); try { autoSend(); } catch { /* busy: the next run sends it */ } }
    res.json({ settled, conflicts: conflictCount() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- Admins: live updates (Pipedrive's webhooks → KIT). They follow the direction; this only reports on them.

/** Whether live updates are on: the webhook address, KIT's webhooks in Pipedrive, and the last events and update. */
r.get('/live', requireAdmin, async (req, res) => res.json(await liveStatus(req)));

export default r;
