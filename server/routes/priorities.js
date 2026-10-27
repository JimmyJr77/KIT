import { Router } from 'express';
import { db, json } from '../db.js';
import { loadThreads } from './tickets.js';
import { recordWork, loadWorkLog } from '../worklog.js';
import { notifyMentions } from '../mentions.js';

const r = Router();

export const PIPELINE_STATUSES = ['Identified', 'Qualified', 'Capture', 'Proposal', 'Submitted', 'Awarded', 'Lost', 'No Bid'];
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

function loadCards(teamId, weekStart) {
  const cards = db.prepare(`SELECT c.*, t.opportunity_title, t.organization, t.pipeline_status, t.account_type, t.value, t.ticket_type
    FROM priority_cards c JOIN tickets t ON t.id = c.ticket_id
    WHERE c.team_id = ? AND c.week_start = ? ORDER BY c.id`).all(teamId, weekStart);
  const assignees = db.prepare(`SELECT a.* FROM card_assignees a JOIN priority_cards c ON c.id = a.card_id
    WHERE c.team_id = ? AND c.week_start = ?`).all(teamId, weekStart);
  const notes = db.prepare(`SELECT n.*, u.first_name, u.last_name FROM card_notes n
    JOIN priority_cards c ON c.id = n.card_id LEFT JOIN users u ON u.id = n.author_id
    WHERE c.team_id = ? AND c.week_start = ? ORDER BY n.created_at DESC, n.id DESC`).all(teamId, weekStart);
  return cards.map((c) => ({
    ...c,
    checklist: json.parse(c.checklist, []),
    notes: notes.filter((n) => n.card_id === c.id).map(noteOut),
    assignees: assignees.filter((a) => a.card_id === c.id).map((a) => ({ user_id: a.user_id, position: a.position })),
  }));
}

const noteOut = (n) => ({
  id: n.id, body: n.body, author_id: n.author_id, created_at: n.created_at, updated_at: n.updated_at,
  author: n.first_name ? { first_name: n.first_name, last_name: n.last_name } : null,
});

function loadNote(id) {
  const n = db.prepare('SELECT n.*, u.first_name, u.last_name FROM card_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.id = ?').get(id);
  return n && noteOut(n);
}

function loadCard(id) {
  const c = db.prepare('SELECT team_id, week_start FROM priority_cards WHERE id = ?').get(id);
  return c ? loadCards(c.team_id, c.week_start).find((x) => x.id === Number(id)) : null;
}

r.get('/meta', (req, res) => res.json({ pipelineStatuses: PIPELINE_STATUSES, accountTypes: ACCOUNT_TYPES }));

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
  const members = db.prepare(`SELECT u.id, u.first_name, u.last_name, u.username, u.title, u.team_id, t.name AS team_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id WHERE u.active = 1 ORDER BY u.last_name, u.first_name`).all();
  const weeks = Object.entries(teamWeeks).map(([id, week]) => [Number(id), week]);
  return { team: { id: 'all', name: 'All' }, weekStart, currentWeekStart, teamWeeks, members, cards, work, threads: threadsFor(cards), planning: planningFor(weeks) };
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
  db.transaction(() => weeks.forEach(([id, w]) => (closed ? close.run(id, w, req.user.id) : open.run(id, w))))();
  res.json({ planning: planningFor(weeks) });
});

const threadsFor = (cards) => loadThreads([...new Set(cards.map((c) => c.ticket_id))]);

