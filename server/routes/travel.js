import { Router } from 'express';
import { db, json, withTeams } from '../db.js';
import { estimateFlight, estimateCar, mcpStatus, VEHICLE_CLASSES, placeLabel } from '../services/estimators.js';
import { mileageRate } from '../services/gsa.js';
import { focusTravel } from '../focus.js';
import { quarterFor, tripCosts, upcomingQuarters, lockTotal, LOCK_FIELDS, PURPOSES, flightPrefs, isQuarter, quarterStart, quarterMonths } from '../../src/lib/travelCalc.js';

const r = Router();

const JSON_COLS = { purposes: [], location_from: {}, location_to: {}, airfare: {}, pov: {}, car: {}, lodging: [], mie: {}, events: [] };

function hydrate(row) {
  if (!row) return null;
  const t = { ...row };
  for (const [k, d] of Object.entries(JSON_COLS)) t[k] = json.parse(row[k], d);
  t.locked_estimate = json.parse(row.locked_estimate, null);
  return t;
}

const SELECT = `SELECT t.*, u.first_name || ' ' || u.last_name AS traveler_name, a.first_name || ' ' || a.last_name AS approver_name
  FROM trips t JOIN users u ON u.id = t.traveler_id LEFT JOIN users a ON a.id = t.approved_by`;

// ---- Approval: every saved trip is a travel request for a lead of one of the traveler's teams to approve.

/** Who approves someone's travel: the leads of their teams, or the admins when none of their teams has a lead. */
export function approversFor(travelerId) {
  const leads = db.prepare(`SELECT DISTINCT user_id AS id FROM user_teams WHERE role = 'lead' AND user_id != @t
    AND team_id IN (SELECT team_id FROM user_teams WHERE user_id = @t)`).all({ t: travelerId }).map((x) => x.id);
  if (leads.length) return leads;
  return db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1 AND id != ?").all(travelerId).map((x) => x.id);
}
/** Admins can decide any request but their own; leads, those of people on their teams. */
const canApprove = (user, trip) => trip.traveler_id !== user.id && (user.role === 'admin' || approversFor(trip.traveler_id).includes(user.id));
const withApproval = (user) => (t) => ({ ...t, can_approve: !!t.approval && canApprove(user, t) });

const alertTrip = (userIds, actorId, kind, tripId, excerpt = null) => {
  const ins = db.prepare('INSERT INTO alerts (user_id, actor_id, kind, trip_id, excerpt) VALUES (?, ?, ?, ?, ?)');
  userIds.forEach((uid) => ins.run(uid, actorId, kind, tripId, excerpt));
};
/** A request (re)submitted for approval: its approvers hear about it. */
function submitted(trip, actorId) {
  db.prepare("DELETE FROM alerts WHERE trip_id = ? AND kind = 'travel_request' AND read_at IS NULL").run(trip.id);
  alertTrip(approversFor(trip.traveler_id).filter((id) => id !== actorId), actorId, 'travel_request', trip.id);
}

/** What a trip is for, as a note on its actual cost entry: its event, or where it goes. */
function tripLabel(trip) {
  const event = trip.event_id && db.prepare('SELECT name FROM events WHERE id = ?').get(trip.event_id)?.name;
  return `Trip: ${event || [trip.location_to?.city, trip.location_to?.state].filter(Boolean).join(', ') || 'trip'}`;
}

/**
 * Locking a trip's estimate is how its actual costs are entered, so a locked trip has one actual cost entry for its
 * locked total, dated when the trip starts. Unlocking removes it.
 */
