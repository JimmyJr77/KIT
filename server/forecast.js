// Forecast snapshots, for the BD report card's forecast reliability measure: early in each quarter, record what every
// open bid expected to close that quarter was forecast to bring in (value × PWIN). Bookings at the end of the quarter
// are then compared with that.
import { db, json, getSetting, setSetting } from './db.js';
import { quarterFor } from '../src/lib/travelCalc.js';
import { pwin } from '../src/lib/assessment.js';
import { pwinModel } from './routes/tickets.js';

const CLOSED = ['Awarded', 'Lost', 'No Bid'];
const localToday = () => new Date().toLocaleDateString('en-CA');

/** First and last day of a quarter like "2026 Q4". */
export function quarterRange(quarter) {
  const [y, q] = quarter.split(' Q').map(Number);
  const start = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10);
  return { start, end };
}

/**
 * Snapshot the forecast for the quarter containing `date`, once. It waits until at least one open bid has a projected
 * win date in that quarter, so a quarter isn't marked done with nothing in it. Returns how many bids it recorded.
 */
export function snapshotForecast(date = localToday()) {
  const quarter = quarterFor(date);
  const key = `forecast_snapshot:${quarter}`;
  if (getSetting(key)) return 0;
  const { start, end } = quarterRange(quarter);
  const bids = db.prepare(`SELECT * FROM tickets WHERE ticket_type = 'bid' AND projected_win_date BETWEEN ? AND ?
    AND (pipeline_status IS NULL OR pipeline_status NOT IN (SELECT value FROM json_each(?)))`).all(start, end, JSON.stringify(CLOSED));
  if (!bids.length) return 0;
  const model = pwinModel();
  const add = db.prepare(`INSERT INTO forecast_snapshots (quarter, taken_on, ticket_id, opportunity_title, bd_director_id, territory_id,
    pipeline_status, value, pwin, weighted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    bids.forEach((t) => {
      const p = pwin(json.parse(t.assessment, {}), model.weights, model.gates);
      const share = p ? p.score / 100 : null;
      add.run(quarter, date, t.id, t.opportunity_title, t.bd_director_id, t.territory_id, t.pipeline_status, t.value,
        share, t.value == null ? null : share == null ? t.value : t.value * share);
    });
    setSetting(key, date);
  })();
  return bids.length;
}

/** Check now and every few hours, so each quarter's snapshot is taken soon after the quarter starts. */
export function scheduleForecastSnapshots() {
  const run = () => { try { snapshotForecast(); } catch (e) { console.error('forecast snapshot:', e.message); } };
  run();
  setInterval(run, 6 * 60 * 60 * 1000).unref();
}
