import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { DEFAULT_GATE_RULE, QUAL_SCORES, gateRuleText } from '../lib/process.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What makes a qualified lead: the rule every Initial Gate Review is decided by. Which yes/no tests must be a Yes, the
 * least each scored test must score (or that it isn't counted), and whether the solution architect has to approve the
 * Technical Fit. Admins and BD team leads change it; everyone else reads it. `onSaved` runs after a change, since the
 * tags on tickets follow the rule at once.
 */
export default function GateRuleSettings({ onSaved }) {
  const [data, setData] = useState(null); // { rule, tests, can_edit }
  const [rule, setRule] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api.get('/tickets/gate-rule').then((d) => { setData(d); setRule(d.rule); }).catch((e) => setError(e.message)); }, []);
  if (!data || !rule) return error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : <p className="text-sm text-slate-400">Loading…</p>;

  const locked = !data.can_edit;
  const dirty = !same(rule, data.rule);
  // Kept in the tests' own order, so the same picks always compare the same.
  const toggleYes = (k) => setRule((r) => ({ ...r, yes: data.tests.map((t) => t.key).filter((x) => (x === k ? !r.yes.includes(k) : r.yes.includes(x))) }));
  const setMin = (k, v) => setRule((r) => ({ ...r, min: { ...r.min, [k]: Number(v) } }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.put('/tickets/gate-rule', rule);
      setData(d);
      setRule(d.rule);
      onSaved?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        What an Initial Gate Review needs to come out Approved. It decides every review, and the Qualified and UNQUALIFIED tags on tickets follow it as soon as it’s saved.
        {locked && ' Only an admin or a BD team lead can change it.'}
      </p>
      <fieldset disabled={locked} className="space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white">
          <h3 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">Yes / no tests</h3>
          <ul className="divide-y divide-slate-100">
            {data.tests.filter((t) => t.kind === 'gate').map((t) => (
              <li key={t.key}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                  <input type="checkbox" className="mt-0.5" checked={rule.yes.includes(t.key)} onChange={() => toggleYes(t.key)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{t.n}. {t.label}</span>
                    <span className="block text-xs text-slate-500">{rule.yes.includes(t.key) ? 'Must be a Yes' : 'Recorded, but not required'}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white">
          <h3 className="border-b border-slate-100 px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase">Scored tests (1 to 5)</h3>
          <ul className="divide-y divide-slate-100">
            {data.tests.filter((t) => t.kind === 'score').map((t) => (
              <li key={t.key} className="flex items-center gap-3 px-3 py-2.5">
                <label htmlFor={`gate-min-${t.key}`} className="min-w-0 flex-1 text-sm font-medium text-slate-800">{t.n}. {t.label}</label>
                <select id={`gate-min-${t.key}`} className="input w-44 py-1.5 text-sm" value={rule.min[t.key]} onChange={(e) => setMin(t.key, e.target.value)}>
                  <option value={0}>Not counted</option>
                  {QUAL_SCORES.map((n) => <option key={n} value={n}>{n === 5 ? 'Must be 5' : `${n} or higher`}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white">
          <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
            <input type="checkbox" className="mt-0.5" checked={rule.sa} onChange={() => setRule((r) => ({ ...r, sa: !r.sa }))} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-slate-800">Solution architect approves the Technical Fit</span>
              <span className="block text-xs text-slate-500">{rule.sa ? 'A submitted review waits on the SAC list for the architect’s approval' : 'Not required: a submitted review that meets the tests is approved straight away'}</span>
            </span>
          </label>
        </section>
      </fieldset>
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700"><span className="font-semibold">As it reads on the form:</span> {gateRuleText(rule)}</p>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!locked && (
        <div className="flex items-center gap-2">
          <button type="button" className="btn" onClick={() => setRule({ ...DEFAULT_GATE_RULE, yes: [...DEFAULT_GATE_RULE.yes], min: { ...DEFAULT_GATE_RULE.min } })} disabled={busy || same(rule, DEFAULT_GATE_RULE)}
            title="Put the rule back to the one KIT starts with"><RotateCcw size={15} /> Restore defaults</button>
          <button type="button" className="btn-primary flex-1" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save rule'}</button>
        </div>
      )}
    </div>
  );
}
