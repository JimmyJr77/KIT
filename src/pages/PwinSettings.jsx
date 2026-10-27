import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { stamp } from '../lib/format.js';
import SidePanel from '../components/SidePanel.jsx';
import {
  CRITERIA, DEFAULT_PWIN_WEIGHTS, DEFAULT_PWIN_GATES, RATING_CREDIT, MUST_HAVE_PENALTY, MAX_PWIN, pwin, weightShares,
} from '../lib/assessment.js';

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));
const everyArea = (rating, override = {}) => Object.fromEntries(CRITERIA.map((c) => [c.key, { score: override[c.key] ?? rating }]));

/** BD Pipeline settings: PWIN weights and must-have areas for the bid and win assessment, with a way back to the defaults. */
export default function PwinSettings({ onClose, onSaved }) {
  const [saved, setSaved] = useState(null); // what the server has
  const [draft, setDraft] = useState(null); // { weights, gates }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/tickets/pwin-weights').then((d) => { setSaved(d); setDraft({ weights: d.weights, gates: d.gates }); });
  }, []);

  const num = (v) => Number(v) || 0;
  const weights = draft ? Object.fromEntries(CRITERIA.map((c) => [c.key, num(draft.weights[c.key])])) : {};
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const shares = draft ? weightShares(weights) : {};
  const dirty = !!draft && !!saved && (CRITERIA.some((c) => weights[c.key] !== saved.weights[c.key]) || !sameSet(draft.gates, saved.gates));
  const atDefaults = !!draft && CRITERIA.every((c) => weights[c.key] === DEFAULT_PWIN_WEIGHTS[c.key]) && sameSet(draft.gates, DEFAULT_PWIN_GATES);

  const setWeight = (k, v) => setDraft((d) => ({ ...d, weights: { ...d.weights, [k]: v === '' ? '' : Math.max(0, Math.min(100, Math.round(Number(v)) || 0)) } }));
  const toggleGate = (k) => setDraft((d) => ({ ...d, gates: d.gates.includes(k) ? d.gates.filter((x) => x !== k) : [...d.gates, k] }));

  const save = async () => {
    if (busy) return;
    if (!total) return setError('At least one area needs some weight');
    setBusy(true);
    setError('');
    try {
      const r = await api.put('/tickets/pwin-weights', { weights, gates: draft.gates });
      setSaved(r);
      setDraft({ weights: r.weights, gates: r.gates });
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => { if (!dirty || confirm('Discard your changes to the PWIN settings?')) onClose(); };

  // Worked examples, recalculated live from the settings being edited.
  const needTitle = CRITERIA.find((c) => c.key === 'need').title;
  const examples = draft ? [
    ['Every area at 5', everyArea(5)],
    ['Every area at 4', everyArea(4)],
    ['Every area at 3', everyArea(3)],
    [`${needTitle} at 2, everything else 5`, everyArea(5, { need: 2 })],
    [`${needTitle} at 1, everything else 5`, everyArea(5, { need: 1 })],
  ].map(([label, a]) => [label, pwin(a, weights, draft.gates)?.score]) : [];

  return (
    <SidePanel title="BD Pipeline settings" subtitle="PWIN weights and must-have areas" onClose={close}
      footer={draft && (
        <div className="space-y-2">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setDraft({ weights: { ...DEFAULT_PWIN_WEIGHTS }, gates: [...DEFAULT_PWIN_GATES] })} disabled={atDefaults || busy}
              title={atDefaults ? 'Already at the default settings' : 'Put every weight and must-have back to its default'}>
              <RotateCcw size={15} /> Restore defaults
            </button>
            <button type="button" className="btn-primary flex-1" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
          </div>
        </div>
      )}>
      {!draft ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-4">
          <section className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-600">
            <p>
              <b className="text-slate-800">PWIN</b> turns each bid ticket’s Bid and win assessment into a probability of win from 0 to{' '}
              {Math.round(MAX_PWIN * 100)}%. Even a ticket rated 5 everywhere tops out at {Math.round(MAX_PWIN * 100)}%, because no pursuit is a sure win.
            </p>
            <div>
              <p className="font-semibold text-slate-700">1. Each rating earns part of its area’s weight (before the {Math.round(MAX_PWIN * 100)}% cap)</p>
              <div className="mt-1 grid grid-cols-5 gap-1 text-center tabular-nums">
                {[5, 4, 3, 2, 1].map((r) => (
                  <div key={r} className="rounded bg-white py-1 ring-1 ring-slate-200">
                    <div className="text-[10px] text-slate-400">Rated {r}</div>
                    <div className="font-semibold text-slate-800">{Math.round(RATING_CREDIT[r] * 100)}%</div>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-slate-500">Each step further from 5 costs more than the one before.</p>
            </div>
            <div>
              <p className="font-semibold text-slate-700">2. Below 3, the whole score is cut</p>
              <p className="mt-0.5">
                A <b>must-have</b> area rated 2 multiplies PWIN by {MUST_HAVE_PENALTY[2]}, and rated 1 by {MUST_HAVE_PENALTY[1]}, however strong
                everything else is. Other areas below 3 cut it too, by more the heavier their weight.
              </p>
            </div>
            <p>Areas not yet rated count as 1 (no information). Weights are relative, so they don’t have to add up to 100. These settings apply to every bid ticket, for everyone.</p>
            <p className="text-slate-500">
              {saved.custom
                ? <>Custom settings{saved.updated_by && <> · changed by {saved.updated_by}</>}{saved.updated_at && <> · {stamp(saved.updated_at)}</>}</>
                : 'Using the default settings.'}
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 p-3">
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">With these settings</h3>
            <ul className="space-y-1 text-sm">
              {examples.map(([label, score]) => (
                <li key={label} className="flex items-center justify-between gap-3">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-semibold text-slate-900 tabular-nums">{score ?? '—'}%</span>
                </li>
              ))}
            </ul>
          </section>

          <ol className="space-y-2">
            {CRITERIA.map((c, n) => {
              const value = draft.weights[c.key];
              const weightChanged = weights[c.key] !== DEFAULT_PWIN_WEIGHTS[c.key];
              const mustHave = draft.gates.includes(c.key);
              const gateChanged = mustHave !== DEFAULT_PWIN_GATES.includes(c.key);
              return (
                <li key={c.key} className={`rounded-lg border p-3 ${mustHave ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <label htmlFor={`w-${c.key}`} className="text-sm font-semibold text-slate-800">{n + 1}. {c.title}</label>
                      <p className="text-[11px] leading-snug text-slate-500">{c.why}</p>
                    </div>
                    <input id={`w-${c.key}`} type="number" min="0" max="100" step="1" inputMode="numeric"
                      className="input w-20 shrink-0 text-right tabular-nums" value={value} onChange={(e) => setWeight(c.key, e.target.value)} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${shares[c.key] || 0}%` }} />
                    </div>
                    <span className="w-24 text-right text-[11px] text-slate-500 tabular-nums">{Math.round(shares[c.key] || 0)}% of score</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-700" title="Rated below 3, a must-have area cuts PWIN hard, whatever its weight">
                      <input type="checkbox" className="h-3.5 w-3.5 accent-amber-600" checked={mustHave} onChange={() => toggleGate(c.key)} />
                      <span className="font-medium">Must-have</span>
                      <span className="text-slate-400">· sinks PWIN when rated below 3</span>
                    </label>
                    {(weightChanged || gateChanged) && (
                      <span className="text-[11px] text-amber-700">
                        Default: {DEFAULT_PWIN_WEIGHTS[c.key]}{DEFAULT_PWIN_GATES.includes(c.key) ? ', must-have' : ''}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="text-right text-xs text-slate-500 tabular-nums">Total weight: {total}</p>
        </div>
      )}
    </SidePanel>
  );
}
