/** A dropdown of the BD directors on `tickets`, A–Z by last name, plus "No BD director" when any ticket lacks one. */
export default function DirectorSelect({ tickets, value, onChange, className = '' }) {
  const directors = new Map();
  (tickets || []).forEach((t) => {
    if (t.bd_director_id) directors.set(t.bd_director_id, { first: t.director_first_name, last: t.director_last_name });
  });
  const sorted = [...directors].sort(([, a], [, b]) => `${a.last} ${a.first}`.localeCompare(`${b.last} ${b.first}`, undefined, { sensitivity: 'base' }));
  // Keep a chosen director listed even if the current tickets no longer include them.
  const missing = value && value !== 'none' && !directors.has(Number(value));
  return (
    <select className={`input py-0 text-sm ${className}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="BD director">
      <option value="">All BD directors</option>
      {sorted.map(([id, d]) => <option key={id} value={id}>{d.first} {d.last}</option>)}
      {missing && <option value={value}>Selected director</option>}
      <option value="none">No BD director</option>
    </select>
  );
}
