import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';

const r = Router();

r.get('/', (req, res) => {
  res.json({ teams: db.prepare('SELECT * FROM teams ORDER BY id').all() });
});

r.put('/:id/checkin', requireAuth, (req, res) => {
  const dow = Number(req.body?.checkin_dow);
  if (!(dow >= 0 && dow <= 6)) return res.status(400).json({ error: 'checkin_dow must be 0-6' });
  db.prepare('UPDATE teams SET checkin_dow = ? WHERE id = ?').run(dow, req.params.id);
  res.json({ team: db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id) });
});

export default r;
