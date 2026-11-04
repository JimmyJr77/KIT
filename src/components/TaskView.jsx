import { useState } from 'react';
import { ArrowLeftRight, Building2, CalendarClock, CalendarDays, Flag, LayoutList, Rows3, SquareCheck, Star, UsersRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApi } from '../lib/data.js';
import { todayIso } from '../lib/format.js';
import TicketTimeline from '../pages/TicketTimeline.jsx';
import { TYPE_ICONS, WaitingIcon, when } from '../pages/TicketActivities.jsx';
import { DataTable, StatTile } from './Charts.jsx';

const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const usePref = (key, initial) => {
  const [value, setValue] = useState(() => readPref(key, initial));
  return [value, (v) => { setValue(v); writePref(key, v); }];
};
const SECTION_ICONS = { week: CalendarDays, due: CalendarClock, strategic: Star, tier: Building2 };

/**
 * The Task view on Priorities. A team (or several members) gets its numbers by member; one member gets their tasks in
 * lanes by section, as rows or columns, laid out like the weekly board. Either can switch to all tasks by pipeline ticket.
 */
export default function TaskView({ members, teamSize, onPick }) {
  const [look, setLook] = usePref('kit.priorities.tasks.look', 'breakdown'); // breakdown | all
  const [done, setDone] = usePref('kit.priorities.tasks.done', '0');
  const [orientation, setOrientation] = usePref('kit.priorities.tasks.orientation', 'rows');
  const showDone = done === '1';
  const member = members.length === 1 ? members[0] : null;
  const ids = members.map((m) => m.id).join(',');
  const qs = showDone ? '?done=1' : '';
  const url = !ids ? null : look === 'all' ? `/tasks?users=${ids}${showDone ? '&done=1' : ''}` : member ? `/tasks/member/${member.id}${qs}` : `/tasks/summary?users=${ids}`;
  const { data, error, reload } = useApi(url);
  const [opened, setOpened] = useState(null); // { ticket, activity }, no activity for the ticket itself
  const [busy, setBusy] = useState(false);
  const run = async (p) => { setBusy(true); try { await p; await reload(); } finally { setBusy(false); } };
  const onOpen = (t, a) => setOpened({ ticket: t, activity: a });
  const showing = (key) => (look === 'all' ? key === 'tickets' : member ? key === 'sections' : key === 'summary');
  const button = 'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm';

  if (!members.length) return <p className="py-16 text-center text-slate-400">No members on this team yet.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Show tasks">
          {[['breakdown', member ? 'By section' : 'Team summary', member ? Rows3 : UsersRound], ['all', 'All open tasks', LayoutList]].map(([k, label, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={look === k} onClick={() => setLook(k)}
              className={`${button} ${look === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {member && teamSize > 1 && <button type="button" className="btn" onClick={() => onPick(null)}><UsersRound size={15} /> Back to the team</button>}
        {!showing('summary') && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={showDone} onChange={(e) => setDone(e.target.checked ? '1' : '0')} /> Show completed tasks
          </label>
        )}
        {showing('sections') && (
          <button type="button" className="btn ml-auto" onClick={() => setOrientation(orientation === 'rows' ? 'columns' : 'rows')}>
            <ArrowLeftRight size={15} /> {orientation === 'rows' ? 'Sections as columns' : 'Sections as rows'}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error.message || String(error)}</p>}
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          {showing('summary') && data.members && <TeamSummary data={data} onPick={onPick} />}
          {showing('sections') && data.sections && <SectionLanes sections={data.sections} orientation={orientation} busy={busy} run={run} onOpen={onOpen} />}
          {showing('tickets') && data.tickets && <ByTicket tickets={data.tickets} showWho={!member} showDone={showDone} busy={busy} run={run} onOpen={onOpen} />}
        </>
      )}
      {opened && <TicketTimeline key={`${opened.ticket}-${opened.activity}`} ticketId={opened.ticket} activityId={opened.activity} onClose={() => setOpened(null)} onChanged={reload} />}
    </div>
  );
}

// ---- A team's numbers

function TeamSummary({ data: { members, totals: t }, onPick }) {
  const n = (v) => v || <span className="text-slate-300">0</span>;
  const pair = (done, open) => (done + open ? `${done} of ${done + open}` : <span className="text-slate-300">0</span>);
  const columns = [
    { key: 'name', label: 'Member', format: (v, m) => <button type="button" className="font-medium whitespace-nowrap text-brand-700 hover:underline" onClick={() => onPick(m.id)}>{v}</button> },
    { key: 'open', label: 'Open', align: 'right', format: n },
    { key: 'overdue', label: 'Overdue', align: 'right', format: (v) => (v ? <span className="font-medium text-red-600">{v}</span> : n(v)) },
    { key: 'dueSoon', label: 'Due in 7 days', align: 'right', format: n },
    { key: 'undated', label: 'No date', align: 'right', format: n },
    { key: 'weekOpen', label: 'Priorities closed', align: 'right', format: (v, m) => pair(m.weekDone, v) },
    { key: 'strategic', label: 'Priority tickets', align: 'right', format: n },
    { key: 'tiered', label: 'In tiers', align: 'right', format: n },
    { key: 'subOpen', label: 'Subtasks done', align: 'right', format: (v, m) => pair(m.subDone, v) },
    { key: 'done7', label: 'Done, 7 days', align: 'right', format: n },
    { key: 'done30', label: 'Done, 30 days', align: 'right', format: n },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]">
        <StatTile label="Open tasks" value={t.open} sub={[`${t.overdue} overdue`, `${t.dueSoon} due in 7 days`].join(' · ')} />
        <StatTile label="Priorities closed this week" value={`${t.weekDone} of ${t.weekDone + t.weekOpen}`} />
        <StatTile label="Completed" value={t.done7} sub={`Last 7 days · ${t.done30} in 30 days`} />
        <StatTile label="On strategic tickets" value={t.strategic} sub={`${t.tiered} on tiered tickets`} />
        <StatTile label="Subtasks done" value={`${t.subDone} of ${t.subDone + t.subOpen}`} />
        <StatTile label="Waiting on client" value={t.waiting} />
      </div>
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-800">By team member</h3>
        <p className="mb-2 text-xs text-slate-500">Choose someone for their full task list.</p>
        <DataTable columns={columns} rows={members} />
      </section>
    </div>
  );
}

// ---- One member's sections

function SectionLanes({ sections, orientation, busy, run, onOpen }) {
  const rows = orientation === 'rows';
  return (
    <div className={rows ? 'inline-flex min-w-full flex-col gap-3' : 'flex items-start gap-4'}>
      {sections.map((s) => {
        const Icon = SECTION_ICONS[s.kind];
        const open = s.tasks.filter((a) => !a.done).length;
        const done = s.tasks.length - open;
        return (
          <section key={s.key} aria-label={s.title} className={`rounded-xl border border-slate-200 bg-white shadow-sm ${rows ? 'flex' : 'w-72 shrink-0'}`}>
            <header className={`flex items-center gap-2.5 ${rows ? 'sticky left-0 z-10 w-52 shrink-0 self-stretch rounded-l-xl border-r border-slate-200 bg-white px-4 py-3' : 'border-b border-slate-200 px-4 py-3'}`}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-brand-700"><Icon size={15} /></span>
              <div className="min-w-0">
                <h3 className="text-sm leading-5 font-semibold">{s.title}</h3>
                <p className="text-xs text-slate-500">{open} open{done > 0 && ` · ${done} completed`}</p>
              </div>
            </header>
            <div className={`flex gap-3 p-3 ${rows ? 'min-h-32 flex-1 items-stretch' : 'min-h-40 flex-col'}`}>
              {s.tasks.map((a, i) => <TaskCard key={a.id} a={a} rank={i + 1} rows={rows} busy={busy} run={run} onOpen={onOpen} />)}
              {!s.tasks.length && <p className="self-center px-2 text-sm text-slate-400">{s.empty}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** One task on a lane, in the weekly board's card style: its ticket, the task, and its subtasks. */
function TaskCard({ a, rank, rows, busy, run, onOpen }) {
  const Icon = TYPE_ICONS[a.activity_type] || SquareCheck;
  const late = !a.done && a.due_date && a.due_date < todayIso();
  const chip = 'rounded px-1.5 text-[11px] whitespace-nowrap';
  return (
    <article className={`rounded-lg border border-l-4 border-slate-200 border-l-brand-600 bg-white p-3 text-sm shadow-sm transition hover:shadow-md ${rows ? 'w-64 shrink-0' : ''} ${a.done ? 'opacity-60' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => onOpen(a.ticket_id)} title={a.ticket} className={`min-w-0 truncate text-left font-semibold hover:text-brand-700 ${a.done ? 'line-through' : ''}`}>{a.ticket}</button>
        <span className="shrink-0 rounded bg-brand-50 px-1.5 text-xs font-bold text-brand-700">#{rank}</span>
      </div>
      <TaskLine a={a} Icon={Icon} late={late} busy={busy} run={run} onOpen={() => onOpen(a.ticket_id, a.id)} />
      {a.organization && <div className="mt-1 truncate text-xs text-slate-500" title={a.organization}>{a.organization}</div>}
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {a.next && !a.done && <span className={`${chip} bg-brand-600 font-semibold text-white`}>Next step</span>}
        {a.stage && <span className={`${chip} bg-slate-100 text-slate-600`}>{a.stage}</span>}
      </div>
      <Subtasks a={a} busy={busy} run={run} />
    </article>
  );
}

function TaskLine({ a, Icon, late, busy, run, onOpen, showWho }) {
  return (
    <div className="mt-1 flex items-start gap-2">
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" checked={a.done} disabled={busy}
        onChange={() => run(api.put(`/activities/${a.id}`, { done: !a.done }))} aria-label={`Mark “${a.subject}” ${a.done ? 'not done' : 'done'}`} />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-start gap-1.5">
          <Icon size={13} className="mt-1 shrink-0 text-slate-500" aria-label={a.activity_type} />
          <span className={`min-w-0 text-sm leading-5 break-words hover:text-brand-700 ${a.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{a.subject}</span>
          {a.flagged && <Flag size={11} className="mt-1 shrink-0 fill-red-500 text-red-500" aria-label="Flagged" />}
          {a.waiting_client && !a.done && <WaitingIcon size={12} className="mt-0.5" />}
        </span>
        <span className={`block text-[11px] ${late ? 'font-medium text-red-600' : 'text-slate-500'}`}>{[when(a) || 'No date', late && 'overdue', showWho && a.who].filter(Boolean).join(' · ')}</span>
      </button>
    </div>
  );
}

function Subtasks({ a, busy, run }) {
  if (!a.subtasks.length) return null;
  return (
    <ul className="mt-1 ml-6 space-y-0.5 border-l-2 border-slate-100 pl-2">
      {a.subtasks.map((s) => (
        <li key={s.id} className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-brand-600" checked={s.done} disabled={busy}
            onChange={() => run(api.put(`/activities/subtasks/${s.id}`, { done: !s.done }))} aria-label={`Mark “${s.text}” ${s.done ? 'not done' : 'done'}`} />
          <span className={`min-w-0 text-xs ${s.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{s.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ---- All tasks by pipeline ticket

function ByTicket({ tickets, showWho, showDone, busy, run, onOpen }) {
  const all = tickets.flatMap((t) => t.tasks);
  const open = all.filter((a) => !a.done).length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">{open} open{showDone ? `, ${all.length - open} completed` : ''} on {tickets.length} ticket{tickets.length === 1 ? '' : 's'}</p>
      {!tickets.length ? <p className="py-16 text-center text-slate-400">{showDone ? 'No tasks on live pipeline tickets.' : 'No open tasks.'}</p> : (
        <div className="grid items-start gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {tickets.map((t) => (
            <article key={t.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <button type="button" onClick={() => onOpen(t.id)} className="block w-full min-w-0 truncate text-left text-sm font-semibold text-slate-800 hover:text-brand-700">{t.title}</button>
              {(t.organization || t.stage) && <p className="mb-1 truncate text-[11px] text-slate-500">{[t.organization, t.stage].filter(Boolean).join(' · ')}</p>}
              <ul className="space-y-1.5">
                {t.tasks.map((a) => (
                  <li key={a.id}>
                    <TaskLine a={a} Icon={TYPE_ICONS[a.activity_type] || SquareCheck} late={!a.done && a.due_date && a.due_date < todayIso()} showWho={showWho}
                      busy={busy} run={run} onOpen={() => onOpen(t.id, a.id)} />
                    <Subtasks a={a} busy={busy} run={run} />
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
