// Staffing events on a pipeline ticket (ticket_process_steps): RFI responses, white papers, gate reviews, SOO, SOW, ROM and
// proposals a solution architect is staffed to. Each goes with a process tag, and every open one is on the SAC list
// (but for an Initial Gate Review still in draft: it joins the list, and tags the ticket, when it's submitted)
// (Solution Architect Coordination). Making one tags the ticket; tagging a ticket with a process tag makes one. Its tag
// comes off the ticket when the event is marked done or deleted, unless another open event of that type still needs it; and
// taking the tag off the ticket takes its open events off the list.
import { db, json, getSetting, setSetting, tagName, tagKey } from './db.js';
import { reportStager, QUALIFIED_STAGES } from './pipelines.js';
import { recordWork } from './worklog.js';
import { milestoneOf, eventForTag, cleanReviews, cleanQualification, gatePassed, gateDecision, canOverrideGate, cleanGateRule, QUALIFICATION, STAFFING_EVENTS, CRITICALITY, defaultCriticality, PROCESS_TAG_NAMES } from '../src/lib/process.js';

export const isCriticality = (k) => CRITICALITY.some((c) => c.key === k);

/** The staffing event a tag on a ticket stands for: a process tag under whatever name it goes by now, and nothing else. */
const eventOfLabel = (label) => { const key = tagKey(label); return key ? eventForTag(key) : undefined; };

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
  const key = milestoneOf(type)?.tag;
  if (!key) return; // an earlier milestone, which has no tag
  const tag = tagName(key); // the name the process tag goes by now
  if (openOf(ticketId, type)) tagTicket(ticketId, tag);
  else untagTicket(ticketId, tag);
}

/** The open (not done, not a draft) staffing event of `type` on the ticket, if there is one. */
const openOf = (ticketId, type) => db.prepare('SELECT id FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL AND draft = 0 ORDER BY id DESC').get(ticketId, type);
/** The draft of `type` on the ticket (an Initial Gate Review not yet submitted), if there is one. */
const draftOf = (ticketId, type) => db.prepare('SELECT id FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL AND draft = 1 ORDER BY id DESC').get(ticketId, type);

/**
 * Make a staffing event of `type` on the ticket and tag the ticket for it. With `reuse`, an open one of that type already
 * there is used instead of a second. Unless `criticality` says otherwise it starts As Available on a ticket in Prospecting
 * (or a stage reports count as Prospecting) and Queued anywhere else. With `draft` (an Initial Gate Review being filled in) the
 * ticket isn't tagged and the event stays off the SAC list until it's submitted; staffing a ticket that has a draft
 * submits the draft. Returns { id, created }.
 */
export function addStaffingEvent(user, ticketId, type, { dueDate = null, criticality = null, reuse = false, quiet = false, draft = false } = {}) {
  const def = milestoneOf(type);
  return db.transaction(() => {
    const existing = (reuse || draft) && openOf(ticketId, type);
    const drafted = draftOf(ticketId, type);
    if (draft) { // asked for the form, not for staffing: whatever is there already will do
      if (existing || drafted) return { id: (existing || drafted).id, created: false };
    } else {
      tagTicket(ticketId, tagName(def.tag));
      if (existing) return { id: existing.id, created: false };
      if (drafted) { // staffed while its form was being filled in: that form is the event
        db.prepare('UPDATE ticket_process_steps SET draft = 0 WHERE id = ?').run(drafted.id);
        return { id: drafted.id, created: false };
      }
    }
    const t = db.prepare('SELECT pipeline_id, pipeline_status FROM tickets WHERE id = ?').get(ticketId);
    const start = defaultCriticality(reportStager().of(t?.pipeline_id, t?.pipeline_status));
    const id = db.prepare(`INSERT INTO ticket_process_steps (ticket_id, step_type, step_date, reviews, fields, criticality, author_id, draft)
      VALUES (?, ?, ?, ?, '{}', ?, ?, ?)`).run(ticketId, type, dueDate, json.str(cleanReviews({})), isCriticality(criticality) ? criticality : start, user?.id ?? null, draft ? 1 : 0).lastInsertRowid;
    if (quiet || draft) return { id, created: true }; // made from a tag that was already there: nobody's work, and the ticket isn't touched
    recordWork(user, { kind: 'process', ticket_id: ticketId, ref_id: id, summary: type });
    db.prepare("UPDATE tickets SET updated_at = datetime('now') WHERE id = ?").run(ticketId);
    return { id, created: true };
  })();
}

