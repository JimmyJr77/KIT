// The KITT race: tokens, the three tracks and their top-20 times.
import { Router } from 'express';
import { db } from '../db.js';
import { TOKENS, tokenBalance } from '../race.js';
import { TRACKS } from '../../src/lib/raceTracks.js';

const r = Router();
const KEEP = 20; // best times kept per track

const unlimited = (user) => user.role === 'admin';
const trackOf = (id) => TRACKS.find((t) => t.id === id);

/** A track's best times, fastest first, with who drove them. */
function topTimes(track) {
  return db.prepare(`SELECT r.id, r.ms, r.created_at, u.id AS user_id, u.first_name, u.last_name
    FROM race_times r JOIN users u ON u.id = r.user_id WHERE r.track = ? ORDER BY r.ms, r.id LIMIT ?`).all(track, KEEP)
    .map(({ user_id, first_name, last_name, ...t }) => ({ ...t, user: { id: user_id, name: `${first_name} ${last_name}` } }));
}

const status = (user) => ({ tokens: tokenBalance(user.id), unlimited: unlimited(user), cost: TOKENS.race });

/** Tokens, and each track with the caller's best and its leader. */
r.get('/', (req, res) => {
  const best = db.prepare('SELECT MIN(ms) AS ms FROM race_times WHERE track = ? AND user_id = ?');
  res.json({
    ...status(req.user),
    tracks: TRACKS.map((t) => {
      const times = topTimes(t.id);
      return { id: t.id, name: t.name, difficulty: t.difficulty, tagline: t.tagline, best: best.get(t.id, req.user.id).ms, leader: times[0] || null, times };
    }),
  });
});

/** Body: { track }. Pays for a run; admins race free. */
r.post('/start', (req, res) => {
  if (!trackOf(req.body?.track)) return res.status(400).json({ error: 'Unknown track' });
  if (!unlimited(req.user)) {
    if (tokenBalance(req.user.id) < TOKENS.race) return res.status(402).json({ error: 'No tokens left. Finish a task to earn one.' });
    db.prepare('INSERT INTO game_tokens (user_id, delta, reason) VALUES (?, ?, ?)').run(req.user.id, -TOKENS.race, 'race');
  }
  res.json(status(req.user));
});

/** Body: { track, ms }. A clean run's time: kept if it's among the track's best, with its place on the board. */
r.post('/finish', (req, res) => {
  const track = trackOf(req.body?.track);
  const ms = Math.round(Number(req.body?.ms));
  if (!track) return res.status(400).json({ error: 'Unknown track' });
  if (!Number.isFinite(ms) || ms < 500 || ms > 60 * 60 * 1000) return res.status(400).json({ error: 'That time can’t be right' });
  const id = db.transaction(() => {
    const rowid = db.prepare('INSERT INTO race_times (user_id, track, ms) VALUES (?, ?, ?)').run(req.user.id, track.id, ms).lastInsertRowid;
    db.prepare('DELETE FROM race_times WHERE track = ? AND id NOT IN (SELECT id FROM race_times WHERE track = ? ORDER BY ms, id LIMIT ?)').run(track.id, track.id, KEEP);
    return rowid;
  })();
  const times = topTimes(track.id);
  const place = times.findIndex((t) => t.id === id);
  res.json({ ...status(req.user), ms, rank: place < 0 ? null : place + 1, times });
});

export default r;
