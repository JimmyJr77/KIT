import { useEffect, useRef, useState } from 'react';
import MentionTextarea from './MentionTextarea.jsx';

/** Where a note is written in the table: ⌘/Ctrl+Enter or Save sends it, Escape (or Cancel) drops it. */
export default function NoteBox({ initial = '', onSave, onCancel, label }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, []);
  const changed = text.trim() !== initial.trim();
  const save = async () => {
    if (!text.trim() || busy) return;
    if (!changed) return onCancel();
    setBusy(true);
    setError('');
    try { await onSave(text.trim()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const cancel = () => { if (!changed || confirm('Discard this note?')) onCancel(); };
  return (
    <div className="rounded-lg border border-brand-500 bg-white ring-2 ring-brand-100">
      <MentionTextarea inputRef={ref} rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} aria-label={label}
        placeholder="Write a note… (@ to mention)"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
        }}
        className="block w-full resize-y rounded-t-lg border-0 bg-transparent px-2.5 py-1.5 text-sm focus:ring-0 focus:outline-none" />
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-2 py-1">
        {error && <span className="mr-auto text-xs text-red-700">{error}</span>}
        <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={cancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn-primary px-2 py-0.5 text-xs" onClick={save} disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
