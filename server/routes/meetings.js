// Meetings: who we're meeting, when and where, like a scheduler. Usually set up for an event; a meeting can also be
// about a pipeline ticket. Everyone met is a CRM contact: people typed in new are added to the CRM as the meeting is saved.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db.js';
import { organizationFor } from './contacts.js';

const r = Router();

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const s = (v) => (v == null ? '' : String(v).trim());
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(Boolean))];

/** Meetings matching `where` (SQL on m), soonest first, with the people in them. */
export function meetingList(where = '1', args = []) {
  const rows = db.prepare(`SELECT m.*, e.name AS event_name, t.opportunity_title AS ticket_title, u.first_name AS by_first, u.last_name AS by_last
    FROM meetings m LEFT JOIN events e ON e.id = m.event_id LEFT JOIN tickets t ON t.id = m.ticket_id LEFT JOIN users u ON u.id = m.created_by
    WHERE ${where} ORDER BY m.meeting_date, COALESCE(m.meeting_time, '99'), m.id`).all(...args);
  const people = db.prepare(`SELECT p.meeting_id, c.id, c.first_name, c.last_name, c.organization, c.role FROM meeting_people p
    JOIN contacts c ON c.id = p.contact_id ORDER BY COALESCE(c.last_name, c.first_name) COLLATE NOCASE`).all();
  const users = db.prepare(`SELECT x.meeting_id, u.id, u.first_name, u.last_name FROM meeting_users x JOIN users u ON u.id = x.user_id
    ORDER BY u.last_name, u.first_name`).all();
  const files = db.prepare('SELECT id, meeting_id, original_name AS name, size, mime_type, uploaded_by, created_at FROM meeting_files ORDER BY id').all();
  return rows.map(({ by_first, by_last, ...m }) => ({
    ...m,
    files: files.filter((f) => f.meeting_id === m.id).map(({ meeting_id, ...f }) => f),
    created_by_user: by_first ? { id: m.created_by, first_name: by_first, last_name: by_last } : null,
    people: people.filter((p) => p.meeting_id === m.id).map(({ meeting_id, ...p }) => p),
    users: users.filter((u) => u.meeting_id === m.id).map(({ meeting_id, ...u }) => u),
  }));
}
const one = (id) => meetingList('m.id = ?', [id])[0] || null;

/**
 * The CRM contact for someone typed into a meeting: the one already there (same email, or same name and organization),
 * else a new contact.
 */
