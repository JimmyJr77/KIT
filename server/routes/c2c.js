// Close to closing (C2C): the BD Pipeline's list of deals near a decision. Every open pipeline ticket in Under Evaluation
// (or a stage reports count as Under Evaluation) joins the list on its own; any other pipeline ticket can be added by hand.
// Anyone can take a ticket off the list: it comes back when it moves into Under Evaluation again, or when it's added again.
// Once on the list a ticket stays when its deal closes: its category then reads from the deal (Awarded, Paid (Won),
// Closed - Not awarded) instead of its stage, and a paid or closed deal's status is Closed. Notes are the ticket's own
// comments and notes.
import { Router } from 'express';
import { db, json } from '../db.js';
import { reportStager } from '../pipelines.js';
import { termFromFields, isTermField, TERM_FIELD_NAME } from '../compensation.js';
import { fieldByName } from '../services/pipedriveFields.js';
import { recordTicketUpdate } from '../worklog.js';
import { canEditTicket } from '../../src/lib/ticketAccess.js';
import { ticketEditDenied } from './tickets.js';
import { gateFlagger } from '../staffing.js';
import { openStrategies } from '../strategy.js';

const r = Router();

/** The standings someone sets by hand, while the deal is open. */
const SET_STATUSES = ['on_track', 'off_up', 'off_steady', 'off_down'];
/** How someone expects the deal to come out, set by hand while it's open. */
const EXPECTATIONS = ['win', 'tossup', 'loss'];
const EVALUATION = 'Under Evaluation';
/** The stages the import offers: a ticket in either can be brought onto the list, or left off it, from one screen. */
const IMPORT_STAGES = ['Under Evaluation', 'Proposal'];
const LISTABLE = "t.ticket_type = 'bid' AND t.archive_set_id IS NULL AND t.archived_at IS NULL";

/** The stage a ticket is in, as kept against one taken off the list. */
const stageKey = (t) => `${t.pipeline_id ?? ''}:${t.pipeline_status ?? ''}`;
const RESTORE = 'UPDATE c2c_tickets SET removed_at = NULL, removed_stage = NULL';

/**
 * Put every open ticket now in Under Evaluation on the list. One taken off the list comes back on its own only by moving
 * into Under Evaluation after it was taken off: from another stage it was removed in, or having left Under Evaluation and
 * returned (its history shows a stage outside it since). Anything else is added back by hand.
 */
function addEvaluating() {
  const stage = reportStager();
  const evaluating = (t) => t.deal_status === 'open' && t.pipeline_status != null && stage.of(t.pipeline_id, t.pipeline_status) === EVALUATION;
  const add = db.prepare('INSERT OR IGNORE INTO c2c_tickets (ticket_id) VALUES (?)');
  db.prepare(`SELECT t.id, t.pipeline_id, t.pipeline_status, t.deal_status FROM tickets t
    WHERE ${LISTABLE} AND t.deal_status = 'open' AND t.pipeline_status IS NOT NULL AND t.id NOT IN (SELECT ticket_id FROM c2c_tickets)`).all()
    .filter(evaluating).forEach((t) => add.run(t.id));
  const restore = db.prepare(`${RESTORE} WHERE ticket_id = ?`);
  const since = db.prepare('SELECT DISTINCT pipeline_status FROM ticket_history WHERE ticket_id = ? AND changed_at >= ? AND pipeline_status IS NOT NULL');
  db.prepare(`SELECT t.id, t.pipeline_id, t.pipeline_status, t.deal_status, c.removed_stage, c.removed_at FROM c2c_tickets c JOIN tickets t ON t.id = c.ticket_id
    WHERE c.removed_at IS NOT NULL AND ${LISTABLE}`).all().filter(evaluating).forEach((t) => {
    // The stage it was taken off in is kept as "<pipeline id>:<stage>"; none kept means it had already left that stage.
    const at = t.removed_stage == null ? null : t.removed_stage.slice(t.removed_stage.indexOf(':') + 1);
    const removedEvaluating = at != null && stage.of(t.pipeline_id, at) === EVALUATION;
    if (!removedEvaluating || since.all(t.id, t.removed_at).some((h) => stage.of(t.pipeline_id, h.pipeline_status) !== EVALUATION)) restore.run(t.id);
  });
}

