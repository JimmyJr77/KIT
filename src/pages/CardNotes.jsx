import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal, Pencil, Copy, Trash2, Check, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, stamp, fullStamp } from '../lib/format.js';
import MentionTextarea, { MentionText } from '../components/MentionTextarea.jsx';
const isMac = typeof navigator !== 'undefined' && /Mac|iP(hone|ad)/.test(navigator.platform);
const SAVE_KEY = isMac ? '⌘↵' : 'Ctrl+↵';

/** Grows a textarea to fit its content. */
function useAutoGrow(ref, value) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
  }, [ref, value]);
}

/**
 * Notes on a priority card. Each note is its own entry with its own save; the newest is on top.
 * Before the card exists (cardId null), notes are held locally and passed back through onPendingChange.
 */
export default function CardNotes({ cardId, initial = [], user, readOnly, onDirtyChange, onPendingChange, onChanged }) {
  const local = !cardId;
  const [notes, setNotes] = useState(initial);
  const [dirty, setDirty] = useState({}); // { composer: true, [noteId]: true }

  useEffect(() => { onDirtyChange?.(Object.values(dirty).some(Boolean)); }, [dirty, onDirtyChange]);
  useEffect(() => { if (local) onPendingChange?.(notes.map((n) => n.body)); }, [local, notes, onPendingChange]);

  const markDirty = (key, v) => setDirty((d) => (!!d[key] === v ? d : { ...d, [key]: v }));
  const changed = (next) => { setNotes(next); if (!local) onChanged?.(); };

  const create = async (body) => {
    if (local) return setNotes((ns) => [{ id: -Date.now(), body, author_id: user.id, author: user, pending: true }, ...ns]);
    const { note } = await api.post(`/priorities/cards/${cardId}/notes`, { body });
    changed([{ ...note, justSaved: true }, ...notes]);
  };
  const update = async (id, body) => {
    if (local) return setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, body } : n)));
    const { note } = await api.put(`/priorities/notes/${id}`, { body });
    changed(notes.map((n) => (n.id === id ? { ...note, justSaved: true } : n)));
  };
  const remove = async (id) => {
    if (!local) await api.del(`/priorities/notes/${id}`);
    changed(notes.filter((n) => n.id !== id));
  };

  return (
    <div className="space-y-3">
      {!readOnly && <Composer local={local} onSave={create} onDirty={(v) => markDirty('composer', v)} />}
      {notes.length > 0 ? (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteItem key={n.id} note={n} readOnly={readOnly}
              canChange={n.pending || n.author_id === user.id || user.role === 'admin'}
              onSave={(body) => update(n.id, body)} onDelete={() => remove(n.id)} onDirty={(v) => markDirty(n.id, v)} />
          ))}
        </ul>
      ) : (
        readOnly && <p className="text-sm text-slate-400">No notes.</p>
      )}
    </div>
  );
}

