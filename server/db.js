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

export const json = {
  parse: (s, fallback) => {
    try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; }
  },
  str: (v) => JSON.stringify(v ?? null),
};
