// Marketing: the library of logos, images, files, and approved text copy anyone can download or paste,
// and requests for marketing support, which the Marketing team turns into work tickets.
// Requests made from an event live here too (event_support_requests with an event_id).
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { recordWork } from '../worklog.js';
import { ASSET_KINDS, COPY_CATEGORIES, REQUEST_CATEGORIES } from '../../src/lib/marketing.js';

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

/** Save a request and alert everyone on the Marketing team but the requester. Returns { id, notified }. */
export function createRequest(user, { event_id = null, title = null, category = null, due_date = null, details }) {
  const id = db.prepare(`INSERT INTO event_support_requests (event_id, title, category, due_date, details, requested_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(event_id, title, category, due_date, details, user.id).lastInsertRowid;
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
  const title = s(ticketTitle) || (e ? `Marketing support: ${e.name}` : `Marketing: ${q.title || q.details.split('\n')[0].slice(0, 80)}`);
  const header = e ? `Marketing support requested for ${e.name}:` : `Marketing support requested${q.title ? `: ${q.title}` : ':'}`;
  const meta = [q.category, q.due_date && `Needed by ${q.due_date}`].filter(Boolean).join(' · ');

  const ticketId = db.transaction(() => {
    const id = db.prepare(`INSERT INTO tickets (opportunity_title, ticket_type, event_id, created_by)
      VALUES (?, 'work', ?, ?)`).run(title, e?.id ?? null, user.id).lastInsertRowid;
    db.prepare('INSERT INTO ticket_comments (ticket_id, kind, body, author_id) VALUES (?, ?, ?, ?)')
      .run(id, 'comment', [header, meta, q.details].filter(Boolean).join('\n'), q.requested_by);
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

/** Who gets alerted for a request, whether the signed-in user is on Marketing, and the choices for each form. */
r.get('/meta', (req, res) => res.json({
  team: marketingTeam(), canManage: isMarketing(req.user),
  assetKinds: ASSET_KINDS, copyCategories: COPY_CATEGORIES, requestCategories: REQUEST_CATEGORIES,
}));

/** Every support request, from here or from an event: open ones first, then newest first. */
r.get('/requests', (req, res) => {
  const rows = db.prepare(`SELECT r.*, q.first_name AS req_first, q.last_name AS req_last, k.first_name AS acc_first, k.last_name AS acc_last,
      t.opportunity_title AS ticket_title, e.name AS event_name
    FROM event_support_requests r LEFT JOIN users q ON q.id = r.requested_by LEFT JOIN users k ON k.id = r.accepted_by
    LEFT JOIN tickets t ON t.id = r.ticket_id LEFT JOIN events e ON e.id = r.event_id
    ORDER BY (r.status = 'accepted'), r.created_at DESC, r.id DESC LIMIT 300`).all();
  res.json({
    requests: rows.map((x) => ({
      id: x.id, title: x.title, category: x.category, due_date: x.due_date, details: x.details, status: x.status,
      created_at: x.created_at, accepted_at: x.accepted_at, ticket_id: x.ticket_id, ticket_title: x.ticket_title,
      event_id: x.event_id, event_name: x.event_name,
      requested_by: x.req_first ? { id: x.requested_by, ...userOut(x, 'req') } : null,
      accepted_by: x.acc_first ? { id: x.accepted_by, ...userOut(x, 'acc') } : null,
    })),
  });
});

/** Ask Marketing for support. Body: { title, category, due_date, details }. */
r.post('/requests', (req, res) => {
  const b = req.body || {};
  const title = s(b.title);
  const details = s(b.details);
  const category = REQUEST_CATEGORIES.includes(b.category) ? b.category : null;
  const due_date = /^\d{4}-\d{2}-\d{2}$/.test(s(b.due_date)) ? s(b.due_date) : null;
  if (!title) return res.status(400).json({ error: 'Give the request a short title' });
  if (!details) return res.status(400).json({ error: 'Describe the support you need' });
  res.json(createRequest(req.user, { title, category, due_date, details }));
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

export default r;
