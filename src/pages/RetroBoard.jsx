import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, EyeOff, Eye, Layers, Merge, Pencil, Plus, Settings2, Split, ThumbsUp, Timer, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { LessonPanel, lessonNo } from './LessonsLearned.jsx';
import { RetroPanel, STAGE_NAMES } from './Retros.jsx';

// How often a board picks up other people's changes while it's on screen.
const POLL_MS = 2000;
const FLASH_MS = 1600; // how long a ticket that just moved stays lit
const NEXT = { brainstorm: 'actions', actions: 'closed' };
const NEXT_LABEL = { brainstorm: 'Start actions', actions: 'Close retro' };
const BACK = { actions: 'brainstorm', closed: 'actions' };
const BACK_LABEL = { actions: 'Back to brainstorm', closed: 'Reopen' };
const LEAN_STYLE = { good: 'border-t-emerald-400', bad: 'border-t-red-400' };
const TIMER_PRESETS = [1, 2, 3, 5, 10]; // minutes
// How large the lanes and tickets are drawn, in percent. Each person's own choice, kept in their browser.
const ZOOMS = [75, 100, 125, 150, 175, 200];
const ZOOM_KEY = 'kit.retroZoom';
const savedZoom = () => {
  try { const z = Number(localStorage.getItem(ZOOM_KEY)); return ZOOMS.includes(z) ? z : 100; } catch { return 100; }
};

/** Smaller, the size now (click to go back to 100%), larger. */
function Zoom({ zoom, onZoom }) {
  const at = ZOOMS.indexOf(zoom);
  return (
    <div className="inline-flex items-center rounded-md border border-slate-300 bg-white" role="group" aria-label="Ticket size">
      <button type="button" className="btn-ghost p-2" aria-label="Smaller tickets" disabled={at <= 0} onClick={() => onZoom(ZOOMS[at - 1])}><ZoomOut size={14} /></button>
      <button type="button" className="min-w-11 px-1 text-xs font-semibold text-slate-600 tabular-nums hover:text-slate-900" title="Back to 100%" aria-label={`Ticket size ${zoom}%. Back to 100%`}
        onClick={() => onZoom(100)}>{zoom}%</button>
      <button type="button" className="btn-ghost p-2" aria-label="Larger tickets" disabled={at >= ZOOMS.length - 1} onClick={() => onZoom(ZOOMS[at + 1])}><ZoomIn size={14} /></button>
    </div>
  );
}

// A ticket is also somewhere to drop another ticket, which merges the two. Its drop id is apart from the lanes' ids.
const dropId = (noteId) => `note-${noteId}`;
const isTicketDrop = (id) => String(id).startsWith('note-');
/**
 * What a held ticket is over: another ticket if the pointer is on its middle (merge), else the lane under it (move).
 * A ticket's edges and the gaps between tickets count as the lane, so a ticket can still be moved into a full lane.
 */
let pointer = null; // where the pointer last was during a drag, for working out where in a lane a ticket lands
const collide = (args) => {
  pointer = args.pointerCoordinates;
  const hits = pointerWithin(args);
  const onMiddle = (h) => {
    const box = args.droppableRects.get(h.id);
    const at = args.pointerCoordinates;
    if (!box || !at) return false;
    const x = box.width * 0.15;
    const y = Math.min(box.height * 0.25, 20);
    return at.x >= box.left + x && at.x <= box.right - x && at.y >= box.top + y && at.y <= box.bottom - y;
  };
  const ticket = hits.find((h) => isTicketDrop(h.id) && h.id !== dropId(args.active.id) && onMiddle(h));
  return ticket ? [ticket] : hits.filter((h) => !isTicketDrop(h.id));
};

/** Enter sends, Shift+Enter starts a new line. */
const submitOnEnter = (send) => (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
};

const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The lead's countdown, as everyone sees it. The server says how much is left on every poll; between polls this
 * ticks it down on its own, so the clock runs smoothly and everyone's screen agrees to about a second.
 */
