import { Router } from 'express';
import { db, json, withTeams, pipelineTicketsClosed, PIPELINE_TICKETS_CLOSED } from '../db.js';
import { loadThreads, bidAssignment, NO_ASSIGNMENT } from './tickets.js';
import { recordWork, loadWorkLog } from '../worklog.js';
import { awardTokens, TOKENS } from '../race.js';
import { notifyMentions } from '../mentions.js';
import { loadSupport } from './support.js';
import { KIT_STAGES, listPipelines, allStatuses } from '../pipelines.js';
import { nextPosition, openOrder, rankOf, reorderWithin, mirrorCards, setSubtasksFromChecklist, syncMilestone } from '../activities.js';

const r = Router();


// KIT's own pipeline. Synced Pipedrive pipelines have their own stages (see server/pipelines.js).
export const PIPELINE_STATUSES = KIT_STAGES;
export const ACCOUNT_TYPES = ['Army', 'Air Force', 'Navy / Marine'];
export const TICKET_TYPES = ['bid', 'work'];

const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

/** The check-in date that starts the week containing `iso` for a team's check-in weekday. */
export function weekStartFor(iso, dow) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

const team = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);

// A priority leaves the board when it's archived, or when its ticket is (by hand, or by a full reset); restoring the
// ticket brings it back.
function loadCards(teamId, weekStart) {
  const cards = db.prepare(`SELECT c.*, t.opportunity_title, t.organization, t.pipeline_status, t.account_type, t.work_team_id, t.value, t.ticket_type,
      COALESCE((SELECT k.waiting_client FROM ticket_tasks k WHERE k.id = c.activity_id), 0) AS waiting_client
    FROM priority_cards c JOIN tickets t ON t.id = c.ticket_id
    WHERE c.team_id = ? AND c.week_start = ? AND c.archived_at IS NULL AND t.archived_at IS NULL ORDER BY c.id`).all(teamId, weekStart);
  const assignees = db.prepare(`SELECT a.* FROM card_assignees a JOIN priority_cards c ON c.id = a.card_id
    WHERE c.team_id = ? AND c.week_start = ? AND c.archived_at IS NULL`).all(teamId, weekStart);
  // A card's notes (status updates) are the comments on its activity.
  const notes = db.prepare(`SELECT m.*, u.first_name, u.last_name FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id
    WHERE m.parent_id IS NULL AND m.target_type = 'activity' AND m.target_id IN (SELECT value FROM json_each(?))
    ORDER BY m.created_at DESC, m.id DESC`).all(JSON.stringify(cards.map((c) => c.activity_id).filter(Boolean)));
  const ranks = new Map();
  [...new Set(cards.map((c) => c.ticket_id))].forEach((t) => openOrder(t).forEach((id, i) => ranks.set(id, i + 1)));
  return cards.map((c) => ({
    ...c,
    checklist: json.parse(c.checklist, []),
    notes: notes.filter((n) => c.activity_id && n.target_id === c.activity_id).map(noteOut),
    assignees: assignees.filter((a) => a.card_id === c.id).map((a) => ({ user_id: a.user_id, position: a.position })),
    // Its place among the ticket's open activities now, and when the week's planning closed.
    rank: c.activity_id ? ranks.get(c.activity_id) ?? null : null,
  }));
}

const noteOut = (n) => ({
  id: n.id, body: n.body, author_id: n.author_id, created_at: n.created_at, updated_at: n.updated_at,
  author: n.first_name ? { first_name: n.first_name, last_name: n.last_name } : null,
});

function loadNote(id) {
  const n = db.prepare('SELECT m.*, u.first_name, u.last_name FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?').get(id);
  return n && noteOut(n);
}

function loadCard(id) {
  const c = db.prepare('SELECT team_id, week_start FROM priority_cards WHERE id = ?').get(id);
  return c ? loadCards(c.team_id, c.week_start).find((x) => x.id === Number(id)) : null;
}

r.get('/meta', (req, res) => res.json({ pipelineStatuses: PIPELINE_STATUSES, pipelines: listPipelines(), teams: db.prepare('SELECT id, name FROM teams ORDER BY name').all(), pipelineTicketsClosed: pipelineTicketsClosed() }));

