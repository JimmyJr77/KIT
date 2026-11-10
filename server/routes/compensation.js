// Compensation: the BD Director bonus plan (3/2/1) applied to each director's won deals. Admins see every director and
// set the plan's inputs (defaults, each director's salary, rates and goals, and what the plan knows about each contract).
// Everyone else sees their own compensation only, and can put their own projections on the months to come. The math is
// in ../compensation.js.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { focusOn } from '../focus.js';
import { compensation, bdMembers, savePlanSettings, savePlan, deletePlan, saveContract, saveProjection, resetProjections } from '../compensation.js';

const r = Router();

const yearOf = (v) => Number(v) || new Date().getFullYear();
const isAdmin = (u) => u.role === 'admin';
/** Whose compensation `u` gets: everyone's for an admin, their own for anyone else, and for an admin with Focus on. */
const scopeFor = (u) => (isAdmin(u) && !focusOn(u) ? null : [u.id]);

/**
 * ?year=2026 (default: this year). Admins: everyone, plus the BD members who could be added. Others: themselves.
 * `own` says the list is just the viewer's: an admin with Focus on still edits, but only sees their own.
 */
r.get('/', (req, res) => {
  const year = yearOf(req.query.year);
  const admin = isAdmin(req.user);
  const scope = scopeFor(req.user);
  const data = compensation(year, scope);
  const listed = new Set(data.directors.map((d) => d.id));
  res.json({ ...data, canEdit: admin, own: !!scope, members: admin && !scope ? bdMembers().filter((m) => !listed.has(m.id)) : [] });
});

/** Body: any of rate_y1, rate_y2, rate_y3 (percents), effective_date (YYYY-MM-DD or blank). */
r.put('/settings', requireAdmin, (req, res) => {
  try { res.json({ settings: savePlanSettings(req.body || {}) }); } catch (e) { res.status(400).json({ error: e.message }); }
});

/** Body: { user_id, plan_year, base_salary?, rate_y1?, rate_y2?, rate_y3?, revenue_goal?, bonus_goal?, eligible?, notes? }. */
r.put('/plans', requireAdmin, (req, res) => {
  const { user_id, plan_year, ...body } = req.body || {};
  const year = Number(plan_year);
  if (!Number.isInteger(year) || !user_id) return res.status(400).json({ error: 'Choose a person and a plan year' });
  try {
    savePlan(Number(user_id), year, body, req.user.id);
    res.json(compensation(year).directors.find((d) => d.id === Number(user_id)) || null);
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

/** Remove a director's plan inputs for a year. They stay listed while they have won deals. */
r.delete('/plans/:userId/:year', requireAdmin, (req, res) => {
  deletePlan(Number(req.params.userId), Number(req.params.year));
  res.json({ ok: true });
});

/** Body: any of start_date, term_months, approval, revenue_basis, excluded, notes. ?year= says which year's figures come back. */
r.put('/contracts/:ticketId', requireAdmin, (req, res) => {
  try {
    saveContract(Number(req.params.ticketId), req.body || {}, req.user.id);
    res.json(compensation(yearOf(req.query.year), scopeFor(req.user)));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

/** Body: { user_id, month (YYYY-MM), amount }. A blank amount goes back to the system's projection. Admins for anyone; others for themselves. */
r.put('/projections', (req, res) => {
  const { user_id, month, amount } = req.body || {};
  const userId = Number(user_id);
  if (!isAdmin(req.user) && userId !== req.user.id) return res.status(403).json({ error: 'You can set your own projections only' });
  try {
    saveProjection(userId, month, amount, req.user.id);
    res.json(compensation(yearOf(String(month).slice(0, 4)), scopeFor(req.user)));
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});

/** Back to the system's projections for a director's year. */
r.delete('/projections/:userId/:year', (req, res) => {
  const userId = Number(req.params.userId);
  if (!isAdmin(req.user) && userId !== req.user.id) return res.status(403).json({ error: 'You can reset your own projections only' });
  resetProjections(userId, Number(req.params.year));
  res.json(compensation(yearOf(req.params.year), scopeFor(req.user)));
});

export default r;
