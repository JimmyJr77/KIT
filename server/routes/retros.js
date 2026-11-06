// Retrospectives: a lead opens a board of lanes, everyone posts tickets, thumbs them up and moves them between lanes,
// then the good ones become lessons. People see each other's changes by polling GET /:id.
// Tickets and thumbs are anonymous (see retro_notes in db.js): nothing here may return or store who wrote or voted for one.
import { Router } from 'express';
import { db } from '../db.js';
import { anonKey } from '../auth.js';

const r = Router();

// Each lane is [name, lean]. Lean starts its lessons as Good/Keep or Bad/Change.
const TEMPLATES = [
  { key: 'start_stop_continue', name: 'Start, Stop, Continue', hint: 'The everyday retro.', lanes: [['Start', null], ['Stop', 'bad'], ['Continue', 'good']] },
  { key: 'well_not_ideas', name: 'Went well, Didn’t, Ideas', hint: 'Plain and quick for a mixed group.', lanes: [['Went well', 'good'], ['Didn’t go well', 'bad'], ['Ideas', null]] },
  { key: 'mad_sad_glad', name: 'Mad, Sad, Glad', hint: 'When morale is the real question.', lanes: [['Mad', 'bad'], ['Sad', 'bad'], ['Glad', 'good']] },
  { key: 'hot_wash', name: 'Bid hot wash', hint: 'Right after a win or a loss, while it’s fresh.', lanes: [['Helped us', 'good'], ['Hurt us', 'bad'], ['Surprised us', null]] },
  { key: 'pre_mortem', name: 'Pre-mortem', hint: 'Before a big bid: assume it failed, then say why.', lanes: [['Why it failed', 'bad'], ['Warning signs', 'bad'], ['What we do now', null]] },
  { key: 'blank', name: 'Blank', hint: 'No lanes. Make your own.', lanes: [] },
];
const STAGES = ['brainstorm', 'actions', 'closed'];
const TIMER_MAX = 60 * 60 * 1000; // an hour
const TIMES_UP_FOR = 60 * 1000;   // how long "Time's up" stays on screen after a countdown ends

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const leadOf = (u) => (u.first_name ? `${u.first_name} ${u.last_name}`.trim() : null);

r.get('/', (req, res) => {
  const boards = db.prepare(`SELECT b.id, b.name, b.retro_date, b.template, b.stage, b.created_by, u.first_name, u.last_name,
      (SELECT COUNT(*) FROM retro_notes n WHERE n.board_id = b.id) AS tickets,
      (SELECT COUNT(*) FROM lessons l JOIN retro_notes n ON n.id = l.source_id WHERE l.source = 'retro' AND n.board_id = b.id) AS lessons
    FROM retro_boards b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.retro_date DESC, b.id DESC`).all();
  res.json({
    boards: boards.map(({ first_name, last_name, created_by, ...b }) => ({ ...b, lead: leadOf({ first_name, last_name }), can_delete: req.user.role === 'admin' || created_by === req.user.id })),
    templates: TEMPLATES.map(({ key, name, hint, lanes }) => ({ key, name, hint, lanes: lanes.map(([l]) => l) })),
  });
});

/** Body: { name, retro_date, template, hide_notes }. Whoever opens a retro leads it. */
r.post('/', (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 120);
  if (!name) return res.status(400).json({ error: 'Name the retro' });
  if (!isDate(String(b.retro_date))) return res.status(400).json({ error: 'Choose a retro date' });
  const template = TEMPLATES.find((t) => t.key === b.template);
  if (!template) return res.status(400).json({ error: 'Choose a format' });
  const id = db.transaction(() => {
    const boardId = db.prepare('INSERT INTO retro_boards (name, retro_date, template, hide_notes, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(name, b.retro_date, template.key, b.hide_notes ? 1 : 0, req.user.id).lastInsertRowid;
    const lane = db.prepare('INSERT INTO retro_lanes (board_id, name, lean, position) VALUES (?, ?, ?, ?)');
    template.lanes.forEach(([laneName, lean], i) => lane.run(boardId, laneName, lean, i));
    return boardId;
  })();
  res.json({ id });
});

// Everything below is about one retro.
r.use('/:id', (req, res, next) => {
  req.board = db.prepare('SELECT * FROM retro_boards WHERE id = ?').get(req.params.id);
  if (!req.board) return res.status(404).json({ error: 'That retro is gone' });
  req.lead = req.user.role === 'admin' || req.board.created_by === req.user.id;
  req.key = anonKey(`retro:${req.board.id}`, req.user.id);
  next();
});

const leadOnly = (req, res, next) => (req.lead ? next() : res.status(403).json({ error: 'Only the retro lead can do that' }));
const openBoard = (req, res, next) => (req.board.stage === 'closed' ? res.status(409).json({ error: 'This retro is closed' }) : next());
const brainstorming = (req, res, next) => (req.board.stage === 'brainstorm' ? next() : res.status(409).json({ error: 'Brainstorming has ended' }));

