import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, X } from 'lucide-react';
import { api } from '../lib/api.js';

const PROMPT = 'Tell me how i can improve this site!';
const REPLY = 'Right away, Michael!';
const BUBBLE_MS = 3000;

/**
 * KITT in the bottom-right corner of every signed-in page. Hovering asks for feedback; clicking opens a short form.
 * What's sent is kept with the page it came from (admins read it on Admin Access), and KITT answers with a word
 * bubble that goes away on its own.
 */
export default function FeedbackWidget() {
  const { pathname, search } = useLocation();
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reply, setReply] = useState(0); // a counter so a second send restarts the bubble
  const textarea = useRef(null);

  useEffect(() => { if (open) textarea.current?.focus(); }, [open]);
  useEffect(() => {
    if (!reply) return undefined;
    const t = setTimeout(() => setReply(0), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [reply]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => { setOpen((o) => !o); setError(''); };
  const submit = async (e) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) { setError('Type something first'); return; }
    setBusy(true);
    setError('');
    try {
      await api.post('/feedback', { message: text, path: `${pathname}${search}` });
      setMessage('');
      setOpen(false);
      setHover(false);
      setReply((n) => n + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showPrompt = hover && !open && !reply;
  return (
    <div className="fixed right-3 bottom-2 z-50 flex flex-col items-end print:hidden" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {showPrompt && (
        <Bubble role="tooltip" className="mb-1 cursor-pointer" onClick={toggle}>{PROMPT}</Bubble>
      )}
      {reply > 0 && (
        <Bubble key={reply} role="status" className="mb-1 animate-kitt-bubble font-semibold text-brand-700">{REPLY}</Bubble>
      )}
      {open && (
        <form onSubmit={submit} className="mb-1 w-80 max-w-[calc(100vw-1.5rem)] space-y-2 rounded-xl border border-slate-200 bg-white p-3 shadow-lg" aria-label="Site feedback">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-800">{PROMPT}</span>
            <button type="button" onClick={toggle} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X size={14} /></button>
          </div>
          <textarea ref={textarea} className="input min-h-24 resize-y" placeholder="An issue you hit, or something that would make KIT better…" value={message}
            onChange={(e) => setMessage(e.target.value)} maxLength={4000} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">Sent with the page you&apos;re on</span>
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={busy || !message.trim()}><Send size={12} /> {busy ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      )}
      <button type="button" onClick={toggle} aria-label="Send site feedback" aria-expanded={open} title={open ? undefined : PROMPT}
        className="group cursor-pointer rounded-lg transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <img src="/kitt.webp" alt="" className="w-28 drop-shadow-md transition group-hover:drop-shadow-lg" draggable={false} />
      </button>
    </div>
  );
}

/** A word bubble over the car, with its tail pointing down at the hood. */
function Bubble({ children, className = '', ...rest }) {
  return (
    <div {...rest} className={`relative mr-6 max-w-64 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-md ${className}`}>
      {children}
      <span aria-hidden className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 border-r border-b border-slate-200 bg-white" />
    </div>
  );
}
