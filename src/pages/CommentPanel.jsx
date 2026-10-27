import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Loader2, ArrowRight, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { fullName, stamp, fullStamp, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import Avatar from '../components/Avatar.jsx';
import SidePanel from '../components/SidePanel.jsx';
import MentionTextarea, { MentionText } from '../components/MentionTextarea.jsx';
import { KIND } from './LaneViews.jsx';

const SAVE_KEY = /Mac|iP(hone|ad)/.test(navigator.platform) ? '⌘↵' : 'Ctrl+↵';

/**
 * Right-hand pane for one question or comment: the master ticket on top, then the post,
 * then its replies. With `options` instead of `threadId`, it starts a new post.
 */
export default function CommentPanel({ threadId, options, member, onClose, onPosted, onChanged, highlight, footer }) {
  return threadId
    ? <ThreadPane id={threadId} onClose={onClose} onChanged={onChanged} highlight={highlight} footer={footer} />
    : <NewThreadPane options={options} member={member} onClose={onClose} onPosted={onPosted} />;
}

function ThreadPane({ id, onClose, onChanged, highlight, footer }) {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const load = () => api.get(`/tickets/comments/${id}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = KIND[data?.comment.kind] || KIND.comment;
  const remove = async (c) => {
    if (!confirm(c.parent_id ? 'Delete this reply?' : 'Delete this post and all of its replies?')) return;
    await api.del(`/tickets/comments/${c.id}`);
    onChanged?.();
    if (c.parent_id) load(); else onClose();
  };

  return (
    <SidePanel title={data ? 'Comment' : 'Loading…'} subtitle={data && `Master ticket #${data.ticket.id}`} onClose={onClose} footer={footer}>
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {data && (
        <div className="space-y-5">
          <TicketSummary ticket={data.ticket} card={data.card} />
          <Post post={data.comment} kind={k} big canDelete={data.comment.author?.id === user.id || user.role === 'admin'} onDelete={() => remove(data.comment)} />
          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {data.replies.length ? `${data.replies.length} repl${data.replies.length === 1 ? 'y' : 'ies'}` : 'Replies'}
            </h3>
            <ul className="space-y-3">
              {data.replies.map((r) => (
                <li key={r.id} className={r.id === highlight ? 'rounded-lg bg-brand-50/60 p-1.5 ring-1 ring-brand-100' : ''}><Post post={r} canDelete={r.author?.id === user.id || user.role === 'admin'} onDelete={() => remove(r)} /></li>
              ))}
            </ul>
            <ReplyBox className="mt-3" ticketId={data.ticket.id} parentId={data.comment.id}
              placeholder="Reply… (@ to mention someone)"
              onPosted={() => { load(); onChanged?.(); }} />
          </section>
        </div>
      )}
    </SidePanel>
  );
}

/** The master ticket a post is about, and the priority when it's about one. */
export function TicketSummary({ ticket, card }) {
  return (
    <section className="rounded-lg bg-slate-50 p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase"><Package size={13} /> Master ticket</span>
        <Link to={`/tickets?open=${ticket.id}`} className="flex items-center gap-0.5 text-xs text-brand-600 hover:underline">Timeline <ArrowRight size={12} /></Link>
      </div>
      <div className="font-semibold text-slate-900">{ticket.opportunity_title}</div>
      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
        {ticket.organization && <span className="text-slate-600">{ticket.organization}</span>}
        {ticket.pipeline_status && <span className="rounded bg-white px-1.5 py-0.5 text-slate-600 ring-1 ring-slate-200">{ticket.pipeline_status}</span>}
        {ticket.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{usd(ticket.value).replace('.00', '')}</span>}
      </div>
      {card && (
        <div className="mt-3 border-t border-slate-200 pt-2 text-sm">
          <span className="text-xs text-slate-500">About the priority </span>
          <span className="font-medium text-slate-800">{card.title || 'Untitled priority'}</span>
          <span className="text-xs text-slate-500">{card.week_start && ` · week of ${shortDate(card.week_start)}`}{card.completed ? ' · complete' : ''}</span>
        </div>
      )}
    </section>
  );
}

function Post({ post, kind, big, canDelete, onDelete }) {
  return (
    <div className={`group flex gap-3 ${big ? `rounded-lg p-3 ring-1 ${kind.ring}` : ''}`}>
      <Avatar user={post.author} size={big ? 'md' : 'sm'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
          <span className="font-semibold text-slate-800">{fullName(post.author) || 'Unknown'}</span>
          <span className="text-slate-400" title={fullStamp(post.created_at)}>{stamp(post.created_at)}</span>
          {canDelete && (
            <button type="button" onClick={onDelete} title="Delete" className="ml-auto rounded p-0.5 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-600">
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <p className={`mt-1 break-words whitespace-pre-wrap text-slate-800 ${big ? 'text-[15px]' : 'text-sm'}`}><MentionText text={post.body} /></p>
      </div>
    </div>
  );
}

/** A reply composer. ⌘↵ / Ctrl+↵ posts; Esc clears without closing the pane. */
export function ReplyBox({ ticketId, parentId, target, placeholder = 'Reply…', onPosted, onCancel, className = '', compact, autoFocus }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);
  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.post(`/tickets/${ticketId}/comments`, { body: text, parent_id: parentId, target_type: target?.type, target_id: target?.id });
      setText('');
      onPosted?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex gap-2 ${className}`}>
      {!compact && <Avatar user={user} />}
      <div className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
        <MentionTextarea inputRef={ref} rows={compact ? 1 : 2} value={text} placeholder={placeholder} disabled={busy} autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post(); }
            if (e.key === 'Escape' && (text || onCancel)) { e.stopPropagation(); if (text) setText(''); else onCancel(); }
          }}
          className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm placeholder:text-slate-400 focus:ring-0 focus:outline-none" />
        {(text || error || onCancel) && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
            <span className={`text-[11px] ${error ? 'text-red-600' : 'text-slate-400'}`}>{error || `${SAVE_KEY} to send · @ to mention`}</span>
            <span className="flex shrink-0 gap-1.5">
            {onCancel && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onCancel} disabled={busy}>Cancel</button>}
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={post} disabled={!text.trim() || busy}>
              {busy ? <><Loader2 size={12} className="animate-spin" /> Sending…</> : 'Reply'}
            </button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function NewThreadPane({ options = [], member, onClose, onPosted }) {
  // Comments here are always about a priority; ticket-wide comments belong on the master ticket's timeline.
  const [cardId, setCardId] = useState(options[0]?.cards[0]?.id ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ticket = options.find((o) => o.cards.some((c) => c.id === cardId));

  const post = async () => {
    if (!text.trim() || !ticket || busy) return;
    setBusy(true);
    setError('');
    try {
      const { comment } = await api.post(`/tickets/${ticket.ticket_id}/comments`, { body: text, kind: 'comment', card_id: cardId });
      onPosted(comment.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const close = () => { if (!text.trim() || confirm('Discard what you’ve written?')) onClose(); };

  return (
    <SidePanel title="Add a comment" subtitle={member && `For ${fullName(member)}’s work this week`} onClose={close}
      footer={(
        <div className="space-y-2">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button className="btn-primary w-full" onClick={post} disabled={!text.trim() || !ticket || busy}>
            {busy ? 'Posting…' : 'Post comment'}
          </button>
        </div>
      )}>
      <div className="space-y-4">
        <div>
          <label className="label">Priority</label>
          <select className="input" value={cardId ?? ''} onChange={(e) => setCardId(Number(e.target.value))}>
            {options.map((o) => (
              <optgroup key={o.ticket_id} label={o.title}>
                {o.cards.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </optgroup>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">For a comment about the master ticket as a whole, use its timeline on the Tickets page.</p>
        </div>
        <div>
          <label className="label">Your comment</label>
          <MentionTextarea className="input min-h-36" autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), post())}
            placeholder="What should the team know? (@ to mention someone)" />
          <p className="mt-1 text-[11px] text-slate-400">{SAVE_KEY} to post</p>
        </div>
      </div>
    </SidePanel>
  );
}