function syncActual(trip, byId) {
  if (!trip.locked_estimate || !(trip.total_estimate > 0)) return db.prepare('DELETE FROM travel_actuals WHERE trip_id = ?').run(trip.id);
  const row = db.prepare('SELECT id FROM travel_actuals WHERE trip_id = ?').get(trip.id);
  if (row) {
    db.prepare("UPDATE travel_actuals SET traveler_id = ?, spent_on = ?, amount = ?, updated_at = datetime('now') WHERE id = ?")
      .run(trip.traveler_id, trip.date_from, trip.total_estimate, row.id);
  } else {
    db.prepare('INSERT INTO travel_actuals (traveler_id, spent_on, amount, note, created_by, trip_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(trip.traveler_id, trip.date_from, trip.total_estimate, tripLabel(trip), byId, trip.id);
  }
}

function validate(b = {}) {
  if (!b.traveler_id) return 'Traveler is required';
  if (!b.date_from || !b.date_to) return 'Travel dates are required';
  if (b.date_to < b.date_from) return 'Date To must be on or after Date From';
  if (!Array.isArray(b.purposes) || !b.purposes.length) return 'Select at least one general purpose';
  if (b.purposes.some((p) => !PURPOSES.includes(p))) return 'Invalid purpose';
  return null;
}

function toRow(b, lock = null) {
  const row = {
    traveler_id: Number(b.traveler_id),
    details: b.details || null,
    date_from: b.date_from,
    date_to: b.date_to,
    quarter: quarterFor(b.date_from),
    train: b.train === '' || b.train == null ? null : Number(b.train),
    total_estimate: lock ? lock.total : tripCosts(b).total,
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

// A team filter matches trips by anyone on that team whose travel counts there (BD Team's Travel switch; someone with a
// travel budget of their own is left out).
const ON_TEAM = 'traveler_id IN (SELECT user_id FROM user_teams WHERE team_id = @team AND in_travel = 1)';
// The calendar quarter an actual cost falls in, from its date: "2026 Q4".
const ACTUAL_QUARTER = "substr(a.spent_on, 1, 4) || ' Q' || ((CAST(substr(a.spent_on, 6, 2) AS INTEGER) + 2) / 3)";

/**
 * Trips, with each quarter's totals for the same traveler or team (whatever the Quarter filter): what its trips are
 * estimated at, and what was actually spent in it. Someone with focus on gets only their own travel here and in the
 * outlook and actual costs below (see focusTravel).
 */
r.get('/', (req, res) => {
  const scope = [];
  const params = {};
  if (req.query.traveler) { scope.push('t.traveler_id = @traveler'); params.traveler = Number(req.query.traveler); }
  if (req.query.team) { scope.push(`t.${ON_TEAM}`); params.team = Number(req.query.team); }
  const focus = { t: focusTravel(req.user, 't'), a: focusTravel(req.user, 'a', { actuals: true }) };
  const where = [...scope, focus.t].filter(Boolean);
  if (req.query.quarter) { where.push('t.quarter = @quarter'); params.quarter = req.query.quarter; }
  const rows = db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.date_from DESC`).all(params);
  const quarters = {};
  const scoped = (alias) => {
    const parts = [...scope.map((s) => s.replace('t.', `${alias}.`)), focus[alias]].filter(Boolean);
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  };
  for (const q of db.prepare(`SELECT t.quarter, COALESCE(SUM(t.total_estimate), 0) AS total FROM trips t ${scoped('t')} GROUP BY t.quarter`).all(params)) {
    quarters[q.quarter] = { estimated: q.total, actual: 0 };
  }
  for (const q of db.prepare(`SELECT ${ACTUAL_QUARTER} AS quarter, COALESCE(SUM(a.amount), 0) AS total FROM travel_actuals a ${scoped('a')} GROUP BY 1`).all(params)) {
    quarters[q.quarter] = { estimated: 0, ...quarters[q.quarter], actual: q.total };
  }
  res.json({ trips: withTravelerTeams(rows.map(hydrate)).map(withApproval(req.user)), quarters });
});

/** Requests waiting on the signed-in user's decision, whatever the filters. */
r.get('/awaiting', (req, res) => {
  const rows = db.prepare(`${SELECT} WHERE t.approval = 'pending' ORDER BY t.date_from`).all().map(hydrate).filter((t) => canApprove(req.user, t));
  res.json({ trips: withTravelerTeams(rows).map(withApproval(req.user)) });
});

/** Estimated spend for four quarters from ?start (default this quarter), optionally for one traveler or team. */
r.get('/outlook', (req, res) => {
  const quarters = upcomingQuarters(4, isQuarter(req.query.start) ? quarterStart(req.query.start) : undefined);
  const traveler = Number(req.query.traveler) || null;
  const team = Number(req.query.team) || null;
  const rows = db.prepare(`SELECT quarter, COUNT(*) AS trips, COALESCE(SUM(total_estimate), 0) AS total FROM trips
    WHERE quarter IN (SELECT value FROM json_each(@quarters)) AND (@traveler IS NULL OR traveler_id = @traveler)
    AND (@team IS NULL OR ${ON_TEAM}) AND ${focusTravel(req.user, 'trips') || '1'}
    GROUP BY quarter`).all({ quarters: JSON.stringify(quarters), traveler, team });
  res.json({ quarters: quarters.map((q) => ({ quarter: q, trips: 0, total: 0, ...rows.find((r) => r.quarter === q) })) });
});

// ---- Actual spend: what travel really cost, entered as one total per traveler

const actualFilter = (q, user, alias = 'a') => {
  const where = [focusTravel(user, alias, { actuals: alias === 'a' })].filter(Boolean);
  const params = {};
  if (q.traveler) { where.push(`${alias}.traveler_id = @traveler`); params.traveler = Number(q.traveler); }
  if (q.team) { where.push(`${alias}.${ON_TEAM}`); params.team = Number(q.team); }
  return { where, params };
};
const ACTUAL_SQL = `SELECT a.*, u.first_name || ' ' || u.last_name AS traveler_name FROM travel_actuals a JOIN users u ON u.id = a.traveler_id`;

/** Actual spend entries, newest first. ?traveler, ?team, ?quarter ("2026 Q4"). */
r.get('/actuals', (req, res) => {
  const { where, params } = actualFilter(req.query, req.user);
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

/**
 * A quarter's actual spend by month and in all, beside what its trips are estimated at (a trip counts in the month it
 * starts). ?quarter ("2026 Q4", default this quarter), ?traveler, ?team.
 */
r.get('/actuals/summary', (req, res) => {
  const quarter = isQuarter(req.query.quarter) ? req.query.quarter : upcomingQuarters(1)[0];
  const months = quarterMonths(quarter);
  const { where, params } = actualFilter(req.query, req.user);
  const rows = db.prepare(`SELECT substr(a.spent_on, 1, 7) AS month, COUNT(*) AS entries, SUM(a.amount) AS total FROM travel_actuals a
    WHERE substr(a.spent_on, 1, 7) IN (SELECT value FROM json_each(@months)) ${where.length ? `AND ${where.join(' AND ')}` : ''}
    GROUP BY month`).all({ ...params, months: JSON.stringify(months) });
  const est = actualFilter(req.query, req.user, 't');
  const trips = db.prepare(`SELECT substr(t.date_from, 1, 7) AS month, COUNT(*) AS trips, COALESCE(SUM(t.total_estimate), 0) AS estimated FROM trips t
    WHERE substr(t.date_from, 1, 7) IN (SELECT value FROM json_each(@months)) ${est.where.length ? `AND ${est.where.join(' AND ')}` : ''}
    GROUP BY month`).all({ ...est.params, months: JSON.stringify(months) });
  const byMonth = months.map((month) => ({ month, entries: 0, total: 0, trips: 0, estimated: 0, ...rows.find((r) => r.month === month), ...trips.find((r) => r.month === month) }));
  const sum = (k) => byMonth.reduce((s, m) => s + m[k], 0);
  res.json({ quarter, months: byMonth, total: sum('total'), entries: sum('entries'), estimated: sum('estimated'), trips: sum('trips') });
});

/** An actual cost entry that comes from a locked trip changes with the trip, not here. */
const fromTrip = (id) => db.prepare('SELECT trip_id FROM travel_actuals WHERE id = ?').get(id)?.trip_id;

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
  if (fromTrip(req.params.id)) return res.status(400).json({ error: 'This cost comes from a locked trip. Change it on the trip.' });
  const { data, error } = actualFields(req.body);
  if (error) return res.status(400).json({ error });
  const info = db.prepare(`UPDATE travel_actuals SET traveler_id = @traveler_id, spent_on = @spent_on, amount = @amount, note = @note, updated_at = datetime('now')
    WHERE id = @id`).run({ ...data, id: Number(req.params.id) });
  if (!info.changes) return res.status(404).json({ error: 'Entry not found' });
  res.json({ actual: db.prepare(`${ACTUAL_SQL} WHERE a.id = ?`).get(req.params.id) });
});

r.delete('/actuals/:id', (req, res) => {
  if (fromTrip(req.params.id)) return res.status(400).json({ error: 'This cost comes from a locked trip. Unlock the trip to remove it.' });
  db.prepare('DELETE FROM travel_actuals WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

r.get('/:id', (req, res) => {
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id));
  if (!trip) return res.status(404).json({ error: 'Not found' });
  res.json({ trip: withApproval(req.user)(trip) });
});

r.post('/', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const row = toRow(req.body);
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO trips (${cols.join(',')}, created_by, approval) VALUES (${cols.map((c) => '@' + c).join(',')}, @created_by, 'pending')`)
    .run({ ...row, created_by: req.user.id });
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(info.lastInsertRowid));
  submitted(trip, req.user.id);
  res.json({ trip: withApproval(req.user)(trip) });
});

r.put('/:id', (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  const before = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  const row = toRow(req.body, json.parse(before.locked_estimate, null));
  // A decided request goes back for approval when what was approved changes: who, when, where, or what it costs.
  const changed = ['traveler_id', 'date_from', 'date_to', 'location_to', 'total_estimate'].some((k) => String(row[k] ?? '') !== String(before[k] ?? ''));
  const resubmit = !before.approval || (before.approval !== 'pending' && changed);
  db.prepare(`UPDATE trips SET ${Object.keys(row).map((c) => `${c}=@${c}`).join(',')}, updated_at = datetime('now')
    ${resubmit ? ", approval = 'pending', approved_by = NULL, approved_at = NULL, approval_note = NULL" : ''} WHERE id = @id`)
    .run({ ...row, id: Number(req.params.id) });
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id));
  if (trip.locked_estimate) syncActual(trip, req.user.id);
  if (resubmit || (before.approval === 'pending' && row.traveler_id !== before.traveler_id)) submitted(trip, req.user.id);
  res.json({ trip: withApproval(req.user)(trip) });
});

