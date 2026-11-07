import { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket, CalendarDays, Megaphone, ContactRound, MessageSquare, StickyNote, CalendarCheck, Mail, FileText, Download, Layers, Star, ChessPawn, Scale, Check, Flag, Pencil, Trophy, XCircle, ExternalLink, Loader2, Upload, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, stamp, fullStamp, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { CRITERIA } from '../lib/assessment.js';
import { REVIEW_AREAS, PHASES, milestoneOf } from '../lib/process.js';
import Avatar from './Avatar.jsx';
import { LabelList } from './Labels.jsx';
import { MentionText } from './MentionTextarea.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const longDate = (d) => shortDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
/** A date ("2026-03-04") or a timestamp, as the timeline shows it. */
const when = (at) => (!at ? '' : at.length > 10 ? stamp(at) : longDate(at));
const dateOf = (m) => m.step_date || (m.created_at || '').slice(0, 10);
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

const DECISION_STYLE = { Proceed: 'bg-emerald-100 text-emerald-800', Revise: 'bg-amber-100 text-amber-800', 'No-Bid': 'bg-red-100 text-red-800' };
/** The node on the spine, one tint per phase, plus the lead and strategy nodes. */
const NODE = {
  Lead: 'from-slate-100 via-slate-400 to-slate-600', Strategy: 'from-violet-100 via-violet-400 to-violet-700',
  'Qualify & Gate': 'from-brand-100 via-brand-500 to-brand-900', 'Plan Response': 'from-sky-100 via-sky-400 to-sky-700', Develop: 'from-amber-100 via-amber-400 to-amber-700',
  'Review & Approve': 'from-rose-100 via-rose-400 to-rose-700', 'Submit & Close': 'from-emerald-100 via-emerald-400 to-emerald-700',
};
const CHIP = {
  Lead: 'text-slate-500', Strategy: 'text-violet-700',
  'Qualify & Gate': 'text-brand-700', 'Plan Response': 'text-sky-700', Develop: 'text-amber-700', 'Review & Approve': 'text-rose-700', 'Submit & Close': 'text-emerald-700',
};

/**
 * The stops along the spine, left to right: how the lead came in, the strategy, then the shaping work and milestones in
 * the order they happened. Everything on the ticket between two milestones (by date) is one shaping stop, oldest on top;
 * a shaping stop appears only once something happened there, except the last, which is where the work is now.
 */
export function buildLanes(data) {
  const milestones = [...data.milestones].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : dateOf(a) > dateOf(b) ? 1 : a.id - b.id));
  // Documents uploaded to a milestone are shown on it, not among the shaping work.
  let rest = data.events.filter((e) => !(e.type === 'file' && e.file.step_id)).sort(byAt);
  const lanes = [{ kind: 'lead', key: 'lead' }, { kind: 'strategy', key: 'strategy' }];
  let prev = null;
  milestones.forEach((m) => {
    const d = dateOf(m);
    const before = rest.filter((e) => e.at.slice(0, 10) < d);
    rest = rest.filter((e) => !(e.at.slice(0, 10) < d));
    if (before.length) lanes.push({ kind: 'shaping', key: `shaping-${m.id}`, events: before, from: prev, to: m });
    lanes.push({ kind: 'milestone', key: `m-${m.id}`, milestone: m });
    prev = m;
  });
  lanes.push({ kind: 'shaping', key: 'shaping-now', events: rest, from: prev, to: null, current: true });
  return lanes;
}

/**
 * The Process view of one pipeline ticket: a spine across the upper quarter of the screen from lead to award, a node for each
 * stop, and that stop's content floating above and below the line. `onOpenTool(tool)` opens the ticket on one of its tools
 * (milestones, strategy, assessment…), wherever the view is shown; `reloadKey` makes it fetch again.
 */
