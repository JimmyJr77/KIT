import { useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { tripCosts, lockSum, lockTotal, LOCK_FIELDS, usd } from '../lib/travelCalc.js';
import SidePanel from './SidePanel.jsx';
import Money from './Money.jsx';

/** Grey until the trip's estimate is locked, then black. Sits inside clickable rows, so the click stops here. */
export function LockButton({ locked, onClick }) {
  const label = locked ? 'Estimate locked' : 'Lock estimate';
  return (
    <button type="button" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`rounded p-1 hover:bg-slate-100 ${locked ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
      <Lock size={15} />
    </button>
  );
}

/** The amounts to start from: what was locked, or the trip's current estimate to the cent. */
const startingCosts = (trip) => {
  if (trip.locked_estimate) return trip.locked_estimate.costs;
  const live = tripCosts(trip);
  return Object.fromEntries(LOCK_FIELDS.map(([k]) => [k, Math.round(live[k] * 100) / 100]));
};

/**
 * Lock a trip's estimate: each amount can be changed, and Save makes their total the trip's estimate. A total cost
 * override replaces that total whatever the amounts are. `onSaved` gets the updated trip.
 */
export function EstimateLockPanel({ trip, onClose, onSaved }) {
  const locked = !!trip.locked_estimate;
  const [costs, setCosts] = useState(() => startingCosts(trip));
  const [override, setOverride] = useState(trip.locked_estimate?.override ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const overridden = override !== '';

  const run = async (call) => {
    setBusy(true);
    setError('');
    try {
      onSaved((await call()).trip);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <SidePanel title="Trip estimate" subtitle={trip.traveler_name} onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          {error && <p className="min-w-0 flex-1 text-sm text-red-600">{error}</p>}
          {locked && <button type="button" className="btn" disabled={busy} onClick={() => run(() => api.del(`/travel/${trip.id}/lock`))}>Unlock</button>}
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => run(() => api.put(`/travel/${trip.id}/lock`, { costs, override }))}>Save</button>
        </div>
      )}>
      <div className="space-y-3">
        {LOCK_FIELDS.map(([k, label]) => (
          <Money key={k} label={label} value={costs[k]} onChange={(v) => setCosts((c) => ({ ...c, [k]: v }))} />
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
        <span className="font-semibold">Total</span>
        <span className={`text-xl font-bold ${overridden ? 'text-slate-400 line-through' : 'text-brand-700'}`}>{usd(lockSum(costs))}</span>
      </div>
      <div className="mt-4">
        <Money label="Total cost override" value={override} onChange={setOverride} />
        {overridden && <p className="mt-1 text-xs text-slate-500">The estimate will be {usd(lockTotal(costs, override))}, whatever the amounts above add up to.</p>}
      </div>
    </SidePanel>
  );
}