/**
 * Set or clear a trip's locked estimate: its actual costs. Entering them doesn't send an approved request back for
 * approval; the locked total is recorded as actual travel spend.
 */
function setLock(req, res, lock) {
  const before = hydrate(db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id));
  if (!before) return res.status(404).json({ error: 'Not found' });
  const total = lock ? lock.total : tripCosts(before).total;
  db.prepare("UPDATE trips SET locked_estimate = ?, total_estimate = ?, updated_at = datetime('now') WHERE id = ?").run(lock ? json.str(lock) : null, total, before.id);
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(before.id));
  syncActual(trip, req.user.id);
  res.json({ trip: withApproval(req.user)(trip) });
}

/** Lock the estimate at the trip's actual costs. Body: { costs: { airfare, train, pov, car, lodging, mie, events }, override }; a blank override means none. */
r.put('/:id/lock', (req, res) => {
  const { costs: given = {}, override: rawOverride } = req.body || {};
  const blank = (v) => v === '' || v == null;
  const costs = Object.fromEntries(LOCK_FIELDS.map(([k]) => [k, blank(given[k]) ? 0 : Number(given[k])]));
  const override = blank(rawOverride) ? null : Number(rawOverride);
  if ([...Object.values(costs), override ?? 0].some((n) => !(n >= 0))) return res.status(400).json({ error: 'Amounts must be zero or more' });
  setLock(req, res, { costs, override, total: lockTotal(costs, override) });
});

