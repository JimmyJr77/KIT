import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, ArrowUp, Plus, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * A ticket's next step, in a small popup opened from its circle on the pipeline board: the step with its subtasks and due
 * date, to edit, tick off or swap for another open task, and a line each to add a subtask to it and a new task. Nothing else of the ticket is here;
 * "Open ticket" goes to the full Activity pane. `onChanged` runs after each save so the board's circle keeps up.
 */
export default function NextStepQuick({ ticket, onClose, onChanged, onOpenTicket }) {
  const [open, setOpen] = useState(null); // the ticket's open tasks in order; the first is the next step
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [subject, setSubject] = useState('');
  const [added, setAdded] = useState({ subject: '', due_date: '' });
  const [subtask, setSubtask] = useState('');
  const step = open?.[0] || null;
  // The next step's box grows with its text, so all of it shows however long it is.
  const box = useRef(null);
  useLayoutEffect(() => {
    if (!box.current) return;
    box.current.style.height = 'auto';
    box.current.style.height = `${box.current.scrollHeight + 2}px`;
  }, [subject, step?.id]);

  const load = () => api.get(`/activities?ticket=${ticket.id}`).then((d) => {
    const list = d.activities.filter((a) => !a.done);
    setOpen(list);
    setSubject(list[0]?.subject || '');
  });
  useEffect(() => { load().catch((e) => setError(e.message)); }, [ticket.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (call) => {
    setBusy(true);
    setError('');
    try { await call(); await load(); onChanged?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const rename = () => {
    const text = subject.trim();
    if (!text) return setSubject(step.subject);
    if (text !== step.subject) run(() => api.put(`/activities/${step.id}`, { subject: text }));
  };
  const add = (e) => {
    e.preventDefault();
    if (!added.subject.trim() || busy) return;
    run(async () => {
      await api.post('/activities', { subject: added.subject, due_date: added.due_date || null, ticket_id: ticket.id });
      setAdded({ subject: '', due_date: '' });
    });
  };
  const addSubtask = (e) => {
    e.preventDefault();
    if (!subtask.trim() || busy) return;
    run(async () => { await api.post(`/activities/${step.id}/subtasks`, { text: subtask }); setSubtask(''); });
  };
  const makeNext = (a) => run(() => api.put('/activities/order', { ticket_id: ticket.id, ids: [a.id, ...open.filter((x) => x.id !== a.id).map((x) => x.id)] }));

  const date = 'rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 focus:border-brand-500 focus:outline-none';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={`Next step on ${ticket.opportunity_title}`} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Next step</div>
            <div className="truncate text-xs text-slate-500" title={ticket.opportunity_title}>{ticket.opportunity_title}</div>
          </div>
          <button type="button" onClick={onOpenTicket} title="Open the ticket" aria-label="Open the ticket" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><ExternalLink size={15} /></button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={15} /></button>
        </div>

        {open === null && !error && <p className="mt-3 text-sm text-slate-400">Loading…</p>}
        {open && !step && <p className="mt-3 text-sm text-slate-500">No next step yet. Add one below.</p>}
        {step && (
          <div className="mt-3">
            <div className="flex items-start gap-2">
              <input type="checkbox" className="mt-1.5 h-4 w-4 shrink-0" checked={false} disabled={busy} title="Mark complete"
                onChange={() => run(() => api.put(`/activities/${step.id}`, { done: true }))} aria-label={`Mark “${step.subject}” complete`} />
              <textarea ref={box} rows={1} className="min-w-0 flex-1 resize-none overflow-hidden rounded-md border border-transparent px-1.5 py-1 text-sm leading-snug font-semibold break-words text-slate-900 hover:border-slate-300 focus:border-brand-500 focus:outline-none"
                value={subject} onChange={(e) => setSubject(e.target.value.replace(/\n/g, ' '))} onBlur={rename} aria-label="Next step"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />
            </div>
            <label className="mt-1 flex items-center gap-2 pl-6 text-xs text-slate-500">Due
              <input type="date" className={date} value={step.due_date || ''} disabled={busy} aria-label="Due date"
                onChange={(e) => run(() => api.put(`/activities/${step.id}`, { due_date: e.target.value || null }))} />
            </label>
            {step.subtasks.length > 0 && (
              <ul className="mt-2 space-y-1 pl-6">
                {step.subtasks.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0" checked={!!s.done} disabled={busy}
                      onChange={() => run(() => api.put(`/activities/subtasks/${s.id}`, { done: !s.done }))} aria-label={`Mark “${s.text}” ${s.done ? 'not done' : 'done'}`} />
                    <span className={`min-w-0 break-words ${s.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{s.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addSubtask} className="mt-1.5 flex items-center gap-2 pl-6">
              <input className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-0.5 text-xs focus:border-brand-500 focus:outline-none" placeholder="Add a subtask"
                value={subtask} onChange={(e) => setSubtask(e.target.value)} aria-label="New subtask" />
              <button type="submit" disabled={busy || !subtask.trim()} aria-label="Add the subtask" title="Add the subtask"
                className="rounded-md p-1 text-brand-700 hover:bg-brand-50 disabled:opacity-40"><Plus size={13} /></button>
            </form>
          </div>
        )}

        {open?.length > 1 && (
          <ul className="mt-3 space-y-0.5 border-t border-slate-100 pt-2">
            {open.slice(1).map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-xs text-slate-600">
                <span className="min-w-0 flex-1 break-words">{a.subject}</span>
                {a.due_date && <span className="shrink-0 text-slate-400">{a.due_date.slice(5).replace('-', '/')}</span>}
                <button type="button" disabled={busy} onClick={() => makeNext(a)} title="Make this the next step" aria-label={`Make “${a.subject}” the next step`}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-brand-700"><ArrowUp size={13} /></button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <form onSubmit={add} className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
            <input className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none" placeholder="Add a task"
              value={added.subject} onChange={(e) => setAdded({ ...added, subject: e.target.value })} aria-label="New task" />
            <input type="date" className={date} value={added.due_date} onChange={(e) => setAdded({ ...added, due_date: e.target.value })} aria-label="New task’s due date" />
            <button type="submit" disabled={busy || !added.subject.trim()} aria-label="Add the task" title="Add the task"
              className="rounded-md bg-brand-600 p-1.5 text-white hover:bg-brand-700 disabled:opacity-40"><Plus size={14} /></button>
          </form>
        )}
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
