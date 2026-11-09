// Pipedrive ↔ KIT. Pipedrive → KIT (a pull) runs every night, on live updates, and whenever someone asks: admins pull
// everything, team leads their teams' deals, members their own. Each pull updates the records it brought in before
// (matched by pipedrive_id) and adds new ones. KIT's own work on a ticket (priorities, strategy, assessments) is never
// touched, and a shared field changed in KIT keeps KIT's value until it's sent, unless Pipedrive changed it too (then
// Pipedrive wins).
//
// KIT → Pipedrive is pipedriveSend.js: each kind of change goes on its own (Auto), when an admin pushes (On push), or
// not at all, as an admin chooses. Everything is Auto unless an admin says otherwise, so the two stay the same.
//
// What comes over: Pipedrive's field definitions (so new custom fields and options show up in KIT on their own),
// pipelines and stages, deals as pipeline tickets (won or lost as Pipedrive has them, with every custom field, the
// source, the organization, products and installments), people and organizations, each deal's activities, notes,
// files, participants and followers, and Pipedrive Projects as the plan on the won contracts in Delivery
// (pipedriveProjects.js). What's deleted in Pipedrive is deleted (deals: archived) in KIT.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting, TERRITORY_RENAMES } from '../db.js';
import { mirrorCards } from '../activities.js';
import { hashPassword } from '../auth.js';
import '../sample/registry.js'; // archived_rows, used to skip records archived by a full reset
import {
  saveFields, fieldsOf, fieldByKey, fieldByName, customDealFields, fieldText, labelNames, withCustom, cfKey, customFieldsList, ACCOUNT_FIELD,
} from './pipedriveFields.js';
import { readProjects, writeProjects } from './pipedriveProjects.js';
import { holdConflicts } from './pipedriveConflicts.js';

const API = process.env.PIPEDRIVE_API_URL || 'https://api.pipedrive.com/v1';
// Pipedrive calls it the API token; either name works. Stray spaces or quotes from pasting are ignored.
const apiKey = () => String(process.env.PIPEDRIVE_API_KEY || process.env.PIPEDRIVE_API_TOKEN || '').trim().replace(/^["']+|["']+$/g, '');
export const pipedriveConfigured = () => !!apiKey();
// Sending writes to the company's real deals, so only the production server does it: NODE_ENV=production on Render (which
// sets RENDER itself), or another production host that sets PIPEDRIVE_TWO_WAY=1 on purpose. A local or test server, even
// one started with `npm start`, only ever pulls: every write to Pipedrive is refused in call() below. Even in production,
// only what an admin has turned on goes.
export const sendingAllowed = () => pipedriveConfigured() && process.env.NODE_ENV === 'production' && (!!process.env.RENDER || process.env.PIPEDRIVE_TWO_WAY === '1');
/** Why this server can't send, for people. */
export const sendingBlockedReason = () => (sendingAllowed() ? null
  : process.env.NODE_ENV !== 'production' ? 'This is a development server: it only pulls from Pipedrive, and never writes to it.'
    : 'This production server isn’t on Render. Set PIPEDRIVE_TWO_WAY=1 to turn on sending to Pipedrive.');
// Pipedrive keeps activity times in UTC; KIT shows them in the team's time zone.
const TIME_ZONE = process.env.PIPEDRIVE_TIME_ZONE || 'America/New_York';
export const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');

// The "Account" deal field holds the territory: each of its options is a KIT territory of the same name, except N/A (none).
const NO_ACCOUNT = 'N/A';
export const ACTIVITY_TYPES = { call: 'Call', meeting: 'Meeting', task: 'Task', deadline: 'Deadline', email: 'Email', lunch: 'Lunch' };
const OWNER_FIELD = 'Pipedrive owner';
export const MIME = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip' };

// ---- Reading from Pipedrive

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

export async function call(p, query = {}, { raw = false, method = 'GET', body, v2 = false } = {}) {
  // The safeguard: outside production, Pipedrive is read-only. Nothing made or changed on a development server reaches it.
  if (method !== 'GET' && !sendingAllowed()) throw new Error(`Refused ${method} ${p}: ${sendingBlockedReason()}`);
  const u = new URL(`${v2 ? API.replace(/\/v1$/, '/api/v2') : API}/${p}`);
  Object.entries({ ...query, api_token: apiKey() }).forEach(([k, v]) => u.searchParams.set(k, v));
  const init = { method };
  if (body instanceof FormData) init.body = body;
  else if (body) { init.body = JSON.stringify(body); init.headers = { 'Content-Type': 'application/json' }; }
  for (let attempt = 0; ; attempt += 1) {
    const r = await fetch(u, init);
    if (r.status === 429 && attempt < 6) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000); continue; }
    if (!r.ok) {
      let detail = '';
      try { const j = await r.json(); detail = j.error ? `: ${j.error}${j.error_info ? ` (${j.error_info})` : ''}` : ''; } catch { /* no body */ }
      throw new Error(`Pipedrive ${method} ${p}: ${r.status} ${r.statusText}${detail}`);
    }
    if (raw) return Buffer.from(await r.arrayBuffer());
    const j = await r.json();
    if (!j.success) throw new Error(`Pipedrive ${method} ${p}: ${j.error || 'request failed'}`);
    return j;
  }
}

/** Every item of a start/limit-paginated v1 list. */
export async function all(p, query = {}) {
  let out = [];
  for (let start = 0; ;) {
    const j = await call(p, { ...query, start, limit: 500 });
    out = out.concat(j.data || []);
    const page = j.additional_data?.pagination;
    if (!page?.more_items_in_collection) return out;
    start = page.next_start;
  }
}

/** Every item of a cursor-paginated list (Projects, Tasks, and the v2 API). */
export async function allCursor(p, query = {}, opts = {}) {
  let out = [];
  let cursor = null;
  for (;;) {
    const j = await call(p, { ...query, limit: opts.limit || 500, ...(cursor ? { cursor } : {}) }, opts);
    out = out.concat(j.data || []);
    cursor = j.additional_data?.next_cursor || null;
    if (!cursor) return out;
  }
}

/** The whole list for a 404 (nothing there), else rethrow. */
const orNone = (e) => { if (/: (404|410) /.test(e.message)) return []; throw e; };
const notFound = (e) => /: (404|410) /.test(e.message);
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// ---- Shaping values

