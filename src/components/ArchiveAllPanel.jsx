import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Loader2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const KINDS = [['bid', 'pipeline ticket'], ['work', 'work ticket'], ['cards', 'priority card'], ['contacts', 'contact'], ['events', 'event'],
  ['trips', 'trip'], ['contracts', 'contract'], ['targets', 'booking target'], ['objectives', 'account objective']];
/** "3 pipeline tickets, 1 work ticket and 12 priority cards", leaving out what's zero. */
export const contents = (d) => {
  const parts = KINDS.filter(([k]) => d[k]).map(([k, word]) => plural(d[k], word));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] || 'nothing';
};

/**
 * Asks for a name, then archives everything on the boards (`live` counts) as one dataset. Returns the new dataset, or
 * null if there was nothing to archive or the admin cancelled.
 */
export async function archiveAll(live) {
  if (!live.bid && !live.work && !live.cards) throw new Error('There’s nothing on the boards to archive.');
  const name = prompt(`Archive all ${contents(live)} on the boards as one dataset? Sample data stays where it is.\n\nName the dataset:`,
    `Archive of ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`);
  if (name === null) return null;
  return (await api.post('/archive/all', { name })).dataset;
}

/** Admin Access: archive everything on the boards as a dataset, and get to the datasets. */
export default function ArchiveAllPanel() {
  const status = useApi('/archive');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const s = status.data;

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await archiveAll(s.live);
      if (d) setMsg({ ok: true, text: `Archived ${contents(d)} as “${d.name}”.` });
      status.reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><Layers size={16} className="text-brand-600" /> Archive</h2>
      <p className="text-xs text-slate-500">
        Archive all takes every real ticket and priority card off the boards as one dataset, with their comments, tasks, activities and
        documents. Sample data stays. Load a dataset back, or delete it for good, from the Archive page.
      </p>
      {s && (
        <p className="text-sm text-slate-600">
          On the boards now: {contents(s.live)}. {plural(s.datasets.length, 'dataset')} in the archive.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={run} disabled={!s || busy}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Layers size={15} />} Archive all
        </button>
        <Link to="/archive?tab=datasets" className="btn">Open the archive</Link>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
      <FullReset />
    </div>
  );
}

/**
 * Full reset: archives all real work data as one dataset and reloads a fresh sample. Nothing is deleted, but it
 * empties every page, so it takes typing RESET.
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
        and billing, booking targets, account objectives, forecasts, marketing, alerts and work logs. People, teams, territories and
        settings stay, so everyone can still sign in. The sample data is replaced with a fresh copy, still shown or hidden as it is now.
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