/**
 * Every active user across all teams. The strip runs on Monday weeks; each team's cards
 * come from its own check-in week, shifted by the same number of weeks from "this week".
 */
function allTeamWeeks(date) {
  const ANCHOR_DOW = 1;
  const weekStart = weekStartFor(date, ANCHOR_DOW);
  const currentWeekStart = weekStartFor(localToday(), ANCHOR_DOW);
  const offset = Math.round((Date.parse(weekStart) - Date.parse(currentWeekStart)) / (7 * 864e5));
  const teamWeeks = {};
  db.prepare('SELECT * FROM teams ORDER BY id').all().forEach((t) => {
    const d = new Date(`${weekStartFor(localToday(), t.checkin_dow)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset * 7);
    teamWeeks[t.id] = d.toISOString().slice(0, 10);
  });
  return { weekStart, currentWeekStart, teamWeeks };
}

function allTeamsBoard(date) {
  const { weekStart, currentWeekStart, teamWeeks } = allTeamWeeks(date);
  const cards = Object.entries(teamWeeks).flatMap(([id, week]) => loadCards(Number(id), week));
  const work = Object.entries(teamWeeks).flatMap(([id, week]) => loadWorkLog(Number(id), week));
  // Everyone appears once, with all their teams; their lane holds their cards from every team.
  const members = withTeams(db.prepare(`SELECT u.id, u.first_name, u.last_name, u.username, u.title
    FROM users u WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all());
  const weeks = Object.entries(teamWeeks).map(([id, week]) => [Number(id), week]);
  return {
    team: { id: 'all', name: 'All' }, weekStart, currentWeekStart, teamWeeks, members, cards, work, threads: threadsFor(cards),
    support: loadSupport(members.map((m) => m.id), weekStart), planning: planningFor(weeks),
  };
}

// ---- Planning lock

const planningRow = (teamId, week) => db.prepare(`SELECT p.*, u.first_name, u.last_name FROM week_planning p
  LEFT JOIN users u ON u.id = p.closed_by WHERE p.team_id = ? AND p.week_start = ?`).get(teamId, week);
export const planningClosed = (teamId, week) => !!planningRow(teamId, week);

/** Planning state across one or more team-weeks. It counts as closed only when every one is closed. */
function planningFor(weeks) {
  const rows = weeks.map(([id, week]) => planningRow(id, week)).filter(Boolean);
  const last = rows.sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0];
  return {
    closed: rows.length === weeks.length && weeks.length > 0,
    closed_count: rows.length,
    closed_teams: rows.map((r) => r.team_id),
    total: weeks.length,
    closed_at: last?.closed_at ?? null,
    closed_by: last?.first_name ? `${last.first_name} ${last.last_name}` : null,
  };
}

/** Body: { team: id | 'all', week: date, closed: boolean }. */
r.put('/planning', (req, res) => {
  const { team: teamId, week, closed } = req.body || {};
  let weeks;
  if (teamId === 'all') {
    weeks = Object.entries(allTeamWeeks(week || localToday()).teamWeeks).map(([id, w]) => [Number(id), w]);
  } else {
    const t = team(teamId);
    if (!t) return res.status(400).json({ error: 'Unknown team' });
    weeks = [[t.id, weekStartFor(week || localToday(), t.checkin_dow)]];
  }
  const close = db.prepare('INSERT OR IGNORE INTO week_planning (team_id, week_start, closed_by) VALUES (?, ?, ?)');
  const open = db.prepare('DELETE FROM week_planning WHERE team_id = ? AND week_start = ?');
  // Closing planning notes where each priority stands on its ticket, so later moves can be shown on the board.
  const lock = db.prepare('UPDATE priority_cards SET locked_rank = ? WHERE id = ?');
  const unlock = db.prepare('UPDATE priority_cards SET locked_rank = NULL WHERE team_id = ? AND week_start = ?');
  db.transaction(() => weeks.forEach(([id, w]) => {
    if (!closed) { open.run(id, w); unlock.run(id, w); return; }
    if (close.run(id, w, req.user.id).changes) loadCards(id, w).forEach((c) => lock.run(c.rank, c.id));
  }))();
  res.json({ planning: planningFor(weeks) });
});

const threadsFor = (cards) => loadThreads([...new Set(cards.map((c) => c.ticket_id))]);

r.get('/', (req, res) => {
  if (req.query.team === 'all') return res.json(allTeamsBoard(req.query.week || localToday()));
  const t = team(req.query.team);
  if (!t) return res.status(400).json({ error: 'Unknown team' });
  const weekStart = weekStartFor(req.query.week || localToday(), t.checkin_dow);
  const members = db.prepare(`SELECT u.id, u.first_name, u.last_name, u.username, u.title FROM users u
    JOIN user_teams ut ON ut.user_id = u.id AND ut.team_id = ? WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all(t.id);
  const cards = loadCards(t.id, weekStart);
  res.json({
    team: t,
    weekStart,
    currentWeekStart: weekStartFor(localToday(), t.checkin_dow),
    members,
    cards,
    work: loadWorkLog(t.id, weekStart),
    threads: threadsFor(cards),
    support: loadSupport(members.map((m) => m.id), weekStart),
    planning: planningFor([[t.id, weekStart]]),
  });
});

// ---- Tickets (the larger assignment each priority card rolls up to) ----

const TICKET_SORTS = {
  opportunity_title: 't.opportunity_title COLLATE NOCASE',
  organization: 't.organization COLLATE NOCASE',
  pipeline_status: 't.pipeline_status',
  value: 't.value',
  due_date: 'next_due',
  updated: 't.updated_at',
};

r.get('/tickets', (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const sort = TICKET_SORTS[req.query.sort] || TICKET_SORTS.updated;
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT t.*, COUNT(c.id) AS card_count, MIN(c.due_date) AS next_due
    FROM tickets t LEFT JOIN priority_cards c ON c.ticket_id = t.id
    WHERE t.archive_set_id IS NULL AND t.archived_at IS NULL AND t.ticket_type != 'account' AND (t.opportunity_title LIKE ? OR t.organization LIKE ?)
    GROUP BY t.id ORDER BY ${sort} ${dir} LIMIT 200`).all(q, q);
  res.json({ tickets: rows });
});

export function ticketFields(t = {}) {
  return {
    opportunity_title: String(t.opportunity_title || '').trim(),
    organization: t.organization?.trim() || null,
    pipeline_status: allStatuses().includes(t.pipeline_status) ? t.pipeline_status : null,
    account_type: ACCOUNT_TYPES.includes(t.account_type) ? t.account_type : null,
    work_team_id: db.prepare('SELECT id FROM teams WHERE id = ?').get(Number(t.work_team_id) || null)?.id ?? null,
    value: t.value === '' || t.value == null ? null : Number(t.value),
  };
}

const setWaiting = (activityId, on) => db.prepare('UPDATE ticket_tasks SET waiting_client = ? WHERE id = ?').run(on ? 1 : 0, activityId);

/** A card's own fields go to its activity: title → subject, due date, completed → done, checklist → subtasks, waiting on client. */
function saveToActivity(activityId, b, user) {
  const k = db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(activityId);
  const title = b.title?.trim() || k.text;
  const done = !!b.completed;
  db.prepare(`UPDATE ticket_tasks SET text = ?, due_date = ?, done = ?, done_at = CASE WHEN ? THEN COALESCE(done_at, datetime('now')) END,
    position = CASE WHEN ? = done THEN position WHEN ? THEN position ELSE ? END WHERE id = ?`)
    .run(title, /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || '') ? b.due_date : null, done ? 1 : 0, done ? 1 : 0, done ? 1 : 0, done ? 1 : 0, nextPosition(k.ticket_id), k.id);
  if (Array.isArray(b.checklist)) setSubtasksFromChecklist(k.id, b.checklist, user.id);
  if ('waiting_client' in b) setWaiting(k.id, b.waiting_client);
  mirrorCards(k.id);
  syncMilestone(k.ticket_id);
}

