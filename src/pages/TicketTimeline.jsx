import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StickyNote, FileText, Ticket, Upload, Loader2, Download, MessageSquarePlus, Pencil, ChevronRight, CalendarDays, CalendarCheck, Archive, RotateCcw, Mail, Pin, ExternalLink, Trash2, Trophy, XCircle, Undo2, BriefcaseBusiness, Workflow, ArrowLeft, Megaphone } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, stamp, fullStamp, shortDate, ticketKind } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { TicketLabels } from '../components/Labels.jsx';
import MentionTextarea, { MentionText } from '../components/MentionTextarea.jsx';
import { ReplyBox } from './CommentPanel.jsx';
import { PlanRail, PlanDrawer, TicketAccess, ViewOnlyNote } from './TicketPlanning.jsx';
import { canEditTicket } from '../lib/ticketAccess.js';
import { AssignmentBar } from './TicketAssignment.jsx';
import ProcessTimeline from '../components/ProcessTimeline.jsx';

const FILTERS = [
  ['all', 'Everything', () => true],
  ['activity', 'Activities', (e) => e.type === 'activity' || !!e.comment?.about],
  ['talk', 'Comments & notes', (e) => e.type === 'comment'],
  ['file', 'Documents', (e) => e.type === 'file'],
  ['email', 'Emails', (e) => e.type === 'email'],
];
const SAVE_KEY = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵';
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const eventKey = (e) => `${e.type}-${e.activity?.id ?? e.comment?.id ?? e.file?.id ?? e.email?.id ?? 0}`;

/**
 * Right-hand pane with everything that has happened on a master ticket, newest first.
 * `focus` ("c-12" for a comment) scrolls to and highlights one item; `activityId` opens that activity in the Activity pane;
 * `initialTool` opens the pane on one of its tools (strategy, process…). A pipeline ticket's Process view opens over the pane
 * and closing it returns here.
 */
