import { useRef, useState } from 'react';
import { FileText, Link2, Loader2, Upload, X } from 'lucide-react';
import { SA_RESPONSES } from '../lib/process.js';

// The pieces of a staffing event's Solution Architect Response, shared by the event's form and the SAC list: the approve /
// deny / need more info boxes, and the links and documents attached to it. The Request (BD Notes) and the qualification
// checklist attach links and documents the same way.

/**
 * Approve, Deny, Need more info: one at most. Ticking the one that's ticked clears it. `blocked` ({ [key]: why }) greys out
 * a choice that can't be made yet and says why (it can still be unticked).
 */
export function SaChecks({ value, onChange, disabled = false, about = '', className = '', blocked = {} }) {
  return (
    <div role="group" aria-label={`Solution architect response${about ? ` on ${about}` : ''}`} className={className}>
      {SA_RESPONSES.map((o) => {
        const off = disabled || (!!blocked[o.key] && value !== o.key);
        return (
          <label key={o.key} title={off && !disabled ? blocked[o.key] : undefined}
            className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${off ? 'cursor-not-allowed' : 'cursor-pointer'} ${value === o.key ? `font-semibold ${o.tone}` : off && !disabled ? 'text-slate-400' : 'text-slate-600'}`}>
            <input type="checkbox" checked={value === o.key} disabled={off} onChange={() => onChange(value === o.key ? '' : o.key)} />
            {o.label}
          </label>
        );
      })}
    </div>
  );
}

/** Why an Initial Gate Review's Technical Fit can't be approved yet: no solution architect is named on it. */
export const NEEDS_ARCHITECT = 'Pick the solution architect who approved it first';

/**
 * Under an approved Technical Fit: who ticked Approve (`by`) and the solution architects named on the review, whose approval
 * it is. An architect who ticks it themselves is just "Approved by".
 */
export function SaApprovedNote({ by, architects, className = '' }) {
  if (!by) return null;
  const name = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ');
  const others = architects.filter((u) => u.id !== by.id).map(name);
  const list = others.length > 1 ? `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}` : others[0];
  return <p className={`text-[11px] text-emerald-800 ${className}`}>Approved by <span className="font-semibold">{name(by)}</span>{list && <> on behalf of <span className="font-semibold">{list}</span></>}</p>;
}

/** The response's links and documents. A link opens where it lives; a document downloads. `canRemove(file)` shows its remove button. */
export function SaFiles({ files, canRemove = () => false, onRemove, className = '' }) {
  if (!files.length) return null;
  return (
    <ul className={`space-y-1 ${className}`}>
      {files.map((f) => (
        <li key={f.id} className="flex items-center gap-1">
          <a href={`/api/tickets/files/${f.id}`} target={f.url ? '_blank' : undefined} rel="noreferrer" title={f.url || f.name}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 hover:border-brand-500">
            {f.url ? <Link2 size={12} className="shrink-0 text-brand-600" /> : <FileText size={12} className="shrink-0 text-emerald-600" />}
            <span className="truncate">{f.name}</span>
          </a>
          {canRemove(f) && (
            <button type="button" aria-label={`Remove ${f.name}`} title={f.url ? 'Remove this link' : 'Remove this document'}
              onClick={() => confirm(`Remove “${f.name}”? It comes off the ticket too.`) && onRemove(f)}
              className="shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-red-600"><X size={12} /></button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Adds to the response: Link opens a place to paste one (and name it); Document uploads a file. Both save straight away. */
export function SaAttach({ onLink, onUpload, className = '' }) {
  const [link, setLink] = useState(null); // null: closed, else { url, name }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const file = useRef(null);
  const go = async (what, call) => {
    setBusy(what);
    setError('');
    try { await call(); setLink(null); } catch (e) { setError(e.message); } finally { setBusy(''); if (file.current) file.current.value = ''; }
  };
  const addLink = () => link.url.trim() && go('link', () => onLink(link.url.trim(), link.name.trim()));
  const keys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addLink(); }
    if (e.key === 'Escape') { e.stopPropagation(); setLink(null); }
  };
  return (
    <div className={className}>
      {link ? (
        <div className="space-y-1 rounded-lg border border-brand-500 bg-white p-1.5 ring-2 ring-brand-100">
          <input autoFocus type="url" className="input h-7 px-2 py-0 text-xs" placeholder="https://… link to the document" aria-label="Link to a document"
            value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} onKeyDown={keys} disabled={!!busy} />
          <input type="text" className="input h-7 px-2 py-0 text-xs" placeholder="What to call it (optional)" aria-label="Name for the link"
            value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} onKeyDown={keys} disabled={!!busy} />
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={() => setLink(null)} disabled={!!busy}>Cancel</button>
            <button type="button" className="btn-primary px-2 py-0.5 text-xs" onClick={addLink} disabled={!!busy || !link.url.trim()}>{busy ? 'Adding…' : 'Add link'}</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-xs">
          <button type="button" onClick={() => { setError(''); setLink({ url: '', name: '' }); }} className="flex items-center gap-1 font-medium text-brand-700 hover:underline"><Link2 size={12} /> Link</button>
          <label className={`flex cursor-pointer items-center gap-1 font-medium text-brand-700 hover:underline ${busy ? 'pointer-events-none opacity-60' : ''}`}>
            {busy === 'file' ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : <><Upload size={12} /> Document</>}
            <input ref={file} type="file" className="sr-only" onChange={(e) => e.target.files[0] && go('file', () => onUpload(e.target.files[0]))} />
          </label>
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-700">{error}</p>}
    </div>
  );
}