function Composer({ local, onSave, onDirty }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useAutoGrow(ref, text);
  const blank = !text.trim();
  useEffect(() => { onDirty(!blank); }, [blank]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (blank || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(text.trim());
      setText('');
    } catch (e) {
      setError(`${e.message}. Your note is still here.`);
    } finally {
      setSaving(false);
      ref.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape' && !blank) {
      e.stopPropagation(); // keep the panel open
      if (text.trim().length < 40 || confirm('Discard this note?')) setText('');
    }
  };

  return (
    <div className={`rounded-lg border bg-white transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100 ${error ? 'border-red-300' : 'border-slate-300'}`}>
      <MentionTextarea inputRef={ref} rows={2} className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-0 focus:outline-none"
        placeholder="Add a note… (@ to mention someone)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} disabled={saving} />
      {(!blank || error) && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
          <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>
            {error || (local ? 'Saves with the priority' : `${SAVE_KEY} to save · Esc to discard`)}
          </span>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { setText(''); setError(''); }} disabled={saving}>Discard</button>
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={save} disabled={blank || saving}>
              {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : local ? 'Add note' : 'Save note'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteItem({ note, readOnly, canChange, onSave, onDelete, onDirty }) {
  const [mode, setMode] = useState('view'); // 'view' | 'edit' | 'confirm-delete'
  const [draft, setDraft] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [flash, setFlash] = useState(note.justSaved ? 'Saved' : '');
  const ref = useRef(null);
  const menuRef = useRef(null);
  useAutoGrow(ref, mode === 'edit' ? draft : null);

  const isDirty = mode === 'edit' && draft.trim() !== note.body;
  useEffect(() => { onDirty(isDirty); }, [isDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(''), 2200);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => !menuRef.current?.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const startEdit = () => {
    setMenu(false);
    setDraft(note.body);
    setError('');
    setMode('edit');
  };
  // Focus the editor with the cursor at the end as soon as it opens.
  useLayoutEffect(() => {
    const el = ref.current;
    if (mode === 'edit' && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [mode]);
  const cancelEdit = () => {
    if (isDirty && !confirm('Discard your changes to this note?')) return;
    setMode('view');
    setError('');
  };
  const save = async () => {
    if (!draft.trim() || busy) return;
    if (!isDirty) return setMode('view');
    setBusy(true);
    setError('');
    try {
      await onSave(draft.trim());
      setMode('view');
      setFlash('Changes saved');
    } catch (e) {
      setError(`${e.message}. Your edits are still here.`);
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    setBusy(true);
    try {
      await onDelete();
    } catch (e) {
      setError(e.message);
      setBusy(false);
      setMode('view');
    }
  };
  const copy = async () => {
    setMenu(false);
    try { await navigator.clipboard.writeText(note.body); setFlash('Copied'); } catch { setFlash('Copy failed'); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
    if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
  };

  const edited = note.updated_at && note.updated_at !== note.created_at;

  return (
    <li className={`group relative rounded-lg border px-3 py-2.5 transition ${
      mode === 'edit' ? 'border-brand-500 bg-white ring-2 ring-brand-100'
        : mode === 'confirm-delete' ? 'border-red-200 bg-red-50/60'
          : note.pending ? 'border-dashed border-slate-300 bg-white' : 'border-slate-200 bg-slate-50/70'
    }`}>
      {mode === 'edit' ? (
        <>
          <MentionTextarea inputRef={ref} className="block w-full resize-none border-0 bg-transparent p-0 text-sm focus:ring-0 focus:outline-none"
            value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} disabled={busy} />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <span className={`flex items-center gap-1.5 text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>
              {error || (isDirty
                ? <><span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes · {SAVE_KEY} to save</>
                : 'No changes yet · Esc to cancel')}
            </span>
            <div className="flex shrink-0 gap-1.5">
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={cancelEdit} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={save} disabled={!isDirty || !draft.trim() || busy}
                title={!draft.trim() ? 'A note can’t be empty — delete it instead' : undefined}>
                {busy ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : 'Save changes'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="pr-7 text-sm break-words whitespace-pre-wrap text-slate-800"><MentionText text={note.body} /></p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
            {note.pending ? (
              <span className="italic">Not saved yet · saves with the priority</span>
            ) : (
              <>
                <span title={fullStamp(note.created_at)}>Saved {stamp(note.created_at)}</span>
                {note.author && <span>· {fullName(note.author)}</span>}
                {edited && <span title={`Last edited ${fullStamp(note.updated_at)}`}>· Edited {stamp(note.updated_at)}</span>}
              </>
            )}
            {flash && <span className="ml-1 inline-flex items-center gap-0.5 font-medium text-emerald-600"><Check size={11} /> {flash}</span>}
          </div>
          {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}

          {mode === 'confirm-delete' && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-red-100 pt-2">
              <span className="text-xs text-red-700">{note.pending ? 'Remove this note?' : 'Delete this note? This can’t be undone.'}</span>
              <div className="flex shrink-0 gap-1.5">
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setMode('view')} disabled={busy} autoFocus>Keep</button>
                <button type="button" className="btn-danger px-2.5 py-1 text-xs" onClick={confirmDelete} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</button>
              </div>
            </div>
          )}

          {mode === 'view' && (
            <div ref={menuRef} className="absolute top-1.5 right-1.5">
              <button type="button" aria-label="Note actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}
                className={`rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700 ${menu ? 'bg-slate-200/70 text-slate-700' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'}`}>
                <MoreHorizontal size={15} />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
                  onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setMenu(false))}>
                  <MenuItem icon={Pencil} label="Edit note" onClick={startEdit} disabled={readOnly || !canChange}
                    hint={readOnly ? 'Past weeks are read only' : !canChange ? 'Only the author can edit' : null} />
                  <MenuItem icon={Copy} label="Copy text" onClick={copy} />
                  <div className="my-1 border-t border-slate-100" />
                  <MenuItem icon={Trash2} label={note.pending ? 'Remove note' : 'Delete note'} danger
                    onClick={() => { setMenu(false); setMode('confirm-delete'); }} disabled={readOnly || !canChange}
                    hint={readOnly ? 'Past weeks are read only' : !canChange ? 'Only the author can delete' : null} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

function MenuItem({ icon: Icon, label, onClick, disabled, danger, hint }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} title={hint || undefined}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
      <Icon size={14} /> {label}
    </button>
  );
}
