// @mentions: "@First Last" in a comment or note alerts that user.
import { db } from './db.js';

/** Users mentioned in `text` as "@First Last" (case-insensitive). */
export function mentionedUsers(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('@')) return [];
  return db.prepare('SELECT id, first_name, last_name FROM users WHERE active = 1').all()
    .filter((u) => t.includes(`@${u.first_name} ${u.last_name}`.toLowerCase()));
}

/**
 * Alert everyone newly mentioned in `body` (anyone already mentioned in `previous` was alerted before).
 * `ref`: { ticket_id, card_id?, comment_id?, note_id? }.
 */
export function notifyMentions(actor, body, ref, previous = '') {
  const before = new Set(mentionedUsers(previous).map((u) => u.id));
  const ins = db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, card_id, comment_id, note_id, excerpt)
    VALUES (?, ?, 'mention', ?, ?, ?, ?, ?)`);
  // Mentioning yourself creates an alert too, as a reminder.
  mentionedUsers(body).filter((u) => !before.has(u.id))
    .forEach((u) => ins.run(u.id, actor.id, ref.ticket_id ?? null, ref.card_id ?? null, ref.comment_id ?? null, ref.note_id ?? null, String(body).slice(0, 400)));
}

/** Teams mentioned in `text` as "@Team Name" (case-insensitive, not followed by more of a word). */
export function mentionedTeams(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('@')) return [];
  return db.prepare('SELECT id, name FROM teams').all().filter((tm) => {
    const at = `@${tm.name}`.toLowerCase();
    for (let i = t.indexOf(at); i >= 0; i = t.indexOf(at, i + 1)) if (!/[\w]/.test(t[i + at.length] || '')) return true;
    return false;
  });
}

/** Everyone `text` reaches: each "@First Last", and every active member of each "@Team". */
export function mentionedPeople(text) {
  const people = new Map(mentionedUsers(text).map((u) => [u.id, u]));
  const teams = mentionedTeams(text);
  if (teams.length) {
    db.prepare(`SELECT DISTINCT u.id, u.first_name, u.last_name FROM users u JOIN user_teams ut ON ut.user_id = u.id
      WHERE u.active = 1 AND ut.team_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(teams.map((tm) => tm.id)))
      .forEach((u) => people.set(u.id, u));
  }
  return [...people.values()];
}
