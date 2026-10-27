// Master tickets: the list of a user's tickets, each ticket's full timeline,
// question/comment threads, and document uploads.
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, json } from '../db.js';

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

const KINDS = ['question', 'comment'];
const author = (row, prefix = '') => (row[`${prefix}first_name`]
  ? { id: row[`${prefix}author_id`] ?? row.author_id, first_name: row[`${prefix}first_name`], last_name: row[`${prefix}last_name`] }
  : null);

const COMMENT_SQL = `SELECT m.*, u.first_name, u.last_name, c.title AS card_title, tk.opportunity_title AS ticket_title,
    (SELECT COUNT(*) FROM ticket_comments x WHERE x.parent_id = m.id) AS reply_count,
    (SELECT MAX(x.created_at) FROM ticket_comments x WHERE x.parent_id = m.id) AS last_reply_at
  FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id LEFT JOIN priority_cards c ON c.id = m.card_id
  JOIN tickets tk ON tk.id = m.ticket_id`;

const commentOut = (m) => ({
  id: m.id, ticket_id: m.ticket_id, ticket_title: m.ticket_title, card_id: m.card_id, card_title: m.card_title, parent_id: m.parent_id,
  kind: m.kind, body: m.body, created_at: m.created_at, author: author(m),
  reply_count: m.reply_count ?? 0, last_reply_at: m.last_reply_at ?? null,
});

/** Top-level questions and comments on the given master tickets, newest first. */
export function loadThreads(ticketIds) {
  if (!ticketIds.length) return [];
  return db.prepare(`${COMMENT_SQL} WHERE m.parent_id IS NULL AND m.ticket_id IN (${ticketIds.map(() => '?').join(',')})
    ORDER BY m.created_at DESC, m.id DESC`).all(...ticketIds).map(commentOut);
}

const ticketRow = (id) => db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);

// ---- A user's master tickets

