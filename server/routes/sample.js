// Admin controls for the sample data: see what's there, hide or show it (development), or remove a copy left on
// production from before it stopped loading there.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { sampleStatus, setSampleHidden, removeSample, removalPlan, production } from '../sample/index.js';

const r = Router();
r.use(requireAdmin);

/** The sample's state, and in production what removing it would take (`removal`: sample rows, and any real rows affected). */
r.get('/', (req, res) => res.json({ ...sampleStatus(), production: production(), removal: production() ? removalPlan() : null }));

/** Body: { hidden }. Hides the sample from every page, for everyone, without deleting it. */
r.post('/visibility', (req, res) => {
  setSampleHidden(!!req.body?.hidden);
  res.json(sampleStatus());
});

/** Production only: remove the sample for good, with whatever can't exist without it. The admin saw the plan first. */
r.post('/remove', (req, res) => {
  if (!production()) return res.status(400).json({ error: 'On a development server the sample is hidden or shown, not removed.' });
  if (!sampleStatus().loaded) return res.json({ removed: null, ...sampleStatus() });
  res.json({ removed: removeSample(), ...sampleStatus() });
});

export default r;
