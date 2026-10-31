import { useState } from 'react';
import { FlaskConical, Download, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { stamp } from '../lib/format.js';

// Plain names for the tables the sample fills, for the summary and the removal preview.
const LABELS = {
  users: 'people', tickets: 'tickets', priority_cards: 'priority cards', contacts: 'contacts', events: 'events', trips: 'trips',
  delivery_programs: 'contracts', program_entries: 'funding and billing entries', booking_targets: 'booking targets', account_objectives: 'account objectives',
  ticket_comments: 'comments', card_notes: 'notes', card_assignees: 'card assignments', ticket_files: 'documents', alerts: 'alerts', work_log: 'work log entries',
  'tickets.bd_director_id': 'tickets would lose their BD director', 'tickets.created_by': 'tickets would lose their creator',
  'delivery_programs.program_manager_id': 'contracts would lose their Program Manager',
};
const label = (k) => LABELS[k] || k.replace(/_/g, ' ');
const HEADLINE = ['users', 'tickets', 'priority_cards', 'delivery_programs', 'contacts', 'events', 'trips', 'account_objectives'];

/**
 * Admins: load, reset or remove the sample data, or hide it for now. Every row it creates is recorded, so removing it takes
 * exactly the sample (and anything that can't exist without it), leaving real data. Removal is previewed first.
 */
export default function SampleDataPanel() {
  const status = useApi('/sample');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const s = status.data;

  const act = async (action) => {
    if (action === 'remove' || action === 'reset') {
      const p = s.preview;
      const real = [...Object.entries(p.realDeleted).map(([k, n]) => `• ${n} ${label(k)} of yours would be deleted (they're attached to sample records)`),
        ...Object.entries(p.realCleared).map(([k, n]) => `• ${n} ${label(k)}`)];
      const text = `${action === 'reset' ? 'Reset' : 'Remove'} the sample data? This permanently deletes every sample record, including the ${s.counts.users || 0} sample people.`
        + (real.length ? `\n\nReal data affected:\n${real.join('\n')}` : '\n\nNo real data is affected.')
        + (action === 'reset' ? '\n\nA fresh copy of the sample is loaded afterwards.' : '');
      if (!confirm(text)) return;
    }
    setBusy(action);
    setMsg(null);
    try {
      await api.post(`/sample/${action}`, action === 'visibility' ? { hidden: !s.hidden } : undefined);
      // Nearly every page's data changed, so start the page over rather than leave other panels out of date.
      window.location.reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
      setBusy(null);
    }
  };
  const spin = (a, Icon) => (busy === a ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />);

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><FlaskConical size={16} className="text-brand-600" /> Sample data</h2>
      <p className="text-xs text-slate-500">
        Fake people (with @kitdemo.com emails) and a year of BD activity, so every page has something to show. Everything it adds is tracked,
        so removing it takes exactly the sample and leaves real data, even if the two have been mixed.
        {s?.production ? ' Sample people can\'t sign in here (in production).' : ' Sample people sign in with the password kitdemouser.'}
      </p>
      {s && (
        <div className={`rounded-lg px-3 py-2 text-sm ${s.loaded ? 'bg-sky-50 text-sky-900' : 'bg-slate-50 text-slate-600'}`}>
          {s.loaded ? (
            <>
              <span className="font-medium">{s.hidden ? `Hidden${s.loadedAt ? ` (loaded ${stamp(s.loadedAt)})` : ''}` : `Loaded${s.loadedAt ? ` ${stamp(s.loadedAt)}` : ''}`}:</span>{' '}
              {HEADLINE.filter((k) => s.counts[k]).map((k) => `${s.counts[k]} ${label(k)}`).join(' · ')}
            </>
          ) : 'Not loaded.'}
        </div>
      )}
      {s?.loaded && (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
          <button type="button" role="switch" aria-checked={!s.hidden} onClick={() => act('visibility')} disabled={!!busy}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${s.hidden ? 'bg-slate-300' : 'bg-brand-600'}`}>
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${s.hidden ? '' : 'translate-x-4'}`} />
          </button>
          <span>
            <span className="font-medium">Show sample data</span>
            <span className="block text-xs text-slate-500">
              {s.hidden ? 'Hidden from every page, for everyone. Turn it back on to bring it back as it was.' : 'Turn off to hide it from every page, for everyone, without deleting it.'}
            </span>
          </span>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" onClick={() => act('load')} disabled={!s || s.loaded || !!busy}>{spin('load', Download)} Load sample data</button>
        <button type="button" className="btn" onClick={() => act('reset')} disabled={!s?.loaded || !!busy} title="Remove the sample and load a fresh copy">{spin('reset', RotateCcw)} Reset</button>
        <button type="button" className="btn-danger" onClick={() => act('remove')} disabled={!s?.loaded || !!busy}>{spin('remove', Trash2)} Remove sample data</button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}
