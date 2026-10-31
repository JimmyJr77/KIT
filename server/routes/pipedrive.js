// Admins: sync KIT with Pipedrive (Pipedrive → KIT) and see how the last sync went.
import { Router } from 'express';
import { requireAdmin } from '../auth.js';
import { startSync, syncStatus } from '../services/pipedrive.js';

const r = Router();
r.use(requireAdmin);

r.get('/', (req, res) => res.json(syncStatus()));

/** Starts a sync in the background; poll GET / for progress and the result. */
r.post('/sync', (req, res) => {
  try {
    startSync({ id: req.user.id, name: `${req.user.first_name} ${req.user.last_name}` });
    res.json(syncStatus());
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