function Countdown({ timer, isLead, boardId, onAct }) {
  const endsAt = useMemo(() => Date.now() + timer.left_ms, [timer]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, endsAt - now);
  const up = left === 0;
  const done = timer.total_ms ? Math.min(100, 100 - (left / timer.total_ms) * 100) : 100;

  return (
    <div role="timer" aria-live={up ? 'assertive' : 'off'} aria-label={up ? 'Time’s up' : `${clock(left)} left`}
      className={`flex items-center gap-4 rounded-md px-3 py-2 text-sm ${up ? 'bg-red-50 text-red-800' : 'bg-slate-900 text-white'}`}>
      <Timer size={18} className={up ? 'animate-pulse' : 'text-slate-400'} />
      <span className="text-2xl font-bold tabular-nums">{up ? 'Time’s up' : clock(left)}</span>
      {!up && (
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${done}%` }} />
        </div>
      )}
      {isLead && (
        <div className={`flex items-center gap-1.5 ${up ? 'ml-auto' : ''}`}>
          <button type="button" className={`btn px-2 py-1 text-xs ${up ? '' : 'border-white/30 bg-transparent text-white hover:bg-white/10'}`}
            onClick={() => onAct(() => api.put(`/retros/${boardId}/timer`, { seconds: 60 }))}>+1 min</button>
          <button type="button" className={`btn px-2 py-1 text-xs ${up ? '' : 'border-white/30 bg-transparent text-white hover:bg-white/10'}`}
            onClick={() => onAct(() => api.del(`/retros/${boardId}/timer`))}>{up ? 'Clear' : 'Stop'}</button>
        </div>
      )}
    </div>
  );
}

/** The lead's Timer button: pick a length and the countdown starts for everyone. */
function TimerMenu({ boardId, onAct }) {
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const start = (mins) => {
    setOpen(false);
    setMinutes('');
    onAct(() => api.post(`/retros/${boardId}/timer`, { seconds: Math.round(mins * 60) }));
  };
  const custom = Number(minutes);
  const customOk = custom > 0 && custom <= 60;

  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}><Timer size={14} /> Timer</button>
      {open && (
        <div role="menu" aria-label="Start a timer" className="absolute right-0 z-10 mt-1 w-44 overflow-hidden rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-slate-200"
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}>
          {TIMER_PRESETS.map((m) => (
            <button key={m} type="button" role="menuitem" className="flex w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50" onClick={() => start(m)}>
              {m} minute{m === 1 ? '' : 's'}
            </button>
          ))}
          <form className="flex items-center gap-1 border-t border-slate-100 px-3 pt-2 pb-1" onSubmit={(e) => { e.preventDefault(); if (customOk) start(custom); }}>
            <input type="number" min="1" max="60" step="1" inputMode="numeric" className="input w-16 py-1 text-sm" placeholder="min" aria-label="Minutes"
              value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            <button type="submit" className="btn-primary px-2 py-1 text-xs" disabled={!customOk}>Start</button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * The tickets that changed place between two looks at the board: into another lane, or to another spot in their own.
 * In a reordered lane only the ones that actually jumped count, not the neighbours that shuffled along.
 */
function movedTickets(before, after) {
  const was = new Map(before.map((n) => [n.id, n]));
  const moved = after.filter((n) => was.has(n.id) && was.get(n.id).lane_id !== n.lane_id).map((n) => n.id);
  const stayed = (n) => was.has(n.id) && was.get(n.id).lane_id === n.lane_id;
  for (const laneId of new Set(after.map((n) => n.lane_id))) {
    const now = after.filter((n) => n.lane_id === laneId && stayed(n)).map((n) => n.id);
    const then = before.filter((n) => now.includes(n.id)).map((n) => n.id);
    if (now.join() === then.join()) continue;
    // Whatever isn't in the longest run of tickets still in the same order is what moved.
    const run = then.map(() => now.map(() => 0));
    const at = (i, j) => (i < 0 || j < 0 ? 0 : run[i][j]);
    then.forEach((a, i) => now.forEach((b, j) => { run[i][j] = a === b ? at(i - 1, j - 1) + 1 : Math.max(at(i - 1, j), at(i, j - 1)); }));
    const kept = new Set();
    for (let i = then.length - 1, j = now.length - 1; i >= 0 && j >= 0;) {
      if (then[i] === now[j]) { kept.add(then[i]); i -= 1; j -= 1; } else if (at(i - 1, j) >= at(i, j - 1)) i -= 1; else j -= 1;
    }
    moved.push(...now.filter((x) => !kept.has(x)));
  }
  return moved;
}

/** A ticket's face. Its controls sit in `children`, so the drag overlay can show it without them. */
const Face = ({ note, overlay, picked, dropping, flash, children }) => (
  <div className={`rounded-lg border bg-white p-2.5 shadow-sm ${picked || dropping ? 'border-brand-500 ring-2 ring-brand-200' : 'border-slate-200'} ${overlay ? 'rotate-1 shadow-lg' : ''} ${flash ? 'animate-[retroflash_1.6s_ease-out]' : ''}`}>
    {dropping && <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-brand-700"><Merge size={13} /> Drop to merge</p>}
    {note.hidden
      ? <p className="flex items-center gap-1.5 text-sm text-slate-400"><EyeOff size={14} /> Hidden until the lead reveals</p>
      : <p className="text-sm break-words whitespace-pre-wrap text-slate-800">{note.text}</p>}
    {children}
  </div>
);

/** The tickets a merged ticket was made from, each as it was, with a way to split one out or undo the merge. */
function Originals({ note, laneNames, canMerge, onAct }) {
  const unmerge = (original_id) => onAct(() => api.post(`/retros/${note.board}/notes/${note.id}/unmerge`, original_id ? { original_id } : {}));
  return (
    <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
      {note.originals.map((o) => (
        <div key={o.id} className="rounded-md bg-slate-50 p-2">
          <p className="text-xs break-words whitespace-pre-wrap text-slate-700">{o.text}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 tabular-nums"><ThumbsUp size={12} /> {o.votes}</span>
            {o.lane_id !== note.lane_id && laneNames[o.lane_id] && <span className="truncate">From {laneNames[o.lane_id]}</span>}
            {o.mine && <span>Yours</span>}
            {canMerge && (
              <button type="button" className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                onClick={() => unmerge(o.id)}><Split size={12} /> Split out</button>
            )}
          </div>
        </div>
      ))}
      {canMerge && <button type="button" className="btn w-full justify-center px-2 py-1 text-xs" onClick={() => unmerge()}>Unmerge all</button>}
    </div>
  );
}

function Ticket({ note, stage, isLead, canMove, canMerge, picking, laneNames, flash, onPick, onAct, onLesson }) {
  const [editing, setEditing] = useState(null); // the words being edited
  const [showOriginals, setShowOriginals] = useState(false);
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({ id: note.id, disabled: !canMove || editing !== null || !!picking });
  const { setNodeRef: dropRef, isOver } = useDroppable({ id: dropId(note.id), disabled: !canMerge || note.hidden || editing !== null || !!picking });
  const setNodeRef = (el) => { dragRef(el); dropRef(el); };
  const brainstorming = stage === 'brainstorm';
  const merged = note.originals.length > 0;
  const canDelete = stage !== 'closed' && !note.hidden && (isLead || (note.mine && brainstorming));
  const canReword = merged ? canMerge : note.mine && brainstorming;

  const save = () => {
    const words = editing.trim();
    if (words && words !== note.text) onAct(() => api.put(`/retros/${note.board}/notes/${note.id}${merged ? '/overview' : ''}`, { text: words }));
    setEditing(null);
  };
  const remove = () => {
    const msg = merged ? `Delete this merged ticket and the ${note.originals.length} tickets in it?` : 'Delete this ticket?';
    if (confirm(msg)) onAct(() => api.del(`/retros/${note.board}/notes/${note.id}`));
  };

  // Picking tickets to merge: the whole ticket is one button and nothing else on it works.
  if (picking) {
    const picked = picking.includes(note.id);
    return (
      <button type="button" disabled={note.hidden} aria-pressed={picked} onClick={() => onPick(note.id)} className="block w-full text-left disabled:opacity-50">
        <Face note={note} picked={picked} flash={flash}>
          <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex items-center gap-1 tabular-nums"><ThumbsUp size={12} /> {note.votes}</span>
            {merged && <span className="inline-flex items-center gap-1"><Layers size={12} /> {note.originals.length} merged</span>}
            {picked && <span className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-700"><Check size={13} /> Picked</span>}
          </div>
        </Face>
      </button>
    );
  }

  if (editing !== null) {
    return (
      <div className="rounded-lg border border-brand-300 bg-white p-2 shadow-sm">
        <textarea className="input text-sm" rows={3} maxLength={500} autoFocus aria-label={merged ? 'Reword the overview' : 'Reword your ticket'} value={editing}
          onChange={(e) => setEditing(e.target.value)} onKeyDown={submitOnEnter(save)} />
        <div className="mt-1 flex justify-end gap-1">
          <button type="button" className="btn-ghost p-1" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
          <button type="button" className="btn-ghost p-1" aria-label="Save" onClick={save}><Check size={14} /></button>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} data-note={note.id} {...attributes} {...listeners} className={`${canMove ? 'cursor-grab touch-none' : ''} ${isDragging ? 'opacity-40' : ''}`}>
      <Face note={note} dropping={isOver && !isDragging} flash={flash}>
        <div className="mt-2 flex items-center gap-1">
          {!note.hidden && (
            <button type="button" disabled={!brainstorming} aria-pressed={note.voted} aria-label={`Thumbs up, ${note.votes} so far`}
              onClick={() => onAct(() => api.post(`/retros/${note.board}/notes/${note.id}/vote`))}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold tabular-nums transition disabled:cursor-default ${note.voted ? 'bg-brand-50 text-brand-700' : 'text-slate-500 enabled:hover:bg-slate-100'}`}>
              <ThumbsUp size={14} /> {note.votes}
            </button>
          )}
          {note.mine && <span className="text-xs text-slate-400">Yours</span>}
          {merged && (
            <button type="button" aria-expanded={showOriginals} onClick={() => setShowOriginals((o) => !o)}
              className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100">
              {showOriginals ? <ChevronDown size={13} /> : <ChevronRight size={13} />} {note.originals.length} merged
            </button>
          )}
          <div className="ml-auto flex items-center gap-0.5">
            {canMerge && !note.hidden && <button type="button" className="btn-ghost p-1" aria-label="Merge with other tickets" title="Merge with other tickets" onClick={() => onPick(note.id)}><Merge size={13} /></button>}
            {canReword && <button type="button" className="btn-ghost p-1" aria-label={merged ? 'Reword the overview' : 'Reword your ticket'} onClick={() => setEditing(note.text)}><Pencil size={13} /></button>}
            {canDelete && <button type="button" className="btn-ghost p-1" aria-label="Delete ticket" onClick={remove}><Trash2 size={13} /></button>}
            {note.lesson_id
              ? <Link to="/lessons" className="chip" onClick={(e) => e.stopPropagation()}>{lessonNo({ id: note.lesson_id })}</Link>
              : stage === 'actions' && <button type="button" className="btn px-2 py-1 text-xs" onClick={() => onLesson(note)}>Make lesson</button>}
          </div>
        </div>
        {merged && showOriginals && <Originals note={note} laneNames={laneNames} canMerge={canMerge} onAct={onAct} />}
      </Face>
    </div>
  );
}

