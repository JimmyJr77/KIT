// Records "additional work": actions taken while the actor's team has closed
// planning for the current week. Each entry lands on that week's board.
import { db } from './db.js';

const localToday = () => new Date().toLocaleDateString('en-CA');

function currentWeek(dow) {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Log an action if the user's team has closed planning for this week.
 * `entry`: { kind, ticket_id, card_id?, ref_id?, summary? }. Never throws: logging must not break the action.
 */
export function recordWork(user, entry) {
  try {
    const team = user?.team_id && db.prepare('SELECT * FROM teams WHERE id = ?').get(user.team_id);
    if (!team) return;
    const week = currentWeek(team.checkin_dow);
    if (!db.prepare('SELECT 1 FROM week_planning WHERE team_id = ? AND week_start = ?').get(team.id, week)) return;
    db.prepare(`INSERT INTO work_log (team_id, week_start, user_id, kind, ticket_id, card_id, ref_id, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(team.id, week, user.id, entry.kind, entry.ticket_id ?? null, entry.card_id ?? null,
      entry.ref_id ?? null, entry.summary ? String(entry.summary).slice(0, 280) : null);
  } catch (e) {
    console.error('work log:', e.message);
  }
}

/** Additional work for one team-week, newest first, with the ticket and priority it was about. */
export function loadWorkLog(teamId, weekStart) {
  return db.prepare(`SELECT w.*, t.opportunity_title AS ticket_title, c.title AS card_title
    FROM work_log w LEFT JOIN tickets t ON t.id = w.ticket_id LEFT JOIN priority_cards c ON c.id = w.card_id
    WHERE w.team_id = ? AND w.week_start = ? ORDER BY w.created_at DESC, w.id DESC`).all(teamId, weekStart);
}
