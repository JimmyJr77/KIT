// Backups, admins only. Back up now copies the whole system into one file in the backup archive, a folder on the
// server's disk beside the database: kit.db, copied with SQLite's backup API so it's consistent even while people are
// working, and every uploaded document. The Backup archive page lists them; each one can be downloaded, restored or
// deleted. Restoring first backs up what's there now, so it can be undone from the same page. A backup holds everything,
// sign-in records included, which is why all of this is for admins only.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { applyVisibility } from '../sample/registry.js';

const r = Router();
r.use(requireAdmin);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(path.dirname(db.name), 'backups'));
// KIT-backup-2026-11-06-1432, with -2, -3… when two are taken in the same minute.
const NAME = /^KIT-backup-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?$/;
const tarOf = (name) => path.join(backupDir, `${name}.tar.gz`);
const infoOf = (name) => path.join(backupDir, `${name}.json`);
let busy = null; // 'backup' or 'restore' while one runs; only one at a time
let lastError = null;

/** The uploaded files, counted and added up. */
function uploads() {
  if (!fs.existsSync(uploadDir)) return { count: 0, bytes: 0 };
  const files = fs.readdirSync(uploadDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  return { count: files.length, bytes: files.reduce((n, f) => n + fs.statSync(path.join(f.parentPath, f.name)).size, 0) };
}

/** What the database holds right now, hidden sample rows included, since the copy holds them too. */
function contents() {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    bid: n("SELECT COUNT(*) AS n FROM main.tickets WHERE ticket_type = 'bid'"),
    work: n("SELECT COUNT(*) AS n FROM main.tickets WHERE ticket_type = 'work'"),
    cards: n('SELECT COUNT(*) AS n FROM main.priority_cards'),
    contacts: n('SELECT COUNT(*) AS n FROM main.contacts'),
    events: n('SELECT COUNT(*) AS n FROM main.events'),
    contracts: n('SELECT COUNT(*) AS n FROM main.delivery_programs'),
    users: n('SELECT COUNT(*) AS n FROM main.users WHERE active = 1'),
  };
}

/** Runs a command, failing with its stderr. */
const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (c) => { err += c; });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 300) || `${cmd} stopped with code ${code}`))));
});

function freshName() {
  const base = `KIT-backup-${new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')}`;
  let name = base;
  for (let i = 2; fs.existsSync(tarOf(name)); i++) name = `${base}-${i}`;
  return name;
}

/** Every backup in the archive, newest first. One without its .json (half-written, or from before) still lists. */
function list() {
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz') && NAME.test(f.slice(0, -7))).map((f) => {
    const name = f.slice(0, -7);
    let info = {};
    try { info = JSON.parse(fs.readFileSync(infoOf(name), 'utf8')); } catch { /* no details for this one */ }
    const st = fs.statSync(path.join(backupDir, f));
    return { name, at: st.mtime.toISOString(), by: null, before: null, database: null, documents: null, contents: null, ...info, bytes: st.size };
  }).sort((a, b) => (a.at < b.at ? 1 : -1));
}

const who = (req) => `${req.user.first_name} ${req.user.last_name}`.trim();

/**
 * Makes one backup in the archive and returns its details. Built in a temporary folder beside the archive, then moved in
 * whole. `before` is the time of the backup about to be restored, when this one keeps what a restore replaces.
 */
async function makeBackup(req, before = null) {
  fs.mkdirSync(backupDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(backupDir, '.making-'));
  try {
    await db.backup(path.join(tmp, 'kit.db'));
    const parts = ['kit.db'];
    if (fs.existsSync(uploadDir)) { fs.symlinkSync(uploadDir, path.join(tmp, 'uploads')); parts.push('uploads'); }
    const name = freshName();
    const file = path.join(tmp, `${name}.tar.gz`);
    await run('tar', ['-czhf', file, '-C', tmp, ...parts]);
    const info = { name, at: new Date().toISOString(), by: who(req), before, bytes: fs.statSync(file).size, database: fs.statSync(path.join(tmp, 'kit.db')).size, documents: uploads(), contents: contents() };
    fs.writeFileSync(infoOf(name), JSON.stringify(info));
    fs.renameSync(file, tarOf(name));
    return info;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Brings a backup's database up to this version of KIT: the schema code that runs when the server starts, run on the copy
 * in a process of its own, before the copy goes live.
 */
function migrate(dbFile) {
  const dbModule = pathToFileURL(path.resolve(import.meta.dirname, '../db.js')).href;
  const code = `import { db } from ${JSON.stringify(dbModule)}; db.pragma('wal_checkpoint(TRUNCATE)'); db.close();`;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DATABASE_PATH: dbFile }, encoding: 'utf8', timeout: 120000 });
  if (out.status !== 0) throw new Error(`The backup's database couldn't be brought up to date: ${(out.stderr || out.error?.message || '').trim().slice(-300)}`);
}

