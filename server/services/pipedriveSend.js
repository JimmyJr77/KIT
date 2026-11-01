// KIT → Pipedrive, only when an admin sends it. The admin picks what goes (deal fields, tags, notes, activities, files,
// products, followers, people) and which deals; a preview shows exactly that before anything is sent.
//
// What counts as a change: a shared field whose KIT value differs from what Pipedrive held at the last pull (the
// snapshot), and anything made or deleted in KIT that Pipedrive doesn't have. Before sending a field, the deal (or
// activity) is read again: if Pipedrive changed that field since the last pull, it's left alone and listed as a
// conflict, so a send never overwrites someone's newer work in Pipedrive. The next pull settles it (Pipedrive wins).
import fs from 'node:fs';
import path from 'node:path';
import { db, json, setSetting, getSetting } from '../db.js';
import {
  call, all, idOf, runJob, sendingAllowed, dealView, activityView, kitChanges, snapshotOf, same,
  DEAL_TRACKED, TASK_TRACKED, ACTIVITY_TYPES,
} from './pipedrive.js';

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
const TIME_ZONE = process.env.PIPEDRIVE_TIME_ZONE || 'America/New_York';

export const SEND_KINDS = ['deals', 'labels', 'notes', 'activities', 'files', 'products', 'followers', 'contacts'];
export const FIELD_LABELS = {
  opportunity_title: 'Title', value: 'Value', pipeline_status: 'Stage', lost_reason: 'Lost reason', probability: 'Probability',
  projected_win_date: 'Expected close date', bd_director_id: 'Owner', territory_id: 'Account (territory)',
  text: 'Subject', activity_type: 'Type', due_date: 'Due date', due_time: 'Due time', duration: 'Duration', assignee_id: 'Assigned to',
  location: 'Location', note: 'Note', done: 'Done',
};
const LIST_MAX = 200;

// ---- Which deals

/** Tickets linked to a Pipedrive deal, for picking which to send. */
export const linkedTickets = () => db.prepare(`SELECT t.id, t.opportunity_title AS title, t.pipeline_id, p.name AS pipeline FROM tickets t
  LEFT JOIN pipelines p ON p.id = t.pipeline_id WHERE t.pipedrive_id IS NOT NULL AND t.archive_set_id IS NULL ORDER BY t.opportunity_title COLLATE NOCASE`).all();

/** scope: {} for every linked deal, { pipeline_id }, or { ticket_ids: [] }. */
function ticketsIn(scope = {}) {
  const ids = Array.isArray(scope.ticket_ids) ? scope.ticket_ids.map(Number).filter(Boolean) : null;
  return db.prepare(`SELECT * FROM tickets WHERE pipedrive_id IS NOT NULL AND archive_set_id IS NULL
    ${scope.pipeline_id ? 'AND pipeline_id = @pipeline' : ''} ${ids ? 'AND id IN (SELECT value FROM json_each(@ids))' : ''}
    ORDER BY opportunity_title COLLATE NOCASE`).all({ pipeline: Number(scope.pipeline_id) || null, ids: json.str(ids || []) });
}
const everyDeal = (scope = {}) => !scope.pipeline_id && !Array.isArray(scope.ticket_ids);

// ---- Showing values

