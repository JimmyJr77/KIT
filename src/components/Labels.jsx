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

/** The categories tags are shown under, in order. Tags KIT doesn't know a category for are Other. */
export const TAG_CATEGORIES = [['process', 'Process'], ['source', 'Source'], ['other', 'Other']];
const categoryName = (key) => TAG_CATEGORIES.find(([k]) => k === key)?.[1] || 'Other';
/** `labels` in category order, as [{ key, name, labels }], leaving out empty categories. */
export const byCategory = (labels) => TAG_CATEGORIES.map(([key, name]) => ({ key, name, labels: labels.filter((l) => (l.category || 'other') === key) })).filter((g) => g.labels.length);

// Tags each person has chosen not to show on pipeline cards (BD Pipeline › Settings › Tags on cards), kept in this
// browser. Hidden tags are still on the ticket: they show when it's opened, and the tag filter still finds them.
const HIDDEN_KEY = 'kit.pipeline.hiddenTags';
const readHidden = () => { try { const v = JSON.parse(localStorage.getItem(HIDDEN_KEY)); return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : []; } catch { return []; } };
let hidden = readHidden();
const hiddenListeners = new Set();
export function setHiddenCardTags(names) {
  hidden = [...new Set(names.map((n) => String(n).toLowerCase()))];
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* not kept */ }
  hiddenListeners.forEach((fn) => fn(hidden));
}
/** The tag names (lower case) hidden on pipeline cards. */
export function useHiddenCardTags() {
  const [value, setValue] = useState(hidden);
  useEffect(() => { hiddenListeners.add(setValue); setValue(hidden); return () => hiddenListeners.delete(setValue); }, []);
  return value;
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

/** A row of tags, for ticket cards. With `card` (pipeline cards), tags the viewer has turned off for cards are left out. */
export function LabelList({ labels, className = '', card = false }) {
  const off = useHiddenCardTags();
  const shown = card ? (labels || []).filter((l) => !off.includes(String(l).toLowerCase())) : labels;
  if (!shown?.length) return null;
  return <div className={`flex flex-wrap gap-1 ${className}`}>{shown.map((l) => <LabelChip key={l} name={l} />)}</div>;
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
          <ul className="mt-1.5 max-h-64 space-y-0.5 overflow-y-auto">
            {byCategory(shown).map((g) => (
              <li key={g.key}>
                <div className="px-1.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{g.name}</div>
                <ul className="space-y-0.5">
                  {g.labels.map((l) => (
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
                </ul>
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
/** A ticket's tags, which its owner can add and remove (`readOnly` just shows them). */
export function TicketLabels({ ticket, onChanged, readOnly = false }) {
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
      {labels.map((l) => <LabelChip key={l} name={l} onRemove={readOnly ? undefined : () => save(labels.filter((x) => x !== l))} />)}
      {!readOnly && <LabelPicker value={labels} onChange={save} />}
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
      <MultiSelect compact options={labels.map((l) => ({ value: l.name, label: l.name, group: categoryName(l.category), sub: l.pipedrive_id ? 'Pipedrive' : undefined }))}
        value={value} onChange={onChange} placeholder={labels.length ? 'Filter by tag…' : 'No tags yet'} />
    </div>
  );
}

/**
 * Choose which tags show on pipeline cards, by category: untick a tag, or a whole category, to keep it off the cards.
 * It's the viewer's own choice, kept in this browser and saved as it changes.
 */
export function CardTagSettings() {
  const labels = useLabels();
  const off = useHiddenCardTags();
  const isOff = (l) => off.includes(l.name.toLowerCase());
  const set = (names, show) => {
    const lower = names.map((n) => n.toLowerCase());
    setHiddenCardTags(show ? off.filter((n) => !lower.includes(n)) : [...off, ...lower]);
  };
  if (!labels.length) return <p className="text-sm text-slate-400">No tags yet.</p>;
  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-600">
        Untick a tag to keep it off the cards on the board. It stays on the ticket: you still see it when you open one, and the tag filter still finds it.
        This is your own view, kept in this browser.
      </p>
      {byCategory(labels).map((g) => {
        const on = g.labels.filter((l) => !isOff(l)).length;
        return (
          <section key={g.key} className="rounded-lg border border-slate-200">
            <label className="flex cursor-pointer items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={on === g.labels.length}
                ref={(el) => { if (el) el.indeterminate = on > 0 && on < g.labels.length; }}
                onChange={(e) => set(g.labels.map((l) => l.name), e.target.checked)} aria-label={`Show every ${g.name} tag on cards`} />
              <span className="text-sm font-semibold text-slate-800">{g.name}</span>
              <span className="ml-auto text-xs text-slate-500">{on} of {g.labels.length} shown</span>
            </label>
            <ul className="divide-y divide-slate-100">
              {g.labels.map((l) => (
                <li key={l.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={!isOff(l)} onChange={(e) => set([l.name], e.target.checked)} />
                    <LabelChip name={l.name} color={l.color} />
                    <span className="ml-auto text-xs text-slate-400 tabular-nums">{l.ticket_count} ticket{l.ticket_count === 1 ? '' : 's'}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
