import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, Send, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Markdown } from './LessonAssistant.jsx';

const SUGGESTIONS = [
  'Summarize the team battle rhythm.',
  'What is expected of a new team member in their first 30 days?',
  'Which approvals are required before something goes to a customer?',
  'Which tools does the team use, and what are the rules for each?',
];

/** The conversation kept in this tab, per team. A question left without an answer (the page was left mid-ask) is dropped. */
const load = (key) => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved?.messages?.at(-1)?.role === 'user') saved.messages = saved.messages.slice(0, -1);
    return saved?.messages || [];
  } catch { return []; }
};

/**
 * Ask KIT about the playbook, docked beside it so the page stays in view. The server answers from the team's sections
 * (never from memory); the conversation stays in this browser tab, per team, for follow-ups.
 */
export default function PlaybookAssistant({ teamId, teamName, sectionCount, gemini, onClose }) {
  const key = `kit-playbook-chat-${teamId}`;
  const [messages, setMessages] = useState(() => load(key));
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { setMessages(load(key)); setError(''); }, [key]);
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify({ messages })); } catch { /* storage off */ } }, [key, messages]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setQuestion('');
    const history = messages.map(({ role, text: t }) => ({ role, text: t }));
    setMessages((m) => [...m, { role: 'user', text, at: Date.now() }]);
    try {
      const d = await api.post(`/playbook/${teamId}/ask`, { question: text, history });
      setMessages((m) => [...m, { role: 'kit', text: d.text, scope: d.scope, at: Date.now() }]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => m.slice(0, -1));
      setQuestion(text);
    } finally { setBusy(false); inputRef.current?.focus(); }
  };
  const clear = () => { setMessages([]); setError(''); };
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } };
  const scope = useMemo(() => `${teamName} playbook · ${sectionCount} section${sectionCount === 1 ? '' : 's'}`, [teamName, sectionCount]);

  return (
    <aside className="flex h-full flex-col bg-white" aria-label="Ask KIT about the playbook">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <Sparkles size={16} className="text-brand-600" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-800">Ask KIT about this playbook</h2>
          <div className="truncate text-[11px] text-slate-500">{scope}</div>
        </div>
        {messages.length > 0 && <button type="button" className="btn-ghost p-1.5 text-slate-500" title="Clear the conversation" onClick={clear}><Trash2 size={14} /></button>}
        <button type="button" className="btn-ghost p-1.5" title="Close" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3" role="log">
        {!gemini && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">KIT’s assistant isn’t set up on this server: Gemini needs a GEMINI_API_KEY.</p>}
        {!messages.length && gemini && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">KIT answers from the sections on this page, naming the ones it draws on. Try one of these, or ask your own question.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-left text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700" disabled={busy} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[92%] rounded-xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-brand-600 text-sm text-white' : 'border border-slate-200 bg-white shadow-sm'}`}>
              {m.role === 'user' ? <div className="whitespace-pre-wrap">{m.text}</div> : <Markdown text={m.text} />}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-slate-400">KIT is reading the playbook…</div>}
        <div ref={endRef} />
      </div>

      <form className="space-y-2 border-t border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <textarea ref={inputRef} className="input" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={onKey}
          placeholder={gemini ? 'Ask anything about this playbook…' : 'Gemini is not configured'} disabled={busy || !gemini} aria-label="Your question" />
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={busy || !gemini || !question.trim()}><Send size={14} /> {busy ? 'Asking…' : 'Ask'}</button>
        </div>
      </form>
    </aside>
  );
}
