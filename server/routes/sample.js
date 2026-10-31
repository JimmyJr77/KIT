// Admin controls for the sample data: see what's there, and hide or show it.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { sampleStatus, setSampleHidden } from '../sample/index.js';

const r = Router();
r.use(requireAdmin);

r.get('/', (req, res) => res.json({ ...sampleStatus(), production: process.env.NODE_ENV === 'production' }));

/** Body: { hidden }. Hides the sample from every page, for everyone, without deleting it. */
r.post('/visibility', (req, res) => {
  setSampleHidden(!!req.body?.hidden);
  res.json(sampleStatus());
});

export default r;
