import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import LessonRange, { inRange, rangeLabel, quickRanges } from './LessonRange.jsx';

const STORE = 'kit-lessons-chat';
const SUGGESTIONS = [
  'Summarize the pricing lessons and what the team decided to do about them.',
  'Which problems keep coming back, and did the earlier fixes stick?',
  'What remediation steps has the team recorded for color team reviews, and what would you add?',
  'What is new in the most recent lessons compared with earlier ones?',
];

/** Enough markdown for KIT's answers: headings, bullets, numbered lists, bold and paragraphs. */
export function Markdown({ text }) {
  const blocks = useMemo(() => {
    const out = [];
    let open = null; // the list or paragraph being added to
    const close = () => { open = null; };
    String(text || '').split('\n').forEach((raw) => {
      const line = raw.trim();
      const bullet = line.match(/^[-*•]\s+(.*)/);
      const numbered = line.match(/^\d+[.)]\s+(.*)/);
      const heading = line.match(/^#{1,6}\s+(.*)/);
      if (!line || /^[-*_]{3,}$/.test(line)) close(); // a blank line or a rule ends what's open
      else if (heading) { close(); out.push({ kind: 'h', text: heading[1] }); }
      else if (bullet || numbered) {
        const kind = bullet ? 'ul' : 'ol';
        if (open?.kind !== kind) { open = { kind, items: [] }; out.push(open); }
        open.items.push(bullet ? bullet[1] : numbered[1]);
      } else if (open?.kind === 'ul' || open?.kind === 'ol') open.items[open.items.length - 1] += ` ${line}`;
      else if (open?.kind === 'p') open.text += ` ${line}`;
      else { open = { kind: 'p', text: line }; out.push(open); }
    });
    return out;
  }, [text]);
  const inline = (s) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => (
    part.startsWith('**') ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      : part.startsWith('`') ? <code key={i} className="rounded bg-slate-100 px-1 text-xs">{part.slice(1, -1)}</code> : part
  ));
  return (
    <div className="space-y-2 text-sm text-slate-700">
      {blocks.map((b, i) => b.kind === 'h' ? <div key={i} className="pt-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{inline(b.text)}</div>
        : b.kind === 'p' ? <p key={i}>{inline(b.text)}</p>
          : b.kind === 'ul' ? <ul key={i} className="list-disc space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
            : <ol key={i} className="list-decimal space-y-1 pl-5">{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>)}
    </div>
  );
}

/** The conversation kept in this tab. A question left without an answer (the page was left mid-ask) is dropped. */
const load = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE));
    if (saved?.messages?.at(-1)?.role === 'user') saved.messages = saved.messages.slice(0, -1);
    return saved || null;
  } catch { return null; }
};

/**
 * Ask KIT about the lessons. The server answers from the lesson records in the date range (by retro date, or the date
 * logged when there is none), never from memory; the conversation stays in this browser tab for follow-up questions.
 * `lessons` is the page's list, for the scope count shown before asking.
 */
export default function LessonAssistant({ lessons, gemini }) {
  const saved = useMemo(load, []);
  const [range, setRange] = useState(saved?.range || quickRanges()[2][1]);
  const [messages, setMessages] = useState(saved?.messages || []);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(true);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { try { sessionStorage.setItem(STORE, JSON.stringify({ range, messages })); } catch { /* storage off */ } }, [range, messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);

  const scoped = useMemo(() => inRange(lessons || [], range), [lessons, range]);
  const scopeText = `Searching ${scoped.length} lesson${scoped.length === 1 ? '' : 's'} ${rangeLabel(range)}`;

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setQuestion('');
    const history = messages.map(({ role, text: t }) => ({ role, text: t }));
    setMessages((m) => [...m, { role: 'user', text, at: Date.now() }]);
    try {
      const d = await api.post('/lessons/ask', { question: text, from: range.from || null, to: range.to || null, history });
      setMessages((m) => [...m, { role: 'kit', text: d.text, scope: d.scope, at: Date.now() }]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => m.slice(0, -1));
      setQuestion(text);
    } finally { setBusy(false); inputRef.current?.focus(); }
  };
  const clear = () => { setMessages([]); setError(''); };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };

  return (
    <div className="panel space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="section-title mr-auto flex items-center gap-2"><Sparkles size={16} className="text-brand-600" /> Ask KIT about the lessons</h2>
        {messages.length > 0 && (
          <>
            <button type="button" className="btn-ghost text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {open ? 'Hide' : 'Show'} conversation ({messages.length})
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={clear}><Trash2 size={14} /> Clear</button>
          </>
        )}
      </div>
      <p className="text-xs text-slate-500">
        KIT answers from the lesson records in the range below: their titles, problems, the solutions the team recorded, tags, dates and who logged them.
        It keeps the team’s recorded solutions apart from its own suggestions. Lessons count on their retro date, or the day they were logged when they have none.
      </p>
      <LessonRange value={range} onChange={setRange} disabled={busy} />
      <div className="text-xs font-medium text-brand-700" aria-live="polite">{scopeText}</div>

      {!gemini && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">KIT’s assistant isn’t set up on this server: Gemini needs a GEMINI_API_KEY.</p>}

      {open && messages.length > 0 && (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3" role="log" aria-label="Conversation with KIT">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-brand-600 text-sm text-white' : 'border border-slate-200 bg-white shadow-sm'}`}>
                {m.role === 'user' ? <div className="whitespace-pre-wrap">{m.text}</div> : <Markdown text={m.text} />}
                {m.role === 'kit' && m.scope && (
                  <div className="mt-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-400">
                    From {m.scope.lessons} lesson{m.scope.lessons === 1 ? '' : 's'} {rangeLabel({ from: m.scope.from || '', to: m.scope.to || '' })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs text-slate-400">KIT is reading {scoped.length} lesson{scoped.length === 1 ? '' : 's'}…</div>}
          <div ref={endRef} />
        </div>
      )}

      {!messages.length && gemini && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700" disabled={busy} onClick={() => ask(s)}>{s}</button>
          ))}
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea ref={inputRef} className="input flex-1" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKey}
          placeholder={gemini ? 'Ask about a topic, a tag, what the team did about a problem, or how a problem set has changed…' : 'Gemini is not configured'}
          disabled={busy || !gemini} aria-label="Your question" />
        <button type="submit" className="btn-primary" disabled={busy || !gemini || !question.trim()}><Send size={14} /> {busy ? 'Asking…' : 'Ask'}</button>
      </form>
    </div>
  );
}
