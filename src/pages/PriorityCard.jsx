import { CheckSquare } from 'lucide-react';
import { fullName, initials, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';

export default function PriorityCard({ card, rank, usersById, overlay }) {
  const planned = !!card.is_planned;
  const done = card.checklist.filter((c) => c.done).length;
  return (
    <div className={`h-full cursor-pointer rounded-lg border border-l-4 p-3 text-sm shadow-sm transition hover:shadow-md ${
      planned ? 'border-slate-200 border-l-brand-600 bg-white' : 'border-amber-200 border-l-amber-500 bg-amber-50'
    } ${card.completed ? 'opacity-60' : ''} ${overlay ? 'w-64 rotate-2 shadow-xl' : ''}`}>
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className={`font-semibold leading-snug ${card.completed ? 'line-through' : ''}`}>{card.opportunity_title}</div>
        {rank && <span className={`shrink-0 rounded px-1.5 text-xs font-bold ${planned ? 'bg-brand-50 text-brand-700' : 'bg-amber-100 text-amber-800'}`}>#{rank}</span>}
      </div>
      {card.title && <div className="mb-1 text-slate-700">{card.title}</div>}
      {card.organization && <div className="text-xs text-slate-500">{card.organization}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        {card.pipeline_status && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{card.pipeline_status}</span>}
        {card.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{usd(card.value).replace('.00', '')}</span>}
        {card.due_date && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Due {shortDate(card.due_date)}</span>}
        {card.checklist.length > 0 && <span className="flex items-center gap-0.5 text-slate-500"><CheckSquare size={12} />{done}/{card.checklist.length}</span>}
      </div>
      {card.assignees.length > 1 && (
        <div className="mt-2 flex -space-x-1.5">
          {card.assignees.map((a) => (
            <span key={a.user_id} title={fullName(usersById[a.user_id])}
              className="grid h-5 w-5 place-items-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-700 ring-2 ring-white">
              {initials(usersById[a.user_id])}
            </span>
          ))}
        </div>
      )}
      {!planned && <div className="mt-2 text-[10px] font-semibold tracking-wide text-amber-700 uppercase">Work</div>}
    </div>
  );
}
