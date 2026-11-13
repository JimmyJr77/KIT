// Marketing: the library of logos, images, files, and approved text copy anyone can download or paste; requests for
// marketing support (event_support_requests: each for an event or a ticket), which the Marketing team turns into work
// tickets; the leads Marketing feeds the team; what Marketing spends; and how all of that ties to opportunities.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, pipelineTicketsClosed } from '../db.js';
import { recordWork } from '../worklog.js';
import { ASSET_KINDS, COPY_CATEGORIES, REQUEST_CATEGORIES } from '../../src/lib/marketing.js';
import { SPEND_CATEGORIES, spendEntries, spendBreakdown } from '../marketingSpend.js';
import { marketingImpact } from '../marketingImpact.js';
import { LEAD_TAGS, addTicketTags, linkTicketEvent, createPipelineTicket } from '../leads.js';

const r = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});
const discard = (file) => file && fs.rmSync(file.path, { force: true });
const s = (v) => (v == null ? '' : String(v).trim());
const idOr = (v, table) => (Number(v) && db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(Number(v)) ? Number(v) : null);

// ---- The Marketing team

const MARKETING = 'Marketing';
export const marketingTeam = () => db.prepare(`SELECT u.id, u.first_name, u.last_name FROM users u
  JOIN user_teams ut ON ut.user_id = u.id JOIN teams t ON t.id = ut.team_id
  WHERE t.name = ? AND u.active = 1 ORDER BY u.last_name, u.first_name`).all(MARKETING);
/** Marketing takes support requests and keeps the library, and so can admins. */
export const isMarketing = (user) => user.role === 'admin' || marketingTeam().some((u) => u.id === user.id);

const alertInsert = () => db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, event_id, request_id, excerpt)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);

const userOut = (row, prefix) => (row[`${prefix}_first`] ? { first_name: row[`${prefix}_first`], last_name: row[`${prefix}_last`] } : null);

// ---- Support requests

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Boolean))];

/**
 * Save a request and alert everyone on the Marketing team but the requester. A request says what it's for (`event_id`,
 * `for_ticket_id` and maybe that ticket's `activity_id`), why (`justification`, and the event's `purpose`), and which
 * opportunities (`ticket_ids`, pipeline tickets) and meetings (`meeting_ids`) it's about. Returns { id, notified }.
 */
