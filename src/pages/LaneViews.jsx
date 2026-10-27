import { Package, CheckSquare, Plus, MessageSquare, StickyNote, FileText, CheckCircle2, Footprints, Workflow } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import { MentionText } from '../components/MentionTextarea.jsx';
import { ago, fullName, fullStamp } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PriorityCard from './PriorityCard.jsx';

/** Small text glyphs for the views lucide has no icon for. */
const Glyph = ({ children }) => <span className="font-mono text-[10px] leading-none font-bold tracking-tighter">{children}</span>;

export const LANE_VIEWS = [
  { key: 'priorities', label: 'Priority order', icon: <Glyph>123</Glyph> },
  { key: 'tickets', label: 'Grouped by master ticket', icon: <Package size={15} /> },
  { key: 'tasks', label: 'Task list', icon: <CheckSquare size={15} /> },
  { key: 'threads', label: 'Questions & comments', icon: <Glyph>?!</Glyph> },
];

/** The thin strip of view icons between a member's name and their work. */
export function ViewSwitcher({ view, onChange, rows, counts = {} }) {
  return (
    <div role="tablist" aria-label="Lane view"
      className={`flex shrink-0 gap-1 bg-slate-50/80 p-1 ${rows ? 'w-9 flex-col self-stretch border-r border-slate-200' : 'flex-row border-b border-slate-200'}`}>
      {LANE_VIEWS.map((v) => {
        const on = view === v.key;
        return (
          <button key={v.key} type="button" role="tab" aria-selected={on} aria-label={v.label} title={v.label} onClick={() => onChange(v.key)}
            className={`relative grid h-7 w-7 place-items-center rounded-md transition ${on ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-brand-700 hover:shadow-sm'}`}>
            {v.icon}
            {counts[v.key] > 0 && !on && (
              <span className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-amber-500 px-0.5 text-[8px] font-bold text-white">
                {counts[v.key] > 9 ? '9+' : counts[v.key]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Group a lane's cards by master ticket. Groups are ordered by their highest priority
 * card (lowest rank), then alphabetically by ticket title when ranks tie.
 */
export function groupByTicket(cardIds, cardsById) {
  const groups = new Map();
  cardIds.forEach((id, i) => {
    const c = cardsById[id];
    if (!c) return;
    if (!groups.has(c.ticket_id)) {
      groups.set(c.ticket_id, { ticketId: c.ticket_id, title: c.opportunity_title, organization: c.organization, status: c.pipeline_status, value: c.value, best: Infinity, items: [] });
    }
    const g = groups.get(c.ticket_id);
    g.items.push({ card: c, rank: i + 1 });
    g.best = Math.min(g.best, i + 1);
  });
  return [...groups.values()].sort((a, b) => a.best - b.best || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function TicketHeader({ group, extra }) {
  return (
    <div className="mb-2 flex items-start gap-2 px-1">
      <Package size={15} className="mt-0.5 shrink-0 text-brand-600" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-slate-800" title={group.title}>{group.title}</div>
        <div className="truncate text-[11px] text-slate-500">
          {[group.organization, group.status, group.value != null ? usd(group.value).replace('.00', '') : null].filter(Boolean).join(' · ') || `Ticket #${group.ticketId}`}
        </div>
      </div>
      {extra}
    </div>
  );
}

const Empty = ({ children }) => <p className="self-center px-2 py-6 text-sm text-slate-400">{children}</p>;

/** All of the week's priorities, consolidated under their master tickets. */
export function TicketsView({ cardIds, cardsById, usersById, rows, onOpen }) {
  const groups = groupByTicket(cardIds, cardsById);
  if (!groups.length) return <Empty>No priorities this week.</Empty>;
  return groups.map((g) => (
    <section key={g.ticketId} className={`shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 ${rows ? '' : 'w-full'}`}>
      <TicketHeader group={g} extra={<span className="rounded bg-white px-1.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{g.items.length}</span>} />
      <div className={`flex gap-2 ${rows ? '' : 'flex-col'}`}>
        {g.items.map(({ card, rank }) => (
          <div key={card.id} className={rows ? 'w-60 shrink-0' : ''} onClick={() => onOpen(card)}>
            <PriorityCard card={card} rank={rank} usersById={usersById} />
          </div>
        ))}
      </div>
    </section>
  ));
}

/** Every task on the member's priorities: master ticket → priority → to do, then done. */
export function TasksView({ cardIds, cardsById, rows, editable, onToggle, onOpen }) {
  const groups = groupByTicket(cardIds, cardsById)
    .map((g) => ({ ...g, items: g.items.filter(({ card }) => card.checklist.length) }))
    .filter((g) => g.items.length);
  if (!groups.length) return <Empty>No tasks on this week’s priorities. Add checklist items to a priority to see them here.</Empty>;
  return groups.map((g) => {
    const all = g.items.flatMap(({ card }) => card.checklist);
    const done = all.filter((t) => t.done).length;
    return (
      <section key={g.ticketId} className={`shrink-0 rounded-lg border border-slate-200 bg-white p-2 ${rows ? 'w-80' : 'w-full'}`}>
        <TicketHeader group={g} extra={<span className="shrink-0 text-[11px] text-slate-500">{done}/{all.length} done</span>} />
        <div className="space-y-2">
          {g.items.map(({ card, rank }) => {
            // Keep each task's index in the stored list so toggling updates the right one.
            const tasks = card.checklist.map((t, index) => ({ ...t, index }));
            const todo = tasks.filter((t) => !t.done);
            const finished = tasks.filter((t) => t.done);
            return (
              <div key={card.id} className="rounded-md bg-slate-50 px-2 py-1.5">
                <button type="button" onClick={() => onOpen(card)} className="mb-1 flex w-full items-center gap-1.5 text-left text-xs font-semibold text-slate-700 hover:text-brand-700">
                  <span className="rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-700">#{rank}</span>
                  <span className="truncate">{card.title || 'Untitled priority'}</span>
                </button>
                {todo.length > 0 && <TaskList label="To do" tasks={todo} card={card} editable={editable} onToggle={onToggle} />}
                {finished.length > 0 && <TaskList label="Done" tasks={finished} card={card} editable={editable} onToggle={onToggle} done />}
              </div>
            );
          })}
        </div>
      </section>
    );
  });
}

function TaskList({ label, tasks, card, editable, onToggle, done }) {
  return (
    <div className="mt-1">
      <div className="px-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{label} · {tasks.length}</div>
      <ul>
        {tasks.map((t) => (
          <li key={`${t.index}-${t.text}`}>
            <label className={`flex items-start gap-2 rounded px-0.5 py-0.5 text-sm ${editable ? 'cursor-pointer hover:bg-white' : ''}`}>
              <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-600" checked={!!t.done} disabled={!editable}
                onChange={(e) => onToggle(card, t.index, e.target.checked)} />
              <span className={done ? 'text-slate-400 line-through' : 'text-slate-700'}>{t.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const KIND = {
  question: { label: 'Question', glyph: '?', chip: 'bg-amber-100 text-amber-800', ring: 'ring-amber-200' },
  comment: { label: 'Comment', glyph: '!', chip: 'bg-brand-100 text-brand-700', ring: 'ring-brand-100' },
};

/** Questions and comments others left on the member's priorities and master tickets, abridged. */
export function ThreadsView({ threads, rows, onOpenThread, onNew }) {
  return (
    <>
      {threads.map((m) => {
        return (
          <button key={m.id} type="button" onClick={() => onOpenThread(m)}
            className={`flex shrink-0 flex-col rounded-lg border border-slate-200 bg-white p-3 text-left text-sm shadow-sm transition hover:border-brand-500 hover:shadow-md ${rows ? 'w-64' : 'w-full'}`}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="flex min-w-0 items-center gap-1 truncate text-[11px] font-medium text-slate-600" title={m.ticket_title}>
                <Package size={11} className="shrink-0 text-brand-600" /> <span className="truncate">{m.ticket_title}</span>
              </span>
            </div>
            {m.card_title && <div className="-mt-1 mb-1 truncate text-[11px] text-slate-400" title={m.card_title}>Priority: {m.card_title}</div>}
            <p className="line-clamp-3 flex-1 text-slate-700"><MentionText text={m.body} /></p>
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
              <Avatar user={m.author} size="xs" />
              <span className="truncate">{fullName(m.author) || 'Unknown'}</span>
              <span title={fullStamp(m.created_at)}>· {ago(m.created_at)}</span>
              {m.reply_count > 0 && (
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-slate-500"><MessageSquare size={11} /> {m.reply_count}</span>
              )}
            </div>
          </button>
        );
      })}
      {!threads.length && <Empty>No questions or comments yet.</Empty>}
      {onNew && (
        <button type="button" onClick={onNew}
          className={`flex shrink-0 items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 text-sm text-slate-400 hover:border-brand-500 hover:text-brand-600 ${rows ? 'w-40' : 'py-3'}`}>
          <Plus size={16} /> Add a comment
        </button>
      )}
    </>
  );
}

/** What each kind of additional work looks like. */
export const WORK_KINDS = {
  note: { label: 'Note', icon: <StickyNote size={12} /> },
  file: { label: 'Document', icon: <FileText size={12} /> },
  question: { label: 'Question', icon: <Glyph>?</Glyph> },
  comment: { label: 'Comment', icon: <Glyph>!</Glyph> },
  reply: { label: 'Reply', icon: <MessageSquare size={12} /> },
  task: { label: 'Task completed', icon: <CheckSquare size={12} /> },
  completed: { label: 'Priority completed', icon: <CheckCircle2 size={12} /> },
  ticket: { label: 'New ticket', icon: <Package size={12} /> },
  step: { label: 'Next step', icon: <Footprints size={12} /> },
  process: { label: 'Process step', icon: <Workflow size={12} /> },
};

/** An action recorded while planning was closed, shown as a work ticket in the person's lane. */
export function WorkEntry({ entry, rows, onOpen }) {
  const k = WORK_KINDS[entry.kind] || { label: entry.kind, icon: null };
  return (
    <button type="button" onClick={() => onOpen(entry)} title={fullStamp(entry.created_at)}
      className={`flex shrink-0 flex-col rounded-lg border border-l-4 border-amber-200 border-l-amber-500 bg-amber-50 p-3 text-left text-sm shadow-sm transition hover:shadow-md ${rows ? 'w-56' : 'w-full'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
          {k.icon} {k.label}
        </span>
        <span className="shrink-0 text-[11px] text-amber-700/70">{ago(entry.created_at)}</span>
      </div>
      <div className="truncate font-semibold text-slate-800" title={entry.ticket_title}>{entry.ticket_title || 'Deleted ticket'}</div>
      {entry.card_title && <div className="truncate text-[11px] text-slate-500" title={entry.card_title}>Priority: {entry.card_title}</div>}
      {entry.summary && <p className="mt-1 line-clamp-2 text-xs text-slate-600">{entry.summary}</p>}
      <div className="mt-auto pt-2 text-[10px] font-semibold tracking-wide text-amber-700 uppercase">Additional work</div>
    </button>
  );
}