const name = (u) => (u ? `${u.first_name} ${u.last_name}`.trim() : null);
function shown(field, v) {
  if (v == null || v === '') return '—';
  if (field === 'bd_director_id' || field === 'assignee_id') return name(db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(v)) || '—';
  if (field === 'territory_id') return db.prepare('SELECT name FROM territories WHERE id = ?').get(v)?.name || '—';
  if (field === 'done') return v ? 'Yes' : 'No';
  if (field === 'value') return `$${Number(v).toLocaleString('en-US')}`;
  if (field === 'probability') return `${v}%`;
  return String(v);
}
const changeList = (row, keys) => {
  const snap = json.parse(row.pipedrive_snapshot, {});
  return keys.map((k) => ({ field: k, label: FIELD_LABELS[k], from: shown(k, snap[k]), to: shown(k, row[k]) }));
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
  WHERE t.id IN (SELECT value FROM json_each(@ids)) AND f.email_id IS NULL AND f.pipedrive_id IS NULL AND f.pipedrive_note_id IS NULL`;

function plan(kinds, scope) {
  const tickets = ticketsIn(scope);
  const ids = json.str(tickets.map((t) => t.id));
  const dealIds = new Set(tickets.map((t) => t.pipedrive_id));
  const deletes = (kind) => db.prepare('SELECT * FROM pipedrive_deletes WHERE kind = ?').all(kind)
    .filter((d) => (d.deal_id ? dealIds.has(d.deal_id) : everyDeal(scope)));
  const out = { tickets: tickets.length };
  const on = (k) => kinds.includes(k);

  if (on('deals')) {
    out.deals = tickets.map((t) => ({ ticket_id: t.id, title: t.opportunity_title, fields: kitChanges(t, DEAL_TRACKED) }))
      .filter((d) => d.fields.length).map((d) => ({ ...d, changes: changeList(tickets.find((t) => t.id === d.ticket_id), d.fields) }));
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
      remove: deletes('file'),
    };
  }
  if (on('products')) {
    out.products = db.prepare(`SELECT p.*, t.opportunity_title AS title FROM ticket_products p JOIN tickets t ON t.id = p.ticket_id
      WHERE t.id IN (SELECT value FROM json_each(@ids)) AND p.pipedrive_id IS NULL ORDER BY t.id, p.position`).all({ ids })
      .map((p) => ({ id: p.id, ticket_id: p.ticket_id, title: p.title, text: `${p.name} × ${p.quantity}` }));
  }
  if (on('followers')) {
    out.followers = tickets.map((t) => ({
      ticket_id: t.id, title: t.opportunity_title,
      people: db.prepare(`SELECT u.id, u.first_name, u.last_name, u.pipedrive_id FROM ticket_followers f JOIN users u ON u.id = f.user_id WHERE f.ticket_id = ?`).all(t.id),
    })).filter((x) => x.people.length).map((x) => ({ ...x, names: x.people.map(name), missing: x.people.filter((u) => !u.pipedrive_id).map(name) }));
  }
  if (on('contacts')) {
    const linked = db.prepare(`SELECT tc.ticket_id, tc.is_primary, c.* FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id
      WHERE tc.ticket_id IN (SELECT value FROM json_each(@ids))`).all({ ids });
    const newPeople = new Map(linked.filter((c) => !c.pipedrive_id).map((c) => [c.id, c]));
    out.contacts = {
      add: [...newPeople.values()].map((c) => ({ id: c.id, text: [c.first_name, c.last_name].filter(Boolean).join(' '), organization: c.organization })),
      tickets: [...new Set(linked.map((c) => c.ticket_id))].length,
    };
  }
  return { out, tickets };
}

/** What a send would do, for the preview. Lists are cut at LIST_MAX; counts are whole. */
export function preview(kinds, scope) {
  const { out } = plan(kinds, scope);
  const cut = (list) => (Array.isArray(list) ? { count: list.length, items: list.slice(0, LIST_MAX) } : list);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v && !Array.isArray(v) && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k2, v2]) => [k2, cut(v2)])) : cut(v)]));
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

/** Start a send in the background. `by` is the admin ({ id, name }). */
export function startSend(kinds, scope, by) {
  if (!sendingAllowed()) throw new Error('Sending to Pipedrive is off on this server (it’s on in production, or with PIPEDRIVE_PUSH=1).');
  const chosen = kinds.filter((k) => SEND_KINDS.includes(k));
  if (!chosen.length) throw new Error('Choose at least one thing to send.');
  runJob('send to Pipedrive', (phase) => send(chosen, scope, phase), (result, e) => setSetting('pipedrive_last_send', json.str({
    at: new Date().toISOString(), by: by.name, kinds: chosen, ok: !e, ...(e ? { error: e.message } : { result }),
  })));
}
export const lastSend = () => json.parse(getSetting('pipedrive_last_send'), null);

async function send(kinds, scope, phase) {
  const { out, tickets } = plan(kinds, scope);
  const sent = {};
  const count = (k, n = 1) => { sent[k] = (sent[k] || 0) + n; };
  const conflicts = [];
  const skipped = [];
  const errors = [];
  const attempt = async (what, fn) => {
    try { await fn(); } catch (e) { if (errors.length < LIST_MAX) errors.push(`${what}: ${e.message}`); }
  };
  const ticketById = new Map(tickets.map((t) => [t.id, t]));

  // Deal fields, checked against the deal as it is now.
  if (out.deals?.length) {
    phase('Sending deal fields');
    const accountField = (await all('dealFields')).find((f) => f.edit_flag && f.name === 'Account');
    const lookups = {
      stageName: (id) => db.prepare('SELECT name FROM pipeline_stages WHERE pipedrive_id = ?').get(id)?.name,
      owner: (u) => (idOf(u) ? db.prepare('SELECT id FROM users WHERE pipedrive_id = ?').get(idOf(u))?.id ?? null : null),
      territory: (d) => (accountField ? db.prepare('SELECT id FROM territories WHERE pipedrive_id = ?').get(Number(d[accountField.key]) || -1)?.id ?? null : null),
    };
    for (const [i, d] of out.deals.entries()) {
      phase(`Sending deal fields (${i + 1} of ${out.deals.length})`);
      const t = ticketById.get(d.ticket_id);
      await attempt(t.opportunity_title, async () => {
        const { data: deal } = await call(`deals/${t.pipedrive_id}`);
        const now = dealView(deal, lookups);
        const snap = json.parse(t.pipedrive_snapshot, {});
        const body = {};
        const sentFields = [];
        for (const f of d.fields) {
          if (!same(now[f], snap[f])) { conflicts.push({ ticket_id: t.id, title: t.opportunity_title, field: FIELD_LABELS[f] }); continue; }
          const v = t[f];
          if (f === 'opportunity_title') body.title = v;
          else if (f === 'value') body.value = v ?? 0;
          else if (f === 'probability') body.probability = v;
          else if (f === 'projected_win_date') body.expected_close_date = v;
          else if (f === 'lost_reason') { if (t.pipeline_status === 'Lost') body.lost_reason = v || ''; }
          else if (f === 'pipeline_status') {
            if (v === 'Awarded') body.status = 'won';
            else if (v === 'Lost') { body.status = 'lost'; if (t.lost_reason) body.lost_reason = t.lost_reason; }
            else {
              const stage = db.prepare('SELECT pipedrive_id FROM pipeline_stages WHERE pipeline_id = ? AND name = ? AND pipedrive_id IS NOT NULL').get(t.pipeline_id, v);
              if (!stage) { skipped.push(`${t.opportunity_title}: Pipedrive has no "${v}" stage in this pipeline`); continue; }
              body.stage_id = stage.pipedrive_id;
              body.status = 'open';
            }
          } else if (f === 'bd_director_id') {
            const owner = pdUser(v);
            if (!owner) { skipped.push(`${t.opportunity_title}: ${shown(f, v)} has no Pipedrive user, so the owner wasn't changed`); continue; }
            body.owner_id = owner;
          } else if (f === 'territory_id') {
            if (!accountField) { skipped.push(`${t.opportunity_title}: Pipedrive has no Account field`); continue; }
            const option = v ? db.prepare('SELECT pipedrive_id FROM territories WHERE id = ?').get(v)?.pipedrive_id
              : accountField.options?.find((o) => o.label === 'N/A')?.id ?? null;
            if (v && !option) { skipped.push(`${t.opportunity_title}: territory ${shown(f, v)} isn't an Account option in Pipedrive`); continue; }
            body.custom_fields = { [accountField.key]: option };
          }
          sentFields.push(f);
        }
        if (!sentFields.length) return;
        await call(`deals/${t.pipedrive_id}`, {}, { method: 'PATCH', body, v2: true });
        const next = { ...snap, ...Object.fromEntries(sentFields.map((f) => [f, t[f] ?? null])) };
        db.prepare('UPDATE tickets SET pipedrive_snapshot = ? WHERE id = ?').run(snapshotOf(next, DEAL_TRACKED), t.id);
        count('deals');
      });
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
    });
  }

  // Deletions first, so nothing deleted in KIT is touched below.
  const removeAll = async (list, kind, endpoint) => {
    for (const d of list || []) {
      await attempt(`Deleting ${kind} ${d.pipedrive_id}`, async () => {
        try { await call(`${endpoint}/${d.pipedrive_id}`, {}, { method: 'DELETE' }); } catch (e) { if (!notFound(e)) throw e; }
        db.prepare('DELETE FROM pipedrive_deletes WHERE kind = ? AND pipedrive_id = ?').run(kind, d.pipedrive_id);
        count(`${kind}sDeleted`);
      });
    }
  };
  if (out.notes) { phase('Deleting notes'); await removeAll(out.notes.remove, 'note', 'notes'); }
  if (out.files) { phase('Deleting files'); await removeAll(out.files.remove, 'file', 'files'); }
  if (out.activities) { phase('Deleting activities'); await removeAll(out.activities.remove, 'activity', 'activities'); }

  // Notes: KIT's say who wrote them; notes from Pipedrive keep their own wording.
  if (out.notes) {
    phase('Sending notes');
    const notes = db.prepare(NOTE_SQL).all({ ids: json.str(tickets.map((t) => t.id)) });
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
      });
    }
  }

  // Activities: new ones are added; edited ones send only the fields Pipedrive hasn't changed since the last pull.
  if (out.activities) {
    const owner = (u) => (idOf(u) ? db.prepare('SELECT id FROM users WHERE pipedrive_id = ?').get(idOf(u))?.id ?? null : null);
    const fieldsFor = (k, keys) => {
      const body = {};
      keys.forEach((f) => {
        if (f === 'text') body.subject = k.text;
        else if (f === 'activity_type') body.type = activityTypeKey(k.activity_type);
        else if (f === 'due_date' || f === 'due_time') Object.assign(body, Object.fromEntries(Object.entries(utcDateTime(k.due_date, k.due_time)).map(([x, v]) => [`due_${x}`, v ?? ''])));
        else if (f === 'duration') body.duration = k.duration || '';
        else if (f === 'assignee_id') { const u = pdUser(k.assignee_id); if (u) body.user_id = u; }
        else if (f === 'location') body.location = k.location || '';
        else if (f === 'note') body.note = k.note ? paragraphs(k.note) : '';
        else if (f === 'done') body.done = k.done ? 1 : 0;
      });
      return body;
    };
    for (const [i, a] of out.activities.add.entries()) {
      phase(`Sending activities (${i + 1} of ${out.activities.add.length + out.activities.edit.length})`);
      const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(a.id);
      const t = ticketById.get(a.ticket_id);
      await attempt(`Activity "${a.text}"`, async () => {
        const body = { ...fieldsFor(k, TASK_TRACKED), deal_id: t.pipedrive_id };
        if (!body.type) body.type = 'task';
        const { data } = await call('activities', {}, { method: 'POST', body });
        const view = activityView(data, owner);
        db.prepare('UPDATE ticket_tasks SET pipedrive_id = ?, pipedrive_snapshot = ? WHERE id = ?').run(data.id, snapshotOf(view, TASK_TRACKED), k.id);
        count('activitiesAdded');
      });
    }
    for (const [i, a] of out.activities.edit.entries()) {
      phase(`Sending activities (${out.activities.add.length + i + 1} of ${out.activities.add.length + out.activities.edit.length})`);
      const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(a.id);
      await attempt(`Activity "${a.text}"`, async () => {
        const { data: now } = await call(`activities/${k.pipedrive_id}`);
        const view = activityView(now, owner);
        const snap = json.parse(k.pipedrive_snapshot, {});
        const ok = a.fields.filter((f) => {
          if (same(view[f], snap[f])) return true;
          conflicts.push({ ticket_id: a.ticket_id, title: `${a.title} · ${a.text}`, field: FIELD_LABELS[f] });
          return false;
        });
        if (!ok.length) return;
        await call(`activities/${k.pipedrive_id}`, {}, { method: 'PUT', body: fieldsFor(k, ok) });
        const next = { ...snap, ...Object.fromEntries(ok.map((f) => [f, k[f] ?? null])) };
        db.prepare('UPDATE ticket_tasks SET pipedrive_snapshot = ? WHERE id = ?').run(snapshotOf(next, TASK_TRACKED), k.id);
        count('activitiesUpdated');
      });
    }
  }

  // Files: an upload goes as a file; a link goes as a note with the link.
  if (out.files) {
    phase('Sending files');
    for (const f of db.prepare(FILE_SQL).all({ ids: json.str(tickets.map((t) => t.id)) })) {
      await attempt(`File ${f.original_name}`, async () => {
        if (f.url) {
          const content = `${byLine(f)}<p>Linked document: <a href="${escapeHtml(f.url)}">${escapeHtml(f.original_name)}</a></p>`;
          const { data } = await call('notes', {}, { method: 'POST', body: { content, deal_id: f.deal_id } });
          db.prepare('UPDATE ticket_files SET pipedrive_note_id = ? WHERE id = ?').run(data.id, f.id);
        } else {
          const form = new FormData();
          form.append('file', new Blob([fs.readFileSync(path.join(uploadDir, f.stored_name))], { type: f.mime_type || 'application/octet-stream' }), f.original_name);
          form.append('deal_id', String(f.deal_id));
          const { data } = await call('files', {}, { method: 'POST', body: form });
          db.prepare('UPDATE ticket_files SET pipedrive_id = ? WHERE id = ?').run(data.id, f.id);
        }
        count('filesAdded');
      });
    }
  }

  // Products: matched by name to Pipedrive's product catalog; KIT doesn't add to the catalog.
  if (out.products?.length) {
    phase('Sending products');
    const catalog = new Map((await all('products')).map((p) => [String(p.name).toLowerCase(), p.id]));
    for (const item of out.products) {
      const p = db.prepare('SELECT * FROM ticket_products WHERE id = ?').get(item.id);
      const productId = catalog.get(String(p.name).toLowerCase());
      if (!productId) { skipped.push(`${item.title}: "${p.name}" isn't in Pipedrive's product catalog`); continue; }
      await attempt(`Product ${p.name}`, async () => {
        const { data } = await call(`deals/${ticketById.get(p.ticket_id).pipedrive_id}/products`, {}, { method: 'POST', body: {
          product_id: productId, item_price: p.item_price, quantity: p.quantity, discount: p.discount, discount_type: 'percentage', comments: p.comments || '',
        } });
        db.prepare('UPDATE ticket_products SET pipedrive_id = ? WHERE id = ?').run(data.id, p.id);
        count('products');
      });
    }
  }

  // Followers: added where they aren't following yet. Nobody is taken off a deal.
  for (const x of out.followers || []) {
    phase('Sending followers');
    const t = ticketById.get(x.ticket_id);
    if (x.missing.length) skipped.push(`${t.opportunity_title}: ${x.missing.join(', ')} ${x.missing.length === 1 ? 'has' : 'have'} no Pipedrive user`);
    const want = x.people.filter((u) => u.pipedrive_id);
    if (!want.length) continue;
    await attempt(`Followers on ${t.opportunity_title}`, async () => {
      const following = new Set((await all(`deals/${t.pipedrive_id}/followers`)).map((f) => f.user_id));
      for (const u of want.filter((w) => !following.has(w.pipedrive_id))) {
        await call(`deals/${t.pipedrive_id}/followers`, {}, { method: 'POST', body: { user_id: u.pipedrive_id } });
        count('followers');
      }
    });
  }

  // People: new contacts become Pipedrive persons; each ticket's people become the deal's participants, and its
  // primary contact the deal's contact person. Nobody is taken off a deal.
  if (out.contacts) {
    phase('Sending people');
    const linked = db.prepare(`SELECT tc.ticket_id, tc.is_primary, c.* FROM ticket_contacts tc JOIN contacts c ON c.id = tc.contact_id
      WHERE tc.ticket_id IN (SELECT value FROM json_each(?))`).all(json.str(tickets.map((t) => t.id)));
    for (const c of out.contacts.add) {
      const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(c.id);
      await attempt(`Person ${c.text}`, async () => {
        const { data } = await call('persons', {}, { method: 'POST', body: {
          name: [row.first_name, row.last_name].filter(Boolean).join(' ') || '(no name)',
          ...(row.email ? { email: [{ value: row.email, primary: true, label: 'work' }] } : {}),
          ...(row.phone ? { phone: [{ value: row.phone, primary: true, label: 'work' }] } : {}),
        } });
        db.prepare('UPDATE contacts SET pipedrive_id = ? WHERE id = ?').run(data.id, row.id);
        count('peopleAdded');
      });
    }
    const byTicket = new Map();
    linked.forEach((c) => byTicket.set(c.ticket_id, [...(byTicket.get(c.ticket_id) || []), c]));
    for (const [ticketId, people] of byTicket) {
      const t = ticketById.get(ticketId);
      await attempt(`People on ${t.opportunity_title}`, async () => {
        const pdIds = people.map((c) => ({ ...c, pd: db.prepare('SELECT pipedrive_id FROM contacts WHERE id = ?').get(c.id).pipedrive_id })).filter((c) => c.pd);
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
      });
    }
  }

  return { sent, conflicts: conflicts.slice(0, LIST_MAX), skipped: skipped.slice(0, LIST_MAX), errors };
}
