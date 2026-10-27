import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StickyNote, FileText, Ticket, Upload, Loader2, Check, Square, Download, MessageSquarePlus, Pencil, ChevronRight, CalendarDays } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, stamp, fullStamp, shortDate, ticketKind } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import MentionTextarea, { MentionText } from '../components/MentionTextarea.jsx';
import { ReplyBox } from './CommentPanel.jsx';
import PriorityPanel from './PriorityPanel.jsx';
import { PlanRail, PlanDrawer } from './TicketPlanning.jsx';

const FILTERS = [
  ['all', 'Everything', () => true],
  ['card', 'Priorities', (e) => e.type === 'card'],
  ['talk', 'Comments & notes', (e) => e.type === 'comment' || e.type === 'note'],
  ['file', 'Documents', (e) => e.type === 'file'],
];
const SAVE_KEY = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵';
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const eventKey = (e) => `${e.type}-${e.card?.id ?? e.note?.id ?? e.comment?.id ?? e.file?.id ?? 0}`;

/**
 * Right-hand pane with everything that has happened on a master ticket, newest first.
 * `focus` ("c-12" for a comment, "n-4" for a note) scrolls to and highlights one item.
 */
export default function TicketTimeline({ ticketId, focus, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [cardId, setCardId] = useState(null); // a priority opened from the timeline
  const [tool, setTool] = useState(null); // tasks | strategy | assessment, shown in a pane off the left edge
  const toolDirty = useRef(false);
  const setToolDirty = (v) => { toolDirty.current = v; };
  const leaveTool = () => !toolDirty.current || confirm('You have unsaved changes. Discard them?');
  const switchTool = (next) => { if (leaveTool()) { toolDirty.current = false; setTool(next); } };
  const close = () => { if (leaveTool()) onClose(); };
  const load = () => api.get(`/tickets/${ticketId}/timeline`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { load(); onChanged?.(); };

  // Bring the linked comment or note into view once, with a brief highlight.
  const focused = useRef(false);
  useEffect(() => {
    if (!data || !focus || focused.current) return;
    focused.current = true;
    const el = document.getElementById(`tl-${focus}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('ring-2', 'ring-brand-500', 'ring-offset-2');
    setTimeout(() => el.classList.remove('ring-2', 'ring-brand-500', 'ring-offset-2'), 2500);
  }, [data, focus]);

  if (cardId) return <TicketPriority cardId={cardId} onBack={() => { setCardId(null); load(); }} onClose={close} />;

  const t = data?.ticket;
  const test = FILTERS.find(([k]) => k === filter)[2];
  const events = (data?.events || []).filter(test);

  return (
    <SidePanel wide onClose={close} title={t ? t.opportunity_title : 'Loading…'}
      onEscape={tool ? () => switchTool(null) : close}
      rail={t && <PlanRail ticket={t} active={tool} onSelect={switchTool} />}
      drawer={t && tool && <PlanDrawer key={tool} tool={tool} ticket={t} onClose={() => switchTool(null)} onChanged={refresh} onDirty={setToolDirty} />}
      subtitle={t && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 font-semibold ${t.ticket_type === 'work' ? 'bg-slate-200 text-slate-700' : 'bg-brand-50 text-brand-700'}`}>{ticketKind(t)} #{t.id}</span>
          {t.organization && <span>· {t.organization}</span>}
          {t.pipeline_status && <span className="rounded bg-slate-100 px-1.5 text-slate-600">{t.pipeline_status}</span>}
          {t.value != null && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{usd(t.value).replace('.00', '')}</span>}
          {t.event_id && (
            <Link to={`/events?open=${t.event_id}`} className="flex items-center gap-1 rounded bg-sky-50 px-1.5 text-sky-800 hover:underline" title="The event this ticket supports">
              <CalendarDays size={11} /> {t.event_name}
            </Link>
          )}
          {t.pwin && <span className="rounded bg-brand-50 px-1.5 font-semibold text-brand-700" title={`PWIN: weighted bid and win assessment, ${t.pwin.rated} of ${t.pwin.total} areas rated${t.pwin.penalties.length ? `. Held back by ${t.pwin.penalties.map((x) => x.title).join(', ')}` : ''}`}>PWIN {t.pwin.score}%</span>}
        </span>
      )}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="space-y-5">
          <Composer ticketId={t.id} onPosted={refresh} />

          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, l, f]) => {
              const n = data.events.filter(f).length;
              return (
                <button key={k} type="button" onClick={() => setFilter(k)} disabled={k !== 'all' && !n}
                  className={`rounded-full px-2.5 py-1 text-xs transition disabled:opacity-40 ${filter === k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {l} <span className="opacity-70">{n}</span>
                </button>
              );
            })}
          </div>

          <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-slate-200">
            {events.map((e) => <Event key={eventKey(e)} event={e} ticket={t} onChanged={refresh} onOpenCard={setCardId} />)}
          </ol>
        </div>
      )}
    </SidePanel>
  );
}

/** A priority opened from the timeline, with a way back. */
function TicketPriority({ cardId, onBack, onClose }) {
  const [state, setState] = useState(null);
  const [users, setUsers] = useState([]);
  const [statuses, setStatuses] = useState([]);
  useEffect(() => {
    api.get(`/priorities/cards/${cardId}`).then(setState);
    api.get('/users').then((d) => setUsers(d.users));
    api.get('/priorities/meta').then((d) => setStatuses(d.pipelineStatuses));
  }, [cardId]);
  if (!state) return <SidePanel title="Loading…" onClose={onClose} />;
  return (
    <PriorityPanel card={state.card} users={users} statuses={statuses} teamId={state.card.team_id} weekStart={state.card.week_start}
      readOnly={!state.editable} onBack={onBack} onClose={onClose} onSaved={onBack} onNotesChanged={() => {}} />
  );
}

/** Whoever owns the master ticket gets a note icon; everyone else their initials. */
function PostMarker({ author, ticket }) {
  if (author?.id && author.id === ticket.owner_id) {
    return (
      <span className="relative z-10 h-8 w-8 shrink-0 self-start rounded-full ring-4 ring-white" title={`Note from ${fullName(author)}, the ticket owner`}>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-amber-700"><StickyNote size={15} /></span>
        <Avatar user={author} size="xs" className="absolute -right-1.5 -bottom-1.5 ring-2 ring-white" />
      </span>
    );
  }
  return <span className="relative z-10 h-8 shrink-0 self-start rounded-full ring-4 ring-white"><Avatar user={author} size="md" /></span>;
}

/** The icon on the timeline rail that says where an event came from. */
function Marker({ event, ticket }) {
  const box = 'relative z-10 grid h-8 w-8 shrink-0 self-start place-items-center rounded-full ring-4 ring-white';
  if (event.type === 'comment' || event.type === 'note') return <PostMarker author={event.author} ticket={ticket} />;
  if (event.type === 'card') return <span className={`${box} bg-brand-600 font-mono text-[9px] font-bold tracking-tighter text-white`} title="Priority ticket">123</span>;
  if (event.type === 'file') return <span className={`${box} bg-emerald-100 text-emerald-700`} title="Document"><FileText size={15} /></span>;
  return <span className={`${box} bg-slate-200 text-slate-600`} title={ticketKind(ticket)}><Ticket size={15} /></span>;
}

function Meta({ event, children }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 pr-16 text-xs text-slate-500">
      <span><span className="font-semibold text-slate-800">{fullName(event.author) || 'Someone'}</span> {children}</span>
      <span className="text-[11px] text-slate-400" title={fullStamp(event.at)}>{stamp(event.at)}</span>
    </div>
  );
}

/** Small hover toolbar: comment under the item, and edit for its author. */
function HoverActions({ onComment, onEdit, className = '' }) {
  return (
    <div className={`flex gap-0.5 rounded-md bg-white opacity-0 shadow-sm ring-1 ring-slate-200 transition group-hover/item:opacity-100 focus-within:opacity-100 ${className}`}>
      {onComment && (
        <button type="button" onClick={onComment} title="Comment" aria-label="Comment" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700">
          <MessageSquarePlus size={14} />
        </button>
      )}
      {onEdit && (
        <button type="button" onClick={onEdit} title="Edit" aria-label="Edit" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-brand-700">
          <Pencil size={14} />
        </button>
      )}
    </div>
  );
}

/** Inline editor for a comment or note body. */
function EditBox({ initial, onSave, onCancel }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = text.trim() !== initial;
  const ref = useRef(null);
  // Start editing with the cursor at the end of the text.
  useLayoutEffect(() => { const el = ref.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, []);
  const save = async () => {
    if (!text.trim() || busy) return;
    if (!dirty) return onCancel();
    setBusy(true);
    try { await onSave(text.trim()); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="mt-1.5 rounded-lg border border-brand-500 bg-white ring-2 ring-brand-100">
      <MentionTextarea inputRef={ref} rows={3} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
          if (e.key === 'Escape') { e.stopPropagation(); if (!dirty || confirm('Discard your changes?')) onCancel(); }
        }}
        className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm focus:ring-0 focus:outline-none" />
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
        <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || (dirty ? `Unsaved changes · ${SAVE_KEY} to save` : 'No changes yet · Esc to cancel')}</span>
        <span className="flex shrink-0 gap-1.5">
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={save} disabled={!dirty || !text.trim() || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </span>
      </div>
    </div>
  );
}

function Event({ event: e, ticket, onChanged, onOpenCard }) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const post = e.type === 'comment' ? e.comment : e.type === 'note' ? e.note : null;
  const mine = post && e.author?.id === user.id;
  const save = async (body) => {
    if (e.type === 'comment') await api.put(`/tickets/comments/${e.comment.id}`, { body });
    else await api.put(`/priorities/notes/${e.note.id}`, { body });
    setEditing(false);
    onChanged();
  };
  // Comments under a standalone comment are replies to it; under anything else they're attached to the item.
  const replyTo = e.type === 'comment' ? { parentId: e.comment.id } : { target: { type: e.type, id: e.card?.id ?? e.note?.id ?? e.file?.id ?? ticket.id } };
  const isOwner = e.author?.id === ticket.owner_id;

  return (
    <li className="flex gap-3">
      <Marker event={e} ticket={ticket} />
      <div className="min-w-0 flex-1 pt-1">
        <div id={post ? `tl-${e.type === 'comment' ? 'c' : 'n'}-${post.id}` : undefined} className="group/item relative rounded-lg transition">
          <HoverActions className="absolute -top-1 right-0 z-10" onComment={() => setReplying(true)} onEdit={mine && !editing ? () => setEditing(true) : null} />

          {e.type === 'ticket' && <Meta event={e}>created this {ticketKind(ticket).toLowerCase()}</Meta>}

          {e.type === 'card' && (
            <>
              <Meta event={e}>{e.card.is_planned ? 'added a priority' : 'added work'}{e.card.team_name && <> for {e.card.team_name}</>}</Meta>
              <button type="button" onClick={() => onOpenCard(e.card.id)} title="Open this priority"
                className={`mt-1.5 block w-full rounded-lg border border-l-4 bg-white p-3 text-left text-sm transition hover:shadow-md ${e.card.is_planned ? 'border-slate-200 border-l-brand-600 hover:border-brand-500' : 'border-amber-200 border-l-amber-500'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className={`font-medium ${e.card.completed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{e.card.title || 'Untitled priority'}</div>
                  <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-300" />
                </div>
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
              </button>
            </>
          )}

          {post && (
            <>
              <Meta event={e}>
                {e.type === 'note'
                  ? <>added a note on <span className="font-medium text-slate-700">{e.note.card_title || 'a priority'}</span></>
                  : isOwner ? 'added a note' : 'commented'}
                {e.type === 'comment' && e.comment.card_title && <> on <span className="font-medium text-slate-700">{e.comment.card_title}</span></>}
              </Meta>
              {editing
                ? <EditBox initial={post.body} onSave={save} onCancel={() => setEditing(false)} />
                : (
                  <p className={`mt-1.5 rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap text-slate-800 ${isOwner || e.type === 'note' ? 'bg-amber-50/70' : 'bg-white ring-1 ring-slate-200'}`}>
                    <MentionText text={post.body} />
                  </p>
                )}
              {post.updated_at && !editing && <p className="mt-0.5 text-[11px] text-slate-400" title={fullStamp(post.updated_at)}>Edited {stamp(post.updated_at)}</p>}
            </>
          )}

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

        {e.replies?.length > 0 && (
          <ul className="mt-2 space-y-1 border-l-2 border-slate-100 pl-3">
            {e.replies.map((r) => <Reply key={r.id} reply={r} onComment={() => setReplying(true)} onChanged={onChanged} />)}
          </ul>
        )}

        {replying && (
          <ReplyBox compact autoFocus className="mt-2" ticketId={ticket.id} {...replyTo}
            placeholder="Write a comment… (@ to mention someone)"
            onCancel={() => setReplying(false)} onPosted={() => { setReplying(false); onChanged(); }} />
        )}
      </div>
    </li>
  );
}

function Reply({ reply: r, onComment, onChanged }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const save = async (body) => {
    await api.put(`/tickets/comments/${r.id}`, { body });
    setEditing(false);
    onChanged();
  };
  return (
    <li id={`tl-c-${r.id}`} className="group/item relative flex gap-2 rounded-md py-1 pr-1 transition">
      <Avatar user={r.author} size="xs" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="pr-16 text-xs">
          <span className="font-semibold text-slate-800">{fullName(r.author)}</span>{' '}
          <span className="text-[11px] text-slate-400" title={fullStamp(r.created_at)}>{stamp(r.created_at)}</span>
          {r.updated_at && <span className="text-[11px] text-slate-400" title={fullStamp(r.updated_at)}> · edited</span>}
        </div>
        {editing
          ? <EditBox initial={r.body} onSave={save} onCancel={() => setEditing(false)} />
          : <p className="text-sm break-words whitespace-pre-wrap text-slate-700"><MentionText text={r.body} /></p>}
      </div>
      {!editing && <HoverActions className="absolute top-0 right-0" onComment={onComment} onEdit={r.author?.id === user.id ? () => setEditing(true) : null} />}
    </li>
  );
}

/** "New comment or note" at the top of the timeline, plus document upload. */
function Composer({ ticketId, onPosted }) {
  const [mode, setMode] = useState('post'); // post | file
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
        await api.post(`/tickets/${ticketId}/comments`, { body: text, kind: 'comment' });
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
        <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{mode === 'file' ? 'Upload document' : 'New comment or note'}</span>
        <button type="button" onClick={() => setMode(mode === 'file' ? 'post' : 'file')} className="flex items-center gap-1 text-xs text-slate-600 hover:text-brand-700">
          {mode === 'file' ? '← Write a comment or note instead' : <><Upload size={13} /> Upload document</>}
        </button>
      </div>

      {mode === 'file' ? (
        <label className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-5 text-sm transition ${file ? 'border-emerald-300 bg-emerald-50/50 text-emerald-800' : 'border-slate-300 bg-white text-slate-500 hover:border-brand-500'}`}>
          <Upload size={18} />
          {file ? <span className="font-medium">{file.name} <span className="font-normal text-slate-500">· {bytes(file.size)}</span></span> : <span>Choose a file (up to 25 MB)</span>}
          <input ref={fileRef} type="file" className="sr-only" onChange={(e) => setFile(e.target.files[0] || null)} />
        </label>
      ) : (
        <MentionTextarea className="input min-h-20 text-sm" value={text} onChange={(e) => setText(e.target.value)}
          placeholder="Write a comment or note… (@ to mention someone)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (ready) submit(); }
            if (e.key === 'Escape' && text) { e.stopPropagation(); setText(''); }
          }} />
      )}

      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || (mode === 'file' ? '' : `${SAVE_KEY} to post · @ to mention`)}</span>
        <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={submit} disabled={!ready || busy}>
          {busy ? <><Loader2 size={12} className="animate-spin" /> {mode === 'file' ? 'Uploading…' : 'Posting…'}</> : mode === 'file' ? 'Upload' : 'Post'}
        </button>
      </div>
    </section>
  );
}
