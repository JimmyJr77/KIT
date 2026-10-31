// Pipedrive → KIT sync. One way: Pipedrive is the source of truth for what it holds, so each sync updates the records
// it brought in before (matched by pipedrive_id) and adds new ones. KIT's own work on a ticket (priorities, strategy,
// assessments, comments) is never touched.
//
// What comes over: pipelines and their stages (KIT makes a pipeline to match each one), deals as bid tickets (closed
// ones already archived, dated when they closed), people as CRM contacts, and each deal's activities, notes and files.
// Pipedrive users are matched to KIT accounts by email; an owner with no KIT account gets one to claim.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json, getSetting, setSetting } from '../db.js';
import { hashPassword } from '../auth.js';
import '../sample/registry.js'; // archived_rows, used to skip records archived by a full reset

const API = 'https://api.pipedrive.com/v1';
const apiKey = () => process.env.PIPEDRIVE_API_KEY;
export const pipedriveConfigured = () => !!apiKey();
// Pipedrive keeps activity times in UTC; KIT shows them in the team's time zone.
const TIME_ZONE = process.env.PIPEDRIVE_TIME_ZONE || 'America/New_York';
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');

// The "Account" deal field holds the territory, under slightly different names.
const ACCOUNT_TERRITORIES = {
  Army: 'Army', 'Navy/USMC': 'Navy / Marine Corps', 'USAF/USSF': 'Air Force & Space Force', 'DoD 4th Estate': 'DoD 4th Estate',
  'DHS/DOJ': 'DHS & FBI', Intel: 'Intelligence Community (Agencies)', 'FedCiv (Other)': 'FedCiv & Other',
};
const ACTIVITY_TYPES = { call: 'Call', meeting: 'Meeting', task: 'Task', deadline: 'Deadline', email: 'Email', lunch: 'Lunch' };
const OWNER_FIELD = 'Pipedrive owner';
const MIME = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip' };

// ---- Reading from Pipedrive

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function call(p, query = {}, { raw = false } = {}) {
  const u = new URL(`${API}/${p}`);
  Object.entries({ ...query, api_token: apiKey() }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 0; ; attempt += 1) {
    const r = await fetch(u);
    if (r.status === 429 && attempt < 6) { await sleep((Number(r.headers.get('retry-after')) || 2) * 1000); continue; }
    if (!r.ok) throw new Error(`Pipedrive ${p}: ${r.status} ${r.statusText}`);
    if (raw) return Buffer.from(await r.arrayBuffer());
    const j = await r.json();
    if (!j.success) throw new Error(`Pipedrive ${p}: ${j.error || 'request failed'}`);
    return j;
  }
}

