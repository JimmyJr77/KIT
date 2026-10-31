// Sample BD financials for a local dev database, so the dashboards have something to show: projected win dates and
// win assessments on open bids, a backdated stage history, past awards and losses, funding and billing on contracts,
// booking targets, and account objectives. Runs once (`npm run seed:demo-financials`); refuses in production.
import 'dotenv/config';
import { db, json, getSetting, setSetting } from '../db.js';
import { CRITERIA } from '../../src/lib/assessment.js';
import { addDays, quarterFor } from '../../src/lib/travelCalc.js';

if (process.env.NODE_ENV === 'production') throw new Error('Demo data cannot be seeded in production.');
if (getSetting('demo_financials')) {
  console.log('Demo financials are already here. Restore a backup of the database to start over.');
  process.exit(0);
}

let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const today = new Date().toLocaleDateString('en-CA');
const stamp = (iso, time = '14:00:00') => `${iso} ${time}`;
const STAGES = ['Identified', 'Qualified', 'Capture', 'Proposal', 'Submitted'];
const CLOSED = ['Awarded', 'Lost', 'No Bid'];

const directors = db.prepare(`SELECT u.id FROM users u JOIN user_teams ut ON ut.user_id = u.id JOIN teams t ON t.id = ut.team_id
  WHERE t.name = 'BD' AND u.active = 1`).all().map((u) => u.id);
const territories = db.prepare('SELECT id, name FROM territories ORDER BY position').all();
const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
if (!directors.length || !territories.length) throw new Error('Seed people and territories first (npm run seed:demo-data, then start the server once).');

/** A win assessment rated 2–5 in most areas, so PWIN has something to work from. */
const assessment = (strong) => Object.fromEntries(CRITERIA.map((c) => [c.key, { score: strong ? int(3, 5) : int(2, 4) }]));

