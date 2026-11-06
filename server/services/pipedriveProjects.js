// Pipedrive Projects → Delivery. A won deal's project in Pipedrive is the plan on its contract in KIT: the overview
// (description, dates, phase, status, owner, labels), the plan (tasks with subtasks, and activities), notes and files.
// Projects are matched to contracts by the project's id once linked, and before that by the won deal they're on.
// Pipedrive has no webhooks for Projects, so they're read on every full pull and refreshed every few minutes.
import path from 'node:path';
import { db, json } from '../db.js';
import { call, all, allCursor, htmlToText, localDateTime, merged, snapshotOf, same, kitChanges, FROM_KIT, ACTIVITY_TYPES, MIME } from './pipedrive.js';
import { fieldByKey, fieldByName, labelNames } from './pipedriveFields.js';

export const PROJECT_TRACKED = ['notes', 'project_status', 'start_date', 'end_date', 'phase_id', 'labels', 'owner_id'];
export const DTASK_TRACKED = ['title', 'description', 'done', 'due_date', 'assignee_id', 'parent_id'];
export const DACT_TRACKED = ['title', 'activity_type', 'due_date', 'due_time', 'done', 'assignee_id', 'description'];
/** KIT's contract status for a Pipedrive project status. */
export const STATUS_OF = { open: 'Active', completed: 'Complete', canceled: 'Canceled' };
export const PROJECT_STATUS_OF = { Active: 'open', Complete: 'completed', Canceled: 'canceled' };
const sqlTime = (s) => (s ? String(s).replace('T', ' ').replace(/\.\d+/, '').replace(/Z$/, '').slice(0, 19) : null);
const orNone = (e) => { if (/: (404|410) /.test(e.message)) return []; throw e; };
const labelsField = () => fieldByKey('project', 'labels') || fieldByName('project', 'Labels') || fieldByKey('project', 'label');

/** A Pipedrive project's shared fields in KIT's terms. `lk` finds the KIT phase and a user's KIT account. */
export function projectView(p, lk) {
  return {
    notes: htmlToText(p.description) || null, project_status: p.status || 'open', start_date: p.start_date || null, end_date: p.end_date || null,
    phase_id: lk.phase(p.phase_id), labels: json.str(labelNames(labelsField(), Array.isArray(p.labels) ? p.labels : [])), owner_id: lk.owner(p.owner_id),
  };
}
export const taskView = (t, lk) => ({
  title: t.title || 'Task', description: t.description || null, done: t.done ? 1 : 0, due_date: t.due_date || null,
  assignee_id: lk.owner(t.assignee_id ?? t.assignee_ids?.[0]), parent_id: lk.task(t.parent_task_id),
});
export function projectActivityView(a, lk) {
  const when = localDateTime(a.due_date, a.due_time);
  return {
    title: a.subject || a.type_name || 'Activity', activity_type: ACTIVITY_TYPES[a.type] || a.type_name || null, due_date: when.date, due_time: when.time,
    done: a.done ? 1 : 0, assignee_id: lk.owner(a.assigned_to_user_id || a.user_id), description: htmlToText(a.note || a.public_description) || null,
  };
}

/**
 * Read Projects from Pipedrive: every project (and its tasks, activities, notes and files), or with `dealIds`, only the
 * projects on those deals. Also the Projects board's phases.
 */
export async function readProjects(dealIds, phase) {
  phase('Reading projects');
  const boards = (await call('projects/boards').catch(() => ({ data: [] }))).data || [];
  const phases = [];
  for (const b of boards) phases.push(...((await call('projects/phases', { board_id: b.id }).catch(() => ({ data: [] }))).data || []).map((p) => ({ ...p, board_id: b.id })));
  let projects = await allCursor('projects', { status: 'open,completed,canceled', include_archived: 'true' }, { limit: 100 }).catch(orNone);
  if (dealIds) {
    const want = new Set(dealIds);
    projects = projects.filter((p) => (p.deal_ids || []).some((id) => want.has(id)));
  }
  const ids = new Set(projects.map((p) => p.id));
  const tasks = dealIds
    ? (await Promise.all(projects.map((p) => allCursor('tasks', { project_id: p.id }).catch(orNone)))).flat()
    : (await allCursor('tasks').catch(orNone)).filter((t) => ids.has(t.project_id));
  const activities = [];
  const notes = [];
  for (const [i, p] of projects.entries()) {
    phase(`Reading project ${i + 1} of ${projects.length}`);
    activities.push(...(await allCursor(`projects/${p.id}/activities`).catch(orNone)).map((a) => ({ ...a, project_id: p.id })));
    notes.push(...(await all('notes', { project_id: p.id }).catch(orNone)).map((n) => ({ ...n, project_id: n.project_id ?? p.id })));
  }
  // Files attached to projects. Pipedrive lists every file in one place; those on these projects are kept.
  const files = projects.length ? (await all('files').catch(orNone)).filter((f) => f.project_id && ids.has(f.project_id) && !f.inline_flag && f.active_flag !== false) : [];
  const listed = new Set(files.map((f) => f.id));
  const filesMissing = db.prepare(`SELECT f.pipedrive_id AS id FROM delivery_files f JOIN delivery_programs p ON p.id = f.program_id
    WHERE f.pipedrive_id IS NOT NULL AND p.pipedrive_project_id IN (SELECT value FROM json_each(?))`).all(json.str([...ids])).map((f) => f.id).filter((id) => !listed.has(id));
  return { boards, phases, projects, tasks, activities, notes, files, filesMissing, filesGone: [], storedGone: [], complete: !dealIds };
}