function setAssignees(cardId, userIds, teamId, weekStart) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  const existing = db.prepare('SELECT user_id FROM card_assignees WHERE card_id = ?').all(cardId).map((a) => a.user_id);
  const del = db.prepare('DELETE FROM card_assignees WHERE card_id = ? AND user_id = ?');
  existing.filter((u) => !ids.includes(u)).forEach((u) => del.run(cardId, u));
  const nextPos = db.prepare(`SELECT COALESCE(MAX(a.position) + 1, 0) AS p FROM card_assignees a
    JOIN priority_cards c ON c.id = a.card_id WHERE a.user_id = ? AND c.team_id = ? AND c.week_start = ?`);
  const ins = db.prepare('INSERT INTO card_assignees (card_id, user_id, position) VALUES (?, ?, ?)');
  ids.filter((u) => !existing.includes(u)).forEach((u) => ins.run(cardId, u, nextPos.get(u, teamId, weekStart).p));
}

r.post('/cards', (req, res) => {
  const b = req.body || {};
  const t = team(b.team_id);
  if (!t) return res.status(400).json({ error: 'Unknown team' });
  const weekStart = weekStartFor(b.week_start || localToday(), t.checkin_dow);
  const assignees = b.assignees?.length ? b.assignees : [req.user.id];

  const create = db.transaction(() => {
    let ticketId = Number(b.ticket_id) || null;
    if (ticketId) {
      if (!db.prepare('SELECT 1 FROM tickets WHERE id = ?').get(ticketId)) throw new Error('Ticket not found');
      if (b.ticket) {
        const tf = ticketFields(b.ticket);
        if (tf.opportunity_title) db.prepare(`UPDATE tickets SET opportunity_title=@opportunity_title, organization=@organization,
          pipeline_status=CASE WHEN ticket_type = 'work' THEN NULL ELSE @pipeline_status END, account_type=@account_type, work_team_id=CASE WHEN ticket_type = 'work' THEN @work_team_id END,
          value=CASE WHEN ticket_type = 'work' THEN NULL ELSE @value END, updated_at=datetime('now') WHERE id=@id AND ticket_type != 'account'`).run({ ...tf, id: ticketId });
      }
    } else {
      const tf = ticketFields(b.ticket);
      if (!tf.opportunity_title) throw new Error('Opportunity Title is required');
      // The ticket type is chosen once, when the ticket is created. Work tickets have no value or pipeline status.
      const ticketType = b.ticket?.ticket_type === 'work' ? 'work' : 'bid';
      if (ticketType === 'bid' && pipelineTicketsClosed()) throw new Error(PIPELINE_TICKETS_CLOSED);
      const fields = ticketType === 'work' ? { ...tf, pipeline_status: null, value: null } : { ...tf, work_team_id: null };
      const assign = ticketType === 'bid' ? bidAssignment(b.ticket, req.user.id, fields.account_type) : NO_ASSIGNMENT;
      ticketId = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, work_team_id, value, ticket_type, created_by,
          bd_director_id, territory_id, projected_win_date, win_date_undetermined)
        VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @work_team_id, @value, @ticket_type, @created_by,
          @bd_director_id, @territory_id, @projected_win_date, @win_date_undetermined)`)
        .run({ ...fields, ...assign, ticket_type: ticketType, created_by: req.user.id }).lastInsertRowid;
    }
    // A priority is an activity on the ticket: an existing one placed in this week, or a new one at the bottom of its list.
    let activityId = Number(b.activity_id) || null;
    if (activityId && !db.prepare('SELECT 1 FROM ticket_tasks WHERE id = ? AND ticket_id = ?').get(activityId, ticketId)) throw new Error('That activity isn’t on this ticket');
    const isNew = !activityId;
    if (isNew) {
      const title = b.title?.trim() || db.prepare('SELECT opportunity_title FROM tickets WHERE id = ?').get(ticketId).opportunity_title;
      activityId = db.prepare(`INSERT INTO ticket_tasks (ticket_id, text, activity_type, assignee_id, position, created_by) VALUES (?, ?, 'Task', ?, ?, ?)`)
        .run(ticketId, title, Number(assignees[0]) || req.user.id, nextPosition(ticketId), req.user.id).lastInsertRowid;
    }
    // Cards added while the week's planning is open are priorities; once planning
    // is closed, new cards are work tickets (accomplishments and new tasks).
    const isPlanned = planningClosed(t.id, weekStart) ? 0 : 1;
    const cardId = db.prepare(`INSERT INTO priority_cards (ticket_id, team_id, week_start, activity_id, is_planned, created_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run(ticketId, t.id, weekStart, activityId, isPlanned, req.user.id).lastInsertRowid;
    // An existing next step picked in the priority panel comes with its edits (title and all); placed from the ticket, as is.
    if (isNew || 'title' in b) saveToActivity(activityId, b, req.user);
    else {
      if ('waiting_client' in b) setWaiting(activityId, b.waiting_client);
      mirrorCards(activityId);
    }
    // Added after planning closed, it's measured from where it starts.
    if (!isPlanned) db.prepare('UPDATE priority_cards SET locked_rank = ? WHERE id = ?').run(rankOf(activityId), cardId);
    setAssignees(cardId, assignees, t.id, weekStart);
    // Notes written before the card existed, oldest first so the newest stays on top.
    const addNote = db.prepare(`INSERT INTO ticket_comments (ticket_id, card_id, kind, body, author_id, target_type, target_id)
      VALUES (?, ?, 'comment', ?, ?, 'activity', ?)`);
    (Array.isArray(b.new_notes) ? b.new_notes : []).map((n) => String(n || '').trim()).filter(Boolean).reverse()
      .forEach((body) => addNote.run(ticketId, cardId, body, req.user.id, activityId));
    return cardId;
  });

  try {
    res.json({ card: loadCard(create()) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** One card, with whether its week can still be edited. */
r.get('/cards/:id', (req, res) => {
  const card = loadCard(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const t = team(card.team_id);
  res.json({ card, editable: card.week_start >= weekStartFor(localToday(), t.checkin_dow), planningClosed: planningClosed(t.id, card.week_start) });
});

r.put('/cards/:id', (req, res) => {
  const b = req.body || {};
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const tf = ticketFields(b.ticket);
  if (b.ticket && !tf.opportunity_title) return res.status(400).json({ error: 'Opportunity Title is required' });
  db.transaction(() => {
    saveToActivity(activityFor(card, req.user), b, req.user);
    if (b.ticket) {
      db.prepare(`UPDATE tickets SET opportunity_title=@opportunity_title, organization=@organization,
        pipeline_status=CASE WHEN ticket_type = 'work' THEN NULL ELSE @pipeline_status END, account_type=@account_type, work_team_id=CASE WHEN ticket_type = 'work' THEN @work_team_id END,
        value=CASE WHEN ticket_type = 'work' THEN NULL ELSE @value END, updated_at=datetime('now') WHERE id=@id AND ticket_type != 'account'`).run({ ...tf, id: card.ticket_id });
    }
    if (Array.isArray(b.assignees) && b.assignees.length) setAssignees(card.id, b.assignees, card.team_id, card.week_start);
  })();
  const wasDone = new Set(json.parse(card.checklist, []).filter((i) => i.done).map((i) => i.text));
  (Array.isArray(b.checklist) ? b.checklist : []).filter((i) => i.done && !wasDone.has(String(i.text || '').trim()))
    .forEach((i) => { recordWork(req.user, { kind: 'task', ticket_id: card.ticket_id, card_id: card.id, summary: i.text }); awardTokens(req.user, 'check', `${card.id}:${String(i.text || '').trim()}`); });
  if (b.completed && !card.completed) {
    recordWork(req.user, { kind: 'completed', ticket_id: card.ticket_id, card_id: card.id, summary: card.title });
    awardTokens(req.user, 'priority', card.id, TOKENS.priority);
  }
  res.json({ card: loadCard(card.id) });
});

/** Check or uncheck one checklist item: the subtask at that place under the card's activity. */
r.put('/cards/:id/checklist/:index', (req, res) => {
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const activityId = activityFor(card, req.user);
  const sub = db.prepare('SELECT * FROM activity_subtasks WHERE task_id = ? ORDER BY position, id LIMIT 1 OFFSET ?').get(activityId, Number(req.params.index) || 0);
  if (!sub) return res.status(400).json({ error: 'Task not found' });
  const done = !!req.body?.done;
  db.transaction(() => {
    db.prepare("UPDATE activity_subtasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') END WHERE id = ?").run(done ? 1 : 0, done ? 1 : 0, sub.id);
    mirrorCards(activityId);
  })();
  if (done && !sub.done) {
    recordWork(req.user, { kind: 'task', ticket_id: card.ticket_id, card_id: card.id, summary: sub.text });
    awardTokens(req.user, 'subtask', sub.id);
  }
  res.json({ card: loadCard(card.id) });
});

/** The card's activity, made from the card if it lost it (say the activity was deleted in Pipedrive). */
function activityFor(card, user) {
  if (card.activity_id && db.prepare('SELECT 1 FROM ticket_tasks WHERE id = ?').get(card.activity_id)) return card.activity_id;
  const id = db.prepare(`INSERT INTO ticket_tasks (ticket_id, text, activity_type, due_date, done, position, created_by) VALUES (?, ?, 'Task', ?, ?, ?, ?)`)
    .run(card.ticket_id, card.title || 'Priority', card.due_date, card.completed, nextPosition(card.ticket_id), user.id).lastInsertRowid;
  setSubtasksFromChecklist(id, json.parse(card.checklist, []), user.id);
  db.prepare('UPDATE priority_cards SET activity_id = ? WHERE id = ?').run(id, card.id);
  return id;
}

/** Body: { archived: boolean }. Archiving takes a card off the board; restoring puts it back. */
r.put('/cards/:id/archive', (req, res) => {
  const card = db.prepare('SELECT id FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE priority_cards SET archived_at = ${req.body?.archived ? "datetime('now')" : 'NULL'}, archive_set_id = NULL, updated_at = datetime('now') WHERE id = ?`).run(card.id);
  res.json({ ok: true });
});

/** Deleting a priority deletes its activity too, unless the activity is on another week's board or came from Pipedrive. */
r.delete('/cards/:id', (req, res) => {
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.json({ ok: true });
  db.transaction(() => {
    db.prepare('DELETE FROM priority_cards WHERE id = ?').run(card.id);
    const k = card.activity_id && db.prepare('SELECT * FROM ticket_tasks WHERE id = ?').get(card.activity_id);
    if (k && !k.pipedrive_id && !db.prepare('SELECT 1 FROM priority_cards WHERE activity_id = ?').get(k.id)) {
      db.prepare("UPDATE ticket_comments SET target_type = NULL, target_id = NULL WHERE (target_type = 'activity' AND target_id = ?) OR (target_type = 'subtask' AND target_id IN (SELECT id FROM activity_subtasks WHERE task_id = ?))").run(k.id, k.id);
      db.prepare('DELETE FROM ticket_tasks WHERE id = ?').run(k.id);
      syncMilestone(k.ticket_id);
    }
  })();
  res.json({ ok: true });
});

// ---- Notes: a card's status updates are comments on its activity, so they show in the ticket's history too. Only a
// note's author or an admin may change it.

r.post('/cards/:id/notes', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Note is empty' });
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const activityId = activityFor(card, req.user);
  const id = db.prepare(`INSERT INTO ticket_comments (ticket_id, card_id, kind, body, author_id, target_type, target_id)
    VALUES (?, ?, 'comment', ?, ?, 'activity', ?)`).run(card.ticket_id, card.id, body, req.user.id, activityId).lastInsertRowid;
  recordWork(req.user, { kind: 'comment', ticket_id: card.ticket_id, card_id: card.id, ref_id: id, summary: body });
  notifyMentions(req.user, body, { ticket_id: card.ticket_id, card_id: card.id, comment_id: id });
  res.json({ note: loadNote(id) });
});

function ownNote(req, res) {
  const n = db.prepare("SELECT * FROM ticket_comments WHERE id = ? AND target_type = 'activity'").get(req.params.id);
  if (!n) return res.status(404).json({ error: 'Note not found' }), null;
  if (n.author_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Only the note\'s author can change it' }), null;
  return n;
}

r.put('/notes/:id', (req, res) => {
  const n = ownNote(req, res);
  if (!n) return;
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Note is empty' });
  if (body !== n.body) {
    db.prepare("UPDATE ticket_comments SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, n.id);
    notifyMentions(req.user, body, { ticket_id: n.ticket_id, card_id: n.card_id, comment_id: n.id }, n.body);
  }
  res.json({ note: loadNote(n.id) });
});

r.delete('/notes/:id', (req, res) => {
  const n = ownNote(req, res);
  if (!n) return;
  db.prepare('DELETE FROM ticket_comments WHERE id = ? OR parent_id = ?').run(n.id, n.id);
  db.prepare("DELETE FROM work_log WHERE kind IN ('note', 'comment') AND ref_id = ?").run(n.id);
  res.json({ ok: true });
});

/**
 * Persist drag-and-drop ordering. Body: { team_id: id | 'all', week_start, lanes: { [userId]: [cardId, ...] } }.
 * Each listed lane is rewritten in order (index 0 = top priority). Moving a card to
 * another member's lane reassigns it. On the All board a lane spans every team's week,
 * so positions are numbered across all of them, which keeps each team's order intact too.
 */
r.put('/lanes', (req, res) => {
  const { team_id, week_start, lanes = {} } = req.body || {};
  const weeks = team_id === 'all'
    ? Object.entries(allTeamWeeks(week_start).teamWeeks).map(([id, w]) => [Number(id), w])
    : [[Number(team_id), week_start]];
  // Archived cards, and cards on archived tickets, aren't on the board, so a reorder never touches them.
  const weekCards = new Set(weeks.flatMap(([id, w]) => db.prepare(`SELECT c.id FROM priority_cards c JOIN tickets t ON t.id = c.ticket_id
    WHERE c.team_id = ? AND c.week_start = ? AND c.archived_at IS NULL AND t.archived_at IS NULL`)
    .all(id, w).map((c) => c.id)));
  db.transaction(() => {
    const del = db.prepare('DELETE FROM card_assignees WHERE user_id = ? AND card_id = ?');
    const ins = db.prepare('INSERT OR REPLACE INTO card_assignees (card_id, user_id, position) VALUES (?, ?, ?)');
    const assigned = db.prepare('SELECT card_id FROM card_assignees WHERE user_id = ?');
    for (const [userId, ids] of Object.entries(lanes)) {
      assigned.all(Number(userId)).filter((a) => weekCards.has(a.card_id)).forEach((a) => del.run(Number(userId), a.card_id));
      ids.map(Number).filter((id) => weekCards.has(id)).forEach((id, i) => ins.run(id, Number(userId), i));
    }
    // A card must always belong to someone; drop any orphaned by the move.
    const orphans = db.prepare(`DELETE FROM priority_cards WHERE team_id = ? AND week_start = ? AND archived_at IS NULL
      AND id NOT IN (SELECT card_id FROM card_assignees)`);
    weeks.forEach(([id, w]) => orphans.run(id, w));
    // Two priorities on the same ticket swapping places in a lane swap places in the ticket's activity list too.
    const cardRow = db.prepare('SELECT ticket_id, activity_id FROM priority_cards WHERE id = ?');
    Object.values(lanes).forEach((ids) => {
      const byTicket = new Map();
      ids.map(Number).filter((id) => weekCards.has(id)).map((id) => cardRow.get(id)).filter((c) => c?.activity_id)
        .forEach((c) => byTicket.set(c.ticket_id, [...(byTicket.get(c.ticket_id) || []), c.activity_id]));
      byTicket.forEach((acts, ticketId) => reorderWithin(ticketId, acts));
    });
  })();
  res.json({ cards: weeks.flatMap(([id, w]) => loadCards(id, w)) });
});

export default r;
