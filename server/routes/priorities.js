import { Router } from 'express';
import { db, json } from '../db.js';

const r = Router();

export const PIPELINE_STATUSES = ['Identified', 'Qualified', 'Capture', 'Proposal', 'Submitted', 'Awarded', 'Lost', 'No Bid'];

const localToday = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

/** The check-in date that starts the week containing `iso` for a team's check-in weekday. */
export function weekStartFor(iso, dow) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

const team = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(id);

function loadCards(teamId, weekStart) {
  const cards = db.prepare(`SELECT c.*, t.opportunity_title, t.organization, t.pipeline_status, t.value
    FROM priority_cards c JOIN tickets t ON t.id = c.ticket_id
    WHERE c.team_id = ? AND c.week_start = ? ORDER BY c.id`).all(teamId, weekStart);
  const assignees = db.prepare(`SELECT a.* FROM card_assignees a JOIN priority_cards c ON c.id = a.card_id
    WHERE c.team_id = ? AND c.week_start = ?`).all(teamId, weekStart);
  return cards.map((c) => ({
    ...c,
    checklist: json.parse(c.checklist, []),
    assignees: assignees.filter((a) => a.card_id === c.id).map((a) => ({ user_id: a.user_id, position: a.position })),
  }));
}

function loadCard(id) {
  const c = db.prepare('SELECT team_id, week_start FROM priority_cards WHERE id = ?').get(id);
  return c ? loadCards(c.team_id, c.week_start).find((x) => x.id === Number(id)) : null;
}

r.get('/meta', (req, res) => res.json({ pipelineStatuses: PIPELINE_STATUSES }));

r.get('/', (req, res) => {
  const t = team(req.query.team);
  if (!t) return res.status(400).json({ error: 'Unknown team' });
  const weekStart = weekStartFor(req.query.week || localToday(), t.checkin_dow);
  const members = db.prepare(`SELECT id, first_name, last_name, username, title FROM users
    WHERE team_id = ? AND active = 1 ORDER BY last_name, first_name`).all(t.id);
  res.json({
    team: t,
    weekStart,
    currentWeekStart: weekStartFor(localToday(), t.checkin_dow),
    members,
    cards: loadCards(t.id, weekStart),
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

function ticketFields(t = {}) {
  return {
    opportunity_title: String(t.opportunity_title || '').trim(),
    organization: t.organization?.trim() || null,
    pipeline_status: PIPELINE_STATUSES.includes(t.pipeline_status) ? t.pipeline_status : null,
    value: t.value === '' || t.value == null ? null : Number(t.value),
  };
}

function cardFields(b = {}) {
  return {
    title: b.title?.trim() || null,
    due_date: b.due_date || null,
    checklist: json.str(Array.isArray(b.checklist) ? b.checklist.map((i) => ({ text: String(i.text || ''), done: !!i.done })) : []),
    notes: b.notes || null,
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
          pipeline_status=@pipeline_status, value=@value, updated_at=datetime('now') WHERE id=@id`).run({ ...tf, id: ticketId });
      }
    } else {
      const tf = ticketFields(b.ticket);
      if (!tf.opportunity_title) throw new Error('Opportunity Title is required');
      ticketId = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, value, created_by)
        VALUES (@opportunity_title, @organization, @pipeline_status, @value, @created_by)`).run({ ...tf, created_by: req.user.id }).lastInsertRowid;
    }
    // Cards created on or before the check-in day are the week's planned priorities;
    // anything added after that is flagged as new (unplanned) work.
    const isPlanned = localToday() <= weekStart ? 1 : 0;
    const cardId = db.prepare(`INSERT INTO priority_cards (ticket_id, team_id, week_start, title, due_date, checklist, notes, completed, is_planned, created_by)
      VALUES (@ticket_id, @team_id, @week_start, @title, @due_date, @checklist, @notes, @completed, @is_planned, @created_by)`)
      .run({ ...cardFields(b), ticket_id: ticketId, team_id: t.id, week_start: weekStart, is_planned: isPlanned, created_by: req.user.id }).lastInsertRowid;
    setAssignees(cardId, assignees, t.id, weekStart);
    return cardId;
  });

  try {
    res.json({ card: loadCard(create()) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

r.put('/cards/:id', (req, res) => {
  const b = req.body || {};
  const card = db.prepare('SELECT * FROM priority_cards WHERE id = ?').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Not found' });
  const tf = ticketFields(b.ticket);
  if (b.ticket && !tf.opportunity_title) return res.status(400).json({ error: 'Opportunity Title is required' });
  db.transaction(() => {
    db.prepare(`UPDATE priority_cards SET title=@title, due_date=@due_date, checklist=@checklist, notes=@notes,
      completed=@completed, updated_at=datetime('now') WHERE id=@id`).run({ ...cardFields(b), id: card.id });
    if (b.ticket) {
      db.prepare(`UPDATE tickets SET opportunity_title=@opportunity_title, organization=@organization,
        pipeline_status=@pipeline_status, value=@value, updated_at=datetime('now') WHERE id=@id`).run({ ...tf, id: card.ticket_id });
    }
    if (Array.isArray(b.assignees) && b.assignees.length) setAssignees(card.id, b.assignees, card.team_id, card.week_start);
  })();
  res.json({ card: loadCard(card.id) });
});

r.delete('/cards/:id', (req, res) => {
  db.prepare('DELETE FROM priority_cards WHERE id = ?').run(req.params.id);
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