export function createRequest(user, { event_id = null, for_ticket_id = null, activity_id = null, title = null, category = null, due_date = null, details,
  justification = null, purpose = null, ticket_ids = [], meeting_ids = [] }) {
  const id = db.transaction(() => {
    const rid = db.prepare(`INSERT INTO event_support_requests (event_id, for_ticket_id, activity_id, title, category, due_date, details, justification, purpose, requested_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(event_id, for_ticket_id, activity_id, title, category, due_date, details, justification, purpose, user.id).lastInsertRowid;
    const addTicket = db.prepare('INSERT OR IGNORE INTO marketing_request_tickets (request_id, ticket_id) VALUES (?, ?)');
    ticket_ids.forEach((t) => addTicket.run(rid, t));
    const addMeeting = db.prepare('INSERT OR IGNORE INTO marketing_request_meetings (request_id, meeting_id) VALUES (?, ?)');
    meeting_ids.forEach((m) => addMeeting.run(rid, m));
    return rid;
  })();
  const alert = alertInsert();
  const team = marketingTeam().filter((u) => u.id !== user.id);
  team.forEach((u) => alert.run(u.id, user.id, 'support_request', null, event_id, id, (title ? `${title}\n${details}` : details).slice(0, 400)));
  return { id, notified: team.length };
}

/**
 * Marketing takes a request: creates a work ticket for it (linked to the event, if any), with the request as its first comment.
 * The requester gets an alert pointing at the new ticket. Returns { ticket_id } or { error, status }.
 */
export function acceptRequest(user, requestId, ticketTitle) {
  const q = db.prepare('SELECT * FROM event_support_requests WHERE id = ?').get(requestId);
  if (!q) return { status: 404, error: 'Request not found' };
  if (q.status === 'accepted') return { status: 409, error: 'Someone has already taken this request', ticket_id: q.ticket_id };
  if (!isMarketing(user)) return { status: 403, error: 'Only the Marketing team can take support requests' };
  const e = q.event_id ? db.prepare('SELECT * FROM events WHERE id = ?').get(q.event_id) : null;
  const out = requestList('r.id = ?', [q.id])[0];
  const title = s(ticketTitle) || (q.title ? `Marketing: ${q.title}` : e ? `Marketing support: ${e.name}` : `Marketing: ${q.details.split('\n')[0].slice(0, 80)}`);
  const header = e ? `Marketing support requested for ${e.name}:` : `Marketing support requested${q.title ? `: ${q.title}` : ':'}`;
  const meta = [q.category, q.due_date && `Needed by ${q.due_date}`].filter(Boolean).join(' · ');
  const body = [header, meta, q.details,
    q.justification && `Justification: ${q.justification}`,
    q.purpose && `Purpose of the event: ${q.purpose}`,
    out.for_ticket && `For: ${out.for_ticket.title}${out.activity ? ` (activity: ${out.activity.subject})` : ''}`,
    out.tickets.length && `Opportunities: ${out.tickets.map((t) => t.title).join('; ')}`,
    out.meetings.length && `Meetings: ${out.meetings.map((m) => `${m.title} (${m.meeting_date})`).join('; ')}`,
  ].filter(Boolean).join('\n');

  const ticketId = db.transaction(() => {
    const id = db.prepare(`INSERT INTO tickets (opportunity_title, ticket_type, event_id, created_by)
      VALUES (?, 'work', ?, ?)`).run(title, e?.id ?? null, user.id).lastInsertRowid;
    db.prepare('INSERT INTO ticket_comments (ticket_id, kind, body, author_id) VALUES (?, ?, ?, ?)').run(id, 'comment', body, q.requested_by);
    db.prepare("UPDATE event_support_requests SET status = 'accepted', ticket_id = ?, accepted_by = ?, accepted_at = datetime('now') WHERE id = ?")
      .run(id, user.id, q.id);
    // The other Marketing alerts for this request are now handled.
    db.prepare("UPDATE alerts SET read_at = COALESCE(read_at, datetime('now')) WHERE request_id = ? AND kind = 'support_request'").run(q.id);
    if (q.requested_by && q.requested_by !== user.id) {
      alertInsert().run(q.requested_by, user.id, 'support_accepted', id, e?.id ?? null, q.id, (q.title ? `${q.title}\n${q.details}` : q.details).slice(0, 400));
    }
    return id;
  })();
  recordWork(user, { kind: 'ticket', ticket_id: ticketId, summary: title });
  return { ticket_id: ticketId, event_id: e?.id ?? null };
}

/**
 * Requests matching `where` (SQL on r, the request), open ones first, then newest first: each with what it's tied to (event,
 * ticket, activity), the opportunities and meetings it names, and the marketing dollars recorded against it.
 */
export function requestList(where = '1', args = []) {
  const rows = db.prepare(`SELECT r.*, q.first_name AS req_first, q.last_name AS req_last, k.first_name AS acc_first, k.last_name AS acc_last,
      t.opportunity_title AS ticket_title, e.name AS event_name, e.date_from AS event_date,
      f.opportunity_title AS for_title, f.ticket_type AS for_type, f.deal_status AS for_status, a.text AS activity_subject,
      (SELECT COALESCE(SUM(amount), 0) FROM marketing_spend m WHERE m.request_id = r.id) AS spent
    FROM event_support_requests r LEFT JOIN users q ON q.id = r.requested_by LEFT JOIN users k ON k.id = r.accepted_by
    LEFT JOIN tickets t ON t.id = r.ticket_id LEFT JOIN events e ON e.id = r.event_id
    LEFT JOIN tickets f ON f.id = r.for_ticket_id LEFT JOIN ticket_tasks a ON a.id = r.activity_id
    WHERE ${where} ORDER BY (r.status = 'accepted'), r.created_at DESC, r.id DESC LIMIT 500`).all(...args);
  const tickets = db.prepare(`SELECT x.request_id, t.id, t.opportunity_title AS title, t.organization, t.deal_status, t.value
    FROM marketing_request_tickets x JOIN tickets t ON t.id = x.ticket_id ORDER BY t.opportunity_title`).all();
  // A request for an event carries the event's whole meeting schedule, as it stands now: a meeting added to, changed on
  // or taken off the event is added, changed or gone here too. Meetings from elsewhere are the ones the request names.
  const meetings = db.prepare(`SELECT r.id AS request_id, m.id, m.title, m.meeting_date, m.meeting_time, m.place,
      (m.event_id IS NOT NULL AND m.event_id IS r.event_id) AS from_event
    FROM event_support_requests r JOIN meetings m ON (m.event_id IS NOT NULL AND m.event_id = r.event_id)
      OR m.id IN (SELECT meeting_id FROM marketing_request_meetings x WHERE x.request_id = r.id)
    ORDER BY m.meeting_date, COALESCE(m.meeting_time, '99'), m.id`).all();
  return rows.map((x) => ({
    id: x.id, title: x.title, category: x.category, due_date: x.due_date, details: x.details, justification: x.justification, purpose: x.purpose,
    status: x.status, created_at: x.created_at, accepted_at: x.accepted_at, ticket_id: x.ticket_id, ticket_title: x.ticket_title,
    event_id: x.event_id, event_name: x.event_name, event_date: x.event_date,
    for_ticket: x.for_title ? { id: x.for_ticket_id, title: x.for_title, ticket_type: x.for_type, deal_status: x.for_status } : null,
    activity: x.activity_subject ? { id: x.activity_id, subject: x.activity_subject } : null,
    tickets: tickets.filter((t) => t.request_id === x.id).map(({ request_id, ...t }) => t),
    meetings: meetings.filter((m) => m.request_id === x.id).map(({ request_id, from_event, ...m }) => ({ ...m, from_event: !!from_event })),
    spent: x.spent,
    requested_by: x.req_first ? { id: x.requested_by, ...userOut(x, 'req') } : null,
    accepted_by: x.acc_first ? { id: x.accepted_by, ...userOut(x, 'acc') } : null,
  }));
}

/** Who gets alerted for a request, whether the signed-in user is on Marketing, and the choices for each form. */
r.get('/meta', (req, res) => res.json({
  team: marketingTeam(), canManage: isMarketing(req.user),
  assetKinds: ASSET_KINDS, copyCategories: COPY_CATEGORIES, requestCategories: REQUEST_CATEGORIES, spendCategories: SPEND_CATEGORIES,
}));

/** Every support request, from anywhere: open ones first, then newest first. */
r.get('/requests', (req, res) => res.json({ requests: requestList() }));

/**
 * Ask Marketing for support. Body: { title, category, due_date, details, justification, purpose, event_id, for_ticket_id,
 * activity_id, ticket_ids, meeting_ids }. A request has to be for an event or a ticket (or both), say what's needed and
 * why, and name at least one opportunity or meeting; a pipeline ticket it's for counts as one, and so do the meetings
 * on its event's schedule, which come with the request on their own.
 */
r.post('/requests', (req, res) => {
  const b = req.body || {};
  const title = s(b.title);
  const details = s(b.details);
  const justification = s(b.justification);
  const event = Number(b.event_id) ? db.prepare('SELECT id, goal FROM events WHERE id = ?').get(Number(b.event_id)) : null;
  const ticket = Number(b.for_ticket_id) ? db.prepare("SELECT id, ticket_type FROM tickets WHERE id = ? AND ticket_type != 'account'").get(Number(b.for_ticket_id)) : null;
  const activity = ticket && Number(b.activity_id) ? db.prepare('SELECT id FROM ticket_tasks WHERE id = ? AND ticket_id = ?').get(Number(b.activity_id), ticket.id) : null;
  const ticketIds = ids(b.ticket_ids).filter((id) => db.prepare("SELECT 1 FROM tickets WHERE id = ? AND ticket_type = 'bid'").get(id));
  if (ticket?.ticket_type === 'bid' && !ticketIds.includes(ticket.id)) ticketIds.push(ticket.id);
  const meetingIds = ids(b.meeting_ids).filter((id) => db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(id));
  if (!title) return res.status(400).json({ error: 'Give the request a short title' });
  if (!event && !ticket) return res.status(400).json({ error: 'Say what this is for: an event, a pipeline ticket or a work ticket' });
  if (!details) return res.status(400).json({ error: 'Describe what you need from Marketing' });
  if (!justification) return res.status(400).json({ error: 'Add the justification: why this is worth doing' });
  const onSchedule = event && db.prepare('SELECT 1 FROM meetings WHERE event_id = ?').get(event.id); // the event's meetings come with it
  if (!ticketIds.length && !meetingIds.length && !onSchedule) return res.status(400).json({ error: 'Name at least one lead, opportunity or meeting this is for' });
  res.json(createRequest(req.user, {
    title, details, justification, purpose: s(b.purpose) || event?.goal || null,
    category: REQUEST_CATEGORIES.includes(b.category) ? b.category : null, due_date: DATE.test(s(b.due_date)) ? s(b.due_date) : null,
    event_id: event?.id ?? null, for_ticket_id: ticket?.id ?? null, activity_id: activity?.id ?? null, ticket_ids: ticketIds, meeting_ids: meetingIds,
  }));
});

r.post('/requests/:id/accept', (req, res) => {
  const out = acceptRequest(req.user, req.params.id, req.body?.title);
  if (out.error) return res.status(out.status).json({ error: out.error, ticket_id: out.ticket_id });
  res.json(out);
});

/** The requester can withdraw a request Marketing hasn't taken yet; so can Marketing. */
r.delete('/requests/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM event_support_requests WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Request not found' });
  if (q.status === 'accepted') return res.status(409).json({ error: 'This request already has a work ticket' });
  if (q.requested_by !== req.user.id && !isMarketing(req.user)) return res.status(403).json({ error: 'Only the requester or Marketing can withdraw this' });
  db.prepare('DELETE FROM event_support_requests WHERE id = ?').run(q.id);
  res.json({ ok: true });
});

/** Marketing on one ticket: the requests for it or naming it, the dollars tied to it, and the events it's tied to. */
r.get('/ticket/:id', (req, res) => {
  const id = Number(req.params.id);
  const requests = requestList('r.for_ticket_id = ? OR r.id IN (SELECT request_id FROM marketing_request_tickets WHERE ticket_id = ?)', [id, id]);
  const spend = spendEntries().filter((x) => x.ticket_id === id);
  const events = db.prepare(`SELECT e.id, e.name, e.date_from, e.date_to, x.sourced FROM ticket_events x JOIN events e ON e.id = x.event_id
    WHERE x.ticket_id = ? ORDER BY e.date_from`).all(id).map((e) => ({ ...e, sourced: !!e.sourced }));
  res.json({ requests, spend, spent: spend.reduce((t, x) => t + x.amount, 0), events, canManage: isMarketing(req.user) });
});

// ---- Leads: what Marketing feeds the team. Marketing (or an admin) writes a lead; anyone claims it by putting their name
// on it; whoever claimed it (or Marketing) turns it into a pipeline ticket, sourced by Marketing and by its event, if any.

function leadList() {
  return db.prepare(`SELECT l.*, c.first_name AS by_first, c.last_name AS by_last, k.first_name AS claim_first, k.last_name AS claim_last,
      e.name AS event_name, t.opportunity_title AS ticket_title, t.deal_status AS ticket_status
    FROM marketing_leads l LEFT JOIN users c ON c.id = l.created_by LEFT JOIN users k ON k.id = l.claimed_by
    LEFT JOIN events e ON e.id = l.event_id LEFT JOIN tickets t ON t.id = l.ticket_id
    ORDER BY (l.ticket_id IS NOT NULL OR l.closed_at IS NOT NULL), (l.claimed_by IS NOT NULL), l.created_at DESC, l.id DESC`).all()
    .map(({ by_first, by_last, claim_first, claim_last, ...l }) => ({
      ...l,
      created_by_user: by_first ? { id: l.created_by, first_name: by_first, last_name: by_last } : null,
      claimed_by_user: claim_first ? { id: l.claimed_by, first_name: claim_first, last_name: claim_last } : null,
    }));
}
const leadRow = (id) => db.prepare('SELECT * FROM marketing_leads WHERE id = ?').get(id);

function leadFields(b = {}) {
  const value = Number(String(b.value ?? '').replace(/[$,]/g, ''));
  const f = {
    title: s(b.title).slice(0, 200), organization: s(b.organization) || null, contact: s(b.contact) || null, details: s(b.details) || null,
    value: value > 0 ? value : null, event_id: idOr(b.event_id, 'events'),
  };
  return f.title ? { f } : { error: 'Give the lead a title' };
}

r.get('/leads', (req, res) => res.json({ leads: leadList(), canManage: isMarketing(req.user), pipelineTicketsClosed: pipelineTicketsClosed() }));

r.post('/leads', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can add leads' });
  const { f, error } = leadFields(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(`INSERT INTO marketing_leads (title, organization, contact, details, value, event_id, created_by)
    VALUES (@title, @organization, @contact, @details, @value, @event_id, @by)`).run({ ...f, by: req.user.id });
  res.json({ leads: leadList() });
});

r.put('/leads/:id', (req, res) => {
  const l = leadRow(req.params.id);
  if (!l) return res.status(404).json({ error: 'Lead not found' });
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change a lead' });
  const { f, error } = leadFields(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare(`UPDATE marketing_leads SET title = @title, organization = @organization, contact = @contact, details = @details, value = @value, event_id = @event_id,
    closed_at = CASE WHEN @closed THEN COALESCE(closed_at, datetime('now')) END WHERE id = @id`).run({ ...f, closed: req.body?.closed ? 1 : 0, id: l.id });
  res.json({ leads: leadList() });
});

r.delete('/leads/:id', (req, res) => {
  const l = leadRow(req.params.id);
  if (!l) return res.status(404).json({ error: 'Lead not found' });
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can delete a lead' });
  if (l.ticket_id) return res.status(409).json({ error: 'This lead is a pipeline ticket now' });
  db.prepare('DELETE FROM marketing_leads WHERE id = ?').run(l.id);
  res.json({ leads: leadList() });
});

/** Claim a lead (put your name on it), or with { claim: false } let it go. Marketing can release anyone's claim. */
r.put('/leads/:id/claim', (req, res) => {
  const l = leadRow(req.params.id);
  if (!l) return res.status(404).json({ error: 'Lead not found' });
  if (l.ticket_id) return res.status(409).json({ error: 'This lead is a pipeline ticket now' });
  if (req.body?.claim === false) {
    if (l.claimed_by !== req.user.id && !isMarketing(req.user)) return res.status(403).json({ error: 'Only whoever claimed it, or Marketing, can release this lead' });
    db.prepare('UPDATE marketing_leads SET claimed_by = NULL, claimed_at = NULL WHERE id = ?').run(l.id);
  } else {
    if (l.claimed_by && l.claimed_by !== req.user.id) return res.status(409).json({ error: 'Someone has already claimed this lead' });
    db.prepare("UPDATE marketing_leads SET claimed_by = ?, claimed_at = datetime('now'), closed_at = NULL WHERE id = ?").run(req.user.id, l.id);
  }
  res.json({ leads: leadList() });
});

/**
 * Turn a claimed lead into a pipeline ticket owned by whoever claimed it; or, with { ticket_id }, tie it to a pipeline
 * ticket that already exists (say, the deal was made in Pipedrive). Either way the ticket is sourced by Marketing, and by
 * the lead's event.
 */
r.post('/leads/:id/ticket', (req, res) => {
  const l = leadRow(req.params.id);
  if (!l) return res.status(404).json({ error: 'Lead not found' });
  if (l.ticket_id) return res.status(409).json({ error: 'This lead already has a pipeline ticket', ticket_id: l.ticket_id });
  if (!l.claimed_by) return res.status(400).json({ error: 'Claim the lead first' });
  if (l.claimed_by !== req.user.id && !isMarketing(req.user)) return res.status(403).json({ error: 'Only whoever claimed it, or Marketing, can make the pipeline ticket' });
  const existing = req.body?.ticket_id ? db.prepare("SELECT id FROM tickets WHERE id = ? AND ticket_type = 'bid'").get(Number(req.body.ticket_id)) : null;
  if (req.body?.ticket_id && !existing) return res.status(400).json({ error: 'Choose a pipeline ticket' });
  const out = db.transaction(() => {
    const made = existing || createPipelineTicket(req.user, { title: l.title, organization: l.organization, value: l.value, directorId: l.claimed_by });
    if (made.error) return made;
    addTicketTags(made.id, [LEAD_TAGS.marketing, l.event_id && LEAD_TAGS.event]);
    if (l.event_id) linkTicketEvent(made.id, l.event_id, { sourced: true, userId: req.user.id });
    const note = ['Lead from Marketing.', existing && `Lead: ${l.title}`, l.contact && `Contact: ${l.contact}`, l.details].filter(Boolean).join('\n');
    db.prepare('INSERT INTO ticket_comments (ticket_id, kind, body, author_id) VALUES (?, ?, ?, ?)').run(made.id, 'comment', note, l.created_by || req.user.id);
    db.prepare('UPDATE marketing_leads SET ticket_id = ? WHERE id = ?').run(made.id, l.id);
    return made;
  })();
  if (out.error) return res.status(out.status).json({ error: out.error });
  res.json({ ticket_id: out.id, leads: leadList() });
});

// ---- Tracking: marketing asks to marketing dollars to opportunities, and how those opportunities turn out.

r.get('/impact', (req, res) => res.json({ ...marketingImpact(requestList()), canManage: isMarketing(req.user) }));

// ---- Library: logos, images, files

const ASSET_SQL = `SELECT a.*, u.first_name AS up_first, u.last_name AS up_last FROM marketing_assets a LEFT JOIN users u ON u.id = a.uploaded_by`;
const assetOut = (a) => ({
  id: a.id, kind: a.kind, title: a.title, description: a.description, name: a.original_name, mime_type: a.mime_type, size: a.size,
  created_at: a.created_at, updated_at: a.updated_at, uploaded_by: userOut(a, 'up'),
  previewable: /^image\//.test(a.mime_type || ''),
});
const oneAsset = (id) => { const a = db.prepare(`${ASSET_SQL} WHERE a.id = ?`).get(id); return a && assetOut(a); };

function assetFields(b = {}, file) {
  const kind = ASSET_KINDS.some((k) => k.key === b.kind) ? b.kind : null;
  if (!kind) return { error: 'Choose Logo, Image, or File' };
  const title = s(b.title) || (file ? path.parse(file.originalname).name : '');
  if (!title) return { error: 'Give it a name' };
  return { f: { kind, title, description: s(b.description) || null } };
}

r.get('/assets', (req, res) => {
  res.json({ assets: db.prepare(`${ASSET_SQL} ORDER BY a.kind, lower(a.title)`).all().map(assetOut) });
});

/** Multipart: file, kind, title, description. Marketing only. */
r.post('/assets', upload.single('file'), (req, res) => {
  if (!isMarketing(req.user)) { discard(req.file); return res.status(403).json({ error: 'Only the Marketing team can add to the library' }); }
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  const { f, error } = assetFields(req.body, req.file);
  if (error) { discard(req.file); return res.status(400).json({ error }); }
  const id = db.prepare(`INSERT INTO marketing_assets (kind, title, description, original_name, stored_name, mime_type, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(f.kind, f.title, f.description, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id).lastInsertRowid;
  res.json({ asset: oneAsset(id) });
});

/** Rename or recategorize, and optionally replace the file. */
r.put('/assets/:id', upload.single('file'), (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_assets WHERE id = ?').get(req.params.id);
  if (!a) { discard(req.file); return res.status(404).json({ error: 'Not found' }); }
  if (!isMarketing(req.user)) { discard(req.file); return res.status(403).json({ error: 'Only the Marketing team can change the library' }); }
  const { f, error } = assetFields({ title: a.title, ...req.body, kind: req.body?.kind || a.kind });
  if (error) { discard(req.file); return res.status(400).json({ error }); }
  db.prepare(`UPDATE marketing_assets SET kind = ?, title = ?, description = ?, updated_at = datetime('now') WHERE id = ?`).run(f.kind, f.title, f.description, a.id);
  if (req.file) {
    db.prepare('UPDATE marketing_assets SET original_name = ?, stored_name = ?, mime_type = ?, size = ?, uploaded_by = ? WHERE id = ?')
      .run(req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id, a.id);
    fs.rmSync(path.join(uploadDir, a.stored_name), { force: true });
  }
  res.json({ asset: oneAsset(a.id) });
});

r.delete('/assets/:id', (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_assets WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change the library' });
  db.prepare('DELETE FROM marketing_assets WHERE id = ?').run(a.id);
  fs.rmSync(path.join(uploadDir, a.stored_name), { force: true });
  res.json({ ok: true });
});

r.get('/assets/:id/download', (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_assets WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, a.stored_name), a.original_name);
});

/** Inline image for previews. Locked down so an uploaded SVG can't run script on our origin. */
r.get('/assets/:id/view', (req, res) => {
  const a = db.prepare('SELECT * FROM marketing_assets WHERE id = ?').get(req.params.id);
  if (!a || !/^image\//.test(a.mime_type || '')) return res.status(404).json({ error: 'Not found' });
  res.set({ 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' });
  res.type(a.mime_type).sendFile(path.join(uploadDir, a.stored_name));
});

// ---- Text copy

const COPY_SQL = `SELECT c.*, u.first_name AS by_first, u.last_name AS by_last FROM marketing_copy c
  LEFT JOIN users u ON u.id = COALESCE(c.updated_by, c.created_by)`;
const copyOut = (c) => ({
  id: c.id, title: c.title, category: c.category, body: c.body, created_at: c.created_at, updated_at: c.updated_at, updated_by: userOut(c, 'by'),
});
const oneCopy = (id) => { const c = db.prepare(`${COPY_SQL} WHERE c.id = ?`).get(id); return c && copyOut(c); };

function copyFields(b = {}) {
  const f = { title: s(b.title), category: COPY_CATEGORIES.includes(b.category) ? b.category : null, body: String(b.body ?? '').trim() };
  if (!f.title) return { error: 'Give the copy a title' };
  if (!f.body) return { error: 'Add the copy text' };
  return { f };
}

r.get('/copy', (req, res) => {
  res.json({ copy: db.prepare(`${COPY_SQL} ORDER BY lower(c.title)`).all().map(copyOut) });
});

r.post('/copy', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can add copy' });
  const { f, error } = copyFields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare('INSERT INTO marketing_copy (title, category, body, created_by) VALUES (?, ?, ?, ?)').run(f.title, f.category, f.body, req.user.id).lastInsertRowid;
  res.json({ copy: oneCopy(id) });
});

r.put('/copy/:id', (req, res) => {
  if (!db.prepare('SELECT 1 FROM marketing_copy WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: 'Not found' });
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change copy' });
  const { f, error } = copyFields(req.body);
  if (error) return res.status(400).json({ error });
  db.prepare("UPDATE marketing_copy SET title = ?, category = ?, body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(f.title, f.category, f.body, req.user.id, req.params.id);
  res.json({ copy: oneCopy(req.params.id) });
});

r.delete('/copy/:id', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change copy' });
  db.prepare('DELETE FROM marketing_copy WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Spend: what Marketing spent, on what and for whom. Everyone can see it; the Marketing team (and admins) keep it.


function spendFields(b = {}) {
  const amount = Number(String(b.amount ?? '').replace(/[$,]/g, ''));
  if (!DATE.test(b.spent_on || '')) return { error: 'Choose the date it was spent' };
  if (!(amount > 0)) return { error: 'Enter the amount spent' };
  if (!s(b.description)) return { error: 'Say what it was for' };
  return {
    f: {
      spent_on: b.spent_on, amount: Math.round(amount * 100) / 100, description: s(b.description).slice(0, 300),
      category: SPEND_CATEGORIES.includes(b.category) ? b.category : null, vendor: s(b.vendor) || null,
      event_id: idOr(b.event_id, 'events'), ticket_id: idOr(b.ticket_id, 'tickets'), user_id: idOr(b.user_id, 'users'),
      territory_id: idOr(b.territory_id, 'territories'), organization: s(b.organization) || null, note: s(b.note) || null,
      request_id: idOr(b.request_id, 'event_support_requests'),
    },
  };
}
const oneSpend = (id) => spendEntries().find((x) => x.id === Number(id));

/** Entries between ?from and ?to (dates; default all), newest first, and what they add up to by account, territory, etc. */
r.get('/spend', (req, res) => {
  const range = { from: DATE.test(req.query.from || '') ? req.query.from : null, to: DATE.test(req.query.to || '') ? req.query.to : null };
  const entries = spendEntries(range);
  res.json({ entries, summary: spendBreakdown(entries), categories: SPEND_CATEGORIES, canManage: isMarketing(req.user) });
});

r.post('/spend', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can record spend' });
  const { f, error } = spendFields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare(`INSERT INTO marketing_spend (spent_on, amount, description, category, vendor, event_id, ticket_id, user_id, territory_id, organization, note, request_id, created_by)
    VALUES (@spent_on, @amount, @description, @category, @vendor, @event_id, @ticket_id, @user_id, @territory_id, @organization, @note, @request_id, @by)`)
    .run({ ...f, by: req.user.id }).lastInsertRowid;
  res.json({ entry: oneSpend(id) });
});

r.put('/spend/:id', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change spend' });
  const { f, error } = spendFields(req.body);
  if (error) return res.status(400).json({ error });
  const info = db.prepare(`UPDATE marketing_spend SET spent_on=@spent_on, amount=@amount, description=@description, category=@category, vendor=@vendor,
    event_id=@event_id, ticket_id=@ticket_id, user_id=@user_id, territory_id=@territory_id, organization=@organization, note=@note, request_id=@request_id, updated_at=datetime('now')
    WHERE id=@id`).run({ ...f, id: Number(req.params.id) });
  if (!info.changes) return res.status(404).json({ error: 'Entry not found' });
  res.json({ entry: oneSpend(req.params.id) });
});

r.delete('/spend/:id', (req, res) => {
  if (!isMarketing(req.user)) return res.status(403).json({ error: 'Only the Marketing team can change spend' });
  db.prepare('DELETE FROM marketing_spend WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default r;
