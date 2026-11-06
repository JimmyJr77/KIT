// KIT → Pipedrive. Every kind of change (deal fields, tags, notes, activities, files and their deletions, products,
// installments, followers, people, organizations, projects) is Auto unless an admin sets it to On push or Do not send.
// Auto kinds go on their own a minute or so after they change; Manual and Auto kinds go when an admin pushes, after a
// preview of exactly that.
//
// What counts as a change: a shared field whose KIT value differs from what Pipedrive held at the last pull (the
// snapshot), and anything made or deleted in KIT that Pipedrive doesn't have. Before sending a field, the record is read
// again: if Pipedrive changed that field since the last pull, it's left alone and listed as a conflict, so a send never
// overwrites someone's newer work in Pipedrive. The next pull settles it (Pipedrive wins).
import fs from 'node:fs';
import path from 'node:path';
import { db, json, setSetting, getSetting } from '../db.js';
import {
  call, all, allCursor, idOf, runJob, sendingAllowed, sendingBlockedReason, syncStatus, syncDirection, pullsAllowed, pull, dealView, activityView, personView, organizationView, productView, installmentView,
  kitChanges, snapshotOf, same, dealTracked, TASK_TRACKED, CONTACT_TRACKED, ORG_TRACKED, PRODUCT_TRACKED, INSTALLMENT_TRACKED, ACTIVITY_TYPES, uploadDir,
} from './pipedrive.js';
import { fieldByKey, fieldByName, fieldValue, labelIds, withCustom, customKeyOf, customDealFields, ACCOUNT_FIELD } from './pipedriveFields.js';
import { projectView, taskView, projectActivityView, PROJECT_TRACKED, DTASK_TRACKED, DACT_TRACKED, PROJECT_STATUS_OF } from './pipedriveProjects.js';

const TIME_ZONE = process.env.PIPEDRIVE_TIME_ZONE || 'America/New_York';

export const SEND_KINDS = ['deals', 'labels', 'notes', 'activities', 'files', 'products', 'installments', 'followers', 'contacts', 'organizations', 'projects'];
export const FIELD_LABELS = {
  opportunity_title: 'Title', value: 'Value', pipeline_status: 'Stage', deal_status: 'Won / lost', lost_reason: 'Lost reason', probability: 'Probability',
  projected_win_date: 'Expected close date', bd_director_id: 'Owner', territory_id: 'Account (territory)', organization: 'Organization',
  text: 'Subject', activity_type: 'Type', due_date: 'Due date', due_time: 'Due time', duration: 'Duration', assignee_id: 'Assigned to',
  location: 'Location', note: 'Note', done: 'Done',
  first_name: 'First name', last_name: 'Last name', email: 'Email', phone: 'Phone', role: 'Title', labels: 'Labels',
  name: 'Name', address: 'Address', website: 'Website', linkedin: 'LinkedIn', industry: 'Industry', annual_revenue: 'Annual revenue', employee_count: 'Employees',
  quantity: 'Quantity', item_price: 'Price', discount: 'Discount', tax: 'Tax', comments: 'Comments', billing_frequency: 'Billing frequency',
  billing_frequency_cycles: 'Billing cycles', billing_start_date: 'Billing start', is_enabled: 'Enabled', description: 'Description', amount: 'Amount', billing_date: 'Billing date',
  notes: 'Overview', project_status: 'Status', start_date: 'Start date', end_date: 'End date', phase_id: 'Phase', owner_id: 'Owner', title: 'Title', parent_id: 'Parent task',
};
/** A field's label: custom deal fields by their Pipedrive name. */
export const fieldLabel = (f) => {
  const key = customKeyOf(f);
  return key ? fieldByKey('deal', key)?.name || key : FIELD_LABELS[f] || f;
};
const LIST_MAX = 200;

// ---- Off, Manual or Auto, per kind

const MODES = ['off', 'manual', 'auto'];
/**
 * Each kind's mode, from the sync direction: nothing goes with Pipedrive → KIT only; everything goes on its own with
 * KIT → Pipedrive only and two way; with a selective sync, each kind as the admin set it (Auto unless set).
 */
export function sendModes() {
  const d = syncDirection();
  if (d === 'to_kit') return Object.fromEntries(SEND_KINDS.map((k) => [k, 'off']));
  if (d !== 'selective') return Object.fromEntries(SEND_KINDS.map((k) => [k, 'auto']));
  return savedModes();
}
/** The per-kind choices an admin made for a selective sync. */
export function savedModes() {
  const saved = json.parse(getSetting('pipedrive_send_modes'), {});
  return Object.fromEntries(SEND_KINDS.map((k) => [k, MODES.includes(saved[k]) ? saved[k] : 'auto']));
}
/** `changes`: { kind: mode }, for some kinds. Returns every kind's mode. */
export function setSendModes(changes = {}) {
  const next = savedModes();
  Object.entries(changes).forEach(([k, m]) => { if (SEND_KINDS.includes(k) && MODES.includes(m)) next[k] = m; });
  setSetting('pipedrive_send_modes', json.str(next));
  return next;
}

// Followers and people have no record of what was last sent, so each deal keeps a signature of its followers and of its
// people as they were at the last send. Auto-send looks only at deals whose signature has changed since.
const SIGS = {
  followers: { column: 'pipedrive_followers_sent', sql: `COALESCE((SELECT group_concat(user_id) FROM (SELECT user_id FROM ticket_followers
    WHERE ticket_id = t.id ORDER BY user_id)), '')` },
  contacts: { column: 'pipedrive_people_sent', sql: `COALESCE((SELECT group_concat(x) FROM (SELECT contact_id || CASE WHEN is_primary THEN '*' ELSE '' END AS x
    FROM ticket_contacts WHERE ticket_id = t.id ORDER BY contact_id)), '')` },
};
const markSent = (kind, ticketId) => db.prepare(`UPDATE tickets AS t SET ${SIGS[kind].column} = ${SIGS[kind].sql} WHERE t.id = ?`).run(ticketId);

// ---- Which deals

/** Tickets linked to a Pipedrive deal, for picking which to send. */
export const linkedTickets = () => db.prepare(`SELECT t.id, t.opportunity_title AS title, t.pipeline_id, p.name AS pipeline FROM tickets t
  LEFT JOIN pipelines p ON p.id = t.pipeline_id WHERE t.pipedrive_id IS NOT NULL AND t.archive_set_id IS NULL ORDER BY t.opportunity_title COLLATE NOCASE`).all();

/** scope: {} for every linked deal, { pipeline_id }, or { ticket_ids: [] }. */
function ticketsIn(scope = {}) {
  const ids = Array.isArray(scope.ticket_ids) ? scope.ticket_ids.map(Number).filter(Boolean) : null;
  return db.prepare(`SELECT * FROM tickets WHERE pipedrive_id IS NOT NULL AND archive_set_id IS NULL AND pipedrive_deleted_at IS NULL
    ${scope.pipeline_id ? 'AND pipeline_id = @pipeline' : ''} ${ids ? 'AND id IN (SELECT value FROM json_each(@ids))' : ''}
    ORDER BY opportunity_title COLLATE NOCASE`).all({ pipeline: Number(scope.pipeline_id) || null, ids: json.str(ids || []) });
}
const everyDeal = (scope = {}) => !scope.pipeline_id && !Array.isArray(scope.ticket_ids);

// ---- Showing values

const name = (u) => (u ? `${u.first_name} ${u.last_name}`.trim() : null);
function shown(field, v) {
  if (v == null || v === '') return '—';
  if (['bd_director_id', 'assignee_id', 'owner_id'].includes(field)) return name(db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(v)) || '—';
  if (field === 'territory_id') return db.prepare('SELECT name FROM territories WHERE id = ?').get(v)?.name || '—';
  if (field === 'phase_id') return db.prepare('SELECT name FROM delivery_phases WHERE id = ?').get(v)?.name || '—';
  if (field === 'parent_id') return db.prepare('SELECT title FROM delivery_tasks WHERE id = ?').get(v)?.title || '—';
  if (['done', 'is_enabled'].includes(field)) return Number(v) ? 'Yes' : 'No';
  if (['value', 'item_price', 'amount'].includes(field)) return `$${Number(v).toLocaleString('en-US')}`;
  if (field === 'probability') return `${v}%`;
  if (field === 'labels') return json.parse(v, []).join(', ') || '—';
  if (field === 'deal_status') return { open: 'Open', won: 'Won', lost: 'Lost' }[v] || String(v);
  return String(v);
}
const changeList = (row, keys) => {
  const snap = json.parse(row.pipedrive_snapshot, {});
  return keys.map((k) => ({ field: k, label: fieldLabel(k), from: shown(k, snap[k]), to: shown(k, row[k]) }));
};
const short = (t, n = 90) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

// ---- The plan: what a send would do, from KIT alone (nothing is read from Pipedrive)

