import { useState } from 'react';
import { GitBranch } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';

/**
 * Admins: whether KIT's own pipeline (the one that isn't in Pipedrive) takes tickets. Turned off, new pipeline tickets go
 * on Pipedrive's first pipeline, none can be moved to the KIT pipeline, and the tickets still on it can be moved off here
 * (the board drops the KIT pipeline once it's empty).
 */
export default function KitPipelinePanel() {
  const state = useApi('/tickets/kit-pipeline');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const d = state.data;

  const run = async (call) => {
    setBusy(true);
    setError('');
    try {
      await call();
      await state.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => run(() => api.put('/tickets/kit-pipeline', { allowed: !d.allowed }));
  const move = () => {
    if (!confirm(`Move ${d.tickets.length} ticket${d.tickets.length === 1 ? '' : 's'} from the KIT pipeline to ${d.default}? A ticket in a stage ${d.default} doesn't have starts in its first stage.`)) return;
    run(() => api.post('/tickets/kit-pipeline/move'));
  };

  return (
    <div className="panel space-y-3">
      <h2 className="section-title flex items-center gap-2"><GitBranch size={16} className="text-brand-600" /> KIT pipeline</h2>
      <p className="text-xs text-slate-500">
        The KIT pipeline is KIT's own, apart from the pipelines pulled from Pipedrive. Turn it off to rely only on Pipedrive's pipelines.
      </p>
      {d && (
        <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-700">
          <button type="button" role="switch" aria-checked={d.allowed} onClick={toggle} disabled={busy}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${d.allowed ? 'bg-brand-600' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${d.allowed ? 'translate-x-4' : ''}`} />
          </button>
          <span>
            <span className="font-medium">Allow the KIT pipeline</span>
            <span className="block text-xs text-slate-500">
              {d.allowed ? 'On: a pipeline ticket created in KIT starts on the KIT pipeline unless another is chosen.'
                : d.hasPipedrive ? `Off: a pipeline ticket created in KIT starts on ${d.default}, and none can be moved to the KIT pipeline.`
                  : 'Off, but there are no Pipedrive pipelines yet, so the KIT pipeline is still used until they’re pulled.'}
            </span>
          </span>
        </label>
      )}
      {d?.closed && d.tickets.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            {d.tickets.length} ticket{d.tickets.length === 1 ? ' is' : 's are'} still on the KIT pipeline, so it still shows on the BD Pipeline:
            {' '}{d.tickets.slice(0, 8).map((t) => t.title).join(', ')}{d.tickets.length > 8 ? `, and ${d.tickets.length - 8} more` : ''}.
          </p>
          <button type="button" className="btn mt-2" onClick={move} disabled={busy}>Move {d.tickets.length === 1 ? 'it' : 'them'} to {d.default}</button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
