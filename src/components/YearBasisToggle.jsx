import { useYearBasis } from '../lib/yearBasis.js';

/** Calendar year or trailing four quarters, for figures that cover a year. Shared across views (see lib/yearBasis.js). */
export default function YearBasisToggle({ className = '' }) {
  const [basis, setBasis] = useYearBasis();
  return (
    <div className={`flex shrink-0 rounded-md bg-white p-0.5 text-xs ring-1 ring-slate-200 ${className}`} role="radiogroup" aria-label="Year basis">
      {[['calendar', 'Calendar year', 'January through December'], ['t4q', 'Trailing 4 quarters', 'The last four finished quarters']].map(([k, l, hint]) => (
        <button key={k} type="button" role="radio" aria-checked={basis === k} title={hint} onClick={() => setBasis(k)}
          className={`rounded px-2 py-1 whitespace-nowrap ${basis === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
      ))}
    </div>
  );
}
