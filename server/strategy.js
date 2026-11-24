// A pipeline ticket's strategy: a list of obstacles, each with the strategies for getting past it. An obstacle that's
// been overcome is crossed off (resolved) with its outcome and kept for context. The strategies of the obstacles still
// open are what the Close to closing status note shows, with the notes picked for it, and what the Process view reads
// as the ticket's strategy. (tickets.strategy, the single block of text from before, became each ticket's first entry.)
import { db } from './db.js';

const name = (first, last) => (first ? `${first} ${last}` : null);

/** Obstacles by ticket id, open ones first then crossed-off ones, each in the order added, with its strategies. */
function obstaclesFor(where, args) {
  const rows = db.prepare(`SELECT o.*, c.first_name AS c_first, c.last_name AS c_last, r.first_name AS r_first, r.last_name AS r_last
    FROM ticket_obstacles o LEFT JOIN users c ON c.id = o.created_by LEFT JOIN users r ON r.id = o.resolved_by
    WHERE ${where} ORDER BY (o.resolved_at IS NOT NULL), o.position, o.id`).all(...args);
  const strategies = new Map();
  db.prepare(`SELECT s.*, u.first_name, u.last_name FROM ticket_strategies s JOIN ticket_obstacles o ON o.id = s.obstacle_id
      LEFT JOIN users u ON u.id = s.created_by WHERE ${where} ORDER BY s.id`).all(...args)
    .forEach((s) => strategies.set(s.obstacle_id, [...(strategies.get(s.obstacle_id) || []),
      { id: s.id, body: s.body, created_at: s.created_at, updated_at: s.updated_at ?? null, by: name(s.first_name, s.last_name) }]));
  const out = new Map();
  rows.forEach((o) => out.set(o.ticket_id, [...(out.get(o.ticket_id) || []), {
    id: o.id, body: o.body || '', created_at: o.created_at, by: name(o.c_first, o.c_last),
    resolved_at: o.resolved_at ?? null, resolved_by: name(o.r_first, o.r_last), outcome: o.outcome || '',
    strategies: strategies.get(o.id) || [],
  }]));
  return out;
}

/** One ticket's obstacles. */
export const listObstacles = (ticketId) => obstaclesFor('o.ticket_id = ?', [ticketId]).get(Number(ticketId)) || [];

/** The open obstacles (with their strategies) of every pipeline ticket that has any, by ticket id. */
export function openStrategies() {
  const out = new Map();
  obstaclesFor('o.resolved_at IS NULL', []).forEach((list, id) => out.set(id, list.map((o) => ({ id: o.id, obstacle: o.body, strategies: o.strategies.map((s) => s.body) }))));
  return out;
}

/** A ticket's open strategies as plain text, for where the strategy is read as one block (the Process view). */
export const strategyText = (ticketId) => listObstacles(ticketId).filter((o) => !o.resolved_at)
  .map((o) => [o.body && `Obstacle: ${o.body}`, ...o.strategies.map((s) => (o.body ? `  - ${s.body}` : s.body))].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