/** The countdown as it stands now: how much is left (0 once it's up) and how long it was set for. Null when there's none. */
function timerOf(board) {
  if (!board.timer_ends_at) return null;
  const left = board.timer_ends_at - Date.now();
  return left > -TIMES_UP_FOR ? { left_ms: Math.max(0, left), total_ms: board.timer_length } : null;
}

/** The board as this person may see it. While tickets are hidden, only their own show. */
function view(board, lead, key) {
  const notes = db.prepare(`SELECT n.*, (SELECT COUNT(*) FROM retro_votes v WHERE v.note_id = n.id) AS votes,
      EXISTS (SELECT 1 FROM retro_votes v WHERE v.note_id = n.id AND v.voter_key = ?) AS voted,
      l.id AS lesson_id
    FROM retro_notes n LEFT JOIN lessons l ON l.source = 'retro' AND l.source_id = n.id
    WHERE n.board_id = ? ORDER BY n.id`).all(key, board.id);
  const person = db.prepare('SELECT first_name, last_name FROM users WHERE id = ?').get(board.created_by);
  return {
    board: { id: board.id, name: board.name, retro_date: board.retro_date, template: board.template, stage: board.stage, hide_notes: board.hide_notes, lead: person ? leadOf(person) : null, timer: timerOf(board) },
    is_lead: lead,
    lanes: db.prepare('SELECT id, name, lean FROM retro_lanes WHERE board_id = ? ORDER BY position, id').all(board.id),
    notes: notes.map((n) => {
      const mine = n.author_key === key;
      const hidden = !!board.hide_notes && !mine;
      return {
        id: n.id, lane_id: n.lane_id, mine, hidden, text: hidden ? null : n.text, lesson_id: n.lesson_id,
        votes: board.hide_notes ? 0 : n.votes, voted: !hidden && !!n.voted,
      };
    }),
  };
}
const send = (req, res) => {
  const board = db.prepare('SELECT * FROM retro_boards WHERE id = ?').get(req.board.id);
  res.json(view(board, req.lead, req.key));
};

r.get('/:id', send);

/** Lead. Body: any of { name, retro_date, stage, reveal }. Leaving brainstorming reveals everything. */
r.put('/:id', leadOnly, (req, res) => {
  const b = req.body || {};
  const name = b.name === undefined ? req.board.name : text(b.name, 120);
  if (!name) return res.status(400).json({ error: 'Name the retro' });
  const date = b.retro_date ?? req.board.retro_date;
  if (!isDate(String(date))) return res.status(400).json({ error: 'Choose a retro date' });
  const stage = b.stage ?? req.board.stage;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'That isn’t a retro stage' });
  const hide = b.reveal || stage !== 'brainstorm' ? 0 : req.board.hide_notes;
  db.prepare('UPDATE retro_boards SET name = ?, retro_date = ?, stage = ?, hide_notes = ? WHERE id = ?').run(name, date, stage, hide, req.board.id);
  if (stage !== req.board.stage) db.prepare('UPDATE retro_boards SET timer_ends_at = NULL, timer_length = NULL WHERE id = ?').run(req.board.id); // a new stage, a fresh clock
  send(req, res);
});

// ---- Countdown (lead). Everyone sees it on their next poll.

/** Body: { seconds }. Starts a countdown, replacing any that's running. */
r.post('/:id/timer', leadOnly, openBoard, (req, res) => {
  const ms = Math.round(Number(req.body?.seconds) * 1000);
  if (!(ms > 0) || ms > TIMER_MAX) return res.status(400).json({ error: 'Set the timer between a second and an hour' });
  db.prepare('UPDATE retro_boards SET timer_ends_at = ?, timer_length = ? WHERE id = ?').run(Date.now() + ms, ms, req.board.id);
  send(req, res);
});

/** Body: { seconds }. Adds time to the running countdown, or to one that's just ended. */
r.put('/:id/timer', leadOnly, openBoard, (req, res) => {
  const ms = Math.round(Number(req.body?.seconds) * 1000);
  if (!(ms > 0)) return res.status(400).json({ error: 'Say how much time to add' });
  if (!timerOf(req.board)) return res.status(409).json({ error: 'No timer is running' });
  const from = Math.max(req.board.timer_ends_at, Date.now());
  if (from + ms - Date.now() > TIMER_MAX) return res.status(400).json({ error: 'The timer can’t run past an hour' });
  db.prepare('UPDATE retro_boards SET timer_ends_at = ?, timer_length = timer_length + ? WHERE id = ?').run(from + ms, ms, req.board.id);
  send(req, res);
});

