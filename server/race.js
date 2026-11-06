// Game tokens for the KITT race (right-click the car in the corner). Finishing a task earns one token and finishing
// a priority five; a race costs one. Admins race for free.
import { db } from './db.js';

export const TOKENS = { task: 1, priority: 5, race: 1 };

/**
 * Credits tokens once per (reason, ref): a task checked, unchecked and checked again pays the first time only.
 * Never throws: a token must not break the action that earned it.
 */
export function awardTokens(user, reason, ref, amount = TOKENS.task) {
  try {
    if (!user?.id) return;
    db.prepare('INSERT OR IGNORE INTO game_tokens (user_id, delta, reason, ref) VALUES (?, ?, ?, ?)').run(user.id, amount, reason, String(ref));
  } catch (e) {
    console.error('game tokens:', e.message);
  }
}

export const tokenBalance = (userId) => db.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM game_tokens WHERE user_id = ?').get(userId).n;
