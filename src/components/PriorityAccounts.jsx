import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCorners } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Building2, Plus, Pencil, Trash2, Star, X, Search, GripVertical, Check, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { usd } from '../lib/travelCalc.js';
import SidePanel from './SidePanel.jsx';
import { TicketCard, TicketKindTag } from '../pages/Pipeline.jsx';
import TicketTimeline from '../pages/TicketTimeline.jsx';
import { PlanRail, DrawerShell } from '../pages/TicketPlanning.jsx';
import { ActivitiesDrawer } from '../pages/TicketActivities.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));
/** The line under a ticket's title: organization, then stage and value for a pipeline ticket. */
const detail = (t) => [t.accounts?.join(', ') || t.organization, ...(t.ticket_type === 'work' ? [] : [t.pipeline_status, money(t.value)])].filter(Boolean).join(' · ');
/** " · $1,200,000" over the open pipeline tickets among these; nothing when they're all work tickets. */
const pipelineTotal = (open) => { const bids = open.filter((t) => t.ticket_type !== 'work'); return bids.length ? ` · ${money(bids.reduce((s, t) => s + (t.value || 0), 0))}` : ''; };
import { isClosed } from '../lib/lanes.js';
// Words too common in agency names to match on by themselves.
const GENERIC = new Set(['the', 'and', 'for', 'of', 'command', 'department', 'office', 'agency', 'systems', 'center', 'program', 'executive', 'directorate', 'division', 'service', 'services', 'administration', 'national', 'defense', 'force', 'air', 'u.s.', 'us']);

/**
 * Priority accounts, at the top of My dashboard: agencies, departments and organizations sorted into tiers (tiers, not
 * a ranking), the pipeline and work tickets that matter at each, and an ordered list of priority tickets picked from those.
 * The tickets show as standard ticket cards with a "Priority" tag. `userId` shows someone else's, read-only.
 */
