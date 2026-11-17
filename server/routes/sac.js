// SAC (Solution Architect Coordination): every open staffing event on a pipeline ticket, as one list for solution architects
// to work down. Events join when a ticket is staffed (the ticket pane's Staff Ticket, a drop on a board bucket, or a process
// tag, including one that came in from Pipedrive) and leave when marked done. Each person orders the events on their own tickets; team leads (and admins) order the
// master list everyone sees.
import { Router } from 'express';
import { db, json } from '../db.js';
import { reportStager, listPipelines } from '../pipelines.js';
import { canEditTicket } from '../../src/lib/ticketAccess.js';
import { ticketEditDenied } from './tickets.js';
import { addStaffingEvent, staffFromTags } from '../staffing.js';
import { PROCESS_TYPES, cleanReviews } from '../../src/lib/process.js';

const r = Router();
const LISTABLE = "t.ticket_type = 'bid' AND t.archive_set_id IS NULL AND t.archived_at IS NULL";
const person = (id, first, last) => (first ? { id, first_name: first, last_name: last } : null);

/** Team leads (of any team) and admins order the master list. */
export const ranksMaster = (user) => user.role === 'admin' || !!db.prepare("SELECT 1 FROM user_teams WHERE user_id = ? AND role = 'lead'").get(user.id);

/** A row's ticket is "mine" when I own it or am its BD director: those are the ones I order. */
const minePredicate = 't.created_by = @me OR t.bd_director_id = @me';

function list(user, { done = false } = {}) {
  staffFromTags(); // a ticket carrying a process tag is staffed for it
  const rows = db.prepare(`SELECT p.*, t.opportunity_title, t.organization, t.pipeline_status, t.pipeline_id, t.labels, t.created_by AS owner_id,
      t.bd_director_id, t.territory_id, t.value, t.deal_status, o.first_name AS o_first, o.last_name AS o_last, d.first_name AS d_first, d.last_name AS d_last,
      tr.name AS territory_name, mr.position AS my_rank, (${minePredicate}) AS mine
    FROM ticket_process_steps p JOIN tickets t ON t.id = p.ticket_id
    LEFT JOIN users o ON o.id = t.created_by LEFT JOIN users d ON d.id = t.bd_director_id LEFT JOIN territories tr ON tr.id = t.territory_id
    LEFT JOIN sac_ranks mr ON mr.step_id = p.id AND mr.user_id = @me
    WHERE ${LISTABLE} AND p.completed_at IS ${done ? 'NOT NULL' : 'NULL'}`).all({ me: user.id });
  const ids = rows.map((x) => x.id);
  const files = ids.length ? db.prepare(`SELECT id, process_step_id, process_field, original_name, size FROM ticket_files
    WHERE process_step_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at, id`).all(...ids) : [];
  // Notes on each event, newest first: written from this list, and kept on the ticket as its notes.
  const notes = ids.length ? db.prepare(`SELECT m.id, m.process_step_id, m.body, m.created_at, m.updated_at, m.author_id, u.first_name, u.last_name
    FROM ticket_comments m LEFT JOIN users u ON u.id = m.author_id
    WHERE m.kind = 'note' AND m.process_step_id IN (${ids.map(() => '?').join(',')}) ORDER BY m.created_at DESC, m.id DESC`).all(...ids) : [];
  const users = new Map(db.prepare('SELECT id, first_name, last_name FROM users').all().map((u) => [u.id, u]));
  return rows.map((p) => {
    const reviews = cleanReviews(json.parse(p.reviews, {}));
    return {
      id: p.id, ticket_id: p.ticket_id, title: p.opportunity_title, organization: p.organization, stage: p.pipeline_status, value: p.value,
      labels: json.parse(p.labels, []), step_type: p.step_type, due_date: p.step_date, criticality: p.criticality || 'queued',
      request: p.notes || '', fields: json.parse(p.fields, {}), decision: p.decision || '', pricing: p.pricing || '',
      files: files.filter((f) => f.process_step_id === p.id).map((f) => ({ id: f.id, field: f.process_field, name: f.original_name, size: f.size })),
      notes: notes.filter((m) => m.process_step_id === p.id).map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, updated_at: m.updated_at ?? null,
        author: person(m.author_id, m.first_name, m.last_name), mine: m.author_id === user.id })),
      // The solution architects staffed to it: who's named under Solution Architect & Technical.
      architects: reviews.technical.people.map((id) => users.get(id)).filter(Boolean),
      owner: person(p.owner_id, p.o_first, p.o_last), director: person(p.bd_director_id, p.d_first, p.d_last),
      territory: p.territory_id ? { id: p.territory_id, name: p.territory_name } : null,
      can_edit: canEditTicket(user, { created_by: p.owner_id, ticket_type: 'bid' }), mine: !!p.mine,
      master_rank: p.sac_rank ?? null, my_rank: p.my_rank ?? null,
      created_at: p.created_at, updated_at: p.updated_at, completed_at: p.completed_at,
    };
  });
}

