import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

// Plain names for the tables the sample fills, for the summary.
const LABELS = { users: 'people', tickets: 'tickets', priority_cards: 'priority cards', delivery_programs: 'contracts', contacts: 'contacts', events: 'events', trips: 'trips', account_objectives: 'account objectives' };
const HEADLINE = Object.keys(LABELS);

/**
 * Admins: show or hide the sample data. It's always there; hiding it takes it off every page, for everyone, without
 * deleting it, and real data is never affected either way.
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

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><FlaskConical size={16} className="text-brand-600" /> Sample data</h2>
      <p className="text-xs text-slate-500">
        Fake people (with @kitdemo.com emails) and a year of BD activity, so every page has something to show. It's kept apart from real
        data, so hiding or showing it never touches anything real.
        {s?.production ? ' Sample people can\'t sign in here (in production).' : ' Sample people sign in with the password kitdemouser.'}
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