export default function ProcessTimeline({ ticketId, reloadKey = 0, onOpenTool }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const load = () => api.get(`/tickets/${ticketId}/process-view`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setError(''); load(); }, [ticketId, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const lanes = useMemo(() => (data ? buildLanes(data) : []), [data]);

  // A plain mouse wheel moves along the spine, unless the pointer is over a stop's own content that can still scroll that way.
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const box = e.target.closest?.('[data-scrolls]');
    if (box && ((e.deltaY < 0 && box.scrollTop > 0) || (e.deltaY > 0 && box.scrollTop + box.clientHeight < box.scrollHeight - 1))) return;
    scroller.current.scrollLeft += e.deltaY;
  };
  const slide = (dir) => scroller.current?.scrollBy({ left: dir * Math.max(320, scroller.current.clientWidth * 0.6), behavior: 'smooth' });

  if (error) return <p className="m-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return <p className="m-6 flex items-center gap-2 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>;
  const t = data.ticket;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TicketStrip ticket={t} pwin={data.strategy.pwin} onOpenTool={onOpenTool} />
      <div className="relative min-h-0 flex-1 bg-[radial-gradient(ellipse_at_center,_#ffffff_0%,_#f8fafc_55%,_#eef2f7_100%)]">
        <div ref={scroller} onWheel={onWheel} className="h-full overflow-x-auto overflow-y-hidden outline-none" tabIndex={0} aria-label="Process timeline"
          onKeyDown={(e) => { if (e.key === 'ArrowRight') slide(1); if (e.key === 'ArrowLeft') slide(-1); }}>
          <div className="relative flex h-full min-w-max items-stretch px-20">
            {/* The spine: a bar with a lit top edge and a soft shadow beneath, so it reads as sitting above the page. It crosses a quarter of the way down, where each stop's node sits (a quarter of the space around the node row, plus half the row). */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[calc(25%+0.875rem)] h-2 -translate-y-1/2 rounded-full bg-gradient-to-b from-slate-200 via-slate-400 to-slate-500 shadow-[0_8px_18px_-6px_rgba(15,23,42,.5),inset_0_1px_0_rgba(255,255,255,.9)]" />
            {lanes.map((lane) => <Stop key={lane.key} lane={lane} data={data} onOpenTool={onOpenTool} onChanged={load} />)}
          </div>
        </div>
        <button type="button" onClick={() => slide(-1)} aria-label="Earlier" title="Earlier (←)"
          className="absolute top-[calc(25%+0.875rem)] left-3 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-500 shadow-md ring-1 ring-slate-200 backdrop-blur hover:text-brand-700"><ChevronLeft size={18} /></button>
        <button type="button" onClick={() => slide(1)} aria-label="Later" title="Later (→)"
          className="absolute top-[calc(25%+0.875rem)] right-3 z-20 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-500 shadow-md ring-1 ring-slate-200 backdrop-blur hover:text-brand-700"><ChevronRight size={18} /></button>
      </div>
    </div>
  );
}

/** The ticket at a glance, above the timeline. */
function TicketStrip({ ticket: t, pwin, onOpenTool }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-lg font-semibold text-slate-900">{t.opportunity_title}</h2>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <span className="rounded bg-brand-50 px-1.5 font-semibold text-brand-700">Pipeline Ticket #{t.id}</span>
          {t.organization && <span>{t.organization}</span>}
          {t.pipeline_name && <span className="rounded bg-slate-100 px-1.5">{t.pipeline_name}{t.pipeline_status ? ` · ${t.pipeline_status}` : ''}</span>}
          {!t.pipeline_name && t.pipeline_status && <span className="rounded bg-slate-100 px-1.5">{t.pipeline_status}</span>}
          {t.deal_status === 'won' && <span className="flex items-center gap-1 rounded bg-emerald-100 px-1.5 font-semibold text-emerald-800"><Trophy size={11} /> Won{t.won_at ? ` ${stamp(t.won_at)}` : ''}</span>}
          {t.deal_status === 'lost' && <span className="flex items-center gap-1 rounded bg-red-100 px-1.5 font-semibold text-red-800"><XCircle size={11} /> Lost{t.lost_reason ? ` · ${t.lost_reason}` : ''}</span>}
          {t.value != null && <span className="rounded bg-emerald-50 px-1.5 text-emerald-700">{money(t.value)}</span>}
          {pwin && <span className="rounded bg-brand-50 px-1.5 font-semibold text-brand-700" title={`PWIN: ${pwin.rated} of ${pwin.total} areas rated`}>PWIN {pwin.score}%</span>}
          {t.director && <span>BD director <span className="font-medium text-slate-800">{fullName(t.director)}</span></span>}
          {t.territory && <span>· {t.territory}</span>}
          {t.projected_win_date && <span>· Projected win {longDate(t.projected_win_date)}</span>}
          <LabelList labels={t.labels} />
        </div>
      </div>
      {onOpenTool && (
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => onOpenTool('process')}><Flag size={13} /> Add or edit milestones</button>
          <button type="button" className="btn px-2.5 py-1.5 text-xs" onClick={() => onOpenTool(null)}><ExternalLink size={13} /> Open ticket</button>
        </div>
      )}
    </div>
  );
}