/** Write what readProjects read. `ctx` is the deal pull's context: account(), tickets (deal id → ticket id), downloaded files. Returns counts. */
export function writeProjects(data, ctx) {
  const count = {};
  const tally = (k, n = 1) => { count[k] = (count[k] || 0) + n; };
  const { account, downloaded = new Map(), removeFiles = true } = ctx;

  // ---- Phases
  const phaseIds = new Map();
  data.phases.forEach((ph) => {
    const row = db.prepare('SELECT id FROM delivery_phases WHERE pipedrive_id = ?').get(ph.id);
    if (row) db.prepare('UPDATE delivery_phases SET name = ?, position = ?, board_id = ? WHERE id = ?').run(ph.name, ph.order_nr ?? 0, ph.board_id, row.id);
    phaseIds.set(ph.id, row?.id ?? db.prepare('INSERT INTO delivery_phases (board_id, name, position, pipedrive_id) VALUES (?, ?, ?, ?)').run(ph.board_id, ph.name, ph.order_nr ?? 0, ph.id).lastInsertRowid);
  });
  if (data.phases.length) db.prepare('DELETE FROM delivery_phases WHERE pipedrive_id IS NOT NULL AND pipedrive_id NOT IN (SELECT value FROM json_each(?))').run(json.str(data.phases.map((p) => p.id)));

  // ---- Projects → contracts
  const programByProject = db.prepare('SELECT * FROM delivery_programs WHERE pipedrive_project_id = ?');
  const programByDeal = db.prepare('SELECT p.* FROM delivery_programs p JOIN tickets t ON t.id = p.ticket_id WHERE t.pipedrive_id = ? AND t.archive_set_id IS NULL');
  const lookups = { phase: (id) => (id ? phaseIds.get(id) ?? db.prepare('SELECT id FROM delivery_phases WHERE pipedrive_id = ?').get(id)?.id ?? null : null), owner: (u) => account(u) };
  const programs = new Map(); // Pipedrive project id → program id
  data.projects.forEach((p) => {
    let row = programByProject.get(p.id);
    if (!row) for (const dealId of p.deal_ids || []) { row = programByDeal.get(dealId); if (row) break; }
    if (!row) { tally('projectsUnlinked'); return; }
    const view = projectView(p, lookups);
    const fields = merged(row, view, PROJECT_TRACKED);
    const snapshot = snapshotOf(view, PROJECT_TRACKED);
    const status = STATUS_OF[fields.project_status] || 'Active';
    db.prepare(`UPDATE delivery_programs SET pipedrive_project_id = @pd, notes = @notes, project_status = @project_status, status = @status,
        start_date = @start_date, end_date = @end_date, phase_id = @phase_id, labels = @labels, owner_id = @owner_id, health_status = @health,
        project_archived_at = @archived, pipedrive_snapshot = @snapshot,
        pipedrive_pending = CASE WHEN pipedrive_pending AND @changed THEN 1 ELSE 0 END,
        completed_at = CASE WHEN @status = 'Complete' THEN COALESCE(@changed_at, completed_at, datetime('now')) WHEN @status = 'Active' THEN NULL ELSE completed_at END,
        updated_at = CASE WHEN updated_at IS NULL OR updated_at < @updated THEN @updated ELSE updated_at END
      WHERE id = @id`).run({
      ...fields, pd: p.id, status, health: p.health_status ?? null, archived: sqlTime(p.archive_time), snapshot, id: row.id,
      changed_at: sqlTime(p.status_change_time), updated: sqlTime(p.update_time) || sqlTime(new Date().toISOString()),
      changed: kitChanges({ ...row, ...fields, pipedrive_snapshot: snapshot }, PROJECT_TRACKED).length ? 1 : 0,
    });
    programs.set(p.id, row.id);
    tally('projectsUpdated');
  });
  // A project gone from Pipedrive (deleted there) is remembered as such; the contract keeps everything it had.
  if (data.complete) {
    db.prepare(`UPDATE delivery_programs SET project_status = 'deleted' WHERE pipedrive_project_id IS NOT NULL AND project_status IS NOT 'deleted'
      AND pipedrive_project_id NOT IN (SELECT value FROM json_each(?))`).run(json.str(data.projects.map((p) => p.id)));
  }
  const covered = json.str([...programs.values()]);

  // ---- Tasks (parents first, so subtasks can point at them) and activities, as one plan
  const deleted = (kind) => new Set(db.prepare('SELECT pipedrive_id FROM pipedrive_deletes WHERE kind = ?').all(kind).map((x) => x.pipedrive_id));
  const taskByPd = db.prepare("SELECT * FROM delivery_tasks WHERE pipedrive_id = ? AND kind = 'task'");
  const actByPd = db.prepare("SELECT * FROM delivery_tasks WHERE pipedrive_id = ? AND kind = 'activity'");
  const deletedTasks = deleted('task');
  const deletedActs = deleted('activity');
  const taskIds = new Map(); // Pipedrive task id → KIT task id
  const seenTasks = new Set();
  const seenActs = new Set();
  const taskLookups = { owner: (u) => account(u), task: (id) => (id ? taskIds.get(id) ?? taskByPd.get(id)?.id ?? null : null) };
  const ordered = [...data.tasks.filter((t) => !t.parent_task_id), ...data.tasks.filter((t) => t.parent_task_id)];
  ordered.forEach((t) => {
    const programId = programs.get(t.project_id);
    if (!programId || deletedTasks.has(t.id)) return;
    seenTasks.add(t.id);
    const view = taskView(t, taskLookups);
    const row = taskByPd.get(t.id);
    const fields = { ...merged(row, view, DTASK_TRACKED), program_id: programId, snapshot: snapshotOf(view, DTASK_TRACKED) };
    const doneAt = fields.done ? (same(fields.done, view.done) && sqlTime(t.marked_as_done_time)) || row?.done_at || sqlTime(t.update_time) : null;
    if (row) {
      db.prepare(`UPDATE delivery_tasks SET program_id = @program_id, parent_id = @parent_id, title = @title, description = @description, done = @done, done_at = @done_at,
        due_date = @due_date, assignee_id = @assignee_id, pipedrive_snapshot = @snapshot WHERE id = @id`).run({ ...fields, done_at: doneAt, id: row.id });
      taskIds.set(t.id, row.id);
      tally('tasksUpdated');
    } else {
      taskIds.set(t.id, db.prepare(`INSERT INTO delivery_tasks (program_id, parent_id, kind, title, description, done, done_at, due_date, assignee_id, position, created_by, created_at, pipedrive_id, pipedrive_snapshot)
        VALUES (@program_id, @parent_id, 'task', @title, @description, @done, @done_at, @due_date, @assignee_id,
          (SELECT COALESCE(MAX(position) + 1, 0) FROM delivery_tasks WHERE program_id = @program_id), @by, @at, @pd, @snapshot)`)
        .run({ ...fields, done_at: doneAt, by: account(t.creator_id), at: sqlTime(t.add_time), pd: t.id }).lastInsertRowid);
      tally('tasksAdded');
    }
  });
  data.activities.forEach((a) => {
    const programId = programs.get(a.project_id);
    if (!programId || deletedActs.has(a.id) || a.active_flag === false) return;
    seenActs.add(a.id);
    const view = projectActivityView(a, taskLookups);
    const row = actByPd.get(a.id);
    const fields = { ...merged(row, view, DACT_TRACKED), program_id: programId, snapshot: snapshotOf(view, DACT_TRACKED) };
    const doneAt = fields.done ? (same(fields.done, view.done) && sqlTime(a.marked_as_done_time)) || row?.done_at || sqlTime(a.update_time) : null;
    if (row) {
      db.prepare(`UPDATE delivery_tasks SET program_id = @program_id, title = @title, activity_type = @activity_type, description = @description, done = @done, done_at = @done_at,
        due_date = @due_date, due_time = @due_time, assignee_id = @assignee_id, pipedrive_snapshot = @snapshot WHERE id = @id`).run({ ...fields, done_at: doneAt, id: row.id });
    } else {
      db.prepare(`INSERT INTO delivery_tasks (program_id, kind, title, activity_type, description, done, done_at, due_date, due_time, assignee_id, position, created_by, created_at, pipedrive_id, pipedrive_snapshot)
        VALUES (@program_id, 'activity', @title, @activity_type, @description, @done, @done_at, @due_date, @due_time, @assignee_id,
          (SELECT COALESCE(MAX(position) + 1, 0) FROM delivery_tasks WHERE program_id = @program_id), @by, @at, @pd, @snapshot)`)
        .run({ ...fields, done_at: doneAt, by: account(a.created_by_user_id), at: sqlTime(a.add_time), pd: a.id });
      tally('tasksAdded');
    }
  });
  // Tasks and activities gone from Pipedrive go here too, unless KIT changed them and hasn't sent that yet.
  db.prepare('SELECT id, kind, pipedrive_id FROM delivery_tasks WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 0 AND program_id IN (SELECT value FROM json_each(?))').all(covered)
    .filter((k) => (k.kind === 'task' ? !seenTasks.has(k.pipedrive_id) && !deletedTasks.has(k.pipedrive_id) : !seenActs.has(k.pipedrive_id) && !deletedActs.has(k.pipedrive_id)))
    .forEach((k) => { db.prepare('DELETE FROM delivery_tasks WHERE id = ?').run(k.id); tally('tasksDeleted'); });

  // ---- Notes
  const noteByPd = db.prepare('SELECT * FROM delivery_notes WHERE pipedrive_id = ?');
  const deletedNotes = deleted('project_note');
  const seenNotes = new Set();
  data.notes.forEach((n) => {
    const programId = programs.get(n.project_id);
    if (!programId || deletedNotes.has(n.id)) return;
    seenNotes.add(n.id);
    const body = htmlToText(n.content).replace(FROM_KIT, '');
    if (!body) return;
    const row = noteByPd.get(n.id);
    if (row?.pipedrive_pending) return;
    if (row) db.prepare('UPDATE delivery_notes SET program_id = ?, body = ?, pinned = ? WHERE id = ?').run(programId, body, n.pinned_to_project_flag ? 1 : 0, row.id);
    else {
      db.prepare('INSERT INTO delivery_notes (program_id, body, author_id, pinned, created_at, pipedrive_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(programId, body, account(n.user_id), n.pinned_to_project_flag ? 1 : 0, sqlTime(n.add_time), n.id);
      tally('projectNotesAdded');
    }
  });
  db.prepare('SELECT id, pipedrive_id FROM delivery_notes WHERE pipedrive_id IS NOT NULL AND pipedrive_pending = 0 AND program_id IN (SELECT value FROM json_each(?))').all(covered)
    .filter((m) => !seenNotes.has(m.pipedrive_id) && !deletedNotes.has(m.pipedrive_id))
    .forEach((m) => { db.prepare('DELETE FROM delivery_notes WHERE id = ?').run(m.id); tally('projectNotesDeleted'); });

  // ---- Files
  const fileByPd = db.prepare('SELECT * FROM delivery_files WHERE pipedrive_id = ?');
  data.files.forEach((f) => {
    const programId = programs.get(f.project_id);
    if (!programId) return;
    const row = fileByPd.get(f.id);
    if (row) { db.prepare('UPDATE delivery_files SET program_id = ? WHERE id = ?').run(programId, row.id); return; }
    const got = downloaded.get(f.id);
    if (!got) return;
    db.prepare(`INSERT INTO delivery_files (program_id, doc_type, original_name, stored_name, mime_type, size, uploaded_by, created_at, pipedrive_id)
      VALUES (?, 'Additional', ?, ?, ?, ?, ?, ?, ?)`).run(programId, f.name || f.file_name, got.stored, MIME[path.extname(f.name || '').toLowerCase()] || null, got.size, account(f.user_id), sqlTime(f.add_time), f.id);
    tally('projectFilesAdded');
  });
  if (removeFiles) {
    data.filesGone.forEach((id) => {
      const f = fileByPd.get(id);
      if (!f) return;
      db.prepare('DELETE FROM delivery_files WHERE id = ?').run(f.id);
      if (f.stored_name && !f.url) data.storedGone.push(f.stored_name);
      tally('projectFilesDeleted');
    });
  }
  return count;
}