export default function TicketTimeline({ ticketId, focus, activityId, initialTool = null, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tool, setTool] = useState(activityId !== undefined ? 'activities' : initialTool); // a pane off the left edge
  const [openActivity, setOpenActivity] = useState(activityId ?? null); // the activity the Activity pane opens on
  const [processOpen, setProcessOpen] = useState(false);
  const [processKey, setProcessKey] = useState(0);
  const toolDirty = useRef(false);
  const setToolDirty = (v) => { toolDirty.current = v; };
  const leaveTool = () => !toolDirty.current || confirm('You have unsaved changes. Discard them?');
  const switchTool = (next) => { if (leaveTool()) { toolDirty.current = false; setOpenActivity(null); setTool(next); } };
  const showActivity = (id) => { if (leaveTool()) { toolDirty.current = false; setOpenActivity(id); setTool('activities'); } };
  const showTool = (next) => { if (leaveTool()) { toolDirty.current = false; setOpenActivity(null); setTool(next); } };
  const close = () => { if (leaveTool()) onClose(); };
  const load = () => api.get(`/tickets/${ticketId}/timeline`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = () => { load(); onChanged?.(); setProcessKey((k) => k + 1); };

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

  const t = data?.ticket;
  const { user } = useAuth();
  const canEdit = canEditTicket(user, t);
  const access = { readOnly: !!t && !canEdit, ownerName: t?.owner_name ?? null };

  return (
    <TicketAccess.Provider value={access}>
    <SidePanel wide onClose={close} title={t ? t.opportunity_title : 'Loading…'}
      onEscape={processOpen ? () => setProcessOpen(false) : tool ? () => switchTool(null) : close}
      rail={t && <PlanRail ticket={t} active={tool} onSelect={switchTool} skip={t.ticket_type === 'account' ? ['strategy', 'tickets'] : []} />}
      drawer={t && tool && <PlanDrawer key={`${tool}-${openActivity}`} tool={tool} ticket={t} activityId={openActivity} onClose={() => switchTool(null)} onChanged={refresh} onDirty={setToolDirty} />}
      subtitle={t && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 font-semibold ${t.ticket_type === 'work' ? 'bg-slate-200 text-slate-700' : 'bg-brand-50 text-brand-700'}`}>{ticketKind(t)} #{t.id}</span>
          {t.organization && <span>· {t.organization}</span>}
          {t.team_name && <span className="rounded bg-slate-100 px-1.5 text-slate-600">{t.team_name}</span>}
          {t.pipeline_status && <span className="rounded bg-slate-100 px-1.5 text-slate-600">{t.pipeline_status}</span>}
          {t.deal_status === 'won' && <span className="flex items-center gap-1 rounded bg-emerald-100 px-1.5 font-semibold text-emerald-800" title={t.won_at ? `Won ${stamp(t.won_at)}` : 'Won'}><Trophy size={11} /> Won</span>}
          {t.deal_status === 'lost' && <span className="flex items-center gap-1 rounded bg-red-100 px-1.5 font-semibold text-red-800" title={t.lost_at ? `Lost ${stamp(t.lost_at)}` : 'Lost'}><XCircle size={11} /> Lost</span>}
          {t.value != null && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{usd(t.value).replace('.00', '')}</span>}
          {t.event_id && (
            <Link to={`/events?open=${t.event_id}`} className="flex items-center gap-1 rounded bg-sky-50 px-1.5 text-sky-800 hover:underline" title="The event this ticket supports">
              <CalendarDays size={11} /> {t.event_name}
            </Link>
          )}
          {(t.events || []).map((e) => (
            <Link key={e.id} to={`/events?open=${e.id}`} className="flex items-center gap-1 rounded bg-sky-50 px-1.5 text-sky-800 hover:underline"
              title={e.sourced ? 'This lead came out of this event' : 'An event this opportunity is tied to'}>
              <CalendarDays size={11} /> {e.name}
            </Link>
          ))}
          {t.lost_reason && <span className="rounded bg-red-50 px-1.5 text-red-700" title="Lost reason">{t.lost_reason}</span>}
          {t.probability != null && <span className="rounded bg-slate-100 px-1.5 text-slate-600" title="Deal probability, set by hand (Pipedrive)">{t.probability}% probability</span>}
          <TicketLabels ticket={t} onChanged={refresh} readOnly={!canEdit} />
          {t.pwin && <span className="rounded bg-brand-50 px-1.5 font-semibold text-brand-700" title={`PWIN: weighted bid and win assessment, ${t.pwin.rated} of ${t.pwin.total} areas rated${t.pwin.penalties.length ? `. Held back by ${t.pwin.penalties.map((x) => x.title).join(', ')}` : ''}`}>PWIN {t.pwin.score}%</span>}
        </span>
      )}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="space-y-5">
          {t.ticket_type === 'bid' && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <span className="flex items-center gap-1.5"><Workflow size={14} className="text-brand-600" /> The pursuit left to right: lead, strategy, shaping and milestones.</span>
              <span className="flex shrink-0 items-center gap-1.5">
                <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => showTool('marketing')} title="Marketing requests, lead source and marketing dollars for this ticket"><Megaphone size={13} /> Marketing</button>
                <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => setProcessOpen(true)}>Process view</button>
              </span>
            </div>
          )}
          {t.ticket_type === 'work' && (
            <div className="flex justify-end">
              <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => showTool('marketing')} title="Marketing requests for this ticket"><Megaphone size={13} /> Marketing</button>
            </div>
          )}
          <ViewOnlyNote />
          {/* Archiving, the BD director and territory, and won or lost are the owner's; others see them, disabled. */}
          <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
            {t.ticket_type !== 'account' && <ArchiveBar ticket={t} onChanged={refresh} />}
            {t.ticket_type === 'bid' && <AssignmentBar ticket={t} onChanged={refresh} />}
            {t.ticket_type === 'bid' && (canEdit || t.deal_status !== 'open') && <OutcomeBar ticket={t} onChanged={refresh} />}
          </fieldset>
          <Composer ticketId={t.id} onPosted={refresh} canUpload={canEdit} />
          <Feed data={data} onChanged={refresh} onOpenActivity={showActivity} />
        </div>
      )}
    </SidePanel>
    {processOpen && t && (
      <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50" role="dialog" aria-label={`Process view of ${t.opportunity_title}`}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-2.5">
          <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => setProcessOpen(false)}><ArrowLeft size={13} /> Back to ticket</button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Workflow size={15} className="text-brand-600" /> Process view</span>
          <span className="w-28 text-right text-[11px] text-slate-400">Esc to go back</span>
        </header>
        <div className="min-h-0 flex-1">
          <ProcessTimeline ticketId={t.id} reloadKey={processKey} onOpenTool={(next) => { setProcessOpen(false); if (next) showTool(next); }} />
        </div>
      </div>
    )}
    </TicketAccess.Provider>
  );
}

/** The filter chips and the events under them, newest first. */
function Feed({ data, onChanged, onOpenActivity }) {
  const [filter, setFilter] = useState('all');
  const test = FILTERS.find(([k]) => k === filter)[2];
  return (
    <>
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
        {data.events.filter(test).map((e) => <Event key={eventKey(e)} event={e} ticket={data.ticket} onChanged={onChanged} onOpenActivity={onOpenActivity} />)}
      </ol>
    </>
  );
}

/**
 * A ticket's timeline on its own, without the pane around it: the composer for notes and documents, then everything that has
 * happened, newest first. The priority account pane shows its hidden ticket this way. `reloadKey` changing reloads it.
 */
export function AccountTimeline({ ticketId, reloadKey = 0, onOpenActivity }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get(`/tickets/${ticketId}/timeline`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [ticketId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {data && (
        <>
          <Composer ticketId={ticketId} onPosted={load} />
          <Feed data={data} onChanged={load} onOpenActivity={onOpenActivity} />
        </>
      )}
    </div>
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
  if (event.type === 'comment') return <PostMarker author={event.author} ticket={ticket} />;
  if (event.type === 'activity') return <span className={`${box} bg-violet-100 text-violet-700`} title="Activity"><CalendarCheck size={15} /></span>;
  if (event.type === 'email') return <span className={`${box} bg-sky-100 text-sky-700`} title="Email"><Mail size={15} /></span>;
  if (event.type === 'file') return <span className={`${box} bg-emerald-100 text-emerald-700`} title="Document"><FileText size={15} /></span>;
  return <span className={`${box} bg-slate-200 text-slate-600`} title={ticketKind(ticket)}><Ticket size={15} /></span>;
}

function Meta({ event, children }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 pr-16 text-xs text-slate-500">
      <span><span className="font-semibold text-slate-800">{event.type === 'email' ? event.email.from || 'Someone' : fullName(event.author) || 'Someone'}</span> {children}</span>
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

function Event({ event: e, ticket, onChanged, onOpenActivity }) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const post = e.type === 'comment' ? e.comment : null;
  const about = post?.about; // a comment on an activity or one of its subtasks
  const mine = post && e.author?.id === user.id;
  const save = async (body) => {
    await api.put(`/tickets/comments/${e.comment.id}`, { body });
    setEditing(false);
    onChanged();
  };
  // Comments under a standalone comment are replies to it; under an activity they're comments on it; under anything
  // else they're attached to the item.
  const replyTo = e.type === 'comment' ? { parentId: e.comment.id }
    : { target: { type: e.type, id: e.activity?.id ?? e.file?.id ?? e.email?.id ?? ticket.id } };
  const isOwner = e.author?.id === ticket.owner_id;
  // A Pipedrive note from anyone but the ticket owner reads as a plain comment here; it keeps its pin only while pinned, so it can be unpinned.
  const isNote = e.type === 'comment' && e.comment.kind === 'note' && isOwner;
  const canPin = e.type === 'comment' && e.comment.kind === 'note' && (isOwner || e.comment.pinned) && canEditTicket(user, ticket);
  const pin = async () => { await api.put(`/tickets/comments/${e.comment.id}/pin`, { pinned: !e.comment.pinned }); onChanged(); };

  return (
    <li className="flex gap-3">
      <Marker event={e} ticket={ticket} />
      <div className="min-w-0 flex-1 pt-1">
        <div id={post ? `tl-${e.type === 'comment' ? 'c' : 'n'}-${post.id}` : undefined} className="group/item relative rounded-lg transition">
          <HoverActions className="absolute -top-1 right-0 z-10" onComment={() => setReplying(true)} onEdit={mine && !editing ? () => setEditing(true) : null} />

          {e.type === 'ticket' && <Meta event={e}>created this {ticketKind(ticket).toLowerCase()}</Meta>}

          {e.type === 'activity' && (
            <>
              <Meta event={e}>added an activity{e.activity.priorities && <> · a weekly priority ({e.activity.priorities})</>}</Meta>
              <button type="button" onClick={() => onOpenActivity(e.activity.id)} title="Open this activity"
                className="mt-1.5 block w-full rounded-lg border border-l-4 border-slate-200 border-l-violet-500 bg-white p-3 text-left text-sm transition hover:border-violet-400 hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <div className={`font-medium ${e.activity.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{e.activity.subject}</div>
                  <ChevronRight size={15} className="mt-0.5 shrink-0 text-slate-300" />
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  {[e.activity.activity_type, e.activity.due_date && `due ${shortDate(e.activity.due_date)}${e.activity.due_time ? ` ${e.activity.due_time}` : ''}`,
                    e.activity.assignee, e.activity.done && 'done'].filter(Boolean).join(' · ')}
                </div>
              </button>
            </>
          )}

          {post && (
            <>
              <Meta event={e}>
                {about
                  ? <>commented on {about.subtask ? <>subtask <span className="font-medium text-slate-700">“{about.subtask}”</span> of </> : 'activity '}
                    <button type="button" onClick={() => about.activity_id && onOpenActivity(about.activity_id)} className="font-medium text-violet-700 hover:underline">{about.subject || 'an activity'}</button></>
                  : isOwner || isNote ? 'added a note' : 'commented'}
                {!about && e.comment.card_title && <> on <span className="font-medium text-slate-700">{e.comment.card_title}</span></>}
                {about && <span className="ml-1 rounded bg-violet-100 px-1.5 text-[10px] font-semibold tracking-wide text-violet-800 uppercase">Activity comment</span>}
                {canPin && (
                  <button type="button" onClick={pin} title={e.comment.pinned ? 'Unpin this note' : 'Pin this note to the top'}
                    className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[11px] ${e.comment.pinned ? 'bg-amber-100 font-medium text-amber-800' : 'text-slate-400 hover:text-slate-700'}`}>
                    <Pin size={11} /> {e.comment.pinned ? 'Pinned' : 'Pin'}
                  </button>
                )}
              </Meta>
              {editing
                ? <EditBox initial={post.body} onSave={save} onCancel={() => setEditing(false)} />
                : (
                  <p className={`mt-1.5 rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap text-slate-800 ${about ? 'border-l-4 border-violet-500 bg-violet-50 ring-1 ring-violet-200' : isOwner || isNote ? 'bg-amber-50 ring-1 ring-amber-300' : 'bg-white ring-1 ring-slate-200'}`}>
                    <MentionText text={post.body} />
                  </p>
                )}
              {post.updated_at && !editing && <p className="mt-0.5 text-[11px] text-slate-400" title={fullStamp(post.updated_at)}>Edited {stamp(post.updated_at)}</p>}
            </>
          )}

          {e.type === 'file' && (
            <>
              <Meta event={e}>
                {e.file.url ? 'linked a document' : 'uploaded a document'}
                {e.file.step_type && <> to <span className="font-medium text-slate-700">{e.file.step_type}</span></>}
                {e.file.email_id && ' from an email'}
              </Meta>
              <div className="mt-1.5 flex items-center gap-1">
              <a href={`/api/tickets/files/${e.file.id}`} target={e.file.url ? '_blank' : undefined} rel={e.file.url ? 'noreferrer' : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-brand-500">
                <FileText size={16} className="shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{e.file.name}</span>
                {e.file.size != null && <span className="shrink-0 text-[11px] text-slate-400">{bytes(e.file.size)}</span>}
                {e.file.url ? <ExternalLink size={14} className="shrink-0 text-slate-400" /> : <Download size={14} className="shrink-0 text-slate-400" />}
              </a>
              {canEditTicket(user, ticket) && (
                <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-slate-400 hover:text-red-600" aria-label={`Delete ${e.file.name}`} title="Delete file"
                  onClick={async () => { if (confirm(`Delete “${e.file.name}”?${e.file.synced ? ' It’s deleted from the deal in Pipedrive too.' : ''}`)) { await api.del(`/tickets/files/${e.file.id}`); onChanged(); } }}>
                  <Trash2 size={14} />
                </button>
              )}
              </div>
            </>
          )}

          {e.type === 'email' && (
            <>
              <Meta event={e}>sent an email{e.email.to && <> to <span className="text-slate-600">{e.email.to}</span></>}</Meta>
              <details className="mt-1.5 rounded-lg border border-slate-200 bg-white text-sm open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
                  <Mail size={15} className="shrink-0 text-sky-600" />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{e.email.subject || '(no subject)'}</span>
                  <ChevronRight size={14} className="shrink-0 text-slate-400" />
                </summary>
                <div className="border-t border-slate-100 px-3 py-2">
                  {e.email.cc && <p className="mb-1 text-[11px] text-slate-500">Cc: {e.email.cc}</p>}
                  <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{e.email.body || 'No message body.'}</p>
                </div>
              </details>
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
function Composer({ ticketId, onPosted, canUpload = true }) {
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
        <span className="text-xs font-semibold tracking-wide text-slate-600 uppercase">{mode === 'file' ? 'Upload document' : canUpload ? 'New comment or note' : 'New comment'}</span>
        {canUpload && (
          <button type="button" onClick={() => setMode(mode === 'file' ? 'post' : 'file')} className="flex items-center gap-1 text-xs text-slate-600 hover:text-brand-700">
            {mode === 'file' ? '← Write a comment or note instead' : <><Upload size={13} /> Upload document</>}
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

/** Archive the ticket (it leaves the boards; restore it here or from the Archive page), or restore an archived one. */
/**
 * Won, lost or open: the deal's status, apart from its stage (as in Pipedrive). Won puts the ticket into Delivery as a
 * contract; lost asks for a reason. On a Pipedrive deal the change is synced to Pipedrive.
 */
function OutcomeBar({ ticket: t, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState(t.lost_reason || '');
  const [program, setProgram] = useState(null);
  const set = async (deal_status, lost_reason) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.put(`/tickets/${t.id}/outcome`, { deal_status, lost_reason });
      setProgram(r.program);
      setLosing(false);
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const synced = t.pipedrive_id ? ' Pipedrive follows.' : '';
  if (t.deal_status === 'won') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        <span className="flex items-center gap-1.5"><Trophy size={14} /> Won{t.won_at ? ` ${stamp(t.won_at)}` : ''}. It’s a contract in Delivery.</span>
        <span className="flex items-center gap-2">
          <Link to={`/delivery?open=${program?.id ?? ''}&ticket=${t.id}`} className="flex items-center gap-1 text-xs font-medium text-emerald-800 hover:underline"><BriefcaseBusiness size={13} /> Open in Delivery</Link>
          <button type="button" className="btn px-2.5 py-1 text-xs" disabled={busy} onClick={() => confirm(`Reopen “${t.opportunity_title}”? Its contract in Delivery goes on hold.${synced}`) && set('open')}><Undo2 size={13} /> Reopen</button>
        </span>
      </div>
    );
  }
  if (t.deal_status === 'lost') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
        <span className="flex items-center gap-1.5"><XCircle size={14} /> Lost{t.lost_at ? ` ${stamp(t.lost_at)}` : ''}{t.lost_reason ? ` · ${t.lost_reason}` : ''}</span>
        <button type="button" className="btn px-2.5 py-1 text-xs" disabled={busy} onClick={() => confirm(`Reopen “${t.opportunity_title}”?${synced}`) && set('open')}><Undo2 size={13} /> Reopen</button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!losing && (
          <>
            <button type="button" className="btn px-2.5 py-1 text-xs text-red-700" disabled={busy} onClick={() => setLosing(true)}><XCircle size={13} /> Lost</button>
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" disabled={busy} title={`Mark this deal won. It moves into Delivery as a contract.${synced}`}
              onClick={() => confirm(`Mark “${t.opportunity_title}” won? It moves into Delivery as a contract.${synced}`) && set('won')}><Trophy size={13} /> Won</button>
          </>
        )}
      </div>
      {losing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-3 text-sm">
          <span className="font-medium text-red-900">Why was it lost?</span>
          <input className="input h-8 min-w-48 flex-1 py-0 text-sm" list="lost-reasons" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          <datalist id="lost-reasons">{(t.lost_reasons || []).map((x) => <option key={x} value={x} />)}</datalist>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setLosing(false)} disabled={busy}>Cancel</button>
          <button type="button" className="btn px-2.5 py-1 text-xs text-red-700" disabled={busy} onClick={() => set('lost', reason)}>{busy ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Mark lost</button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function ArchiveBar({ ticket, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isBid = ticket.ticket_type === 'bid';
  const set = async (archived) => {
    setBusy(true);
    setError('');
    try { await api.put(`/tickets/${ticket.id}/lane`, { archived }); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  if (ticket.archived) {
    const how = ticket.pipedrive_deleted_at ? 'was deleted in Pipedrive, so it is archived here' : ticket.pipedrive_archived_at ? 'is archived in Pipedrive, so it is archived here too' : 'is archived';
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <span className="flex items-center gap-1.5"><Archive size={14} /> This ticket {how} and off the boards.</span>
          <span className="flex items-center gap-2">
            {isBid
              ? <Link to="/closed-deals" className="text-xs text-brand-700 hover:underline">Open Closed deals</Link>
              : <Link to="/tickets/done" className="text-xs text-brand-700 hover:underline">Open the Done archive</Link>}
            {ticket.pipedrive_archived_at
              ? <span className="text-xs text-slate-500">Unarchive it in Pipedrive and it comes back on the next pull.</span>
              : <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => set(false)} disabled={busy}><RotateCcw size={13} /> Restore</button>}
          </span>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }
  // A won deal is reopened first (its contract goes on hold), then archived or marked lost: see the Reopen button below.
  if (isBid && ticket.deal_status === 'won') return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <button type="button" className="btn-ghost px-2 py-1 text-xs text-slate-500" onClick={() => set(true)} disabled={busy}
          title={isBid ? 'Take this deal off the boards. It goes to Closed deals under Other, and can be restored from here.' : 'Move this ticket to the Done archive. Restore it from there any time.'}>
          <Archive size={13} /> {isBid ? 'Archive ticket' : 'Move to the Done archive'}
        </button>
      </div>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
