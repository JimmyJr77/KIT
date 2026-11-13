// Where a lead came from, and how marketing is tied to it. A pipeline ticket carries lead source tags (Event Lead, Google
// Lead, Marketing Lead, BD Lead; see LEAD_TAGS in db.js) and can be tied to events (ticket_events):
//   - A ticket that comes out of an event is sourced by the event and by its BD director; and by Marketing too, when
//     Marketing was asked for support at that event and took the request.
//   - A lead Marketing feeds the team (Marketing › Leads) is sourced by Marketing, and by the event it came from, if any.
//   - Tying an event, a request or spend to a ticket that already exists is marketing supporting it later, not sourcing it.
import { db, json, LEAD_TAGS, GOOGLE_SOLUTION_TAG, pipelineTicketsClosed, PIPELINE_TICKETS_CLOSED, defaultAssignment } from './db.js';
import { defaultPipeline } from './pipelines.js';
import { recordWork } from './worklog.js';

export { LEAD_TAGS, GOOGLE_SOLUTION_TAG };
const lower = (s) => String(s).toLowerCase();
export const hasTag = (labels, tag) => (labels || []).some((l) => lower(l) === lower(tag));

/** Add tags to a ticket, keeping the ones it has. A tag Pipedrive has taken over waits to be sent, like any tag change. */
export function addTicketTags(ticketId, names) {
  const t = db.prepare('SELECT id, labels, pipedrive_id FROM tickets WHERE id = ?').get(ticketId);
  if (!t) return;
  const have = json.parse(t.labels, []);
  const add = names.filter((n) => n && !hasTag(have, n));
  if (!add.length) return;
  const inPipedrive = add.some((n) => db.prepare('SELECT 1 FROM labels WHERE name = ? COLLATE NOCASE AND pipedrive_id IS NOT NULL').get(n));
  db.prepare(`UPDATE tickets SET labels = ?, labels_pending = CASE WHEN ? THEN 1 ELSE labels_pending END, updated_at = datetime('now') WHERE id = ?`)
    .run(json.str([...have, ...add]), inPipedrive && t.pipedrive_id ? 1 : 0, t.id);
}

/** Whether Marketing was asked for support at an event and took the request. */
export const marketingSupported = (eventId) => !!db.prepare("SELECT 1 FROM event_support_requests WHERE event_id = ? AND status = 'accepted'").get(eventId);

/** Tie a pipeline ticket to an event. `sourced` marks the event as where the lead began (it never unmarks one). */
export function linkTicketEvent(ticketId, eventId, { sourced = false, userId = null } = {}) {
  db.prepare(`INSERT INTO ticket_events (ticket_id, event_id, sourced, added_by) VALUES (?, ?, ?, ?)
    ON CONFLICT (ticket_id, event_id) DO UPDATE SET sourced = MAX(sourced, excluded.sourced)`).run(ticketId, eventId, sourced ? 1 : 0, userId);
}

/** A ticket that came out of an event: the event, its BD director, and Marketing (when it supported the event) are the source. */
export function sourceFromEvent(ticketId, eventId, userId) {
  linkTicketEvent(ticketId, eventId, { sourced: true, userId });
  addTicketTags(ticketId, [LEAD_TAGS.event, LEAD_TAGS.bd, marketingSupported(eventId) && LEAD_TAGS.marketing]);
}

/**
 * Make a pipeline ticket on the default pipeline, as New ticket does. It belongs to `directorId` (default: whoever is
 * signed in), who is also its BD director if they're one. Returns { id } or { error, status }.
 */
export function createPipelineTicket(user, { title, organization = null, value = null, directorId = null }) {
  if (pipelineTicketsClosed()) return { status: 403, error: PIPELINE_TICKETS_CLOSED };
  const name = String(title || '').trim();
  if (!name) return { status: 400, error: 'Opportunity title is required' };
  const assign = defaultAssignment(directorId || user.id, null);
  const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, value, ticket_type, created_by, bd_director_id, territory_id, pipeline_id)
    VALUES (?, ?, ?, 'bid', ?, ?, ?, ?)`).run(name, String(organization || '').trim() || null, Number(value) > 0 ? Number(value) : null,
    directorId || user.id, assign.bd_director_id, assign.territory_id, defaultPipeline()?.id ?? null).lastInsertRowid;
  recordWork(user, { kind: 'ticket', ticket_id: id, summary: name });
  return { id };
}