r.get('/', (req, res) => {
  const all = req.query.scope === 'all';
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM priority_cards c WHERE c.ticket_id = t.id) AS card_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'question') AS question_count,
      (SELECT COUNT(*) FROM ticket_comments m WHERE m.ticket_id = t.id AND m.parent_id IS NULL AND m.kind = 'comment') AS comment_count,
      (SELECT COUNT(*) FROM ticket_files f WHERE f.ticket_id = t.id) AS file_count,
      MAX(t.updated_at,
        COALESCE((SELECT MAX(c.updated_at) FROM priority_cards c WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(m.created_at) FROM ticket_comments m WHERE m.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(n.created_at) FROM card_notes n JOIN priority_cards c ON c.id = n.card_id WHERE c.ticket_id = t.id), ''),
        COALESCE((SELECT MAX(f.created_at) FROM ticket_files f WHERE f.ticket_id = t.id), '')) AS last_activity
    FROM tickets t
    WHERE (t.opportunity_title LIKE @q OR t.organization LIKE @q)
      AND (@all = 1 OR t.created_by = @me OR EXISTS (SELECT 1 FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
        WHERE c.ticket_id = t.id AND a.user_id = @me))
    ORDER BY last_activity DESC`).all({ q, all: all ? 1 : 0, me: req.user.id });
  // Task counts come from each card's checklist JSON.
  const lists = db.prepare('SELECT ticket_id, checklist FROM priority_cards').all();
  const tasks = {};
  lists.forEach((c) => json.parse(c.checklist, []).forEach((i) => {
    const t = (tasks[c.ticket_id] ||= { open: 0, done: 0 });
    t[i.done ? 'done' : 'open'] += 1;
  }));
  res.json({ tickets: rows.map((t) => ({ ...t, tasks: tasks[t.id] || { open: 0, done: 0 } })) });
});

// ---- Full timeline of a master ticket, newest first

r.get('/:id/timeline', (req, res) => {
  const t = db.prepare(`SELECT t.*, u.first_name, u.last_name FROM tickets t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = ?`).get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const ticket = { id: t.id, opportunity_title: t.opportunity_title, organization: t.organization, pipeline_status: t.pipeline_status, value: t.value, created_at: t.created_at };
  const events = [{ type: 'ticket', at: t.created_at, author: t.first_name ? { id: t.created_by, first_name: t.first_name, last_name: t.last_name } : null }];

  const cards = db.prepare(`SELECT c.*, tm.name AS team_name, u.first_name, u.last_name FROM priority_cards c
    LEFT JOIN teams tm ON tm.id = c.team_id LEFT JOIN users u ON u.id = c.created_by WHERE c.ticket_id = ?`).all(t.id);
  const assignees = db.prepare(`SELECT a.card_id, u.id, u.first_name, u.last_name FROM card_assignees a
    JOIN users u ON u.id = a.user_id JOIN priority_cards c ON c.id = a.card_id WHERE c.ticket_id = ?`).all(t.id);
  cards.forEach((c) => events.push({
    type: 'card', at: c.created_at, author: c.first_name ? { id: c.created_by, first_name: c.first_name, last_name: c.last_name } : null,
    card: {
      id: c.id, title: c.title, week_start: c.week_start, team_name: c.team_name, due_date: c.due_date,
      is_planned: !!c.is_planned, completed: !!c.completed, checklist: json.parse(c.checklist, []),
      assignees: assignees.filter((a) => a.card_id === c.id).map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    },
  }));

  db.prepare(`SELECT n.*, c.title AS card_title, u.first_name, u.last_name FROM card_notes n
    JOIN priority_cards c ON c.id = n.card_id LEFT JOIN users u ON u.id = n.author_id WHERE c.ticket_id = ?`).all(t.id)
    .forEach((n) => events.push({ type: 'note', at: n.created_at, author: author(n), note: { id: n.id, body: n.body, updated_at: n.updated_at, card_id: n.card_id, card_title: n.card_title } }));

  const comments = db.prepare(`${COMMENT_SQL} WHERE m.ticket_id = ? ORDER BY m.created_at, m.id`).all(t.id).map(commentOut);
  comments.filter((m) => !m.parent_id).forEach((m) => events.push({
    type: 'comment', at: m.created_at, author: m.author, comment: { ...m, replies: comments.filter((x) => x.parent_id === m.id) },
  }));

  db.prepare(`SELECT f.*, u.first_name, u.last_name FROM ticket_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.ticket_id = ?`).all(t.id)
    .forEach((f) => events.push({
      type: 'file', at: f.created_at, author: f.first_name ? { id: f.uploaded_by, first_name: f.first_name, last_name: f.last_name } : null,
      file: { id: f.id, name: f.original_name, size: f.size, mime_type: f.mime_type },
    }));

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  res.json({ ticket, events });
});

// ---- Questions, comments and replies

r.post('/:id/comments', (req, res) => {
  const t = ticketRow(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket not found' });
  const b = req.body || {};
  const body = String(b.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Write something first' });
  let parentId = null;
  let cardId = Number(b.card_id) || null;
  let kind = KINDS.includes(b.kind) ? b.kind : 'comment';
  if (b.parent_id) {
    const parent = db.prepare('SELECT * FROM ticket_comments WHERE id = ? AND ticket_id = ?').get(b.parent_id, t.id);
    if (!parent) return res.status(400).json({ error: 'That thread no longer exists' });
    parentId = parent.parent_id || parent.id; // replies stay one level deep
    cardId = parent.card_id;
    kind = 'reply';
  } else if (cardId && !db.prepare('SELECT 1 FROM priority_cards WHERE id = ? AND ticket_id = ?').get(cardId, t.id)) {
    return res.status(400).json({ error: 'That priority is not on this ticket' });
  }
  const id = db.prepare('INSERT INTO ticket_comments (ticket_id, card_id, parent_id, kind, body, author_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.id, cardId, parentId, kind, body, req.user.id).lastInsertRowid;
  res.json({ comment: commentOut(db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(id)) });
});

/** One thread with its master ticket, priority card and replies. */
r.get('/comments/:id', (req, res) => {
  const m = db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const root = m.parent_id ? db.prepare(`${COMMENT_SQL} WHERE m.id = ?`).get(m.parent_id) : m;
  const card = root.card_id ? db.prepare('SELECT id, title, week_start, due_date, completed FROM priority_cards WHERE id = ?').get(root.card_id) : null;
  res.json({
    ticket: ticketRow(root.ticket_id),
    card,
    comment: commentOut(root),
    replies: db.prepare(`${COMMENT_SQL} WHERE m.parent_id = ? ORDER BY m.created_at, m.id`).all(root.id).map(commentOut),
  });
});

r.delete('/comments/:id', (req, res) => {
  const m = db.prepare('SELECT * FROM ticket_comments WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the author can delete this' });
  db.prepare('DELETE FROM ticket_comments WHERE id = ?').run(m.id);
  res.json({ ok: true });
});

// ---- Documents

r.post('/:id/files', upload.single('file'), (req, res) => {
  const t = ticketRow(req.params.id);
  if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
  if (!t) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(404).json({ error: 'Ticket not found' });
  }
  const id = db.prepare(`INSERT INTO ticket_files (ticket_id, original_name, stored_name, mime_type, size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(t.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.user.id).lastInsertRowid;
  res.json({ file: { id, name: req.file.originalname, size: req.file.size, mime_type: req.file.mimetype } });
});

r.get('/files/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM ticket_files WHERE id = ?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, f.stored_name), f.original_name);
});

export default r;