// Notes: comments on the ticket itself (not replies, and not ones on a priority, document or email, which Pipedrive
// has nowhere to put), and Pipedrive notes edited or pinned in KIT.
const NOTE_SQL = `SELECT m.*, t.pipedrive_id AS deal_id, t.opportunity_title AS title, u.first_name, u.last_name FROM ticket_comments m
  JOIN tickets t ON t.id = m.ticket_id LEFT JOIN users u ON u.id = m.author_id
  WHERE t.id IN (SELECT value FROM json_each(@ids)) AND m.parent_id IS NULL AND m.card_id IS NULL AND m.target_type IS NULL
    AND m.kind IN ('comment', 'note') AND (m.pipedrive_id IS NULL OR m.pipedrive_pending = 1)`;
const FILE_SQL = `SELECT f.*, t.pipedrive_id AS deal_id, t.opportunity_title AS title, u.first_name, u.last_name FROM ticket_files f
  JOIN tickets t ON t.id = f.ticket_id LEFT JOIN users u ON u.id = f.uploaded_by
  WHERE t.id IN (SELECT value FROM json_each(@ids)) AND f.email_id IS NULL AND f.pipedrive_id IS NULL AND f.pipedrive_note_id IS NULL AND f.pipedrive_detached = 0`;
const PROGRAM_SQL = `SELECT p.*, t.pipedrive_id AS deal_id, t.id AS ticket_id, t.opportunity_title AS title FROM delivery_programs p JOIN tickets t ON t.id = p.ticket_id
  WHERE t.id IN (SELECT value FROM json_each(@ids)) AND p.pipedrive_project_id IS NOT NULL AND p.project_status IS NOT 'deleted'`;
const DNOTE_SQL = `SELECT m.*, p.pipedrive_project_id AS project_id, p.ticket_id, p.name AS title, u.first_name, u.last_name FROM delivery_notes m
  JOIN delivery_programs p ON p.id = m.program_id LEFT JOIN users u ON u.id = m.author_id
  WHERE p.id IN (SELECT value FROM json_each(@pids)) AND (m.pipedrive_id IS NULL OR m.pipedrive_pending = 1)`;
const DFILE_SQL = `SELECT f.*, p.pipedrive_project_id AS project_id, p.ticket_id, p.name AS title, u.first_name, u.last_name FROM delivery_files f
  JOIN delivery_programs p ON p.id = f.program_id LEFT JOIN users u ON u.id = f.uploaded_by
  WHERE p.id IN (SELECT value FROM json_each(@pids)) AND f.pipedrive_id IS NULL AND f.pipedrive_detached = 0`;

/** With `auto`, followers and people only on deals where they changed. Deletions go either way. */
function plan(kinds, scope, { auto = false } = {}) {
  const tickets = ticketsIn(scope);
  const ids = json.str(tickets.map((t) => t.id));
  const dealIds = new Set(tickets.map((t) => t.pipedrive_id));
  const programs = db.prepare(PROGRAM_SQL).all({ ids });
  const pids = json.str(programs.map((p) => p.id));
  const projectIds = new Set(programs.map((p) => p.pipedrive_project_id));
  const deletes = (kind) => db.prepare('SELECT * FROM pipedrive_deletes WHERE kind = ?').all(kind)
    .filter((d) => (d.project_id ? projectIds.has(d.project_id) || everyDeal(scope) : d.deal_id ? dealIds.has(d.deal_id) : everyDeal(scope)));
  const changed = (kind) => new Set(db.prepare(`SELECT t.id FROM tickets t WHERE t.id IN (SELECT value FROM json_each(@ids))
    AND t.${SIGS[kind].column} IS NOT ${SIGS[kind].sql}`).all({ ids }).map((x) => x.id));
  const out = { tickets: tickets.length };
  const on = (k) => kinds.includes(k);
  const tracked = dealTracked();

  if (on('deals')) {
    out.deals = tickets.map((t) => ({ ticket_id: t.id, title: t.opportunity_title, fields: kitChanges(withCustom(t), tracked) }))
      .filter((d) => d.fields.length).map((d) => ({ ...d, changes: changeList(withCustom(tickets.find((t) => t.id === d.ticket_id)), d.fields) }));
  }
  if (on('labels')) out.labels = tickets.filter((t) => t.labels_pending).map((t) => ({ ticket_id: t.id, title: t.opportunity_title, labels: json.parse(t.labels, []) }));
  if (on('notes')) {
    const notes = db.prepare(NOTE_SQL).all({ ids });
    out.notes = {
      add: notes.filter((m) => !m.pipedrive_id).map((m) => ({ id: m.id, ticket_id: m.ticket_id, title: m.title, text: short(m.body), by: name(m) })),
      edit: notes.filter((m) => m.pipedrive_id).map((m) => ({ id: m.id, ticket_id: m.ticket_id, title: m.title, text: short(m.body) })),
      remove: deletes('note'),
    };
  }
  if (on('activities')) {
    const tasks = db.prepare(`SELECT k.*, t.opportunity_title AS title, t.pipedrive_id AS deal_id FROM ticket_tasks k JOIN tickets t ON t.id = k.ticket_id
      WHERE t.id IN (SELECT value FROM json_each(@ids))`).all({ ids });
    out.activities = {
      add: tasks.filter((k) => !k.pipedrive_id).map((k) => ({ id: k.id, ticket_id: k.ticket_id, title: k.title, text: short(k.text), due: k.due_date })),
      edit: tasks.filter((k) => k.pipedrive_id).map((k) => ({ k, fields: kitChanges(k, TASK_TRACKED) })).filter((x) => x.fields.length)
        .map(({ k, fields }) => ({ id: k.id, ticket_id: k.ticket_id, title: k.title, text: short(k.text), fields, changes: changeList(k, fields) })),
      remove: deletes('activity'),
    };
  }
  if (on('files')) {
    out.files = {
      add: db.prepare(FILE_SQL).all({ ids }).map((f) => ({ id: f.id, ticket_id: f.ticket_id, title: f.title, text: f.original_name, link: !!f.url })),
      remove: [...deletes('file'), ...deletes('project_file')],
    };
  }
  if (on('products')) {
    const rows = db.prepare(`SELECT p.*, t.opportunity_title AS title FROM ticket_products p JOIN tickets t ON t.id = p.ticket_id
      WHERE t.id IN (SELECT value FROM json_each(@ids)) ORDER BY t.id, p.position`).all({ ids });
    const line = (p) => `${p.name} × ${p.quantity}`;
    out.products = {
      add: rows.filter((p) => !p.pipedrive_id).map((p) => ({ id: p.id, ticket_id: p.ticket_id, title: p.title, text: line(p) })),
      edit: rows.filter((p) => p.pipedrive_id && p.pipedrive_pending).map((p) => ({ p, fields: kitChanges(p, PRODUCT_TRACKED) })).filter((x) => x.fields.length)
        .map(({ p, fields }) => ({ id: p.id, ticket_id: p.ticket_id, title: p.title, text: line(p), fields, changes: changeList(p, fields) })),
      remove: deletes('product'),
    };
  }
  if (on('installments')) {
    const rows = db.prepare(`SELECT i.*, t.opportunity_title AS title FROM ticket_installments i JOIN tickets t ON t.id = i.ticket_id
      WHERE t.id IN (SELECT value FROM json_each(@ids)) ORDER BY t.id, i.billing_date`).all({ ids });
    const line = (i) => `${i.description || 'Installment'}: $${Number(i.amount).toLocaleString('en-US')} on ${i.billing_date || '—'}`;
    out.installments = {
      add: rows.filter((i) => !i.pipedrive_id).map((i) => ({ id: i.id, ticket_id: i.ticket_id, title: i.title, text: line(i) })),
      edit: rows.filter((i) => i.pipedrive_id && i.pipedrive_pending).map((i) => ({ i, fields: kitChanges(i, INSTALLMENT_TRACKED) })).filter((x) => x.fields.length)
        .map(({ i, fields }) => ({ id: i.id, ticket_id: i.ticket_id, title: i.title, text: line(i), fields, changes: changeList(i, fields) })),
      remove: deletes('installment'),
    };
  }
  if (on('followers')) {
    const these = auto ? changed('followers') : null;
    out.followers = tickets.filter((t) => !these || these.has(t.id)).map((t) => ({
      ticket_id: t.id, title: t.opportunity_title,
      people: db.prepare(`SELECT u.id, u.first_name, u.last_name, u.pipedrive_id FROM ticket_followers f JOIN users u ON u.id = f.user_id WHERE f.ticket_id = ?`).all(t.id),
    })).filter((x) => x.people.length).map((x) => ({ ...x, names: x.people.map(name), missing: x.people.filter((u) => !u.pipedrive_id).map(name) }));
  }
  if (on('contacts')) {
    const these = auto ? changed('contacts') : null;
    const linked = db.prepare(`SELECT tc.ticket_id, tc.is_primary, c.* FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id
      WHERE tc.ticket_id IN (SELECT value FROM json_each(@ids))`).all({ ids });
    const newPeople = new Map(linked.filter((c) => !c.pipedrive_id).map((c) => [c.id, c]));
    // People edited in KIT: anyone from Pipedrive with a pending edit, on these deals or (sending everything) anywhere.
    const edited = db.prepare(`SELECT * FROM contacts WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 1
      ${everyDeal(scope) ? '' : 'AND id IN (SELECT contact_id FROM ticket_contacts WHERE ticket_id IN (SELECT value FROM json_each(@ids)))'}`).all({ ids })
      .map((c) => ({ c, fields: kitChanges(c, CONTACT_TRACKED) })).filter((x) => x.fields.length);
    const text = (c) => [c.first_name, c.last_name].filter(Boolean).join(' ');
    out.contacts = {
      add: [...newPeople.values()].map((c) => ({ id: c.id, text: text(c), organization: c.organization })),
      edit: edited.map(({ c, fields }) => ({ id: c.id, text: text(c), fields, changes: changeList(c, fields) })),
      ids: [...new Set(linked.filter((c) => !these || these.has(c.ticket_id)).map((c) => c.ticket_id))],
    };
    out.contacts.tickets = out.contacts.ids.length;
  }
  if (on('organizations')) {
    const rows = db.prepare(`SELECT * FROM organizations WHERE (pipedrive_id IS NULL OR pipedrive_pending = 1)
      ${everyDeal(scope) ? '' : 'AND id IN (SELECT organization_id FROM tickets WHERE id IN (SELECT value FROM json_each(@ids)))'}`).all({ ids });
    out.organizations = {
      add: rows.filter((o) => !o.pipedrive_id).map((o) => ({ id: o.id, text: o.name })),
      edit: rows.filter((o) => o.pipedrive_id).map((o) => ({ o, fields: kitChanges(o, ORG_TRACKED) })).filter((x) => x.fields.length)
        .map(({ o, fields }) => ({ id: o.id, text: o.name, fields, changes: changeList(o, fields) })),
    };
  }
  if (on('projects')) {
    const tasks = db.prepare(`SELECT k.*, p.pipedrive_project_id AS project_id, p.ticket_id, p.name AS title FROM delivery_tasks k JOIN delivery_programs p ON p.id = k.program_id
      WHERE p.id IN (SELECT value FROM json_each(@pids))`).all({ pids });
    const trackedOf = (k) => (k.kind === 'activity' ? DACT_TRACKED : DTASK_TRACKED);
    const notes = db.prepare(DNOTE_SQL).all({ pids });
    out.projects = {
      edit: programs.map((p) => ({ p, fields: kitChanges(p, PROJECT_TRACKED) })).filter((x) => x.fields.length)
        .map(({ p, fields }) => ({ id: p.id, ticket_id: p.ticket_id, title: p.title, fields, changes: changeList(p, fields) })),
      tasks: {
        add: tasks.filter((k) => !k.pipedrive_id).map((k) => ({ id: k.id, ticket_id: k.ticket_id, title: k.title, text: short(k.title) })),
        edit: tasks.filter((k) => k.pipedrive_id && k.pipedrive_pending).map((k) => ({ k, fields: kitChanges(k, trackedOf(k)) })).filter((x) => x.fields.length)
          .map(({ k, fields }) => ({ id: k.id, ticket_id: k.ticket_id, title: k.title, text: short(k.title), fields, changes: changeList(k, fields) })),
        remove: deletes('task'),
      },
      notes: {
        add: notes.filter((m) => !m.pipedrive_id).map((m) => ({ id: m.id, ticket_id: m.ticket_id, title: m.title, text: short(m.body), by: name(m) })),
        edit: notes.filter((m) => m.pipedrive_id).map((m) => ({ id: m.id, ticket_id: m.ticket_id, title: m.title, text: short(m.body) })),
        remove: deletes('project_note'),
      },
      files: { add: db.prepare(DFILE_SQL).all({ pids }).map((f) => ({ id: f.id, ticket_id: f.ticket_id, title: f.title, text: f.original_name })) },
    };
  }
  return { out, tickets, programs };
}