/** Who can be staffed to an event from the list: the active people on the Technical Solutioning team, by name. */
const solutionArchitects = () => db.prepare(`SELECT DISTINCT u.id, u.first_name, u.last_name, u.title FROM users u
  JOIN user_teams ut ON ut.user_id = u.id JOIN teams tm ON tm.id = ut.team_id
  WHERE tm.name = 'Technical Solutioning' AND u.active = 1 ORDER BY u.first_name COLLATE NOCASE, u.last_name COLLATE NOCASE`).all();

r.get('/', (req, res) => res.json({ rows: list(req.user, { done: req.query.done === '1' }), can_rank_master: ranksMaster(req.user), architects: solutionArchitects() }));

/**
 * What the board needs to offer buckets: the stage each pipeline's stages count as in reports (a KIT-added stage blended
 * into Capture offers Capture's buckets), keyed "<pipeline id or kit>|<stage>".
 */
r.get('/meta', (req, res) => {
  const stage = reportStager();
  const stages = {};
  listPipelines().forEach((p) => p.statuses.forEach((s) => { stages[`${p.id ?? 'kit'}|${s}`] = stage.of(p.id ?? null, s); }));
  res.json({ stages });
});

/**
 * Body: { ticket_id, step_type }. Staffs a ticket from the board: a ticket dropped on a bucket gets that staffing event (or
 * keeps the open one it has), its process tag, and so its place on this list. Its stage doesn't change.
 */
r.post('/', (req, res) => {
  const t = db.prepare(`SELECT t.* FROM tickets t WHERE t.id = ? AND ${LISTABLE}`).get(Number(req.body?.ticket_id) || 0);
  if (!t) return res.status(400).json({ error: 'Pick a pipeline ticket that isn’t archived' });
  const denied = ticketEditDenied(req.user, t);
  if (denied) return res.status(403).json({ error: denied });
  const type = String(req.body?.step_type || '');
  if (!PROCESS_TYPES.includes(type)) return res.status(400).json({ error: 'Choose a staffing event' });
  const { id, created } = addStaffingEvent(req.user, t.id, type, { reuse: true });
  res.json({ id, created, labels: json.parse(db.prepare('SELECT labels FROM tickets WHERE id = ?').get(t.id).labels, []) });
});

/**
 * Body: { list: 'mine' | 'master', ids: [staffing event ids, most important first] }. 'mine' orders the events on your own
 * tickets (others' are ignored); 'master' orders the list everyone sees, for team leads and admins. Events not named keep
 * their place after the ones that are.
 */
r.put('/rank', (req, res) => {
  const which = req.body?.list;
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Boolean))];
  if (which === 'master') {
    if (!ranksMaster(req.user)) return res.status(403).json({ error: 'Only team leads and admins order the master list' });
    const known = new Set(db.prepare('SELECT id FROM ticket_process_steps WHERE completed_at IS NULL').all().map((x) => x.id));
    const order = ids.filter((id) => known.has(id));
    db.transaction(() => {
      db.prepare('UPDATE ticket_process_steps SET sac_rank = NULL WHERE completed_at IS NULL').run();
      order.forEach((id, i) => db.prepare('UPDATE ticket_process_steps SET sac_rank = ? WHERE id = ?').run(i + 1, id));
    })();
  } else if (which === 'mine') {
    const own = new Set(list(req.user).filter((x) => x.mine).map((x) => x.id));
    const order = ids.filter((id) => own.has(id));
    db.transaction(() => {
      db.prepare('DELETE FROM sac_ranks WHERE user_id = ?').run(req.user.id);
      order.forEach((id, i) => db.prepare('INSERT INTO sac_ranks (user_id, step_id, position) VALUES (?, ?, ?)').run(req.user.id, id, i + 1));
    })();
  } else return res.status(400).json({ error: 'Say which list to order' });
  res.json({ rows: list(req.user), can_rank_master: ranksMaster(req.user) });
});

export default r;