/** Stops the countdown, or clears "Time's up". */
r.delete('/:id/timer', leadOnly, (req, res) => {
  db.prepare('UPDATE retro_boards SET timer_ends_at = NULL, timer_length = NULL WHERE id = ?').run(req.board.id);
  send(req, res);
});

/** Lead. Lessons already made from this retro stay. */
r.delete('/:id', leadOnly, (req, res) => {
  db.prepare('DELETE FROM retro_boards WHERE id = ?').run(req.board.id);
  res.json({ ok: true });
});

// ---- Lanes (lead)

const laneOf = (req, res, next) => {
  req.lane = db.prepare('SELECT * FROM retro_lanes WHERE id = ? AND board_id = ?').get(req.params.laneId, req.board.id);
  return req.lane ? next() : res.status(404).json({ error: 'That lane is gone' });
};

r.post('/:id/lanes', leadOnly, openBoard, (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Name the lane' });
  const { next } = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM retro_lanes WHERE board_id = ?').get(req.board.id);
  db.prepare('INSERT INTO retro_lanes (board_id, name, position) VALUES (?, ?, ?)').run(req.board.id, name, next);
  send(req, res);
});

r.put('/:id/lanes/:laneId', leadOnly, openBoard, laneOf, (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) return res.status(400).json({ error: 'Name the lane' });
  db.prepare('UPDATE retro_lanes SET name = ? WHERE id = ?').run(name, req.lane.id);
  send(req, res);
});

/** Takes its tickets with it. Lessons already made from them stay. */
r.delete('/:id/lanes/:laneId', leadOnly, openBoard, laneOf, (req, res) => {
  db.prepare('DELETE FROM retro_lanes WHERE id = ?').run(req.lane.id);
  send(req, res);
});

// ---- Tickets

const noteOf = (req, res, next) => {
  req.note = db.prepare('SELECT * FROM retro_notes WHERE id = ? AND board_id = ?').get(req.params.noteId, req.board.id);
  if (!req.note) return res.status(404).json({ error: 'That ticket is gone' });
  req.mine = req.note.author_key === req.key;
  // A hidden ticket can't be read, so it can't be judged: nobody else acts on it, the lead included.
  return req.board.hide_notes && !req.mine ? res.status(403).json({ error: 'That ticket is hidden until the lead reveals it' }) : next();
};

/** Body: { lane_id, text }. */
r.post('/:id/notes', brainstorming, (req, res) => {
  const body = text(req.body?.text, 500);
  if (!body) return res.status(400).json({ error: 'Write something first' });
  const lane = db.prepare('SELECT id FROM retro_lanes WHERE id = ? AND board_id = ?').get(req.body?.lane_id, req.board.id);
  if (!lane) return res.status(404).json({ error: 'That lane is gone' });
  db.prepare('INSERT INTO retro_notes (board_id, lane_id, text, author_key) VALUES (?, ?, ?, ?)').run(req.board.id, lane.id, body, req.key);
  send(req, res);
});

/** Body: { lane_id } moves it, anyone may. { text } rewords it, its author only. */
r.put('/:id/notes/:noteId', brainstorming, noteOf, (req, res) => {
  const b = req.body || {};
  if (b.lane_id !== undefined) {
    const lane = db.prepare('SELECT id FROM retro_lanes WHERE id = ? AND board_id = ?').get(b.lane_id, req.board.id);
    if (!lane) return res.status(404).json({ error: 'That lane is gone' });
    db.prepare('UPDATE retro_notes SET lane_id = ? WHERE id = ?').run(lane.id, req.note.id);
  }
  if (b.text !== undefined) {
    if (!req.mine) return res.status(403).json({ error: 'Only its author can reword a ticket' });
    const body = text(b.text, 500);
    if (!body) return res.status(400).json({ error: 'Write something first' });
    db.prepare('UPDATE retro_notes SET text = ? WHERE id = ?').run(body, req.note.id);
  }
  send(req, res);
});

/** Its author while brainstorming, or the lead until the retro closes. Lessons already made from it stay. */
r.delete('/:id/notes/:noteId', openBoard, noteOf, (req, res) => {
  if (!req.lead && !(req.mine && req.board.stage === 'brainstorm')) return res.status(403).json({ error: 'Only its author or the retro lead can delete a ticket' });
  db.prepare('DELETE FROM retro_notes WHERE id = ?').run(req.note.id);
  send(req, res);
});

/** Thumbs up, or take it back. One each per ticket. */
r.post('/:id/notes/:noteId/vote', brainstorming, noteOf, (req, res) => {
  const { changes } = db.prepare('DELETE FROM retro_votes WHERE note_id = ? AND voter_key = ?').run(req.note.id, req.key);
  if (!changes) db.prepare('INSERT INTO retro_votes (note_id, voter_key) VALUES (?, ?)').run(req.note.id, req.key);
  send(req, res);
});

export default r;
