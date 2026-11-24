import { useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { GripVertical, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useLabels, setCatalog, LabelChip, TAG_CATEGORIES, LABEL_COLORS, LABEL_COLOR_NAMES } from './Labels.jsx';

const tickets = (n) => `${n} ticket${n === 1 ? '' : 's'}`;
// Why a tag's name and color are fixed and it can't be deleted, if they are. Any tag can still change category.
const lockReason = (l) => (l.kind ? 'One of KIT’s permanent tags: KIT puts it on tickets itself, so it can’t be renamed or deleted. You can still move it.' : '');

/**
 * The tag list, for admins (BD Pipeline › Settings › Tags › Manage tags): add a tag to a category, rename, recolor or
 * delete one, and drag any tag to another category. Each change is saved as it's made, for everyone. A Pipedrive label
 * renamed or deleted here is renamed or deleted in Pipedrive with the next send; its color is Pipedrive's to set.
 * `onChanged` runs after a change that tickets show (a rename or a delete), so the board follows.
 */
export default function TagManager({ onChanged }) {
  const labels = useLabels();
  const [form, setForm] = useState(null); // { mode: 'add', category } or { mode: 'edit', id, pipedrive }, with name and color
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const dragging = labels.find((l) => l.id === dragId);

  const run = async (fn, touchesTickets) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const d = await fn();
      setCatalog(d.labels);
      if (touchesTickets) onChanged?.();
      return true;
    } catch (e) { setError(e.message); return false; } finally { setBusy(false); }
  };
  const save = async () => {
    const name = form.name.trim();
    if (!name) return;
    const done = form.mode === 'add'
      ? await run(() => api.post('/labels', { name, color: form.color, category: form.category }))
      : await run(() => api.put(`/labels/${form.id}`, form.pipedrive ? { name } : { name, color: form.color }), true);
    if (done) setForm(null);
  };
  const remove = (l) => {
    const on = l.ticket_count ? ` It comes off ${tickets(l.ticket_count)}.` : '';
    const there = l.pipedrive_id ? ' It’s a Pipedrive label: with the next send it’s deleted in Pipedrive too, off every deal there.' : '';
    if (confirm(`Delete the “${l.name}” tag?${on}${there} This can’t be undone.`)) run(() => api.del(`/labels/${l.id}`), true);
  };
  const move = (l, category) => {
    if (!l || !category || l.category === category) return;
    // Shown in its new category right away; the server's list then replaces it, or it goes back on an error.
    const before = labels;
    setCatalog(labels.map((x) => (x.id === l.id ? { ...x, category } : x)));
    run(() => api.put(`/labels/${l.id}`, { category })).then((ok) => { if (!ok) setCatalog(before); });
  };

  const formRow = () => (
    <li className="space-y-2 bg-brand-50/50 px-3 py-3">
      <input className="input h-9 text-sm" placeholder="Name the tag…" aria-label="Tag name" value={form.name} autoFocus onFocus={(e) => e.target.select()} maxLength={40}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); setForm(null); } }} />
      {form.pipedrive ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          {form.name.trim() && <LabelChip name={form.name.trim()} color={form.color} />}
          The new name goes to Pipedrive with the next send. Its color is set in Pipedrive.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Tag color">
          {LABEL_COLOR_NAMES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={form.color === c} aria-label={c} onClick={() => setForm({ ...form, color: c })}
              className={`h-5 w-5 rounded-full ring-offset-1 ${form.color === c ? 'ring-2 ring-slate-500' : ''}`} style={{ background: LABEL_COLORS[c] }} />
          ))}
          {form.name.trim() && <span className="ml-auto"><LabelChip name={form.name.trim()} color={form.color} /></span>}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost h-8 py-0 text-sm" onClick={() => setForm(null)}>Cancel</button>
        <button type="button" className="btn-primary h-8 py-0 text-sm" onClick={save} disabled={busy || !form.name.trim()}>{form.mode === 'add' ? 'Add tag' : 'Save'}</button>
      </div>
    </li>
  );

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-slate-50 p-3 text-xs leading-snug text-slate-600">
        The tag list, for everyone. Drag a tag by its handle to move it to another category. Renaming a tag renames it on every
        ticket that carries it; deleting one takes it off them. A Pipedrive label renamed or deleted here is renamed or deleted
        in Pipedrive with the next send. KIT’s own permanent tags keep their names, but can change category.
      </p>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragStart={(e) => { setDragId(e.active.id); setForm(null); }}
        onDragCancel={() => setDragId(null)}
        onDragEnd={(e) => { setDragId(null); move(labels.find((l) => l.id === e.active.id), e.over?.id); }}>
        {TAG_CATEGORIES.map(([key, name]) => {
          const mine = labels.filter((l) => (l.category || 'other') === key);
          return (
            <Category key={key} id={key} name={name} count={mine.length} from={dragging?.category}>
              {mine.map((l) => (form?.mode === 'edit' && form.id === l.id ? <FormSlot key={l.id}>{formRow()}</FormSlot> : (
                <TagRow key={l.id} label={l} busy={busy} onEdit={() => setForm({ mode: 'edit', id: l.id, name: l.name, color: l.color, pipedrive: !!l.pipedrive_id })} onDelete={() => remove(l)} />
              )))}
              {!mine.length && !(form?.mode === 'add' && form.category === key) && <li className="px-3 py-2 text-xs text-slate-400">No tags here. Drag one in, or add one.</li>}
              {form?.mode === 'add' && form.category === key ? formRow() : (
                <li>
                  <button type="button" className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                    onClick={() => setForm({ mode: 'add', category: key, name: '', color: 'blue' })}>
                    <Plus size={14} /> Add {/^[aeiou]/i.test(name) ? 'an' : 'a'} {name} tag
                  </button>
                </li>
              )}
            </Category>
          );
        })}
        <DragOverlay>
          {dragging && (
            <div className="flex items-center gap-2 rounded-md bg-white px-3 py-1.5 shadow-lg ring-1 ring-slate-300">
              <GripVertical size={14} className="text-slate-400" /> <LabelChip name={dragging.name} color={dragging.color} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

const FormSlot = ({ children }) => children;

/** One category: a drop target for tags dragged from another. `from` is the category of the tag being dragged, if any. */
function Category({ id, name, count, from, children }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const target = !!from && from !== id;
  return (
    <section ref={setNodeRef} aria-label={`${name} tags`}
      className={`rounded-lg border transition ${target && isOver ? 'border-brand-500 ring-2 ring-brand-200' : target ? 'border-dashed border-brand-300' : 'border-slate-200'}`}>
      <header className="flex items-center gap-2 rounded-t-lg border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="text-sm font-semibold text-slate-800">{name}</span>
        <span className="ml-auto text-xs text-slate-500">{count} tag{count === 1 ? '' : 's'}</span>
      </header>
      <ul className="divide-y divide-slate-100">{children}</ul>
    </section>
  );
}

/** A tag in its category: dragged by the handle, with rename and delete where the tag is KIT's own to change. */
function TagRow({ label: l, busy, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: l.id });
  const locked = lockReason(l);
  return (
    <li ref={setNodeRef} className={`flex items-center gap-2 px-2 py-1.5 ${isDragging ? 'opacity-40' : ''}`}>
      <button type="button" {...listeners} {...attributes} aria-label={`Move the ${l.name} tag to another category`} title="Drag to another category"
        className="cursor-grab touch-none rounded p-0.5 text-slate-300 hover:text-slate-600 active:cursor-grabbing"><GripVertical size={14} /></button>
      <span className="min-w-0"><LabelChip name={l.name} color={l.color} /></span>
      {l.pipedrive_id && (
        <span className="shrink-0 text-[10px] text-slate-400" title={l.pipedrive_name ? `Still “${l.pipedrive_name}” in Pipedrive until the next send` : 'A Pipedrive label'}>
          Pipedrive{l.pipedrive_name ? ' · rename waiting' : ''}
        </span>
      )}
      <span className="ml-auto shrink-0 text-xs text-slate-400 tabular-nums">{tickets(l.ticket_count)}</span>
      {locked ? (
        <span className="inline-flex w-[3.75rem] shrink-0 items-center justify-end gap-1 text-[10px] text-slate-400" title={locked}>
          <Lock size={11} /> KIT
        </span>
      ) : (
        <span className="flex w-[3.75rem] shrink-0 justify-end gap-0.5">
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onEdit} disabled={busy} aria-label={`Rename the ${l.name} tag`} title="Rename or recolor"><Pencil size={14} /></button>
          <button type="button" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={onDelete} disabled={busy} aria-label={`Delete the ${l.name} tag`} title="Delete"><Trash2 size={14} /></button>
        </span>
      )}
    </li>
  );
}
