// Admin controls for the sample data: see what's loaded, load it, reset it, remove it (preview first), or hide and show it.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { loadSample, removeSample, resetSample, sampleStatus, setSampleHidden } from '../sample/index.js';

const r = Router();
r.use(requireAdmin);

r.get('/', (req, res) => res.json({ ...sampleStatus(), preview: removeSample({ dryRun: true }), production: process.env.NODE_ENV === 'production' }));

const run = (fn) => (req, res) => {
  try {
    const result = fn(req);
    res.json({ result, ...sampleStatus(), preview: removeSample({ dryRun: true }) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
};
r.post('/load', run(() => loadSample()));
r.post('/reset', run(() => resetSample()));
r.post('/remove', run(() => removeSample()));
/** Body: { hidden }. Hides the sample from every page, for everyone, without deleting it. */
r.post('/visibility', run((req) => setSampleHidden(!!req.body?.hidden)));

export default r;
