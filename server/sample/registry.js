// Row bookkeeping for the sample data and for archived datasets: which rows the sample created, which real rows a full
// reset archived, how to hide them (temporary views stand in for the tables) and how to remove exactly those rows (plus
// whatever can't exist without them) while leaving everything else alone.
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting } from '../db.js';

db.exec(`
-- Every row the sample data created, by table and rowid.
CREATE TABLE IF NOT EXISTS sample_rows (
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  PRIMARY KEY (tbl, row_id)
);
-- Real rows archived by a full reset, by dataset. Hidden from every page until the dataset is loaded back.
CREATE TABLE IF NOT EXISTS archived_rows (
  set_id INTEGER NOT NULL REFERENCES archive_sets(id) ON DELETE CASCADE,
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL,
  PRIMARY KEY (tbl, row_id)
);
CREATE INDEX IF NOT EXISTS archived_rows_set ON archived_rows(set_id);
`);

const SKIP = new Set(['sample_rows', 'archived_rows', 'archive_sets', 'settings', 'gsa_rates', 'gsa_cache']);
const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()
  .map((t) => t.name).filter((t) => !SKIP.has(t));
const maxRowid = (t) => db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS n FROM main."${t}"`).get().n;

/**
 * Run `fn` (which only inserts) in one transaction and record every row it created, including rows made by triggers.
 * better-sqlite3 runs synchronously, so nothing else can insert in between.
 */
export function recordSample(fn) {
  return db.transaction(() => {
    const before = Object.fromEntries(tables().map((t) => [t, maxRowid(t)]));
    const result = fn();
    const add = db.prepare('INSERT OR IGNORE INTO sample_rows (tbl, row_id) VALUES (?, ?)');
    tables().forEach((t) => {
      db.prepare(`SELECT rowid AS id FROM main."${t}" WHERE rowid > ?`).all(before[t] ?? 0).forEach((r) => add.run(t, r.id));
    });
    setSetting('sample_loaded_at', new Date().toISOString().slice(0, 19).replace('T', ' '));
    return result;
  })();
}

/** How much sample data there is, by table. */
export function sampleStatus() {
  const rows = db.prepare('SELECT tbl, COUNT(*) AS n FROM sample_rows GROUP BY tbl').all();
  return { loaded: rows.length > 0, hidden: getSetting('sample_hidden') === '1', loadedAt: getSetting('sample_loaded_at') || null, counts: Object.fromEntries(rows.map((r) => [r.tbl, r.n])) };
}

// A sample pipeline ticket's contract, and the forecast lines about it, go with the pipeline ticket rather than staying behind unlinked.
const DELETE_WITH_PARENT = new Set(['delivery_programs.ticket_id', 'forecast_snapshots.ticket_id']);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');

/**
 * Work out (and, unless `dryRun`, carry out) removing the sample: every recorded row, plus any other row that can't
 * exist without one (it cascades, or its link can't be empty). Links from real rows that can be empty are cleared
 * instead. Returns what would be or was removed, with real data reported apart.
 */
export function removeSample({ dryRun = false } = {}) {
  return removeRows(db.prepare('SELECT tbl, row_id FROM sample_rows').all(), {
    dryRun,
    finish: () => {
      db.prepare('DELETE FROM sample_rows').run();
      setSetting('sample_loaded_at', '');
      setSampleHidden(false);
    },
  });
}

/**
 * Remove `seed` rows ([{ tbl, row_id }]) the same way: plus whatever can't exist without them, clearing links that can
 * be empty. `finish` runs inside the same transaction. `summary.sample` counts seed rows; the rest are reported apart.
 */
function removeRows(seed, { dryRun = false, finish } = {}) {
  const all = tables();
  const doomed = new Map(all.map((t) => [t, new Set()]));
  const recorded = new Map(all.map((t) => [t, new Set()]));
  seed.forEach((r) => {
    if (!doomed.has(r.tbl)) return; // a table that no longer exists
    doomed.get(r.tbl).add(r.row_id);
    recorded.get(r.tbl).add(r.row_id);
  });
  // Recorded rows that were deleted since don't count.
  all.forEach((t) => {
    const ids = [...doomed.get(t)];
    if (!ids.length) return;
    const live = new Set(db.prepare(`SELECT rowid AS id FROM main."${t}" WHERE rowid IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)).map((r) => r.id));
    doomed.set(t, live);
    recorded.set(t, new Set([...recorded.get(t)].filter((id) => live.has(id))));
  });

  const fks = all.flatMap((t) => db.prepare(`SELECT * FROM pragma_foreign_key_list('${t}', 'main')`).all().map((fk) => ({ ...fk, child: t })));
  const nullable = (t, col) => db.prepare(`SELECT "notnull" FROM pragma_table_info('${t}', 'main') WHERE name = ?`).get(col)?.notnull === 0;
  const clear = new Map(); // "table.column" → Set of rowids to set to NULL

  // Follow links until nothing new turns up.
  for (let changed = true; changed;) {
    changed = false;
    for (const fk of fks) {
      const parentIds = [...(doomed.get(fk.table) || [])];
      if (!parentIds.length) continue;
      const parentCol = fk.to || 'rowid';
      const values = db.prepare(`SELECT "${parentCol}" AS v FROM main."${fk.table}" WHERE rowid IN (SELECT value FROM json_each(?))`).all(JSON.stringify(parentIds)).map((r) => r.v);
      const rows = db.prepare(`SELECT rowid AS id FROM main."${fk.child}" WHERE "${fk.from}" IN (SELECT value FROM json_each(?))`).all(JSON.stringify(values));
      const key = `${fk.child}.${fk.from}`;
      const del = DELETE_WITH_PARENT.has(key) || fk.on_delete === 'CASCADE' || (fk.on_delete !== 'SET NULL' && !nullable(fk.child, fk.from));
      for (const { id } of rows) {
        if (doomed.get(fk.child).has(id)) continue;
        if (del) { doomed.get(fk.child).add(id); changed = true; } else {
          if (!clear.has(key)) clear.set(key, new Set());
          clear.get(key).add(id);
        }
      }
    }
  }

  const summary = { sample: {}, realDeleted: {}, realCleared: {} };
  all.forEach((t) => {
    const n = doomed.get(t).size;
    if (!n) return;
    const sample = recorded.get(t).size;
    if (sample) summary.sample[t] = sample;
    if (n - sample) summary.realDeleted[t] = n - sample;
  });
  clear.forEach((ids, key) => {
    const t = key.split('.')[0];
    const left = [...ids].filter((id) => !doomed.get(t).has(id));
    if (left.length) summary.realCleared[key] = left.length;
  });
  if (dryRun) return summary;

  const files = [
    ...db.prepare('SELECT stored_name FROM ticket_files WHERE rowid IN (SELECT value FROM json_each(?))').all(JSON.stringify([...doomed.get('ticket_files') || []])),
    ...db.prepare('SELECT stored_name FROM delivery_files WHERE rowid IN (SELECT value FROM json_each(?))').all(JSON.stringify([...doomed.get('delivery_files') || []])),
    ...db.prepare('SELECT stored_name FROM marketing_assets WHERE rowid IN (SELECT value FROM json_each(?))').all(JSON.stringify([...doomed.get('marketing_assets') || []])),
  ];
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON'); // order doesn't matter; links are checked once, at commit
    clear.forEach((ids, key) => {
      const [t, col] = key.split('.');
      const left = [...ids].filter((id) => !doomed.get(t).has(id));
      if (left.length) db.prepare(`UPDATE "${t}" SET "${col}" = NULL WHERE rowid IN (SELECT value FROM json_each(?))`).run(JSON.stringify(left));
    });
    doomed.forEach((ids, t) => {
      if (ids.size) db.prepare(`DELETE FROM main."${t}" WHERE rowid IN (SELECT value FROM json_each(?))`).run(JSON.stringify([...ids]));
    });
    finish?.();
  })();
  files.forEach((f) => fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }));
  return summary;
}