/** Pipedrive notes are HTML; KIT keeps plain text. */
export function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** A UTC date and time from Pipedrive as { date, time } in TIME_ZONE. */
export function localDateTime(date, time) {
  if (!date) return { date: null, time: null };
  if (!time) return { date, time: null };
  const d = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** The work entry of a person's phones or emails, else the primary, else the first. */
export const contactValue = (list) => {
  if (!Array.isArray(list)) return list || null;
  const filled = list.filter((x) => x && String(x.value || '').trim());
  return (filled.find((x) => String(x.label || '').toLowerCase() === 'work') || filled.find((x) => x.primary) || filled[0])?.value || null;
};
export const idOf = (v) => (v && typeof v === 'object' ? v.value ?? v.id : v) ?? null;
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sqlTime = (s) => (s ? String(s).replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').slice(0, 19) : null);

/** First and last name for a Pipedrive user, from their name or, failing that, their email ("kathy.devereaux@…"). */
function splitName(name, email) {
  const clean = String(name || '').trim();
  const words = clean.includes('@') ? [] : clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return { first_name: words[0], last_name: words.slice(1).join(' ') };
  const local = String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(capitalize);
  if (local.length >= 2) return { first_name: words[0] || local[0], last_name: local.slice(1).join(' ') };
  return { first_name: words[0] || local[0] || 'Pipedrive', last_name: '' };
}

// A note written in KIT says who wrote it, since Pipedrive shows everything sent with the API key as its owner's. A pull
// takes the line off again.
export const FROM_KIT = /^From KIT, by [^\n]*\n+/;

// ---- Changes on both sides

// The fields a record shares with Pipedrive's, as KIT names them. Each record from Pipedrive keeps a snapshot of these
// as Pipedrive had them at the last pull. A deal's tracked fields also take in every custom deal field (cf_<key>).
export const DEAL_BASE = ['opportunity_title', 'value', 'pipeline_status', 'deal_status', 'lost_reason', 'probability', 'projected_win_date', 'bd_director_id', 'territory_id', 'organization'];
export const dealTracked = () => [...DEAL_BASE, ...customDealFields().map((f) => cfKey(f.key))];
export const TASK_TRACKED = ['text', 'activity_type', 'due_date', 'due_time', 'duration', 'assignee_id', 'location', 'note', 'done'];
export const CONTACT_TRACKED = ['first_name', 'last_name', 'email', 'phone', 'role', 'labels', 'organization'];
export const ORG_TRACKED = ['name', 'address', 'labels', 'website', 'linkedin', 'industry', 'annual_revenue', 'employee_count'];
export const PRODUCT_TRACKED = ['name', 'quantity', 'item_price', 'discount', 'tax', 'comments', 'billing_frequency', 'billing_frequency_cycles', 'billing_start_date', 'is_enabled'];
export const INSTALLMENT_TRACKED = ['description', 'amount', 'billing_date'];
export const same = (a, b) => String(a ?? '') === String(b ?? '');
export const snapshotOf = (view, keys) => json.str(Object.fromEntries(keys.map((k) => [k, view[k] ?? null])));
/** The shared fields changed in KIT since the last pull (none if it has no snapshot yet). */
export function kitChanges(row, keys) {
  const snap = json.parse(row.pipedrive_snapshot, null);
  return snap ? keys.filter((k) => !same(row[k], snap[k])) : [];
}
/** Pipedrive's values, except a field KIT changed and Pipedrive didn't: that keeps KIT's until it's sent. */
export function merged(row, view, keys) {
  const snap = json.parse(row?.pipedrive_snapshot, null);
  if (!snap) return view;
  return Object.fromEntries(Object.entries(view).map(([k, v]) => [k, keys.includes(k) && !same(row[k], snap[k]) && same(v, snap[k]) ? row[k] : v]));
}

/** A Pipedrive deal's shared fields in KIT's terms. `lk` finds a stage's name, a user's KIT account and the territory. */
export function dealView(d, lk) {
  const view = {
    opportunity_title: d.title || `Pipedrive deal ${d.id}`, value: d.value ?? null,
    // A lost deal shows as Lost (KIT's closing stage); a won one keeps the stage it was won from, as in Pipedrive.
    pipeline_status: d.status === 'lost' ? 'Lost' : lk.stageName(d.stage_id) || null,
    deal_status: ['won', 'lost'].includes(d.status) ? d.status : 'open',
    lost_reason: d.status === 'lost' ? d.lost_reason || null : null, probability: d.probability ?? null,
    projected_win_date: d.expected_close_date || null, bd_director_id: lk.owner(d.user_id), territory_id: lk.territory(d),
    organization: d.org_name || d.org_id?.name || null,
  };
  customDealFields().forEach((f) => { view[cfKey(f.key)] = fieldText(f, d[f.key]); });
  return view;
}

/** A Pipedrive activity's shared fields in KIT's terms. */
export function activityView(a, owner) {
  const when = localDateTime(a.due_date, a.due_time);
  return {
    text: a.subject || a.type_name || 'Activity', activity_type: ACTIVITY_TYPES[a.type] || a.type_name || null,
    due_date: when.date, due_time: when.time, duration: a.duration || null, assignee_id: owner(a.assigned_to_user_id || a.user_id),
    location: a.location || null, note: htmlToText(a.note) || null, done: a.done ? 1 : 0,
  };
}

/** A Pipedrive person's shared fields in KIT's terms. */
export function personView(p, lk) {
  const labelsField = fieldByKey('person', 'label_ids') || fieldByKey('person', 'label');
  const titleField = fieldsOf('person').find((f) => f.custom && f.name === 'Title');
  const ids = Array.isArray(p.label_ids) ? p.label_ids : p.label != null ? [p.label] : [];
  return {
    first_name: (p.first_name || p.name || '').trim() || '(no name)', last_name: (p.first_name ? p.last_name : null) || null,
    email: contactValue(p.email), phone: contactValue(p.phone),
    role: p.job_title || (titleField ? fieldText(titleField, p[titleField.key]) : null) || null,
    labels: json.str(labelNames(labelsField, ids)), organization: p.org_name || p.org_id?.name || null,
    organization_id: lk.organization(idOf(p.org_id)),
  };
}

/** A Pipedrive organization's shared fields in KIT's terms. */
export function organizationView(o, lk) {
  const labelsField = fieldByKey('organization', 'label_ids') || fieldByKey('organization', 'label');
  const industry = fieldByKey('organization', 'industry');
  const revenue = fieldByKey('organization', 'annual_revenue');
  const ids = Array.isArray(o.label_ids) ? o.label_ids : o.label != null ? [o.label] : [];
  return {
    name: o.name || `Organization ${o.id}`, address: o.address_formatted_address || (typeof o.address === 'object' ? o.address?.value : o.address) || null,
    labels: json.str(labelNames(labelsField, ids)), website: o.website || null, linkedin: o.linkedin || null,
    industry: industry ? fieldText(industry, o.industry) : o.industry || null,
    annual_revenue: revenue ? fieldText(revenue, o.annual_revenue) : o.annual_revenue || null,
    employee_count: o.employee_count ?? null, owner_id: lk.owner(o.owner_id),
    people_count: o.people_count ?? null, open_deals_count: o.open_deals_count ?? null, won_deals_count: o.won_deals_count ?? null, lost_deals_count: o.lost_deals_count ?? null,
  };
}

/** A Pipedrive deal product (v2) in KIT's terms. */
export function productView(p) {
  return {
    name: p.name || p.product?.name || 'Product', quantity: p.quantity ?? 1, item_price: p.item_price ?? 0,
    discount: p.discount_type === 'amount' && p.item_price ? Math.round((Number(p.discount) / (Number(p.item_price) * (p.quantity || 1))) * 10000) / 100 : p.discount ?? 0,
    tax: p.tax ?? 0, comments: p.comments || null, billing_frequency: p.billing_frequency || null, billing_frequency_cycles: p.billing_frequency_cycles ?? null,
    billing_start_date: p.billing_start_date || null, is_enabled: p.is_enabled === false ? 0 : 1,
  };
}
export const installmentView = (i) => ({ description: i.description || null, amount: i.amount ?? 0, billing_date: i.billing_date || null });

// ---- Which way the sync runs. An admin chooses in Admin Access. Whenever Pipedrive → KIT is part of it, live updates
// (Pipedrive's webhooks, see pipedriveLive.js) are on; they're registered and removed to match.
//   to_kit        one way, Pipedrive → KIT: pulls and live updates run, nothing is sent
//   to_pipedrive  one way, KIT → Pipedrive: changes go out on their own, nothing is pulled (not even live updates)
//   both          two way: pulls and live updates run, every kind of change goes out on its own
//   selective     two way, with each kind of change set to Auto, On push or Off by hand
//   off           no sync (the default on a fresh install): nothing is pulled, nothing is sent, until an admin chooses
//                 a direction and approves its first sync. An install that had already synced deals before this choice
//                 existed was set to two way once, in db.js, so it carried on as it was.
export const DIRECTIONS = ['to_kit', 'to_pipedrive', 'both', 'selective', 'off'];
export const syncDirection = () => (DIRECTIONS.includes(getSetting('pipedrive_sync_direction')) ? getSetting('pipedrive_sync_direction') : 'off');
export const setSyncDirection = (d) => { if (DIRECTIONS.includes(d)) setSetting('pipedrive_sync_direction', d); return syncDirection(); };
/** Whether anything is read from Pipedrive into KIT (pulls, live updates, the nightly pull). */
export const pullsAllowed = () => !['to_pipedrive', 'off'].includes(syncDirection());
/** Why nothing is pulled, when it isn't. */
export const pullsBlockedReason = () => (syncDirection() === 'off' ? 'The sync is off, so nothing is pulled from Pipedrive.' : 'The sync is set to KIT → Pipedrive only, so nothing is pulled from Pipedrive.');

// When a pull finds this many or more of KIT's files deleted in Pipedrive at once, they're held instead of deleted, and an
// admin decides: delete them, or keep them as KIT's own files (a ticket whose deal is gone moves to KIT's own pipeline).
export const FILE_HOLD_AT = 20;
export const fileHold = () => json.parse(getSetting('pipedrive_file_hold'), null);

/** Mark a Pipedrive record deleted in KIT: it isn't imported again, and a send deletes it in Pipedrive. */
export function queueDelete(kind, pipedriveId, dealId = null, projectId = null) {
  if (pipedriveId) db.prepare('INSERT OR IGNORE INTO pipedrive_deletes (kind, pipedrive_id, deal_id, project_id) VALUES (?, ?, ?, ?)').run(kind, pipedriveId, dealId, projectId);
}
export const deletedIds = (kind) => new Set(db.prepare('SELECT pipedrive_id FROM pipedrive_deletes WHERE kind = ?').all(kind).map((x) => x.pipedrive_id));

// ---- One job at a time: a pull or a send

let status = { running: false };
// `server` names the Render service, so an admin setting the token knows which service's Environment to open.
export const syncStatus = () => ({ ...status, configured: pipedriveConfigured(), sending: sendingAllowed(), sending_blocked: sendingBlockedReason(), server: process.env.RENDER_SERVICE_NAME || null });

/** Run `work(phase)` in the background; `done(result, error)` records how it went. Throws if one is already running. */
export function runJob(label, work, done) {
  if (!pipedriveConfigured()) throw new Error('Add PIPEDRIVE_API_KEY to the server settings to use Pipedrive.');
  if (status.running) throw new Error(`Pipedrive is busy with a ${status.label}. Try again in a minute.`);
  status = { running: true, label, phase: 'Starting', started_at: new Date().toISOString() };
  const phase = (p) => { status.phase = p; };
  Promise.resolve().then(() => work(phase))
    .then((result) => done(result, null), (e) => { console.error(`Pipedrive ${label}:`, e); done(null, e); })
    .finally(() => { status = { running: false }; });
}

// ---- Pulls

/**
 * What a pull covers: { kind: 'all' }, the deals owned by some KIT users: { kind: 'team' | 'mine', userIds }, just some
 * deals: { kind: 'deals', dealIds } (live updates), or only Projects and field definitions: { kind: 'projects' }.
 * `by` is who asked ({ id, name }), or null for the nightly pull.
 */
export function startPull(scope, by = null) {
  if (!pullsAllowed()) throw new Error(`${pullsBlockedReason()} Change the sync in Admin Access to pull.`);
  const live = scope.kind === 'deals';
  const key = scope.kind === 'all' ? 'pipedrive_last_sync' : live ? 'pipedrive_last_live' : scope.kind === 'projects' ? 'pipedrive_last_projects' : `pipedrive_last_pull_${by.id}`;
  const label = scope.kind === 'all' ? 'full pull' : live ? `live update (${plural(scope.dealIds.length, 'deal')})` : scope.kind === 'projects' ? 'projects refresh'
    : scope.kind === 'team' ? `team pull for ${by.name}` : `pull for ${by.name}`;
  runJob(label, (phase) => pull(scope, phase), (result, e) => setSetting(key, json.str({
    at: new Date().toISOString(), by: by?.name || null, scope: scope.kind, ...(live ? { deals: scope.dealIds.length } : {}),
    ok: !e, ...(e ? { error: e.message } : { result }),
  })));
}
export const lastPull = (key) => json.parse(getSetting(key), null);

/** The Pipedrive user ids of these KIT users, by the link a pull made or, failing that, by email. */
function pipedriveUsers(userIds, users) {
  const byEmail = new Map(users.map((u) => [String(u.email || '').toLowerCase(), u.id]));
  return [...new Set(userIds.map((id) => {
    const u = db.prepare('SELECT pipedrive_id, email FROM main.users WHERE id = ?').get(id);
    return u?.pipedrive_id || byEmail.get(String(u?.email || '').toLowerCase()) || null;
  }).filter(Boolean))];
}

// A few deals are cheaper read one by one; past this many, reading everything and keeping theirs takes fewer requests.
const PER_DEAL_LIMIT = 100;

async function everything() {
  const [persons, organizations, activities, notes, files] = await Promise.all([
    all('persons'), all('organizations'), all('activities', { user_id: 0 }), all('notes'), all('files'),
  ]);
  return { persons, organizations, activities, notes, files, complete: true };
}

/** The people, organizations, activities, notes and files of just these deals. */
async function dealExtras(deals, phase) {
  if (deals.length > PER_DEAL_LIMIT) return everything();
  const persons = new Map();
  const organizations = new Map();
  const out = { activities: [], notes: [], files: [] };
  for (const [i, d] of deals.entries()) {
    phase(`Reading deal ${i + 1} of ${deals.length}`);
    const [p, a, n, f] = await Promise.all([
      all(`deals/${d.id}/persons`).catch(orNone), all(`deals/${d.id}/activities`).catch(orNone), all('notes', { deal_id: d.id }), all(`deals/${d.id}/files`).catch(orNone),
    ]);
    p.forEach((x) => persons.set(x.id, x));
    out.activities.push(...a); out.notes.push(...n); out.files.push(...f);
    const orgId = idOf(d.org_id);
    if (orgId && !organizations.has(orgId)) {
      try { organizations.set(orgId, (await call(`organizations/${orgId}`)).data); } catch (e) { if (!notFound(e)) throw e; }
    }
  }
  return { ...out, persons: [...persons.values()], organizations: [...organizations.values()].filter(Boolean), complete: false };
}

/** Each deal's participants (people on the deal besides its contact person), for deals that have any. */
async function participantsOf(deals, phase) {
  const out = new Map();
  const some = deals.filter((d) => d.participants_count > 0);
  for (const [i, d] of some.entries()) {
    phase(`Reading participants (${i + 1} of ${some.length})`);
    out.set(d.id, (await all(`deals/${d.id}/participants`).catch(orNone)).map((p) => idOf(p.person_id) ?? p.person?.id).filter(Boolean));
  }
  return out;
}

/** Products and installments on deals that have products, read in batches of 100 deals (the v2 API). */
async function productsOf(deals, phase) {
  const products = [];
  const installments = [];
  let installmentsOk = true;
  const ids = deals.filter((d) => d.products_count > 0).map((d) => d.id);
  for (const [i, batch] of chunks(ids, 100).entries()) {
    phase(`Reading products (${i + 1} of ${chunks(ids, 100).length})`);
    products.push(...await allCursor('deals/products', { deal_ids: batch.join(',') }, { v2: true }));
    if (installmentsOk) {
      try { installments.push(...await allCursor('deals/installments', { deal_ids: batch.join(',') }, { v2: true })); } catch (e) {
        // Installments need Pipedrive's Growth plan or above; without it there's nothing to read.
        if (/: 40[13] /.test(e.message)) installmentsOk = false; else throw e;
      }
    }
  }
  return { products, installments, installmentsOk };
}

/**
 * Pipedrive ids of KIT's files on these deals that were deleted in Pipedrive. Missing from the deal's list isn't enough (a
 * file moved to a deal outside this pull is missing too), so each one is asked about, and any doubt keeps the file.
 */
async function filesDeletedThere(dealIds, files, phase) {
  const listed = new Set(files.filter((f) => f.active_flag !== false).map((f) => f.id));
  const missing = db.prepare(`SELECT f.pipedrive_id AS id FROM main.ticket_files f JOIN main.tickets t ON t.id = f.ticket_id
    WHERE f.pipedrive_id IS NOT NULL AND f.email_id IS NULL AND t.archive_set_id IS NULL AND t.pipedrive_id IN (SELECT value FROM json_each(?))`)
    .all(json.str([...dealIds])).map((f) => f.id).filter((id) => !listed.has(id));
  return filesGone(missing, phase);
}

/** Which of these Pipedrive file ids are gone from Pipedrive, asking about each. */
export async function filesGone(missing, phase) {
  const gone = [];
  for (const [i, id] of missing.entries()) {
    phase(`Checking file ${i + 1} of ${missing.length}`);
    try {
      if ((await call(`files/${id}`)).data?.active_flag === false) gone.push(id);
    } catch (e) {
      if (notFound(e)) gone.push(id);
      else console.error(`Pipedrive file ${id}: ${e.message}`);
    }
  }
  return gone;
}

/** Of KIT's tickets from deals not in the list, which deals are really gone from Pipedrive (deleted), asking about each. */
export async function dealsGone(listedIds, phase) {
  const known = db.prepare(`SELECT pipedrive_id FROM main.tickets WHERE pipedrive_id IS NOT NULL AND archive_set_id IS NULL AND pipedrive_deleted_at IS NULL
    AND pipedrive_id NOT IN (SELECT value FROM json_each(?))`).all(json.str([...listedIds])).map((t) => t.pipedrive_id);
  const gone = [];
  for (const [i, id] of known.entries()) {
    phase(`Checking deal ${i + 1} of ${known.length}`);
    try {
      const d = (await call(`deals/${id}`)).data;
      if (!d || d.deleted || d.status === 'deleted') gone.push(id);
    } catch (e) {
      if (notFound(e)) gone.push(id); else console.error(`Pipedrive deal ${id}: ${e.message}`);
    }
  }
  return gone;
}

/** Download the deal and project files KIT doesn't have yet. Returns pipedrive file id → { stored, size }. */
export async function download(files, known) {
  fs.mkdirSync(uploadDir, { recursive: true });
  const downloaded = new Map();
  for (const f of files.filter((x) => !known.has(x.id))) {
    try {
      const buf = await call(`files/${f.id}/download`, {}, { raw: true });
      const stored = `${crypto.randomUUID()}${path.extname(f.name || '') || ''}`;
      fs.writeFileSync(path.join(uploadDir, stored), buf);
      downloaded.set(f.id, { stored, size: buf.length });
    } catch (e) {
      console.error(`Pipedrive file ${f.id}: ${e.message}`);
    }
  }
  return downloaded;
}

/** Read from Pipedrive, then write it to KIT in one transaction. Returns what changed. A deal whose ticket was deleted in KIT is skipped. */
export async function pull(scope, phase) {
  phase('Reading Pipedrive');
  const [users, pipelines, stages, dealFields, personFields, orgFields, projectFields] = await Promise.all([
    all('users'), all('pipelines'), all('stages'), all('dealFields'), all('personFields'), all('organizationFields'), all('projectFields').catch(orNone),
  ]);
  // Field definitions first, so everything below is read with today's fields and options.
  saveFields('deal', dealFields); saveFields('person', personFields); saveFields('organization', orgFields); saveFields('project', projectFields);

  let deals = [];
  let extras = { persons: [], organizations: [], activities: [], notes: [], files: [], complete: false };
  let gone = [];
  if (scope.kind === 'all') {
    [deals, extras] = await Promise.all([all('deals', { status: 'all_not_deleted' }), everything()]);
    gone = await dealsGone(new Set(deals.map((d) => d.id)), phase);
  } else if (scope.kind === 'deals') {
    // Live updates: just the deals Pipedrive said changed. A deal that's gone from Pipedrive is archived in KIT.
    phase(`Reading ${plural(scope.dealIds.length, 'deal')}`);
    for (const id of scope.dealIds) {
      try {
        const d = (await call(`deals/${id}`)).data;
        if (d && !d.deleted && d.status !== 'deleted') deals.push(d); else gone.push(id);
      } catch (e) {
        if (notFound(e)) gone.push(id); else throw e;
      }
    }
    extras = await dealExtras(deals, phase);
  } else if (scope.kind === 'projects') {
    // Only Projects (there are no webhooks for them) and the field definitions saved above.
  } else {
    const owners = pipedriveUsers(scope.userIds, users);
    if (!owners.length) {
      throw new Error(scope.kind === 'mine' ? 'Your KIT email doesn’t match a Pipedrive user, so there are no deals of yours to pull.'
        : 'No one on your team has a Pipedrive user with the same email as in KIT.');
    }
    deals = (await Promise.all(owners.map((id) => all('deals', { user_id: id, status: 'all_not_deleted' })))).flat();
    extras = await dealExtras(deals, phase);
  }
  const { persons, organizations, activities, notes, files } = extras;

  const deletedDeals = deletedIds('deal');
  deals = deals.filter((d) => !deletedDeals.has(d.id));
  const dealIds = new Set(deals.map((d) => d.id));
  const participants = await participantsOf(deals, phase);
  const { products, installments, installmentsOk } = await productsOf(deals, phase);

  // Pipedrive Projects: the plan on won contracts. Every project in a full pull or a projects refresh; in a live update,
  // those linked to the deals it covers.
  const projects = scope.kind === 'mine' || scope.kind === 'team' ? null : await readProjects(scope.kind === 'deals' ? [...dealIds] : null, phase);

  // Download deal files KIT doesn't have yet (images pasted into notes stay with the notes in Pipedrive).
  phase('Downloading files');
  const known = new Set([
    ...db.prepare('SELECT pipedrive_id FROM main.ticket_files WHERE pipedrive_id IS NOT NULL').all().map((f) => f.pipedrive_id),
    ...db.prepare('SELECT pipedrive_id FROM main.delivery_files WHERE pipedrive_id IS NOT NULL').all().map((f) => f.pipedrive_id),
    ...deletedIds('file'), ...deletedIds('project_file'),
  ]);
  const wanted = files.filter((f) => f.deal_id && dealIds.has(f.deal_id) && !f.inline_flag && f.active_flag !== false);
  const downloaded = await download([...wanted, ...(projects?.files || [])], known);

  // Files deleted in Pipedrive go from KIT too, unless many go at once: then they're held for an admin (see FILE_HOLD_AT).
  const held = new Set((fileHold()?.files || []).map((f) => f.pipedrive_id));
  let filesGoneIds = (await filesDeletedThere(dealIds, files, phase)).filter((id) => !held.has(id));
  if (projects) projects.filesGone = (await filesGone(projects.filesMissing, phase)).filter((id) => !held.has(id));
  let holdNow = null;
  if (filesGoneIds.length + (projects?.filesGone.length || 0) >= FILE_HOLD_AT) {
    holdNow = { deal: filesGoneIds, project: projects?.filesGone || [] };
    filesGoneIds = [];
    if (projects) projects.filesGone = [];
  }
  const storedGone = db.prepare('SELECT stored_name, url FROM main.ticket_files WHERE pipedrive_id IN (SELECT value FROM json_each(?))').all(json.str(filesGoneIds));

  phase('Saving to KIT');
  try {
    const result = db.transaction(() => {
      const ctx = write({
        users, pipelines, stages, deals, persons, organizations, participants, products, installments, installmentsOk, gone,
        activities: activities.filter((a) => dealIds.has(a.deal_id)), notes: notes.filter((n) => dealIds.has(n.deal_id)), files: wanted, downloaded,
        filesGone: filesGoneIds, complete: scope.kind === 'all' || extras.complete, scopeKind: scope.kind,
      });
      if (projects) Object.assign(ctx.count, writeProjects(projects, { ...ctx, downloaded, removeFiles: true }));
      if (holdNow) ctx.count.filesHeld = holdFiles(holdNow);
      holdConflicts(); // fields an admin hasn't settled stay as they were found
      return { ...ctx.count, accountsMatched: ctx.matched, accountsCreated: ctx.created };
    })();
    storedGone.forEach((f) => { if (f.stored_name && !f.url) fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }); });
    (projects?.storedGone || []).forEach((name) => fs.rmSync(path.join(uploadDir, name), { force: true }));
    return result;
  } catch (e) {
    // Nothing was saved, so the files just downloaded aren't needed.
    downloaded.forEach((d) => fs.rmSync(path.join(uploadDir, d.stored), { force: true }));
    throw e;
  }
}

