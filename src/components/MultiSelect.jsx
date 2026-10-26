import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useClickAway } from './UserCombobox.jsx';

/**
 * Multi-select with a type-to-filter text box and removable chips.
 * options: [{ value, label, sub? }]
 */
export default function MultiSelect({ options = [], value = [], onChange, placeholder = 'Type to filter…' }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));

  const selected = options.filter((o) => value.includes(o.value));
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return options.filter((o) => !value.includes(o.value) && (!s || `${o.label} ${o.sub || ''}`.toLowerCase().includes(s)));
  }, [options, value, q]);

  const add = (v) => { onChange([...value, v]); setQ(''); };
  const remove = (v) => onChange(value.filter((x) => x !== v));

  return (
    <div className="relative" ref={ref}>
      <div className="input flex min-h-[38px] flex-wrap items-center gap-1.5 py-1.5" onClick={() => setOpen(true)}>
        {selected.map((o) => (
          <span key={o.value} className="chip">
            {o.label}
            <button type="button" onClick={(e) => { e.stopPropagation(); remove(o.value); }} className="hover:text-brand-900"><X size={12} /></button>
          </span>
        ))}
        <input
          className="min-w-24 flex-1 border-0 p-0 text-sm outline-none focus:ring-0"
          placeholder={selected.length ? '' : placeholder}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches[0]) { e.preventDefault(); add(matches[0].value); }
            if (e.key === 'Backspace' && !q && value.length) remove(value[value.length - 1]);
          }}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {matches.map((o) => (
            <li key={o.value}>
              <button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50" onClick={() => add(o.value)}>
                {o.label}{o.sub && <span className="ml-2 text-xs text-slate-400">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
