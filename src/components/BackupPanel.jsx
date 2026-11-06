import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DatabaseBackup, Loader2, Archive, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fileSize, stamp } from '../lib/format.js';

const when = (iso) => stamp(iso.slice(0, 19).replace('T', ' '));

/** Admin Access: back up everything in KIT into the backup archive, and open the archive to restore from one. */
export default function BackupPanel() {
  const status = useApi('/backup');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = status.data;
  // Check every two seconds while a backup or restore runs elsewhere, so the result shows when it's done.
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const backup = async () => {
    setBusy(true);
    setError('');
    try { await api.post('/backup'); await status.reload(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const working = busy || !!s?.running;
  const last = s?.backups[0];

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><DatabaseBackup size={16} className="text-brand-600" /> Backup copy</h2>
      <p className="text-xs text-slate-500">
        Back up now copies everything in KIT into one file in the backup archive: every record in the system, the archive included, and every uploaded document. Nothing in KIT changes.
        From the backup archive, restore KIT to the way it was when a backup was taken, download one to keep somewhere else, or delete old ones.
        Backups hold all of KIT&apos;s data and its sign-in records, so they&apos;re for admins only.
      </p>
      {s && (
        <p className="text-sm text-slate-600">
          Holds the {fileSize(s.database)} database and {s.documents.count.toLocaleString()} document{s.documents.count === 1 ? '' : 's'} ({fileSize(s.documents.bytes)}).{' '}
          {last ? `Last backup ${when(last.at)}${last.by ? ` by ${last.by}` : ''} (${fileSize(last.bytes)}).` : 'No backup taken yet.'}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={backup} disabled={!s || working}>
          {working ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />} Back up now
        </button>
        <Link to="/backups" className="btn"><History size={15} /> Backup archive{s && <span className="text-xs text-slate-500">{s.backups.length}</span>}</Link>
        {working && <span className="text-sm text-slate-500">{s?.running === 'restore' ? 'Restoring a backup…' : 'Making the backup…'}</span>}
      </div>
      {!working && (error || s?.error) && <p className="text-sm text-red-600">{error || `The last backup didn't finish: ${s.error}`}</p>}
      <p className="text-xs text-slate-500">
        <Link to="/archive" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Archive size={13} /> Open the archive</Link>: tickets and priority cards taken off the boards. Restore them, or delete them for good.
      </p>
    </div>
  );
}
