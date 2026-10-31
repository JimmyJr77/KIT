import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, Check, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { stamp } from '../lib/format.js';

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
/** "1,623 deals (12 new) · 1,157 contacts…" from a sync result. */
function summary(r) {
  const part = (added, updated, word, many) => {
    const n = (added || 0) + (updated || 0);
    return n ? `${plural(n, word, many)}${added && updated ? ` (${added.toLocaleString()} new)` : ''}` : null;
  };
  return [
    r.pipelines && plural(r.pipelines, 'new pipeline'), part(r.dealsAdded, r.dealsUpdated, 'deal'), part(r.contactsAdded, r.contactsUpdated, 'contact'),
    part(r.activitiesAdded, r.activitiesUpdated, 'activity', 'activities'), part(r.notesAdded, r.notesUpdated, 'note'),
    r.filesAdded && plural(r.filesAdded, 'new file'),
  ].filter(Boolean).join(' · ');
}

/**
 * Admins: bring Pipedrive into KIT. Pipelines, deals (as bid tickets), people, activities, notes and files come over;
 * Pipedrive users are matched to KIT accounts by email, and deal owners without one get an account to claim.
 */
export default function PipedrivePanel() {
  const status = useApi('/pipedrive');
  const [error, setError] = useState('');
  const s = status.data;

  // While a sync runs, check on it every two seconds.
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setTimeout(() => status.reload(), 2000);
    return () => clearTimeout(t);
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    setError('');
    try { await api.post('/pipedrive/sync'); status.reload(); } catch (e) { setError(e.message); }
  };
  const last = s?.last;

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><RefreshCw size={16} className="text-brand-600" /> Pipedrive</h2>
      <p className="text-xs text-slate-500">
        Pipedrive → KIT. Each Pipedrive pipeline gets a matching KIT pipeline; deals come over as bid tickets (closed ones already archived),
        with their people, activities, notes and files. People are matched to KIT accounts by email, and a deal owner without one gets an
        account they claim by activating with that email. Pipedrive wins on the fields it holds; KIT&apos;s own work on a ticket is kept.
        It also syncs every night.
      </p>
      {s && !s.configured && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Add PIPEDRIVE_API_KEY to the server settings to sync.</p>}
      {last && !s?.running && (
        <div className={`rounded-lg px-3 py-2 text-sm ${last.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
          <div className="flex items-center gap-1.5 font-medium">
            {last.ok ? <Check size={14} /> : <TriangleAlert size={14} />}
            {last.ok ? 'Last synced' : 'Last sync failed'} {stamp(last.at.slice(0, 19).replace('T', ' '))}{last.by ? ` by ${last.by}` : ' (nightly)'}
          </div>
          {last.ok ? (
            <>
              <div className="mt-0.5 text-xs">{summary(last.result) || 'Nothing changed.'}</div>
              {last.result.accountsCreated?.length > 0 && (
                <div className="mt-1 text-xs">New accounts, waiting to be activated: {last.result.accountsCreated.join(', ')}</div>
              )}
            </>
          ) : <div className="mt-0.5 text-xs">{last.error}</div>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={sync} disabled={!s?.configured || s?.running}>
          {s?.running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {s?.running ? 'Syncing…' : 'Sync now'}
        </button>
        {s?.running && <span className="text-sm text-slate-500">{s.phase}…</span>}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
