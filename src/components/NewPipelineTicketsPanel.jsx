import { useState } from 'react';
import { Ticket } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

/**
 * Admins: whether anyone, admins included, can create pipeline tickets in KIT. Turned off, the ways of creating one are
 * greyed out on the BD Pipeline, Tickets and Weekly Priorities, and the server refuses them.
 */
export default function NewPipelineTicketsPanel() {
  const meta = useApi('/priorities/meta');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closed = !!meta.data?.pipelineTicketsClosed;

  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put('/tickets/pipeline-creation', { closed: !closed });
      await meta.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><Ticket size={16} className="text-brand-600" /> New pipeline tickets</h2>
      <p className="text-xs text-slate-500">
        Controls whether anyone, admins included, can create pipeline tickets in KIT. Existing pipeline tickets, work tickets and deals pulled from Pipedrive aren't affected.
      </p>
      {meta.data && (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
          <button type="button" role="switch" aria-checked={!closed} onClick={toggle} disabled={busy}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${closed ? 'bg-slate-300' : 'bg-brand-600'}`}>
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${closed ? '' : 'translate-x-4'}`} />
          </button>
          <span>
            <span className="font-medium">Allow new pipeline tickets</span>
            <span className="block text-xs text-slate-500">
              {closed ? 'Off: creating one is greyed out on the BD Pipeline, Tickets and Weekly Priorities.' : 'On: anyone can create them.'}
            </span>
          </span>
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
