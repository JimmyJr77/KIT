// Staffing events on a pipeline ticket (ticket_process_steps): RFI responses, white papers, gate reviews, SOO, SOW, ROM and
// proposals a solution architect is staffed to. Each goes with a process tag, and every open one is on the SAC list
// (Solution Architect Coordination). Making one tags the ticket; tagging a ticket with a process tag makes one. Its tag
// comes off the ticket when the event is marked done or deleted, unless another open event of that type still needs it; and
// taking the tag off the ticket takes its open events off the list.
import { db, json } from './db.js';
import { reportStager } from './pipelines.js';
import { recordWork } from './worklog.js';
import { milestoneOf, eventForTag, cleanReviews, CRITICALITY, defaultCriticality, PROCESS_TAG_NAMES } from '../src/lib/process.js';

export const isCriticality = (k) => CRITICALITY.some((c) => c.key === k);

/** Put `tag` on the ticket if it isn't there. A ticket from Pipedrive waits for an admin to send the change. */
export function tagTicket(ticketId, tag) {
  if (!tag) return;
  const t = db.prepare('SELECT id, labels, pipedrive_id FROM tickets WHERE id = ?').get(ticketId);
  if (!t) return;
  const labels = json.parse(t.labels, []);
  if (labels.some((l) => String(l).toLowerCase() === tag.toLowerCase())) return;
  db.prepare('INSERT OR IGNORE INTO labels (name) VALUES (?)').run(tag);
  db.prepare('UPDATE tickets SET labels = ?, labels_pending = CASE WHEN pipedrive_id IS NULL THEN labels_pending ELSE 1 END WHERE id = ?').run(json.str([...labels, tag]), t.id);
}

/** Take `tag` off the ticket if it's there. A ticket from Pipedrive waits for an admin to send the change. */
function untagTicket(ticketId, tag) {
  const t = db.prepare('SELECT id, labels FROM tickets WHERE id = ?').get(ticketId);
  if (!t || !tag) return;
  const labels = json.parse(t.labels, []);
  const kept = labels.filter((l) => String(l).toLowerCase() !== tag.toLowerCase());
  if (kept.length === labels.length) return;
  db.prepare('UPDATE tickets SET labels = ?, labels_pending = CASE WHEN pipedrive_id IS NULL THEN labels_pending ELSE 1 END WHERE id = ?').run(json.str(kept), t.id);
}

/**
 * After a staffing event of `type` is marked done, reopened, deleted or changed to or from that type: the ticket carries the
 * type's process tag while it has an open event of that type, and not otherwise.
 */
export function settleTag(ticketId, type) {
  const tag = milestoneOf(type)?.tag;
  if (!tag) return; // an earlier milestone, which has no tag
  if (openOf(ticketId, type)) tagTicket(ticketId, tag);
  else untagTicket(ticketId, tag);
}

/** The open (not done) staffing event of `type` on the ticket, if there is one. */
const openOf = (ticketId, type) => db.prepare('SELECT id FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL ORDER BY id DESC').get(ticketId, type);

/**
 * Make a staffing event of `type` on the ticket and tag the ticket for it. With `reuse`, an open one of that type already
 * there is used instead of a second. Unless `criticality` says otherwise it starts As Available on a ticket in Prospecting
 * (or a stage reports count as Prospecting) and Queued anywhere else. Returns { id, created }.
 */
export function addStaffingEvent(user, ticketId, type, { dueDate = null, criticality = null, reuse = false, quiet = false } = {}) {
  const def = milestoneOf(type);
  return db.transaction(() => {
    const existing = reuse && openOf(ticketId, type);
    tagTicket(ticketId, def.tag);
    if (existing) return { id: existing.id, created: false };
    const t = db.prepare('SELECT pipeline_id, pipeline_status FROM tickets WHERE id = ?').get(ticketId);
    const start = defaultCriticality(reportStager().of(t?.pipeline_id, t?.pipeline_status));
    const id = db.prepare(`INSERT INTO ticket_process_steps (ticket_id, step_type, step_date, reviews, fields, criticality, author_id)
      VALUES (?, ?, ?, ?, '{}', ?, ?)`).run(ticketId, type, dueDate, json.str(cleanReviews({})), isCriticality(criticality) ? criticality : start, user?.id ?? null).lastInsertRowid;
    if (quiet) return { id, created: true }; // made from a tag that was already there: nobody's work, and the ticket isn't touched
    recordWork(user, { kind: 'process', ticket_id: ticketId, ref_id: id, summary: type });
    db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(ticketId);
    return { id, created: true };
  })();
}