/** Where the deal itself says the ticket has got to (shown as its category), or null while it's still in a stage. */
const dealOutcome = (t) => (t.deal_status === 'won' ? 'paid' : t.deal_status === 'lost' ? 'closed' : t.pipeline_status === 'Awarded' ? 'awarded' : null);

/** The notes picked for a row: note_ids, or the single note_id of a row picked before there could be several. */
const pickedIds = (c) => { const ids = json.parse(c.note_ids, null); return Array.isArray(ids) ? ids.map(Number) : c.note_id ? [c.note_id] : []; };

function list(user) {
  addEvaluating();
  const stage = reportStager();
  const rows = db.prepare(`SELECT c.status AS c_status, c.expectation AS c_expectation, c.note_id, c.note_ids, c.created_at AS added_at, t.*, o.first_name AS owner_first_name, o.last_name AS owner_last_name
    FROM c2c_tickets c JOIN tickets t ON t.id = c.ticket_id LEFT JOIN users o ON o.id = t.created_by WHERE c.removed_at IS NULL AND ${LISTABLE}`).all();
  // "My tickets", as on the board: ones this person owns, directs, or has a priority card on.
  const carded = new Set(db.prepare(`SELECT DISTINCT c.ticket_id FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id
    WHERE a.user_id = ? AND c.ticket_id IN (SELECT ticket_id FROM c2c_tickets)`).all(user.id).map((x) => x.ticket_id));
  const notes = new Map();
  if (rows.length) {
    db.prepare(`SELECT m.id, m.ticket_id, m.body, m.kind, m.created_at, m.updated_at, m.author_id, u.first_name, u.last_name
      FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.parent_id IS NULL AND m.kind IN ('comment', 'note') AND (m.target_type IS NULL OR m.target_type IN ('activity', 'subtask'))
        AND m.ticket_id IN (SELECT ticket_id FROM c2c_tickets)
      ORDER BY m.created_at DESC, m.id DESC`).all().forEach((m) => {
      if (!notes.has(m.ticket_id)) notes.set(m.ticket_id, []);
      notes.get(m.ticket_id).push({ id: m.id, body: m.body, created_at: m.created_at, updated_at: m.updated_at ?? null,
        author: m.first_name ? { id: m.author_id, first_name: m.first_name, last_name: m.last_name } : null, mine: m.author_id === user.id });
    });
  }
  const gateFlags = gateFlagger();
  const strategies = openStrategies(); // each ticket's open obstacles with their strategies: part of its status note
  return rows.map((t) => {
    const term = termFromFields(t.custom_fields);
    const mine = notes.get(t.id) || [];
    const outcome = dealOutcome(t);
    return {
      ticket_id: t.id, title: t.opportunity_title, organization: t.organization, value: t.value, currency: t.currency,
      stage: t.pipeline_status, close_date: t.win_date_undetermined ? null : t.projected_win_date,
      term_months: term.months, term_text: term.text, labels: json.parse(t.labels, []), ...gateFlags(t), added_at: t.added_at,
      outcome, closed: outcome === 'paid' || outcome === 'closed',
      status: SET_STATUSES.includes(t.c_status) ? t.c_status : null,
      expectation: EXPECTATIONS.includes(t.c_expectation) ? t.c_expectation : null,
      evaluating: t.deal_status === 'open' && stage.of(t.pipeline_id, t.pipeline_status) === EVALUATION,
      owner: t.owner_first_name ? { id: t.created_by, first_name: t.owner_first_name, last_name: t.owner_last_name } : null,
      can_edit: canEditTicket(user, t), territory_id: t.territory_id,
      mine: t.created_by === user.id || t.bd_director_id === user.id || carded.has(t.id),
      strategies: strategies.get(t.id) || [],
      notes: mine, note_ids: pickedIds(t).filter((id) => mine.some((n) => n.id === id)),
    };
  });
}

/** The list, and whether this person adds from anyone's tickets. */
const page = (user) => ({ rows: list(user), anyone: importsForAnyone(user) });

r.get('/', (req, res) => res.json(page(req.user)));

