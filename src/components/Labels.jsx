import { useEffect, useMemo, useRef, useState } from 'react';
import { Tag, Plus, Check, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useClickAway } from './UserCombobox.jsx';
import MultiSelect from './MultiSelect.jsx';

// Pipedrive's label colors: solid, with white text (dark text on yellow), as Pipedrive draws them.
const COLORS = {
  green: '#08a742', blue: '#317ae2', red: '#f94839', yellow: '#ffcc00', purple: '#721ea9', gray: '#8c9196',
  orange: '#f7931e', brown: '#8b5a2b', pink: '#e8579f', 'dark-gray': '#4b4f56',
};
export const LABEL_COLOR_NAMES = Object.keys(COLORS);

// The tag list, shared by every chip and picker on the page, loaded once.
let catalog = null;
let loading = null;
const listeners = new Set();
const setCatalog = (labels) => { catalog = labels; listeners.forEach((fn) => fn(labels)); };
const loadCatalog = () => (loading ||= api.get('/labels').then((d) => setCatalog(d.labels)).finally(() => { loading = null; }));

export function useLabels() {
  const [labels, setLabels] = useState(catalog);
  useEffect(() => {
    listeners.add(setLabels);
    if (!catalog) loadCatalog();
    return () => listeners.delete(setLabels);
  }, []);
  return labels || [];
}

/** One tag, drawn like a Pipedrive label. */
export function LabelChip({ name, color, onRemove }) {
  const labels = useLabels();
  const c = color || labels.find((l) => l.name.toLowerCase() === String(name).toLowerCase())?.color || 'gray';
  return (
    <span className="inline-flex h-5 max-w-full items-center gap-0.5 rounded-full px-2 text-[11px] leading-none font-semibold whitespace-nowrap"
      style={{ background: COLORS[c] || COLORS.gray, color: c === 'yellow' ? '#3a2f00' : '#fff' }}>
      <span className="truncate">{name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove the ${name} tag`} className="-mr-1 rounded-full p-0.5 opacity-80 hover:opacity-100"><X size={10} /></button>
      )}
    </span>
  );
}

/** A row of tags, for ticket cards. */
export function LabelList({ labels, className = '' }) {
  if (!labels?.length) return null;
  return <div className={`flex flex-wrap gap-1 ${className}`}>{labels.map((l) => <LabelChip key={l} name={l} />)}</div>;
}

/**
 * Pick a ticket's tags: tick any from the list, or make a new one with a color. `value` and `onChange` are tag names.
 */
export function LabelPicker({ value, onChange, disabled }) {
  const labels = useLabels();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [color, setColor] = useState('blue');
  const [error, setError] = useState('');
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef(null);
  useClickAway(ref, () => setOpen(false));
  // Open leftward when the menu wouldn't fit to the right of the button.
  const toggleOpen = () => {
    const box = ref.current?.getBoundingClientRect();
    setAlignRight(!!box && box.left + 264 > window.innerWidth);
    setOpen((o) => !o);
  };

  const has = (n) => value.some((v) => v.toLowerCase() === n.toLowerCase());
  const shown = useMemo(() => labels.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase())), [labels, q]);
  const exact = labels.some((l) => l.name.toLowerCase() === q.trim().toLowerCase());
  const toggle = (n) => onChange(has(n) ? value.filter((v) => v.toLowerCase() !== n.toLowerCase()) : [...value, n]);
  const create = async () => {
    const name = q.trim();
    if (!name) return;
    setError('');
    try {
      const d = await api.post('/labels', { name, color });
      setCatalog(d.labels);
      onChange([...value, d.label.name]);
      setQ('');
    } catch (e) { setError(e.message); }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggleOpen} disabled={disabled} aria-expanded={open}
        className="inline-flex h-5 items-center gap-0.5 rounded-full border border-dashed border-slate-300 px-2 text-[11px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700 disabled:opacity-50">
        <Tag size={10} /> {value.length ? 'Tags' : 'Add tag'}
      </button>
      {open && (
        <div className={`absolute top-full z-30 mt-1 w-64 rounded-lg bg-white p-2 text-sm shadow-lg ring-1 ring-slate-200 ${alignRight ? 'right-0' : 'left-0'}`}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}>
          <input className="input h-8 text-sm" placeholder="Find or make a tag…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1 && exact) toggle(shown[0].name); else if (!exact) create(); } }} />
          <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto">
            {shown.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => toggle(l.name)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-slate-50">
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${has(l.name) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300'}`}>
                    {has(l.name) && <Check size={11} />}
                  </span>
                  <LabelChip name={l.name} color={l.color} />
                  {l.pipedrive_id && <span className="ml-auto text-[10px] text-slate-400">Pipedrive</span>}
                </button>
              </li>
            ))}
            {!shown.length && !q.trim() && <li className="px-1.5 py-1 text-xs text-slate-400">No tags yet.</li>}
          </ul>
          {q.trim() && !exact && (
            <div className="mt-1.5 space-y-1.5 border-t border-slate-100 pt-1.5">
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Tag color">
                {LABEL_COLOR_NAMES.map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={c} onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full ring-offset-1 ${color === c ? 'ring-2 ring-slate-500' : ''}`} style={{ background: COLORS[c] }} />
                ))}
              </div>
              <button type="button" onClick={create} className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-slate-700 hover:bg-slate-50">
                <Plus size={13} /> Make <LabelChip name={q.trim()} color={color} />
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** A ticket's tags with the picker beside them, saved as they change. */
export function TicketLabels({ ticket, onChanged }) {
  const [labels, setLabels] = useState(ticket.labels || []);
  const [error, setError] = useState('');
  useEffect(() => { setLabels(ticket.labels || []); }, [ticket.id, ticket.labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (next) => {
    const prev = labels;
    setLabels(next);
    setError('');
    try {
      const d = await api.put(`/tickets/${ticket.id}/labels`, { labels: next });
      setLabels(d.labels);
      onChanged?.();
    } catch (e) {
      setLabels(prev);
      setError(e.message);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-1">
      {labels.map((l) => <LabelChip key={l} name={l} onRemove={() => save(labels.filter((x) => x !== l))} />)}
      <LabelPicker value={labels} onChange={save} />
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}

/** Whether a ticket carries any of the `selected` tags (all tickets when none are chosen). */
export const byTags = (selected) => (t) => !selected.length
  || (t.labels || []).some((l) => selected.some((s) => s.toLowerCase() === String(l).toLowerCase()));

/** Pick any number of tags to narrow a list of tickets to those carrying at least one of them. */
export function TagFilter({ value, onChange, className = '' }) {
  const labels = useLabels();
  return (
    <div className={className}>
      <MultiSelect compact options={labels.map((l) => ({ value: l.name, label: l.name, sub: l.pipedrive_id ? 'Pipedrive' : undefined }))}
        value={value} onChange={onChange} placeholder={labels.length ? 'Filter by tag…' : 'No tags yet'} />
    </div>
  );
}
