import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable, pointerWithin } from '@dnd-kit/core';
import { ArrowLeft, ArrowRight, Check, EyeOff, Eye, Pencil, Plus, Settings2, ThumbsUp, Trash2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import { LessonPanel, lessonNo } from './LessonsLearned.jsx';
import { RetroPanel, STAGE_NAMES } from './Retros.jsx';

// How often a board picks up other people's changes while it's on screen.
const POLL_MS = 3000;
const NEXT = { brainstorm: 'actions', actions: 'closed' };
const NEXT_LABEL = { brainstorm: 'Start actions', actions: 'Close retro' };
const BACK = { actions: 'brainstorm', closed: 'actions' };
const BACK_LABEL = { actions: 'Back to brainstorm', closed: 'Reopen' };
const LEAN_STYLE = { good: 'border-t-emerald-400', bad: 'border-t-red-400' };

/** Enter sends, Shift+Enter starts a new line. */
const submitOnEnter = (send) => (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
};

/** A ticket's face. Its controls sit in `children`, so the drag overlay can show it without them. */
const Face = ({ note, overlay, children }) => (
  <div className={`rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm ${overlay ? 'rotate-1 shadow-lg' : ''}`}>
    {note.hidden
      ? <p className="flex items-center gap-1.5 text-sm text-slate-400"><EyeOff size={14} /> Hidden until the lead reveals</p>
      : <p className="text-sm break-words whitespace-pre-wrap text-slate-800">{note.text}</p>}
    {children}
  </div>
);

function Ticket({ note, stage, isLead, canMove, onAct, onLesson }) {
  const [editing, setEditing] = useState(null); // the words being edited
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: note.id, disabled: !canMove || editing !== null });
  const brainstorming = stage === 'brainstorm';
  const canDelete = stage !== 'closed' && !note.hidden && (isLead || (note.mine && brainstorming));

  const save = () => {
    const words = editing.trim();
    if (words && words !== note.text) onAct(() => api.put(`/retros/${note.board}/notes/${note.id}`, { text: words }));
    setEditing(null);
  };
  const remove = () => {
    if (confirm('Delete this ticket?')) onAct(() => api.del(`/retros/${note.board}/notes/${note.id}`));
  };

  if (editing !== null) {
    return (
      <div className="rounded-lg border border-brand-300 bg-white p-2 shadow-sm">
        <textarea className="input text-sm" rows={3} maxLength={500} autoFocus aria-label="Reword your ticket" value={editing}
          onChange={(e) => setEditing(e.target.value)} onKeyDown={submitOnEnter(save)} />
        <div className="mt-1 flex justify-end gap-1">
          <button type="button" className="btn-ghost p-1" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
          <button type="button" className="btn-ghost p-1" aria-label="Save" onClick={save}><Check size={14} /></button>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={`${canMove ? 'cursor-grab touch-none' : ''} ${isDragging ? 'opacity-40' : ''}`}>
      <Face note={note}>
        <div className="mt-2 flex items-center gap-1">
          {!note.hidden && (
            <button type="button" disabled={!brainstorming} aria-pressed={note.voted} aria-label={`Thumbs up, ${note.votes} so far`}
              onClick={() => onAct(() => api.post(`/retros/${note.board}/notes/${note.id}/vote`))}
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold tabular-nums transition disabled:cursor-default ${note.voted ? 'bg-brand-50 text-brand-700' : 'text-slate-500 enabled:hover:bg-slate-100'}`}>
              <ThumbsUp size={14} /> {note.votes}
            </button>
          )}
          {note.mine && <span className="text-xs text-slate-400">Yours</span>}
          <div className="ml-auto flex items-center gap-0.5">
            {note.mine && brainstorming && <button type="button" className="btn-ghost p-1" aria-label="Reword your ticket" onClick={() => setEditing(note.text)}><Pencil size={13} /></button>}
            {canDelete && <button type="button" className="btn-ghost p-1" aria-label="Delete ticket" onClick={remove}><Trash2 size={13} /></button>}
            {note.lesson_id
              ? <Link to="/lessons" className="chip" onClick={(e) => e.stopPropagation()}>{lessonNo({ id: note.lesson_id })}</Link>
              : stage === 'actions' && <button type="button" className="btn px-2 py-1 text-xs" onClick={() => onLesson(note)}>Make lesson</button>}
          </div>
        </div>
      </Face>
    </div>
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

function Lane({ lane, notes, board, isLead, onAct, onLesson }) {
  const brainstorming = board.stage === 'brainstorm';
  const { setNodeRef, isOver } = useDroppable({ id: lane.id, disabled: !brainstorming });
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
    <section ref={setNodeRef} aria-label={lane.name}
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
        <Ticket key={n.id} note={{ ...n, board: board.id }} stage={board.stage} isLead={isLead} canMove={brainstorming && !n.hidden} onAct={onAct} onLesson={onLesson} />
      ))}
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
  return {
    title: long ? note.text.slice(0, 160) : note.text,
    context: long ? note.text : '',
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
  const [details, setDetails] = useState(null); // the templates, once open
  const [lesson, setLesson] = useState(null); // { note, tags, stages }
  const dragging = useRef(false);
  const changes = useRef(0); // a poll that started before a change has old news, so it's dropped

  const load = useCallback(() => {
    const started = changes.current;
    return api.get(`/retros/${id}`).then((d) => {
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
  const onDragEnd = ({ active, over }) => {
    dragging.current = false;
    setDragId(null);
    const note = data.notes.find((n) => n.id === active.id);
    if (!over || !note || note.lane_id === over.id) return;
    setData((d) => ({ ...d, notes: d.notes.map((n) => (n.id === note.id ? { ...n, lane_id: over.id } : n)) }));
    act(() => api.put(`/retros/${id}/notes/${note.id}`, { lane_id: over.id }));
  };

  const openDetails = () => api.get('/retros').then((d) => setDetails(d.templates)).catch((e) => setError(e.message));
  const openLesson = (note) => api.get('/lessons').then((d) => setLesson({ note, tags: d.tags, stages: d.stages })).catch((e) => setError(e.message));

  if (gone) {
    return (
      <div className="space-y-3 p-8">
        <p className="text-slate-600">This retro has been deleted.</p>
        <Link to="/retros" className="btn">Back to retrospectives</Link>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-sm text-slate-400">{error || 'Loading retro…'}</div>;

  const { board, lanes, notes, is_lead: isLead } = data;
  const sortTop = topFirst ?? board.stage !== 'brainstorm';
  const inLane = (lane) => {
    const list = notes.filter((n) => n.lane_id === lane.id);
    return sortTop ? [...list].sort((a, b) => b.votes - a.votes || a.id - b.id) : list;
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
        <button className="btn" aria-pressed={sortTop} onClick={() => setTopFirst(!sortTop)}>
          <ThumbsUp size={14} /> {sortTop ? 'Most thumbs first' : 'As posted'}
        </button>
        {isLead && (
          <>
            {board.hide_notes ? <button className="btn" onClick={() => act(() => api.put(`/retros/${id}`, { reveal: true }))}><Eye size={14} /> Reveal tickets</button> : null}
            <button className="btn" onClick={openDetails}><Settings2 size={14} /> Details</button>
            {BACK[board.stage] && <button className="btn" onClick={() => stageTo(BACK[board.stage])}>{BACK_LABEL[board.stage]}</button>}
            {NEXT[board.stage] && <button className="btn-primary" onClick={() => stageTo(NEXT[board.stage])}>{NEXT_LABEL[board.stage]} <ArrowRight size={14} /></button>}
          </>
        )}
      </PageHeader>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!!board.hide_notes && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Tickets are hidden. {hiddenCount} from others so far. Write yours; the lead reveals them when everyone’s done.</p>}
      {board.stage === 'actions' && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Brainstorming is over. Work down the top tickets and turn each one worth keeping into a lesson: {sent} of {notes.length} done.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={pointerWithin}
        onDragStart={({ active }) => { dragging.current = true; setDragId(active.id); }} onDragEnd={onDragEnd}
        onDragCancel={() => { dragging.current = false; setDragId(null); }}>
        <div className="flex items-start gap-3 overflow-x-auto pb-4">
          {lanes.map((l) => <Lane key={l.id} lane={l} notes={inLane(l)} board={board} isLead={isLead} onAct={act} onLesson={openLesson} />)}
          {isLead && board.stage !== 'closed' && <AddLane onAdd={(name) => act(() => api.post(`/retros/${id}/lanes`, { name }))} />}
          {!lanes.length && !isLead && <p className="py-10 text-sm text-slate-400">The lead hasn’t added any lanes yet.</p>}
        </div>
        <DragOverlay>{held && <Face note={held} overlay />}</DragOverlay>
      </DndContext>

      {details && (
        <RetroPanel board={board} templates={details} onClose={() => setDetails(null)}
          onSaved={(d) => { setData(d); setDetails(null); }} onDeleted={() => setGone(true)} />
      )}
      {lesson && (
        <LessonPanel key={lesson.note.id} tags={lesson.tags} stages={lesson.stages}
          defaults={lessonDefaults(lesson.note, lanes.find((l) => l.id === lesson.note.lane_id), board)}
          source={{ source: 'retro', source_id: lesson.note.id }}
          subtitle={`From the retro “${board.name}”. Reword it into a clear next step.`}
          onTagsChanged={(tags) => setLesson((x) => ({ ...x, tags }))}
          onClose={() => setLesson(null)} onSaved={() => { setLesson(null); load(); }} />
      )}
    </div>
  );
}
