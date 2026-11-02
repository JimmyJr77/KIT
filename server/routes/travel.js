import { Router } from 'express';
import { db, json, withTeams } from '../db.js';
import { estimateFlight, estimateCar, mcpStatus, VEHICLE_CLASSES, placeLabel } from '../services/estimators.js';
import { mileageRate } from '../services/gsa.js';
import { quarterFor, tripCosts, upcomingQuarters, PURPOSES } from '../../src/lib/travelCalc.js';

const r = Router();

const JSON_COLS = { purposes: [], location_from: {}, location_to: {}, airfare: {}, pov: {}, car: {}, lodging: [], mie: {}, events: [] };

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

/** Each trip's traveler's teams: team_name ("BD, Marketing"). */
function withTravelerTeams(trips) {
  const teams = new Map(withTeams([...new Set(trips.map((t) => t.traveler_id))].map((id) => ({ id }))).map((u) => [u.id, u.team_name]));
  return trips.map((t) => ({ ...t, team_name: teams.get(t.traveler_id) || null }));
}

// A team filter matches trips by anyone on that team.
const ON_TEAM = 'traveler_id IN (SELECT user_id FROM user_teams WHERE team_id = @team)';

r.get('/', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.traveler) { where.push('t.traveler_id = @traveler'); params.traveler = Number(req.query.traveler); }
  if (req.query.team) { where.push(`t.${ON_TEAM}`); params.team = Number(req.query.team); }
  if (req.query.quarter) { where.push('t.quarter = @quarter'); params.quarter = req.query.quarter; }
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date_from DESC`).all(params);
  res.json({ trips: withTravelerTeams(rows.map(hydrate)) });
});

/** Estimated spend for this quarter and the next three, optionally for one traveler or team. */
r.get('/outlook', (req, res) => {
  const quarters = upcomingQuarters(4);
  const traveler = Number(req.query.traveler) || null;
  const team = Number(req.query.team) || null;
  const rows = db.prepare(`SELECT quarter, COUNT(*) AS trips, COALESCE(SUM(total_estimate), 0) AS total FROM trips
    WHERE quarter IN (SELECT value FROM json_each(@quarters)) AND (@traveler IS NULL OR traveler_id = @traveler)
    AND (@team IS NULL OR ${ON_TEAM})
    GROUP BY quarter`).all({ quarters: JSON.stringify(quarters), traveler, team });
  res.json({ quarters: quarters.map((q) => ({ quarter: q, trips: 0, total: 0, ...rows.find((r) => r.quarter === q) })) });
});

// ---- Actual spend: what travel really cost, entered as one total per traveler

const actualFilter = (q) => {
  const where = [];
  const params = {};
  if (q.traveler) { where.push('a.traveler_id = @traveler'); params.traveler = Number(q.traveler); }
  if (q.team) { where.push('a.traveler_id IN (SELECT user_id FROM user_teams WHERE team_id = @team)'); params.team = Number(q.team); }
  return { where, params };
};
const ACTUAL_SQL = `SELECT a.*, u.first_name || ' ' || u.last_name AS traveler_name FROM travel_actuals a JOIN users u ON u.id = a.traveler_id`;

/** Actual spend entries, newest first. ?traveler, ?team, ?quarter ("2026 Q4"). */
r.get('/actuals', (req, res) => {
  const { where, params } = actualFilter(req.query);
  const m = /^(\d{4}) Q([1-4])$/.exec(req.query.quarter || '');
  if (m) {
    const first = (Number(m[2]) - 1) * 3 + 1;
    where.push('a.spent_on >= @from AND a.spent_on < @to');
    params.from = `${m[1]}-${String(first).padStart(2, '0')}-01`;
    params.to = first === 10 ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(first + 3).padStart(2, '0')}-01`;
  }
  const rows = db.prepare(`${ACTUAL_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.spent_on DESC, a.id DESC`).all(params);
  res.json({ actuals: withTravelerTeams(rows).map((a) => ({ ...a, quarter: quarterFor(a.spent_on) })) });
});

/** This quarter's actual spend by month, and in all. ?traveler, ?team. */
r.get('/actuals/summary', (req, res) => {
  const [quarter] = upcomingQuarters(1);
  const [y, q] = quarter.split(' Q').map(Number);
  const months = [0, 1, 2].map((i) => `${y}-${String((q - 1) * 3 + 1 + i).padStart(2, '0')}`);
  const { where, params } = actualFilter(req.query);
  const rows = db.prepare(`SELECT substr(a.spent_on, 1, 7) AS month, COUNT(*) AS entries, SUM(a.amount) AS total FROM travel_actuals a
    WHERE substr(a.spent_on, 1, 7) IN (SELECT value FROM json_each(@months)) ${where.length ? `AND ${where.join(' AND ')}` : ''}
    GROUP BY month`).all({ ...params, months: JSON.stringify(months) });
  const byMonth = months.map((month) => ({ month, entries: 0, total: 0, ...rows.find((r) => r.month === month) }));
  res.json({ quarter, months: byMonth, total: byMonth.reduce((s, m) => s + m.total, 0), entries: byMonth.reduce((s, m) => s + m.entries, 0) });
});

function actualFields(b = {}) {
  const amount = Number(String(b.amount ?? '').replace(/[$,]/g, ''));
  if (!Number(b.traveler_id) || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(Number(b.traveler_id))) return { error: 'Choose the traveler' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.spent_on || '')) return { error: 'Choose the date' };
  if (!(amount > 0)) return { error: 'Enter the total spent' };
  return { data: { traveler_id: Number(b.traveler_id), spent_on: b.spent_on, amount: Math.round(amount * 100) / 100, note: String(b.note || '').trim() || null } };
}

r.post('/actuals', (req, res) => {
  const { data, error } = actualFields(req.body);
  if (error) return res.status(400).json({ error });
  const id = db.prepare(`INSERT INTO travel_actuals (traveler_id, spent_on, amount, note, created_by) VALUES (@traveler_id, @spent_on, @amount, @note, @by)`)
    .run({ ...data, by: req.user.id }).lastInsertRowid;
  res.json({ actual: db.prepare(`${ACTUAL_SQL} WHERE a.id = ?`).get(id) });
});

r.put('/actuals/:id', (req, res) => {
  const { data, error } = actualFields(req.body);
  if (error) return res.status(400).json({ error });
  const info = db.prepare(`UPDATE travel_actuals SET traveler_id = @traveler_id, spent_on = @spent_on, amount = @amount, note = @note, updated_at = datetime('now')
    WHERE id = @id`).run({ ...data, id: Number(req.params.id) });
  if (!info.changes) return res.status(404).json({ error: 'Entry not found' });
  res.json({ actual: db.prepare(`${ACTUAL_SQL} WHERE a.id = ?`).get(req.params.id) });
});

r.delete('/actuals/:id', (req, res) => {
  db.prepare('DELETE FROM travel_actuals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
