// @mentions: "@First Last" in a comment, note or support request alerts that user, and "@Team Name" alerts every
// active member of that team (user_teams, exactly as it stands).
import { db } from './db.js';

/** Users mentioned in `text` as "@First Last" (case-insensitive). */
export function mentionedUsers(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('@')) return [];
  return db.prepare('SELECT id, first_name, last_name FROM users WHERE active = 1').all()
    .filter((u) => t.includes(`@${u.first_name} ${u.last_name}`.toLowerCase()));
}

/**
 * Teams mentioned in `text` as "@Team Name" (case-insensitive). People are only ever mentioned by full name, never by
 * username, so a team name is told from a person's by position: at one "@" the longest name wins, and a person wins a
 * tie. "@KIT Admin" is that person, "@Admin" the team. The team name also has to stand alone: "@BDs" isn't "@BD", and
 * an "@" stuck to the end of a word is an address ("press@marketing.example"), not a mention.
 */
export function mentionedTeams(text) {
  const t = String(text || '').toLowerCase();
  if (!t.includes('@')) return [];
  const teams = db.prepare('SELECT id, name FROM teams ORDER BY id').all().map((tm) => ({ ...tm, at: `@${tm.name}`.toLowerCase() }));
  const people = db.prepare('SELECT first_name, last_name FROM users WHERE active = 1').all().map((u) => `@${u.first_name} ${u.last_name}`.toLowerCase());
  const standsAt = (at, i) => t.startsWith(at, i) && !/[\w.+-]/.test(t[i - 1] || '') && !/\w/.test(t[i + at.length] || '');
  return teams.filter(({ at }) => {
    for (let i = t.indexOf(at); i >= 0; i = t.indexOf(at, i + 1)) {
      if (!standsAt(at, i)) continue;
      if (people.some((p) => p.length >= at.length && t.startsWith(p, i))) continue; // a person whose name starts like the team's
      if (teams.some((o) => o.at.length > at.length && standsAt(o.at, i))) continue; // a longer team name
      return true;
    }
    return false;
  }).map(({ id, name }) => ({ id, name }));
}

/** The active members of each of `teams`, with the mentioned team that reached them (`team_id`). */
function teamMembers(teams) {
  if (!teams.length) return [];
  return db.prepare(`SELECT u.id, u.first_name, u.last_name, MIN(ut.team_id) AS team_id FROM users u JOIN user_teams ut ON ut.user_id = u.id
    WHERE u.active = 1 AND ut.team_id IN (SELECT value FROM json_each(?)) GROUP BY u.id`).all(JSON.stringify(teams.map((tm) => tm.id)));
}

/** Everyone `text` reaches: each "@First Last", and every active member of each "@Team". */
export function mentionedPeople(text) {
  const people = new Map(teamMembers(mentionedTeams(text)).map((u) => [u.id, u]));
  mentionedUsers(text).forEach((u) => people.set(u.id, u)); // named in person: no team_id
  return [...people.values()];
}

/**
 * Who a post by `actor` alerts, each once: everyone it names (yourself too, as a reminder), and the members of each team
 * it mentions other than the author. Someone only reached through a team carries that `team_id`.
 */
function alerted(actor, text) {
  const named = new Set(mentionedUsers(text).map((u) => u.id));
  return mentionedPeople(text).filter((u) => named.has(u.id) || u.id !== actor?.id);
}

/**
 * Alert everyone newly mentioned in `body`, in person or through their team (anyone `previous` already reached was
 * alerted before, so editing a post doesn't alert a person or a team twice).
 * `ref`: { ticket_id, card_id?, comment_id?, note_id? }.
 */
export function notifyMentions(actor, body, ref, previous = '') {
  const before = new Set(alerted(actor, previous).map((u) => u.id));
  const ins = db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, card_id, comment_id, note_id, team_id, excerpt)
    VALUES (?, ?, 'mention', ?, ?, ?, ?, ?, ?)`);
  alerted(actor, body).filter((u) => !before.has(u.id))
    .forEach((u) => ins.run(u.id, actor.id, ref.ticket_id ?? null, ref.card_id ?? null, ref.comment_id ?? null, ref.note_id ?? null, u.team_id ?? null, String(body).slice(0, 400)));
}

/**
 * Alert a ticket's owner that someone posted on it (a comment, question or reply). The owner's own posts don't alert them,
 * and one who is @mentioned in the post, in person or through their team, gets the mention alert instead of two.
 * `ref`: { ticket_id, card_id?, comment_id }.
 */
export function notifyTicketOwner(actor, ticket, body, ref) {
  const owner = ticket?.created_by;
  if (!owner || owner === actor?.id) return;
  if (mentionedPeople(body).some((u) => u.id === owner)) return;
  db.prepare(`INSERT INTO alerts (user_id, actor_id, kind, ticket_id, card_id, comment_id, excerpt) VALUES (?, ?, 'comment', ?, ?, ?, ?)`)
    .run(owner, actor?.id ?? null, ref.ticket_id ?? null, ref.card_id ?? null, ref.comment_id ?? null, String(body).slice(0, 400));
}