// ---- A stop on the spine: its node on the line, the heading and key facts above, the detail below. No box around it.

/** "3 comments · 2 activities · 1 document": the work at a shaping stop. */
function workSummary(events) {
  const n = { comment: 0, activity: 0, file: 0, email: 0 };
  events.forEach((e) => { n[e.type] = (n[e.type] || 0) + 1; });
  const word = (k, one, many) => (n[k] ? `${n[k]} ${n[k] === 1 ? one : many}` : null);
  return [word('comment', 'comment', 'comments'), word('activity', 'activity', 'activities'), word('file', 'document', 'documents'), word('email', 'email', 'emails')].filter(Boolean).join(' · ') || 'Nothing yet';
}

function Stop({ lane, data, onOpenTool, onChanged }) {
  const m = lane.kind === 'milestone' ? lane.milestone : null;
  const phase = lane.kind === 'lead' ? 'Lead' : lane.kind === 'strategy' ? 'Strategy'
    : milestoneOf((m || lane.to || lane.from)?.step_type).phase || PHASES[0];
  const title = lane.kind === 'lead' ? 'Lead generated by' : lane.kind === 'strategy' ? 'Strategy' : m ? m.step_type : 'Shaping';
  const subtitle = lane.kind === 'lead' ? (data.ticket.director ? `${fullName(data.ticket.director)}${data.ticket.territory ? ` · ${data.ticket.territory}` : ''}` : 'No BD director')
    : lane.kind === 'strategy' ? 'Tier, priority and the plan to win'
    : m ? (m.step_date ? longDate(m.step_date) : `Added ${longDate(m.created_at.slice(0, 10))}, no date`)
    : lane.to ? `${lane.from ? `After ${lane.from.step_type}, ` : ''}before ${lane.to.step_type}` : lane.from ? `Since ${lane.from.step_type}` : 'Everything so far';
  const major = lane.kind !== 'shaping';
  const Icon = lane.kind === 'lead' ? Sparkles : lane.kind === 'strategy' ? ChessPawn : Flag;
  const content = lane.kind === 'lead' ? leadParts(data.lead)
    : lane.kind === 'strategy' ? strategyParts(data.strategy, onOpenTool)
    : m ? milestoneParts(m, data, onOpenTool, onChanged)
    : shapingParts(lane, data.ticket);

  return (
    <section aria-label={title} className={`relative flex h-full ${major ? 'w-[21rem]' : 'w-80'} shrink-0 flex-col px-5`}>
      {/* Above the line: the heading sits right on the node, with the key facts stacked over it. Scrolls up for more. One share of the height to the detail's three, so the line sits a quarter of the way down. */}
      <div data-scrolls className="min-h-0 flex-[1_1_0%] overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_28px)]">
        <div className="flex min-h-full flex-col justify-end pt-7 pb-3">
          <div className="space-y-3 text-xs text-slate-700">{content.above}</div>
          <div className="mt-3">
            <div className={`text-[10px] font-semibold tracking-wider uppercase ${CHIP[phase]}`}>{phase === title ? ' ' : phase}</div>
            <h3 className={`${major ? 'text-base' : 'text-sm'} leading-tight font-semibold text-slate-900`}>{title}</h3>
            <div className="text-[11px] text-slate-500">{subtitle}</div>
            {lane.kind === 'shaping' && <div className="text-[11px] text-slate-400">{workSummary(lane.events)}</div>}
          </div>
        </div>
      </div>
      {/* The node on the spine, with a stem up into the heading and down into the detail. */}
      <div className="relative z-10 flex h-14 shrink-0 items-center justify-center">
        <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-slate-300/0 via-slate-400/70 to-slate-300/0" />
        {major ? (
          <span className={`grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br text-white shadow-[0_6px_12px_-4px_rgba(15,23,42,.6),inset_0_1px_1px_rgba(255,255,255,.8)] ring-4 ring-white ${NODE[phase]}`} title={title}>
            <Icon size={15} />
          </span>
        ) : (
          <span className="h-4 w-4 rounded-full bg-gradient-to-br from-white via-slate-300 to-slate-500 shadow-[0_3px_6px_-2px_rgba(15,23,42,.6)] ring-4 ring-white" title={`Shaping · ${workSummary(lane.events)}`} />
        )}
      </div>
      {/* Below the line: the detail, scrolling down for more. */}
      <div data-scrolls className="min-h-0 flex-[3_3_0%] overflow-y-auto [mask-image:linear-gradient(to_top,transparent,black_28px)]">
        <div className="space-y-4 pt-3 pb-7 text-xs text-slate-700">{content.below}</div>
      </div>
    </section>
  );
}

