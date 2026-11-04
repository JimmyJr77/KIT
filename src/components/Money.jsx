/** A labeled dollar amount input. */
export default function Money({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <span className="absolute top-2 left-3 text-sm text-slate-400">$</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" className="input pl-6" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
