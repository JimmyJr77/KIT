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
