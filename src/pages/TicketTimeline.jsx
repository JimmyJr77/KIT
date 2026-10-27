import { useEffect, useRef, useState } from 'react';
import { StickyNote, FileText, Ticket, Upload, Loader2, Check, Square, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, stamp, fullStamp, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { KIND } from './LaneViews.jsx';
import { ReplyBox, KindToggle } from './CommentPanel.jsx';

const FILTERS = [
  ['all', 'Everything'],
  ['card', 'Priorities'],
  ['comment', 'Questions & comments'],
  ['note', 'Notes'],
  ['file', 'Documents'],
];
const SAVE_KEY = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵';
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Right-hand pane with everything that has happened on a master ticket, newest first. */
export default function TicketTimeline({ ticketId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const load = () => api.get(`/tickets/${ticketId}/timeline`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { load(); onChanged?.(); };

  const t = data?.ticket;
  const cards = (data?.events || []).filter((e) => e.type === 'card').map((e) => e.card);
  const events = (data?.events || []).filter((e) => filter === 'all' || e.type === filter);
  const count = (type) => (data?.events || []).filter((e) => e.type === type).length;

  return (
    <SidePanel wide onClose={onClose} title={t ? t.opportunity_title : 'Loading…'}
      subtitle={t && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>Master ticket #{t.id}</span>
          {t.organization && <span>· {t.organization}</span>}
          {t.pipeline_status && <span className="rounded bg-slate-100 px-1.5 text-slate-600">{t.pipeline_status}</span>}
          {t.value != null && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{usd(t.value).replace('.00', '')}</span>}
        </span>
      )}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="space-y-5">
          <Composer ticketId={t.id} cards={cards} onPosted={refresh} />

          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, l]) => {
              const n = k === 'all' ? data.events.length : count(k);
              return (
                <button key={k} type="button" onClick={() => setFilter(k)} disabled={k !== 'all' && !n}
                  className={`rounded-full px-2.5 py-1 text-xs transition disabled:opacity-40 ${filter === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {l} <span className="opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-slate-200">
            {events.map((e) => <Event key={`${e.type}-${e.card?.id ?? e.note?.id ?? e.comment?.id ?? e.file?.id ?? 0}`} event={e} ticketId={t.id} onChanged={refresh} />)}
          </ol>
        </div>
      )}
    </SidePanel>
  );
}

/** The icon on the timeline rail that says where an event came from. */
function Marker({ event }) {
  const box = 'relative z-10 grid h-8 w-8 shrink-0 self-start place-items-center rounded-full ring-4 ring-white';
  if (event.type === 'comment') {
    const k = KIND[event.comment.kind] || KIND.comment;
    return (
      <span className="relative z-10 h-8 shrink-0 self-start rounded-full ring-4 ring-white">
        <Avatar user={event.author} size="md" />
        <span className={`absolute -right-1 -bottom-1 grid h-4 w-4 place-items-center rounded-full text-[9px] font-bold ring-2 ring-white ${k.chip}`}>{k.glyph}</span>
      </span>
    );
  }
  if (event.type === 'card') return <span className={`${box} bg-brand-600 font-mono text-[9px] font-bold tracking-tighter text-white`} title="Priority ticket">123</span>;
  if (event.type === 'note') return <span className={`${box} bg-amber-100 text-amber-700`} title="Note"><StickyNote size={15} /></span>;
  if (event.type === 'file') return <span className={`${box} bg-emerald-100 text-emerald-700`} title="Document"><FileText size={15} /></span>;
  return <span className={`${box} bg-slate-200 text-slate-600`} title="Master ticket"><Ticket size={15} /></span>;
}

function Meta({ event, children }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-slate-500">
      <span><span className="font-semibold text-slate-800">{fullName(event.author) || 'Someone'}</span> {children}</span>
      <span className="text-[11px] text-slate-400" title={fullStamp(event.at)}>{stamp(event.at)}</span>
    </div>
  );
}

function Event({ event: e, ticketId, onChanged }) {
  return (
    <li className="flex gap-3">
      <Marker event={e} />
      <div className="min-w-0 flex-1 pt-1">
        {e.type === 'ticket' && <Meta event={e}>created this master ticket</Meta>}

        {e.type === 'card' && (
          <>
            <Meta event={e}>{e.card.is_planned ? 'added a priority' : 'added work'}{e.card.team_name && <> for {e.card.team_name}</>}</Meta>
            <div className={`mt-1.5 rounded-lg border border-l-4 bg-white p-3 text-sm ${e.card.is_planned ? 'border-slate-200 border-l-brand-600' : 'border-amber-200 border-l-amber-500'}`}>
              <div className={`font-medium ${e.card.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{e.card.title || 'Untitled priority'}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Week of {shortDate(e.card.week_start)}
                {e.card.due_date && ` · due ${shortDate(e.card.due_date)}`}
                {!e.card.is_planned && ' · work (added after planning closed)'}
                {e.card.completed && ' · complete'}
                {e.card.assignees.length > 0 && ` · ${e.card.assignees.map(fullName).join(', ')}`}
              </div>
              {e.card.checklist.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
                  {[...e.card.checklist.filter((i) => !i.done), ...e.card.checklist.filter((i) => i.done)].map((i, n) => (
                    <li key={n} className={`flex items-start gap-1.5 text-xs ${i.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                      {i.done ? <Check size={13} className="mt-px shrink-0 text-emerald-600" /> : <Square size={13} className="mt-px shrink-0 text-slate-400" />}
                      {i.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {e.type === 'note' && (
          <>
            <Meta event={e}>added a note on <span className="font-medium text-slate-700">{e.note.card_title || 'a priority'}</span></Meta>
            <p className="mt-1.5 rounded-lg bg-amber-50/70 px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">{e.note.body}</p>
            {e.note.updated_at && <p className="mt-0.5 text-[11px] text-slate-400">Edited {stamp(e.note.updated_at)}</p>}
          </>
        )}

        {e.type === 'comment' && <CommentEvent event={e} ticketId={ticketId} onChanged={onChanged} />}

        {e.type === 'file' && (
          <>
            <Meta event={e}>uploaded a document</Meta>
            <a href={`/api/tickets/files/${e.file.id}`} className="mt-1.5 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-500">
              <FileText size={16} className="shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{e.file.name}</span>
              <span className="shrink-0 text-[11px] text-slate-400">{bytes(e.file.size)}</span>
              <Download size={14} className="shrink-0 text-slate-400" />
            </a>
          </>
        )}
      </div>
    </li>
  );
}

function CommentEvent({ event: e, ticketId, onChanged }) {
  const m = e.comment;
  const [replying, setReplying] = useState(false);
  return (
    <>
      <Meta event={e}>
        {m.kind === 'question' ? 'asked a question' : 'commented'}
        {m.card_title && <> on <span className="font-medium text-slate-700">{m.card_title}</span></>}
      </Meta>
      <p className={`mt-1.5 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 ring-1 ${m.kind === 'question' ? 'bg-amber-50/60 ring-amber-200' : 'bg-white ring-slate-200'}`}>{m.body}</p>
      {m.replies.length > 0 && (
        <ul className="mt-2 space-y-2 border-l-2 border-slate-100 pl-3">
          {m.replies.map((r) => (
            <li key={r.id} className="flex gap-2">
              <Avatar user={r.author} size="xs" className="mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs">
                  <span className="font-semibold text-slate-800">{fullName(r.author)}</span>{' '}
                  <span className="text-[11px] text-slate-400" title={fullStamp(r.created_at)}>{stamp(r.created_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap text-slate-700">{r.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {replying ? (
        <ReplyBox compact className="mt-2" ticketId={ticketId} parentId={m.id}
          placeholder={m.kind === 'question' ? 'Answer this question…' : 'Reply…'}
          onPosted={() => { setReplying(false); onChanged(); }} />
      ) : (
        <button type="button" onClick={() => setReplying(true)} className="mt-1.5 text-xs font-medium text-brand-600 hover:underline">
          {m.kind === 'question' ? (m.replies.length ? 'Add an answer' : 'Answer') : 'Reply'}
        </button>
      )}
    </>
  );
}

/** Ask, comment, or upload a document to the ticket. */
function Composer({ ticketId, cards, onPosted }) {
  const [mode, setMode] = useState('question'); // question | comment | file
  const [about, setAbout] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'file') {
        const fd = new FormData();
        fd.append('file', file);
        await api.post(`/tickets/${ticketId}/files`, fd);
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
      } else {
        await api.post(`/tickets/${ticketId}/comments`, { body: text, kind: mode, card_id: about ? Number(about) : null });
        setText('');
      }
      onPosted();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'file' ? !!file : !!text.trim();

  return (
    <section className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {mode === 'file'
          ? <button type="button" className="text-xs text-brand-600 hover:underline" onClick={() => setMode('question')}>← Ask or comment instead</button>
          : <KindToggle kind={mode} onChange={setMode} />}
        {mode !== 'file' && (
          <button type="button" onClick={() => setMode('file')} className="flex items-center gap-1 text-xs text-slate-600 hover:text-brand-700">
            <Upload size={13} /> Upload document
          </button>
        )}
      </div>

      {mode === 'file' ? (
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-5 text-sm transition ${file ? 'border-emerald-300 bg-emerald-50/50 text-emerald-800' : 'border-slate-300 bg-white text-slate-500 hover:border-brand-500'}`}>
          <Upload size={18} />
          {file ? <span className="font-medium">{file.name} <span className="font-normal text-slate-500">· {bytes(file.size)}</span></span> : <span>Choose a file (up to 25 MB)</span>}
          <input ref={fileRef} type="file" className="sr-only" onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>
      ) : (
        <>
          <select className="input py-1.5 text-sm" value={about} onChange={(e) => setAbout(e.target.value)}>
            <option value="">About the whole master ticket</option>
            {cards.map((c) => <option key={c.id} value={c.id}>About the priority: {c.title || 'Untitled priority'} (week of {shortDate(c.week_start)})</option>)}
          </select>
          <textarea className="input min-h-20 text-sm" value={text} onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'question' ? 'Ask a question about this ticket…' : 'Leave a comment…'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (ready) submit(); }
              if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); }
            }} />
        </>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || (mode === 'file' ? '' : `${SAVE_KEY} to post`)}</span>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={submit} disabled={!ready || busy}>
          {busy ? <><Loader2 size={12} className="animate-spin" /> {mode === 'file' ? 'Uploading…' : 'Posting…'}</> : mode === 'file' ? 'Upload' : `Post ${KIND[mode].label.toLowerCase()}`}
        </button>
      </div>
    </section>
  );
}
