// Focus: a person's own setting (Settings → Focus, users.focus). While it's on, the Dashboard, Reports, Priorities,
// Travel, Tickets, the BD Pipeline and Delivery show them only what they're tied to or mentioned in. It narrows what
// they see, nothing else: it gives no access and takes none away, and a ticket opened by a direct link still opens.
//
// Tied to a ticket: you own it or are its BD director, you're on one of its priorities, one of its activities is yours,
// you follow it, it's on your priority list, you've posted on it, or you won a contract from it that you're on.
// Mentioned: a post on it names you ("@First Last"), or alerted you (which is how an "@Team" mention reaches you).
// Tied to a contract: you're its Program Manager, Technical Lead or project owner, on its delivery team, one of its
// tasks is yours, you've written or are named in one of its notes, or you're tied to the pipeline ticket it was won from.
import { db } from './db.js';

export const focusOn = (user) => !!user?.focus;

const TICKETS = `
  SELECT id FROM tickets WHERE created_by = @me OR bd_director_id = @me
  UNION SELECT c.ticket_id FROM priority_cards c JOIN card_assignees a ON a.card_id = c.id WHERE a.user_id = @me
  UNION SELECT ticket_id FROM priority_cards WHERE created_by = @me
  UNION SELECT ticket_id FROM ticket_tasks WHERE assignee_id = @me OR created_by = @me
  UNION SELECT ticket_id FROM ticket_followers WHERE user_id = @me
  UNION SELECT ticket_id FROM priority_list_tickets WHERE user_id = @me
  UNION SELECT ticket_id FROM ticket_comments WHERE author_id = @me OR body LIKE @at ESCAPE '\\'
  UNION SELECT c.ticket_id FROM card_notes n JOIN priority_cards c ON c.id = n.card_id WHERE n.author_id = @me OR n.body LIKE @at ESCAPE '\\'
  UNION SELECT ticket_id FROM alerts WHERE user_id = @me AND ticket_id IS NOT NULL`;
const PROGRAMS = `
  SELECT id FROM delivery_programs WHERE program_manager_id = @me OR technical_lead_id = @me OR owner_id = @me
  UNION SELECT program_id FROM delivery_team WHERE user_id = @me
  UNION SELECT program_id FROM delivery_tasks WHERE assignee_id = @me OR created_by = @me
  UNION SELECT program_id FROM delivery_notes WHERE author_id = @me OR body LIKE @at ESCAPE '\\'
  UNION SELECT program_id FROM alerts WHERE user_id = @me AND program_id IS NOT NULL`;

const params = (user) => ({
  me: user.id,
  at: `%@${`${user.first_name} ${user.last_name}`.replace(/[\\%_]/g, '\\$&')}%`,
});
const ids = (sql, user) => new Set(db.prepare(sql).all(params(user)).map((r) => Object.values(r)[0]).filter((id) => id != null));

/** The tickets `user` is tied to or mentioned in, as a Set of ids; null when their focus is off (nothing to narrow). */
export function focusTickets(user) {
  if (!focusOn(user)) return null;
  return ids(`${TICKETS} UNION SELECT ticket_id FROM delivery_programs WHERE id IN (${PROGRAMS})`, user);
}

/** The contracts `user` is tied to or mentioned in, as a Set of ids; null when their focus is off. */
export function focusPrograms(user) {
  if (!focusOn(user)) return null;
  return ids(`${PROGRAMS} UNION SELECT id FROM delivery_programs WHERE ticket_id IN (${TICKETS})`, user);
}

/**
 * SQL keeping the trips (or actual travel costs, `actuals: true`) under `alias` that are `user`'s: they're the
 * traveler, they entered it, or they decided its approval. Null when their focus is off.
 */
export function focusTravel(user, alias, { actuals = false } = {}) {
  if (!focusOn(user)) return null;
  const me = Number(user.id);
  return `(${alias}.traveler_id = ${me} OR ${alias}.created_by = ${me}${actuals ? '' : ` OR ${alias}.approved_by = ${me}`})`;
}

/**
 * A Weekly Priorities board narrowed to `user`: their own lane and the priorities they're on, with the work they logged
 * and the questions and comments on those priorities. Nobody else's lane, whatever ticket it's for.
 */
export function focusBoard(board, user) {
  if (!focusOn(user)) return board;
  const cards = board.cards.filter((c) => c.assignees.some((a) => a.user_id === user.id));
  const kept = new Set(cards.map((c) => c.id));
  return {
    ...board,
    cards,
    members: board.members.filter((m) => m.id === user.id),
    work: board.work.filter((w) => w.user_id === user.id),
    threads: board.threads.filter((t) => kept.has(t.card_id) || (t.card_assignee_ids || []).includes(user.id)),
  };
}

/** For a router whose figures follow ?director=: while focus is on, they're the viewer's own, whatever was asked for. */
export function focusDirector(req, res, next) {
  if (focusOn(req.user)) {
    const { team, ...query } = req.query;
    Object.defineProperty(req, 'query', { value: { ...query, director: String(req.user.id) }, configurable: true, enumerable: true });
  }
  next();
}
