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
