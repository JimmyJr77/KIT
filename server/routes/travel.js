import { Router } from 'express';
import { db, json } from '../db.js';
import { estimateFlight, estimateCar, mcpStatus, VEHICLE_CLASSES, placeLabel } from '../services/estimators.js';
import { mileageRate } from '../services/gsa.js';
import { quarterFor, tripCosts, upcomingQuarters, PURPOSES } from '../../src/lib/travelCalc.js';

const r = Router();

const JSON_COLS = { purposes: [], location_from: {}, location_to: {}, airfare: {}, pov: {}, car: {}, lodging: [], mie: {} };

function hydrate(row) {
  if (!row) return null;
  const t = { ...row };
  for (const [k, d] of Object.entries(JSON_COLS)) t[k] = json.parse(row[k], d);
  return t;
}

const SELECT = `SELECT t.*, u.first_name || ' ' || u.last_name AS traveler_name FROM trips t JOIN users u ON u.id = t.traveler_id`;

function validate(b = {}) {
  if (!b.traveler_id) return 'Traveler is required';
  if (!b.date_from || !b.date_to) return 'Travel dates are required';
  if (b.date_to < b.date_from) return 'Date To must be on or after Date From';
  if (!Array.isArray(b.purposes) || !b.purposes.length) return 'Select at least one general purpose';
  if (b.purposes.some((p) => !PURPOSES.includes(p))) return 'Invalid purpose';
  return null;
}

function toRow(b) {
  const row = {
    traveler_id: Number(b.traveler_id),
    details: b.details || null,
    date_from: b.date_from,
    date_to: b.date_to,
    quarter: quarterFor(b.date_from),
    train: b.train === '' || b.train == null ? null : Number(b.train),
    total_estimate: tripCosts(b).total,
    event_id: Number(b.event_id) || null,
  };
  for (const [k, d] of Object.entries(JSON_COLS)) row[k] = json.str(b[k] ?? d);
  return row;
}

r.get('/meta', (req, res) => {
  res.json({ purposes: PURPOSES, vehicleClasses: VEHICLE_CLASSES, mileageRate: mileageRate(), integrations: mcpStatus() });
});

r.get('/', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.traveler) { where.push('t.traveler_id = @traveler'); params.traveler = Number(req.query.traveler); }
  if (req.query.quarter) { where.push('t.quarter = @quarter'); params.quarter = req.query.quarter; }
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date_from DESC`).all(params);
  res.json({ trips: rows.map(hydrate) });
});

/** Estimated spend for this quarter and the next three, optionally for one traveler. */
r.get('/outlook', (req, res) => {
  const quarters = upcomingQuarters(4);
  const traveler = Number(req.query.traveler) || null;
  const rows = db.prepare(`SELECT quarter, COUNT(*) AS trips, COALESCE(SUM(total_estimate), 0) AS total FROM trips
    WHERE quarter IN (SELECT value FROM json_each(@quarters)) AND (@traveler IS NULL OR traveler_id = @traveler)
    GROUP BY quarter`).all({ quarters: JSON.stringify(quarters), traveler });
  res.json({ quarters: quarters.map((q) => ({ quarter: q, trips: 0, total: 0, ...rows.find((r) => r.quarter === q) })) });
});

r.get('/:id', (req, res) => {
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id));
  if (!trip) return res.status(404).json({ error: 'Not found' });
  res.json({ trip });
});

r.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const row = toRow(req.body);
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO trips (${cols.join(',')}, created_by) VALUES (${cols.map((c) => '@' + c).join(',')}, @created_by)`)
    .run({ ...row, created_by: req.user.id });
  res.json({ trip: hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(info.lastInsertRowid)) });
});

r.put('/:id', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const row = toRow(req.body);
  db.prepare(`UPDATE trips SET ${Object.keys(row).map((c) => `${c}=@${c}`).join(',')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...row, id: Number(req.params.id) });
  res.json({ trip: hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id)) });
});

r.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM trips WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Live estimates ----

function flightInput(a, trip) {
  return {
    tripType: a.tripType,
    origin: a.origin || placeLabel(trip.location_from),
    destination: a.destination || placeLabel(trip.location_to),
    // Structured locations let the flight search resolve the right airports.
    originPlace: a.origin || trip.location_from,
    destinationPlace: a.destination || trip.location_to,
    departDate: a.departDate || trip.date_from,
    returnDate: a.returnDate || trip.date_to,
    intl: !!(trip.location_from?.intl || trip.location_to?.intl),
  };
}

function carInput(c, trip) {
  return {
    vehicleClass: c.vehicleClass || VEHICLE_CLASSES[0],
    location: c.location || placeLabel(trip.location_to),
    pickupDate: c.pickupDate || trip.date_from,
    pickupTime: c.pickupTime || '10:00',
    dropoffDate: c.dropoffDate || trip.date_to,
    dropoffTime: c.dropoffTime || '10:00',
  };
}

r.post('/estimate/flight', async (req, res) => {
  const { airfare = {}, trip = {} } = req.body || {};
  const input = flightInput(airfare, trip);
  if (!input.origin || !input.destination || !input.departDate) return res.status(400).json({ error: 'Origin, destination and departure date are required' });
  res.json({ estimate: await estimateFlight(input) });
});

r.post('/estimate/car', async (req, res) => {
  const { car = {}, trip = {} } = req.body || {};
  const input = carInput(car, trip);
  if (!input.location || !input.pickupDate || !input.dropoffDate) return res.status(400).json({ error: 'Location and dates are required' });
  res.json({ estimate: await estimateCar(input) });
});

// Re-price every upcoming trip that uses estimated airfare or an estimated rental car.
r.post('/refresh', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const trips = db.prepare(`${SELECT} WHERE t.date_to >= ?`).all(today).map(hydrate);
  let updated = 0;
  for (const trip of trips) {
    let changed = false;
    if (trip.airfare?.mode === 'estimated') {
      trip.airfare.estimate = { ...(await estimateFlight(flightInput(trip.airfare, trip))), key: trip.airfare.estimate?.key };
      changed = true;
    }
    if (trip.car?.enabled && trip.car.mode !== 'booked') {
      trip.car.estimate = { ...(await estimateCar(carInput(trip.car, trip))), key: trip.car.estimate?.key };
      changed = true;
    }
    if (changed) {
      db.prepare(`UPDATE trips SET airfare = ?, car = ?, total_estimate = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(json.str(trip.airfare), json.str(trip.car), tripCosts(trip).total, trip.id);
      updated++;
    }
  }
  res.json({ updated });
});

export default r;