export default function PriorityAccounts({ userId, name }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [openAccount, setOpenAccount] = useState(null);
  const [picking, setPicking] = useState(false);
  const [ticketId, setTicketId] = useState(null);
  const [ticketStep, setTicketStep] = useState(undefined);
  const [cards, setCards] = useState([]); // full ticket rows for the priority list
  const url = `/priority-accounts${userId ? `?user=${userId}` : ''}`;

  const load = () => api.get(url).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps
  const listKey = data?.list.join(',') || '';
  const loadCards = () => (listKey ? api.get(`/tickets?scope=all&ids=${listKey}`).then((d) => setCards(d.tickets)) : Promise.resolve(setCards([])));
  useEffect(() => { loadCards(); }, [listKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every change returns the whole arrangement; show it. */
  const save = (p) => p.then((d) => { setData((cur) => ({ ...cur, ...d })); setError(''); return d; }).catch((e) => { setError(e.message); load(); });

  if (!data) return error ? <p className="text-sm text-red-600">{error}</p> : null;
  const edit = data.canEdit;
  const account = openAccount && data.tiers.flatMap((t) => t.accounts.map((a) => ({ ...a, tier_id: t.id }))).find((a) => a.id === openAccount);
  const inTiers = uniqueTickets(data.tiers);
  const empty = !data.tiers.some((t) => t.accounts.length);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const list = data.list.map((id) => byId.get(id)).filter(Boolean);

  return (
    <section className="space-y-5">
      <div>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Building2 size={17} className="text-brand-600" /> {edit ? 'Priority accounts' : `${name}'s priority accounts`}</h2>
            <p className="text-xs text-slate-500">Agencies, departments and organizations in tiers.{edit ? ' Click a tier’s name to rename it, drag accounts between tiers, and click an account to choose its priority tickets.' : ''}</p>
          </div>
          {edit && <AddTier onAdd={(n) => save(api.post('/priority-accounts/tiers', { name: n }))} />}
        </div>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <Tiers tiers={data.tiers} edit={edit} organizations={data.organizations} save={save} onOpen={setOpenAccount} />
        {!edit && empty && <p className="text-sm text-slate-400">No priority accounts yet.</p>}
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="mr-auto">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Star size={17} className="fill-amber-400 text-amber-500" /> Priority tickets</h2>
            <p className="text-xs text-slate-500">Pipeline or work tickets, from the accounts above or anywhere else{edit ? ', in whatever order you like. Drag to reorder.' : '.'}</p>
          </div>
          {edit && <button type="button" className="btn" onClick={() => setPicking(true)}><Plus size={15} /> Choose tickets</button>}
        </div>
        {list.length ? (
          <PriorityList list={list} edit={edit}
            onReorder={(ids) => save(api.put('/priority-accounts/list', { ticket_ids: ids }))}
            onRemove={(id) => save(api.put('/priority-accounts/list', { ticket_ids: data.list.filter((x) => x !== id) }))}
            onOpen={(t, step) => { setTicketStep(step); setTicketId(t.id); }} />
        ) : (
          <p className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">
            {edit ? 'No priority tickets yet. Choose them from your accounts, or any open pipeline or work ticket.' : 'No priority tickets yet.'}
          </p>
        )}
      </div>

      {account && (
        <AccountPanel key={account.id} account={account} tiers={data.tiers} edit={edit} save={save} onClose={() => setOpenAccount(null)}
          onOpenTicket={(id) => { setTicketStep(undefined); setTicketId(id); }} />
      )}
      {picking && (
        <PickList tickets={inTiers} cards={list} chosen={data.list} onClose={() => setPicking(false)}
          onSave={(ids) => save(api.put('/priority-accounts/list', { ticket_ids: ids })).then(() => setPicking(false))} />
      )}
      {ticketId && <TicketTimeline key={`${ticketId}-${ticketStep}`} ticketId={ticketId} activityId={ticketStep} onClose={() => { setTicketId(null); load(); loadCards(); }} onChanged={loadCards} />}
    </section>
  );
}

/** Each ticket once, with the accounts it sits under. */
function uniqueTickets(tiers) {
  const m = new Map();
  tiers.forEach((t) => t.accounts.forEach((a) => a.tickets.forEach((k) => {
    if (!m.has(k.id)) m.set(k.id, { ...k, accounts: [] });
    m.get(k.id).accounts.push(a.name);
  })));
  return [...m.values()];
}

function AddTier({ onAdd }) {
  const [name, setName] = useState(null);
  if (name == null) return <button type="button" className="btn" onClick={() => setName('')}><Plus size={15} /> Add tier</button>;
  const submit = (e) => { e.preventDefault(); if (name.trim()) onAdd(name.trim()).then(() => setName(null)); };
  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input autoFocus className="input h-9 w-40" placeholder="Tier name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setName(null)} />
      <button className="btn-primary" disabled={!name.trim()}>Add</button>
      <button type="button" className="btn-ghost p-2" onClick={() => setName(null)} aria-label="Cancel"><X size={15} /></button>
    </form>
  );
}

// ---- Tiers: columns of accounts, dragged within and between tiers.

function Tiers({ tiers, edit, organizations, save, onOpen }) {
  // Where each account sits while dragging: { [tierId]: [account ids] }.
  const [layout, setLayout] = useState(null);
  const [active, setActive] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const current = layout || Object.fromEntries(tiers.map((t) => [t.id, t.accounts.map((a) => a.id)]));
  const accounts = new Map(tiers.flatMap((t) => t.accounts).map((a) => [a.id, a]));
  const tierOf = (id) => (String(id).startsWith('tier-') ? Number(String(id).slice(5)) : Number(Object.keys(current).find((k) => current[k].includes(id))));

  const onDragOver = ({ active: a, over }) => {
    if (!over) return;
    const from = tierOf(a.id);
    const to = tierOf(over.id);
    if (!from || !to || from === to) return;
    const next = { ...current, [from]: current[from].filter((x) => x !== a.id) };
    const at = String(over.id).startsWith('tier-') ? current[to].length : current[to].indexOf(over.id);
    next[to] = [...current[to].slice(0, at), a.id, ...current[to].slice(at)];
    setLayout(next);
  };
  const onDragEnd = ({ active: a, over }) => {
    setActive(null);
    let next = current;
    if (over && !String(over.id).startsWith('tier-')) {
      const t = tierOf(over.id);
      const list = next[t];
      if (list.includes(a.id)) next = { ...next, [t]: arrayMove(list, list.indexOf(a.id), list.indexOf(over.id)) };
    }
    const changed = tiers.some((t) => (next[t.id] || []).join() !== t.accounts.map((x) => x.id).join());
    if (changed) save(api.put('/priority-accounts/layout', { tiers: tiers.map((t) => ({ id: t.id, accounts: next[t.id] || [] })) })).finally(() => setLayout(null));
    else setLayout(null);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={({ active: a }) => setActive(a.id)} onDragOver={onDragOver} onDragEnd={onDragEnd}
      onDragCancel={() => { setActive(null); setLayout(null); }}>
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
        {tiers.map((t) => (
          <Tier key={t.id} tier={t} ids={current[t.id] || []} accounts={accounts} edit={edit} organizations={organizations} save={save} onOpen={onOpen} />
        ))}
      </div>
      <DragOverlay>{active && accounts.get(active) && <AccountChip account={accounts.get(active)} overlay />}</DragOverlay>
    </DndContext>
  );
}

function Tier({ tier, ids, accounts, edit, organizations, save, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id: `tier-${tier.id}`, disabled: !edit });
  const [renaming, setRenaming] = useState(null);
  const [adding, setAdding] = useState('');
  const remove = () => {
    const n = tier.accounts.length;
    if (n && !window.confirm(`Remove ${tier.name} and its ${n} account${n === 1 ? '' : 's'}, with their activities? Your priority tickets stay on your list.`)) return;
    save(api.del(`/priority-accounts/tiers/${tier.id}`));
  };
  const add = (e) => {
    e.preventDefault();
    if (adding.trim()) save(api.post('/priority-accounts/accounts', { tier_id: tier.id, name: adding.trim() })).then((d) => { if (d) setAdding(''); });
  };
  return (
    <div ref={setNodeRef} className={`flex flex-col rounded-xl border bg-white p-3 shadow-sm transition ${isOver ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
      <header className="mb-2 flex items-center gap-1.5">
        {renaming != null ? (
          <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) save(api.put(`/priority-accounts/tiers/${tier.id}`, { name: renaming })).then(() => setRenaming(null)); }}>
            <input autoFocus className="input h-8 flex-1 py-0 text-sm" value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Tier name" />
            <button className="btn-ghost p-1.5" aria-label="Save name"><Check size={14} /></button>
          </form>
        ) : (
          <>
            <h3 className="mr-auto text-sm font-semibold text-slate-800">
              {edit ? <button type="button" className="text-left hover:underline" title="Rename" onClick={() => setRenaming(tier.name)}>{tier.name}</button> : tier.name}
            </h3>
            {edit && <button type="button" className="btn-ghost p-1 text-slate-400" onClick={() => setRenaming(tier.name)} aria-label={`Rename ${tier.name}`}><Pencil size={13} /></button>}
            {edit && <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" onClick={remove} aria-label={`Remove ${tier.name}`}><Trash2 size={13} /></button>}
          </>
        )}
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-10 flex-1 flex-col gap-1.5">
          {ids.map((id) => accounts.get(id) && <SortableAccount key={id} account={accounts.get(id)} edit={edit} onOpen={onOpen} />)}
          {!ids.length && <p className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">{edit ? 'Drop an account here, or add one' : 'None'}</p>}
        </div>
      </SortableContext>
      {edit && (
        <form onSubmit={add} className="mt-2 flex items-center gap-1">
          <input className="input h-8 flex-1 py-0 text-sm" list="priority-orgs" placeholder="Add an agency or organization" value={adding} onChange={(e) => setAdding(e.target.value)}
            aria-label={`Add an account to ${tier.name}`} />
          <datalist id="priority-orgs">{organizations.map((o) => <option key={o} value={o} />)}</datalist>
          <button className="btn-ghost p-1.5" disabled={!adding.trim()} aria-label="Add"><Plus size={15} /></button>
        </form>
      )}
    </div>
  );
}

function SortableAccount({ account, edit, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id, disabled: !edit });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'opacity-30' : ''}>
      <AccountChip account={account} edit={edit} onOpen={() => onOpen(account.id)} handle={{ ...attributes, ...listeners }} />
    </div>
  );
}

function AccountChip({ account, edit, onOpen, handle, overlay }) {
  const open = account.tickets.filter((t) => !isClosed(t));
  return (
    <div className={`flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-sm ${overlay ? 'shadow-lg' : 'hover:border-brand-500'}`}>
      {edit && <span {...handle} className="cursor-grab p-1.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing" aria-label={`Move ${account.name}`}><GripVertical size={14} /></span>}
      <button type="button" onClick={onOpen} className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left ${edit ? '' : 'pl-2.5'}`}>
        <span className="truncate font-medium text-slate-800">{account.name}</span>
        <span className="ml-auto shrink-0 text-[11px] text-slate-500" title={`${account.tickets.length} priority ticket${account.tickets.length === 1 ? '' : 's'}`}>
          {account.tickets.length ? `${account.tickets.length}${pipelineTotal(open)}` : 'No tickets'}
        </span>
      </button>
    </div>
  );
}