const Heading = ({ icon: Icon, children, action }) => (
  <div className="flex items-center justify-between gap-2">
    <h4 className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{Icon && <Icon size={11} />} {children}</h4>
    {action}
  </div>
);
const Open = ({ onOpenTool, tool, children }) => (onOpenTool
  ? <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => onOpenTool(tool)}>{children}</button>
  : null);
const Stamp = ({ at }) => <div className="text-[10px] text-slate-400" title={at?.length > 10 ? fullStamp(at) : undefined}>{when(at)}</div>;

// ---- Lead generated by: the ticket's creation and source over the line, the rest oldest first under it

function leadParts(items) {
  const created = items.find((it) => it.type === 'created');
  const rest = items.filter((it) => it !== created);
  return {
    above: created && (
      <div className="flex items-start gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 shadow-sm"><Ticket size={13} /></span>
        <div className="min-w-0">
          <div className="font-medium text-slate-800">Ticket created{created.by ? ` by ${fullName(created.by)}` : ''}</div>
          {(created.source || created.origin) && <div>Source: {[created.source, created.origin].filter(Boolean).join(' · ')}</div>}
          {created.pipedrive && <div className="text-slate-500">Synced with Pipedrive</div>}
          {!created.source && !created.origin && !created.pipedrive && <div className="text-slate-400">No source recorded</div>}
          <Stamp at={created.at} />
        </div>
      </div>
    ),
    below: rest.length ? rest.map((it, i) => <LeadItem key={`${it.type}-${i}`} item={it} />) : <p className="text-slate-400">Nothing else recorded about how this lead came in.</p>,
  };
}

