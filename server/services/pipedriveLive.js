// Live updates from Pipedrive. Pipedrive's webhooks tell KIT when a deal, activity, note, person, pipeline or stage
// changes; KIT gathers the deals they touch for a few seconds and pulls just those, the same way any pull does (so
// Pipedrive wins on the fields it holds, except ones changed in KIT that haven't been sent, and KIT's own work is kept).
// Like every pull, what's deleted in Pipedrive is deleted in KIT (a deleted deal's ticket is archived).
//
// Nothing here writes deal data to Pipedrive. The webhooks themselves are registered only when an admin turns live
// updates on in Admin Access (and removed when they turn it off).
//
// The webhook endpoint is public, so Pipedrive signs in to it with HTTP Basic auth: user "pipedrive" and the password in
// PIPEDRIVE_WEBHOOK_SECRET. Without that secret, the endpoint turns every request away.
import crypto from 'node:crypto';
import { db, json, getSetting, setSetting } from '../db.js';
import { call, startPull, syncStatus, pipedriveConfigured, sendingAllowed, sendingBlockedReason, pullsAllowed } from './pipedrive.js';

export const WEBHOOK_USER = 'pipedrive';
const WEBHOOK_PATH = '/api/pipedrive/webhook';
const WEBHOOK_NAME = 'KIT live updates';
// What KIT listens for. Pipedrive has no file or project events, but adding a file changes its deal, which brings the
// file over, and projects are refreshed every few minutes.
const OBJECTS = ['deal', 'activity', 'note', 'person', 'organization', 'pipeline', 'stage'];
const secret = () => process.env.PIPEDRIVE_WEBHOOK_SECRET || '';
// Wait this long after the last event before pulling (bulk edits send many at once), but never longer than MAX_WAIT.
const QUIET = 5000;
const MAX_WAIT = 30000;
const RETRY = 20000; // when Pipedrive is busy with another pull or a send
const MANY = 100; // more deals than this at once: pull everything instead

// ---- Where Pipedrive should send events

/**
 * This server's public address: PUBLIC_URL if set, else the one Render gives the service, else the address the admin is
 * using. It has to be HTTPS and reachable from the internet, so localhost and plain HTTP don't count.
 */
export function publicUrl(req) {
  const fromReq = req && `${req.get('x-forwarded-proto') || req.protocol}://${req.get('x-forwarded-host') || req.get('host')}`;
  const raw = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || fromReq || '';
  try {
    const u = new URL(raw);
    const local = /^(localhost|127\.|\[::1\]|0\.0\.0\.0)|\.localhost$|\.local$/.test(u.hostname);
    return { url: u.origin, ok: u.protocol === 'https:' && !local };
  } catch {
    return { url: raw, ok: false };
  }
}
const subscriptionUrl = (req) => `${publicUrl(req).url}${WEBHOOK_PATH}`;

// ---- Receiving events

let received = { count: 0, last_at: null, last: null, rejected: 0 };
const pending = new Set();
let refreshMeta = false; // a pipeline or stage changed: pull with no deals still refreshes pipelines, stages and fields
let timer = null;
let firstAt = 0;

