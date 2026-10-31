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
// Swim lanes on the Tickets page (todo | in_work | stale | done). Work tickets keep the lane people put them in;
// bid tickets move on their own from their activity unless lane_locked holds them where they are.
addColumn('tickets', 'lane', 'TEXT');
addColumn('tickets', 'lane_locked', 'INTEGER NOT NULL DEFAULT 0');
addColumn('tickets', 'done_at', 'TEXT');      // when it reached Done; it archives 14 days later
addColumn('tickets', 'archived_at', 'TEXT');  // archived early by hand
db.exec(`
-- A bid that's won, lost, or no-bid is done: it moves to Done, unlocked. Reopening it brings it back.
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_close AFTER UPDATE OF pipeline_status ON tickets
WHEN NEW.ticket_type = 'bid' AND NEW.pipeline_status IN ('Awarded', 'Lost', 'No Bid')
  AND (OLD.pipeline_status IS NULL OR OLD.pipeline_status NOT IN ('Awarded', 'Lost', 'No Bid'))
BEGIN
  UPDATE tickets SET done_at = datetime('now'), lane = NULL, lane_locked = 0, archived_at = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_reopen AFTER UPDATE OF pipeline_status ON tickets
WHEN NEW.ticket_type = 'bid' AND OLD.pipeline_status IN ('Awarded', 'Lost', 'No Bid')
  AND (NEW.pipeline_status IS NULL OR NEW.pipeline_status NOT IN ('Awarded', 'Lost', 'No Bid'))
BEGIN
  UPDATE tickets SET done_at = NULL, archived_at = NULL WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS tickets_lane_on_insert AFTER INSERT ON tickets
WHEN NEW.ticket_type = 'bid' AND NEW.pipeline_status IN ('Awarded', 'Lost', 'No Bid')
BEGIN
  UPDATE tickets SET done_at = datetime('now') WHERE id = NEW.id;
END;
`);
// Bids already closed before lanes existed are done as of their last update.
db.exec(`UPDATE tickets SET done_at = updated_at WHERE ticket_type = 'bid' AND pipeline_status IN ('Awarded', 'Lost', 'No Bid') AND done_at IS NULL`);

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

-- Process flow on a bid ticket: RFI, RFP, gate reviews, ROM, proposal and so on, in the order they happen.
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
// Each bid ticket belongs to one BD director and one territory.
addColumn('tickets', 'bd_director_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('tickets', 'territory_id', 'INTEGER REFERENCES territories(id) ON DELETE SET NULL');
if (!hadTerritories) {
  const add = db.prepare('INSERT INTO territories (name, position) VALUES (?, ?)');
  ['Army', 'Navy / Marine Corps', 'Intelligence Community (Agencies)', 'DoD 4th Estate', 'Air Force & Space Force', 'DHS & FBI', 'FedCiv & Other']
    .forEach((name, i) => add.run(name, i));
  // Existing bid tickets: territory from their account type, BD director from whoever created them if they're on BD.
  db.exec(`
    UPDATE tickets SET territory_id = (SELECT id FROM territories WHERE name = CASE tickets.account_type
      WHEN 'Army' THEN 'Army' WHEN 'Air Force' THEN 'Air Force & Space Force' WHEN 'Navy / Marine' THEN 'Navy / Marine Corps' END)
    WHERE ticket_type = 'bid' AND territory_id IS NULL;
    UPDATE tickets SET bd_director_id = created_by
    WHERE ticket_type = 'bid' AND bd_director_id IS NULL AND created_by IN
      (SELECT ut.user_id FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE t.name = 'BD');
  `);
}

// ---- BD financials: when wins are expected, how the pipeline moves, money on won contracts, goals, and account plans.

// When a bid is expected to be won, or flagged as not yet known (the "undetermined" pool).
addColumn('tickets', 'projected_win_date', 'TEXT'); // YYYY-MM-DD
addColumn('tickets', 'win_date_undetermined', 'INTEGER NOT NULL DEFAULT 0');

// One row each time a bid ticket's stage, value, director, territory or projected win date changes, so the pipeline
// can be shown as it stood on any past date (latest row on or before that date). Triggers catch every way of editing.
const hadHistory = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ticket_history'").get();
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
// History starts now. Bids that already exist get one starting row, dated when they were created, with today's values.
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

-- What each open bid was forecast to bring in, captured at the start of the quarter it was expected to close in,
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
  pwin REAL, -- 0-1, or NULL when the bid had no assessment
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
-- Delivery: won contracts. When a bid ticket reaches Awarded, it's copied here to be staffed and delivered.
CREATE TABLE IF NOT EXISTS delivery_programs (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER UNIQUE REFERENCES tickets(id) ON DELETE SET NULL, -- the bid ticket it was won from
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

-- Copy a bid ticket into Delivery the moment it's Awarded, however that happens.
CREATE TRIGGER IF NOT EXISTS delivery_on_award_insert AFTER INSERT ON tickets
WHEN NEW.pipeline_status = 'Awarded' AND NEW.ticket_type = 'bid'
BEGIN
  INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value)
  VALUES (NEW.id, NEW.opportunity_title, NEW.organization, NEW.account_type, NEW.value);
END;
CREATE TRIGGER IF NOT EXISTS delivery_on_award_update AFTER UPDATE OF pipeline_status ON tickets
WHEN NEW.pipeline_status = 'Awarded' AND OLD.pipeline_status IS NOT 'Awarded' AND NEW.ticket_type = 'bid'
BEGIN
  INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value)
  VALUES (NEW.id, NEW.opportunity_title, NEW.organization, NEW.account_type, NEW.value);
END;
`);
// Alerts telling someone they've been put on a won contract.
addColumn('alerts', 'program_id', 'INTEGER REFERENCES delivery_programs(id) ON DELETE CASCADE');

// Bid tickets already Awarded before Delivery existed.
db.exec(`INSERT OR IGNORE INTO delivery_programs (ticket_id, name, organization, account_type, value)
  SELECT id, opportunity_title, organization, account_type, value FROM tickets WHERE pipeline_status = 'Awarded' AND ticket_type = 'bid'`);

// Move the old single notes field on each card into its first note entry.
db.transaction(() => {
  db.prepare(`INSERT INTO card_notes (card_id, body, author_id, created_at)
    SELECT id, trim(notes), created_by, updated_at FROM priority_cards WHERE trim(COALESCE(notes, '')) != ''`).run();
  db.prepare(`UPDATE priority_cards SET notes = NULL WHERE notes IS NOT NULL`).run();
})();

const insertTeam = db.prepare('INSERT OR IGNORE INTO teams (name) VALUES (?)');
TEAMS.forEach((t) => insertTeam.run(t));

const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
Object.entries(DEFAULT_SETTINGS).forEach(([k, v]) => insertSetting.run(k, v));

export function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? DEFAULT_SETTINGS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

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
 * Who a new bid ticket belongs to when nobody says: its creator as BD director if they're on BD, and the territory
 * its account type maps to, else the creator's only territory.
 */
export function defaultAssignment(userId, accountType) {
  const onBd = !!db.prepare("SELECT 1 FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ? AND t.name = 'BD'").get(userId);
  const byType = { Army: 'Army', 'Air Force': 'Air Force & Space Force', 'Navy / Marine': 'Navy / Marine Corps' }[accountType];
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
