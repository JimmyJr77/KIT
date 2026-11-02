// The dashboards' data: the BD dashboard for one person or a team (see server/bdDashboard.js). The Company dashboard's
// other figures come from /financials, and the report card from /financials/report-card.
import { Router } from 'express';
import { db } from '../db.js';
import { bdDashboard, scopeFrom } from '../bdDashboard.js';

const r = Router();

/** Whether someone is a BD director: on the BD team, or the director on any bid. */
const isDirector = (id) => !!db.prepare(`SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD'
  UNION SELECT 1 FROM tickets WHERE bd_director_id = ?`).get(id, id);

/**
 * The BD dashboard for one person (?director=<id>, default you) or a team (?team=<id>), optionally narrowed to one
 * territory (?territory=<id>). isDirector says whether the money views apply: for a person, whether they're in BD; for
 * a team, whether it's BD. ?basis=t4q runs the yearly figures over the last four finished quarters instead of this year.
 */
r.get('/bd', (req, res) => {
  const s = scopeFrom(req.query, req.user.id);
  if (!s) return res.status(404).json({ error: 'No such person or team' });
  res.json({ ...bdDashboard(s, req.query.basis === 't4q' ? 't4q' : 'calendar'), isDirector: s.director ? isDirector(s.director) : s.allBids });
});

export default r;
