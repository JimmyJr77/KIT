import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { fullName } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';

const money = (n) => usd(n).replace('.00', '');
const QUARTERS = [1, 2, 3, 4];

/**
 * Booking targets for each BD director, per quarter and for the year, with the team's total. For admins and BD team
 * leads. A year left blank counts as the sum of its quarters.
 */
export default function BookingTargetsPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useApi(`/targets?year=${year}`);
  const [targets, setTargets] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => { if (data.data) setTargets(data.data.targets); }, [data.data]);
  const directors = data.data?.directors || [];
  const amount = (userId, q) => targets.find((t) => t.user_id === userId && t.quarter === q)?.amount;
  const yearFor = (userId) => amount(userId, 0) ?? QUARTERS.reduce((s, q) => s + (amount(userId, q) || 0), 0);
  const total = (q) => directors.reduce((s, u) => s + (q === 0 ? yearFor(u.id) : amount(u.id, q) || 0), 0);

  const save = async (userId, q, value) => {
    setError('');
    try { setTargets((await api.put('/targets', { user_id: userId, year, quarter: q, amount: value })).targets); } catch (e) { setError(e.message); }
  };

  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto flex items-center gap-2"><Target size={16} className="text-brand-600" /> Booking targets</h2>
        <select className="input h-8 w-28 py-0 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Year">
          {[-1, 0, 1, 2].map((d) => new Date().getFullYear() + d).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
      <p className="text-xs text-slate-500">What each BD director is expected to book (win) per quarter. Leave the year blank to use the sum of the quarters.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="w-48 px-3 py-2">BD director</th>
              {QUARTERS.map((q) => <th key={q} className="px-2 py-2 text-right">Q{q}</th>)}
              <th className="px-3 py-2 text-right">{year}</th>
            </tr>
          </thead>
          <tbody>
            {directors.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-1.5">
                  <div className="font-medium text-slate-800">{fullName(u)}</div>
                  {u.title && <div className="text-xs text-slate-400">{u.title}</div>}
                </td>
                {QUARTERS.map((q) => (
                  <td key={q} className="px-1 py-1.5"><TargetInput value={amount(u.id, q)} label={`${fullName(u)} Q${q} ${year} target`} onSave={(v) => save(u.id, q, v)} /></td>
                ))}
                <td className="px-1 py-1.5">
                  <TargetInput value={amount(u.id, 0)} placeholder={yearFor(u.id) ? money(yearFor(u.id)) : '—'} strong
                    label={`${fullName(u)} ${year} target`} onSave={(v) => save(u.id, 0, v)} />
                </td>
              </tr>
            ))}
            {data.data && !directors.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No one is on BD yet.</td></tr>}
          </tbody>
          {directors.length > 0 && (
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700">
              <tr>
                <td className="px-3 py-2">Team total</td>
                {QUARTERS.map((q) => <td key={q} className="px-3 py-2 text-right tabular-nums">{money(total(q))}</td>)}
                <td className="px-3 py-2 text-right tabular-nums">{money(total(0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

/** A dollar amount that saves when you leave the field (or press Enter). Empty clears it. */
function TargetInput({ value, placeholder = '—', label, strong, onSave }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  const commit = () => { if (String(draft) !== String(value ?? '')) onSave(draft === '' ? null : draft); };
  return (
    <input type="number" min="0" step="1000" className={`input h-8 py-0 text-right text-sm tabular-nums ${strong ? 'font-semibold' : ''}`}
      value={draft} placeholder={placeholder} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
  );
}
