import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, DatabaseBackup, Download, History, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { fileSize, stamp } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';

const when = (iso) => stamp(iso.slice(0, 19).replace('T', ' '));
const plural = (n, word, words = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : words}`;
const KINDS = [['bid', 'pipeline ticket'], ['work', 'work ticket'], ['cards', 'priority card'], ['contacts', 'contact'], ['events', 'event'], ['contracts', 'contract'], ['users', 'person', 'people']];
/** "12 pipeline tickets, 4 work tickets, 30 priority cards and 9 people", leaving out what's zero. */
const contents = (c) => {
  const parts = KINDS.filter(([k]) => c?.[k]).map(([k, word, words]) => plural(c[k], word, words));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || '';
};

/** Admins only: every backup kept on the server, to restore KIT from, download or delete. */
export default function Backups() {
  const { user } = useAuth();
  return user.role === 'admin' ? <BackupsPage /> : <Navigate to="/settings" replace />;
}

function BackupsPage() {
  const status = useApi('/backup');
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState(null); // 'backup', or the name of the backup being restored or deleted
  const [msg, setMsg] = useState(() => (params.get('restored') ? { ok: true, text: `Restored KIT from the backup of ${when(params.get('restored'))}. Everything is as it was then.` } : null));
  const s = status.data;
  useEffect(() => { if (params.get('restored')) setParams({}, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Check every two seconds while a backup or restore runs elsewhere, so the list shows the result when it's done.
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key, fn, done) => {
    setBusy(key);
    setMsg(null);
    try { const r = await fn(); await status.reload(); const text = done(r); if (text) setMsg({ ok: true, text }); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(null); }
  };
  const backup = () => run('backup', () => api.post('/backup'), (r) => `Backed up KIT at ${when(r.backup.at)}.`);
  const restore = (b) => {
    const typed = prompt(`Restore KIT to the way it was ${when(b.at)}?\n\nEverything changed since then goes away: records, documents and accounts alike. A backup of what's here now is taken first, so this can be undone from the archive.\n\nType RESTORE to confirm.`);
    if (typed == null) return;
    run(b.name, () => api.post(`/backup/${b.name}/restore`, { confirm: typed }), () => {
      // Every page's data changed, so start the app over.
      window.location.assign(`/backups?restored=${encodeURIComponent(b.at)}`);
      return null;
    });
  };
  const remove = (b) => {
    if (!confirm(`Delete the backup from ${when(b.at)} for good?\n\nThis can't be undone.`)) return;
    run(b.name, () => api.del(`/backup/${b.name}`), () => `Deleted the backup from ${when(b.at)}.`);
  };
  const working = !!busy || !!s?.running;
  const total = s?.backups.reduce((n, b) => n + b.bytes, 0) || 0;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-8">
      <PageHeader title="Backup archive" subtitle="Every backup of KIT kept on the server. Restore KIT from one, download it to keep somewhere else, or delete it.">
        <Link to="/admin" className="btn"><ArrowLeft size={15} /> Admin Access</Link>
        <button type="button" className="btn-primary" onClick={backup} disabled={!s || working}>
          {busy === 'backup' || s?.running === 'backup' ? <Loader2 size={15} className="animate-spin" /> : <DatabaseBackup size={15} />} Back up now
        </button>
      </PageHeader>
      {s && (
        <p className="text-sm text-slate-600">
          KIT holds the {fileSize(s.database)} database and {plural(s.documents.count, 'document')} ({fileSize(s.documents.bytes)}) right now.{' '}
          {s.backups.length ? `${plural(s.backups.length, 'backup')} in the archive, ${fileSize(total)} in all.` : ''}
          {s.running === 'restore' && ' Restoring a backup…'}
        </p>
      )}
      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}
      {!msg && s?.error && !s.running && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">The last backup didn&apos;t finish: {s.error}</p>}

      {s && !s.backups.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <History size={28} className="mx-auto mb-2 text-slate-300" />
          No backups yet. Back up now keeps one here.
        </div>
      ) : s && (
        <ul className="space-y-2">
          {s.backups.map((b) => (
            <li key={b.name} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <DatabaseBackup size={18} className="shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-slate-800">{when(b.at)}{b.by ? <span className="font-normal text-slate-500"> by {b.by}</span> : null}</div>
                {b.before && <div className="text-xs text-amber-700">Taken before restoring the backup from {when(b.before)}</div>}
                <div className="text-xs text-slate-500">
                  {fileSize(b.bytes)}{b.database != null ? ` · ${fileSize(b.database)} database` : ''}{b.documents ? ` · ${plural(b.documents.count, 'document')}` : ''}
                  {b.contents ? ` · ${contents(b.contents)}` : ''}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <a href={`/api/backup/${b.name}/download`} download className="btn"><Download size={15} /> Download</a>
                <button type="button" className="btn" onClick={() => restore(b)} disabled={working}>
                  {busy === b.name ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />} Restore
                </button>
                <button type="button" className="btn-danger" onClick={() => remove(b)} disabled={working}><Trash2 size={15} /> Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