/** Whether anything has been put into a staffing event: text, a decision, a response, people, documents or notes. */
function hasWork(p) {
  const text = [p.notes, p.sa_notes, p.sa_response, p.pricing, p.decision].some((v) => String(v || '').trim())
    || Object.keys(json.parse(p.qualification, {})).length > 0;
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
  json.parse(after, []).filter((l) => !had.has(String(l).toLowerCase())).map(eventOfLabel).filter(Boolean)
    .forEach((def) => addStaffingEvent(user, ticketId, def.type, { reuse: true }));
  [...had].filter((l) => !has.has(l)).map(eventOfLabel).filter(Boolean).forEach((def) => db.transaction(() => {
    db.prepare('SELECT * FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? AND completed_at IS NULL AND draft = 0').all(ticketId, def.type).forEach((p) => {
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
    .all(...PROCESS_TAG_NAMES.map((n) => `%"${tagName(n).toLowerCase()}"%`), ...(ticketId ? [ticketId] : []));
  tagged.forEach((t) => json.parse(t.labels, []).map(eventOfLabel).filter(Boolean)
    .forEach((def) => addStaffingEvent(t.created_by ? { id: t.created_by } : null, t.id, def.type, { reuse: true, quiet: true })));
}

/** What makes a qualified lead: the rule saved in the pipeline's settings, or the one KIT starts with. */
export const gateRule = () => cleanGateRule(json.parse(getSetting('gate_rule'), null));
export function saveGateRule(input) {
  const rule = cleanGateRule(input);
  setSetting('gate_rule', json.str(rule));
  return rule;
}
/** Whether this person can change what makes a qualified lead: an admin or a BD team lead. */
export function mayEditGateRule(user) {
  if (!user) return false;
  return user.role === 'admin' || !!db.prepare("SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD' AND ut.role = 'lead'").get(user.id);
}

/**
 * What Marketing has done for each pipeline ticket, which KIT shows as a tag nobody sets or removes:
 * marketing: 'requested' (Marketing requested) once a marketing request is for the ticket or names it, and 'supported'
 *   (Marketing supported) once Marketing has finished the work ticket it made for one of those requests.
 * Marketing dollars are a metric (the Marketing impact report), not a tag. Returns flags(ticketId) -> { marketing }.
 */
function marketingFlagger() {
  const state = new Map(db.prepare(`SELECT x.ticket_id AS id, MAX(w.id IS NOT NULL AND (w.done_at IS NOT NULL OR w.lane = 'done')) AS supported
    FROM (SELECT id AS request_id, for_ticket_id AS ticket_id FROM event_support_requests WHERE for_ticket_id IS NOT NULL
      UNION SELECT request_id, ticket_id FROM marketing_request_tickets) x
      JOIN event_support_requests q ON q.id = x.request_id LEFT JOIN tickets w ON w.id = q.ticket_id
    GROUP BY x.ticket_id`).all().map((r) => [r.id, r.supported ? 'supported' : 'requested']));
  return (id) => ({ marketing: state.get(id) || null });
}

/**
 * The tags KIT works out for a pipeline ticket. The marketing one (see marketingFlagger) shows on any pipeline ticket.
 * The two from the Initial Gate show on an open one, by the stage reports count it in:
 * unq (shown as Unqualified): it sits in a qualified stage (Qualified or later) without a passed Initial Gate Review;
 * qualified (shown as Qualified): it has passed one and is still in Prospecting, ready to be moved over.
 * Nobody sets or removes any of them. Returns flags(ticket) -> { unq, qualified, marketing }, for rows carrying id, ticket_type, deal_status,
 * pipeline_id and pipeline_status.
 */
export function gateFlagger() {
  const rule = gateRule();
  const gates = STAFFING_EVENTS.filter((e) => e.qualifies).map((e) => e.type);
  const passed = new Set(db.prepare(`SELECT ticket_id, step_type, qualification, sa_response, gate_override, draft FROM ticket_process_steps
    WHERE step_type IN (${gates.map(() => '?').join(',')})`).all(...gates)
    .filter((p) => gatePassed({ ...p, qualification: json.parse(p.qualification, {}) }, rule)).map((p) => p.ticket_id));
  const stage = reportStager();
  const marketing = marketingFlagger();
  return (t) => {
    if (!t || (t.ticket_type ?? 'bid') !== 'bid') return { unq: false, qualified: false, marketing: null };
    if ((t.deal_status || 'open') !== 'open') return { unq: false, qualified: false, ...marketing(t.id) };
    const at = stage.of(t.pipeline_id ?? null, t.pipeline_status);
    const ok = passed.has(t.id);
    return { unq: !ok && QUALIFIED_STAGES.includes(at), qualified: ok && at === 'Prospecting', ...marketing(t.id) };
  };
}
/** The Initial Gate Review, the event that qualifies a lead. */
const GATE_TYPE = STAFFING_EVENTS.find((e) => e.qualifies).type;

/**
 * Every Prospecting lead has its Initial Gate Review form waiting: an open pipeline ticket in Prospecting (as reports count
 * its stage) with no Initial Gate Review of any kind gets a draft one. Nobody is alerted and the ticket isn't touched. Run
 * before a ticket's events are listed.
 */
export function ensureGateDraft(ticketId) {
  const t = db.prepare("SELECT id, pipeline_id, pipeline_status, created_by FROM tickets WHERE id = ? AND ticket_type = 'bid' AND deal_status = 'open' AND archive_set_id IS NULL AND archived_at IS NULL").get(ticketId);
  if (!t || reportStager().of(t.pipeline_id, t.pipeline_status) !== 'Prospecting') return;
  if (db.prepare('SELECT 1 FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ?').get(t.id, GATE_TYPE)) return;
  addStaffingEvent(t.created_by ? { id: t.created_by } : null, t.id, GATE_TYPE, { draft: true });
}

/** A staffing event row's gate decision, as lists send it: { passed, gate: null | { result, auto, overridden } }. */
export function gateOut(p, rule = gateRule()) {
  const gate = gateDecision({ ...p, qualification: json.parse(p.qualification, {}) }, rule);
  return { passed: gate?.result === 'approved', gate, draft: !!p.draft };
}

/** Whether this person can set an Initial Gate Review's decision by hand: a BD lead or an Exec Ldr. */
export function mayOverrideGate(user) {
  if (!user) return false;
  return canOverrideGate({ teams: db.prepare('SELECT t.name, ut.role FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ?').all(user.id) });
}

/** The stages whose open tickets were let through the Initial Gate when gate reviews began, along with every won deal. */
const GRANDFATHERED_STAGES = ['Proposal', 'Under Evaluation', 'Awarded'];

/**
 * Once, when gate reviews first go live: every pipeline ticket already in Proposal, Under Evaluation or Awarded (as reports
 * count its stage), and every won deal, is let through the Initial Gate. Each gets a done Initial Gate Review holding the
 * least that passes (the required gates a Yes, each scored test at the minimum, the Technical Fit approved); one it already
 * has is brought up to that instead. Nothing is tagged, alerted or sent to Pipedrive. Returns how many tickets it touched.
 */
export function grandfatherGates() {
  if (getSetting('gate_reviews_grandfathered') === '1') return 0;
  const type = GATE_TYPE;
  const stage = reportStager();
  const rule = gateRule();
  const minimum = (q) => {
    const out = cleanQualification(q);
    rule.yes.forEach((k) => { out[k] = 'yes'; });
    QUALIFICATION.filter((x) => x.kind === 'score' && rule.min[x.key] > 0).forEach((x) => { out[x.key] = Math.max(out[x.key] || 0, rule.min[x.key]); });
    return out;
  };
  const insert = db.prepare(`INSERT INTO ticket_process_steps (ticket_id, step_type, reviews, fields, notes, qualification, sa_response, completed_at)
    VALUES (?, ?, ?, '{}', ?, ?, 'approve', datetime('now'))`);
  const raise = db.prepare("UPDATE ticket_process_steps SET qualification = ?, sa_response = 'approve', gate_override = NULL, draft = 0, notes = ? WHERE id = ?");
  return db.transaction(() => {
    const tickets = db.prepare("SELECT id, pipeline_id, pipeline_status, deal_status FROM tickets WHERE ticket_type = 'bid'").all().filter((t) => {
      const status = t.deal_status || 'open';
      return status === 'won' || (status === 'open' && GRANDFATHERED_STAGES.includes(stage.of(t.pipeline_id, t.pipeline_status)));
    });
    const reviews = db.prepare('SELECT id, step_type, qualification, sa_response, gate_override, draft, notes FROM ticket_process_steps WHERE ticket_id = ? AND step_type = ? ORDER BY id DESC');
    let n = 0;
    tickets.forEach((t) => {
      const mine = reviews.all(t.id, type).map((p) => ({ ...p, qualification: json.parse(p.qualification, {}) }));
      if (mine.some((p) => gatePassed(p, rule))) return;
      const why = `Grandfathered: already ${t.deal_status === 'won' ? 'won' : `in ${t.pipeline_status}`} when gate reviews began, so it was entered as passing the Initial Gate.`;
      if (mine.length) raise.run(json.str(minimum(mine[0].qualification)), [mine[0].notes, why].filter(Boolean).join('\n\n'), mine[0].id);
      else insert.run(t.id, type, json.str(cleanReviews({})), why, json.str(minimum({})));
      n += 1;
    });
    setSetting('gate_reviews_grandfathered', '1');
    return n;
  })();
}
