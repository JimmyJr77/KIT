// Lessons Learned: a short, sortable record of what's working and what isn't. Each lesson is good (keep it going, or keep
// it but change it) or bad (always a change). Its id is its Lesson Learned number, never reused. Lessons have their own
// tag list, apart from ticket tags, because those are tied to Pipedrive's labels.
// A retrospective's tickets arrive through POST / with { retro_date, source: 'retro', source_id }, source_id being the ticket.
import { Router } from 'express';
import { db } from '../db.js';
import { allStatuses } from '../pipelines.js';
import { PROCESS_TYPES } from '../../src/lib/process.js';

const r = Router();

const KINDS = ['good', 'bad'];
const ACTIONS = ['continue', 'change'];
const SOURCES = ['manual', 'retro'];
const TAG_GROUPS = ['Pipeline stages', 'Major milestones', 'Areas', 'Added by users'];

const MILESTONES = [...new Set([...PROCESS_TYPES.map((t) => (t === 'Final Gate Review' ? 'Final/Follow-on Gate Review' : t)), 'SOW', 'PO'])];
const AREAS = ['KIT', 'Software', 'Admin'];

const text = (v, max = 4000) => String(v ?? '').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Every stage, milestone and area is a tag. Stages can arrive with a Pipedrive sync, so this runs each time the tags are
 * read rather than once. A name in two groups stays in the first (Proposal is a stage and a milestone).
 */
function seedTags() {
  const add = db.prepare('INSERT OR IGNORE INTO lesson_tags (name, tag_group) VALUES (?, ?)');
  db.transaction(() => {
    allStatuses().forEach((name) => add.run(name, 'Pipeline stages'));
    MILESTONES.forEach((name) => add.run(name, 'Major milestones'));
    AREAS.forEach((name) => add.run(name, 'Areas'));
  })();
}

function listTags() {
  seedTags();
  const groupOrder = (t) => TAG_GROUPS.indexOf(t.tag_group);
  return db.prepare('SELECT id, name, tag_group FROM lesson_tags ORDER BY id').all().sort((a, b) => groupOrder(a) - groupOrder(b));
}

const canEdit = (lesson, user) => user.role === 'admin' || lesson.created_by === user.id;

/** Lessons with their tags and author, newest number first. */
function listLessons(user, id = null) {
  const rows = db.prepare(`SELECT l.*, u.first_name AS author_first_name, u.last_name AS author_last_name, b.name AS retro_name FROM lessons l
    LEFT JOIN users u ON u.id = l.created_by
    LEFT JOIN retro_notes n ON l.source = 'retro' AND n.id = l.source_id LEFT JOIN retro_boards b ON b.id = n.board_id
    WHERE ? IS NULL OR l.id = ? ORDER BY l.id DESC`).all(id, id);
  const tags = db.prepare(`SELECT k.lesson_id, t.id, t.name FROM lesson_tag_links k JOIN lesson_tags t ON t.id = k.tag_id
    WHERE ? IS NULL OR k.lesson_id = ? ORDER BY t.name COLLATE NOCASE`).all(id, id);
  return rows.map((l) => ({
    ...l,
    tags: tags.filter((t) => t.lesson_id === l.id).map(({ id: tagId, name }) => ({ id: tagId, name })),
    can_edit: canEdit(l, user),
  }));
}

/** A lesson's fields from the request, or { error }. */
function cleanLesson(b) {
  const title = text(b.title, 160);
  if (!title) return { error: 'Give the lesson a title' };
  if (!KINDS.includes(b.kind)) return { error: 'Choose Good/Keep or Bad/Change' };
  // Bad is always a change; good has to say which.
  const action = b.kind === 'bad' ? 'change' : b.action;
  if (!ACTIONS.includes(action)) return { error: 'Choose Continue or Change' };
  const retroDate = text(b.retro_date, 10) || null;
  if (retroDate && !isDate(retroDate)) return { error: 'Retro date isn’t a valid date' };
  return {
    fields: {
      title, kind: b.kind, action, retro_date: retroDate,
      context: text(b.context) || null, problem: text(b.problem) || null, solution: text(b.solution) || null,
    },
  };
}

function setTags(lessonId, tagIds) {
  const ids = JSON.stringify([...new Set((Array.isArray(tagIds) ? tagIds : []).map(Number).filter(Boolean))]);
  db.prepare('DELETE FROM lesson_tag_links WHERE lesson_id = ?').run(lessonId);
  db.prepare('INSERT INTO lesson_tag_links (lesson_id, tag_id) SELECT ?, id FROM lesson_tags WHERE id IN (SELECT value FROM json_each(?))').run(lessonId, ids);
}

r.get('/', (req, res) => res.json({ lessons: listLessons(req.user), tags: listTags() }));

/** Body: { name }. Naming a tag that already exists returns that tag. */
r.post('/tags', (req, res) => {
  const name = text(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Name the tag' });
  db.prepare('INSERT OR IGNORE INTO lesson_tags (name, tag_group, created_by) VALUES (?, ?, ?)').run(name, 'Added by users', req.user.id);
  const tag = db.prepare('SELECT id, name, tag_group FROM lesson_tags WHERE name = ? COLLATE NOCASE').get(name);
  res.json({ tag, tags: listTags() });
});

/** Body: the lesson, with tag_ids. A retrospective also sends source: 'retro', source_id (its item) and retro_date. */
r.post('/', (req, res) => {
  const b = req.body || {};
  const { fields, error } = cleanLesson(b);
  if (error) return res.status(400).json({ error });
  const source = SOURCES.includes(b.source) ? b.source : 'manual';
  const sourceId = source === 'manual' ? null : Number(b.source_id) || null;
  if (source === 'retro' && !db.prepare('SELECT 1 FROM retro_notes WHERE id = ?').get(sourceId)) return res.status(400).json({ error: 'That retro ticket is gone' });
  if (sourceId && db.prepare('SELECT 1 FROM lessons WHERE source = ? AND source_id = ?').get(source, sourceId)) {
    return res.status(409).json({ error: 'This ticket is already a lesson' });
  }
  const id = db.transaction(() => {
    const lessonId = db.prepare(`INSERT INTO lessons (title, kind, action, context, problem, solution, retro_date, source, source_id, created_by)
      VALUES (@title, @kind, @action, @context, @problem, @solution, @retro_date, @source, @source_id, @created_by)`)
      .run({ ...fields, source, source_id: sourceId, created_by: req.user.id }).lastInsertRowid;
    setTags(lessonId, b.tag_ids);
    return lessonId;
  })();
  res.json({ lesson: listLessons(req.user, id)[0] });
});

/** Author or admin. Where a lesson came from doesn't change. */
r.put('/:id', (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (!canEdit(lesson, req.user)) return res.status(403).json({ error: 'Only its author or an admin can change a lesson' });
  const { fields, error } = cleanLesson(req.body || {});
  if (error) return res.status(400).json({ error });
  db.transaction(() => {
    db.prepare(`UPDATE lessons SET title = @title, kind = @kind, action = @action, context = @context, problem = @problem,
      solution = @solution, retro_date = @retro_date, updated_at = datetime('now') WHERE id = @id`).run({ ...fields, id: lesson.id });
    setTags(lesson.id, req.body?.tag_ids);
  })();
  res.json({ lesson: listLessons(req.user, lesson.id)[0] });
});

r.delete('/:id', (req, res) => {
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (!canEdit(lesson, req.user)) return res.status(403).json({ error: 'Only its author or an admin can delete a lesson' });
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lesson.id);
  res.json({ ok: true });
});

export default r;
