import { useState } from 'react';
import { FlaskConical, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

// Plain names for the tables the sample fills, for the summary.
const LABELS = { users: 'people', tickets: 'tickets', priority_cards: 'priority cards', delivery_programs: 'contracts', contacts: 'contacts', events: 'events', trips: 'trips', account_objectives: 'account objectives' };
const HEADLINE = Object.keys(LABELS);
const counts = (c) => Object.entries(c || {}).map(([t, n]) => `${n} ${LABELS[t] || t.replace(/_/g, ' ')}`).join(' · ');

/**
 * Admins. On a development server: show or hide the sample data. It's always there; hiding it takes it off every page,
 * for everyone, without deleting it, and real data is never affected either way. In production the sample never loads;
 * a copy left from before can be removed here after seeing what goes with it.
 */
export default function SampleDataPanel() {
  const status = useApi('/sample');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const s = status.data;

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/sample/visibility', { hidden: !s.hidden });
      // Nearly every page's data changed, so start the page over rather than leave other panels out of date.
      window.location.reload();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    const r = s.removal;
    const real = [counts(r?.realDeleted) && `real records deleted: ${counts(r.realDeleted)}`, Object.keys(r?.realCleared || {}).length && `real links cleared: ${Object.entries(r.realCleared).map(([k, n]) => `${n} ${k}`).join(', ')}`].filter(Boolean);
    if (!confirm(`Remove the sample data from production for good? ${counts(r?.sample) || 'Its rows'} go.${real.length ? ` Also: ${real.join('; ')}.` : ' Nothing real is affected.'} This can’t be undone.`)) return;
    setBusy(true);
    setError('');
    try { await api.post('/sample/remove', {}); window.location.reload(); } catch (e) { setError(e.message); setBusy(false); }
  };

  if (s?.production) {
    const r = s.removal;
    const real = r && (Object.keys(r.realDeleted).length || Object.keys(r.realCleared).length);
    return (
      <div className="panel space-y-3">
        <h2 className="section-title flex items-center gap-2"><FlaskConical size={16} className="text-brand-600" /> Sample data</h2>
        <p className="text-xs text-slate-500">The sample data (fake people with @kitdemo.com emails and a year of BD activity) is for development servers only. It never loads in production.</p>
        {s.loaded ? (
          <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex items-start gap-1.5 font-medium"><TriangleAlert size={16} className="mt-0.5 shrink-0" />
              <span>A copy from before is still here, hidden from every page: {counts(r?.sample) || counts(s.counts)}.</span>
            </div>
            {real ? (
              <p className="text-xs">
                Real records point at it, so it wasn&apos;t removed on its own. Removing it also{' '}
                {Object.keys(r.realDeleted).length > 0 && <>deletes {counts(r.realDeleted)}{Object.keys(r.realCleared).length > 0 ? ' and ' : ''}</>}
                {Object.keys(r.realCleared).length > 0 && <>clears {Object.entries(r.realCleared).map(([k, n]) => `${n} ${k.replace('.', ' → ').replace(/_/g, ' ')}`).join(', ')}</>}.
              </p>
            ) : <p className="text-xs">Nothing real depends on it. It&apos;s removed on the next restart, or now.</p>}
            <button type="button" className="btn text-xs text-red-700" onClick={remove} disabled={busy}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove the sample data
            </button>
            {error && <p className="text-xs text-red-700">{error}</p>}
          </div>
        ) : <p className="text-sm text-slate-500">Not loaded here.</p>}
      </div>
    );
  }

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><FlaskConical size={16} className="text-brand-600" /> Sample data</h2>
      <p className="text-xs text-slate-500">
        Fake people (with @kitdemo.com emails) and a year of BD activity, so every page has something to show. It&apos;s kept apart from real
        data, so hiding or showing it never touches anything real. Sample people sign in with the password kitdemouser. Development servers only; production never loads it.
      </p>
      {s && (s.loaded ? (
        <>
          <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
            <button type="button" role="switch" aria-checked={!s.hidden} onClick={toggle} disabled={busy}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${s.hidden ? 'bg-slate-300' : 'bg-brand-600'}`}>
              <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${s.hidden ? '' : 'translate-x-4'}`} />
            </button>
            <span>
              <span className="font-medium">Show sample data</span>
              <span className="block text-xs text-slate-500">{s.hidden ? 'Hidden from every page, for everyone.' : 'Showing on every page, for everyone.'}</span>
            </span>
          </label>
          <p className="text-xs text-slate-500">{HEADLINE.filter((k) => s.counts[k]).map((k) => `${s.counts[k]} ${LABELS[k]}`).join(' · ')}</p>
        </>
      ) : (
        <p className="text-sm text-slate-500">The sample data loads the next time the server starts.</p>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
