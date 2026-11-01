import { CheckSquare, ArrowUp, ArrowDown } from 'lucide-react';
import { fullName, initials, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';

/**
 * A priority or work card. Every card is the same height, laid out on fixed lines:
 * 1 master ticket title · 2–3 the priority text (blank line if short, … if long) ·
 * 4 organization · 5–6 pipeline status, value and due date. Blue or amber edges tell priority from work.
 */
export default function PriorityCard({ card, rank, usersById, overlay }) {
  const planned = !!card.is_planned;
  const done = card.checklist.filter((c) => c.done).length;
  const chip = 'h-5 rounded px-1.5 leading-5 whitespace-nowrap';
  // Moved up or down its ticket's activity list since the week's planning closed.
  const moved = card.locked_rank != null && card.rank != null && card.rank !== card.locked_rank;
  const up = moved && card.rank < card.locked_rank;
  return (
    <div className={`relative h-full cursor-pointer rounded-lg border border-l-4 p-3 text-sm shadow-sm transition hover:shadow-md ${
      planned ? 'border-slate-200 border-l-brand-600 bg-white' : 'border-amber-200 border-l-amber-500 bg-amber-50'
    } ${moved ? 'ring-2 ring-orange-400 ring-offset-1' : ''} ${card.completed ? 'opacity-60' : ''} ${overlay ? 'w-64 rotate-2 shadow-xl' : ''}`}>
      {moved && (
        <span className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm"
          title={`Moved on its ticket after planning closed: it was #${card.locked_rank} of the ticket’s activities and is now #${card.rank}${card.rank === 1 ? ', the next step' : ''}.`}>
          {up ? <ArrowUp size={10} strokeWidth={3} /> : <ArrowDown size={10} strokeWidth={3} />} Ticket #{card.locked_rank} → #{card.rank}
        </span>
      )}
      <div className="flex h-5 items-center justify-between gap-2">
        <div className={`truncate leading-5 font-semibold ${card.completed ? 'line-through' : ''}`} title={card.opportunity_title}>{card.opportunity_title}</div>
        {rank && <span className={`shrink-0 rounded px-1.5 text-xs font-bold ${planned ? 'bg-brand-50 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>#{rank}</span>}
      </div>
      <div className="mt-0.5 h-10 overflow-hidden">
        <p className="line-clamp-2 leading-5 break-words text-slate-700" title={card.title || undefined}>{card.title}</p>
      </div>
      <div className="h-5 truncate text-xs leading-5 text-slate-500" title={card.organization || undefined}>{card.organization}</div>
      <div className="mt-1 flex h-[2.875rem] flex-wrap content-start items-center gap-1.5 overflow-hidden text-xs">
        {card.pipeline_status && <span className={`${chip} bg-slate-100 text-slate-600`}>{card.pipeline_status}</span>}
        {card.value != null && <span className={`${chip} bg-emerald-50 text-emerald-700`}>{usd(card.value).replace('.00', '')}</span>}
        {card.due_date && <span className={`${chip} bg-slate-100 text-slate-600`}>Due {shortDate(card.due_date)}</span>}
        {card.checklist.length > 0 && <span className="flex h-5 items-center gap-0.5 text-slate-500"><CheckSquare size={12} />{done}/{card.checklist.length}</span>}
        {card.assignees.length > 1 && (
          <span className="flex h-5 -space-x-1.5">
            {card.assignees.map((a) => (
              <span key={a.user_id} title={fullName(usersById[a.user_id])}
                className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-700 ring-2 ring-white">
                {initials(usersById[a.user_id])}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