/** Basic auth, compared in constant time. */
function authorized(req) {
  const s = secret();
  if (!s) return false;
  const [scheme, value] = String(req.get('authorization') || '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !value) return false;
  const given = Buffer.from(Buffer.from(value, 'base64').toString('utf8'));
  const want = Buffer.from(`${WEBHOOK_USER}:${s}`);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

/** Which deals an event touches. Handles Pipedrive's v2 webhooks ({ meta, data, previous }) and v1 ({ meta, current, previous }). */
export function dealsIn(body) {
  const meta = body?.meta || {};
  const entity = meta.entity || meta.object;
  const action = meta.action;
  const now = body?.data ?? body?.current ?? null;
  const before = body?.previous ?? null;
  const deleted = action === 'delete' || action === 'deleted';
  const ids = new Set();
  const add = (v) => { const n = Number(v && typeof v === 'object' ? v.value ?? v.id : v); if (n > 0) ids.add(n); };
  if (entity === 'deal') {
    add(meta.entity_id ?? meta.id ?? now?.id ?? before?.id); // a deleted deal is pulled too: the pull archives its ticket
  } else if (entity === 'activity' || entity === 'note') {
    add(now?.deal_id); add(before?.deal_id); // moved to another deal: both
  } else if (entity === 'person') {
    const person = Number(meta.entity_id ?? meta.id ?? now?.id ?? before?.id);
    if (person) {
      db.prepare(`SELECT DISTINCT t.pipedrive_id FROM tickets t JOIN ticket_contacts tc ON tc.ticket_id = t.id JOIN contacts c ON c.id = tc.contact_id
        WHERE c.pipedrive_id = ? AND t.pipedrive_id IS NOT NULL`).all(person).forEach((r) => add(r.pipedrive_id));
    }
  } else if (entity === 'organization') {
    const org = Number(meta.entity_id ?? meta.id ?? now?.id ?? before?.id);
    if (org) {
      db.prepare(`SELECT DISTINCT t.pipedrive_id FROM tickets t JOIN organizations o ON o.id = t.organization_id WHERE o.pipedrive_id = ? AND t.pipedrive_id IS NOT NULL`)
        .all(org).forEach((r) => add(r.pipedrive_id));
    }
  }
  return { entity, action, deals: [...ids], meta: entity === 'pipeline' || entity === 'stage' };
}

/** POST /api/pipedrive/webhook. Answers at once (Pipedrive gives up after 10 seconds) and pulls a few seconds later. */
export function handleWebhook(req, res) {
  if (!authorized(req)) {
    received.rejected += 1;
    return res.status(secret() ? 401 : 503).json({ error: secret() ? 'Not authorized' : 'Live updates are not set up on this server' });
  }
  const e = dealsIn(req.body);
  received = { ...received, count: received.count + 1, last_at: new Date().toISOString(), last: `${e.entity || 'unknown'} ${e.action || ''}`.trim() };
  e.deals.forEach((id) => pending.add(id));
  if (e.meta) refreshMeta = true;
  if (e.deals.length || e.meta) schedule(QUIET);
  res.json({ ok: true });
}

function schedule(ms) {
  if (!firstAt) firstAt = Date.now();
  clearTimeout(timer);
  const wait = Math.max(0, Math.min(ms, firstAt + MAX_WAIT - Date.now()));
  timer = setTimeout(flush, wait);
  timer.unref?.();
}

function flush() {
  timer = null;
  if (!pending.size && !refreshMeta) { firstAt = 0; return; }
  if (!pipedriveConfigured() || !pullsAllowed()) { pending.clear(); refreshMeta = false; firstAt = 0; return; }
  const dealIds = [...pending];
  try {
    startPull(dealIds.length > MANY ? { kind: 'all' } : { kind: 'deals', dealIds });
    pending.clear();
    refreshMeta = false;
    firstAt = 0;
  } catch (e) {
    // Another pull or a send is running: try again shortly, keeping what's waiting.
    firstAt = Date.now();
    timer = setTimeout(flush, RETRY);
    timer.unref?.();
    if (!/busy/i.test(e.message)) console.error('Pipedrive live update:', e.message);
  }
}

// ---- Status, and turning it on and off (admins)

/** KIT's webhooks in Pipedrive: those pointing at this server's endpoint. */
async function ours(req) {
  const url = subscriptionUrl(req);
  const j = await call('webhooks');
  return (j.data || []).filter((w) => w.subscription_url === url);
}

export async function liveStatus(req) {
  const where = publicUrl(req);
  const base = {
    secret: !!secret(), url: `${where.url}${WEBHOOK_PATH}`, public: where.ok, received, waiting: pending.size,
    last: json.parse(getSetting('pipedrive_last_live'), null), turned_on: json.parse(getSetting('pipedrive_live_on'), null),
    configured: syncStatus().configured, server: syncStatus().server,
  };
  if (!base.configured) return { ...base, webhooks: [] };
  try {
    const hooks = await ours(req);
    return {
      ...base,
      webhooks: hooks.map((w) => ({ id: w.id, object: w.event_object, action: w.event_action, active: w.is_active !== 0 && w.is_active !== false,
        last_delivery_at: w.last_delivery_time || null, last_status: w.last_http_status ?? null })),
      missing: OBJECTS.filter((o) => !hooks.some((w) => w.event_object === o || w.event_object === '*')),
    };
  } catch (e) {
    return { ...base, webhooks: [], error: e.message };
  }
}

/** Register a webhook for each kind of record KIT listens for (any that are already there are kept). */
export async function turnOn(req) {
  if (!sendingAllowed()) throw new Error(`Live updates are registered from the production server only. ${sendingBlockedReason()}`);
  if (!secret()) throw new Error('Set PIPEDRIVE_WEBHOOK_SECRET on the server first.');
  const where = publicUrl(req);
  if (!where.ok) throw new Error(`Pipedrive can only send to a public HTTPS address, and this server is at ${where.url || 'an unknown address'}. Set PUBLIC_URL.`);
  const have = await ours(req);
  for (const object of OBJECTS.filter((o) => !have.some((w) => w.event_object === o))) {
    await call('webhooks', {}, {
      method: 'POST',
      body: { subscription_url: subscriptionUrl(req), event_action: '*', event_object: object, version: '2.0', name: WEBHOOK_NAME,
        http_auth_user: WEBHOOK_USER, http_auth_password: secret() },
    });
  }
  setSetting('pipedrive_live_on', json.str({ at: new Date().toISOString(), by: req.user ? `${req.user.first_name} ${req.user.last_name}` : null }));
  return liveStatus(req);
}

/** Remove KIT's webhooks from Pipedrive. Nightly and on-demand pulls carry on as before. */
export async function turnOff(req) {
  for (const w of await ours(req)) await call(`webhooks/${w.id}`, {}, { method: 'DELETE' });
  setSetting('pipedrive_live_on', null);
  return liveStatus(req);
}