function contactFor(p, userId) {
  const first = s(p.first_name);
  if (!first) return null;
  const last = s(p.last_name) || null;
  const organization = s(p.organization) || null;
  const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s(p.email)) ? s(p.email) : null;
  const found = (email && db.prepare('SELECT id FROM contacts WHERE email = ? COLLATE NOCASE').get(email))
    || db.prepare(`SELECT id FROM contacts WHERE first_name = ? COLLATE NOCASE AND COALESCE(last_name, '') = ? COLLATE NOCASE
      AND (? IS NULL OR organization IS NULL OR organization = ? COLLATE NOCASE)`).get(first, last || '', organization, organization);
  if (found) return found.id;
  return db.prepare(`INSERT INTO contacts (first_name, last_name, organization, organization_id, role, email, phone, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(first, last, organization, organizationFor(organization), s(p.role) || null, email, s(p.phone) || null, userId).lastInsertRowid;
}

function fields(b = {}) {
  const f = {
    title: s(b.title).slice(0, 200), meeting_date: s(b.meeting_date), meeting_time: /^\d{2}:\d{2}$/.test(s(b.meeting_time)) ? s(b.meeting_time) : null,
    place: s(b.place) || null, notes: s(b.notes) || null, objectives: s(b.objectives) || null,
    event_id: Number(b.event_id) && db.prepare('SELECT 1 FROM events WHERE id = ?').get(Number(b.event_id)) ? Number(b.event_id) : null,
    ticket_id: Number(b.ticket_id) && db.prepare("SELECT 1 FROM tickets WHERE id = ? AND ticket_type != 'account'").get(Number(b.ticket_id)) ? Number(b.ticket_id) : null,
  };
  if (!f.title) return { error: 'Say what the meeting is' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.meeting_date)) return { error: 'Choose the meeting’s date' };
  const known = ids(b.contact_ids).filter((id) => db.prepare('SELECT 1 FROM contacts WHERE id = ?').get(id));
  const fresh = (Array.isArray(b.new_people) ? b.new_people : []).filter((p) => s(p?.first_name));
  if (!known.length && !fresh.length) return { error: 'Add who the meeting is with' };
  return { f, known, fresh, users: ids(b.user_ids).filter((id) => db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) };
}

function setPeople(meetingId, { known, fresh, users }, userId) {
  const contacts = [...new Set([...known, ...fresh.map((p) => contactFor(p, userId)).filter(Boolean)])];
  db.prepare('DELETE FROM meeting_people WHERE meeting_id = ?').run(meetingId);
  db.prepare('DELETE FROM meeting_users WHERE meeting_id = ?').run(meetingId);
  const person = db.prepare('INSERT OR IGNORE INTO meeting_people (meeting_id, contact_id) VALUES (?, ?)');
  contacts.forEach((c) => person.run(meetingId, c));
  const user = db.prepare('INSERT OR IGNORE INTO meeting_users (meeting_id, user_id) VALUES (?, ?)');
  users.forEach((u) => user.run(meetingId, u));
}

/** ?event=<id> or ?ticket=<id> narrows; otherwise every meeting. */
r.get('/', (req, res) => {
  const event = Number(req.query.event);
  const ticket = Number(req.query.ticket);
  res.json({ meetings: event ? meetingList('m.event_id = ?', [event]) : ticket ? meetingList('m.ticket_id = ?', [ticket]) : meetingList() });
});

/**
 * Body: { title, meeting_date, meeting_time, place, objectives, notes, event_id, ticket_id, contact_ids, user_ids,
 * new_people: [{ first_name, last_name, organization, role, email, phone }] }. New people go into the CRM.
 */
r.post('/', (req, res) => {
  const v = fields(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const id = db.transaction(() => {
    const mid = db.prepare(`INSERT INTO meetings (event_id, ticket_id, title, meeting_date, meeting_time, place, notes, objectives, created_by)
      VALUES (@event_id, @ticket_id, @title, @meeting_date, @meeting_time, @place, @notes, @objectives, @by)`).run({ ...v.f, by: req.user.id }).lastInsertRowid;
    setPeople(mid, v, req.user.id);
    return mid;
  })();
  res.json({ meeting: one(id) });
});

r.put('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  const v = fields({ event_id: m.event_id, ticket_id: m.ticket_id, notes: m.notes, ...req.body });
  if (v.error) return res.status(400).json({ error: v.error });
  db.transaction(() => {
    db.prepare(`UPDATE meetings SET event_id = @event_id, ticket_id = @ticket_id, title = @title, meeting_date = @meeting_date, meeting_time = @meeting_time,
      place = @place, notes = @notes, objectives = @objectives, updated_at = datetime('now') WHERE id = @id`).run({ ...v.f, id: m.id });
    setPeople(m.id, v, req.user.id);
  })();
  res.json({ meeting: one(m.id) });
});

/** Whoever set the meeting up, or an admin, can delete it, with its files. The people stay in the CRM. */
r.delete('/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Meeting not found' });
  if (m.created_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only whoever set up this meeting can delete it' });
  const files = db.prepare('SELECT stored_name FROM meeting_files WHERE meeting_id = ?').all(m.id);
  db.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
  files.forEach((f) => fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }));
  res.json({ ok: true });
});

// ---- Files: agendas, decks and read-aheads for a meeting

/** Multipart: file. */
r.post('/:id/files', upload.single('file'), (req, res) => {
  const discard = () => req.file && fs.rmSync(req.file.path, { force: true });
  if (!db.prepare('SELECT 1 FROM meetings WHERE id = ?').get(req.params.id)) { discard(); return res.status(404).json({ error: 'Meeting not found' }); }
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  db.prepare('INSERT INTO meeting_files (meeting_id, original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id);
  res.json({ meeting: one(req.params.id) });
});

r.get('/files/:fid', (req, res) => {
  const f = db.prepare('SELECT * FROM meeting_files WHERE id = ?').get(req.params.fid);
  if (!f) return res.status(404).json({ error: 'File not found' });
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});

r.delete('/files/:fid', (req, res) => {
  const f = db.prepare('SELECT * FROM meeting_files WHERE id = ?').get(req.params.fid);
  if (!f) return res.status(404).json({ error: 'File not found' });
  db.prepare('DELETE FROM meeting_files WHERE id = ?').run(f.id);
  fs.rmSync(path.join(uploadDir, f.stored_name), { force: true });
  res.json({ meeting: one(f.meeting_id) });
});

export default r;