function write({ users, pipelines, stages, deals, persons, organizations, participants, products, installments, installmentsOk, gone, activities, notes, files, downloaded, filesGone = [], complete, scopeKind }) {
  const count = {};
  const tally = (k, n = 1) => { count[k] = (count[k] || 0) + n; };

  // ---- People: Pipedrive users → KIT accounts, by email
  const pdUsers = new Map(users.map((u) => [u.id, u]));
  const accounts = new Map(); // Pipedrive user id → KIT user id (or null)
  const matched = [];
  const created = [];
  const findByEmail = db.prepare('SELECT id, first_name, last_name FROM main.users WHERE email = ? COLLATE NOCASE');
  const findByPd = db.prepare('SELECT id FROM main.users WHERE pipedrive_id = ?');
  const usernameTaken = db.prepare('SELECT 1 FROM main.users WHERE username = ? COLLATE NOCASE');
  const account = (pdId, create = false) => {
    const id = idOf(pdId);
    if (!id) return null;
    if (accounts.has(id) && (accounts.get(id) || !create)) return accounts.get(id);
    const u = pdUsers.get(id) || (typeof pdId === 'object' ? pdId : null);
    const email = String(u?.email || '').trim().toLowerCase();
    let kitId = findByPd.get(id)?.id ?? null;
    if (!kitId && email) {
      const found = findByEmail.get(email);
      if (found) {
        kitId = found.id;
        db.prepare('UPDATE users SET pipedrive_id = ? WHERE id = ?').run(id, kitId);
        matched.push(`${found.first_name} ${found.last_name}`.trim());
      } else if (create) {
        const { first_name, last_name } = splitName(u?.name, email);
        let base = email.split('@')[0].replace(/[^A-Za-z0-9._-]/g, '').slice(0, 28) || 'pipedrive';
        if (base.length < 3) base = `${base}user`;
        let username = base;
        for (let n = 2; usernameTaken.get(username); n += 1) username = `${base}${n}`;
        kitId = db.prepare(`INSERT INTO users (first_name, last_name, email, username, role, password_hash, pending_activation, pipedrive_id)
          VALUES (?, ?, ?, ?, 'member', ?, 1, ?)`).run(first_name, last_name, email, username, hashPassword(crypto.randomBytes(24).toString('hex')), id).lastInsertRowid;
        // Owning a deal doesn't put someone on a team: the account starts on none, and an admin assigns its teams.
        db.prepare("INSERT OR IGNORE INTO approved_accounts (email, role, team_ids) VALUES (?, 'member', '[]')").run(email);
        created.push(`${first_name} ${last_name}`.trim());
      }
    }
    accounts.set(id, kitId);
    return kitId;
  };

  // Deal owners first: they're the ones who get a KIT account if they have none. Everyone else is only matched.
  deals.forEach((d) => account(d.user_id, true));

  // ---- Pipelines and stages
  const pipelineIds = new Map();
  pipelines.forEach((p, i) => {
    const row = db.prepare('SELECT id FROM pipelines WHERE pipedrive_id = ?').get(p.id);
    const position = p.order_nr ?? i;
    if (row) db.prepare('UPDATE pipelines SET name = ?, position = ? WHERE id = ?').run(p.name, position, row.id);
    pipelineIds.set(p.id, row?.id ?? db.prepare('INSERT INTO pipelines (name, position, pipedrive_id) VALUES (?, ?, ?)').run(p.name, position, p.id).lastInsertRowid);
    if (!row) tally('pipelines');
  });
  const stageNames = new Map(stages.map((s) => [s.id, s.name]));
  stages.forEach((s) => {
    const pipelineId = pipelineIds.get(s.pipeline_id);
    if (!pipelineId) return;
    const row = db.prepare('SELECT id FROM pipeline_stages WHERE pipedrive_id = ?').get(s.id);
    if (row) db.prepare('UPDATE pipeline_stages SET name = ?, position = ?, pipeline_id = ? WHERE id = ?').run(s.name, s.order_nr, pipelineId, row.id);
    else db.prepare('INSERT INTO pipeline_stages (pipeline_id, name, position, pipedrive_id) VALUES (?, ?, ?, ?)').run(pipelineId, s.name, s.order_nr, s.id);
  });
  db.prepare('DELETE FROM pipeline_stages WHERE pipedrive_id IS NOT NULL AND pipedrive_id NOT IN (SELECT value FROM json_each(?))').run(json.str(stages.map((s) => s.id)));

  // ---- Deal fields: territories follow the Account field's options (matched by option, else by name or the name KIT used
  // to give it, renamed and ordered as in Pipedrive, added when Pipedrive has a new one; KIT-only territories are left alone).
  const accountField = fieldByName('deal', ACCOUNT_FIELD);
  const labelField = fieldByKey('deal', 'label');
  const channelField = fieldByKey('deal', 'channel');
  const originField = fieldByKey('deal', 'origin');
  const territories = new Map();
  (accountField?.options || []).filter((o) => o.label !== NO_ACCOUNT).forEach((o, i) => {
    const oldName = Object.keys(TERRITORY_RENAMES).find((k) => TERRITORY_RENAMES[k] === o.label);
    const row = db.prepare('SELECT id FROM main.territories WHERE pipedrive_id = ?').get(o.id)
      || db.prepare('SELECT id FROM main.territories WHERE name = ?').get(o.label)
      || (oldName && db.prepare('SELECT id FROM main.territories WHERE name = ?').get(oldName));
    const id = row
      ? (db.prepare('UPDATE territories SET name = ?, position = ?, pipedrive_id = ? WHERE id = ?').run(o.label, i, o.id, row.id), row.id)
      : db.prepare('INSERT INTO territories (name, position, pipedrive_id) VALUES (?, ?, ?)').run(o.label, i, o.id).lastInsertRowid;
    territories.set(String(o.id), id);
  });
  // Pipedrive's labels, with their colors. A KIT tag with the same name becomes that label. A label gone from Pipedrive
  // becomes a KIT-only tag (nothing is deleted).
  (labelField?.options || []).forEach((o, i) => {
    const row = db.prepare('SELECT id FROM labels WHERE pipedrive_id = ?').get(o.id) || db.prepare('SELECT id FROM labels WHERE name = ? COLLATE NOCASE').get(o.label);
    if (row) db.prepare('UPDATE labels SET name = ?, color = ?, position = ?, pipedrive_id = ? WHERE id = ?').run(o.label, o.color || 'gray', i, o.id, row.id);
    else db.prepare('INSERT INTO labels (name, color, position, pipedrive_id) VALUES (?, ?, ?, ?)').run(o.label, o.color || 'gray', i, o.id);
  });
  if (labelField) db.prepare('UPDATE labels SET pipedrive_id = NULL WHERE pipedrive_id IS NOT NULL AND pipedrive_id NOT IN (SELECT value FROM json_each(?))').run(json.str((labelField.options || []).map((o) => o.id)));
  const kitOnly = new Set(db.prepare('SELECT name FROM labels WHERE pipedrive_id IS NULL').all().map((l) => l.name.toLowerCase()));

  // ---- Organizations
  const orgByPd = db.prepare('SELECT * FROM main.organizations WHERE pipedrive_id = ?');
  const orgByName = db.prepare('SELECT * FROM main.organizations WHERE pipedrive_id IS NULL AND name = ? COLLATE NOCASE LIMIT 1');
  const orgs = new Map(); // Pipedrive org id → KIT org id
  const orgLookups = { owner: (u) => account(u) };
  organizations.forEach((o) => {
    if (!o || o.active_flag === false) return;
    const view = organizationView(o, orgLookups);
    const row = orgByPd.get(o.id) || orgByName.get(view.name);
    const fields = merged(row, view, ORG_TRACKED);
    const snapshot = snapshotOf(view, ORG_TRACKED);
    if (row) {
      db.prepare(`UPDATE organizations SET name = @name, address = @address, labels = @labels, website = @website, linkedin = @linkedin, industry = @industry,
          annual_revenue = @annual_revenue, employee_count = @employee_count, owner_id = COALESCE(@owner_id, owner_id), people_count = @people_count,
          open_deals_count = @open_deals_count, won_deals_count = @won_deals_count, lost_deals_count = @lost_deals_count, pipedrive_id = @pd,
          pipedrive_snapshot = @snapshot, pipedrive_pending = CASE WHEN pipedrive_pending AND @changed THEN 1 ELSE 0 END, updated_at = @updated WHERE id = @id`)
        .run({ ...fields, pd: o.id, snapshot, updated: sqlTime(o.update_time), id: row.id, changed: kitChanges({ ...row, ...fields, pipedrive_snapshot: snapshot }, ORG_TRACKED).length ? 1 : 0 });
      orgs.set(o.id, row.id);
      tally('organizationsUpdated');
    } else {
      orgs.set(o.id, db.prepare(`INSERT INTO organizations (name, address, labels, website, linkedin, industry, annual_revenue, employee_count, owner_id, people_count,
          open_deals_count, won_deals_count, lost_deals_count, pipedrive_id, pipedrive_snapshot, created_at, updated_at)
        VALUES (@name, @address, @labels, @website, @linkedin, @industry, @annual_revenue, @employee_count, @owner_id, @people_count,
          @open_deals_count, @won_deals_count, @lost_deals_count, @pd, @snapshot, @at, @updated)`)
        .run({ ...fields, pd: o.id, snapshot, at: sqlTime(o.add_time) || sqlTime(new Date().toISOString()), updated: sqlTime(o.update_time) }).lastInsertRowid);
      tally('organizationsAdded');
    }
  });
  const organization = (pdId) => (pdId ? orgs.get(pdId) ?? orgByPd.get(pdId)?.id ?? null : null);

  // ---- People in the CRM: Pipedrive persons → contacts
  const notArchived = (tbl, col = 'rowid') => `${col} NOT IN (SELECT row_id FROM main.archived_rows WHERE tbl = '${tbl}')`;
  const contactByPd = db.prepare(`SELECT * FROM main.contacts WHERE pipedrive_id = ? AND ${notArchived('contacts', 'id')}`);
  const contactByEmail = db.prepare(`SELECT * FROM main.contacts WHERE pipedrive_id IS NULL AND email = ? COLLATE NOCASE AND ${notArchived('contacts', 'id')}
    AND id NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = 'contacts') LIMIT 1`);
  const contacts = new Map();
  const personLookups = { organization };
  persons.forEach((p) => {
    if (p.active_flag === false) return;
    const view = personView(p, personLookups);
    const existing = contactByPd.get(p.id) || (view.email && contactByEmail.get(view.email));
    const fields = merged(existing, view, CONTACT_TRACKED);
    const snapshot = snapshotOf(view, CONTACT_TRACKED);
    if (existing) {
      db.prepare(`UPDATE contacts SET first_name = @first_name, last_name = @last_name, organization = @organization, organization_id = @organization_id, role = @role,
        email = @email, phone = @phone, labels = @labels, pipedrive_id = @pd, pipedrive_snapshot = @snapshot,
        pipedrive_pending = CASE WHEN pipedrive_pending AND @changed THEN 1 ELSE 0 END, updated_at = @updated WHERE id = @id`)
        .run({ ...fields, pd: p.id, snapshot, updated: sqlTime(p.update_time), id: existing.id, changed: kitChanges({ ...existing, ...fields, pipedrive_snapshot: snapshot }, CONTACT_TRACKED).length ? 1 : 0 });
      contacts.set(p.id, existing.id);
      tally('contactsUpdated');
    } else {
      contacts.set(p.id, db.prepare(`INSERT INTO contacts (first_name, last_name, organization, organization_id, role, email, phone, labels, created_by, created_at, updated_at, pipedrive_id, pipedrive_snapshot)
        VALUES (@first_name, @last_name, @organization, @organization_id, @role, @email, @phone, @labels, @by, @at, @updated, @pd, @snapshot)`)
        .run({ ...fields, by: account(p.owner_id), at: sqlTime(p.add_time), updated: sqlTime(p.update_time), pd: p.id, snapshot }).lastInsertRowid);
      tally('contactsAdded');
    }
  });
  const contactOf = (pdId) => (pdId ? contacts.get(pdId) ?? contactByPd.get(pdId)?.id ?? null : null);
  const linkContact = db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id) VALUES (?, ?)');

  // ---- Deals → pipeline tickets
  const ticketByPd = db.prepare('SELECT * FROM main.tickets WHERE pipedrive_id = ? AND archive_set_id IS NULL');
  const ticketByTitle = db.prepare(`SELECT * FROM main.tickets WHERE pipedrive_id IS NULL AND ticket_type = 'bid' AND archive_set_id IS NULL
    AND opportunity_title = ? COLLATE NOCASE AND id NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = 'tickets') LIMIT 1`);
  const lastHistory = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM ticket_history WHERE ticket_id = ?');
  const dateHistory = db.prepare('UPDATE ticket_history SET changed_at = ? WHERE ticket_id = ? AND id > ?');
  const tickets = new Map();
  const tracked = dealTracked();
  const lookups = {
    stageName: (id) => stageNames.get(id), owner: (u) => account(u),
    territory: (d) => (accountField ? territories.get(String(d[accountField.key] ?? '')) ?? null : null),
  };

  deals.forEach((d) => {
    const pipelineId = pipelineIds.get(d.pipeline_id) ?? null;
    const stage = stageNames.get(d.stage_id) || null;
    const view = dealView(d, lookups);
    const custom = customFieldsList(d, json.parse(ticketByPd.get(d.id)?.custom_fields, []));
    if (!view.bd_director_id && d.user_id) custom.push({ name: OWNER_FIELD, value: d.user_id.name || d.owner_name || 'Unknown' });
    const other = {
      currency: d.currency && d.currency !== 'USD' ? d.currency : null,
      labels: json.str(labelField && d.label ? fieldText(labelField, d.label).split(', ').filter(Boolean) : []),
      source: (channelField && fieldText(channelField, d.channel)) || null, source_channel_id: d.channel_id || null,
      source_origin: (originField && fieldText(originField, d.origin)) || d.origin || null, source_origin_id: d.origin_id || null,
      organization_id: organization(idOf(d.org_id)), pipeline_id: pipelineId, snapshot: snapshotOf(view, tracked),
      won_at: d.status === 'won' ? sqlTime(d.won_time || d.close_time) : null, lost_at: d.status === 'lost' ? sqlTime(d.lost_time || d.close_time) : null,
    };

    let t = ticketByPd.get(d.id) || ticketByTitle.get(view.opportunity_title);
    // A shared field changed in KIT and not in Pipedrive keeps KIT's value (it's sent).
    const kept = merged(withCustom(t), view, tracked);
    const fields = { ...kept, ...other };
    // Custom fields KIT changed and hasn't sent keep KIT's text.
    const customOut = custom.map((f) => (f.key && kept[cfKey(f.key)] !== view[cfKey(f.key)] ? { ...f, value: kept[cfKey(f.key)] } : f));
    customDealFields().forEach((f) => {
      if (kept[cfKey(f.key)] != null && !customOut.some((x) => x.key === f.key)) customOut.push({ key: f.key, name: f.name, value: kept[cfKey(f.key)] });
    });
    const statusNow = fields.pipeline_status;
    const dealStatus = fields.deal_status;
    const owner = fields.bd_director_id;
    const territory = fields.territory_id;
    const closedAt = dealStatus === 'won' ? other.won_at : dealStatus === 'lost' ? other.lost_at : null;
    if (!t) {
      // New: start it at its stage on the day it was added, then close it if it's closed, so its history reads right.
      const start = stage === 'Lost' && statusNow !== 'Lost' ? statusNow : stage;
      const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, organization_id, pipeline_status, deal_status, value, created_by, created_at, updated_at, ticket_type,
          bd_director_id, territory_id, currency, probability, lost_reason, labels, source, source_channel_id, source_origin, source_origin_id, projected_win_date, pipeline_id,
          custom_fields, pipedrive_id, pipedrive_snapshot, won_at, lost_at, done_at)
        VALUES (@opportunity_title, @organization, @organization_id, @stage, 'open', @value, @owner, @added, @updated, 'bid', @owner, @territory, @currency, @probability, @lost_reason,
          @labels, @source, @source_channel_id, @source_origin, @source_origin_id, @projected_win_date, @pipeline_id, @custom, @pd, @snapshot, NULL, NULL, NULL)`)
        .run({ ...fields, stage: start, owner, added: sqlTime(d.add_time), updated: sqlTime(d.update_time), territory, custom: json.str(customOut), pd: d.id }).lastInsertRowid;
      dateHistory.run(sqlTime(d.add_time), id, 0);
      if (statusNow !== start || dealStatus !== 'open') {
        const before = lastHistory.get(id).id;
        db.prepare('UPDATE tickets SET pipeline_status = ?, deal_status = ?, won_at = ?, lost_at = ?, done_at = ? WHERE id = ?')
          .run(statusNow, dealStatus, other.won_at, other.lost_at, closedAt, id);
        dateHistory.run(closedAt || sqlTime(d.stage_change_time) || sqlTime(d.update_time), id, before);
      }
      t = { id, pipeline_status: start, deal_status: 'open', fresh: true };
      tally('dealsAdded');
    } else {
      const before = lastHistory.get(t.id).id;
      // Pipedrive's labels, plus any tags made in KIT. A KIT change not sent to Pipedrive yet stays as it is.
      if (t.labels_pending) fields.labels = t.labels;
      else fields.labels = json.str([...new Set([...json.parse(fields.labels, []), ...json.parse(t.labels, []).filter((l) => kitOnly.has(String(l).toLowerCase()))])]);
      const reopened = t.deal_status !== 'open' && dealStatus === 'open';
      db.prepare(`UPDATE tickets SET opportunity_title = @opportunity_title, organization = @organization, organization_id = COALESCE(@organization_id, organization_id),
          pipeline_status = @status, deal_status = @deal_status, value = @value, currency = @currency, probability = @probability, lost_reason = @lost_reason, labels = @labels,
          source = @source, source_channel_id = @source_channel_id, source_origin = @source_origin, source_origin_id = @source_origin_id,
          projected_win_date = COALESCE(@projected_win_date, projected_win_date), pipeline_id = @pipeline_id, custom_fields = @custom, pipedrive_id = @pd,
          pipedrive_snapshot = @snapshot, won_at = @won_at, lost_at = @lost_at,
          bd_director_id = COALESCE(@owner, bd_director_id), territory_id = COALESCE(@territory, territory_id),
          done_at = CASE WHEN @reopened THEN NULL ELSE done_at END,
          archived_at = CASE WHEN pipedrive_deleted_at IS NOT NULL THEN NULL ELSE archived_at END, pipedrive_deleted_at = NULL,
          updated_at = CASE WHEN updated_at > @updated THEN updated_at ELSE @updated END
        WHERE id = @id`)
        .run({ ...fields, status: statusNow, owner, territory, custom: json.str(customOut), pd: d.id, updated: sqlTime(d.update_time), id: t.id, reopened: reopened ? 1 : 0 });
      // Date any change the update logged when it happened in Pipedrive, not now.
      const stageChanged = t.pipeline_status !== statusNow;
      dateHistory.run(stageChanged ? (closedAt || sqlTime(d.stage_change_time) || sqlTime(d.update_time)) : sqlTime(d.update_time), t.id, before);
      tally('dealsUpdated');
    }
    // A closed deal is Done as of when it closed (it stays in Done: pipeline tickets never age off), and a won one's
    // contract is dated when it was won.
    if (closedAt && (t.fresh || t.deal_status !== dealStatus)) {
      db.prepare('UPDATE tickets SET done_at = ? WHERE id = ?').run(closedAt, t.id);
      if (dealStatus === 'won') db.prepare('UPDATE delivery_programs SET awarded_at = ? WHERE ticket_id = ?').run(closedAt, t.id);
    }
    // Deals archived in Pipedrive leave KIT's boards too (a won one's contract leaves Delivery; Closed deals lists it under
    // Other), and come back when unarchived there.
    if (d.is_archived) {
      const r = db.prepare('UPDATE tickets SET archived_at = COALESCE(archived_at, @at), pipedrive_archived_at = @at WHERE id = @id AND pipedrive_archived_at IS NULL')
        .run({ at: sqlTime(d.archive_time) || sqlTime(new Date().toISOString()), id: t.id });
      if (r.changes) tally('dealsArchivedInPipedrive');
    } else if (t.pipedrive_archived_at) {
      db.prepare('UPDATE tickets SET archived_at = NULL, pipedrive_archived_at = NULL WHERE id = ?').run(t.id);
      tally('dealsUnarchived');
    }
    const person = contactOf(idOf(d.person_id));
    if (person) {
      linkContact.run(t.id, person);
      db.prepare('UPDATE ticket_contacts SET is_primary = (contact_id = ?) WHERE ticket_id = ?').run(person, t.id);
    }
    (participants.get(d.id) || []).forEach((pid) => { const c = contactOf(pid); if (c) linkContact.run(t.id, c); });
    tickets.set(d.id, t.id);
  });

  // Deals gone from Pipedrive: their tickets are archived (never deleted), and so leave every board and figure.
  gone.forEach((pdId) => {
    const r = db.prepare(`UPDATE tickets SET archived_at = COALESCE(archived_at, datetime('now')), pipedrive_deleted_at = datetime('now')
      WHERE pipedrive_id = ? AND archive_set_id IS NULL AND pipedrive_deleted_at IS NULL`).run(pdId);
    if (r.changes) tally('dealsArchived');
  });

  // ---- A deal's activities, notes, files, products and installments
  const onLiveTicket = (tbl) => `SELECT x.id FROM main.${tbl} x JOIN main.tickets t ON t.id = x.ticket_id WHERE x.pipedrive_id = ? AND t.archive_set_id IS NULL`;
  const taskByPd = db.prepare(onLiveTicket('ticket_tasks').replace('SELECT x.id', 'SELECT x.*'));
  const deletedActivities = deletedIds('activity');
  const seenActivities = new Set();
  activities.forEach((a) => {
    const ticketId = tickets.get(a.deal_id);
    if (!ticketId || deletedActivities.has(a.id) || a.active_flag === false) { tally('activitiesSkipped'); return; }
    seenActivities.add(a.id);
    const view = activityView(a, account);
    const row = taskByPd.get(a.id);
    const kept = merged(row, view, TASK_TRACKED);
    const fields = {
      ...kept, ticket_id: ticketId, description: htmlToText(a.public_description) || null, video_call: a.conference_meeting_url || null,
      organization: a.org_name || null, done_at: kept.done ? (kept.done === view.done && sqlTime(a.marked_as_done_time)) || row?.done_at || null : null,
      snapshot: snapshotOf(view, TASK_TRACKED),
    };
    let id = row?.id;
    if (id) {
      db.prepare(`UPDATE ticket_tasks SET ticket_id = @ticket_id, text = @text, activity_type = @activity_type, due_date = @due_date, due_time = @due_time,
        duration = @duration, assignee_id = @assignee_id, location = @location, note = @note, description = @description, video_call = @video_call,
        organization = @organization, done = @done, done_at = @done_at, pipedrive_snapshot = @snapshot WHERE id = @id`).run({ ...fields, id });
      tally('activitiesUpdated');
    } else {
      id = db.prepare(`INSERT INTO ticket_tasks (ticket_id, text, activity_type, due_date, due_time, duration, assignee_id, location, note, description,
          video_call, organization, done, done_at, created_by, created_at, position, pipedrive_id, pipedrive_snapshot)
        VALUES (@ticket_id, @text, @activity_type, @due_date, @due_time, @duration, @assignee_id, @location, @note, @description, @video_call,
          @organization, @done, @done_at, @by, @at, (SELECT COALESCE(MAX(position) + 1, 0) FROM main.ticket_tasks WHERE ticket_id = @ticket_id), @pd, @snapshot)`)
        .run({ ...fields, by: account(a.created_by_user_id), at: sqlTime(a.add_time), pd: a.id }).lastInsertRowid;
      tally('activitiesAdded');
    }
    db.prepare('DELETE FROM task_participants WHERE task_id = ?').run(id);
    (a.participants || []).forEach((p) => {
      const c = contactOf(p.person_id);
      if (!c) return;
      db.prepare('INSERT OR IGNORE INTO task_participants (task_id, contact_id) VALUES (?, ?)').run(id, c);
      linkContact.run(ticketId, c);
    });
  });
  // Activities deleted in Pipedrive (on the deals this pull read in full) go from KIT too, with their priority cards' link.
  const coveredIds = json.str([...tickets.values()]);
  if (complete || scopeKind === 'deals') {
    db.prepare(`SELECT id, pipedrive_id FROM main.ticket_tasks WHERE pipedrive_id IS NOT NULL AND ticket_id IN (SELECT value FROM json_each(?))`).all(coveredIds)
      .filter((k) => !seenActivities.has(k.pipedrive_id) && !deletedActivities.has(k.pipedrive_id)).forEach((k) => {
        db.prepare('UPDATE priority_cards SET activity_id = NULL WHERE activity_id = ?').run(k.id);
        db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(k.id);
        tally('activitiesDeleted');
      });
  }

  // Priority cards made from synced activities keep their subject, date and done state.
  db.prepare('SELECT DISTINCT activity_id FROM main.priority_cards WHERE activity_id IS NOT NULL').all().forEach((c) => mirrorCards(c.activity_id));

  const noteByPd = db.prepare(`SELECT x.id, x.pipedrive_pending FROM main.ticket_comments x JOIN main.tickets t ON t.id = x.ticket_id
    WHERE x.pipedrive_id = ? AND t.archive_set_id IS NULL`);
  // Notes deleted in KIT, and the notes KIT made for linked documents, aren't brought back as notes.
  const notNotes = new Set([...deletedIds('note'), ...db.prepare('SELECT pipedrive_note_id FROM main.ticket_files WHERE pipedrive_note_id IS NOT NULL').all().map((x) => x.pipedrive_note_id)]);
  const seenNotes = new Set();
  notes.forEach((n) => {
    const ticketId = tickets.get(n.deal_id);
    const body = htmlToText(n.content).replace(FROM_KIT, '');
    if (!ticketId || notNotes.has(n.id)) { tally('notesSkipped'); return; }
    seenNotes.add(n.id);
    if (!body) return;
    const row = noteByPd.get(n.id);
    const fields = { ticket_id: ticketId, body, pinned: n.pinned_to_deal_flag ? 1 : 0 };
    if (row?.pipedrive_pending) return; // edited in KIT and not sent yet: KIT's version wins
    if (row) {
      db.prepare('UPDATE ticket_comments SET ticket_id = @ticket_id, body = @body, pinned = @pinned WHERE id = @id').run({ ...fields, id: row.id });
      tally('notesUpdated');
    } else {
      db.prepare(`INSERT INTO ticket_comments (ticket_id, kind, body, author_id, created_at, pinned, pipedrive_id)
        VALUES (@ticket_id, 'note', @body, @author, @at, @pinned, @pd)`).run({ ...fields, author: account(n.user_id), at: sqlTime(n.add_time), pd: n.id });
      tally('notesAdded');
    }
  });
  if (complete || scopeKind === 'deals') {
    db.prepare(`SELECT id, pipedrive_id FROM main.ticket_comments WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 0 AND ticket_id IN (SELECT value FROM json_each(?))`).all(coveredIds)
      .filter((m) => !seenNotes.has(m.pipedrive_id) && !notNotes.has(m.pipedrive_id)).forEach((m) => {
        db.prepare('DELETE FROM ticket_comments WHERE id = ? OR parent_id = ?').run(m.id, m.id);
        tally('notesDeleted');
      });
  }

  const fileByPd = db.prepare(onLiveTicket('ticket_files'));
  files.forEach((f) => {
    const ticketId = tickets.get(f.deal_id);
    const row = fileByPd.get(f.id);
    if (row) { db.prepare('UPDATE ticket_files SET ticket_id = ? WHERE id = ?').run(ticketId, row.id); return; }
    const got = downloaded.get(f.id);
    if (!got) return;
    db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by, created_at, pipedrive_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ticketId, f.name || f.file_name, got.stored, MIME[path.extname(f.name || '').toLowerCase()] || null, got.size, account(f.user_id), sqlTime(f.add_time), f.id);
    tally('filesAdded');
  });

  filesGone.forEach((id) => {
    db.prepare("DELETE FROM work_log WHERE kind = 'file' AND ref_id IN (SELECT id FROM main.ticket_files WHERE pipedrive_id = ?)").run(id);
    if (db.prepare('DELETE FROM main.ticket_files WHERE pipedrive_id = ?').run(id).changes) tally('filesDeleted');
  });

  // Products: matched by Pipedrive's deal-product id; a product gone from the deal in Pipedrive goes here too, unless KIT
  // changed it and hasn't sent that yet.
  const productByPd = db.prepare(onLiveTicket('ticket_products').replace('SELECT x.id', 'SELECT x.*'));
  const deletedProducts = deletedIds('product');
  const seenProducts = new Set();
  products.forEach((p) => {
    const ticketId = tickets.get(p.deal_id);
    if (!ticketId || deletedProducts.has(p.id)) return;
    seenProducts.add(p.id);
    const view = productView(p);
    const row = productByPd.get(p.id);
    const fields = { ...merged(row, view, PRODUCT_TRACKED), ticket_id: ticketId, product_pipedrive_id: p.product_id ?? null, sum: p.sum ?? null, snapshot: snapshotOf(view, PRODUCT_TRACKED) };
    if (row) {
      db.prepare(`UPDATE ticket_products SET ticket_id = @ticket_id, name = @name, quantity = @quantity, item_price = @item_price, discount = @discount, tax = @tax, comments = @comments,
        billing_frequency = @billing_frequency, billing_frequency_cycles = @billing_frequency_cycles, billing_start_date = @billing_start_date, is_enabled = @is_enabled,
        product_pipedrive_id = @product_pipedrive_id, sum = @sum, pipedrive_snapshot = @snapshot WHERE id = @id`).run({ ...fields, id: row.id });
      tally('productsUpdated');
    } else {
      db.prepare(`INSERT INTO ticket_products (ticket_id, name, quantity, item_price, discount, tax, comments, billing_frequency, billing_frequency_cycles, billing_start_date,
          is_enabled, product_pipedrive_id, sum, position, pipedrive_id, pipedrive_snapshot)
        VALUES (@ticket_id, @name, @quantity, @item_price, @discount, @tax, @comments, @billing_frequency, @billing_frequency_cycles, @billing_start_date, @is_enabled,
          @product_pipedrive_id, @sum, (SELECT COALESCE(MAX(position) + 1, 0) FROM main.ticket_products WHERE ticket_id = @ticket_id), @pd, @snapshot)`)
        .run({ ...fields, pd: p.id });
      tally('productsAdded');
    }
  });
  db.prepare(`SELECT id, pipedrive_id FROM main.ticket_products WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 0 AND ticket_id IN (SELECT value FROM json_each(?))`).all(coveredIds)
    .filter((p) => !seenProducts.has(p.pipedrive_id) && !deletedProducts.has(p.pipedrive_id)).forEach((p) => {
      db.prepare('DELETE FROM ticket_products WHERE id = ?').run(p.id);
      tally('productsDeleted');
    });

  if (installmentsOk) {
    const instByPd = db.prepare(onLiveTicket('ticket_installments').replace('SELECT x.id', 'SELECT x.*'));
    const deletedInst = deletedIds('installment');
    const seenInst = new Set();
    installments.forEach((i) => {
      const ticketId = tickets.get(i.deal_id);
      if (!ticketId || deletedInst.has(i.id)) return;
      seenInst.add(i.id);
      const view = installmentView(i);
      const row = instByPd.get(i.id);
      const fields = { ...merged(row, view, INSTALLMENT_TRACKED), ticket_id: ticketId, snapshot: snapshotOf(view, INSTALLMENT_TRACKED) };
      if (row) {
        db.prepare('UPDATE ticket_installments SET ticket_id = @ticket_id, description = @description, amount = @amount, billing_date = @billing_date, pipedrive_snapshot = @snapshot WHERE id = @id')
          .run({ ...fields, id: row.id });
      } else {
        db.prepare(`INSERT INTO ticket_installments (ticket_id, description, amount, billing_date, pipedrive_id, pipedrive_snapshot)
          VALUES (@ticket_id, @description, @amount, @billing_date, @pd, @snapshot)`).run({ ...fields, pd: i.id });
        tally('installmentsAdded');
      }
    });
    db.prepare(`SELECT id, pipedrive_id FROM main.ticket_installments WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 0 AND ticket_id IN (SELECT value FROM json_each(?))`).all(coveredIds)
      .filter((x) => !seenInst.has(x.pipedrive_id) && !deletedInst.has(x.pipedrive_id)).forEach((x) => {
        db.prepare('DELETE FROM ticket_installments WHERE id = ?').run(x.id);
        tally('installmentsDeleted');
      });
  }

  return { count, matched: [...new Set(matched)].sort(), created: created.sort(), account, tickets, contacts: contactOf, organization };
}

/**
 * Hold files deleted in Pipedrive instead of deleting them in KIT: they're listed for an admin, who deletes them or keeps
 * them as KIT's own. Every admin is alerted. Returns how many are now held.
 */
function holdFiles({ deal, project }) {
  const now = fileHold() || { at: null, files: [] };
  const have = new Set(now.files.map((f) => f.pipedrive_id));
  const rows = [
    ...db.prepare(`SELECT f.id, f.pipedrive_id, f.original_name AS name, f.ticket_id, t.opportunity_title AS title, t.pipedrive_deleted_at FROM main.ticket_files f
      JOIN main.tickets t ON t.id = f.ticket_id WHERE f.pipedrive_id IN (SELECT value FROM json_each(?))`).all(json.str(deal))
      .map((f) => ({ table: 'ticket_files', id: f.id, pipedrive_id: f.pipedrive_id, name: f.name, ticket_id: f.ticket_id, title: f.title, deal_gone: !!f.pipedrive_deleted_at })),
    ...db.prepare(`SELECT f.id, f.pipedrive_id, f.original_name AS name, f.program_id, p.name AS title, p.ticket_id FROM main.delivery_files f
      JOIN main.delivery_programs p ON p.id = f.program_id WHERE f.pipedrive_id IN (SELECT value FROM json_each(?))`).all(json.str(project))
      .map((f) => ({ table: 'delivery_files', id: f.id, pipedrive_id: f.pipedrive_id, name: f.name, program_id: f.program_id, ticket_id: f.ticket_id, title: f.title, deal_gone: false })),
  ].filter((f) => !have.has(f.pipedrive_id));
  if (!rows.length) return 0;
  const files = [...now.files, ...rows];
  setSetting('pipedrive_file_hold', json.str({ at: new Date().toISOString(), files }));
  // Tell every admin once per hold.
  db.prepare(`INSERT INTO alerts (user_id, kind, excerpt) SELECT id, 'pipedrive_file_hold', ? FROM users WHERE role = 'admin' AND active = 1
    AND id NOT IN (SELECT user_id FROM alerts WHERE kind = 'pipedrive_file_hold' AND read_at IS NULL)`).run(String(files.length));
  return rows.length;
}

/**
 * An admin's decision on held files. 'delete' deletes them in KIT (as Pipedrive did). 'keep' makes them KIT's own files, never
 * sent back; a ticket whose deal is gone from Pipedrive becomes a KIT-only ticket on KIT's own pipeline, back on the boards.
 */
export function decideFileHold(action) {
  const hold = fileHold();
  if (!hold) return { files: 0, tickets: 0 };
  const stored = [];
  let tickets = 0;
  db.transaction(() => {
    for (const f of hold.files) {
      const tbl = f.table === 'delivery_files' ? 'delivery_files' : 'ticket_files';
      const row = db.prepare(`SELECT * FROM ${tbl} WHERE id = ?`).get(f.id);
      if (!row) continue;
      if (action === 'delete') {
        if (tbl === 'ticket_files') db.prepare("DELETE FROM work_log WHERE kind = 'file' AND ref_id = ?").run(row.id);
        db.prepare(`DELETE FROM ${tbl} WHERE id = ?`).run(row.id);
        if (row.stored_name && !row.url) stored.push(row.stored_name);
      } else {
        db.prepare(`UPDATE ${tbl} SET pipedrive_id = NULL, pipedrive_detached = 1 WHERE id = ?`).run(row.id);
        if (f.deal_gone && f.ticket_id) {
          const t = db.prepare('SELECT * FROM tickets WHERE id = ? AND pipedrive_deleted_at IS NOT NULL').get(f.ticket_id);
          if (t) {
            const stage = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation', 'Awarded', 'Lost'].includes(t.pipeline_status) ? t.pipeline_status : null;
            db.prepare(`UPDATE tickets SET pipedrive_id = NULL, pipeline_id = NULL, pipeline_status = ?, archived_at = NULL, pipedrive_deleted_at = NULL,
              pipedrive_snapshot = NULL, labels_pending = 0, updated_at = datetime('now') WHERE id = ?`).run(stage, t.id);
            tickets += 1;
          }
        }
      }
    }
    setSetting('pipedrive_file_hold', 'null');
    db.prepare("UPDATE alerts SET read_at = datetime('now') WHERE kind = 'pipedrive_file_hold' AND read_at IS NULL").run();
  })();
  stored.forEach((name) => fs.rmSync(path.join(uploadDir, name), { force: true }));
  return { files: hold.files.length, tickets };
}

/** Pull everything every night at 2 a.m. (server time) while a key is set. */
export function schedulePipedriveSync() {
  if (!pipedriveConfigured()) return;
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    if (pullsAllowed()) { try { startPull({ kind: 'all' }); } catch (e) { console.error('Pipedrive nightly pull:', e.message); } }
    schedulePipedriveSync();
  }, next - new Date()).unref();
}

// Pipedrive has no webhooks for Projects or tasks, so they're refreshed every so often (and field definitions with them).
const PROJECTS_EVERY = 10 * 60 * 1000;
export function scheduleProjectRefresh() {
  if (!pipedriveConfigured()) return;
  setInterval(() => {
    if (syncStatus().running || !pullsAllowed()) return;
    try { startPull({ kind: 'projects' }); } catch (e) { if (!/busy/i.test(e.message)) console.error('Pipedrive projects refresh:', e.message); }
  }, PROJECTS_EVERY).unref();
}