/** What a send would do, for the preview. Lists are cut at LIST_MAX; counts are whole. */
export function preview(kinds, scope) {
  const { out } = plan(kinds, scope);
  delete out.contacts?.ids;
  const cut = (list) => (Array.isArray(list) ? { count: list.length, items: list.slice(0, LIST_MAX) } : list);
  const deep = (v) => (v && !Array.isArray(v) && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : cut(v));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, deep(v)]));
}

// ---- Sending

const escapeHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paragraphs = (t) => String(t).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
const byLine = (r) => `<p><i>From KIT, by ${escapeHtml(name(r) || 'someone')}</i></p>`;
const notFound = (e) => / 404 /.test(e.message) || / 410 /.test(e.message);

/** A date and time in TIME_ZONE as UTC { date, time }, as Pipedrive keeps activity times. */
function utcDateTime(date, time) {
  if (!date || !time) return { date: date || null, time: null };
  const wanted = Date.parse(`${date}T${time}:00Z`);
  const zoned = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  };
  let ms = wanted - (zoned(wanted) - wanted);
  ms -= zoned(ms) - wanted; // once more, in case the first guess crossed a daylight-saving change
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const activityTypeKey = (type) => Object.keys(ACTIVITY_TYPES).find((k) => ACTIVITY_TYPES[k] === type) || String(type || 'task').toLowerCase().replace(/\s+/g, '_');
const pdUser = (kitId) => (kitId ? db.prepare('SELECT pipedrive_id FROM users WHERE id = ?').get(kitId)?.pipedrive_id || null : null);
const kitUser = (u) => (idOf(u) ? db.prepare('SELECT id FROM users WHERE pipedrive_id = ?').get(idOf(u))?.id ?? null : null);
const pdOrg = (kitId) => (kitId ? db.prepare('SELECT pipedrive_id FROM organizations WHERE id = ?').get(kitId)?.pipedrive_id || null : null);
const kitOrg = (pdId) => (pdId ? db.prepare('SELECT id FROM organizations WHERE pipedrive_id = ?').get(pdId)?.id ?? null : null);

/** Start a send in the background. `by` is the admin ({ id, name }). */
export function startSend(kinds, scope, by) {
  if (!sendingAllowed()) throw new Error(`Sending to Pipedrive is off on this server. ${sendingBlockedReason()}`);
  const chosen = kinds.filter((k) => SEND_KINDS.includes(k));
  if (!chosen.length) throw new Error('Choose at least one thing to send.');
  runJob('send to Pipedrive', (phase) => send(plan(chosen, scope), phase), (result, e) => setSetting('pipedrive_last_send', json.str({
    at: new Date().toISOString(), by: by.name, kinds: chosen, ok: !e, ...(e ? { error: e.message } : { result: forLog(result) }),
  })));
}
export const lastSend = () => json.parse(getSetting('pipedrive_last_send'), null);

/**
 * The Sync button: everything from Pipedrive, then everything KIT has waiting (whatever the direction allows), as one job.
 * `by` is the admin ({ id, name }).
 */
export function startSync(by) {
  const kinds = Object.entries(sendModes()).filter(([, m]) => m !== 'off').map(([k]) => k);
  const pulling = pullsAllowed();
  const sending = kinds.length > 0 && sendingAllowed();
  if (!pulling && !sending) throw new Error(kinds.length ? `Nothing to sync on this server. ${sendingBlockedReason()}` : 'The sync is set to Pipedrive → KIT only and pulls are off, so there is nothing to sync.');
  runJob('sync', async (phase) => {
    const out = {};
    if (pulling) {
      out.pulled = await pull({ kind: 'all' }, phase);
      setSetting('pipedrive_last_sync', json.str({ at: new Date().toISOString(), by: by.name, scope: 'all', ok: true, result: out.pulled }));
    }
    if (sending) {
      out.sent = forLog(await send(plan(kinds, {}), phase));
      setSetting('pipedrive_last_send', json.str({ at: new Date().toISOString(), by: by.name, kinds, ok: true, result: out.sent }));
    }
    return out;
  }, (result, e) => setSetting('pipedrive_last_full_sync', json.str({ at: new Date().toISOString(), by: by.name, pulling, sending, ok: !e, ...(e ? { error: e.message } : { result }) })));
}
export const lastSync = () => json.parse(getSetting('pipedrive_last_full_sync'), null);
const forLog = ({ troubled, ...result }) => result; // eslint-disable-line no-unused-vars

// ---- Auto-send

const AUTO_EVERY = 60 * 1000; // look for changes this often
const AUTO_BACK_OFF = 15 * 60 * 1000; // after a run that failed outright (Pipedrive down, a bad key)
const parked = new Map(); // what didn't fully go → how it looked then; left be until it changes
let resumeAt = 0;