/** The uploads folder becomes the backup's (empty when the backup had none). */
function replaceUploads(from) {
  const old = `${uploadDir}.replaced`;
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(uploadDir)) fs.renameSync(uploadDir, old);
  fs.mkdirSync(uploadDir, { recursive: true });
  if (fs.existsSync(from)) fs.cpSync(from, uploadDir, { recursive: true });
  fs.rmSync(old, { recursive: true, force: true });
}

const named = (req, res, next) => {
  if (!NAME.test(req.params.name) || !fs.existsSync(tarOf(req.params.name))) return res.status(404).json({ error: 'That backup is no longer in the archive' });
  return next();
};
const refuse = (res) => res.status(409).json({ error: busy === 'restore' ? 'A restore is running. Wait for it to finish.' : 'A backup is already running. Try again in a minute.' });

/** What a backup would hold, how the last one went, and the archive. */
r.get('/', (req, res) => {
  res.json({ running: busy, error: lastError, database: fs.statSync(db.name).size, documents: uploads(), backups: list() });
});

/** Back up now: a new backup in the archive. */
r.post('/', async (req, res) => {
  if (busy) return refuse(res);
  busy = 'backup';
  lastError = null;
  try {
    res.json({ backup: await makeBackup(req) });
  } catch (e) {
    lastError = e.message;
    console.error(`Backup: ${e.message}`);
    res.status(500).json({ error: e.message });
  } finally {
    busy = null;
  }
});

/** The backup file itself, to keep somewhere else. */
r.get('/:name/download', named, (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.download(tarOf(req.params.name), `${req.params.name}.tar.gz`);
});

r.delete('/:name', named, (req, res) => {
  fs.rmSync(tarOf(req.params.name), { force: true });
  fs.rmSync(infoOf(req.params.name), { force: true });
  res.json({ ok: true });
});

/**
 * Body: { confirm: 'RESTORE' }. KIT goes back to the way it was when the backup was taken: its database replaces the live
 * one page by page through SQLite's backup API while KIT keeps running, and its documents replace the uploads folder.
 * What's here now is backed up first, so the restore can be undone from the archive.
 */
r.post('/:name/restore', named, async (req, res) => {
  if (req.body?.confirm !== 'RESTORE') return res.status(400).json({ error: 'Type RESTORE to confirm' });
  if (busy) return refuse(res);
  busy = 'restore';
  lastError = null;
  const { name } = req.params;
  const tmp = fs.mkdtempSync(path.join(backupDir, '.restoring-'));
  try {
    const kept = await makeBackup(req, list().find((b) => b.name === name)?.at || null);
    await run('tar', ['-xzf', tarOf(name), '-C', tmp]);
    const dbFile = path.join(tmp, 'kit.db');
    if (!fs.existsSync(dbFile)) throw new Error("The backup doesn't hold a database");
    migrate(dbFile);
    const src = new Database(dbFile);
    try { await src.backup(db.name); } finally { src.close(); }
    replaceUploads(path.join(tmp, 'uploads'));
    applyVisibility(); // the hidden rows are the restored database's
    console.log(`Restored the backup ${name} (${who(req)}); what was there is kept as ${kept.name}`);
    res.json({ restored: name, kept: kept.name });
  } catch (e) {
    lastError = e.message;
    console.error(`Restore: ${e.message}`);
    res.status(500).json({ error: e.message });
  } finally {
    busy = null;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

export default r;
