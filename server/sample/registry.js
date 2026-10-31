// Sample data bookkeeping: which rows the sample created, and how to remove exactly those (plus whatever can't exist
// without them) while leaving real data alone, even when real data has been mixed in since.
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
`);

const SKIP = new Set(['sample_rows', 'settings', 'gsa_rates', 'gsa_cache']);
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

// A sample bid's contract, and the forecast lines about it, go with the bid rather than staying behind unlinked.
const DELETE_WITH_PARENT = new Set(['delivery_programs.ticket_id', 'forecast_snapshots.ticket_id']);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');

/**
 * Work out (and, unless `dryRun`, carry out) removing the sample: every recorded row, plus any other row that can't
 * exist without one (it cascades, or its link can't be empty). Links from real rows that can be empty are cleared
 * instead. Returns what would be or was removed, with real data reported apart.
 */
export function removeSample({ dryRun = false } = {}) {
  const all = tables();
  const doomed = new Map(all.map((t) => [t, new Set()]));
  const recorded = new Map(all.map((t) => [t, new Set()]));
  db.prepare('SELECT tbl, row_id FROM sample_rows').all().forEach((r) => {
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
    db.prepare('DELETE FROM sample_rows').run();
    setSetting('sample_loaded_at', '');
    setSampleHidden(false);
  })();
  files.forEach((f) => fs.rmSync(path.join(uploadDir, f.stored_name), { force: true }));
  return summary;
}

/**
 * Hide or show the sample without deleting it. Hidden, each table with sample rows is shadowed by a temporary view of
 * the same name that leaves those rows out; unqualified table names find the view first, so every read in the app skips
 * the sample. Writes go to the real tables (see db.prepare in server/db.js), and the sample keeps its ids, so showing it
 * again brings it back exactly as it was.
 */
export function applySampleVisibility() {
  const hidden = getSetting('sample_hidden') === '1';
  db.prepare("SELECT name FROM sqlite_temp_master WHERE type = 'view'").all().forEach((v) => db.exec(`DROP VIEW temp."${v.name}"`));
  if (!hidden) return;
  db.prepare('SELECT DISTINCT tbl FROM sample_rows').all().map((r) => r.tbl).filter((t) => tables().includes(t)).forEach((t) => {
    db.exec(`CREATE TEMP VIEW "${t}" AS SELECT * FROM main."${t}" WHERE rowid NOT IN (SELECT row_id FROM main.sample_rows WHERE tbl = '${t}')`);
  });
}

export function setSampleHidden(hidden) {
  setSetting('sample_hidden', hidden ? '1' : '');
  applySampleVisibility();
}

applySampleVisibility();