/** A plan's items by deal (ticket id), by person ("p" and contact id), by organization ("o" and id) or by deletion ("d" kind id). */
function byKey(out) {
  const m = new Map();
  const put = (key, kind, item) => m.set(key, [...(m.get(key) || []), [kind, item]]);
  ['deals', 'labels'].forEach((k) => (out[k] || []).forEach((x) => put(x.ticket_id, k, x)));
  ['notes', 'activities', 'files', 'products', 'installments'].forEach((k) => {
    [...(out[k]?.add || []), ...(out[k]?.edit || [])].forEach((x) => put(x.ticket_id, k, x));
    (out[k]?.remove || []).forEach((d) => put(`d${d.kind}${d.pipedrive_id}`, k, d));
  });
  (out.followers || []).forEach((x) => put(x.ticket_id, 'followers', x.people.map((u) => u.id)));
  (out.contacts?.ids || []).forEach((id) => put(id, 'contacts', id));
  (out.contacts?.add || []).forEach((c) => put(`p${c.id}`, 'contacts', c));
  (out.contacts?.edit || []).forEach((c) => put(`p${c.id}`, 'contacts', c));
  [...(out.organizations?.add || []), ...(out.organizations?.edit || [])].forEach((o) => put(`o${o.id}`, 'organizations', o));
  if (out.projects) {
    out.projects.edit.forEach((x) => put(x.ticket_id, 'projects', x));
    ['tasks', 'notes'].forEach((k) => {
      [...out.projects[k].add, ...out.projects[k].edit].forEach((x) => put(x.ticket_id, `project ${k}`, x));
      out.projects[k].remove.forEach((d) => put(`d${d.kind}${d.pipedrive_id}`, k, d));
    });
    out.projects.files.add.forEach((x) => put(x.ticket_id, 'project files', x));
  }
  return new Map([...m].map(([k, items]) => [k, json.str(items)]));
}
/** The plan without these keys. */
function without(out, gone) {
  const keep = (x) => !gone.has(x.ticket_id);
  const keepDelete = (d) => !gone.has(`d${d.kind}${d.pipedrive_id}`);
  ['deals', 'labels', 'followers'].forEach((k) => { if (out[k]) out[k] = out[k].filter(keep); });
  ['notes', 'activities', 'files', 'products', 'installments'].forEach((k) => {
    if (!out[k]) return;
    ['add', 'edit'].forEach((x) => { if (out[k][x]) out[k][x] = out[k][x].filter(keep); });
    if (out[k].remove) out[k].remove = out[k].remove.filter(keepDelete);
  });
  if (out.contacts) {
    out.contacts.ids = out.contacts.ids.filter((id) => !gone.has(id));
    out.contacts.add = out.contacts.add.filter((c) => !gone.has(`p${c.id}`));
    out.contacts.edit = out.contacts.edit.filter((c) => !gone.has(`p${c.id}`));
  }
  if (out.organizations) ['add', 'edit'].forEach((x) => { out.organizations[x] = out.organizations[x].filter((o) => !gone.has(`o${o.id}`)); });
  if (out.projects) {
    out.projects.edit = out.projects.edit.filter(keep);
    ['tasks', 'notes'].forEach((k) => { ['add', 'edit'].forEach((x) => { out.projects[k][x] = out.projects[k][x].filter(keep); }); out.projects[k].remove = out.projects[k].remove.filter(keepDelete); });
    out.projects.files.add = out.projects.files.add.filter(keep);
  }
  return out;
}

/** Send the Auto kinds' changes, if there are any and Pipedrive is free. */
export function autoSend() {
  const kinds = Object.entries(sendModes()).filter(([, m]) => m === 'auto').map(([k]) => k);
  if (!kinds.length || !sendingAllowed() || syncStatus().running || Date.now() < resumeAt) return;
  // A deal never sent (just linked, or Auto just turned on) starts from its followers and people as they are now.
  kinds.filter((k) => SIGS[k]).forEach((k) => db.prepare(`UPDATE tickets AS t SET ${SIGS[k].column} = ${SIGS[k].sql}
    WHERE t.pipedrive_id IS NOT NULL AND t.${SIGS[k].column} IS NULL`).run());
  const planned = plan(kinds, {}, { auto: true });
  const now = byKey(planned.out);
  for (const [key, was] of parked) if (now.get(key) !== was) parked.delete(key);
  if (![...now.keys()].some((key) => !parked.has(key))) return;
  without(planned.out, new Set(parked.keys()));
  runJob('auto-send to Pipedrive', (phase) => send(planned, phase), (result, e) => {
    if (e) resumeAt = Date.now() + AUTO_BACK_OFF;
    else result.troubled.forEach((key) => { if (now.has(key)) parked.set(key, now.get(key)); });
    setSetting('pipedrive_last_auto', json.str({ at: new Date().toISOString(), kinds, ok: !e, ...(e ? { error: e.message } : { result: forLog(result) }) }));
  });
}

/** Auto-send's last run, and how many deals (or people) are waiting because they didn't fully go. */
export const autoStatus = () => ({ last: json.parse(getSetting('pipedrive_last_auto'), null), waiting: parked.size });

export function scheduleAutoSend() {
  setInterval(() => {
    try { autoSend(); } catch (e) { console.error('Pipedrive auto-send:', e.message); }
  }, AUTO_EVERY).unref();
}

// ---- Organizations in Pipedrive, matched or made by name