/** Whether anything has been put into a staffing event: text, a decision, a response, people, documents or notes. */
function hasWork(p) {
  const text = [p.notes, p.sa_notes, p.sa_response, p.pricing, p.decision].some((v) => String(v || '').trim());
  const fields = Object.values(json.parse(p.fields, {})).some((v) => String(v || '').trim());
  const people = Object.values(cleanReviews(json.parse(p.reviews, {}))).some((a) => a.people.length || a.approved.length || a.notes);
  return text || fields || people
    || !!db.prepare('SELECT 1 FROM ticket_files WHERE process_step_id = ?').get(p.id)
    || !!db.prepare('SELECT 1 FROM ticket_comments WHERE process_step_id = ?').get(p.id);
}

/**
 * After someone changes a ticket's tags. Each process tag newly on it queues its staffing event (and so puts the ticket on
 * the SAC list), unless one of that type is already open. Each process tag taken off takes its open events off the SAC
 * list: one nobody has put anything into is deleted, and one with work in it is marked done, so the work is kept (reopening
 * it puts the tag back).
 */
export function queueFromTags(user, ticketId, before, after) {
  const lower = (labels) => new Set(json.parse(labels, []).map((l) => String(l).toLowerCase()));
  const had = lower(before);
  const has = lower(after);
  json.parse(after, []).filter((l) => !had.has(String(l).toLowerCase())).map(eventForTag).filter(Boolean)
    .forEach((def) => addStaffingEvent(user, ticketId, def.type, { reuse: true }));
  [...had].filter((l) => !has.has(l)).map(eventForTag).filter(Boolean).forEach((def) => db.transaction(() => {
    db.prepare('SELECT * FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL').all(ticketId, def.type).forEach((p) => {
      if (hasWork(p)) {
        db.prepare("UPDATE ticket_process_steps SET completed_at = datetime('now'), completed_by = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(user?.id ?? null, user?.id ?? null, p.id);
      } else {
        db.prepare('DELETE FROM ticket_process_steps WHERE id = ?').run(p.id);
        db.prepare("DELETE FROM work_log WHERE kind = 'process' AND ref_id = ?").run(p.id);
      }
    });
  })());
}

/**
 * A process tag on a ticket means it's staffed, however the tag got there (from Pipedrive, or before staffing events
 * existed): every open pipeline ticket carrying one, with no open event of that type, gets the event, queued under the
 * ticket's owner, and so goes on the SAC list. With `ticketId`, only that ticket is looked at. Run before events are listed.
 */
export function staffFromTags(ticketId = null) {
  const tagged = db.prepare(`SELECT t.id, t.labels, t.created_by FROM tickets t
    WHERE t.ticket_type = 'bid' AND t.archive_set_id IS NULL AND t.archived_at IS NULL AND t.deal_status = 'open'
      AND (${PROCESS_TAG_NAMES.map(() => 'lower(t.labels) LIKE ?').join(' OR ')})${ticketId ? ' AND t.id = ?' : ''}`)
    .all(...PROCESS_TAG_NAMES.map((n) => `%"${n.toLowerCase()}"%`), ...(ticketId ? [ticketId] : []));
  tagged.forEach((t) => json.parse(t.labels, []).map(eventForTag).filter(Boolean)
    .forEach((def) => addStaffingEvent(t.created_by ? { id: t.created_by } : null, t.id, def.type, { reuse: true, quiet: true })));
}
