import { Router } from 'express';
import multer from 'multer';
import { db, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import { lookupRates, importGsaCsv, fiscalYear } from '../services/gsa.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

r.get('/rates', async (req, res) => {
  const { city, state, country, intl } = req.query;
  res.json(await lookupRates({ city, state, country, intl: intl === 'true' }));
});

r.get('/settings', (req, res) => {
  const fy = fiscalYear();
  res.json({
    fiscalYear: fy,
    conusLodging: Number(getSetting('conus_lodging')),
    conusMie: Number(getSetting('conus_mie')),
    povMileageRate: Number(getSetting('pov_mileage_rate')),
    importedRows: db.prepare('SELECT COUNT(*) AS n FROM gsa_rates WHERE fiscal_year = ?').get(fy).n,
    apiConfigured: !!process.env.GSA_API_KEY,
  });
});

r.put('/settings', requireAdmin, (req, res) => {
  const map = { fiscalYear: 'gsa_fiscal_year', conusLodging: 'conus_lodging', conusMie: 'conus_mie', povMileageRate: 'pov_mileage_rate' };
  for (const [k, key] of Object.entries(map)) {
    if (req.body?.[k] != null && !Number.isNaN(Number(req.body[k]))) setSetting(key, req.body[k]);
  }
  res.json({ ok: true });
});

r.post('/import', requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a CSV file' });
  try {
    res.json(importGsaCsv(req.file.buffer.toString('utf8'), Number(req.body?.fiscalYear) || fiscalYear()));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default r;
