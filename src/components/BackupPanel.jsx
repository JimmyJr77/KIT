import { useEffect, useRef, useState } from 'react';
import { DatabaseBackup, Loader2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { stamp } from '../lib/format.js';

const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const when = (iso) => stamp(iso.slice(0, 19).replace('T', ' '));

/** Admin Access: download a copy of everything in KIT, and the full reset. */
export default function BackupPanel() {
  const status = useApi('/backup');
  const [starting, setStarting] = useState(false);
  const link = useRef(null);
  const s = status.data;
  // Check every two seconds while a backup runs, so the result shows when it's done.
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const backup = () => {
    setStarting(true);
    link.current.click();
    // The browser takes over the download; look shortly after to see it running.
    setTimeout(() => { status.reload(); setStarting(false); }, 1500);
  };
  const busy = starting || s?.running;

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><DatabaseBackup size={16} className="text-brand-600" /> Backup copy</h2>
      <p className="text-xs text-slate-500">
        Downloads a full copy of KIT to this computer as one file: every record in the system, the archive included, and every uploaded document. Nothing in KIT changes.
        The file holds all of KIT&apos;s data and its sign-in records, so keep it somewhere safe.
      </p>
      {s && (
        <p className="text-sm text-slate-600">
          Holds the {size(s.database)} database and {s.documents.count.toLocaleString()} document{s.documents.count === 1 ? '' : 's'} ({size(s.documents.bytes)}).{' '}
          {s.last ? `Last backup ${when(s.last.at)} by ${s.last.by} (${size(s.last.bytes)}).` : 'No backup taken yet.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <a ref={link} href="/api/backup/download" download className="hidden" aria-hidden="true" tabIndex={-1}>Download</a>
        <button type="button" className="btn-primary" onClick={backup} disabled={!s || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />} Backup archive
        </button>
        {busy && <span className="text-sm text-slate-500">Making the backup. Your browser saves the file when it arrives.</span>}
      </div>
      {!busy && s?.error && <p className="text-sm text-red-600">The last backup didn&apos;t finish: {s.error}</p>}
      <FullReset />
    </div>
  );
}

/**
 * Full reset: archives all real work data as one dataset. Nothing is deleted, but it empties every page, so it takes
 * typing RESET.
 */
function FullReset() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = text === 'RESET';

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/archive/reset', { confirm: text });
      // Every page's data changed, so start over on the archive, where the new dataset is.
      window.location.assign('/archive?tab=datasets');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-red-800"><TriangleAlert size={15} /> Full reset</h3>
      <p className="text-xs text-red-900/80">
        Archives all real work data as one dataset: every ticket and priority card, the CRM, events, travel, contracts with their funding
        and billing, booking and qualified pipeline targets, account objectives, forecasts, marketing, alerts and work logs. People, teams, territories and
        settings stay, so everyone can still sign in. On a development server the sample data is replaced with a fresh copy, still shown or hidden as it is now.
        Nothing is deleted: load the dataset from the archive to bring it all back.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input w-40 font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type RESET"
          aria-label="Type RESET to confirm" autoComplete="off" spellCheck={false} disabled={busy} />
        <button type="button" className="btn-danger" onClick={reset} disabled={!ready || busy}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> Resetting…</> : 'Full reset'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