/** The last step of a merge: the tickets going in, and the overview that will stand for them. */
function MergePanel({ notes, onClose, onMerge }) {
  const already = notes.filter((n) => n.originals.length);
  // Joining a ticket that's already merged keeps its overview; otherwise start from everyone's words and trim.
  const [words, setWords] = useState(() => (already.length === 1 ? already[0].text : notes.map((n) => n.text).join('\n')).slice(0, 500));
  const parts = notes.flatMap((n) => (n.originals.length ? n.originals : [n]));
  const send = (e) => { e.preventDefault(); if (words.trim()) onMerge(words.trim()); };
  return (
    <SidePanel title="Merge tickets" subtitle="They become one ticket. The originals are kept and can be split back out." onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          <button type="button" className="btn ml-auto" onClick={onClose}>Cancel</button>
          <button type="submit" form="merge-form" className="btn-primary" disabled={!words.trim()}><Merge size={14} /> Merge {parts.length} tickets</button>
        </div>
      )}>
      <form id="merge-form" onSubmit={send} className="space-y-4">
        <label className="block">
          <span className="label">Overview</span>
          <textarea className="input text-sm" rows={5} maxLength={500} autoFocus value={words} onChange={(e) => setWords(e.target.value)} />
          <span className="mt-1 block text-xs text-slate-400">One clear point that covers them all. You can reword it later.</span>
        </label>
        <div>
          <span className="label">Tickets going in</span>
          <div className="space-y-1.5">
            {parts.map((o) => (
              <div key={o.id} className="rounded-md bg-slate-50 p-2">
                <p className="text-sm break-words whitespace-pre-wrap text-slate-700">{o.text}</p>
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400 tabular-nums"><ThumbsUp size={12} /> {o.votes}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">Thumbs carry over. Someone who thumbed more than one of these counts once.</p>
        </div>
      </form>
    </SidePanel>
  );
}

function Composer({ lane, boardId, onAct }) {
  const [words, setWords] = useState('');
  const post = () => {
    const t = words.trim();
    if (!t) return;
    setWords('');
    onAct(() => api.post(`/retros/${boardId}/notes`, { lane_id: lane.id, text: t }));
  };
  return (
    <div className="flex items-end gap-1">
      <textarea className="input text-sm" rows={2} maxLength={500} placeholder="Add a thought…" aria-label={`Add a ticket to ${lane.name}`}
        value={words} onChange={(e) => setWords(e.target.value)} onKeyDown={submitOnEnter(post)} />
      <button type="button" className="btn-primary p-2" aria-label="Post ticket" disabled={!words.trim()} onClick={post}><Plus size={16} /></button>
    </div>
  );
}

/** The ticket in a lane that a held ticket would land above, going by the pointer. Null is the end of the lane. */
function landsBefore(laneId, heldId) {
  const next = [...document.querySelectorAll(`[data-lane="${laneId}"] [data-note]`)].find((el) => {
    const box = el.getBoundingClientRect();
    return Number(el.dataset.note) !== heldId && pointer && pointer.y < box.top + box.height / 2;
  });
  return next ? Number(next.dataset.note) : null;
}

const LandsHere = () => <div className="-my-1 h-0.5 rounded-full bg-brand-500" aria-hidden="true" />;

function Lane({ lane, notes, board, isLead, canMerge, canArrange, picking, laneNames, landing, flashing, onPick, onAct, onLesson }) {
  const brainstorming = board.stage === 'brainstorm';
  const { setNodeRef, isOver } = useDroppable({ id: lane.id, disabled: !canArrange });
  const [naming, setNaming] = useState(null);

  const rename = () => {
    const name = naming.trim();
    if (name && name !== lane.name) onAct(() => api.put(`/retros/${board.id}/lanes/${lane.id}`, { name }));
    setNaming(null);
  };
  const remove = () => {
    const msg = notes.length ? `Delete “${lane.name}” and its ${notes.length} ticket${notes.length === 1 ? '' : 's'}? Lessons already made stay.` : `Delete “${lane.name}”?`;
    if (confirm(msg)) onAct(() => api.del(`/retros/${board.id}/lanes/${lane.id}`));
  };

  return (
    <section ref={setNodeRef} aria-label={lane.name} data-lane={lane.id}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl border border-t-4 border-slate-200 p-2.5 transition ${LEAN_STYLE[lane.lean] || 'border-t-slate-300'} ${isOver ? 'bg-brand-50' : 'bg-slate-50'}`}>
      <div className="flex items-center gap-1">
        {naming !== null ? (
          <input className="input py-1 text-sm" maxLength={60} autoFocus aria-label="Lane name" value={naming} onChange={(e) => setNaming(e.target.value)}
            onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') setNaming(null); }} />
        ) : (
          <>
            <h2 className="min-w-0 truncate text-sm font-semibold text-slate-800">{lane.name}</h2>
            <span className="text-xs text-slate-400 tabular-nums">{notes.length}</span>
            {isLead && board.stage !== 'closed' && (
              <div className="ml-auto flex">
                <button type="button" className="btn-ghost p-1" aria-label={`Rename ${lane.name}`} onClick={() => setNaming(lane.name)}><Pencil size={13} /></button>
                <button type="button" className="btn-ghost p-1" aria-label={`Delete ${lane.name}`} onClick={remove}><Trash2 size={13} /></button>
              </div>
            )}
          </>
        )}
      </div>
      {brainstorming && <Composer lane={lane} boardId={board.id} onAct={onAct} />}
      {notes.map((n) => (
        <Fragment key={n.id}>
          {landing && landing.before === n.id && <LandsHere />}
          <Ticket note={{ ...n, board: board.id }} stage={board.stage} isLead={isLead} canMove={(canArrange || canMerge) && !n.hidden}
            canMerge={canMerge} picking={picking} laneNames={laneNames} flash={flashing.has(n.id)} onPick={onPick} onAct={onAct} onLesson={onLesson} />
        </Fragment>
      ))}
      {landing && landing.before === null && notes.length > 0 && <LandsHere />}
      {!notes.length && !brainstorming && <p className="py-3 text-center text-xs text-slate-400">No tickets</p>}
    </section>
  );
}

function AddLane({ onAdd }) {
  const [name, setName] = useState('');
  const add = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
  };
  return (
    <form onSubmit={add} className="flex w-56 shrink-0 items-center gap-1 rounded-xl border border-dashed border-slate-300 p-2.5">
      <input className="input py-1 text-sm" maxLength={60} placeholder="New lane…" aria-label="New lane name" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn-ghost p-1.5" aria-label="Add lane" disabled={!name.trim()}><Plus size={16} /></button>
    </form>
  );
}

/** What a ticket starts out as on the Lessons Learned form. */
function lessonDefaults(note, lane, board) {
  const long = note.text.length > 160;
  // Context starts with everything written on the ticket: its words, and under a merged ticket's overview each original.
  const notes = note.originals.length ? `${note.text}\n\n${note.originals.map((o) => `- ${o.text}`).join('\n')}` : note.text;
  return {
    title: long ? note.text.slice(0, 160) : note.text,
    context: notes,
    kind: lane?.lean || null,
    action: lane?.lean === 'bad' ? 'change' : lane?.lean === 'good' ? 'continue' : null,
    retro_date: board.retro_date,
  };
}

/**
 * One retro. Brainstorm: post, thumbs up and move tickets. Actions: the board freezes and each ticket worth keeping
 * goes through the Lessons Learned form. Closed: read-only.
 */
export default function RetroBoard() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [gone, setGone] = useState(false);
  const [topFirst, setTopFirst] = useState(null); // null until chosen; then it follows the stage
  const [dragId, setDragId] = useState(null);
  const [zoom, setZoom] = useState(savedZoom);
  const changeZoom = (z) => {
    setZoom(z);
    try { localStorage.setItem(ZOOM_KEY, String(z)); } catch { /* it just won't be remembered */ }
  };
  const [flashing, setFlashing] = useState(() => new Set()); // tickets that just moved, here or on someone else's screen
  const lastNotes = useRef(null);
  useEffect(() => {
    const before = lastNotes.current;
    lastNotes.current = data?.notes || null;
    const moved = before && data ? movedTickets(before, data.notes) : [];
    if (!moved.length) return undefined;
    setFlashing((f) => new Set([...f, ...moved]));
    const t = setTimeout(() => setFlashing((f) => new Set([...f].filter((x) => !moved.includes(x)))), FLASH_MS);
    return () => clearTimeout(t);
  }, [data]);
  const [landing, setLanding] = useState(null); // { lane, before }: where the held ticket would land, while arranging by hand
  const [details, setDetails] = useState(null); // the templates, once open
  const [lesson, setLesson] = useState(null); // { note, tags }
  const [picking, setPicking] = useState(null); // ids of the tickets picked to merge, while picking
  const [merging, setMerging] = useState(false); // the merge panel is open
  const dragging = useRef(false);
  const changes = useRef(0); // a poll that started before a change has old news, so it's dropped

  const load = useCallback(() => {
    const started = changes.current;
    return api.get(`/retros/${id}`, { quiet: true }).then((d) => {
      if (started === changes.current && !dragging.current) { setData(d); setError(''); }
    }).catch((e) => { if (e.status === 404) setGone(true); else setError(e.message); });
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    const back = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [load]);

  /** Runs a change; every board route answers with the board, so that replaces what's on screen. */
  const act = useCallback(async (fn) => {
    changes.current += 1;
    const mine = changes.current;
    setError('');
    try {
      const d = await fn();
      if (mine === changes.current) setData(d);
    } catch (e) {
      setError(e.message);
      load();
    }
  }, [load]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  /** While a ticket is held over a lane, marks the place it would land. */
  const onDragMove = ({ active, over }) => {
    const next = over && !isTicketDrop(over.id) ? { lane: over.id, before: landsBefore(over.id, active.id) } : null;
    setLanding((was) => (was?.lane === next?.lane && was?.before === next?.before ? was : next));
  };
  const onDragEnd = ({ active, over }) => {
    dragging.current = false;
    setDragId(null);
    setLanding(null);
    const note = data.notes.find((n) => n.id === active.id);
    if (!over || !note) return;
    if (isTicketDrop(over.id)) {
      // Dropped on another ticket: the two merge where that one sits. A merged ticket keeps its overview; two plain
      // tickets start with both their words, to be reworded.
      const onto = data.notes.find((n) => dropId(n.id) === over.id);
      if (!onto || onto.id === note.id) return;
      const words = onto.originals.length ? onto.text : note.originals.length ? note.text : `${onto.text}\n${note.text}`.slice(0, 500);
      act(() => api.post(`/retros/${id}/merge`, { note_ids: [onto.id, note.id], text: words }));
      return;
    }
    // Dropped on a lane: it lands above the ticket the pointer is over the top half of, or at the end.
    const before = landsBefore(over.id, note.id);
    const rest = data.notes.filter((n) => n.id !== note.id);
    const at = before === null ? rest.length : rest.findIndex((n) => n.id === before);
    const notes = [...rest.slice(0, at), { ...note, lane_id: over.id }, ...rest.slice(at)];
    const inLaneNow = (list) => list.filter((n) => n.lane_id === over.id).map((n) => n.id).join();
    if (note.lane_id === over.id && inLaneNow(notes) === inLaneNow(data.notes)) return; // back where it was
    setData((d) => ({ ...d, notes }));
    act(() => api.put(`/retros/${id}/notes/${note.id}`, { lane_id: over.id, before_id: before }));
  };

  const pick = (noteId) => setPicking((p) => (!p ? [noteId] : p.includes(noteId) ? p.filter((x) => x !== noteId) : [...p, noteId]));
  const stopPicking = () => { setPicking(null); setMerging(false); };
  useEffect(() => {
    if (!picking || merging) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setPicking(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [picking, merging]);

  const openDetails = () => api.get('/retros').then((d) => setDetails(d.templates)).catch((e) => setError(e.message));
  const openLesson = (note) => api.get('/lessons').then((d) => setLesson({ note, tags: d.tags })).catch((e) => setError(e.message));

  if (gone) {
    return (
      <div className="space-y-3 p-8">
        <p className="text-slate-600">This retro has been deleted.</p>
        <Link to="/retros" className="btn">Back to retrospectives</Link>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-sm text-slate-400">{error || 'Loading retro…'}</div>;

  const { board, lanes, notes, is_lead: isLead, can_merge: canMerge, can_arrange: canArrange } = data;
  const laneNames = Object.fromEntries(lanes.map((l) => [l.id, l.name]));
  const picked = canMerge && picking ? notes.filter((n) => picking.includes(n.id) && !n.hidden) : null; // in the order they sit on the board
  const sortTop = topFirst ?? board.stage !== 'brainstorm';
  const inLane = (lane) => {
    const list = notes.filter((n) => n.lane_id === lane.id);
    return sortTop ? [...list].sort((a, b) => b.votes - a.votes) : list; // ties stay as arranged
  };
  const stageTo = (stage) => act(() => api.put(`/retros/${id}`, { stage }));
  const hiddenCount = notes.filter((n) => n.hidden).length;
  const sent = notes.filter((n) => n.lesson_id).length;
  const held = dragId && notes.find((n) => n.id === dragId);

  return (
    <div className="space-y-4 p-8">
      <div>
        <Link to="/retros" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14} /> Retrospectives</Link>
      </div>
      <PageHeader title={board.name}
        subtitle={`${shortDate(board.retro_date, { month: 'short', day: 'numeric', year: 'numeric' })} · Led by ${board.lead || 'a former user'} · ${STAGE_NAMES[board.stage]} · Tickets are anonymous`}>
        <Zoom zoom={zoom} onZoom={changeZoom} />
        <button className="btn" aria-pressed={sortTop} onClick={() => setTopFirst(!sortTop)}>
          <ThumbsUp size={14} /> {sortTop ? 'Most thumbs first' : 'As arranged'}
        </button>
        {isLead && (
          <>
            {board.hide_notes ? <button className="btn" onClick={() => act(() => api.put(`/retros/${id}`, { reveal: true }))}><Eye size={14} /> Reveal tickets</button> : null}
            {board.stage !== 'closed' && <TimerMenu boardId={id} onAct={act} />}
            <button className="btn" onClick={openDetails}><Settings2 size={14} /> Details</button>
            {BACK[board.stage] && <button className="btn" onClick={() => stageTo(BACK[board.stage])}>{BACK_LABEL[board.stage]}</button>}
            {NEXT[board.stage] && <button className="btn-primary" onClick={() => stageTo(NEXT[board.stage])}>{NEXT_LABEL[board.stage]} <ArrowRight size={14} /></button>}
          </>
        )}
      </PageHeader>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {board.timer && <Countdown timer={board.timer} isLead={isLead} boardId={id} onAct={act} />}
      {!!board.hide_notes && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Tickets are hidden. {hiddenCount} from others so far. Write yours; the lead reveals them when everyone’s done.</p>}
      {picked && (
        <div className="sticky top-2 z-10 flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-white shadow-lg">
          <Merge size={16} className="text-slate-400" />
          <span>Pick the tickets to merge. {picked.length} picked.</span>
          <button type="button" className="btn ml-auto border-white/30 bg-transparent px-2 py-1 text-xs text-white hover:bg-white/10" onClick={stopPicking}>Cancel</button>
          <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={picked.length < 2} onClick={() => setMerging(true)}>Merge</button>
        </div>
      )}
      {board.stage === 'actions' && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Brainstorming is over. Work down the top tickets and turn each one worth keeping into a lesson: {sent} of {notes.length} done.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={collide}
        onDragStart={({ active }) => { dragging.current = true; setDragId(active.id); }} onDragMove={onDragMove} onDragEnd={onDragEnd}
        onDragCancel={() => { dragging.current = false; setDragId(null); setLanding(null); }}>
        <style>{'@keyframes retroflash{0%,35%{background-color:#fde68a;box-shadow:0 0 0 3px #f59e0b}100%{background-color:#fff;box-shadow:0 0 0 0 transparent}}'}</style>
        <div className="flex items-start gap-3 overflow-x-auto pb-4" style={{ zoom: zoom / 100 }}>
          {lanes.map((l) => <Lane key={l.id} lane={l} notes={inLane(l)} board={board} isLead={isLead}
            canMerge={canMerge} canArrange={canArrange} picking={picked && picking} laneNames={laneNames} landing={landing?.lane === l.id ? landing : null} flashing={flashing} onPick={pick} onAct={act} onLesson={openLesson} />)}
          {isLead && board.stage !== 'closed' && <AddLane onAdd={(name) => act(() => api.post(`/retros/${id}/lanes`, { name }))} />}
          {!lanes.length && !isLead && <p className="py-10 text-sm text-slate-400">The lead hasn’t added any lanes yet.</p>}
        </div>
        <DragOverlay>{held && <div style={{ zoom: zoom / 100 }}><Face note={held} overlay /></div>}</DragOverlay>
      </DndContext>

      {details && (
        <RetroPanel board={board} templates={details} onClose={() => setDetails(null)}
          onSaved={(d) => { setData(d); setDetails(null); }} onDeleted={() => setGone(true)} />
      )}
      {merging && picked?.length >= 2 && (
        <MergePanel notes={picked} onClose={() => setMerging(false)}
          onMerge={(words) => { stopPicking(); act(() => api.post(`/retros/${id}/merge`, { note_ids: picked.map((n) => n.id), text: words })); }} />
      )}
      {lesson && (
        <LessonPanel key={lesson.note.id} tags={lesson.tags}
          defaults={lessonDefaults(lesson.note, lanes.find((l) => l.id === lesson.note.lane_id), board)}
          source={{ source: 'retro', source_id: lesson.note.id }}
          subtitle={`From the retro “${board.name}”. Reword it into a clear next step.`}
          onTagsChanged={(tags) => setLesson((x) => ({ ...x, tags }))}
          onClose={() => setLesson(null)} onSaved={() => { setLesson(null); load(); }} />
      )}
    </div>
  );
}
