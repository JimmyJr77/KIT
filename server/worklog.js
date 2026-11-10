// Records work: every action someone takes during the sprint (their team's current week), whether or not planning has
// closed. Each entry lands in the Work column of their lane on that week's board.
import { db } from './db.js';

const localToday = () => new Date().toLocaleDateString('en-CA');

function currentWeek(dow) {
  const d = new Date(`${localToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/**
 * Log an action on the user's team's board for this week.
 * `entry`: { kind, ticket_id, card_id?, ref_id?, summary? }. Never throws: logging must not break the action.
 */
export function recordWork(user, entry) {
  try {
    const tw = teamWeek(user);
    if (!tw) return;
    db.prepare(`INSERT INTO work_log (team_id, week_start, user_id, kind, ticket_id, card_id, ref_id, summary)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(tw.team.id, tw.week, user.id, entry.kind, entry.ticket_id ?? null, entry.card_id ?? null,
      entry.ref_id ?? null, entry.summary ? String(entry.summary).slice(0, 280) : null);
  } catch (e) {
    console.error('work log:', e.message);
  }
}

/**
 * An update someone made to a ticket they own (`what` names the part changed: "Win strategy", "Labels"…). It lands in
 * their lane as "Ticket updated"; saving the same part of the same ticket again in the week moves that entry up rather
 * than adding another. Updates to other people's tickets aren't logged here.
 */
export function recordTicketUpdate(user, ticket, what) {
  try {
    if (!user?.id || !ticket || ticket.created_by !== user.id) return;
    const tw = teamWeek(user);
    if (!tw) return;
    const summary = String(what || 'Updated').slice(0, 280);
    const prior = db.prepare(`SELECT id FROM work_log WHERE team_id = ? AND week_start = ? AND user_id = ? AND kind = 'update' AND ticket_id = ? AND summary = ?`)
      .get(tw.team.id, tw.week, user.id, ticket.id, summary);
    if (prior) db.prepare("UPDATE work_log SET created_at = datetime('now') WHERE id = ?").run(prior.id);
    else db.prepare('INSERT INTO work_log (team_id, week_start, user_id, kind, ticket_id, summary) VALUES (?, ?, ?, ?, ?, ?)').run(tw.team.id, tw.week, user.id, 'update', ticket.id, summary);
  } catch (e) {
    console.error('work log:', e.message);
  }
}

/**
 * The team-week a user's work lands on: their first team whose planning is closed this week (where it landed before
 * all work was logged), else their first team. Null for someone on no team.
 */
function teamWeek(user) {
  const teams = user?.id ? db.prepare(`SELECT t.* FROM user_teams ut JOIN teams t ON t.id = ut.team_id
    WHERE ut.user_id = ? ORDER BY t.id`).all(user.id) : [];
  const closed = db.prepare('SELECT 1 FROM week_planning WHERE team_id = ? AND week_start = ?');
  const team = teams.find((t) => closed.get(t.id, currentWeek(t.checkin_dow))) || teams[0];
  return team ? { team, week: currentWeek(team.checkin_dow) } : null;
}

/** Work for one team-week, newest first, with the ticket and priority it was about. Work on an archived ticket isn't shown. */
export function loadWorkLog(teamId, weekStart) {
  return db.prepare(`SELECT w.*, t.opportunity_title AS ticket_title, c.title AS card_title
    FROM work_log w LEFT JOIN tickets t ON t.id = w.ticket_id LEFT JOIN priority_cards c ON c.id = w.card_id
    WHERE w.team_id = ? AND w.week_start = ? AND t.archived_at IS NULL ORDER BY w.created_at DESC, w.id DESC`).all(teamId, weekStart);
}