/** Body: { ticket_id }. Adds a pipeline ticket of this person's (anyone's, for an admin or a BD lead) to the list, or puts back one that was taken off. */
r.post('/', (req, res) => {
  const t = db.prepare(`SELECT t.id FROM tickets t WHERE t.id = ? AND ${LISTABLE}`).get(Number(req.body?.ticket_id) || 0);
  if (!t) return res.status(400).json({ error: 'Pick a pipeline ticket that isn’t archived' });
  if (!importable(req.user).has(t.id)) return res.status(403).json({ error: 'Only the ticket’s owner or BD director, a BD lead or an admin adds it to this list' });
  db.prepare('INSERT OR IGNORE INTO c2c_tickets (ticket_id, added_by) VALUES (?, ?)').run(t.id, req.user.id);
  db.prepare(`${RESTORE} WHERE ticket_id = ? AND removed_at IS NOT NULL`).run(t.id);
  res.json(page(req.user));
});

/** Admins and the BD team's leads import from anyone's tickets; everyone else from the ones they own or direct. */
const importsForAnyone = (user) => user.role === 'admin'
  || !!db.prepare("SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD' AND ut.role = 'lead'").get(user.id);

/**
 * Every pipeline ticket this person can put on the list, by id: the ones they own or direct (anyone's, for an admin or a
 * BD lead), whatever stage they're in. `offered` marks the open ones in Proposal or Under Evaluation (or a stage reports
 * count as one), which the import lists before anything is searched for.
 */
function importable(user) {
  const stage = reportStager();
  const anyone = importsForAnyone(user);
  const rows = db.prepare(`SELECT t.id, t.opportunity_title, t.organization, t.value, t.pipeline_id, t.pipeline_status, t.deal_status, t.projected_win_date, t.win_date_undetermined,
      t.created_by, t.bd_director_id, o.first_name AS owner_first_name, o.last_name AS owner_last_name, d.first_name AS director_first_name, d.last_name AS director_last_name,
      (c.ticket_id IS NOT NULL AND c.removed_at IS NULL) AS on_list
    FROM tickets t LEFT JOIN users o ON o.id = t.created_by LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN c2c_tickets c ON c.ticket_id = t.id
    WHERE ${LISTABLE} AND (@anyone = 1 OR t.created_by = @me OR t.bd_director_id = @me)`)
    .all({ anyone: anyone ? 1 : 0, me: user.id });
  const person = (id, first, last) => (id && first ? { id, first_name: first, last_name: last } : null);
  return new Map(rows.map((t) => {
    const reported = t.pipeline_status == null ? null : stage.of(t.pipeline_id, t.pipeline_status);
    return [t.id, {
      ticket_id: t.id, title: t.opportunity_title, organization: t.organization, value: t.value, stage: reported, stage_name: t.pipeline_status, outcome: dealOutcome(t),
      offered: t.deal_status === 'open' && IMPORT_STAGES.includes(reported),
      close_date: t.win_date_undetermined ? null : t.projected_win_date, on_list: !!t.on_list,
      owner: person(t.created_by, t.owner_first_name, t.owner_last_name), director: person(t.bd_director_id, t.director_first_name, t.director_last_name),
      removed_stage: stageKey(t),
    }];
  }));
}

/** What the import shows: every ticket this person can pick from, and whether each is on the list. */
r.get('/import', (req, res) => {
  addEvaluating();
  res.json({ anyone: importsForAnyone(req.user), tickets: [...importable(req.user).values()].map(({ removed_stage, ...t }) => t) });
});

/**
 * Body: { add: [ticket ids], hide: [ticket ids] }. Puts the first on the list and takes the second off it, as the X on a
 * row does. Only tickets the import offers this person count.
 */
r.post('/import', (req, res) => {
  const mine = importable(req.user);
  const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(Number).filter(Boolean))];
  const add = ids(req.body?.add);
  const hide = ids(req.body?.hide).filter((id) => !add.includes(id));
  if ([...add, ...hide].some((id) => !mine.has(id))) return res.status(400).json({ error: 'One of those tickets isn’t yours to import, or has been archived. Open the import again.' });
  db.transaction(() => {
    add.forEach((id) => {
      db.prepare('INSERT OR IGNORE INTO c2c_tickets (ticket_id, added_by) VALUES (?, ?)').run(id, req.user.id);
      db.prepare(`${RESTORE} WHERE ticket_id = ? AND removed_at IS NOT NULL`).run(id);
    });
    hide.forEach((id) => db.prepare("UPDATE c2c_tickets SET removed_at = datetime('now'), removed_stage = ? WHERE ticket_id = ? AND removed_at IS NULL").run(mine.get(id).removed_stage, id));
  })();
  res.json(page(req.user));
});