/** Unlock the estimate: the trip goes back to its calculated total. */
r.delete('/:id/lock', (req, res) => setLock(req, res, null));

/** Approve or decline a travel request. Body: { decision: 'approved' | 'declined', note }. The traveler (and whoever made the request) gets an alert. */
r.post('/:id/approval', (req, res) => {
  const trip = hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(req.params.id));
  if (!trip) return res.status(404).json({ error: 'Not found' });
  if (!canApprove(req.user, trip)) return res.status(403).json({ error: 'Only a lead of one of the traveler’s teams can approve this request' });
  const decision = req.body?.decision;
  if (!['approved', 'declined'].includes(decision)) return res.status(400).json({ error: 'Approve or decline the request' });
  const note = String(req.body?.note || '').trim() || null;
  db.prepare("UPDATE trips SET approval = ?, approved_by = ?, approved_at = datetime('now'), approval_note = ? WHERE id = ?")
    .run(decision, req.user.id, note, trip.id);
  db.prepare("UPDATE alerts SET read_at = COALESCE(read_at, datetime('now')) WHERE trip_id = ? AND kind = 'travel_request'").run(trip.id);
  alertTrip([...new Set([trip.traveler_id, trip.created_by])].filter((id) => id && id !== req.user.id), req.user.id, 'travel_decision', trip.id, note);
  res.json({ trip: withApproval(req.user)(hydrate(db.prepare(`${SELECT} WHERE t.id = ?`).get(trip.id))) });
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
    ...flightPrefs(a),
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

// Re-price every upcoming trip that uses estimated airfare or an estimated rental car, leaving locked estimates alone.
r.post('/refresh', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const trips = db.prepare(`${SELECT} WHERE t.date_to >= ?`).all(today).map(hydrate);
  let updated = 0;
  for (const trip of trips) {
    if (trip.locked_estimate) continue;
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