function LeadItem({ item: it }) {
  const Row = ({ icon: Icon, tint, title, children }) => (
    <div className="flex items-start gap-2">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full shadow-sm ${tint}`}><Icon size={13} /></span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-slate-800">{title}</div>
        {children}
        <Stamp at={it.at} />
      </div>
    </div>
  );
  if (it.type === 'event') {
    return (
      <Row icon={CalendarDays} tint="bg-sky-100 text-sky-700" title={it.event.name}>
        <div>Event · {longDate(it.event.date_from)}{it.event.date_to && it.event.date_to !== it.event.date_from ? ` – ${longDate(it.event.date_to)}` : ''}</div>
      </Row>
    );
  }
  if (it.type === 'spend') {
    const s = it.spend;
    return (
      <Row icon={Megaphone} tint="bg-amber-100 text-amber-700" title={<>{money(s.amount)} <span className="font-normal text-slate-600">{s.description}</span></>}>
        <div className="text-slate-500">{[s.category, s.vendor, s.event_name, s.user_name].filter(Boolean).join(' · ') || 'Marketing spend'}</div>
        {s.note && <div className="mt-0.5 whitespace-pre-wrap">{s.note}</div>}
      </Row>
    );
  }
  if (it.type === 'contact') {
    const c = it.contact;
    return (
      <Row icon={ContactRound} tint="bg-emerald-100 text-emerald-700" title={<>{c.first_name} {c.last_name || ''}{c.is_primary && <Star size={11} className="ml-1 inline fill-amber-400 text-amber-400" title="Primary contact" />}</>}>
        <div>{[c.role, c.organization].filter(Boolean).join(' · ') || 'Contact'}</div>
        <div className="text-slate-400">Added to the ticket{it.by ? ` by ${it.by}` : ''}</div>
      </Row>
    );
  }
  if (it.type === 'interaction') {
    return (
      <Row icon={MessageSquare} tint="bg-emerald-50 text-emerald-700" title={`With ${it.contact.first_name} ${it.contact.last_name || ''}`}>
        <div className="whitespace-pre-wrap">{it.body}</div>
        {it.by && <div className="text-slate-400">Logged by {it.by}</div>}
      </Row>
    );
  }
  return null;
}

// ---- Strategy: the tier and priority over the line, this ticket's own plan and assessment under it

function strategyParts(s, onOpenTool) {
  return {
    above: (
      <>
        <div>
          <Heading icon={Layers}>Priority tier</Heading>
          {s.tiers.length ? s.tiers.map((x, i) => (
            <div key={i} className={i ? 'mt-2' : 'mt-1'}>
              <div className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="rounded bg-violet-100 px-1.5 py-px font-semibold text-violet-800 shadow-sm">{x.tier}</span>
                <span className="font-medium text-slate-800">{x.account}</span>
                {x.user && <span className="text-slate-500">· {fullName(x.user)}</span>}
              </div>
              <div className="text-slate-500">Ticket {x.position} of {x.account_tickets} at this account</div>
              {x.account_strategy ? <Clamp text={x.account_strategy} className="mt-1" /> : <div className="mt-1 text-slate-400">No account strategy written.</div>}
            </div>
          )) : <p className="mt-1 text-slate-400">Not under anyone's priority accounts.</p>}
        </div>
        <div>
          <Heading icon={Star}>Priority list</Heading>
          {s.lists.length ? s.lists.map((x, i) => (
            <div key={i} className="mt-1 flex items-baseline gap-1.5">
              <span className="rounded bg-amber-100 px-1.5 py-px font-semibold text-amber-800 shadow-sm tabular-nums">#{x.position} of {x.total}</span>
              <span>on {x.user ? `${fullName(x.user)}’s` : 'a'} priority list</span>
            </div>
          )) : <p className="mt-1 text-slate-400">On no one's priority ticket list.</p>}
        </div>
      </>
    ),
    below: (
      <>
        <div>
          <Heading icon={ChessPawn} action={<Open onOpenTool={onOpenTool} tool="strategy"><Pencil size={11} className="inline" /> Edit</Open>}>Strategy for this ticket</Heading>
          {s.text ? <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">{s.text}</p> : <p className="mt-1 text-slate-400">No strategy written yet.</p>}
          {s.updated_at && <div className="mt-1 text-[10px] text-slate-400">Saved {stamp(s.updated_at)}{s.updated_by ? ` by ${s.updated_by}` : ''}</div>}
        </div>
        <div>
          <Heading icon={Scale} action={<Open onOpenTool={onOpenTool} tool="assessment"><Pencil size={11} className="inline" /> Edit</Open>}>Bid and win assessment</Heading>
          <div className="mt-1"><Assessment strategy={s} /></div>
        </div>
      </>
    ),
  };
}

/** PWIN and the score in each assessment area, as they stand now. */
function Assessment({ strategy: s, compact }) {
  const rated = CRITERIA.filter((c) => s.assessment?.[c.key]?.score);
  if (!rated.length) return <p className="text-slate-400">Not assessed yet.</p>;
  const gates = s.model?.gates || [];
  return (
    <div>
      {s.pwin && (
        <div className="mb-1.5 flex items-baseline gap-1.5">
          <span className="rounded bg-brand-50 px-1.5 py-px text-sm font-bold text-brand-700 shadow-sm tabular-nums">PWIN {s.pwin.score}%</span>
          <span className="text-[11px] text-slate-500">{s.pwin.rated} of {s.pwin.total} areas rated{s.pwin.penalties.length ? ` · held back by ${s.pwin.penalties.map((x) => x.title).join(', ')}` : ''}</span>
        </div>
      )}
      <ul className={compact ? 'grid grid-cols-2 gap-x-3 gap-y-0.5' : 'space-y-0.5'}>
        {CRITERIA.map((c) => {
          const score = s.assessment?.[c.key]?.score || 0;
          return (
            <li key={c.key} className="flex items-center justify-between gap-2" title={c.blurb}>
              <span className={`truncate ${score ? '' : 'text-slate-400'}`}>{c.title}{gates.includes(c.key) ? ' *' : ''}</span>
              <span className="flex shrink-0 gap-px" aria-label={score ? `${score} of 5` : 'Not rated'}>
                {[1, 2, 3, 4, 5].map((n) => <span key={n} className={`h-2 w-2 rounded-sm ${n <= score ? (score < 3 ? 'bg-red-400' : score < 4 ? 'bg-amber-400' : 'bg-emerald-500') : 'bg-slate-200'}`} />)}
              </span>
            </li>
          );
        })}
      </ul>
      {s.assessment_updated_at && <div className="mt-1.5 text-[10px] text-slate-400">Rated {stamp(s.assessment_updated_at)}{s.assessment_updated_by ? ` by ${s.assessment_updated_by}` : ''} · * must-have</div>}
    </div>
  );
}

function Clamp({ text, className = '' }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <div className={className}>
      <p className={`whitespace-pre-wrap ${open ? '' : 'line-clamp-4'}`}>{text}</p>
      {long && <button type="button" className="text-[11px] font-medium text-brand-700 hover:underline" onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>}
    </div>
  );
}

// ---- A milestone: the decision, approvals and PWIN over the line; price, who was there, notes and documents under it

function milestoneParts(m, data, onOpenTool, onChanged) {
  const def = milestoneOf(m.step_type);
  const person = (id) => data.people[id] || { id, first_name: 'Someone', last_name: '' };
  const fullAssessment = ['Initial Gate Review', 'Final Gate Review'].includes(m.step_type);
  const approvers = [...new Set(REVIEW_AREAS.flatMap((a) => m.reviews[a.key].approved))].map(person);
  return {
    above: (
      <>
        {def.about && <p className="text-slate-500">{def.about}</p>}
        {def.gate && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Decision</span>
            {m.decision
              ? <span className={`rounded px-2 py-0.5 text-xs font-semibold shadow-sm ${DECISION_STYLE[m.decision]}`}>{m.decision}</span>
              : <span className="text-slate-400">Not recorded</span>}
            {data.strategy.pwin && <span className="ml-auto rounded bg-brand-50 px-1.5 py-px font-bold text-brand-700 shadow-sm tabular-nums" title="As rated now; the assessment isn't kept per milestone">PWIN {data.strategy.pwin.score}%</span>}
          </div>
        )}
        {approvers.length > 0 && (
          <div>
            <Heading icon={Check}>Approved by</Heading>
            <ul className="mt-1 flex flex-wrap gap-1">
              {approvers.map((u) => (
                <li key={u.id} className="flex items-center gap-1 rounded-full bg-emerald-50 py-0.5 pr-2 pl-0.5 text-emerald-900 shadow-sm ring-1 ring-emerald-200"><Avatar user={u} size="xs" /> {fullName(u)}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    ),
    below: (
      <>
        {def.gate && (
          <div>
            <Heading>Price considerations</Heading>
            {m.pricing ? <p className="mt-1 whitespace-pre-wrap">{m.pricing}</p> : <p className="mt-1 text-slate-400">None recorded</p>}
          </div>
        )}
        {def.gate && fullAssessment && (
          <div>
            <Heading icon={Scale}>Bid and win assessment</Heading>
            <div className="mt-1"><Assessment strategy={data.strategy} compact /></div>
            <p className="mt-1 text-[10px] text-slate-400">As rated now; the assessment isn't kept per milestone.</p>
          </div>
        )}
        <div>
          <Heading>Who was there</Heading>
          <div className="mt-1 space-y-2">
            {REVIEW_AREAS.map((a) => {
              const r = m.reviews[a.key];
              const expected = a.at.includes(m.step_type);
              if (!expected && !r.people.length && !r.notes) return null;
              return (
                <div key={a.key}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-semibold text-slate-700">{a.label}</span>
                    {expected && !r.people.length && <span className="text-[10px] text-amber-700" title={a.about}>Expected, nobody recorded</span>}
                  </div>
                  {r.people.length > 0 && (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {r.people.map((id) => {
                        const u = person(id);
                        const ok = r.approved.includes(id);
                        return (
                          <li key={id} className={`flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 shadow-sm ${ok ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`} title={ok ? `${fullName(u)} approved` : fullName(u)}>
                            <Avatar user={u} size="xs" /> {fullName(u)}{ok && <Check size={11} className="text-emerald-600" />}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {r.notes && <p className="mt-1 whitespace-pre-wrap text-slate-600">{r.notes}</p>}
                </div>
              );
            })}
          </div>
        </div>
        {m.notes && (
          <div>
            <Heading>Notes</Heading>
            <p className="mt-1 whitespace-pre-wrap">{m.notes}</p>
          </div>
        )}
        <Documents milestone={m} onChanged={onChanged} />
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span>{m.updated_at ? `Edited ${stamp(m.updated_at)}${m.updated_by ? ` by ${fullName(m.updated_by)}` : ''}` : `Added ${stamp(m.created_at)}${m.author ? ` by ${fullName(m.author)}` : ''}`}</span>
          <Open onOpenTool={onOpenTool} tool="process"><Pencil size={11} className="inline" /> Edit</Open>
        </div>
      </>
    ),
  };
}

/** The milestone's documents: the archive of what was produced for it. Upload straight from here. */
function Documents({ milestone: m, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setError('');
    const fd = new FormData();
    fd.append('file', file);
    try { await api.post(`/tickets/process/${m.id}/files`, fd); await onChanged?.(); } catch (e) { setError(e.message); }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  };
  return (
    <div>
      <Heading icon={FileText} action={(
        <label className={`btn cursor-pointer px-2 py-0.5 text-[11px] ${uploading ? 'pointer-events-none opacity-60' : ''}`} title="Attach a document to this milestone">
          {uploading ? <><Loader2 size={11} className="animate-spin" /> Uploading…</> : <><Upload size={11} /> Upload</>}
          <input ref={fileRef} type="file" className="sr-only" onChange={(e) => upload(e.target.files[0])} />
        </label>
      )}>Documents</Heading>
      {error && <p className="mt-1 text-red-600">{error}</p>}
      {m.files.length ? (
        <ul className="mt-1 space-y-1">
          {m.files.map((f) => (
            <li key={f.id}>
              <a href={`/api/tickets/files/${f.id}`} className="flex items-center gap-1.5 rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200 hover:ring-brand-500" title={`Uploaded ${fullStamp(f.created_at)}${f.uploaded_by ? ` by ${fullName(f.uploaded_by)}` : ''}`}>
                <FileText size={13} className="shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{bytes(f.size)}</span>
                <Download size={12} className="shrink-0 text-slate-400" />
              </a>
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-slate-400">None attached.</p>}
    </div>
  );
}

// ---- Shaping: everything on the ticket between two milestones, oldest on top, under the line

function shapingParts(lane, ticket) {
  return {
    above: null,
    below: lane.events.length
      ? lane.events.map((e) => <ShapingItem key={`${e.type}-${e.activity?.id ?? e.comment?.id ?? e.file?.id ?? e.email?.id}`} event={e} ticket={ticket} />)
      : <p className="text-slate-400">{lane.from ? `Nothing yet since ${lane.from.step_type}.` : 'Nothing on this ticket yet.'}</p>,
  };
}

function ShapingItem({ event: e, ticket }) {
  const meta = (what) => (
    <div className="flex items-baseline justify-between gap-2 text-[11px] text-slate-500">
      <span className="truncate"><span className="font-semibold text-slate-800">{e.type === 'email' ? e.email.from || 'Someone' : fullName(e.author) || 'Someone'}</span> {what}</span>
      <span className="shrink-0 text-[10px] text-slate-400" title={fullStamp(e.at)}>{stamp(e.at)}</span>
    </div>
  );
  if (e.type === 'comment') {
    const c = e.comment;
    const owner = c.author?.id && c.author.id === ticket.owner_id;
    const kind = c.kind === 'note' && owner ? 'left a note' : c.kind === 'question' ? 'asked' : 'commented'; // a note from anyone else reads as a comment
    return (
      <div>
        {meta(<>{kind}{c.about?.subject ? <> on <span className="font-medium text-slate-700">{c.about.subject}</span></> : ''}{c.pinned ? ' · pinned' : ''}</>)}
        <div className="mt-0.5 flex items-start gap-1.5">
          <span className="mt-px shrink-0">{owner ? <StickyNote size={12} className="text-amber-600" /> : <Avatar user={c.author} size="xs" />}</span>
          <div className={`min-w-0 whitespace-pre-wrap ${owner ? 'rounded-md bg-amber-50/80 px-2 py-1 shadow-sm' : ''}`}><MentionText text={c.body} /></div>
        </div>
        {e.replies?.length > 0 && <div className="mt-0.5 pl-5 text-[11px] text-slate-400">{e.replies.length} repl{e.replies.length === 1 ? 'y' : 'ies'}</div>}
      </div>
    );
  }
  if (e.type === 'activity') {
    const a = e.activity;
    return (
      <div>
        {meta(<>added {a.activity_type === 'Task' ? 'a task' : `a ${a.activity_type.toLowerCase()}`}</>)}
        <div className="mt-0.5 flex items-start gap-1.5">
          <CalendarCheck size={13} className={`mt-px shrink-0 ${a.done ? 'text-emerald-600' : 'text-violet-600'}`} />
          <div className="min-w-0">
            <div className={`font-medium ${a.done ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{a.subject}</div>
            <div className="text-[11px] text-slate-500">{[a.due_date ? `Due ${longDate(a.due_date)}${a.due_time ? ` ${a.due_time}` : ''}` : null, a.assignee, a.done ? 'Done' : null].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      </div>
    );
  }
  if (e.type === 'file') {
    const f = e.file;
    return (
      <div>
        {meta('uploaded a document')}
        <a href={f.url || `/api/tickets/files/${f.id}`} className="mt-0.5 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 shadow-sm ring-1 ring-slate-200 hover:ring-brand-500">
          <FileText size={13} className="shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          {f.size != null && <span className="shrink-0 text-[10px] text-slate-400">{bytes(f.size)}</span>}
        </a>
      </div>
    );
  }
  if (e.type === 'email') {
    return (
      <div>
        {meta('emailed')}
        <div className="mt-0.5 flex items-start gap-1.5">
          <Mail size={13} className="mt-px shrink-0 text-sky-600" />
          <div className="min-w-0">
            <div className="font-medium text-slate-800">{e.email.subject || '(no subject)'}</div>
            {e.email.to && <div className="truncate text-[11px] text-slate-500">To {e.email.to}</div>}
          </div>
        </div>
      </div>
    );
  }
  return null;
}