const entry = (id) => db.prepare('SELECT c.*, t.created_by, t.ticket_type, t.pipeline_id, t.pipeline_status FROM c2c_tickets c JOIN tickets t ON t.id = c.ticket_id WHERE c.ticket_id = ? AND c.removed_at IS NULL').get(Number(id) || 0);

/**
 * Set the ticket's contract term: its Expected Contract Term field (Pipedrive's, when the deal has one), as the text
 * typed ("12 months", "1 base + 4 option years"). Empty clears it.
 */
function setDuration(user, ticketId, text) {
  const t = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
  const value = String(text ?? '').trim().slice(0, 200);
  const fields = json.parse(t.custom_fields, []);
  const at = fields.findIndex((f) => isTermField(f.name));
  if ((at >= 0 ? fields[at].value || '' : '') === value) return;
  if (at >= 0 && value) fields[at] = { ...fields[at], value };
  else if (at >= 0) fields.splice(at, 1);
  else {
    const known = fieldByName('deal', TERM_FIELD_NAME); // Pipedrive's own field keeps its key, so the change is synced
    fields.push({ ...(known ? { key: known.key } : {}), name: TERM_FIELD_NAME, value });
  }
  db.prepare("UPDATE tickets SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?").run(json.str(fields), t.id);
  recordTicketUpdate(user, t, 'Details');
}

/**
 * Body: any of status (one of the standings, or null to clear it), expectation (win, tossup or loss, or null to clear
 * it), duration (the ticket's contract term, as text) and note_ids (the notes the row shows, none for the latest). Status,
 * expectation and duration are the ticket owner's or an admin's to set; anyone picks the note.
 */
r.put('/:ticketId', (req, res) => {
  const c = entry(req.params.ticketId);
  if (!c) return res.status(404).json({ error: 'That ticket isn’t on the list' });
  const b = req.body || {};
  if ('status' in b || 'expectation' in b || 'duration' in b) {
    const denied = ticketEditDenied(req.user, { id: c.ticket_id, created_by: c.created_by, ticket_type: c.ticket_type });
    if (denied) return res.status(403).json({ error: denied });
  }
  if ('duration' in b) setDuration(req.user, c.ticket_id, b.duration);
  if ('status' in b) {
    if (b.status != null && !SET_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
    if (['won', 'lost'].includes(db.prepare('SELECT deal_status FROM tickets WHERE id = ?').get(c.ticket_id)?.deal_status)) return res.status(400).json({ error: 'This deal is closed' });
    db.prepare('UPDATE c2c_tickets SET status = ? WHERE ticket_id = ?').run(b.status ?? null, c.ticket_id);
  }
  if ('expectation' in b) {
    if (b.expectation != null && !EXPECTATIONS.includes(b.expectation)) return res.status(400).json({ error: 'Unknown expectation' });
    if (['won', 'lost'].includes(db.prepare('SELECT deal_status FROM tickets WHERE id = ?').get(c.ticket_id)?.deal_status)) return res.status(400).json({ error: 'This deal is closed' });
    db.prepare('UPDATE c2c_tickets SET expectation = ? WHERE ticket_id = ?').run(b.expectation ?? null, c.ticket_id);
  }
  if ('note_ids' in b) {
    const ok = db.prepare("SELECT id FROM ticket_comments WHERE id = ? AND ticket_id = ? AND parent_id IS NULL AND kind IN ('comment', 'note')");
    const ids = [...new Set((Array.isArray(b.note_ids) ? b.note_ids : []).map(Number).filter(Boolean))].slice(0, 20);
    if (ids.some((id) => !ok.get(id, c.ticket_id))) return res.status(400).json({ error: 'That note is no longer on this ticket' });
    db.prepare('UPDATE c2c_tickets SET note_ids = ?, note_id = NULL WHERE ticket_id = ?').run(json.str(ids), c.ticket_id);
  }
  res.json(page(req.user));
});

/**
 * Take a ticket off the list, whatever stage it's in. Its row is kept, marked removed with the stage it was in, so it stays
 * off until it moves into a stage that belongs here or someone adds it again; its status and picked notes come back with it.
 */
r.delete('/:ticketId', (req, res) => {
  const c = entry(req.params.ticketId);
  if (!c) return res.status(404).json({ error: 'That ticket isn’t on the list' });
  db.prepare("UPDATE c2c_tickets SET removed_at = datetime('now'), removed_stage = ? WHERE ticket_id = ?").run(stageKey(c), c.ticket_id);
  res.json(page(req.user));
});

export default r;