const orgLabelsField = () => fieldByKey('organization', 'label_ids') || fieldByKey('organization', 'label');
/** The Pipedrive organization for a KIT organization row, made in Pipedrive if it isn't there yet. */
async function ensureOrg(row) {
  if (row.pipedrive_id) return row.pipedrive_id;
  const found = (await call('organizations/search', { term: row.name, fields: 'name', exact_match: 'true', limit: 1 }, { v2: true }).catch(() => ({ data: { items: [] } }))).data?.items?.[0]?.item;
  const id = found?.id ?? (await call('organizations', {}, { method: 'POST', body: orgBody(row, ORG_TRACKED), v2: true })).data.id;
  const snap = snapshotOf(organizationView((await call(`organizations/${id}`)).data, { owner: kitUser }), ORG_TRACKED);
  db.prepare('UPDATE organizations SET pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(id, snap, row.id);
  return id;
}
/** An organization's fields for Pipedrive's v2 API, for the fields named. */
function orgBody(o, fields) {
  const body = {};
  const option = (key, text) => { const f = fieldByKey('organization', key); const v = f ? fieldValue(f, text) : undefined; return v && v.error ? null : v; };
  fields.forEach((f) => {
    if (f === 'name') body.name = o.name;
    else if (f === 'address') body.address = o.address ? { value: o.address } : null;
    else if (f === 'labels') body.label_ids = labelIds(orgLabelsField(), json.parse(o.labels, []));
    else if (f === 'website') body.website = o.website || null;
    else if (f === 'linkedin') body.linkedin = o.linkedin || null;
    else if (f === 'industry') body.industry = option('industry', o.industry) ?? null;
    else if (f === 'annual_revenue') body.annual_revenue = option('annual_revenue', o.annual_revenue) ?? null;
    else if (f === 'employee_count') body.employee_count = o.employee_count ?? null;
  });
  return body;
}
/** A person's fields for Pipedrive's API, for the fields named. */
function personBody(c, fields) {
  const body = {};
  const labelsField = fieldByKey('person', 'label_ids') || fieldByKey('person', 'label');
  const titleField = db.prepare("SELECT key FROM pipedrive_fields WHERE entity = 'person' AND custom = 1 AND name = 'Title' AND active = 1").get()?.key;
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  fields.forEach((f) => {
    if (f === 'first_name' || f === 'last_name') body.name = fullName;
    else if (f === 'email') body.emails = c.email ? [{ value: c.email, primary: true, label: 'work' }] : [];
    else if (f === 'phone') body.phones = c.phone ? [{ value: c.phone, primary: true, label: 'work' }] : [];
    else if (f === 'role') { body.job_title = c.role || null; if (titleField) body.custom_fields = { ...(body.custom_fields || {}), [titleField]: c.role || null }; }
    else if (f === 'labels') body.label_ids = labelIds(labelsField, json.parse(c.labels, []));
    else if (f === 'organization') body.org_id = pdOrg(c.organization_id);
  });
  return body;
}

/** Make a Pipedrive project for a contract that has none, linked to its won deal. Returns the project id. */
export async function createProject(programId) {
  if (!sendingAllowed()) throw new Error(`Projects are made in Pipedrive from the production server only. ${sendingBlockedReason()}`);
  const p = db.prepare(`SELECT p.*, t.pipedrive_id AS deal_id, t.organization_id, t.opportunity_title FROM delivery_programs p JOIN tickets t ON t.id = p.ticket_id WHERE p.id = ?`).get(programId);
  if (!p) throw new Error('Contract not found');
  if (p.pipedrive_project_id && p.project_status !== 'deleted') throw new Error('This contract already has a Pipedrive project');
  if (!p.deal_id) throw new Error('This contract’s ticket isn’t a Pipedrive deal');
  const boards = (await call('projects/boards')).data || [];
  if (!boards.length) throw new Error('Pipedrive has no Projects board');
  const phase = p.phase_id ? db.prepare('SELECT pipedrive_id, board_id FROM delivery_phases WHERE id = ?').get(p.phase_id) : null;
  const boardId = phase?.board_id || boards[0].id;
  const phaseId = phase?.pipedrive_id || ((await call('projects/phases', { board_id: boardId })).data || [])[0]?.id;
  const primary = db.prepare('SELECT c.pipedrive_id FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id WHERE tc.ticket_id = ? AND tc.is_primary = 1').get(p.ticket_id)?.pipedrive_id;
  const body = {
    title: p.name, board_id: boardId, phase_id: phaseId, deal_ids: [p.deal_id], description: p.notes || '',
    start_date: p.start_date || new Date().toLocaleDateString('en-CA'), end_date: p.end_date || undefined,
    org_id: pdOrg(p.organization_id) || undefined, person_id: primary || undefined, owner_id: pdUser(p.owner_id || p.program_manager_id) || undefined,
    status: PROJECT_STATUS_OF[p.status] || 'open',
  };
  const { data } = await call('projects', {}, { method: 'POST', body });
  const lk = { phase: (id) => db.prepare('SELECT id FROM delivery_phases WHERE pipedrive_id = ?').get(id)?.id ?? null, owner: kitUser };
  db.prepare(`UPDATE delivery_programs SET pipedrive_project_id = ?, project_status = ?, pipedrive_snapshot = ?, pipedrive_pending = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(data.id, data.status || 'open', snapshotOf(projectView(data, lk), PROJECT_TRACKED), p.id);
  return data.id;
}

/**
 * Send what `plan` found. Alongside what was sent, conflicts, skips and errors, `troubled` names what didn't fully go
 * (a deal's ticket id, "p"/"o" and a person's/organization's id, or a deletion), so auto-send can leave it be until it changes.
 */
async function send({ out, tickets }, phase) {
  const sent = {};
  const count = (k, n = 1) => { sent[k] = (sent[k] || 0) + n; };
  const conflicts = [];
  const skipped = [];
  const errors = [];
  const troubled = new Set();
  const skip = (key, text) => { skipped.push(text); troubled.add(key); };
  const attempt = async (what, fn, key) => {
    try { await fn(); } catch (e) { if (errors.length < LIST_MAX) errors.push(`${what}: ${e.message}`); if (key != null) troubled.add(key); }
  };
  const ticketById = new Map(tickets.map((t) => [t.id, t]));
  const tracked = dealTracked();

  // Organizations first: deals and people may point at new ones.
  if (out.organizations) {
    phase('Sending organizations');
    for (const o of out.organizations.add) {
      const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(o.id);
      await attempt(`Organization ${o.text}`, async () => { await ensureOrg(row); count('organizationsAdded'); }, `o${o.id}`);
    }
    for (const o of out.organizations.edit) {
      const row = db.prepare('SELECT * FROM organizations WHERE id = ?').get(o.id);
      await attempt(`Organization ${o.text}`, async () => {
        const { data: now } = await call(`organizations/${row.pipedrive_id}`);
        const view = organizationView(now, { owner: kitUser });
        const snap = json.parse(row.pipedrive_snapshot, {});
        const ok = o.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: null, title: row.name, field: fieldLabel(f) });
          return false;
        });
        if (ok.length) {
          await call(`organizations/${row.pipedrive_id}`, {}, { method: 'PATCH', body: orgBody(row, ok), v2: true });
          count('organizationsUpdated');
        }
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, row[f] ?? null])) };
        db.prepare('UPDATE organizations SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, ORG_TRACKED), row.id);
      }, `o${o.id}`);
    }
  }

  // Deal fields, checked against the deal as it is now.
  if (out.deals?.length) {
    phase('Sending deal fields');
    const accountField = fieldByName('deal', ACCOUNT_FIELD);
    const lookups = {
      stageName: (id) => db.prepare('SELECT name FROM pipeline_stages WHERE pipedrive_id = ?').get(id)?.name,
      owner: kitUser,
      territory: (d) => (accountField ? db.prepare('SELECT id FROM territories WHERE pipedrive_id = ?').get(Number(d[accountField.key]) || -1)?.id ?? null : null),
    };
    for (const [i, d] of out.deals.entries()) {
      phase(`Sending deal fields (${i + 1} of ${out.deals.length})`);
      const t = withCustom(ticketById.get(d.ticket_id));
      await attempt(t.opportunity_title, async () => {
        const { data: deal } = await call(`deals/${t.pipedrive_id}`);
        const now = dealView(deal, lookups);
        const snap = json.parse(t.pipedrive_snapshot, {});
        const body = {};
        const sentFields = [];
        for (const f of d.fields) {
          if (!same(now[f], snap[f])) { conflicts.push({ ticket_id: t.id, title: t.opportunity_title, field: fieldLabel(f) }); troubled.add(t.id); continue; }
          const v = t[f];
          const key = customKeyOf(f);
          if (key) {
            const field = fieldByKey('deal', key);
            if (!field) { skip(t.id, `${t.opportunity_title}: Pipedrive no longer has the "${key}" field`); continue; }
            const value = fieldValue(field, v);
            if (value === undefined) { skip(t.id, `${t.opportunity_title}: ${field.name} can’t be set from KIT`); continue; }
            if (value && value.error) { skip(t.id, `${t.opportunity_title}: ${value.error}`); continue; }
            body.custom_fields = { ...(body.custom_fields || {}), [key]: value };
          } else if (f === 'opportunity_title') body.title = v;
          else if (f === 'value') body.value = v ?? 0;
          else if (f === 'probability') body.probability = v;
          else if (f === 'projected_win_date') body.expected_close_date = v;
          else if (f === 'lost_reason') { if (t.deal_status === 'lost') body.lost_reason = v || ''; }
          else if (f === 'deal_status') {
            body.status = v;
            if (v === 'lost' && t.lost_reason) body.lost_reason = t.lost_reason;
          } else if (f === 'pipeline_status') {
            if (v === 'Lost') { if (t.deal_status !== 'lost') body.status = 'lost'; } else if (v) {
              const stage = db.prepare('SELECT pipedrive_id FROM pipeline_stages WHERE pipeline_id = ? AND name = ? AND pipedrive_id IS NOT NULL').get(t.pipeline_id, v);
              if (!stage) { skip(t.id, `${t.opportunity_title}: Pipedrive has no "${v}" stage in this pipeline`); continue; }
              body.stage_id = stage.pipedrive_id;
              if (snap.pipeline_status === 'Lost' && t.deal_status === 'open') body.status = 'open';
            }
          } else if (f === 'bd_director_id') {
            const owner = pdUser(v);
            if (!owner) { skip(t.id, `${t.opportunity_title}: ${shown(f, v)} has no Pipedrive user, so the owner wasn't changed`); continue; }
            body.owner_id = owner;
          } else if (f === 'territory_id') {
            if (!accountField) { skip(t.id, `${t.opportunity_title}: Pipedrive has no Account field`); continue; }
            const option = v ? db.prepare('SELECT pipedrive_id FROM territories WHERE id = ?').get(v)?.pipedrive_id
              : accountField.options?.find((o) => o.label === 'N/A')?.id ?? null;
            if (v && !option) { skip(t.id, `${t.opportunity_title}: territory ${shown(f, v)} isn't an Account option in Pipedrive`); continue; }
            body.custom_fields = { ...(body.custom_fields || {}), [accountField.key]: option };
          } else if (f === 'organization') {
            // The organization by name: KIT's row for it, matched or made in Pipedrive.
            if (!v) body.org_id = null;
            else {
              let org = t.organization_id ? db.prepare('SELECT * FROM organizations WHERE id = ?').get(t.organization_id) : null;
              if (!org || org.name.toLowerCase() !== String(v).toLowerCase()) {
                org = db.prepare('SELECT * FROM organizations WHERE name = ? COLLATE NOCASE LIMIT 1').get(v)
                  || db.prepare('SELECT * FROM organizations WHERE id = ?').get(db.prepare('INSERT INTO organizations (name) VALUES (?)').run(v).lastInsertRowid);
                db.prepare('UPDATE tickets SET organization_id = ? WHERE id = ?').run(org.id, t.id);
              }
              body.org_id = await ensureOrg(org);
            }
          }
          sentFields.push(f);
        }
        if (!sentFields.length) return;
        await call(`deals/${t.pipedrive_id}`, {}, { method: 'PATCH', body, v2: true });
        const next = { ...snap, ...Object.fromEntries(sentFields.map((f) => [f, t[f] ?? null])) };
        db.prepare('UPDATE tickets SET pipedrive_snapshot = ? WHERE id = ?').run(snapshotOf(next, tracked), t.id);
        count('deals');
      }, t.id);
    }
  }

  // Tags: only Pipedrive's own labels go; tags made in KIT stay in KIT (adding one would change every deal's label list).
  for (const l of out.labels || []) {
    phase('Sending tags');
    const t = ticketById.get(l.ticket_id);
    await attempt(`Tags on ${t.opportunity_title}`, async () => {
      const ids = db.prepare('SELECT pipedrive_id FROM labels WHERE pipedrive_id IS NOT NULL AND name IN (SELECT value FROM json_each(?))').all(t.labels || '[]').map((x) => x.pipedrive_id);
      await call(`deals/${t.pipedrive_id}`, {}, { method: 'PATCH', body: { label_ids: ids }, v2: true });
      db.prepare('UPDATE tickets SET labels_pending = 0 WHERE id = ?').run(t.id);
      count('labels');
    }, t.id);
  }

  // Deletions first, so nothing deleted in KIT is touched below.
  const removeAll = async (list, kind, endpoint, v2 = false) => {
    for (const d of list || []) {
      await attempt(`Deleting ${kind} ${d.pipedrive_id}`, async () => {
        try { await call(`${typeof endpoint === 'function' ? endpoint(d) : endpoint}/${d.pipedrive_id}`, {}, { method: 'DELETE', v2 }); } catch (e) { if (!notFound(e)) throw e; }
        db.prepare('DELETE FROM pipedrive_deletes WHERE kind = ? AND pipedrive_id = ?').run(kind, d.pipedrive_id);
        count(`${kind}sDeleted`);
      }, `d${kind}${d.pipedrive_id}`);
    }
  };
  if (out.notes) { phase('Deleting notes'); await removeAll(out.notes.remove, 'note', 'notes'); }
  if (out.files) {
    phase('Deleting files');
    await removeAll(out.files.remove.filter((d) => d.kind === 'file'), 'file', 'files');
    await removeAll(out.files.remove.filter((d) => d.kind === 'project_file'), 'project_file', 'files');
  }
  if (out.activities) { phase('Deleting activities'); await removeAll(out.activities.remove, 'activity', 'activities'); }
  if (out.products) { phase('Deleting products'); await removeAll(out.products.remove, 'product', (d) => `deals/${d.deal_id}/products`, true); }
  if (out.installments) { phase('Deleting installments'); await removeAll(out.installments.remove, 'installment', (d) => `deals/${d.deal_id}/installments`, true); }
  if (out.projects) {
    phase('Deleting project items');
    await removeAll(out.projects.tasks.remove, 'task', 'tasks');
    await removeAll(out.projects.notes.remove, 'project_note', 'notes');
  }

  // Notes: KIT's say who wrote them; notes from Pipedrive keep their own wording.
  if (out.notes) {
    phase('Sending notes');
    const chosen = new Set([...out.notes.add, ...out.notes.edit].map((m) => m.id));
    const notes = db.prepare(NOTE_SQL).all({ ids: json.str(tickets.map((t) => t.id)) }).filter((m) => chosen.has(m.id));
    for (const m of notes) {
      await attempt(`Note on ${m.title}`, async () => {
        const fields = { content: `${m.kind === 'comment' ? byLine(m) : ''}${paragraphs(m.body)}`, pinned_to_deal_flag: m.pinned ? 1 : 0 };
        if (m.pipedrive_id) {
          await call(`notes/${m.pipedrive_id}`, {}, { method: 'PUT', body: fields });
          count('notesUpdated');
        } else {
          const { data } = await call('notes', {}, { method: 'POST', body: { ...fields, deal_id: m.deal_id } });
          db.prepare('UPDATE ticket_comments SET pipedrive_id = ? WHERE id = ?').run(data.id, m.id);
          count('notesAdded');
        }
        db.prepare('UPDATE ticket_comments SET pipedrive_pending = 0 WHERE id = ?').run(m.id);
      }, m.ticket_id);
    }
  }

  // Activities: new ones are added; edited ones send only the fields Pipedrive hasn't changed since the last pull.
  const activityBody = (k, keys) => {
    const body = {};
    keys.forEach((f) => {
      if (f === 'text' || f === 'title') body.subject = k.text ?? k.title;
      else if (f === 'activity_type') body.type = activityTypeKey(k.activity_type);
      else if (f === 'due_date' || f === 'due_time') Object.assign(body, Object.fromEntries(Object.entries(utcDateTime(k.due_date, k.due_time)).map(([x, v]) => [`due_${x}`, v ?? ''])));
      else if (f === 'duration') body.duration = k.duration || '';
      else if (f === 'assignee_id') { const u = pdUser(k.assignee_id); if (u) body.user_id = u; }
      else if (f === 'location') body.location = k.location || '';
      else if (f === 'note' || f === 'description') body.note = (k.note ?? k.description) ? paragraphs(k.note ?? k.description) : '';
      else if (f === 'done') body.done = k.done ? 1 : 0;
    });
    return body;
  };
  if (out.activities) {
    for (const [i, a] of out.activities.add.entries()) {
      phase(`Sending activities (${i + 1} of ${out.activities.add.length + out.activities.edit.length})`);
      const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(a.id);
      const t = ticketById.get(a.ticket_id);
      if (!k) continue;
      await attempt(`Activity "${a.text}"`, async () => {
        const body = { ...activityBody(k, TASK_TRACKED), deal_id: t.pipedrive_id };
        if (!body.type) body.type = 'task';
        const { data } = await call('activities', {}, { method: 'POST', body });
        db.prepare('UPDATE ticket_tasks SET pipedrive_id = ?, pipedrive_snapshot = ? WHERE id = ?').run(data.id, snapshotOf(activityView(data, kitUser), TASK_TRACKED), k.id);
        count('activitiesAdded');
      }, a.ticket_id);
    }
    for (const [i, a] of out.activities.edit.entries()) {
      phase(`Sending activities (${out.activities.add.length + i + 1} of ${out.activities.add.length + out.activities.edit.length})`);
      const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(a.id);
      if (!k) continue;
      await attempt(`Activity "${a.text}"`, async () => {
        const { data: now } = await call(`activities/${k.pipedrive_id}`);
        const view = activityView(now, kitUser);
        const snap = json.parse(k.pipedrive_snapshot, {});
        const ok = a.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: a.ticket_id, title: `${a.title} · ${a.text}`, field: fieldLabel(f) });
          troubled.add(a.ticket_id);
          return false;
        });
        if (!ok.length) return;
        await call(`activities/${k.pipedrive_id}`, {}, { method: 'PUT', body: activityBody(k, ok) });
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, k[f] ?? null])) };
        db.prepare('UPDATE ticket_tasks SET pipedrive_snapshot = ? WHERE id = ?').run(snapshotOf(next, TASK_TRACKED), k.id);
        count('activitiesUpdated');
      }, a.ticket_id);
    }
  }

  // Files: an upload goes as a file; a link goes as a note with the link.
  const uploadFile = async (f, where) => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(uploadDir, f.stored_name))], { type: f.mime_type || 'application/octet-stream' }), f.original_name);
    Object.entries(where).forEach(([k, v]) => form.append(k, String(v)));
    return (await call('files', {}, { method: 'POST', body: form })).data;
  };
  if (out.files) {
    phase('Sending files');
    const chosen = new Set(out.files.add.map((f) => f.id));
    for (const f of db.prepare(FILE_SQL).all({ ids: json.str(tickets.map((t) => t.id)) }).filter((x) => chosen.has(x.id))) {
      await attempt(`File ${f.original_name}`, async () => {
        if (f.url) {
          const content = `${byLine(f)}<p>Linked document: <a href="${escapeHtml(f.url)}">${escapeHtml(f.original_name)}</a></p>`;
          const { data } = await call('notes', {}, { method: 'POST', body: { content, deal_id: f.deal_id } });
          db.prepare('UPDATE ticket_files SET pipedrive_note_id = ? WHERE id = ?').run(data.id, f.id);
        } else {
          const data = await uploadFile(f, { deal_id: f.deal_id });
          db.prepare('UPDATE ticket_files SET pipedrive_id = ? WHERE id = ?').run(data.id, f.id);
        }
        count('filesAdded');
      }, f.ticket_id);
    }
  }

  // Products: matched by name to Pipedrive's product catalog, added to it when missing. Edits send the fields Pipedrive hasn't changed.
  if (out.products && (out.products.add.length || out.products.edit.length)) {
    phase('Sending products');
    let catalog = null;
    const productId = async (p) => {
      if (p.product_pipedrive_id) return p.product_pipedrive_id;
      catalog ||= new Map((await allCursor('products', {}, { v2: true })).map((x) => [String(x.name).toLowerCase(), x.id]));
      let id = catalog.get(String(p.name).toLowerCase());
      if (!id) {
        id = (await call('products', {}, { method: 'POST', body: { name: p.name, prices: [{ price: Number(p.item_price) || 0, currency: 'USD' }] }, v2: true })).data.id;
        catalog.set(String(p.name).toLowerCase(), id);
        count('catalogProductsAdded');
      }
      return id;
    };
    const productBody = (p, keys) => {
      const body = {};
      keys.forEach((f) => {
        if (f === 'quantity') body.quantity = Number(p.quantity) || 1;
        else if (f === 'item_price') body.item_price = Number(p.item_price) || 0;
        else if (f === 'discount') { body.discount = Number(p.discount) || 0; body.discount_type = 'percentage'; }
        else if (f === 'tax') body.tax = Number(p.tax) || 0;
        else if (f === 'comments') body.comments = p.comments || '';
        else if (f === 'is_enabled') body.is_enabled = !!Number(p.is_enabled);
        else if (f === 'billing_frequency' && p.billing_frequency) body.billing_frequency = p.billing_frequency;
        else if (f === 'billing_frequency_cycles' && p.billing_frequency_cycles != null) body.billing_frequency_cycles = p.billing_frequency_cycles;
        else if (f === 'billing_start_date' && p.billing_start_date) body.billing_start_date = p.billing_start_date;
      });
      return body;
    };
    for (const item of out.products.add) {
      const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(item.id);
      if (!p) continue;
      const t = ticketById.get(p.ticket_id);
      await attempt(`Product ${p.name}`, async () => {
        const { data } = await call(`deals/${t.pipedrive_id}/products`, {}, { method: 'POST', body: { product_id: await productId(p), ...productBody(p, PRODUCT_TRACKED) }, v2: true });
        db.prepare('UPDATE ticket_products SET pipedrive_id = ?, product_pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?')
          .run(data.id, data.product_id ?? null, snapshotOf(productView(data), PRODUCT_TRACKED), p.id);
        count('productsAdded');
      }, p.ticket_id);
    }
    for (const item of out.products.edit) {
      const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(item.id);
      if (!p) continue;
      const t = ticketById.get(p.ticket_id);
      await attempt(`Product ${p.name}`, async () => {
        const now = (await allCursor('deals/products', { deal_ids: String(t.pipedrive_id) }, { v2: true })).find((x) => x.id === p.pipedrive_id);
        if (!now) { skip(p.ticket_id, `${item.title}: "${p.name}" is no longer on the deal in Pipedrive`); return; }
        const view = productView(now);
        const snap = json.parse(p.pipedrive_snapshot, {});
        const ok = item.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: p.ticket_id, title: `${item.title} · ${p.name}`, field: fieldLabel(f) });
          troubled.add(p.ticket_id);
          return false;
        });
        if (ok.includes('name')) skip(p.ticket_id, `${item.title}: a product's name is its catalog entry, so "${p.name}" wasn't renamed in Pipedrive`);
        const keys = ok.filter((f) => f !== 'name');
        if (keys.length) await call(`deals/${t.pipedrive_id}/products/${p.pipedrive_id}`, {}, { method: 'PATCH', body: productBody(p, keys), v2: true });
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, p[f] ?? null])) };
        db.prepare('UPDATE ticket_products SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, PRODUCT_TRACKED), p.id);
        if (keys.length) count('productsUpdated');
      }, p.ticket_id);
    }
  }

  // Installments: Pipedrive's payment schedule on the deal.
  if (out.installments && (out.installments.add.length || out.installments.edit.length)) {
    phase('Sending installments');
    const body = (i) => ({ description: i.description || 'Installment', amount: Number(i.amount) || 0, billing_date: i.billing_date });
    for (const item of out.installments.add) {
      const i = db.prepare('SELECT * FROM ticket_installments WHERE id = ?').get(item.id);
      if (!i) continue;
      const t = ticketById.get(i.ticket_id);
      await attempt(`Installment ${item.text}`, async () => {
        if (!i.billing_date || !(Number(i.amount) > 0)) { skip(i.ticket_id, `${item.title}: an installment needs an amount above zero and a billing date`); return; }
        const { data } = await call(`deals/${t.pipedrive_id}/installments`, {}, { method: 'POST', body: body(i), v2: true });
        db.prepare('UPDATE ticket_installments SET pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(data.id, snapshotOf(installmentView(data), INSTALLMENT_TRACKED), i.id);
        count('installmentsAdded');
      }, i.ticket_id);
    }
    for (const item of out.installments.edit) {
      const i = db.prepare('SELECT * FROM ticket_installments WHERE id = ?').get(item.id);
      if (!i) continue;
      const t = ticketById.get(i.ticket_id);
      await attempt(`Installment ${item.text}`, async () => {
        const now = (await allCursor('deals/installments', { deal_ids: String(t.pipedrive_id) }, { v2: true })).find((x) => x.id === i.pipedrive_id);
        if (!now) { skip(i.ticket_id, `${item.title}: the installment is no longer on the deal in Pipedrive`); return; }
        const view = installmentView(now);
        const snap = json.parse(i.pipedrive_snapshot, {});
        const ok = item.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: i.ticket_id, title: `${item.title} · installment`, field: fieldLabel(f) });
          troubled.add(i.ticket_id);
          return false;
        });
        if (ok.length) await call(`deals/${t.pipedrive_id}/installments/${i.pipedrive_id}`, {}, { method: 'PATCH', body: body(i), v2: true });
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, i[f] ?? null])) };
        db.prepare('UPDATE ticket_installments SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, INSTALLMENT_TRACKED), i.id);
        if (ok.length) count('installmentsUpdated');
      }, i.ticket_id);
    }
  }

  // Followers: added where they aren't following yet. Nobody is taken off a deal.
  for (const x of out.followers || []) {
    phase('Sending followers');
    const t = ticketById.get(x.ticket_id);
    if (x.missing.length) skipped.push(`${t.opportunity_title}: ${x.missing.join(', ')} ${x.missing.length === 1 ? 'has' : 'have'} no Pipedrive user`);
    const want = x.people.filter((u) => u.pipedrive_id);
    if (!want.length) { markSent('followers', t.id); continue; }
    await attempt(`Followers on ${t.opportunity_title}`, async () => {
      const following = new Set((await all(`deals/${t.pipedrive_id}/followers`)).map((f) => f.user_id));
      for (const u of want.filter((w) => !following.has(w.pipedrive_id))) {
        await call(`deals/${t.pipedrive_id}/followers`, {}, { method: 'POST', body: { user_id: u.pipedrive_id } });
        count('followers');
      }
      markSent('followers', t.id);
    }, t.id);
  }

  // People: new contacts become Pipedrive persons, edited ones are updated; each ticket's people become the deal's
  // participants, and its primary contact the deal's contact person. Nobody is taken off a deal.
  if (out.contacts) {
    phase('Sending people');
    for (const c of out.contacts.add) {
      const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.id);
      if (!row) continue;
      await attempt(`Person ${c.text}`, async () => {
        if (row.organization_id) await ensureOrg(db.prepare('SELECT * FROM organizations WHERE id = ?').get(row.organization_id));
        const { data } = await call('persons', {}, { method: 'POST', body: personBody(row, CONTACT_TRACKED), v2: true });
        const full = (await call(`persons/${data.id}`)).data;
        db.prepare('UPDATE contacts SET pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?')
          .run(data.id, snapshotOf(personView(full, { organization: kitOrg }), CONTACT_TRACKED), row.id);
        count('peopleAdded');
      }, `p${c.id}`);
    }
    for (const c of out.contacts.edit) {
      const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.id);
      if (!row) continue;
      await attempt(`Person ${c.text}`, async () => {
        const { data: now } = await call(`persons/${row.pipedrive_id}`);
        const view = personView(now, { organization: kitOrg });
        const snap = json.parse(row.pipedrive_snapshot, {});
        const ok = c.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: null, title: c.text, field: fieldLabel(f) });
          return false;
        });
        if (ok.includes('organization') && row.organization_id) await ensureOrg(db.prepare('SELECT * FROM organizations WHERE id = ?').get(row.organization_id));
        if (ok.length) { await call(`persons/${row.pipedrive_id}`, {}, { method: 'PATCH', body: personBody(row, ok), v2: true }); count('peopleUpdated'); }
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, row[f] ?? null])) };
        db.prepare('UPDATE contacts SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, CONTACT_TRACKED), row.id);
      }, `p${c.id}`);
    }
    const linked = db.prepare(`SELECT tc.ticket_id, tc.is_primary, c.* FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id
      WHERE tc.ticket_id IN (SELECT value FROM json_each(?))`).all(json.str(out.contacts.ids));
    const byTicket = new Map();
    linked.forEach((c) => byTicket.set(c.ticket_id, [...(byTicket.get(c.ticket_id) || []), c]));
    for (const [ticketId, people] of byTicket) {
      const t = ticketById.get(ticketId);
      await attempt(`People on ${t.opportunity_title}`, async () => {
        const pdIds = people.map((c) => ({ ...c, pd: db.prepare('SELECT pipedrive_id FROM contacts WHERE id = ?').get(c.id).pipedrive_id })).filter((c) => c.pd);
        if (pdIds.length < people.length) troubled.add(t.id); // someone isn't in Pipedrive yet
        if (!pdIds.length) return;
        const { data: deal } = await call(`deals/${t.pipedrive_id}`);
        const on = new Set([idOf(deal.person_id), ...(await all(`deals/${t.pipedrive_id}/participants`)).map((p) => idOf(p.person_id))].filter(Boolean));
        const primary = pdIds.find((c) => c.is_primary);
        if (primary && idOf(deal.person_id) !== primary.pd) {
          await call(`deals/${t.pipedrive_id}`, {}, { method: 'PATCH', body: { person_id: primary.pd }, v2: true });
          on.add(primary.pd);
          count('contactPersons');
        }
        for (const c of pdIds.filter((x) => !on.has(x.pd))) {
          await call(`deals/${t.pipedrive_id}/participants`, {}, { method: 'POST', body: { person_id: c.pd } });
          count('participantsAdded');
        }
        if (pdIds.length === people.length) markSent('contacts', t.id);
      }, t.id);
    }
  }

  // Projects: the contract's overview, then its tasks, activities, notes and files.
  if (out.projects) {
    phase('Sending projects');
    const lk = { phase: (id) => db.prepare('SELECT id FROM delivery_phases WHERE pipedrive_id = ?').get(id)?.id ?? null, owner: kitUser };
    const labelsField = () => fieldByKey('project', 'labels') || fieldByName('project', 'Labels');
    for (const x of out.projects.edit) {
      const p = db.prepare('SELECT * FROM delivery_programs WHERE id = ?').get(x.id);
      if (!p) continue;
      await attempt(`Project for ${x.title}`, async () => {
        const { data: now } = await call(`projects/${p.pipedrive_project_id}`);
        const view = projectView(now, lk);
        const snap = json.parse(p.pipedrive_snapshot, {});
        const ok = x.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: x.ticket_id, title: `${x.title} · project`, field: fieldLabel(f) });
          troubled.add(x.ticket_id);
          return false;
        });
        const body = {};
        ok.forEach((f) => {
          if (f === 'notes') body.description = p.notes || '';
          else if (f === 'project_status') body.status = p.project_status || 'open';
          else if (f === 'start_date') body.start_date = p.start_date || now.start_date;
          else if (f === 'end_date') body.end_date = p.end_date || null;
          else if (f === 'phase_id') { const ph = p.phase_id ? db.prepare('SELECT pipedrive_id FROM delivery_phases WHERE id = ?').get(p.phase_id)?.pipedrive_id : null; if (ph) body.phase_id = ph; }
          else if (f === 'labels') body.labels = labelIds(labelsField(), json.parse(p.labels, []));
          else if (f === 'owner_id') { const u = pdUser(p.owner_id); if (u) body.owner_id = u; }
        });
        if (Object.keys(body).length) { await call(`projects/${p.pipedrive_project_id}`, {}, { method: 'PUT', body }); count('projectsUpdated'); }
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, p[f] ?? null])) };
        db.prepare('UPDATE delivery_programs SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, PROJECT_TRACKED), p.id);
      }, x.ticket_id);
    }
    const taskBody = (k, keys) => {
      const body = {};
      keys.forEach((f) => {
        if (f === 'title') body.title = k.title;
        else if (f === 'description') body.description = k.description || '';
        else if (f === 'done') body.done = k.done ? 1 : 0;
        else if (f === 'due_date') body.due_date = k.due_date || null;
        else if (f === 'assignee_id') { const u = pdUser(k.assignee_id); body.assignee_id = u || null; }
        else if (f === 'parent_id') body.parent_task_id = k.parent_id ? db.prepare('SELECT pipedrive_id FROM delivery_tasks WHERE id = ?').get(k.parent_id)?.pipedrive_id ?? null : null;
      });
      return body;
    };
    const taskLk = { owner: kitUser, task: (id) => (id ? db.prepare("SELECT id FROM delivery_tasks WHERE pipedrive_id = ? AND kind = 'task'").get(id)?.id ?? null : null) };
    // Parent tasks before subtasks, so a subtask's parent is in Pipedrive first.
    const adds = [...out.projects.tasks.add].map((a) => ({ a, k: db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(a.id) })).filter((x) => x.k)
      .sort((x, y) => (x.k.parent_id ? 1 : 0) - (y.k.parent_id ? 1 : 0));
    for (const { a, k } of adds) {
      const projectId = db.prepare('SELECT pipedrive_project_id FROM delivery_programs WHERE id = ?').get(k.program_id)?.pipedrive_project_id;
      await attempt(`Task "${a.text}"`, async () => {
        if (k.kind === 'activity') {
          const body = { ...activityBody(k, DACT_TRACKED), project_id: projectId };
          if (!body.type) body.type = 'task';
          const { data } = await call('activities', {}, { method: 'POST', body });
          db.prepare('UPDATE delivery_tasks SET pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?')
            .run(data.id, snapshotOf(projectActivityView(data, taskLk), DACT_TRACKED), k.id);
        } else {
          const { data } = await call('tasks', {}, { method: 'POST', body: { ...taskBody(k, DTASK_TRACKED), project_id: projectId } });
          db.prepare('UPDATE delivery_tasks SET pipedrive_id = ?, pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?')
            .run(data.id, snapshotOf(taskView(data, taskLk), DTASK_TRACKED), k.id);
        }
        count('tasksAdded');
      }, a.ticket_id);
    }
    for (const a of out.projects.tasks.edit) {
      const k = db.prepare('SELECT * FROM delivery_tasks WHERE id = ?').get(a.id);
      if (!k) continue;
      await attempt(`Task "${a.text}"`, async () => {
        const isAct = k.kind === 'activity';
        const { data: now } = await call(isAct ? `activities/${k.pipedrive_id}` : `tasks/${k.pipedrive_id}`);
        const view = isAct ? projectActivityView(now, taskLk) : taskView(now, taskLk);
        const trackedKeys = isAct ? DACT_TRACKED : DTASK_TRACKED;
        const snap = json.parse(k.pipedrive_snapshot, {});
        const ok = a.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: a.ticket_id, title: `${a.title} · ${a.text}`, field: fieldLabel(f) });
          troubled.add(a.ticket_id);
          return false;
        });
        if (ok.length) await call(isAct ? `activities/${k.pipedrive_id}` : `tasks/${k.pipedrive_id}`, {}, { method: 'PUT', body: isAct ? activityBody(k, ok) : taskBody(k, ok) });
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, k[f] ?? null])) };
        db.prepare('UPDATE delivery_tasks SET pipedrive_snapshot = ?, pipedrive_pending = 0 WHERE id = ?').run(snapshotOf(next, trackedKeys), k.id);
        if (ok.length) count('tasksUpdated');
      }, a.ticket_id);
    }
    const pids = json.str(db.prepare(PROGRAM_SQL).all({ ids: json.str(tickets.map((t) => t.id)) }).map((p) => p.id));
    const chosenNotes = new Set([...out.projects.notes.add, ...out.projects.notes.edit].map((m) => m.id));
    for (const m of db.prepare(DNOTE_SQL).all({ pids }).filter((x) => chosenNotes.has(x.id))) {
      await attempt(`Project note on ${m.title}`, async () => {
        const fields = { content: `${m.pipedrive_id ? '' : byLine(m)}${paragraphs(m.body)}`, pinned_to_project_flag: m.pinned ? 1 : 0 };
        if (m.pipedrive_id) await call(`notes/${m.pipedrive_id}`, {}, { method: 'PUT', body: fields });
        else {
          const { data } = await call('notes', {}, { method: 'POST', body: { ...fields, project_id: m.project_id } });
          db.prepare('UPDATE delivery_notes SET pipedrive_id = ? WHERE id = ?').run(data.id, m.id);
        }
        db.prepare('UPDATE delivery_notes SET pipedrive_pending = 0 WHERE id = ?').run(m.id);
        count(m.pipedrive_id ? 'projectNotesUpdated' : 'projectNotesAdded');
      }, m.ticket_id);
    }
    const chosenFiles = new Set(out.projects.files.add.map((f) => f.id));
    for (const f of db.prepare(DFILE_SQL).all({ pids }).filter((x) => chosenFiles.has(x.id))) {
      await attempt(`Project file ${f.original_name}`, async () => {
        if (f.url) { skip(f.ticket_id, `${f.title}: linked documents aren't sent to a project`); return; }
        const data = await uploadFile(f, { project_id: f.project_id });
        db.prepare('UPDATE delivery_files SET pipedrive_id = ? WHERE id = ?').run(data.id, f.id);
        count('projectFilesAdded');
      }, f.ticket_id);
    }
  }

  return { sent, conflicts: conflicts.slice(0, LIST_MAX), skipped: skipped.slice(0, LIST_MAX), errors, troubled: [...troubled] };
}
