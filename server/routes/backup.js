// Backup copy, admins only: one click downloads the whole system as a single file, the database and every uploaded
// document. The database is copied with SQLite's backup API, so it's consistent even while people are working. The file
// goes straight to the admin's computer and isn't kept on the server, whose disk is small and is the thing being backed up.
// It holds everything, sign-in records included, so it's for admins only. README › Backups says how to restore one.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { db, json, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';

const r = Router();
r.use(requireAdmin);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'server/data/uploads');
let running = false;
let lastError = null;

/** The uploaded files, counted and added up. */
function uploads() {
  if (!fs.existsSync(uploadDir)) return { count: 0, bytes: 0 };
  const files = fs.readdirSync(uploadDir, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
  return { count: files.length, bytes: files.reduce((n, f) => n + fs.statSync(path.join(f.parentPath, f.name)).size, 0) };
}

/** What a backup would hold, and how the last one went. */
r.get('/', (req, res) => {
  res.json({ running, error: lastError, last: json.parse(getSetting('backup_last'), null), database: fs.statSync(db.name).size, documents: uploads() });
});

/** Streams the backup: a .tar.gz holding kit.db and the uploads folder. */
r.get('/download', async (req, res) => {
  if (running) return res.status(409).json({ error: 'A backup is already running. Try again in a minute.' });
  running = true;
  lastError = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-backup-'));
  const done = (error) => {
    running = false;
    if (error) { lastError = error; console.error(`Backup: ${error}`); }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
    await db.backup(path.join(tmp, 'kit.db'));
    const parts = ['kit.db'];
    if (fs.existsSync(uploadDir)) { fs.symlinkSync(uploadDir, path.join(tmp, 'uploads')); parts.push('uploads'); }
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    res.set({ 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="KIT-backup-${stamp}.tar.gz"`, 'Cache-Control': 'private, no-store' });
    const tar = spawn('tar', ['-czhf', '-', '-C', tmp, ...parts], { stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0;
    let stderr = '';
    let gone = false; // the admin cancelled the download
    tar.stdout.on('data', (chunk) => { bytes += chunk.length; });
    tar.stderr.on('data', (chunk) => { stderr += chunk; });
    tar.stdout.pipe(res);
    res.on('close', () => { if (!res.writableFinished) { gone = true; tar.kill(); } });
    tar.on('error', (e) => { res.destroy(); done(e.message); });
    tar.on('close', (code) => {
      if (gone) return done('The download was cancelled before it finished.');
      if (code !== 0) { res.destroy(); return done(stderr.trim().slice(0, 300) || `tar stopped with code ${code}`); } // a broken download, not a file that looks whole
      setSetting('backup_last', json.str({ at: new Date().toISOString(), by: `${req.user.first_name} ${req.user.last_name}`.trim(), bytes }));
      done(null);
    });
  } catch (e) {
    done(e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message }); else res.destroy();
  }
});

export default r;