async function all(p, query = {}) {
  let out = [];
  for (let start = 0; ;) {
    const j = await call(p, { ...query, start, limit: 500 });
    out = out.concat(j.data || []);
    const page = j.additional_data?.pagination;
    if (!page?.more_items_in_collection) return out;
    start = page.next_start;
  }
}

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
function localDateTime(date, time) {
  if (!date) return { date: null, time: null };
  if (!time) return { date, time: null };
  const d = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const primary = (list) => (Array.isArray(list) ? (list.find((x) => x.primary) || list[0])?.value : list) || null;
const idOf = (v) => (v && typeof v === 'object' ? v.value ?? v.id : v) ?? null;
const later = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** First and last name for a Pipedrive user, from their name or, failing that, their email ("kathy.devereaux@…"). */
function splitName(name, email) {
  const clean = String(name || '').trim();
  const words = clean.includes('@') ? [] : clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return { first_name: words[0], last_name: words.slice(1).join(' ') };
  const local = String(email || '').split('@')[0].split(/[._-]+/).filter(Boolean).map(capitalize);
  if (local.length >= 2) return { first_name: words[0] || local[0], last_name: local.slice(1).join(' ') };
  return { first_name: words[0] || local[0] || 'Pipedrive', last_name: '' };
}

/** A custom field's value as text, with option ids turned into their labels. */
function fieldText(field, value) {
  if (value == null || value === '') return null;
  if (field.options && (field.field_type === 'enum' || field.field_type === 'set')) {
    return String(value).split(',').map((id) => field.options.find((o) => String(o.id) === id.trim())?.label).filter(Boolean).join(', ') || null;
  }
  if (typeof value === 'object') return value.name ?? value.value ?? null;
  return String(value);
}

// ---- The sync

let status = { running: false };
export const syncStatus = () => ({ ...status, configured: pipedriveConfigured(), last: json.parse(getSetting('pipedrive_last_sync'), null) });

/** Start a sync in the background (one at a time). `by` is the KIT user who asked, or null for the nightly run. */
export function startSync(by = null) {
  if (!pipedriveConfigured()) throw new Error('Add PIPEDRIVE_API_KEY to the server settings to sync with Pipedrive.');
  if (status.running) throw new Error('A Pipedrive sync is already running.');
  status = { running: true, phase: 'Reading Pipedrive', started_at: new Date().toISOString() };
  syncNow(by)
    .then((result) => {
      const last = { at: new Date().toISOString(), by: by?.name || null, ok: true, result };
      setSetting('pipedrive_last_sync', json.str(last));
      status = { running: false };
    })
    .catch((e) => {
      console.error('Pipedrive sync:', e);
      setSetting('pipedrive_last_sync', json.str({ at: new Date().toISOString(), by: by?.name || null, ok: false, error: e.message }));
      status = { running: false };
    });
}

/** Read everything from Pipedrive, then write it to KIT in one transaction. Returns what changed. */
export async function syncNow(by = null) {
  const phase = (p) => { status.phase = p; };
  phase('Reading Pipedrive');
  const [users, pipelines, stages, dealFields, deals, persons, activities, notes, files] = await Promise.all([
    all('users'), all('pipelines'), all('stages'), all('dealFields'), all('deals', { status: 'all_not_deleted' }),
    all('persons'), all('activities', { user_id: 0 }), all('notes'), all('files'),
  ]);

  // Download deal files KIT doesn't have yet (images pasted into notes stay with the notes in Pipedrive).
  phase('Downloading files');
  const known = new Set(db.prepare('SELECT pipedrive_id FROM main.ticket_files WHERE pipedrive_id IS NOT NULL').all().map((f) => f.pipedrive_id));
  const dealIds = new Set(deals.map((d) => d.id));
  const wanted = files.filter((f) => f.deal_id && dealIds.has(f.deal_id) && !f.inline_flag && f.active_flag !== false);
  fs.mkdirSync(uploadDir, { recursive: true });
  const downloaded = new Map();
  for (const f of wanted.filter((x) => !known.has(x.id))) {
    try {
      const buf = await call(`files/${f.id}/download`, {}, { raw: true });
      const stored = `${crypto.randomUUID()}${path.extname(f.name || '') || ''}`;
      fs.writeFileSync(path.join(uploadDir, stored), buf);
      downloaded.set(f.id, { stored, size: buf.length });
    } catch (e) {
      console.error(`Pipedrive file ${f.id}: ${e.message}`);
    }
  }

  phase('Saving to KIT');
  try {
    return db.transaction(() => write({ users, pipelines, stages, dealFields, deals, persons, activities, notes, files: wanted, downloaded, by }))();
  } catch (e) {
    // Nothing was saved, so the files just downloaded aren't needed.
    downloaded.forEach((d) => fs.rmSync(path.join(uploadDir, d.stored), { force: true }));
    throw e;
  }
}

function write({ users, pipelines, stages, dealFields, deals, persons, activities, notes, files, downloaded }) {
  const count = {};
  const tally = (k) => { count[k] = (count[k] || 0) + 1; };

  // ---- People: Pipedrive users → KIT accounts, by email
  const bd = db.prepare("SELECT id FROM teams WHERE name = 'BD'").get()?.id;
  const pdUsers = new Map(users.map((u) => [u.id, u]));
  const accounts = new Map(); // Pipedrive user id → KIT user id (or null)
  const matched = [];
  const created = [];
  const findByEmail = db.prepare('SELECT id, first_name, last_name FROM main.users WHERE email = ? COLLATE NOCASE');
  const usernameTaken = db.prepare('SELECT 1 FROM main.users WHERE username = ? COLLATE NOCASE');
  const account = (pdId, create = false) => {
    const id = idOf(pdId);
    if (!id) return null;
    if (accounts.has(id) && (accounts.get(id) || !create)) return accounts.get(id);
    const u = pdUsers.get(id) || (typeof pdId === 'object' ? pdId : null);
    const email = String(u?.email || '').trim().toLowerCase();
    let kitId = null;
    if (email) {
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
        if (bd) db.prepare("INSERT OR IGNORE INTO user_teams (user_id, team_id, role) VALUES (?, ?, 'member')").run(kitId, bd);
        db.prepare('INSERT OR IGNORE INTO approved_accounts (email, role, team_ids) VALUES (?, ?, ?)').run(email, 'member', json.str(bd ? [bd] : []));
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
  const liveStages = JSON.stringify(stages.map((s) => s.id));
  db.prepare('DELETE FROM pipeline_stages WHERE pipedrive_id IS NOT NULL AND pipedrive_id NOT IN (SELECT value FROM json_each(?))').run(liveStages);

  // ---- Deal fields
  const fieldByKey = new Map(dealFields.map((f) => [f.key, f]));
  const customFields = dealFields.filter((f) => f.edit_flag);
  const accountField = customFields.find((f) => f.name === 'Account');
  const labelField = fieldByKey.get('label');
  const channelField = fieldByKey.get('channel');
  const territories = new Map(db.prepare('SELECT id, name FROM territories').all().map((t) => [t.name, t.id]));
  const pdFieldNames = new Set([...customFields.map((f) => f.name), OWNER_FIELD]);

  // ---- People in the CRM: Pipedrive persons → contacts
  const notArchived = (tbl, col = 'rowid') => `${col} NOT IN (SELECT row_id FROM main.archived_rows WHERE tbl = '${tbl}')`;
  const contactByPd = db.prepare(`SELECT id FROM main.contacts WHERE pipedrive_id = ? AND ${notArchived('contacts', 'id')}`);
  const contactByEmail = db.prepare(`SELECT id FROM main.contacts WHERE pipedrive_id IS NULL AND email = ? COLLATE NOCASE AND ${notArchived('contacts', 'id')}
    AND id NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = 'contacts') LIMIT 1`);
  const contacts = new Map();
  persons.forEach((p) => {
    const email = primary(p.email);
    const fields = {
      first_name: (p.first_name || p.name || '').trim() || '(no name)', last_name: (p.first_name ? p.last_name : null) || null,
      organization: p.org_name || p.org_id?.name || null, role: p.job_title || null, email, phone: primary(p.phone),
    };
    const existing = contactByPd.get(p.id) || (email && contactByEmail.get(email));
    if (existing) {
      db.prepare(`UPDATE contacts SET first_name = @first_name, last_name = @last_name, organization = @organization, role = COALESCE(@role, role),
        email = @email, phone = @phone, pipedrive_id = @pd, updated_at = @updated WHERE id = @id`).run({ ...fields, pd: p.id, updated: p.update_time, id: existing.id });
      contacts.set(p.id, existing.id);
      tally('contactsUpdated');
    } else {
      contacts.set(p.id, db.prepare(`INSERT INTO contacts (first_name, last_name, organization, role, email, phone, created_by, created_at, updated_at, pipedrive_id)
        VALUES (@first_name, @last_name, @organization, @role, @email, @phone, @by, @at, @updated, @pd)`)
        .run({ ...fields, by: account(p.owner_id), at: p.add_time, updated: p.update_time, pd: p.id }).lastInsertRowid);
      tally('contactsAdded');
    }
  });
  const linkContact = db.prepare('INSERT OR IGNORE INTO ticket_contacts (ticket_id, contact_id) VALUES (?, ?)');

  // ---- Deals → bid tickets
  const ticketByPd = db.prepare('SELECT * FROM main.tickets WHERE pipedrive_id = ? AND archive_set_id IS NULL');
  const ticketByTitle = db.prepare(`SELECT * FROM main.tickets WHERE pipedrive_id IS NULL AND ticket_type = 'bid' AND archive_set_id IS NULL
    AND opportunity_title = ? COLLATE NOCASE AND id NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = 'tickets') LIMIT 1`);
  const lastHistory = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM ticket_history WHERE ticket_id = ?');
  const dateHistory = db.prepare('UPDATE ticket_history SET changed_at = ? WHERE ticket_id = ? AND id > ?');
  const tickets = new Map();

  deals.forEach((d) => {
    const pipelineId = pipelineIds.get(d.pipeline_id) ?? null;
    const stage = stageNames.get(d.stage_id) || null;
    const statusNow = d.status === 'won' ? 'Awarded' : d.status === 'lost' ? 'Lost' : stage;
    const closedAt = d.status === 'won' ? d.won_time || d.close_time : d.status === 'lost' ? d.lost_time || d.close_time
      : statusNow === 'Awarded' ? d.stage_change_time || d.update_time : null; // still open, but in an Awarded stage
    const owner = account(d.user_id);
    const territory = ACCOUNT_TERRITORIES[fieldText(accountField || {}, accountField && d[accountField.key])];
    const custom = customFields.map((f) => ({ name: f.name, value: fieldText(f, d[f.key]) })).filter((f) => f.value);
    if (!owner && d.user_id) custom.push({ name: OWNER_FIELD, value: d.user_id.name || d.owner_name || 'Unknown' });
    const fields = {
      opportunity_title: d.title || `Pipedrive deal ${d.id}`, organization: d.org_name || null, value: d.value ?? null,
      currency: d.currency && d.currency !== 'USD' ? d.currency : null, probability: d.probability ?? null, lost_reason: d.status === 'lost' ? d.lost_reason || null : null,
      labels: json.str(labelField && d.label ? fieldText(labelField, d.label).split(', ').filter(Boolean) : []),
      source: (channelField && fieldText(channelField, d.channel)) || null, projected_win_date: d.expected_close_date || null,
      pipeline_id: pipelineId,
    };

    let t = ticketByPd.get(d.id) || ticketByTitle.get(fields.opportunity_title);
    if (!t) {
      // New: start it at its stage on the day it was added, then close it if it's closed, so its history reads right.
      // A deal lost while sitting in an "Awarded" stage starts as Lost, so it never looks won (or gets a contract).
      const start = ['Awarded', 'Lost'].includes(stage) && stage !== statusNow ? statusNow : stage;
      const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, value, created_by, created_at, updated_at, ticket_type,
          bd_director_id, territory_id, currency, probability, lost_reason, labels, source, projected_win_date, pipeline_id, custom_fields, pipedrive_id)
        VALUES (@opportunity_title, @organization, @stage, @value, @owner, @added, @updated, 'bid', @owner, @territory, @currency, @probability, @lost_reason,
          @labels, @source, @projected_win_date, @pipeline_id, @custom, @pd)`)
        .run({ ...fields, stage: start, owner, added: d.add_time, updated: d.update_time, territory: territories.get(territory) ?? null, custom: json.str(custom), pd: d.id }).lastInsertRowid;
      dateHistory.run(d.add_time, id, 0);
      if (statusNow !== start) {
        const before = lastHistory.get(id).id;
        db.prepare('UPDATE tickets SET pipeline_status = ? WHERE id = ?').run(statusNow, id);
        dateHistory.run(closedAt || d.update_time, id, before);
      }
      t = { id, pipeline_status: start, fresh: true };
      tally('dealsAdded');
    } else {
      const before = lastHistory.get(t.id).id;
      const kept = json.parse(t.custom_fields, []).filter((f) => !pdFieldNames.has(f.name));
      db.prepare(`UPDATE tickets SET opportunity_title = @opportunity_title, organization = @organization, pipeline_status = @status, value = @value,
          currency = @currency, probability = @probability, lost_reason = @lost_reason, labels = @labels, source = @source,
          projected_win_date = COALESCE(@projected_win_date, projected_win_date), pipeline_id = @pipeline_id, custom_fields = @custom, pipedrive_id = @pd,
          bd_director_id = COALESCE(@owner, bd_director_id), territory_id = COALESCE(@territory, territory_id),
          updated_at = CASE WHEN updated_at > @updated THEN updated_at ELSE @updated END
        WHERE id = @id`)
        .run({ ...fields, status: statusNow, owner, territory: territories.get(territory) ?? null, custom: json.str([...custom, ...kept]), pd: d.id, updated: d.update_time, id: t.id });
      // Date any change the update logged when it happened in Pipedrive, not now.
      const stageChanged = t.pipeline_status !== statusNow;
      dateHistory.run(stageChanged ? (closedAt || d.stage_change_time || d.update_time) : d.update_time, t.id, before);
      tally('dealsUpdated');
    }
    // A closed deal is Done as of when it closed (so it's archived once that's 14 days past), and a won one's contract
    // is dated when it was won.
    if (closedAt && (t.fresh || t.pipeline_status !== statusNow)) {
      db.prepare('UPDATE tickets SET done_at = ? WHERE id = ?').run(closedAt, t.id);
      if (statusNow === 'Awarded') db.prepare('UPDATE delivery_programs SET awarded_at = ? WHERE ticket_id = ?').run(closedAt, t.id);
    }
    const person = contacts.get(idOf(d.person_id));
    if (person) {
      linkContact.run(t.id, person);
      db.prepare('UPDATE ticket_contacts SET is_primary = (contact_id = ?) WHERE ticket_id = ?').run(person, t.id);
    }
    tickets.set(d.id, t.id);
  });

  // ---- A deal's activities, notes and files
  const onLiveTicket = (tbl) => `SELECT x.id FROM main.${tbl} x JOIN main.tickets t ON t.id = x.ticket_id WHERE x.pipedrive_id = ? AND t.archive_set_id IS NULL`;
  const taskByPd = db.prepare(onLiveTicket('ticket_tasks'));
  activities.forEach((a) => {
    const ticketId = tickets.get(a.deal_id);
    if (!ticketId) { tally('activitiesSkipped'); return; }
    const when = localDateTime(a.due_date, a.due_time);
    const fields = {
      ticket_id: ticketId, text: a.subject || a.type_name || 'Activity', activity_type: ACTIVITY_TYPES[a.type] || a.type_name || null,
      due_date: when.date, due_time: when.time, duration: a.duration || null, assignee_id: account(a.assigned_to_user_id || a.user_id),
      location: a.location || null, note: htmlToText(a.note) || null, description: htmlToText(a.public_description) || null,
      video_call: a.conference_meeting_url || null, organization: a.org_name || null, done: a.done ? 1 : 0, done_at: a.done ? a.marked_as_done_time || null : null,
    };
    const row = taskByPd.get(a.id);
    let id = row?.id;
    if (id) {
      db.prepare(`UPDATE ticket_tasks SET ticket_id = @ticket_id, text = @text, activity_type = @activity_type, due_date = @due_date, due_time = @due_time,
        duration = @duration, assignee_id = @assignee_id, location = @location, note = @note, description = @description, video_call = @video_call,
        organization = @organization, done = @done, done_at = @done_at WHERE id = @id`).run({ ...fields, id });
      tally('activitiesUpdated');
    } else {
      id = db.prepare(`INSERT INTO ticket_tasks (ticket_id, text, activity_type, due_date, due_time, duration, assignee_id, location, note, description,
          video_call, organization, done, done_at, created_by, created_at, position, pipedrive_id)
        VALUES (@ticket_id, @text, @activity_type, @due_date, @due_time, @duration, @assignee_id, @location, @note, @description, @video_call,
          @organization, @done, @done_at, @by, @at, (SELECT COALESCE(MAX(position) + 1, 0) FROM main.ticket_tasks WHERE ticket_id = @ticket_id), @pd)`)
        .run({ ...fields, by: account(a.created_by_user_id), at: a.add_time, pd: a.id }).lastInsertRowid;
      tally('activitiesAdded');
    }
    db.prepare('DELETE FROM task_participants WHERE task_id = ?').run(id);
    (a.participants || []).forEach((p) => {
      const c = contacts.get(p.person_id);
      if (!c) return;
      db.prepare('INSERT OR IGNORE INTO task_participants (task_id, contact_id) VALUES (?, ?)').run(id, c);
      linkContact.run(ticketId, c);
    });
  });

  const noteByPd = db.prepare(onLiveTicket('ticket_comments'));
  notes.forEach((n) => {
    const ticketId = tickets.get(n.deal_id);
    const body = htmlToText(n.content);
    if (!ticketId || !body) { tally('notesSkipped'); return; }
    const row = noteByPd.get(n.id);
    const fields = { ticket_id: ticketId, body, pinned: n.pinned_to_deal_flag ? 1 : 0 };
    if (row) {
      db.prepare('UPDATE ticket_comments SET ticket_id = @ticket_id, body = @body, pinned = @pinned WHERE id = @id').run({ ...fields, id: row.id });
      tally('notesUpdated');
    } else {
      db.prepare(`INSERT INTO ticket_comments (ticket_id, kind, body, author_id, created_at, pinned, pipedrive_id)
        VALUES (@ticket_id, 'note', @body, @author, @at, @pinned, @pd)`).run({ ...fields, author: account(n.user_id), at: n.add_time, pd: n.id });
      tally('notesAdded');
    }
  });

  const fileByPd = db.prepare(onLiveTicket('ticket_files'));
  files.forEach((f) => {
    const ticketId = tickets.get(f.deal_id);
    const row = fileByPd.get(f.id);
    if (row) { db.prepare('UPDATE ticket_files SET ticket_id = ? WHERE id = ?').run(ticketId, row.id); return; }
    const got = downloaded.get(f.id);
    if (!got) return;
    db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by, created_at, pipedrive_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(ticketId, f.name || f.file_name, got.stored, MIME[path.extname(f.name || '').toLowerCase()] || null, got.size, account(f.user_id), f.add_time, f.id);
    tally('filesAdded');
  });

  return { ...count, accountsMatched: [...new Set(matched)].sort(), accountsCreated: created.sort() };
}

/** Sync every night at 2 a.m. (server time) while a key is set. */
export function schedulePipedriveSync() {
  if (!pipedriveConfigured()) return;
  const next = new Date();
  next.setHours(2, 0, 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  setTimeout(() => {
    try { startSync(null); } catch (e) { console.error('Pipedrive nightly sync:', e.message); }
    schedulePipedriveSync();
  }, next - new Date()).unref();
}