/** Replace a bid's history with a believable climb through the stages, from creation to where it is now. */
function backdateHistory(t, finalStatus, closedOn) {
  db.prepare('DELETE FROM ticket_history WHERE ticket_id = ?').run(t.id);
  const created = t.created_at.slice(0, 10);
  const end = closedOn || today;
  const path = CLOSED.includes(finalStatus) ? STAGES.slice(0, int(2, 5)).concat(finalStatus) : STAGES.slice(0, STAGES.indexOf(finalStatus) + 1);
  const span = Math.max(1, (Date.parse(end) - Date.parse(created)) / 864e5);
  const add = db.prepare(`INSERT INTO ticket_history (ticket_id, pipeline_status, value, bd_director_id, territory_id, projected_win_date,
    win_date_undetermined, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  path.forEach((stage, i) => {
    const day = i === path.length - 1 && closedOn ? closedOn : addDays(created, Math.round((span * i) / path.length));
    // Values often grow as a pursuit firms up.
    const value = Math.round((t.value * (0.7 + (0.3 * (i + 1)) / path.length)) / 1000) * 1000;
    add.run(t.id, stage, i === path.length - 1 ? t.value : value, t.bd_director_id, t.territory_id, t.projected_win_date, t.win_date_undetermined, stamp(day));
  });
}

db.transaction(() => {
  // ---- Open bids: a director and territory for any missing, a projected win date (a few undetermined, one left unset),
  // and a win assessment on most.
  const open = db.prepare(`SELECT * FROM tickets WHERE ticket_type = 'bid' AND (pipeline_status IS NULL OR pipeline_status NOT IN ('Awarded', 'Lost', 'No Bid'))`).all();
  open.forEach((t, i) => {
    const director = t.bd_director_id || pick(directors);
    const territory = t.territory_id || pick(territories).id;
    const undetermined = i % 6 === 2;
    const unset = i === open.length - 1;
    const date = undetermined || unset ? null : addDays(today, int(15, 400));
    const assess = i % 4 === 3 ? null : json.str(assessment(['Proposal', 'Submitted'].includes(t.pipeline_status)));
    db.prepare(`UPDATE tickets SET bd_director_id = ?, territory_id = ?, projected_win_date = ?, win_date_undetermined = ?,
      assessment = COALESCE(assessment, ?) WHERE id = ?`).run(director, territory, date, undetermined ? 1 : 0, assess, t.id);
    backdateHistory(db.prepare('SELECT * FROM tickets WHERE id = ?').get(t.id), t.pipeline_status || 'Identified');
  });

  // ---- Closed bids across the last five quarters: wins (which become delivery programs) and losses, for bookings,
  // win rate and book-to-bill.
  const PAST = [
    ['Joint Logistics Data Hub', 'DLA J6', 'Awarded', 9_200_000, 420], ['Space Domain Awareness Analytics', 'Space Systems Command', 'Awarded', 14_500_000, 330],
    ['Fleet Readiness Portal', 'NAVSEA', 'Awarded', 6_800_000, 250], ['Intel Data Lake Modernization', 'DIA', 'Awarded', 22_000_000, 160],
    ['Border Analytics Pilot', 'CBP', 'Awarded', 4_100_000, 70], ['Army Training Records Cloud', 'Army TRADOC', 'Lost', 11_000_000, 300],
    ['FBI Case Data Migration', 'FBI CJIS', 'Lost', 8_500_000, 200], ['Marine Corps Wargaming Lab', 'MCWL', 'Lost', 5_000_000, 110],
    ['DHS Mobile Inspection App', 'DHS S&T', 'No Bid', 3_200_000, 90], ['NGA Imagery Tagging', 'NGA', 'Awarded', 7_400_000, 30],
  ];
  const terrByOrg = (org) => territories.find((t) => t.name === ({
    'DLA J6': 'DoD 4th Estate', 'Space Systems Command': 'Air Force & Space Force', NAVSEA: 'Navy / Marine Corps', DIA: 'Intelligence Community (Agencies)',
    CBP: 'DHS & FBI', 'Army TRADOC': 'Army', 'FBI CJIS': 'DHS & FBI', MCWL: 'Navy / Marine Corps', 'DHS S&T': 'DHS & FBI', NGA: 'Intelligence Community (Agencies)',
  })[org])?.id ?? null;
  PAST.forEach(([title, org, status, value, daysAgo]) => {
    const closed = addDays(today, -daysAgo);
    const created = addDays(closed, -int(120, 260));
    const director = pick(directors);
    const id = db.prepare(`INSERT INTO tickets (opportunity_title, organization, pipeline_status, value, ticket_type, created_by, created_at, updated_at,
        bd_director_id, territory_id, projected_win_date, assessment) VALUES (?, ?, ?, ?, 'bid', ?, ?, ?, ?, ?, ?, ?)`)
      .run(title, org, status, value, director, stamp(created), stamp(closed), director, terrByOrg(org), addDays(closed, int(-30, 30)), json.str(assessment(status === 'Awarded'))).lastInsertRowid;
    db.prepare('UPDATE tickets SET done_at = ? WHERE id = ?').run(stamp(closed), id);
    backdateHistory(db.prepare('SELECT * FROM tickets WHERE id = ?').get(id), status, closed);
    if (status === 'Awarded') db.prepare('UPDATE delivery_programs SET awarded_at = ? WHERE ticket_id = ?').run(stamp(closed), id);
  });

  // ---- Every contract: funding received in increments, and monthly billing since award.
  const programs = db.prepare('SELECT * FROM delivery_programs').all();
  const addEntry = db.prepare('INSERT INTO program_entries (program_id, kind, amount, entry_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  programs.forEach((p) => {
    if (!p.value) return;
    if (db.prepare('SELECT 1 FROM program_entries WHERE program_id = ?').get(p.id)) return; // keep anything entered by hand
    const awarded = p.awarded_at.slice(0, 10);
    const fundedShare = 0.35 + rand() * 0.5;
    const increments = int(1, 3);
    for (let i = 0; i < increments; i++) {
      const on = addDays(awarded, i * 120);
      if (on > today) break;
      addEntry.run(p.id, 'funding', Math.round((p.value * fundedShare) / increments / 1000) * 1000, on, i ? `Incremental funding ${i}` : 'Initial obligation', admin.id);
    }
    const monthly = p.value / int(30, 48);
    for (let d = addDays(awarded, 30); d <= today; d = addDays(d, 30)) addEntry.run(p.id, 'billing', Math.round(monthly * (0.85 + rand() * 0.3)), d, 'Monthly invoice', admin.id);
  });

  // ---- Booking targets: each director, each quarter of this year and next.
  const year = Number(today.slice(0, 4));
  const setTarget = db.prepare('INSERT OR REPLACE INTO booking_targets (user_id, year, quarter, amount, updated_by) VALUES (?, ?, ?, ?, ?)');
  directors.forEach((id) => [year, year + 1].forEach((y) => [1, 2, 3, 4].forEach((q) => setTarget.run(id, y, q, int(3, 9) * 1_000_000, admin.id))));

  // ---- Account objectives: a few per director, some done.
  const OBJ = ['Brief the program office on our data platform', 'Meet the new contracting officer', 'Get our approach into the draft requirement',
    'Introduce our CTO to the chief engineer', 'Host a capability demo for the requirements team', 'Secure an invite to the industry day'];
  const STATUSES = ['Not started', 'In progress', 'In progress', 'Achieved', 'Missed'];
  const orgs = db.prepare("SELECT DISTINCT organization FROM tickets WHERE organization IS NOT NULL AND ticket_type = 'bid'").all().map((o) => o.organization);
  directors.forEach((id) => {
    for (let i = int(1, 3); i > 0; i--) {
      const status = pick(STATUSES);
      const target = addDays(today, int(-60, 120));
      db.prepare(`INSERT INTO account_objectives (organization, territory_id, owner_id, objective, target_date, status, created_by, created_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(pick(orgs), pick(territories).id, id, pick(OBJ), target, status, id, stamp(addDays(today, -int(20, 120))),
        ['Achieved', 'Missed'].includes(status) ? stamp(addDays(target, -int(0, 20))) : null);
    }
  });

  // ---- Last quarter's forecast, so forecast reliability has a past quarter to compare with.
  const lastQuarterDay = addDays(today, -95);
  const lastQuarter = quarterFor(lastQuarterDay);
  if (!getSetting(`forecast_snapshot:${lastQuarter}`)) {
    const wins = db.prepare(`SELECT * FROM tickets WHERE ticket_type = 'bid' AND projected_win_date BETWEEN ? AND ?`)
      .all(`${lastQuarter.slice(0, 4)}-${String((Number(lastQuarter.slice(-1)) - 1) * 3 + 1).padStart(2, '0')}-01`, `${lastQuarter.slice(0, 4)}-${String(Number(lastQuarter.slice(-1)) * 3).padStart(2, '0')}-31`);
    wins.forEach((t) => db.prepare(`INSERT INTO forecast_snapshots (quarter, taken_on, ticket_id, opportunity_title, bd_director_id, territory_id, pipeline_status, value, pwin, weighted)
      VALUES (?, ?, ?, ?, ?, ?, 'Submitted', ?, 0.55, ?)`).run(lastQuarter, lastQuarterDay, t.id, t.opportunity_title, t.bd_director_id, t.territory_id, t.value, t.value * 0.55));
    setSetting(`forecast_snapshot:${lastQuarter}`, lastQuarterDay);
  }

  setSetting('demo_financials', today);
})();

const n = (sql) => db.prepare(sql).get().n;
console.log(`Demo financials added: ${n("SELECT COUNT(*) AS n FROM tickets WHERE ticket_type = 'bid'")} bids, ${n('SELECT COUNT(*) AS n FROM delivery_programs')} contracts, `
  + `${n('SELECT COUNT(*) AS n FROM program_entries')} funding/billing entries, ${n('SELECT COUNT(*) AS n FROM booking_targets')} targets, `
  + `${n('SELECT COUNT(*) AS n FROM account_objectives')} objectives, ${n('SELECT COUNT(*) AS n FROM ticket_history')} history rows.`);
