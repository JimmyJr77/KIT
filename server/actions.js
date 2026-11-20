// Recent actions: what someone did that they can take back from their Alerts page. Each entry keeps the request that
// reverses it (`undo`: method, path under /api, body) and what the record looked like right after (`guard`), so an undo
// is refused once the record has been changed again. Undoing runs that request as the same person through the normal
// route, so permissions, the work log and the ticket's history apply as usual; and since KIT sends Pipedrive whatever
// differs from its last pull, the reversal reaches Pipedrive the same way the action did.
import { db, json } from './db.js';

const KEEP_DAYS = 30;
/** The header an undo's own request carries, so reversing an action isn't logged as a new one. */
export const UNDO_HEADER = 'x-kit-undo';

/**
 * Log an action. `a`: { ticket_id, summary, undo: { method, path, body }, guard: { table, id, fields } }.
 * Never throws: logging must not break the action.
 */
export function recordAction(req, a) {
  try {
    if (!req.user?.id || req.get(UNDO_HEADER) || !a?.undo) return;
    db.prepare('INSERT INTO user_actions (user_id, ticket_id, summary, undo, guard) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, a.ticket_id ?? null, String(a.summary || 'Change').slice(0, 280), json.str(a.undo), json.str(a.guard || null));
    db.prepare(`DELETE FROM user_actions WHERE created_at < datetime('now', '-${KEEP_DAYS} days')`).run();
  } catch (e) {
    console.error('action log:', e.message);
  }
}

const TABLES = ['ticket_tasks', 'activity_subtasks', 'tickets'];
const alike = (a, b) => (a ?? null) === (b ?? null) || String(a ?? '') === String(b ?? '');
/** Whether the record still stands as the action left it (false too when it's gone). */
export function unchanged(guard) {
  if (!guard) return true;
  if (!TABLES.includes(guard.table)) return false;
  const row = db.prepare(`SELECT * FROM ${guard.table} WHERE id = ?`).get(guard.id);
  return !!row && Object.entries(guard.fields || {}).every(([k, v]) => alike(row[k], v));
}

/** Someone's own actions from the last `days`, newest first. */
export function recentActions(userId, days = 7) {
  return db.prepare(`SELECT a.id, a.ticket_id, a.summary, a.guard, a.created_at, a.undone_at, t.opportunity_title AS ticket_title, t.ticket_type
    FROM user_actions a LEFT JOIN tickets t ON t.id = a.ticket_id
    WHERE a.user_id = ? AND a.created_at >= datetime('now', ?) ORDER BY a.created_at DESC, a.id DESC LIMIT 40`).all(userId, `-${days} days`)
    .map(({ guard, ...a }) => ({ ...a, undone: !!a.undone_at, can_undo: !a.undone_at && unchanged(json.parse(guard, null)) }));
}
