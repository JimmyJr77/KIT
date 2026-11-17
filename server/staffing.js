// Staffing events on a pipeline ticket (ticket_process_steps): RFI responses, white papers, gate reviews, SOO, SOW, ROM and
// proposals a solution architect is staffed to. Each goes with a process tag, and every open one is on the SAC list
// (Solution Architect Coordination). Making one tags the ticket; tagging a ticket with a process tag makes one.
import { db, json } from './db.js';
import { recordWork } from './worklog.js';
import { milestoneOf, eventForTag, cleanReviews, CRITICALITY, DEFAULT_CRITICALITY } from '../src/lib/process.js';

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

/** The open (not done) staffing event of `type` on the ticket, if there is one. */
const openOf = (ticketId, type) => db.prepare('SELECT id FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL ORDER BY id DESC').get(ticketId, type);

/**
 * Make a staffing event of `type` on the ticket and tag the ticket for it. With `reuse`, an open one of that type already
 * there is used instead of a second. Returns { id, created }.
 */
export function addStaffingEvent(user, ticketId, type, { dueDate = null, criticality = DEFAULT_CRITICALITY, reuse = false } = {}) {
  const def = milestoneOf(type);
  return db.transaction(() => {
    const existing = reuse && openOf(ticketId, type);
    tagTicket(ticketId, def.tag);
    if (existing) return { id: existing.id, created: false };
    const id = db.prepare(`INSERT INTO ticket_process_steps (ticket_id, step_type, step_date, reviews, fields, criticality, author_id)
      VALUES (?, ?, ?, ?, '{}', ?, ?)`).run(ticketId, type, dueDate, json.str(cleanReviews({})), isCriticality(criticality) ? criticality : DEFAULT_CRITICALITY, user.id).lastInsertRowid;
    recordWork(user, { kind: 'process', ticket_id: ticketId, ref_id: id, summary: type });
    db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(ticketId);
    return { id, created: true };
  })();
}

/**
 * After someone changes a ticket's tags: each process tag newly on it queues its staffing event (and so puts the ticket on
 * the SAC list), unless one of that type is already open. Taking a tag off leaves the event alone.
 */
export function queueFromTags(user, ticketId, before, after) {
  const had = new Set(json.parse(before, []).map((l) => String(l).toLowerCase()));
  json.parse(after, []).filter((l) => !had.has(String(l).toLowerCase())).map(eventForTag).filter(Boolean)
    .forEach((def) => addStaffingEvent(user, ticketId, def.type, { reuse: true }));
}