// ---- An account: its name, tier and priority tickets (pipeline or work).

function AccountPanel({ account, tiers, edit, save, onClose, onOpenTicket }) {
  const [name, setName] = useState(account.name);
  const [all, setAll] = useState(null); // every open pipeline and work ticket, for picking
  const [q, setQ] = useState('');
  const [everyOrg, setEveryOrg] = useState(false);
  useEffect(() => {
    if (edit) api.get('/tickets?scope=all').then((d) => setAll(d.tickets.filter((t) => !t.archived && !isClosed(t))));
  }, [edit]);
  const chosen = account.tickets.map((t) => t.id);
  const setTickets = (ids) => save(api.put(`/priority-accounts/accounts/${account.id}/tickets`, { ticket_ids: ids }));
  // Tickets for this account: its organization matches the account's name; failing that, shares a distinctive word with it.
  const forAccount = useMemo(() => {
    const name = account.name.toLowerCase();
    const open = (all || []).filter((t) => t.organization);
    const exact = open.filter((t) => { const o = t.organization.toLowerCase(); return o.includes(name) || name.includes(o); });
    if (exact.length) return new Set(exact.map((t) => t.id));
    const words = name.split(/[\s/,&-]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
    return new Set(open.filter((t) => words.some((w) => t.organization.toLowerCase().split(/[\s/,&-]+/).includes(w))).map((t) => t.id));
  }, [all, account.name]);
  const candidates = useMemo(() => (all || []).filter((t) => !chosen.includes(t.id))
    .filter((t) => everyOrg || q || forAccount.has(t.id))
    .filter((t) => !q || `${t.opportunity_title} ${t.organization || ''}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 60), [all, chosen, everyOrg, q, forAccount]);
  const remove = () => {
    if (!window.confirm(`Remove ${account.name} and its activities? Your priority tickets stay on your list.`)) return;
    save(api.del(`/priority-accounts/accounts/${account.id}`)).then(onClose);
  };
  // The panes off the left edge, as on a ticket. Strategy saves as you leave its box; an activity asks before losing unsaved changes.
  const [tool, setTool] = useState(null);
  const [ticket, setTicket] = useState(null);
  const toolDirty = useRef(false);
  const setToolDirty = (v) => { toolDirty.current = v; };
  const leaveTool = () => !toolDirty.current || window.confirm('You have unsaved changes. Discard them?');
  const switchTool = (next) => { if (leaveTool()) { toolDirty.current = false; setTool(next); } };
  const close = () => { if (leaveTool()) onClose(); };
  useEffect(() => {
    if (tool === 'activities' && !ticket) api.post(`/priority-accounts/accounts/${account.id}/activity-ticket`).then((d) => setTicket(d.ticket));
  }, [tool, ticket, account.id]);
  const moveTo = (tierId) => save(api.put('/priority-accounts/layout', {
    tiers: tiers.map((t) => ({ id: t.id, accounts: t.id === Number(tierId) ? [...t.accounts.map((a) => a.id).filter((x) => x !== account.id), account.id] : t.accounts.map((a) => a.id).filter((x) => x !== account.id) })),
  }));

  return (
    <SidePanel title={account.name} subtitle={tiers.find((t) => t.id === account.tier_id)?.name} onClose={close} wide
      onEscape={tool ? () => switchTool(null) : close}
      rail={<PlanRail ticket={{ ticket_type: 'account' }} active={tool} onSelect={switchTool} />}
      drawer={tool === 'strategy' ? <StrategyDrawer account={account} edit={edit} save={save} onClose={() => switchTool(null)} />
        : tool === 'activities' && (ticket
          ? <ActivitiesDrawer ticket={ticket} onClose={() => switchTool(null)} onChanged={() => {}} onDirty={setToolDirty} />
          : <DrawerShell title="Activity" onClose={() => switchTool(null)}><p className="text-sm text-slate-400">Loading…</p></DrawerShell>)}
      footer={edit && (
        <div className="flex justify-between">
          <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={15} /> Remove account</button>
          <button type="button" className="btn-primary" onClick={close}>Done</button>
        </div>
      )}>
      <div className="space-y-5">
        {edit && (
          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div>
              <label className="label" htmlFor="acct-name">Name</label>
              <input id="acct-name" className="input" value={name} onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() && name.trim() !== account.name && save(api.put(`/priority-accounts/accounts/${account.id}`, { name }))} />
            </div>
            <div>
              <label className="label" htmlFor="acct-tier">Tier</label>
              <select id="acct-tier" className="input" value={account.tier_id} onChange={(e) => moveTo(e.target.value)}>
                {tiers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
        )}
        <div>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Priority tickets</h3>
          {account.tickets.length ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {account.tickets.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onOpenTicket(t.id)}>
                    <div className="flex items-center gap-1.5"><span className="truncate font-medium text-slate-800">{t.opportunity_title}</span><TicketKindTag ticket={t} /></div>
                    <div className="truncate text-xs text-slate-500">{detail(t)}</div>
                  </button>
                  {edit && (
                    <>
                      <button type="button" className="btn-ghost p-1 text-slate-400" disabled={i === 0} onClick={() => setTickets(arrayMove(chosen, i, i - 1))} aria-label="Move up">↑</button>
                      <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" onClick={() => setTickets(chosen.filter((x) => x !== t.id))} aria-label={`Remove ${t.opportunity_title}`}><X size={14} /></button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">None yet.</p>}
        </div>
        {edit && (
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Add tickets</h3>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <div className="relative min-w-48 flex-1">
                <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
                <input className="input h-9 pl-8 text-sm" placeholder="Search open pipeline and work tickets" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={everyOrg} onChange={(e) => setEveryOrg(e.target.checked)} />
                Every organization
              </label>
            </div>
            {!all ? <p className="text-sm text-slate-400">Loading…</p> : candidates.length ? (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {candidates.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50" onClick={() => setTickets([...chosen, t.id])}>
                      <Plus size={14} className="shrink-0 text-brand-600" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5"><span className="truncate font-medium text-slate-800">{t.opportunity_title}</span><TicketKindTag ticket={t} /></span>
                        <span className="block truncate text-xs text-slate-500">{detail(t)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">{q || everyOrg ? 'No matching open tickets.' : `No open tickets for ${account.name}. Search, or tick Every organization.`}</p>
            )}
          </div>
        )}
      </div>
    </SidePanel>
  );
}

/** The pawn's pane: the foothold strategy and the AI strategy session. */
function StrategyDrawer({ account, edit, save, onClose }) {
  return (
    <DrawerShell title="Strategy" subtitle={account.name} onClose={onClose}>
      <div className="space-y-5">
        <AccountStrategy account={account} edit={edit} save={save} />
        {edit && (
          <div className="rounded-lg border-2 border-dashed border-slate-200 px-4 py-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Sparkles size={15} className="text-brand-600" /> AI strategy session</h3>
            <p className="mt-1 mb-3 text-xs text-slate-500">Coming soon: work through a foothold strategy for {account.name} with AI.</p>
            <button type="button" className="btn text-xs" disabled>Start AI strategy session</button>
          </div>
        )}
      </div>
    </DrawerShell>
  );
}

/** The owner's strategy for gaining a foothold at the account. Saved on leaving the box, like the account's name. */
function AccountStrategy({ account, edit, save }) {
  const saved = account.strategy || '';
  const [text, setText] = useState(saved);
  const [state, setState] = useState('');
  const title = <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Foothold strategy</h3>;
  if (!edit) return <div>{title}{saved ? <p className="text-sm whitespace-pre-wrap text-slate-700">{saved}</p> : <p className="text-sm text-slate-400">No strategy yet.</p>}</div>;
  const leave = async () => {
    if (text.trim() === saved) return;
    setState('saving');
    const d = await save(api.put(`/priority-accounts/accounts/${account.id}/strategy`, { strategy: text }));
    setState(d ? 'saved' : 'failed');
  };
  return (
    <div>
      {title}
      <textarea rows={6} className="input resize-y text-sm" maxLength={10000} aria-label={`Foothold strategy for ${account.name}`} value={text}
        placeholder={`How will you gain a foothold at ${account.name}? Who to reach, where to start, what would open the door…`}
        onChange={(e) => { setText(e.target.value); setState(''); }} onBlur={leave} />
      {state && <p className={`mt-1 text-xs ${state === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>{{ saving: 'Saving…', saved: 'Saved', failed: 'Couldn’t save. Try again.' }[state]}</p>}
    </div>
  );
}

// ---- The priority ticket list: ticket cards in the owner's order.

function PriorityList({ list, edit, onReorder, onRemove, onOpen }) {
  const [order, setOrder] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = order || list.map((t) => t.id);
  const byId = new Map(list.map((t) => [t.id, t]));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    setOrder(next);
    onReorder(next).finally(() => setOrder(null));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {ids.map((id, i) => byId.get(id) && <SortableTicket key={id} n={i + 1} ticket={byId.get(id)} edit={edit} onRemove={onRemove} onOpen={onOpen} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableTicket({ n, ticket, edit, onRemove, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ticket.id, disabled: !edit });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`group relative ${isDragging ? 'z-10 opacity-60' : ''}`}
      {...attributes} {...listeners}>
      <span className="absolute -top-2 -left-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1 text-[11px] font-semibold text-white">{n}</span>
      <div onClick={() => onOpen(ticket)} role="button" tabIndex={-1}>
        <TicketCard ticket={ticket} onOpenStep={(t) => onOpen(t, t.next_step?.id ?? null)} className={edit ? '' : 'cursor-pointer'} />
      </div>
      {edit && (
        <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => onRemove(ticket.id)}
          className="absolute -top-2 -right-2 z-10 hidden rounded-full border border-slate-200 bg-white p-0.5 text-slate-500 shadow-sm group-hover:block hover:text-red-600"
          aria-label={`Take ${ticket.opportunity_title} off your priority tickets`} title="Take off the list"><X size={12} /></button>
      )}
    </li>
  );
}

/** Choose priority tickets: from under your accounts, or search any open pipeline or work ticket. New picks go to the end of the list. */
function PickList({ tickets, cards, chosen, onClose, onSave }) {
  const [picked, setPicked] = useState(chosen);
  const [all, setAll] = useState(null); // every open pipeline and work ticket, for searching
  const [q, setQ] = useState('');
  const [everyOrg, setEveryOrg] = useState(false);
  useEffect(() => {
    api.get('/tickets?scope=all').then((d) => setAll(d.tickets.filter((t) => !t.archived && !isClosed(t))));
  }, []);
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const rows = useMemo(() => {
    const m = new Map(tickets.map((t) => [t.id, t]));
    [...cards, ...(all || [])].filter((t) => picked.includes(t.id) && !m.has(t.id)).forEach((t) => m.set(t.id, t));
    const matches = (t) => !q || `${t.opportunity_title} ${t.organization || ''}`.toLowerCase().includes(q.toLowerCase());
    const yours = [...m.values()].filter(matches);
    const others = everyOrg || q ? (all || []).filter((t) => !m.has(t.id) && matches(t)).slice(0, 60) : [];
    return [...yours, ...others];
  }, [tickets, cards, all, picked, q, everyOrg]);
  return (
    <SidePanel title="Choose priority tickets" subtitle="From your priority accounts, or search any open pipeline or work ticket" onClose={onClose}
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={() => onSave(picked)}>Save</button>
        </div>
      )}>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute top-2.5 left-2.5 text-slate-400" />
          <input className="input h-9 pl-8 text-sm" placeholder="Search open pipeline and work tickets" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={everyOrg} onChange={(e) => setEveryOrg(e.target.checked)} />
          Every organization
        </label>
      </div>
      {rows.length ? (
        <ul className="-mx-2 divide-y divide-slate-100">
          {rows.map((t) => (
            <li key={t.id}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded px-2 py-2 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-600" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">{t.opportunity_title} <TicketKindTag ticket={t} /></span>
                  <span className="block text-xs text-slate-500">{detail(t)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">{(q || everyOrg) && !all ? 'Loading…' : q || everyOrg ? 'No matching open tickets.' : 'No tickets under your accounts yet. Search, or tick Every organization.'}</p>
      )}
    </SidePanel>
  );
}