/**
 * Hide the sample (when switched off) and every row archived by a full reset, without deleting them. Each affected
 * table is shadowed by a temporary view of the same name that leaves those rows out; unqualified table names find the
 * view first, so every read in the app skips them. Writes go to the real tables (see db.prepare in server/db.js), and
 * the rows keep their ids, so showing them again brings them back exactly as they were.
 */
export function applyVisibility() {
  const sampleHidden = getSetting('sample_hidden') === '1';
  db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'view'").all().forEach((v) => db.exec(`DROP VIEW temp."${v.name}"`));
  const archived = new Set(db.prepare('SELECT DISTINCT tbl FROM archived_rows').all().map((r) => r.tbl));
  const sample = new Set(sampleHidden ? db.prepare('SELECT DISTINCT tbl FROM sample_rows').all().map((r) => r.tbl) : []);
  tables().filter((t) => archived.has(t) || sample.has(t)).forEach((t) => {
    const hide = [archived.has(t) && `SELECT row_id FROM main.archived_rows WHERE tbl = '${t}'`, sample.has(t) && `SELECT row_id FROM main.sample_rows WHERE tbl = '${t}'`]
      .filter(Boolean).map((q) => `rowid NOT IN (${q})`).join(' AND ');
    db.exec(`CREATE TEMP VIEW "${t}" AS SELECT * FROM main."${t}" WHERE ${hide}`);
  });
}

/** Archive every real row of `tbls` (not sample, not already archived) into dataset `setId`, hiding it. Counts by table. */
export function archiveRows(setId, tbls) {
  const counts = {};
  db.transaction(() => {
    tbls.filter((t) => tables().includes(t)).forEach((t) => {
      counts[t] = db.prepare(`INSERT INTO archived_rows (set_id, tbl, row_id) SELECT ?, ?, rowid FROM main."${t}"
        WHERE rowid NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = ?) AND rowid NOT IN (SELECT row_id FROM main.archived_rows WHERE tbl = ?)`)
        .run(setId, t, t, t).changes;
    });
  })();
  applyVisibility();
  return counts;
}

/** Bring a dataset's archived rows back into view. */
export function restoreRows(setId) {
  db.prepare('DELETE FROM archived_rows WHERE set_id = ?').run(setId);
  applyVisibility();
}

/** Delete a dataset's archived rows for good (and whatever can't exist without them). */
export function deleteRows(setId) {
  const summary = removeRows(db.prepare('SELECT tbl, row_id FROM archived_rows WHERE set_id = ?').all(setId), {
    finish: () => db.prepare('DELETE FROM archived_rows WHERE set_id = ?').run(setId),
  });
  applyVisibility();
  return summary;
}

/** Archived row counts per dataset: { [setId]: { [table]: n } }. */
export function archivedRowCounts() {
  const out = {};
  db.prepare('SELECT set_id, tbl, COUNT(*) AS n FROM archived_rows GROUP BY set_id, tbl').all().forEach((r) => { (out[r.set_id] ||= {})[r.tbl] = r.n; });
  return out;
}

export function setSampleHidden(hidden) {
  setSetting('sample_hidden', hidden ? '1' : '');
  applyVisibility();
}

applyVisibility();
