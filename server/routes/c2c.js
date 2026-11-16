// Close to closing (C2C): the BD Pipeline's list of deals near a decision. Every open pipeline ticket in Under Evaluation
// (or a stage reports count as Under Evaluation) joins the list on its own; any other pipeline ticket can be added by hand.
// Once on the list a ticket stays when its deal closes: its category then reads from the deal (Awarded, Paid (Won),
// Closed - Not awarded) instead of its stage, and a paid or closed deal's status is Closed. Notes are the ticket's own
// comments and notes.
import { Router } from 'express';
import { db, json } from '../db.js';
import { reportStager } from '../pipelines.js';
import { termFromFields } from '../compensation.js';
import { canEditTicket } from '../../src/lib/ticketAccess.js';
import { ticketEditDenied } from './tickets.js';

const r = Router();

/** The standings someone sets by hand, while the deal is open. */
const SET_STATUSES = ['on_track', 'off_up', 'off_steady', 'off_down'];
const EVALUATION = 'Under Evaluation';
const LISTABLE = "t.ticket_type = 'bid' AND t.archive_set_id IS NULL AND t.archived_at IS NULL";

/** Put every open ticket now in Under Evaluation on the list. */
function addEvaluating() {
  const stage = reportStager();
  const add = db.prepare('INSERT OR IGNORE INTO c2c_tickets (ticket_id) VALUES (?)');
  db.prepare(`SELECT t.id, t.pipeline_id, t.pipeline_status FROM tickets t
    WHERE ${LISTABLE} AND t.deal_status = 'open' AND t.pipeline_status IS NOT NULL AND t.id NOT IN (SELECT ticket_id FROM c2c_tickets)`).all()
    .filter((t) => stage.of(t.pipeline_id, t.pipeline_status) === EVALUATION).forEach((t) => add.run(t.id));
}

/** Where the deal itself says the ticket has got to (shown as its category), or null while it's still in a stage. */
const dealOutcome = (t) => (t.deal_status === 'won' ? 'paid' : t.deal_status === 'lost' ? 'closed' : t.pipeline_status === 'Awarded' ? 'awarded' : null);

function list(user) {
  addEvaluating();
  const stage = reportStager();
  const rows = db.prepare(`SELECT c.status AS c_status, c.note_id, c.created_at AS added_at, t.*, o.first_name AS owner_first_name, o.last_name AS owner_last_name
    FROM c2c_tickets c JOIN tickets t ON t.id = c.ticket_id LEFT JOIN users o ON o.id = t.created_by WHERE ${LISTABLE}`).all();
  const notes = new Map();
  if (rows.length) {
    db.prepare(`SELECT m.id, m.ticket_id, m.body, m.kind, m.created_at, m.updated_at, m.author_id, u.first_name, u.last_name
      FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.parent_id IS NULL AND m.kind IN ('comment', 'note') AND m.ticket_id IN (SELECT ticket_id FROM c2c_tickets)
      ORDER BY m.created_at DESC, m.id DESC`).all().forEach((m) => {
      if (!notes.has(m.ticket_id)) notes.set(m.ticket_id, []);
      notes.get(m.ticket_id).push({ id: m.id, body: m.body, created_at: m.created_at, updated_at: m.updated_at ?? null,
        author: m.first_name ? { id: m.author_id, first_name: m.first_name, last_name: m.last_name } : null, mine: m.author_id === user.id });
    });
  }
  return rows.map((t) => {
    const term = termFromFields(t.custom_fields);
    const mine = notes.get(t.id) || [];
    const outcome = dealOutcome(t);
    return {
      ticket_id: t.id, title: t.opportunity_title, organization: t.organization, value: t.value, currency: t.currency,
      stage: t.pipeline_status, close_date: t.win_date_undetermined ? null : t.projected_win_date,
      term_months: term.months, term_text: term.text, labels: json.parse(t.labels, []), added_at: t.added_at,
      outcome, closed: outcome === 'paid' || outcome === 'closed',
      status: SET_STATUSES.includes(t.c_status) ? t.c_status : null,
      evaluating: t.deal_status === 'open' && stage.of(t.pipeline_id, t.pipeline_status) === EVALUATION,
      owner: t.owner_first_name ? { id: t.created_by, first_name: t.owner_first_name, last_name: t.owner_last_name } : null,
      can_edit: canEditTicket(user, t),
      notes: mine, note_id: mine.some((n) => n.id === t.note_id) ? t.note_id : null,
    };
  });
}

r.get('/', (req, res) => res.json({ rows: list(req.user) }));

/** Body: { ticket_id }. Adds a pipeline ticket to the list. */
r.post('/', (req, res) => {
  const t = db.prepare(`SELECT t.id FROM tickets t WHERE t.id = ? AND ${LISTABLE}`).get(Number(req.body?.ticket_id) || 0);
  if (!t) return res.status(400).json({ error: 'Pick a pipeline ticket that isn’t archived' });
  db.prepare('INSERT OR IGNORE INTO c2c_tickets (ticket_id, added_by) VALUES (?, ?)').run(t.id, req.user.id);
  res.json({ rows: list(req.user) });
});

const entry = (id) => db.prepare('SELECT c.*, t.created_by, t.ticket_type FROM c2c_tickets c JOIN tickets t ON t.id = c.ticket_id WHERE c.ticket_id = ?').get(Number(id) || 0);

/**
 * Body: any of status (one of the standings, or null to clear it: the ticket's owner or an admin) and note_id (the note the
 * row shows, null for the latest: anyone).
 */
r.put('/:ticketId', (req, res) => {
  const c = entry(req.params.ticketId);
  if (!c) return res.status(404).json({ error: 'That ticket isn’t on the list' });
  const b = req.body || {};
  if ('status' in b) {
    const denied = ticketEditDenied(req.user, { id: c.ticket_id, created_by: c.created_by, ticket_type: c.ticket_type });
    if (denied) return res.status(403).json({ error: denied });
    if (b.status != null && !SET_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
    if (['won', 'lost'].includes(db.prepare('SELECT deal_status FROM tickets WHERE id = ?').get(c.ticket_id)?.deal_status)) return res.status(400).json({ error: 'This deal is closed' });
    db.prepare('UPDATE c2c_tickets SET status = ? WHERE ticket_id = ?').run(b.status ?? null, c.ticket_id);
  }
  if ('note_id' in b) {
    const note = b.note_id == null ? null : db.prepare("SELECT id FROM ticket_comments WHERE id = ? AND ticket_id = ? AND parent_id IS NULL AND kind IN ('comment', 'note')").get(Number(b.note_id) || 0, c.ticket_id);
    if (b.note_id != null && !note) return res.status(400).json({ error: 'That note is no longer on this ticket' });
    db.prepare('UPDATE c2c_tickets SET note_id = ? WHERE ticket_id = ?').run(note?.id ?? null, c.ticket_id);
  }
  res.json({ rows: list(req.user) });
});

/** Take a ticket off the list. One still in Under Evaluation belongs on it, so it stays. */
r.delete('/:ticketId', (req, res) => {
  const c = entry(req.params.ticketId);
  if (!c) return res.status(404).json({ error: 'That ticket isn’t on the list' });
  if (list(req.user).find((x) => x.ticket_id === c.ticket_id)?.evaluating) return res.status(400).json({ error: 'Tickets in Under Evaluation stay on this list' });
  db.prepare('DELETE FROM c2c_tickets WHERE ticket_id = ?').run(c.ticket_id);
  res.json({ rows: list(req.user) });
});

export default r;