r.get('/', (req, res) => {
  if (req.query.team === 'all') return res.json(allTeamsBoard(req.query.week || localToday()));
  const t = team(req.query.team);
  if (!t) return res.status(400).json({ error: 'Unknown team' });
  const weekStart = weekStartFor(req.query.week || localToday(), t.checkin_dow);
  const members = db.prepare(`SELECT id, first_name, last_name, username, title FROM users
    WHERE team_id = ? AND active = 1 ORDER BY last_name, first_name`).all(t.id);
  const cards = loadCards(t.id, weekStart);
  res.json({
    team: t,
    weekStart,
    currentWeekStart: weekStartFor(localToday(), t.checkin_dow),
    members,
    cards,
    work: loadWorkLog(t.id, weekStart),
    threads: threadsFor(cards),
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
    WHERE t.opportunity_title LIKE ? OR t.organization LIKE ?
    GROUP BY t.id ORDER BY ${sort} ${dir} LIMIT 200`).all(q, q);
  res.json({ tickets: rows });
});

export function ticketFields(t = {}) {
  return {
    opportunity_title: String(t.opportunity_title || '').trim(),
    organization: t.organization?.trim() || null,
    pipeline_status: PIPELINE_STATUSES.includes(t.pipeline_status) ? t.pipeline_status : null,
    account_type: ACCOUNT_TYPES.includes(t.account_type) ? t.account_type : null,
    value: t.value === '' || t.value == null ? null : Number(t.value),
  };
}

function cardFields(b = {}) {
  return {
    title: b.title?.trim() || null,
    due_date: b.due_date || null,
    checklist: json.str(Array.isArray(b.checklist) ? b.checklist.map((i) => ({ text: String(i.text || ''), done: !!i.done })) : []),
    completed: b.completed ? 1 : 0,
  };
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
          pipeline_status=CASE WHEN ticket_type = 'work' THEN NULL ELSE @pipeline_status END, account_type=@account_type,
          value=CASE WHEN ticket_type = 'work' THEN NULL ELSE @value END, updated_at=datetime('now') WHERE id=@id`).run({ ...tf, id: ticketId });
      }
    } else {
      const tf = ticketFields(b.ticket);
      if (!tf.opportunity_title) throw new Error('Opportunity Title is required');
      // The ticket type is chosen once, when the ticket is created. Work tickets have no value or pipeline status.
      const ticketType = b.ticket?.ticket_type === 'work' ? 'work' : 'bid';
      const fields = ticketType === 'work' ? { ...tf, pipeline_status: null, value: null } : tf;
      ticketId = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, account_type, value, ticket_type, created_by)
        VALUES (@opportunity_title, @organization, @pipeline_status, @account_type, @value, @ticket_type, @created_by)`).run({ ...fields, ticket_type: ticketType, created_by: req.user.id }).lastInsertRowid;
    }
    // Cards added while the week's planning is open are priorities; once planning
    // is closed, new cards are work tickets (accomplishments and new tasks).
    const isPlanned = planningClosed(t.id, weekStart) ? 0 : 1;
    const cardId = db.prepare(`INSERT INTO priority_cards (ticket_id, team_id, week_start, title, due_date, checklist, completed, is_planned, created_by)
      VALUES (@ticket_id, @team_id, @week_start, @title, @due_date, @checklist, @completed, @is_planned, @created_by)`)
      .run({ ...cardFields(b), ticket_id: ticketId, team_id: t.id, week_start: weekStart, is_planned: isPlanned, created_by: req.user.id }).lastInsertRowid;
    setAssignees(cardId, assignees, t.id, weekStart);
    // Notes written before the card existed, oldest first so the newest stays on top.
    const addNote = db.prepare('INSERT INTO card_notes (card_id, body, author_id) VALUES (?, ?, ?)');
    (Array.isArray(b.new_notes) ? b.new_notes : []).map((n) => String(n || '').trim()).filter(Boolean).reverse()
      .forEach((body) => addNote.run(cardId, body, req.user.id));
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
    db.prepare(`UPDATE priority_cards SET title=@title, due_date=@due_date, checklist=@checklist,
      completed=@completed, updated_at=datetime('now') WHERE id=@id`).run({ ...cardFields(b), id: card.id });
    if (b.ticket) {
      db.prepare(`UPDATE tickets SET opportunity_title=@opportunity_title, organization=@organization,
        pipeline_status=CASE WHEN ticket_type = 'work' THEN NULL ELSE @pipeline_status END, account_type=@account_type,
        value=CASE WHEN ticket_type = 'work' THEN NULL ELSE @value END, updated_at=datetime('now') WHERE id=@id`).run({ ...tf, id: card.ticket_id });
    }
    if (Array.isArray(b.assignees) && b.assignees.length) setAssignees(card.id, b.assignees, card.team_id, card.week_start);
  })();
  const wasDone = new Set(json.parse(card.checklist, []).filter((i) => i.done).map((i) => i.text));
  json.parse(cardFields(b).checklist, []).filter((i) => i.done && !wasDone.has(i.text))
    .forEach((i) => recordWork(req.user, { kind: 'task', ticket_id: card.ticket_id, card_id: card.id, summary: i.text }));
  if (b.completed && !card.completed) recordWork(req.user, { kind: 'completed', ticket_id: card.ticket_id, card_id: card.id, summary: card.title });
  res.json({ card: loadCard(card.id) });
});

/** Check or uncheck one task. It moves to the end of the list, so newly finished tasks sink to the bottom. */
r.put('/cards/:id/checklist/:index', (req, res) => {
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const list = json.parse(card.checklist, []);
  const i = Number(req.params.index);
  if (!list[i]) return res.status(400).json({ error: 'Task not found' });
  const [item] = list.splice(i, 1);
  list.push({ ...item, done: !!req.body?.done });
  db.prepare("UPDATE priority_cards SET checklist = ?, updated_at = datetime('now') WHERE id = ?").run(json.str(list), card.id);
  if (req.body?.done && !item.done) recordWork(req.user, { kind: 'task', ticket_id: card.ticket_id, card_id: card.id, summary: item.text });
  res.json({ card: loadCard(card.id) });
});

r.delete('/cards/:id', (req, res) => {
  db.prepare('DELETE FROM priority_cards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Notes (each one a separate entry; only its author or an admin may change it)

r.post('/cards/:id/notes', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Note is empty' });
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const id = db.prepare('INSERT INTO card_notes (card_id, body, author_id) VALUES (?, ?, ?)').run(card.id, body, req.user.id).lastInsertRowid;
  recordWork(req.user, { kind: 'note', ticket_id: card.ticket_id, card_id: card.id, ref_id: id, summary: body });
  notifyMentions(req.user, body, { ticket_id: card.ticket_id, card_id: card.id, note_id: id });
  res.json({ note: loadNote(id) });
});

function ownNote(req, res) {
  const n = db.prepare('SELECT * FROM card_notes WHERE id = ?').get(req.params.id);
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
    db.prepare("UPDATE card_notes SET body = ?, updated_at = datetime('now') WHERE id = ?").run(body, n.id);
    const c = db.prepare('SELECT ticket_id FROM priority_cards WHERE id = ?').get(n.card_id);
    notifyMentions(req.user, body, { ticket_id: c?.ticket_id, card_id: n.card_id, note_id: n.id }, n.body);
  }
  res.json({ note: loadNote(n.id) });
});

r.delete('/notes/:id', (req, res) => {
  const n = ownNote(req, res);
  if (!n) return;
  db.prepare('DELETE FROM card_notes WHERE id = ?').run(n.id);
  db.prepare("DELETE FROM work_log WHERE kind = 'note' AND ref_id = ?").run(n.id);
  res.json({ ok: true });
});

/**
 * Persist drag-and-drop ordering. Body: { team_id, week_start, lanes: { [userId]: [cardId, ...] } }.
 * Each listed lane is rewritten in order (index 0 = top priority). Moving a card to
 * another member's lane reassigns it.
 */
r.put('/lanes', (req, res) => {
  const { team_id, week_start, lanes = {} } = req.body || {};
  const weekCards = new Set(db.prepare('SELECT id FROM priority_cards WHERE team_id = ? AND week_start = ?')
    .all(team_id, week_start).map((c) => c.id));
  db.transaction(() => {
    const del = db.prepare(`DELETE FROM card_assignees WHERE user_id = ? AND card_id IN
      (SELECT id FROM priority_cards WHERE team_id = ? AND week_start = ?)`);
    const ins = db.prepare('INSERT OR REPLACE INTO card_assignees (card_id, user_id, position) VALUES (?, ?, ?)');
    for (const [userId, ids] of Object.entries(lanes)) {
      del.run(Number(userId), team_id, week_start);
      ids.map(Number).filter((id) => weekCards.has(id)).forEach((id, i) => ins.run(id, Number(userId), i));
    }
    // A card must always belong to someone; drop any orphaned by the move.
    db.prepare(`DELETE FROM priority_cards WHERE team_id = ? AND week_start = ?
      AND id NOT IN (SELECT card_id FROM card_assignees)`).run(team_id, week_start);
  })();
  res.json({ cards: loadCards(team_id, week_start) });
});

export default r;
