// SQLite data layer. All SQL lives in server/ so the backing store can be
// swapped (e.g. Postgres) later without touching the React app.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.resolve('server/data/kit.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// While the sample data is hidden, temporary views stand in for the tables (see server/sample/registry.js), and views
// can't be written to. So every write names the real table: "UPDATE tickets" runs as "UPDATE main.tickets".
const WRITE = /^(\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM)\s+)("?)(\w+)\2(?![\w.])/i;
const prepare = db.prepare.bind(db);
db.prepare = (sql) => prepare(sql.replace(WRITE, (m, verb, q, name) => `${verb}main.${q}${name}${q}`));

export const TEAMS = ['BD', 'Operations', 'Technical Solutioning', 'Marketing', 'Admin'];

export const DEFAULT_SETTINGS = {
  // GSA FY2027 standard CONUS rate (overwritten by the GSA file on import).
  // The POV mileage rate is set per calendar year; verify the 2027 rate.
  gsa_fiscal_year: '2027',
  conus_lodging: '113',
  conus_mie: '68',
  pov_mileage_rate: '0.725',
};

db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  checkin_dow INTEGER NOT NULL DEFAULT 1 -- 0=Sun ... 6=Sat
);

CREATE TABLE IF NOT EXISTS approved_accounts (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  role TEXT NOT NULL DEFAULT 'member',
  added_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  phone_digits TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  title TEXT,
  team_id INTEGER REFERENCES teams(id),
  role TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS gsa_rates (
  id INTEGER PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  state TEXT NOT NULL,
  destination TEXT NOT NULL,
  county TEXT,
  season_begin TEXT, -- MM-DD
  season_end TEXT,   -- MM-DD
  lodging REAL NOT NULL,
  mie REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS gsa_rates_lookup ON gsa_rates(fiscal_year, state, destination);

CREATE TABLE IF NOT EXISTS gsa_cache (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY,
  traveler_id INTEGER NOT NULL REFERENCES users(id),
  purposes TEXT NOT NULL DEFAULT '[]',
  location_from TEXT NOT NULL DEFAULT '{}',
  location_to TEXT NOT NULL DEFAULT '{}',
  details TEXT,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  quarter TEXT NOT NULL,
  airfare TEXT NOT NULL DEFAULT '{}',
  train REAL,
  pov TEXT NOT NULL DEFAULT '{}',
  car TEXT NOT NULL DEFAULT '{}',
  lodging TEXT NOT NULL DEFAULT '[]',
  mie TEXT NOT NULL DEFAULT '{}',
  total_estimate REAL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A ticket is the larger assignment / opportunity. Priority cards are the
-- weekly steps taken against it.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  opportunity_title TEXT NOT NULL,
  organization TEXT,
  pipeline_status TEXT,
  value REAL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS priority_cards (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  week_start TEXT NOT NULL, -- YYYY-MM-DD, the team's check-in date
  title TEXT,
  due_date TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  is_planned INTEGER NOT NULL DEFAULT 1, -- 0 = new work added after check-in
  completed INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS cards_week ON priority_cards(team_id, week_start);

CREATE TABLE IF NOT EXISTS card_assignees (
  card_id INTEGER NOT NULL REFERENCES priority_cards(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  position INTEGER NOT NULL DEFAULT 0, -- 0 = top priority (left-most)
  PRIMARY KEY (card_id, user_id)
);

-- Each note on a priority card is its own entry.
CREATE TABLE IF NOT EXISTS card_notes (
  id INTEGER PRIMARY KEY,
  card_id INTEGER NOT NULL REFERENCES priority_cards(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS card_notes_card ON card_notes(card_id);

-- Questions and comments on a master ticket, optionally about one priority card.
-- Replies point at their thread with parent_id.
CREATE TABLE IF NOT EXISTS ticket_comments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES priority_cards(id) ON DELETE SET NULL,
  parent_id INTEGER REFERENCES ticket_comments(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'comment', -- question | comment | reply
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ticket_comments_ticket ON ticket_comments(ticket_id);

-- A team's planning for a week is open until someone closes it. While closed,
-- new cards are work tickets (is_planned = 0) instead of priorities.
CREATE TABLE IF NOT EXISTS week_planning (
  team_id INTEGER NOT NULL REFERENCES teams(id),
  week_start TEXT NOT NULL,
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by INTEGER REFERENCES users(id),
  PRIMARY KEY (team_id, week_start)
);

-- Additional work: actions someone took while their team's planning for the week
-- was closed (notes, documents, questions, comments, replies, finished tasks...).
CREATE TABLE IF NOT EXISTS work_log (
  id INTEGER PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  week_start TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL, -- note | file | question | comment | reply | task | completed | ticket | step
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES priority_cards(id) ON DELETE SET NULL,
  ref_id INTEGER, -- the note, file or comment the action created
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS work_log_week ON work_log(team_id, week_start);

-- Documents uploaded to a master ticket. Files live in server/data/uploads.
CREATE TABLE IF NOT EXISTS ticket_files (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`
-- Conferences, industry days, and other events people may attend.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  description TEXT,
  goal TEXT,          -- goal or benefit of attending
  fee REAL,
  website TEXT,
  poc_name TEXT,
  poc_phone TEXT,
  address TEXT,       -- street address
  location TEXT NOT NULL DEFAULT '{}', -- { intl, city, state, country }, used for travel estimates
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- Requests for marketing support at an event. Marketing turns each into a work ticket.
CREATE TABLE IF NOT EXISTS event_support_requests (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  details TEXT NOT NULL,
  requested_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open', -- open | accepted
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  accepted_by INTEGER REFERENCES users(id),
  accepted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_attendees (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, user_id)
);
`);

db.exec(`
-- CRM: people we know, where they work, and how well we know them.
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT,
  organization TEXT,   -- where they work
  role TEXT,           -- their title or role there
  email TEXT,
  phone TEXT,
  relationship INTEGER NOT NULL DEFAULT 0, -- 0 never spoke … 5 close personal relationship
  notes TEXT,          -- standing notes about the relationship
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- A log of interactions with a contact, newest first.
CREATE TABLE IF NOT EXISTS contact_interactions (
  id INTEGER PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS contact_interactions_contact ON contact_interactions(contact_id);
-- Which tickets a contact is involved in.
CREATE TABLE IF NOT EXISTS ticket_contacts (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (ticket_id, contact_id)
);
`);

/** A setting's saved value, for one-time migrations that run before the settings helpers are defined. */
const getSettingRaw = (key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
// Columns added after the first release of a table.
function addColumn(table, column, type) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
// A comment can sit under any timeline item: a priority card, note, file, or the ticket itself.
addColumn('ticket_comments', 'target_type', 'TEXT');
addColumn('ticket_comments', 'target_id', 'INTEGER');
addColumn('ticket_comments', 'updated_at', 'TEXT');
// The customer branch a master ticket belongs to (see ACCOUNT_TYPES).
addColumn('tickets', 'account_type', 'TEXT');
// bid: a ticket to win a contract (has a value and pipeline stage). work: everything else.
addColumn('tickets', 'ticket_type', "TEXT NOT NULL DEFAULT 'bid'");
// Capture planning on a ticket: free-text win strategy and the scored win assessment (JSON, see src/lib/assessment.js).
addColumn('tickets', 'strategy', 'TEXT');
addColumn('tickets', 'strategy_updated_at', 'TEXT');
addColumn('tickets', 'strategy_updated_by', 'INTEGER');
addColumn('tickets', 'assessment', 'TEXT');
addColumn('tickets', 'assessment_updated_at', 'TEXT');
addColumn('tickets', 'assessment_updated_by', 'INTEGER');
// A trip planned from an event links back to it.
addColumn('trips', 'event_id', 'INTEGER REFERENCES events(id) ON DELETE SET NULL');
addColumn('events', 'notes', 'TEXT'); // anything else worth knowing: who we're going with, sponsorships, overlaps
// Knexus Event Rep/POC: the people at Knexus who own an event (not necessarily attending).
db.exec(`CREATE TABLE IF NOT EXISTS event_reps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, user_id)
)`);
// Potential events the event scout (Gemini with Google Search) has found, waiting for someone to add them to the
// Events list. Refreshing appends to it; nothing is deleted. Dismissed ones stay so the scout doesn't suggest them again.
db.exec(`CREATE TABLE IF NOT EXISTS event_candidates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  date_from TEXT,       -- may be unknown until the organizer announces it
  date_to TEXT,
  description TEXT,
  goal TEXT,            -- value to Knexus: who we'd meet, which pursuits it supports
  notes TEXT,           -- deadlines, sponsorship, how sure the dates are
  fee REAL,
  website TEXT,
  poc_name TEXT,
  poc_phone TEXT,
  address TEXT,
  location TEXT NOT NULL DEFAULT '{}',
  relevance INTEGER,    -- 1 (marginal) … 5 (must attend)
  source TEXT NOT NULL DEFAULT 'refresh', -- refresh | search
  prompt TEXT,          -- the search that found it
  status TEXT NOT NULL DEFAULT 'open',    -- open | added | dismissed
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
// Signed up for an event as going, or as a maybe. Either way they have a travel request for it.
addColumn('event_attendees', 'status', "TEXT NOT NULL DEFAULT 'going'"); // going | maybe
// A saved trip is a travel request: a lead of one of the traveler's teams approves or declines it. NULL on trips
// from before approvals, until someone saves them again.
addColumn('trips', 'approval', 'TEXT'); // pending | approved | declined
addColumn('trips', 'approved_by', 'INTEGER REFERENCES users(id)');
addColumn('trips', 'approved_at', 'TEXT');
addColumn('trips', 'approval_note', 'TEXT');
// Where someone usually travels from, filled into new trips: { location, airport }. Asked once, after their first trip.
addColumn('users', 'travel_from', 'TEXT');
addColumn('users', 'travel_from_asked', 'INTEGER NOT NULL DEFAULT 0');
// A trip's event fees: [{ id, event_id, name, fee }]. A trip planned from an event starts with that event's fee.
addColumn('trips', 'events', "TEXT NOT NULL DEFAULT '[]'");
// A trip's locked estimate: { costs: { airfare, train, pov, car, lodging, mie, events }, override, total }. While set,
// total_estimate holds its total, and neither re-pricing nor edits to the trip change it. NULL when unlocked.
addColumn('trips', 'locked_estimate', 'TEXT');
// Swim lanes on the Tickets page (todo | in_work | stale | done). Work tickets keep the lane people put them in;
// pipeline tickets move on their own from their activity unless lane_locked holds them where they are.
addColumn('tickets', 'lane', 'TEXT');
addColumn('tickets', 'lane_locked', 'INTEGER NOT NULL DEFAULT 0');
addColumn('tickets', 'done_at', 'TEXT');      // when it reached Done; a work ticket archives 14 days later
addColumn('tickets', 'archived_at', 'TEXT');  // archived early by hand
db.exec(`
-- A pipeline ticket that's won or lost is done: it moves to Done, unlocked. Reopening it brings it back.
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_close AFTER UPDATE OF pipeline_status ON tickets
WHEN NEW.ticket_type = 'bid' AND NEW.pipeline_status IN ('Awarded', 'Lost')
  AND (OLD.pipeline_status IS NULL OR OLD.pipeline_status NOT IN ('Awarded', 'Lost'))
BEGIN
  UPDATE tickets SET done_at = datetime('now'), lane = NULL, lane_locked = 0, archived_at = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_reopen AFTER UPDATE OF pipeline_status ON tickets
WHEN NEW.ticket_type = 'bid' AND OLD.pipeline_status IN ('Awarded', 'Lost')
  AND (NEW.pipeline_status IS NULL OR NEW.pipeline_status NOT IN ('Awarded', 'Lost'))
BEGIN
  UPDATE tickets SET done_at = NULL, archived_at = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_insert AFTER INSERT ON tickets
WHEN NEW.ticket_type = 'bid' AND NEW.pipeline_status IN ('Awarded', 'Lost')
BEGIN
  UPDATE tickets SET done_at = datetime('now') WHERE id = NEW.id;
END;
`);
// Pipeline tickets already closed before lanes existed are done as of their last update.
db.exec(`UPDATE tickets SET done_at = updated_at WHERE ticket_type = 'bid' AND pipeline_status IN ('Awarded', 'Lost') AND done_at IS NULL`);

// A work ticket made from an event's marketing support request links back to the event.
addColumn('tickets', 'event_id', 'INTEGER REFERENCES events(id) ON DELETE SET NULL');

db.exec(`
-- To-dos on a ticket as a whole, not tied to any priority card.
CREATE TABLE IF NOT EXISTS ticket_tasks (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS ticket_tasks_ticket ON ticket_tasks(ticket_id);

-- Next major steps in pursuing a ticket: a broad-stroke log, newest on top unless reordered.
-- One step at a time can be flagged as the next step; it feeds the win assessment's next milestone.
CREATE TABLE IF NOT EXISTS ticket_steps (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  is_next INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS ticket_steps_ticket ON ticket_steps(ticket_id);

-- Process flow on a pipeline ticket: RFI, RFP, gate reviews, ROM, proposal and so on, in the order they happen.
-- reviews is JSON keyed by review area (technical, pricing, strategy, support): { people: [user ids], notes }.
CREATE TABLE IF NOT EXISTS ticket_process_steps (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  step_type TEXT NOT NULL,
  step_date TEXT,
  reviews TEXT,
  notes TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  updated_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ticket_process_steps_ticket ON ticket_process_steps(ticket_id);
`);
// A gate review's decision (Proceed, Revise, No-Bid) and the price considerations taken into it.
addColumn('ticket_process_steps', 'decision', 'TEXT');
addColumn('ticket_process_steps', 'pricing', 'TEXT');
db.exec(`
-- People asking for KIT access from the sign-in page. An admin approves (adding the email to approved_accounts) or declines.
CREATE TABLE IF NOT EXISTS access_requests (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | declined
  handled_by INTEGER REFERENCES users(id),
  handled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS access_requests_status ON access_requests(status);
`);
const hadUserTeams = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_teams'").get();
db.exec(`
-- The teams each person is on; someone can be on several, as a member or as the team's lead. No team ranks above another.
CREATE TABLE IF NOT EXISTS user_teams (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- member | lead
  PRIMARY KEY (user_id, team_id)
);
CREATE INDEX IF NOT EXISTS user_teams_team ON user_teams(team_id);
`);
// Before people could be on several teams, users.team_id held their one team. Carry it over once, when the table is new;
// users.team_id is not used after that.
if (!hadUserTeams) db.exec('INSERT OR IGNORE INTO user_teams (user_id, team_id) SELECT id, team_id FROM users WHERE team_id IS NOT NULL');
addColumn('user_teams', 'role', "TEXT NOT NULL DEFAULT 'member'");
// Teams used to be ordered, the first one "primary"; that order is gone.
if (db.prepare('PRAGMA table_info(user_teams)').all().some((c) => c.name === 'position')) db.exec('ALTER TABLE user_teams DROP COLUMN position');

// ---- Territories: the customer areas BD directors cover. Admins and BD team leads keep the list.
const hadTerritories = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'territories'").get();
db.exec(`
CREATE TABLE IF NOT EXISTS territories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  position INTEGER NOT NULL DEFAULT 0, -- display order
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The territories each person (usually a BD director) covers.
CREATE TABLE IF NOT EXISTS user_territories (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  territory_id INTEGER NOT NULL REFERENCES territories(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, territory_id)
);
`);
// Each pipeline ticket belongs to one BD director and one territory.
addColumn('tickets', 'bd_director_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('tickets', 'territory_id', 'INTEGER REFERENCES territories(id) ON DELETE SET NULL');
addColumn('tickets', 'work_team_id', 'INTEGER REFERENCES teams(id) ON DELETE SET NULL'); // the team a work ticket is for; pipeline tickets are always BD's
// Territories are the options of Pipedrive's "Account" deal field, named as Pipedrive names them (the sync keeps them so).
addColumn('territories', 'pipedrive_id', 'INTEGER');
export const TERRITORY_RENAMES = {
  'Navy / Marine Corps': 'Navy/USMC', 'Air Force & Space Force': 'USAF/USSF', 'DHS & FBI': 'DHS/DOJ',
  'Intelligence Community (Agencies)': 'Intel', 'FedCiv & Other': 'FedCiv (Other)',
};
if (!hadTerritories) {
  const add = db.prepare('INSERT INTO territories (name, position) VALUES (?, ?)');
  ['Army', 'Navy/USMC', 'USAF/USSF', 'DoD 4th Estate', 'DHS/DOJ', 'Intel', 'FedCiv (Other)']
    .forEach((name, i) => add.run(name, i));
  // Existing pipeline tickets: territory from their account type, BD director from whoever created them if they're on BD.
  db.exec(`
    UPDATE tickets SET territory_id = (SELECT id FROM territories WHERE name = CASE tickets.account_type
      WHEN 'Army' THEN 'Army' WHEN 'Air Force' THEN 'USAF/USSF' WHEN 'Navy / Marine' THEN 'Navy/USMC' END)
    WHERE ticket_type = 'bid' AND territory_id IS NULL;
    UPDATE tickets SET bd_director_id = created_by
    WHERE ticket_type = 'bid' AND bd_director_id IS NULL AND created_by IN
      (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD');
  `);
}
{
  const rename = db.prepare('UPDATE main.territories SET name = ? WHERE name = ? AND NOT EXISTS (SELECT 1 FROM main.territories WHERE name = ?)');
  Object.entries(TERRITORY_RENAMES).forEach(([from, to]) => rename.run(to, from, to));
}

// Archived priority cards leave the boards (and close-out counts) but keep everything on them until deleted for good.
addColumn('priority_cards', 'archived_at', 'TEXT');
db.exec(`
-- A dataset made by a full reset: every ticket and priority card that was live at the time, archived together so they
-- can be loaded back or deleted as one.
CREATE TABLE IF NOT EXISTS archive_sets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn('tickets', 'archive_set_id', 'INTEGER REFERENCES archive_sets(id) ON DELETE SET NULL');
addColumn('priority_cards', 'archive_set_id', 'INTEGER REFERENCES archive_sets(id) ON DELETE SET NULL');

// ---- BD financials: when wins are expected, how the pipeline moves, money on won contracts, goals, and account plans.

// When a pipeline ticket is expected to be won, or flagged as not yet known (the "undetermined" pool).
addColumn('tickets', 'projected_win_date', 'TEXT'); // YYYY-MM-DD
addColumn('tickets', 'win_date_undetermined', 'INTEGER NOT NULL DEFAULT 0');

// One row each time a pipeline ticket's stage, value, director, territory or projected win date changes, so the pipeline
// can be shown as it stood on any past date (latest row on or before that date). Triggers catch every way of editing.
const hadHistory = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ticket_history'").get();

// Why a pipeline ticket was lost, as Pipedrive records it (a lost deal's lost reason).
addColumn('tickets', 'lost_reason', 'TEXT');

// Stages named as Pipedrive names them: Identified → Prospecting, Submitted → Under Evaluation, and No Bid → Lost (with
// "No Bid" kept as the lost reason). Every saved copy of a stage is renamed in place. The history trigger is dropped
// first (it's recreated just below) so a rename isn't logged as a stage change, which would reset time in stage.
const STAGE_RENAMES = { Identified: 'Prospecting', Submitted: 'Under Evaluation', 'No Bid': 'Lost' };
const oldStages = Object.keys(STAGE_RENAMES).map((s) => `'${s}'`).join(', ');
if (db.prepare(`SELECT 1 FROM tickets WHERE pipeline_status IN (${oldStages})`).get()) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const rename = `CASE pipeline_status ${Object.entries(STAGE_RENAMES).map(([a, b]) => `WHEN '${a}' THEN '${b}'`).join(' ')} END`;
  db.transaction(() => {
    db.exec('DROP TRIGGER IF EXISTS ticket_history_on_update');
    db.exec("UPDATE tickets SET lost_reason = 'No Bid' WHERE pipeline_status = 'No Bid' AND lost_reason IS NULL");
    for (const t of ['tickets', 'ticket_history', 'forecast_snapshots'].filter(has)) {
      db.exec(`UPDATE ${t} SET pipeline_status = ${rename} WHERE pipeline_status IN (${oldStages})`);
    }
  })();
}
db.exec(`
CREATE TABLE IF NOT EXISTS ticket_history (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  pipeline_status TEXT,
  value REAL,
  bd_director_id INTEGER,
  territory_id INTEGER,
  projected_win_date TEXT,
  win_date_undetermined INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ticket_history_ticket ON ticket_history(ticket_id, changed_at);
CREATE TRIGGER IF NOT EXISTS ticket_history_on_insert AFTER INSERT ON tickets WHEN NEW.ticket_type = 'bid'
BEGIN
  INSERT INTO ticket_history (ticket_id, pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined)
  VALUES (NEW.id, NEW.pipeline_status, NEW.value, NEW.bd_director_id, NEW.territory_id, NEW.projected_win_date, NEW.win_date_undetermined);
END;
CREATE TRIGGER IF NOT EXISTS ticket_history_on_update
AFTER UPDATE OF pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined ON tickets
WHEN NEW.ticket_type = 'bid' AND (OLD.pipeline_status IS NOT NEW.pipeline_status OR OLD.value IS NOT NEW.value
  OR OLD.bd_director_id IS NOT NEW.bd_director_id OR OLD.territory_id IS NOT NEW.territory_id
  OR OLD.projected_win_date IS NOT NEW.projected_win_date OR OLD.win_date_undetermined IS NOT NEW.win_date_undetermined)
BEGIN
  INSERT INTO ticket_history (ticket_id, pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined)
  VALUES (NEW.id, NEW.pipeline_status, NEW.value, NEW.bd_director_id, NEW.territory_id, NEW.projected_win_date, NEW.win_date_undetermined);
END;
`);
// History starts now. Pipeline tickets that already exist get one starting row, dated when they were created, with today's values.
if (!hadHistory) {
  db.exec(`INSERT INTO ticket_history (ticket_id, pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined, changed_at)
    SELECT id, pipeline_status, value, bd_director_id, territory_id, projected_win_date, win_date_undetermined, created_at FROM tickets WHERE ticket_type = 'bid'`);
}

db.exec(`
-- Money recorded against a won contract: funding received (what's funded of its value) and revenue billed.
CREATE TABLE IF NOT EXISTS program_entries (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES delivery_programs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('funding', 'billing')),
  amount REAL NOT NULL,
  entry_date TEXT NOT NULL, -- YYYY-MM-DD: when the funding came in, or the end of the period billed
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS program_entries_program ON program_entries(program_id, kind);

-- Booking goals per BD director: quarter 1-4, or 0 for the whole year.
CREATE TABLE IF NOT EXISTS booking_targets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 0 AND 4),
  amount REAL NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, year, quarter)
);

-- Qualified pipeline goals per BD director: how much Qualified+ pipeline each should hold in a quarter (1-4), or at year end (0).
CREATE TABLE IF NOT EXISTS qualified_targets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 0 AND 4),
  amount REAL NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, year, quarter)
);

-- Account development: what a BD director is working toward with a customer (access, relationships, shaping demand).
CREATE TABLE IF NOT EXISTS account_objectives (
  id INTEGER PRIMARY KEY,
  organization TEXT NOT NULL,
  territory_id INTEGER REFERENCES territories(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- the BD director working it
  objective TEXT NOT NULL,
  target_date TEXT,
  status TEXT NOT NULL DEFAULT 'Not started', -- Not started | In progress | Achieved | Missed
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  completed_at TEXT
);

-- What each open pipeline ticket was forecast to bring in, captured at the start of the quarter it was expected to close in,
-- so actual bookings can be checked against the forecast (forecast reliability).
CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id INTEGER PRIMARY KEY,
  quarter TEXT NOT NULL, -- "2026 Q4", the quarter forecast
  taken_on TEXT NOT NULL, -- YYYY-MM-DD
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  opportunity_title TEXT,
  bd_director_id INTEGER,
  territory_id INTEGER,
  pipeline_status TEXT,
  value REAL,
  pwin REAL, -- 0-1, or NULL when the pipeline ticket had no assessment
  weighted REAL -- value × pwin, or the full value without one
);
CREATE INDEX IF NOT EXISTS forecast_snapshots_quarter ON forecast_snapshots(quarter);
`);
// Teams an admin assigns to an approved email before the person activates it (JSON array of team ids).
addColumn('approved_accounts', 'team_ids', 'TEXT');
// Documents uploaded to a process step are still ticket documents; this says which step they belong to.
addColumn('ticket_files', 'process_step_id', 'INTEGER REFERENCES ticket_process_steps(id) ON DELETE SET NULL');

db.exec(`
-- Notifications for a user, e.g. someone @mentioned them.
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  actor_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'mention',
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES priority_cards(id) ON DELETE SET NULL,
  comment_id INTEGER REFERENCES ticket_comments(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES card_notes(id) ON DELETE CASCADE,
  excerpt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);
CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id, created_at);
`);

// Alerts about an event's marketing support request.
addColumn('alerts', 'event_id', 'INTEGER REFERENCES events(id) ON DELETE CASCADE');
addColumn('alerts', 'request_id', 'INTEGER REFERENCES event_support_requests(id) ON DELETE CASCADE');

// Marketing support can be asked for from the Marketing page too, not only from an event, so event_id may be null.
// SQLite can't drop NOT NULL in place: rebuild the table, with foreign keys off so alerts pointing at it aren't cascaded away.
if (db.prepare('PRAGMA table_info(event_support_requests)').all().find((c) => c.name === 'event_id')?.notnull) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`CREATE TABLE event_support_requests_new (
      id INTEGER PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      details TEXT NOT NULL,
      requested_by INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'open',
      ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
      accepted_by INTEGER REFERENCES users(id),
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO event_support_requests_new (id, event_id, details, requested_by, status, ticket_id, accepted_by, accepted_at, created_at)
      SELECT id, event_id, details, requested_by, status, ticket_id, accepted_by, accepted_at, created_at FROM event_support_requests;
    DROP TABLE event_support_requests;
    ALTER TABLE event_support_requests_new RENAME TO event_support_requests;`);
  })();
  db.pragma('foreign_keys = ON');
}
addColumn('event_support_requests', 'title', 'TEXT');
addColumn('event_support_requests', 'category', 'TEXT');
addColumn('event_support_requests', 'due_date', 'TEXT');

db.exec(`
-- Marketing library: logos, images, and files anyone can download. Marketing keeps it up to date.
CREATE TABLE IF NOT EXISTS marketing_assets (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,  -- logo | image | file
  title TEXT NOT NULL,
  description TEXT,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- Approved text copy: boilerplate, taglines, bios, capability blurbs, ready to paste.
CREATE TABLE IF NOT EXISTS marketing_copy (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  updated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
`);

// These tables were first named ops_*; carry over anything saved under the old names.
for (const [from, to] of [['ops_programs', 'delivery_programs'], ['ops_program_team', 'delivery_team']]) {
  const has = (n) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(n);
  if (has(from) && !has(to)) db.exec(`ALTER TABLE ${from} RENAME TO ${to}`);
}
db.exec('DROP TRIGGER IF EXISTS ops_on_award_insert; DROP TRIGGER IF EXISTS ops_on_award_update;');

db.exec(`
-- Delivery: won contracts. When a pipeline ticket reaches Awarded, it's copied here to be staffed and delivered.
CREATE TABLE IF NOT EXISTS delivery_programs (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER UNIQUE REFERENCES tickets(id) ON DELETE SET NULL, -- the pipeline ticket it was won from
  name TEXT NOT NULL,
  organization TEXT,
  account_type TEXT,
  value REAL,
  awarded_at TEXT NOT NULL DEFAULT (datetime('now')),
  program_manager_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'Active', -- Active | Complete
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- The delivery team on a program: KIT users, or names of people outside KIT (user_id null).
CREATE TABLE IF NOT EXISTS delivery_team (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES delivery_programs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  name TEXT,
  role TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

`);
// (A ticket used to become a contract when its stage reached Awarded; now it does when its deal is won. See the delivery_on_won triggers below.)
// Alerts telling someone they've been put on a won contract.
addColumn('alerts', 'program_id', 'INTEGER REFERENCES delivery_programs(id) ON DELETE CASCADE');
addColumn('delivery_programs', 'technical_lead_id', 'INTEGER REFERENCES users(id)');
// The government's people on the contract: names, since they have no KIT account.
addColumn('delivery_programs', 'contracting_officer', 'TEXT');
addColumn('delivery_programs', 'cor', 'TEXT'); // Contracting Officer's Representative
addColumn('delivery_programs', 'gov_tech_lead', 'TEXT');
db.exec(`
-- A contract's documents: RFI, proposal, PO and so on, or Additional. Kept apart from ticket_files, which can go to Pipedrive.
CREATE TABLE IF NOT EXISTS delivery_files (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES delivery_programs(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS delivery_files_program ON delivery_files(program_id);
`);
// A contract whose pipeline ticket leaves Awarded is deleted if nothing was added to it. Otherwise it's held: kept with
// everything on it, but out of the numbers, until an admin keeps it (kept_at) or deletes it. Awarded again, it comes back
// on its own (or, if it was deleted, is made anew).
addColumn('delivery_programs', 'held_at', 'TEXT');
addColumn('delivery_programs', 'kept_at', 'TEXT');
addColumn('delivery_programs', 'completed_at', 'TEXT'); // when delivery finished: set by marking the contract Complete
const NOTHING_ADDED = `program_manager_id IS NULL AND technical_lead_id IS NULL AND status = 'Active' AND TRIM(COALESCE(notes, '')) = ''
    AND TRIM(COALESCE(contracting_officer, '')) = '' AND TRIM(COALESCE(cor, '')) = '' AND TRIM(COALESCE(gov_tech_lead, '')) = ''
    AND id NOT IN (SELECT program_id FROM delivery_team) AND id NOT IN (SELECT program_id FROM program_entries) AND id NOT IN (SELECT program_id FROM delivery_files)`;

// Travel request alerts: a lead has one to approve (travel_request), or the traveler's was decided (travel_decision).
addColumn('alerts', 'trip_id', 'INTEGER REFERENCES trips(id) ON DELETE CASCADE');

db.exec(`
-- Support someone needs with their week's work, asked from their lane on Weekly Priorities. Everyone @mentioned in it,
-- one by one or as a whole team, is alerted. Anyone can turn it into a work ticket; someone who wants their own ticket
-- can make another, so a request can have several. It stays on the board each week until its requester closes it.
CREATE TABLE IF NOT EXISTS support_needs (
  id INTEGER PRIMARY KEY,
  body TEXT NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id INTEGER REFERENCES priority_cards(id) ON DELETE SET NULL, -- the priority it's for, if any
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS support_needs_user ON support_needs(requested_by, created_at);
CREATE TABLE IF NOT EXISTS support_need_tickets (
  need_id INTEGER NOT NULL REFERENCES support_needs(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (need_id, ticket_id)
);
`);
// Support alerts: you were asked for support (support_need), or a work ticket was made from your request (support_ticket).
addColumn('alerts', 'support_id', 'INTEGER REFERENCES support_needs(id) ON DELETE CASCADE');


// Move the old single notes field on each card into its first note entry.
db.transaction(() => {
  db.prepare(`INSERT INTO card_notes (card_id, body, author_id, created_at)
    SELECT id, trim(notes), created_by, updated_at FROM priority_cards WHERE trim(COALESCE(notes, '')) != ''`).run();
  db.prepare(`UPDATE priority_cards SET notes = NULL WHERE notes IS NOT NULL`).run();
})();

// ---- Pipedrive: a home on pipeline tickets for everything a Pipedrive deal holds, so deals can be brought over whole.
// pipedrive_id on each row is the Pipedrive record it came from, so a sync can match it again instead of duplicating it.
addColumn('tickets', 'pipedrive_id', 'INTEGER');
addColumn('tickets', 'currency', 'TEXT');        // ISO code; null means USD
addColumn('tickets', 'probability', 'INTEGER');  // Pipedrive's hand-set deal probability, 0-100 (apart from KIT's PWIN)
addColumn('tickets', 'labels', 'TEXT');          // JSON array of label names
addColumn('tickets', 'source', 'TEXT');          // where the deal came from (Pipedrive's source / origin channel)
addColumn('tickets', 'custom_fields', 'TEXT');   // JSON array of { name, value }: Pipedrive custom fields, and any others
db.exec(`
-- Pipelines beyond KIT's own, each with its own stages, made to match Pipedrive's pipelines when they're synced.
-- A ticket with no pipeline_id is on KIT's own pipeline (PIPELINE_STATUSES).
CREATE TABLE IF NOT EXISTS pipelines (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  pipedrive_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  pipedrive_id INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline ON pipeline_stages(pipeline_id, position);
`);
addColumn('tickets', 'pipeline_id', 'INTEGER REFERENCES pipelines(id) ON DELETE SET NULL');
// Accounts the Pipedrive sync made for deal owners with no KIT account: they exist so tickets can name them, and the
// person claims the account (sets a password) by activating with that email.
addColumn('users', 'pending_activation', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'pipedrive_id', 'INTEGER');
// KIT → Pipedrive goes only when an admin sends it. pipedrive_pending marks a KIT edit (or pin) to a Pipedrive note that
// hasn't been sent yet; pipedrive_note_id is the Pipedrive note a linked (not uploaded) document went to.
addColumn('ticket_comments', 'pipedrive_pending', 'INTEGER NOT NULL DEFAULT 0');
addColumn('ticket_files', 'pipedrive_note_id', 'INTEGER');
db.exec(`
-- Tags (Pipedrive's deal labels), each with its color. Tickets keep the names they carry in tickets.labels. Labels from
-- Pipedrive have a pipedrive_id; ones made in KIT don't, and stay in KIT.
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT 'gray', -- Pipedrive's colors: green, blue, red, yellow, purple, gray, orange, brown, pink, dark-gray
  position INTEGER NOT NULL DEFAULT 0,
  pipedrive_id INTEGER UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// A change to a Pipedrive deal's labels made in KIT that hasn't been sent to Pipedrive yet.
addColumn('tickets', 'labels_pending', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
-- What travel actually cost: one total per entry, per traveler, dated by when it was spent. No breakdown needed.
CREATE TABLE IF NOT EXISTS travel_actuals (
  id INTEGER PRIMARY KEY,
  traveler_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spent_on TEXT NOT NULL,   -- YYYY-MM-DD
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS travel_actuals_date ON travel_actuals(spent_on);
`);
// Labels tickets already carry get a place in the list.
db.exec(`INSERT OR IGNORE INTO labels (name) SELECT DISTINCT j.value FROM tickets t, json_each(t.labels) j
  WHERE t.labels IS NOT NULL AND json_valid(t.labels) AND TRIM(j.value) != ''`);
db.exec(`
-- Pipedrive notes, files and activities deleted in KIT: never imported again, and deleted in Pipedrive when an admin sends.
-- Deals whose ticket was deleted in KIT are here too, but only so a pull skips them: a send never deletes a deal.
CREATE TABLE IF NOT EXISTS pipedrive_deletes (
  kind TEXT NOT NULL, -- note | file | activity | deal
  pipedrive_id INTEGER NOT NULL,
  PRIMARY KEY (kind, pipedrive_id)
);
`);
db.exec(`
-- Site feedback: what people typed into the KITT widget (bottom-right of every page), with the page they were on.
CREATE TABLE IF NOT EXISTS site_feedback (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The KITT race (right-click the car). Tokens are a ledger: finishing a task pays in, a race takes one out. A task
-- pays once however often it's checked and unchecked, which the unique index on (reason, ref) enforces.
CREATE TABLE IF NOT EXISTS game_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL, -- task | subtask | check | delivery | priority | race
  ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS game_tokens_once ON game_tokens(user_id, reason, ref) WHERE ref IS NOT NULL;
-- Clean runs only (the car never touched a wall); each track keeps its twenty best.
CREATE TABLE IF NOT EXISTS race_times (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track TEXT NOT NULL,
  ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS race_times_track ON race_times(track, ms);
`);
addColumn('ticket_contacts', 'is_primary', 'INTEGER NOT NULL DEFAULT 0'); // the deal's main contact person
addColumn('contacts', 'pipedrive_id', 'INTEGER');
addColumn('ticket_comments', 'pinned', 'INTEGER NOT NULL DEFAULT 0'); // kind 'note' is a Pipedrive note; notes can be pinned
addColumn('ticket_comments', 'pipedrive_id', 'INTEGER');
// Pipedrive activities are tasks with a type (call, meeting, task, deadline, email, lunch), a due date and an assignee.
addColumn('ticket_tasks', 'activity_type', 'TEXT');
addColumn('ticket_tasks', 'due_date', 'TEXT');   // YYYY-MM-DD
addColumn('ticket_tasks', 'due_time', 'TEXT');   // HH:MM
addColumn('ticket_tasks', 'duration', 'TEXT');   // HH:MM
addColumn('ticket_tasks', 'assignee_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('ticket_tasks', 'location', 'TEXT');
addColumn('ticket_tasks', 'note', 'TEXT');
addColumn('ticket_tasks', 'pipedrive_id', 'INTEGER');
// The rest of a Pipedrive activity's fields, plus a few of KIT's own, for the Activity section on a pipeline ticket.
addColumn('ticket_tasks', 'video_call', 'TEXT');   // a meeting link
addColumn('ticket_tasks', 'description', 'TEXT');
addColumn('ticket_tasks', 'priority', 'TEXT');     // High | Medium | Low
addColumn('ticket_tasks', 'organization', 'TEXT');
addColumn('ticket_tasks', 'phone', 'TEXT');
addColumn('ticket_tasks', 'email', 'TEXT');
addColumn('ticket_tasks', 'goals', 'TEXT');
addColumn('ticket_tasks', 'flagged', 'INTEGER NOT NULL DEFAULT 0');
// The ball is in the client's court: shown on the ticket and its priority card, and left out of completion rates.
addColumn('ticket_tasks', 'waiting_client', 'INTEGER NOT NULL DEFAULT 0');
db.exec(`
-- The people (contacts) taking part in an activity: Pipedrive's participants.
CREATE TABLE IF NOT EXISTS task_participants (
  task_id INTEGER NOT NULL REFERENCES ticket_tasks(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, contact_id)
);
`);
addColumn('ticket_files', 'url', 'TEXT');        // a linked file (Google Drive, OneDrive…) rather than an upload
addColumn('ticket_files', 'pipedrive_id', 'INTEGER');
db.exec(`
-- People who follow a ticket (Pipedrive deal followers).
CREATE TABLE IF NOT EXISTS ticket_followers (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);
-- Emails linked to a ticket (Pipedrive's synced mail on a deal). Attachments are ticket_files with email_id set.
CREATE TABLE IF NOT EXISTS ticket_emails (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  subject TEXT,
  from_address TEXT,
  to_addresses TEXT,
  cc_addresses TEXT,
  body TEXT,
  sent_at TEXT NOT NULL,
  pipedrive_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ticket_emails_ticket ON ticket_emails(ticket_id);
-- Products on a ticket (Pipedrive deal products): what's being sold, how many, and at what price.
CREATE TABLE IF NOT EXISTS ticket_products (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  item_price REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,   -- percent off
  comments TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  pipedrive_id INTEGER
);
CREATE INDEX IF NOT EXISTS ticket_products_ticket ON ticket_products(ticket_id);
`);
addColumn('ticket_files', 'email_id', 'INTEGER REFERENCES ticket_emails(id) ON DELETE CASCADE');
// What Pipedrive held at the last pull, for the fields KIT and Pipedrive share (JSON). A field whose KIT value differs is
// a KIT change waiting to be sent; one whose Pipedrive value differs was changed in Pipedrive since.
addColumn('tickets', 'pipedrive_snapshot', 'TEXT');
// Each deal's followers and people as they were last sent to Pipedrive, so auto-send knows when they've changed.
addColumn('tickets', 'pipedrive_followers_sent', 'TEXT');
addColumn('tickets', 'pipedrive_people_sent', 'TEXT');
addColumn('ticket_tasks', 'pipedrive_snapshot', 'TEXT');
addColumn('pipedrive_deletes', 'deal_id', 'INTEGER'); // the deal it was on, so a send to some deals only takes theirs

// ---- Activities are a ticket's priorities, in order: the top open one is the ticket's next step. A priority card on the
// Weekly Priorities board is one activity placed in someone's week (its title, due date, checklist and completion are
// kept in step with the activity), and an activity's checklist is its subtasks. Next steps and card notes were folded in.
db.exec(`
CREATE TABLE IF NOT EXISTS activity_subtasks (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES ticket_tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS activity_subtasks_task ON activity_subtasks(task_id);
CREATE INDEX IF NOT EXISTS ticket_tasks_order ON ticket_tasks(ticket_id, done, position);
`);
addColumn('priority_cards', 'activity_id', 'INTEGER REFERENCES ticket_tasks(id) ON DELETE SET NULL');
addColumn('priority_cards', 'locked_rank', 'INTEGER'); // the activity's place on its ticket when the week's planning closed
migrateToActivities();

db.exec(`
-- Marketing spend: money spent on marketing, as specific as it's known. Any of the links can be empty: an entry can be
-- for an event, a pipeline ticket, a person (usually a BD director), a territory or an account (organization), or just generic.
CREATE TABLE IF NOT EXISTS marketing_spend (
  id INTEGER PRIMARY KEY,
  spent_on TEXT NOT NULL,   -- YYYY-MM-DD
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  vendor TEXT,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  ticket_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  territory_id INTEGER REFERENCES territories(id) ON DELETE SET NULL,
  organization TEXT,
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS marketing_spend_date ON marketing_spend(spent_on);

-- Each person's priority accounts, in tiers (Tier 1, Tier 2, …: tiers, not a ranking), the pipeline tickets that matter at
-- each account, and their own ordered list of priority tickets picked from those.
CREATE TABLE IF NOT EXISTS priority_tiers (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS priority_tiers_user ON priority_tiers(user_id);
CREATE TABLE IF NOT EXISTS priority_accounts (
  id INTEGER PRIMARY KEY,
  tier_id INTEGER NOT NULL REFERENCES priority_tiers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,       -- the agency, department or organization
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS priority_account_tickets (
  account_id INTEGER NOT NULL REFERENCES priority_accounts(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, ticket_id)
);
CREATE TABLE IF NOT EXISTS priority_list_tickets (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, ticket_id)
);
`);
addColumn('priority_accounts', 'ticket_id', 'INTEGER REFERENCES tickets(id) ON DELETE SET NULL'); // a hidden ticket (type account) that holds the account's activities
addColumn('priority_accounts', 'strategy', 'TEXT'); // the owner's strategy for gaining a foothold at this account
addColumn('priority_list_tickets', 'direct', 'INTEGER NOT NULL DEFAULT 0'); // no longer used: the priority list doesn't depend on accounts

function migrateToActivities() {
  const hasTable = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const steps = db.prepare('SELECT * FROM ticket_steps ORDER BY ticket_id, is_next DESC, position, id DESC').all();
  const cards = db.prepare('SELECT * FROM priority_cards WHERE activity_id IS NULL ORDER BY week_start, id').all();
  const notes = db.prepare('SELECT * FROM card_notes ORDER BY created_at, id').all();
  if (!steps.length && !cards.length && !notes.length) return;
  // Rows made from sample (or reset-archived) rows go with them.
  const sample = hasTable('sample_rows');
  const archived = hasTable('archived_rows');
  const follow = (fromTbl, fromId, toTbl, toId) => {
    if (sample) db.prepare('INSERT INTO sample_rows (tbl, row_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM sample_rows WHERE tbl = ? AND row_id = ?)').run(toTbl, toId, fromTbl, fromId);
    if (archived) db.prepare('INSERT INTO archived_rows (set_id, tbl, row_id) SELECT set_id, ?, ? FROM archived_rows WHERE tbl = ? AND row_id = ?').run(toTbl, toId, fromTbl, fromId);
  };
  const forget = (tbl, id) => {
    if (sample) db.prepare('DELETE FROM sample_rows WHERE tbl = ? AND row_id = ?').run(tbl, id);
    if (archived) db.prepare('DELETE FROM archived_rows WHERE tbl = ? AND row_id = ?').run(tbl, id);
  };
  const addTask = db.prepare(`INSERT INTO ticket_tasks (ticket_id, text, activity_type, due_date, done, done_at, assignee_id, created_by, created_at, position)
    VALUES (@ticket_id, @text, 'Task', @due_date, @done, @done_at, @assignee_id, @created_by, @created_at, 0)`);

  db.transaction(() => {
    // Next steps become the first activities on their ticket, the flagged one on top.
    const touched = new Set();
    const fromSteps = new Map(); // ticket id → its former steps' activity ids, in order
    steps.forEach((s) => {
      const id = addTask.run({ ticket_id: s.ticket_id, text: s.text, due_date: null, done: s.done, done_at: s.done_at, assignee_id: null, created_by: s.author_id, created_at: s.created_at }).lastInsertRowid;
      follow('ticket_steps', s.id, 'ticket_tasks', id);
      forget('ticket_steps', s.id);
      touched.add(s.ticket_id);
      fromSteps.set(s.ticket_id, [...(fromSteps.get(s.ticket_id) || []), id]);
    });
    db.prepare('DELETE FROM ticket_steps').run();

    // Each priority card becomes an activity on its ticket, its checklist the activity's subtasks.
    const firstAssignee = db.prepare('SELECT user_id FROM card_assignees WHERE card_id = ? ORDER BY position LIMIT 1');
    const ticketTitle = db.prepare('SELECT opportunity_title FROM tickets WHERE id = ?');
    const addSub = db.prepare('INSERT INTO activity_subtasks (task_id, text, done, done_at, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    cards.forEach((c) => {
      const id = addTask.run({
        ticket_id: c.ticket_id, text: c.title || ticketTitle.get(c.ticket_id)?.opportunity_title || 'Priority', due_date: c.due_date,
        done: c.completed, done_at: c.completed ? c.updated_at : null, assignee_id: firstAssignee.get(c.id)?.user_id ?? null, created_by: c.created_by, created_at: c.created_at,
      }).lastInsertRowid;
      follow('priority_cards', c.id, 'ticket_tasks', id);
      let list = [];
      try { list = JSON.parse(c.checklist || '[]') || []; } catch { /* no checklist */ }
      list.forEach((i, n) => {
        const sub = addSub.run(id, String(i.text || ''), i.done ? 1 : 0, i.done ? c.updated_at : null, n, c.created_by, c.created_at).lastInsertRowid;
        follow('priority_cards', c.id, 'activity_subtasks', sub);
      });
      db.prepare('UPDATE priority_cards SET activity_id = ? WHERE id = ?').run(id, c.id);
      touched.add(c.ticket_id);
    });
    // Comments left on a priority card are now about its activity.
    db.prepare(`UPDATE ticket_comments SET target_type = 'activity', target_id = (SELECT activity_id FROM priority_cards WHERE id = ticket_comments.target_id)
      WHERE target_type = 'card' AND target_id IN (SELECT id FROM priority_cards WHERE activity_id IS NOT NULL)`).run();

    // Card notes (status updates) become comments on the card's activity; comments under a note become its replies.
    notes.forEach((n) => {
      const c = db.prepare('SELECT ticket_id, activity_id FROM priority_cards WHERE id = ?').get(n.card_id);
      if (!c) return;
      const id = db.prepare(`INSERT INTO ticket_comments (ticket_id, card_id, kind, body, author_id, created_at, updated_at, target_type, target_id)
        VALUES (?, ?, 'comment', ?, ?, ?, ?, 'activity', ?)`).run(c.ticket_id, n.card_id, n.body, n.author_id, n.created_at, n.updated_at, c.activity_id).lastInsertRowid;
      follow('card_notes', n.id, 'ticket_comments', id);
      forget('card_notes', n.id);
      db.prepare("UPDATE ticket_comments SET parent_id = ?, kind = 'reply', target_type = NULL, target_id = NULL WHERE target_type = 'note' AND target_id = ? AND parent_id IS NULL").run(id, n.id);
      db.prepare('UPDATE alerts SET comment_id = ?, note_id = NULL WHERE note_id = ?').run(id, n.id);
      db.prepare("UPDATE work_log SET kind = 'comment', ref_id = ? WHERE kind = 'note' AND ref_id = ?").run(id, n.id);
    });
    db.prepare('DELETE FROM card_notes').run();

    // Order each ticket touched: its former next steps as they were, then the other open activities soonest first, then
    // the done ones, latest first.
    const others = db.prepare(`SELECT id FROM ticket_tasks WHERE ticket_id = ? AND id NOT IN (SELECT value FROM json_each(?))
      ORDER BY done, due_date IS NULL, due_date, CASE WHEN done THEN done_at END DESC, id`);
    const isDone = db.prepare('SELECT done FROM ticket_tasks WHERE id = ?');
    const setPos = db.prepare('UPDATE ticket_tasks SET position = ? WHERE id = ?');
    touched.forEach((t) => {
      const first = (fromSteps.get(t) || []).filter((id) => !isDone.get(id).done);
      const rest = others.all(t, JSON.stringify(first)).map((k) => k.id);
      [...first, ...rest].forEach((id, i) => setPos.run(i, id));
    });
  })();
}

// ---- Lessons Learned. A lesson's id is its Lesson Learned number; AUTOINCREMENT keeps a deleted number from coming back.
// A retrospective sends its items here: retro_date is the retro's date, and source and source_id say which item it was.
db.exec(`
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,   -- good (Good/Keep) | bad (Bad/Change)
  action TEXT NOT NULL, -- continue | change; bad is always change
  context TEXT,
  problem TEXT,
  solution TEXT,
  retro_date TEXT,      -- YYYY-MM-DD
  source TEXT NOT NULL DEFAULT 'manual', -- manual | retro
  source_id INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS lessons_source ON lessons(source, source_id) WHERE source_id IS NOT NULL;
-- Tags for lessons, separate from labels: those are Pipedrive's, and a tag named like a Pipedrive label becomes that label.
CREATE TABLE IF NOT EXISTS lesson_tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag_group TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lesson_tag_links (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES lesson_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lesson_id, tag_id)
);
`);
// Lessons used to have their own scope and stage. Tags do that job now; a lesson's stage carries over as a tag.
if (db.prepare('PRAGMA table_info(lessons)').all().some((c) => c.name === 'scope')) {
  db.transaction(() => {
    db.exec(`
      INSERT OR IGNORE INTO lesson_tags (name, tag_group) SELECT DISTINCT stage, 'Pipeline stages' FROM lessons WHERE stage IS NOT NULL;
      INSERT OR IGNORE INTO lesson_tag_links (lesson_id, tag_id) SELECT l.id, t.id FROM lessons l JOIN lesson_tags t ON t.name = l.stage COLLATE NOCASE;
      ALTER TABLE lessons DROP COLUMN stage;
      ALTER TABLE lessons DROP COLUMN scope;
    `);
  })();
}

// The Lessons Learned trend report: the latest one KIT generated, kept so the page shows it on return without asking
// Gemini again. One row per period choice would be more than anyone needs; the newest report replaces the last.
db.exec(`
CREATE TABLE IF NOT EXISTS lesson_trend_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_date TEXT,            -- YYYY-MM-DD, or NULL for all time
  to_date TEXT,
  period TEXT NOT NULL,      -- month | quarter
  stats TEXT NOT NULL,       -- JSON: the counts per period, computed from the lessons
  report TEXT NOT NULL,      -- JSON: Gemini's assessment, in the fixed report schema
  model TEXT,
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---- Retrospectives. A retro's tickets and thumbs are anonymous: author_key and voter_key are keyed hashes (anonKey in
// auth.js) that only say "the same person" within one retro, and tickets keep no timestamps. Never store a user id on them.
db.exec(`
CREATE TABLE IF NOT EXISTS retro_boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  retro_date TEXT NOT NULL,  -- YYYY-MM-DD; becomes the retro date on its lessons
  template TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'brainstorm', -- brainstorm | actions | closed
  hide_notes INTEGER NOT NULL DEFAULT 0,    -- 1 until the lead reveals tickets
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, -- the retro lead
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS retro_lanes (
  id INTEGER PRIMARY KEY,
  board_id INTEGER NOT NULL REFERENCES retro_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lean TEXT,                 -- good | bad; starts its lessons as Good/Keep or Bad/Change
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS retro_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- a lesson's source_id, so never reused
  board_id INTEGER NOT NULL REFERENCES retro_boards(id) ON DELETE CASCADE,
  lane_id INTEGER NOT NULL REFERENCES retro_lanes(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  author_key TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS retro_votes (
  note_id INTEGER NOT NULL REFERENCES retro_notes(id) ON DELETE CASCADE,
  voter_key TEXT NOT NULL,
  PRIMARY KEY (note_id, voter_key)
);
CREATE INDEX IF NOT EXISTS retro_lanes_board ON retro_lanes(board_id);
CREATE INDEX IF NOT EXISTS retro_notes_board ON retro_notes(board_id);
`);
// The lead's countdown, in epoch milliseconds so everyone's screen agrees to the second.
addColumn('retro_boards', 'timer_ends_at', 'INTEGER');
addColumn('retro_boards', 'timer_length', 'INTEGER'); // how long it was set for, in ms


// ---- Pipedrive, in full: a home on tickets, contacts and contracts for everything a deal, person, organization, product
// and project holds, so the two stay the same.

// Won or lost is a deal's status in Pipedrive, apart from its stage (a deal can sit in an "Awarded" stage and still be
// open). Only a won ticket is a contract in Delivery. won_at / lost_at are when it closed.
addColumn('tickets', 'deal_status', "TEXT NOT NULL DEFAULT 'open'"); // open | won | lost
addColumn('tickets', 'won_at', 'TEXT');
addColumn('tickets', 'lost_at', 'TEXT');
// Where the deal came from, as Pipedrive records it: the origin (manually created, import, API…) and the channel.
addColumn('tickets', 'source_origin', 'TEXT');
addColumn('tickets', 'source_origin_id', 'TEXT');
addColumn('tickets', 'source_channel_id', 'TEXT');
// A deal deleted in Pipedrive is archived here (never deleted), and this says when.
addColumn('tickets', 'pipedrive_deleted_at', 'TEXT');
db.exec(`
-- Organizations (Pipedrive's), with everything Pipedrive keeps on one. Tickets and contacts point at them.
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  labels TEXT,            -- JSON array of label names
  website TEXT,
  linkedin TEXT,
  industry TEXT,
  annual_revenue TEXT,
  employee_count INTEGER,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  people_count INTEGER,
  open_deals_count INTEGER,
  won_deals_count INTEGER,
  lost_deals_count INTEGER,
  pipedrive_id INTEGER UNIQUE,
  pipedrive_snapshot TEXT,
  pipedrive_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
-- Pipedrive's field definitions (deal, person, organization and project fields): custom fields and the built-in ones that
-- have options (labels, lost reasons, industries…). Refreshed on every pull, so a field or option added in Pipedrive
-- shows up in KIT on its own.
CREATE TABLE IF NOT EXISTS pipedrive_fields (
  entity TEXT NOT NULL,      -- deal | person | organization | project
  key TEXT NOT NULL,
  pipedrive_id INTEGER,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL,  -- varchar, text, enum, set, date, double, monetary, phone, user, org, people, address…
  options TEXT,              -- JSON [{ id, label, color }] for enum and set fields
  position INTEGER NOT NULL DEFAULT 0,
  custom INTEGER NOT NULL DEFAULT 0,    -- made in Pipedrive by the company (edit_flag)
  important INTEGER NOT NULL DEFAULT 0, -- shown in Pipedrive's Summary section
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity, key)
);
-- A deal's installments (Pipedrive's payment schedule): how much is due, and when.
CREATE TABLE IF NOT EXISTS ticket_installments (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  description TEXT,
  amount REAL NOT NULL DEFAULT 0,
  billing_date TEXT,
  pipedrive_id INTEGER,
  pipedrive_snapshot TEXT,
  pipedrive_pending INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ticket_installments_ticket ON ticket_installments(ticket_id);
-- The phases of Pipedrive's Projects board (Kick-off, Planning, Implementation…), which a contract moves through.
CREATE TABLE IF NOT EXISTS delivery_phases (
  id INTEGER PRIMARY KEY,
  board_id INTEGER,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  pipedrive_id INTEGER UNIQUE
);
-- A contract's plan: the tasks (with subtasks) and activities of its Pipedrive project.
CREATE TABLE IF NOT EXISTS delivery_tasks (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES delivery_programs(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES delivery_tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'task', -- task | activity
  title TEXT NOT NULL,
  description TEXT,
  activity_type TEXT,
  due_date TEXT,
  due_time TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  pipedrive_id INTEGER,
  pipedrive_snapshot TEXT,
  pipedrive_pending INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS delivery_tasks_program ON delivery_tasks(program_id, position);
-- Notes on a contract's project (Pipedrive project notes), two-way like deal notes.
CREATE TABLE IF NOT EXISTS delivery_notes (
  id INTEGER PRIMARY KEY,
  program_id INTEGER NOT NULL REFERENCES delivery_programs(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  pipedrive_id INTEGER,
  pipedrive_pending INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS delivery_notes_program ON delivery_notes(program_id);
`);
addColumn('tickets', 'organization_id', 'INTEGER REFERENCES organizations(id) ON DELETE SET NULL');
// Contacts: Pipedrive's labels (JSON names), their organization, and the sync bookkeeping that lets edits go both ways.
addColumn('contacts', 'labels', 'TEXT');
addColumn('contacts', 'organization_id', 'INTEGER REFERENCES organizations(id) ON DELETE SET NULL');
addColumn('contacts', 'pipedrive_snapshot', 'TEXT');
addColumn('contacts', 'pipedrive_pending', 'INTEGER NOT NULL DEFAULT 0');
// Products: the rest of what a Pipedrive deal product carries, and the bookkeeping for two-way edits.
addColumn('ticket_products', 'tax', 'REAL NOT NULL DEFAULT 0');
addColumn('ticket_products', 'sum', 'REAL');
addColumn('ticket_products', 'billing_frequency', 'TEXT');
addColumn('ticket_products', 'billing_frequency_cycles', 'INTEGER');
addColumn('ticket_products', 'billing_start_date', 'TEXT');
addColumn('ticket_products', 'is_enabled', 'INTEGER NOT NULL DEFAULT 1');
addColumn('ticket_products', 'product_pipedrive_id', 'INTEGER'); // the catalog product
addColumn('ticket_products', 'pipedrive_snapshot', 'TEXT');
addColumn('ticket_products', 'pipedrive_pending', 'INTEGER NOT NULL DEFAULT 0');
// Contracts: the Pipedrive project each one is delivered as, with its overview (dates, phase, status, owner, labels).
addColumn('delivery_programs', 'pipedrive_project_id', 'INTEGER');
addColumn('delivery_programs', 'project_status', 'TEXT');   // open | completed | canceled, as Pipedrive has it
addColumn('delivery_programs', 'phase_id', 'INTEGER REFERENCES delivery_phases(id) ON DELETE SET NULL');
addColumn('delivery_programs', 'start_date', 'TEXT');
addColumn('delivery_programs', 'end_date', 'TEXT');
addColumn('delivery_programs', 'labels', 'TEXT');           // JSON array of project label names
addColumn('delivery_programs', 'owner_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('delivery_programs', 'health_status', 'INTEGER');
addColumn('delivery_programs', 'project_archived_at', 'TEXT');
addColumn('delivery_programs', 'pipedrive_snapshot', 'TEXT');
addColumn('delivery_programs', 'pipedrive_pending', 'INTEGER NOT NULL DEFAULT 0');
addColumn('delivery_files', 'pipedrive_id', 'INTEGER');
addColumn('delivery_files', 'url', 'TEXT');
addColumn('pipedrive_deletes', 'project_id', 'INTEGER'); // for project items: the Pipedrive project they were on
// A file kept in KIT after it was deleted in Pipedrive (an admin's choice when many go at once): KIT's own now, never sent back.
addColumn('ticket_files', 'pipedrive_detached', 'INTEGER NOT NULL DEFAULT 0');
addColumn('delivery_files', 'pipedrive_detached', 'INTEGER NOT NULL DEFAULT 0');
db.exec("DELETE FROM settings WHERE key = 'pipedrive_pull_file_deletes'"); // file deletions always sync now

// A shared field changed in both KIT and Pipedrive since the last pull: kept with both values until an admin picks a side
// (see services/pipedriveConflicts.js). Values are JSON.
db.exec(`
CREATE TABLE IF NOT EXISTS pipedrive_conflicts (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,            -- deal | organization | person | activity | product | installment | project | project_task
  tbl TEXT NOT NULL,             -- the KIT table and row holding the field
  row_id INTEGER NOT NULL,
  field TEXT NOT NULL,           -- the shared field's key, as in the row's pipedrive_snapshot
  ticket_id INTEGER,
  title TEXT NOT NULL,
  kit_value TEXT,
  pipedrive_value TEXT,
  snapshot_value TEXT,           -- what both sides started from
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tbl, row_id, field)
);
`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS delivery_programs_project ON delivery_programs(pipedrive_project_id) WHERE pipedrive_project_id IS NOT NULL');

// Won tickets, from before deal_status existed: Lost is lost; a ticket in Awarded, or with a contract in Delivery that isn't
// on hold, counts as won (a pull sets each Pipedrive deal's real status afterwards).
if (!getSettingRaw('deal_status_backfilled')) {
  db.transaction(() => {
    db.exec(`UPDATE tickets SET deal_status = 'lost', lost_at = COALESCE(done_at, updated_at) WHERE ticket_type = 'bid' AND pipeline_status = 'Lost'`);
    db.exec(`UPDATE tickets SET deal_status = 'won', won_at = COALESCE((SELECT awarded_at FROM delivery_programs p WHERE p.ticket_id = tickets.id), done_at, updated_at)
      WHERE ticket_type = 'bid' AND deal_status = 'open' AND (pipeline_status = 'Awarded'
        OR id IN (SELECT ticket_id FROM delivery_programs WHERE held_at IS NULL AND ticket_id IS NOT NULL))`);
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('deal_status_backfilled', '1')").run();
  })();
}
// Sending to Pipedrive used to be off unless an admin turned each kind on. Now everything syncs both ways on its own (in
// production), so the old per-kind settings are cleared once: every kind starts as Auto, and an admin can still turn any off.
if (!getSettingRaw('pipedrive_modes_reset_v2')) {
  db.prepare("DELETE FROM settings WHERE key = 'pipedrive_send_modes'").run();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('pipedrive_modes_reset_v2', '1')").run();
}
// A fresh install starts with no sync, until an admin chooses a direction and approves its first sync. An install that
// had already synced deals before that choice existed carries on two way, as it was (set once, here).
if (!getSettingRaw('pipedrive_sync_direction') && db.prepare('SELECT 1 FROM tickets WHERE pipedrive_id IS NOT NULL LIMIT 1').get()) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('pipedrive_sync_direction', 'both')").run();
}
// Delivery follows the deal's status now, not its stage: a ticket is a contract while it's won.
db.exec(`
DROP TRIGGER IF EXISTS delivery_on_award_insert;
DROP TRIGGER IF EXISTS delivery_on_award_update;
DROP TRIGGER IF EXISTS delivery_hold_on_unaward;
DROP TRIGGER IF EXISTS delivery_release_on_award;
DROP TRIGGER IF EXISTS delivery_hold_on_unwon; -- remade each start, so what counts as "nothing added" stays current
CREATE TRIGGER IF NOT EXISTS delivery_on_won_insert AFTER INSERT ON tickets
WHEN NEW.deal_status = 'won' AND NEW.ticket_type = 'bid'
BEGIN
  INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value, awarded_at)
  VALUES (NEW.id, NEW.opportunity_title, NEW.organization, NEW.account_type, NEW.value, COALESCE(NEW.won_at, datetime('now')));
END;
CREATE TRIGGER IF NOT EXISTS delivery_on_won_update AFTER UPDATE OF deal_status ON tickets
WHEN NEW.deal_status = 'won' AND OLD.deal_status IS NOT 'won' AND NEW.ticket_type = 'bid'
BEGIN
  INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value, awarded_at)
  VALUES (NEW.id, NEW.opportunity_title, NEW.organization, NEW.account_type, NEW.value, COALESCE(NEW.won_at, datetime('now')));
  UPDATE delivery_programs SET held_at = NULL, kept_at = NULL, awarded_at = COALESCE(NEW.won_at, awarded_at) WHERE ticket_id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS delivery_hold_on_unwon AFTER UPDATE OF deal_status ON tickets
WHEN OLD.deal_status = 'won' AND NEW.deal_status IS NOT 'won' AND NEW.ticket_type = 'bid'
BEGIN
  DELETE FROM delivery_programs WHERE ticket_id = NEW.id AND pipedrive_project_id IS NULL AND ${NOTHING_ADDED}
    AND id NOT IN (SELECT program_id FROM delivery_tasks) AND id NOT IN (SELECT program_id FROM delivery_notes);
  UPDATE delivery_programs SET held_at = datetime('now'), kept_at = NULL WHERE ticket_id = NEW.id;
END;
UPDATE delivery_programs SET held_at = datetime('now') WHERE held_at IS NULL AND kept_at IS NULL
  AND ticket_id IN (SELECT id FROM tickets WHERE ticket_type = 'bid' AND deal_status IS NOT 'won');
-- Every won ticket has a contract (tickets won before Delivery existed, or whose contract was lost to an older rule).
INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value, awarded_at)
  SELECT id, opportunity_title, organization, account_type, value, COALESCE(won_at, done_at, datetime('now')) FROM tickets
  WHERE deal_status = 'won' AND ticket_type = 'bid' AND id NOT IN (SELECT ticket_id FROM delivery_programs WHERE ticket_id IS NOT NULL);
`);

const insertTeam = db.prepare('INSERT OR IGNORE INTO teams (name) VALUES (?)');
TEAMS.forEach((t) => insertTeam.run(t));

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insertSetting.run(k, v));

// ---- Funding and Pipedrive's installments are one list.
// Funding received on a contract and the installments on its deal (Pipedrive's payment schedule) are the same records,
// kept both ways: a funding entry recorded here goes on the deal as an installment (and to Pipedrive on the next send),
// and an installment pulled from Pipedrive becomes a funding entry on the contract. Billing entries are KIT's own.
// Deleting an installment takes its funding entry with it. When a deal was archived in Pipedrive (as opposed to deleted
// there, or archived here by hand) the ticket says so, and comes back when it's unarchived there.
addColumn('program_entries', 'installment_id', 'INTEGER REFERENCES ticket_installments(id) ON DELETE CASCADE');
addColumn('tickets', 'pipedrive_archived_at', 'TEXT');
// One-time: link what both sides already had. An installment and a funding entry on the same contract with the same
// amount and date are one record; what only one side had is copied to the other.
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'funding_installments_linked'").get()) {
  db.transaction(() => {
    const used = new Set(db.prepare('SELECT installment_id FROM program_entries WHERE installment_id IS NOT NULL').all().map((x) => x.installment_id));
    const entries = db.prepare(`SELECT e.*, p.ticket_id FROM program_entries e JOIN delivery_programs p ON p.id = e.program_id
      WHERE e.kind = 'funding' AND e.installment_id IS NULL AND p.ticket_id IS NOT NULL ORDER BY e.id`).all();
    for (const e of entries) {
      const match = db.prepare('SELECT id FROM ticket_installments WHERE ticket_id = ? AND amount = ? AND billing_date = ? ORDER BY id').all(e.ticket_id, e.amount, e.entry_date)
        .find((i) => !used.has(i.id));
      const id = match ? match.id
        : db.prepare('INSERT INTO ticket_installments (ticket_id, description, amount, billing_date) VALUES (?, ?, ?, ?)').run(e.ticket_id, e.note, e.amount, e.entry_date).lastInsertRowid;
      used.add(id);
      db.prepare('UPDATE program_entries SET installment_id = ? WHERE id = ?').run(id, e.id);
    }
    db.prepare(`INSERT INTO program_entries (program_id, kind, amount, entry_date, note, installment_id)
      SELECT p.id, 'funding', i.amount, COALESCE(i.billing_date, date('now')), i.description, i.id FROM ticket_installments i JOIN delivery_programs p ON p.ticket_id = i.ticket_id
      WHERE i.amount > 0 AND i.id NOT IN (SELECT installment_id FROM program_entries WHERE installment_id IS NOT NULL)`).run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('funding_installments_linked', '1')").run();
  })();
}
db.exec(`
CREATE INDEX IF NOT EXISTS program_entries_installment ON program_entries(installment_id);
-- An installment on a won deal is a funding entry on its contract: made with it, kept in step with it, gone with it.
CREATE TRIGGER IF NOT EXISTS funding_from_installment_insert AFTER INSERT ON ticket_installments
WHEN NEW.amount > 0 AND EXISTS (SELECT 1 FROM delivery_programs WHERE ticket_id = NEW.ticket_id)
BEGIN
  INSERT INTO program_entries (program_id, kind, amount, entry_date, note, installment_id)
  SELECT id, 'funding', NEW.amount, COALESCE(NEW.billing_date, date('now')), NEW.description, NEW.id FROM delivery_programs WHERE ticket_id = NEW.ticket_id;
END;
CREATE TRIGGER IF NOT EXISTS funding_from_installment_update AFTER UPDATE OF amount, billing_date, description, ticket_id ON ticket_installments
BEGIN
  DELETE FROM program_entries WHERE installment_id = NEW.id AND NEW.amount <= 0;
  UPDATE program_entries SET amount = NEW.amount, entry_date = COALESCE(NEW.billing_date, entry_date), note = NEW.description WHERE installment_id = NEW.id;
  INSERT INTO program_entries (program_id, kind, amount, entry_date, note, installment_id)
  SELECT id, 'funding', NEW.amount, COALESCE(NEW.billing_date, date('now')), NEW.description, NEW.id FROM delivery_programs
  WHERE ticket_id = NEW.ticket_id AND NEW.amount > 0 AND NOT EXISTS (SELECT 1 FROM program_entries WHERE installment_id = NEW.id);
END;
-- A deal won with installments already on it: they're the new contract's funding.
CREATE TRIGGER IF NOT EXISTS funding_from_installments_on_contract AFTER INSERT ON delivery_programs
BEGIN
  INSERT INTO program_entries (program_id, kind, amount, entry_date, note, installment_id)
  SELECT NEW.id, 'funding', i.amount, COALESCE(i.billing_date, date('now')), i.description, i.id FROM ticket_installments i
  WHERE i.ticket_id = NEW.ticket_id AND i.amount > 0 AND i.id NOT IN (SELECT installment_id FROM program_entries WHERE installment_id IS NOT NULL);
END;
`);

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? DEFAULT_SETTINGS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

/** Whether an admin has stopped people creating pipeline tickets in KIT. Deals pulled from Pipedrive still come in. */
export const pipelineTicketsClosed = () => getSetting('pipeline_tickets_closed') === '1';
export const PIPELINE_TICKETS_CLOSED = 'An admin has turned off creating new pipeline tickets.';

/** Set someone's teams to `teamIds`. Teams they keep keep their role (member or lead); new ones start as member. Unknown ids are dropped. */
export function setUserTeams(userId, teamIds) {
  const known = new Set(db.prepare('SELECT id FROM teams').all().map((t) => t.id));
  const ids = [...new Set((teamIds || []).map(Number))].filter((id) => known.has(id));
  db.transaction(() => {
    db.prepare('DELETE FROM user_teams WHERE user_id = ? AND team_id NOT IN (SELECT value FROM json_each(?))').run(userId, JSON.stringify(ids));
    const ins = db.prepare('INSERT OR IGNORE INTO user_teams (user_id, team_id) VALUES (?, ?)');
    ids.forEach((id) => ins.run(userId, id));
  })();
}

/** Make someone a member or the lead of one of their teams. Returns false if they aren't on that team. */
export function setTeamRole(userId, teamId, role) {
  return db.prepare('UPDATE user_teams SET role = ? WHERE user_id = ? AND team_id = ?')
    .run(role === 'lead' ? 'lead' : 'member', userId, teamId).changes > 0;
}

export const isTeamLead = (userId, teamId) => !!db.prepare("SELECT 1 FROM user_teams WHERE user_id = ? AND team_id = ? AND role = 'lead'").get(userId, teamId);

/**
 * Add each person's teams and territories to user rows (matched on `id`): teams [{ id, name, role }] by name,
 * team_ids, team_name (every team, "BD, Marketing", for display), and territories [{ id, name }] in list order.
 */
export function withTeams(rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const ids = JSON.stringify(list.filter(Boolean).map((u) => u.id));
  const byUser = new Map();
  const terrByUser = new Map();
  if (ids !== '[]') {
    db.prepare(`SELECT ut.user_id, ut.role, t.id, t.name FROM user_teams ut JOIN teams t ON t.id = ut.team_id
      WHERE ut.user_id IN (SELECT value FROM json_each(?)) ORDER BY t.name`).all(ids)
      .forEach(({ user_id, id, name, role }) => byUser.set(user_id, [...(byUser.get(user_id) || []), { id, name, role }]));
    db.prepare(`SELECT ut.user_id, t.id, t.name FROM user_territories ut JOIN territories t ON t.id = ut.territory_id
      WHERE ut.user_id IN (SELECT value FROM json_each(?)) ORDER BY t.position, t.name`).all(ids)
      .forEach(({ user_id, id, name }) => terrByUser.set(user_id, [...(terrByUser.get(user_id) || []), { id, name }]));
  }
  const out = list.map((u) => {
    if (!u) return u;
    const { team_id, ...rest } = u; // users.team_id is a leftover from one-team-per-person; never pass it on.
    const teams = byUser.get(u.id) || [];
    return { ...rest, teams, team_ids: teams.map((t) => t.id), team_name: teams.map((t) => t.name).join(', ') || null, territories: terrByUser.get(u.id) || [] };
  });
  return Array.isArray(rows) ? out : out[0];
}

/** Admins and the BD team's leads run BD's setup: the territory list, who covers which, and booking targets. */
export function canManageBd(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!db.prepare(`SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id
    WHERE ut.user_id = ? AND ut.role = 'lead' AND t.name = 'BD'`).get(user.id);
}

/** Set the territories someone covers. Unknown ids are dropped. */
export function setUserTerritories(userId, territoryIds) {
  const ids = JSON.stringify([...new Set((territoryIds || []).map(Number))]);
  db.transaction(() => {
    db.prepare('DELETE FROM user_territories WHERE user_id = ? AND territory_id NOT IN (SELECT value FROM json_each(?))').run(userId, ids);
    db.prepare('INSERT OR IGNORE INTO user_territories (user_id, territory_id) SELECT ?, id FROM territories WHERE id IN (SELECT value FROM json_each(?))').run(userId, ids);
  })();
}

/**
 * Who a new pipeline ticket belongs to when nobody says: its creator as BD director if they're on BD, and the territory
 * its account type maps to, else the creator's only territory.
 */
export function defaultAssignment(userId, accountType) {
  const onBd = !!db.prepare("SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD'").get(userId);
  const byType = { Army: 'Army', 'Air Force': 'USAF/USSF', 'Navy / Marine': 'Navy/USMC' }[accountType];
  const mapped = byType && db.prepare('SELECT id FROM territories WHERE name = ?').get(byType);
  const own = db.prepare('SELECT territory_id FROM user_territories WHERE user_id = ?').all(userId);
  return { bd_director_id: onBd ? userId : null, territory_id: mapped?.id ?? (own.length === 1 ? own[0].territory_id : null) };
}

export const json = {
  parse: (s, fallback) => {
    try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
  },
  str: (v) => JSON.stringify(v ?? null),
};
