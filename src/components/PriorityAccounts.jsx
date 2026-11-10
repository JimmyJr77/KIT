import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors, useDroppable, closestCorners, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Building2, Plus, Pencil, Trash2, Star, X, Search, GripVertical, Check, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { usd } from '../lib/travelCalc.js';
import SidePanel from './SidePanel.jsx';
import { TicketCard, TicketKindTag } from '../pages/Pipeline.jsx';
import TicketTimeline, { AccountTimeline } from '../pages/TicketTimeline.jsx';
import { PlanRail, PlanDrawer, DrawerShell, CrmObjectives } from '../pages/TicketPlanning.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));
/** The line under a ticket's title: organization, then stage and value for a pipeline ticket. */
const detail = (t) => [t.accounts?.join(', ') || t.organization, ...(t.ticket_type === 'work' ? [] : [t.pipeline_status, money(t.value)])].filter(Boolean).join(' · ');
/** " · $1,200,000" over the open pipeline tickets among these; nothing when they're all work tickets. */
const pipelineTotal = (open) => { const bids = open.filter((t) => t.ticket_type !== 'work'); return bids.length ? ` · ${money(bids.reduce((s, t) => s + (t.value || 0), 0))}` : ''; };
import { isClosed } from '../lib/lanes.js';
// Words too common in agency names to match on by themselves.
const GENERIC = new Set(['the', 'and', 'for', 'of', 'command', 'department', 'office', 'agency', 'systems', 'center', 'program', 'executive', 'directorate', 'division', 'service', 'services', 'administration', 'national', 'defense', 'force', 'air', 'u.s.', 'us']);

/**
 * Priority accounts: agencies, departments and organizations sorted into tiers (tiers, not a ranking), the pipeline and
 * work tickets that matter at each, and an ordered list of priority tickets picked from those. The tickets show as
 * standard ticket cards with a "Priority" tag. `userId` shows someone else's, read-only. `readOnly` shows anyone's for
 * review, your own included: the dashboards show them; they're arranged under Priorities → Strategic.
 */
export default function PriorityAccounts({ userId, name, readOnly = false }) {
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
  const edit = data.canEdit && !readOnly;
  const yours = data.canEdit; // your own, even when shown for review
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
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Building2 size={17} className="text-brand-600" /> {yours ? 'Priority accounts' : `${name}'s priority accounts`}</h2>
            <p className="text-xs text-slate-500">Agencies, departments and organizations in tiers.{edit ? ' Click a tier’s name to rename it, drag accounts between tiers, and click an account to choose its priority tickets.' : yours ? ' Arrange them under Priorities → Strategic.' : ''}</p>
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

// ---- An account: its pane works like a pipeline ticket's. Notes and documents go on the main pane (its hidden ticket's
// timeline); the strategy, activities, priority tickets and CRM open off the left edge.

/**
 * `people`, from the team roll-up, is who lists an account of this name: { list: [{ userId, label }], current, onPick }.
 * The pane shows one person's account at a time; the chips switch between them.
 */
export function AccountPanel({ account, tiers, edit, save, onClose, onOpenTicket, people, subtitle }) {
  const [name, setName] = useState(account.name);
  const [ticket, setTicket] = useState(null); // the hidden ticket that holds the account's notes, documents and activities
  const [tlKey, setTlKey] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    api.post(`/priority-accounts/accounts/${account.id}/activity-ticket`).then((d) => setTicket(d.ticket)).catch((e) => setError(e.message));
  }, [account.id]);
  const remove = () => {
    if (!window.confirm(`Remove ${account.name} and its activities? Your priority tickets stay on your list.`)) return;
    save(api.del(`/priority-accounts/accounts/${account.id}`)).then(onClose);
  };
  // The panes off the left edge, as on a ticket. Strategy saves as you leave its box; an activity asks before losing unsaved changes.
  const [tool, setTool] = useState(null);
  const [openActivity, setOpenActivity] = useState(null);
  const toolDirty = useRef(false);
  const setToolDirty = (v) => { toolDirty.current = v; };
  const leaveTool = () => !toolDirty.current || window.confirm('You have unsaved changes. Discard them?');
  const switchTool = (next) => { if (leaveTool()) { toolDirty.current = false; setOpenActivity(null); setTool(next); } };
  const showActivity = (id) => { if (leaveTool()) { toolDirty.current = false; setOpenActivity(id); setTool('activities'); } };
  const close = () => { if (leaveTool()) onClose(); };
  const changed = () => setTlKey((k) => k + 1);
  const focus = name.trim() || account.name; // the organization the CRM parts follow: whatever's in the Name field
  const moveTo = (tierId) => save(api.put('/priority-accounts/layout', {
    tiers: tiers.map((t) => ({ id: t.id, accounts: t.id === Number(tierId) ? [...t.accounts.map((a) => a.id).filter((x) => x !== account.id), account.id] : t.accounts.map((a) => a.id).filter((x) => x !== account.id) })),
  }));

  return (
    <SidePanel title={account.name} subtitle={subtitle || tiers.find((t) => t.id === account.tier_id)?.name} onClose={close} wide
      onEscape={tool ? () => switchTool(null) : close}
      rail={<PlanRail ticket={{ ticket_type: 'account' }} active={tool} onSelect={switchTool} />}
      drawer={tool === 'strategy' ? <StrategyDrawer account={account} organization={focus} edit={edit} save={save} onClose={() => switchTool(null)} />
        : tool === 'tickets' ? <TicketsDrawer account={account} edit={edit} save={save} onOpenTicket={onOpenTicket} onClose={() => switchTool(null)} />
          : tool && (ticket
            ? <PlanDrawer key={`${tool}-${openActivity}`} tool={tool} ticket={{ ...ticket, organization: focus }} activityId={openActivity} onClose={() => switchTool(null)} onChanged={changed} onDirty={setToolDirty} />
            : <DrawerShell title={tool === 'people' ? 'CRM' : 'Activity'} onClose={() => switchTool(null)}><p className="text-sm text-slate-400">Loading…</p></DrawerShell>)}
      footer={edit && (
        <div className="flex justify-between">
          <button type="button" className="btn-ghost text-red-600" onClick={remove}><Trash2 size={15} /> Remove account</button>
          <button type="button" className="btn-primary" onClick={close}>Done</button>
        </div>
      )}>
      <div className="space-y-5">
        {people && people.list.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>Listed by</span>
            {people.list.map((x) => (
              <button key={x.userId} type="button" onClick={() => people.onPick(x.userId)} aria-pressed={x.userId === people.current}
                className={`rounded-full px-2 py-0.5 ring-1 transition ${x.userId === people.current ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-500'}`}>
                {x.label}
              </button>
            ))}
          </div>
        )}
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
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {ticket ? <AccountTimeline ticketId={ticket.id} reloadKey={tlKey} onOpenActivity={showActivity} /> : !error && <p className="text-sm text-slate-400">Loading…</p>}
      </div>
    </SidePanel>
  );
}

/** The ticket icon's pane: the account's priority tickets, in the owner's order (dragged), and the open tickets to add. */
function TicketsDrawer({ account, edit, save, onOpenTicket, onClose }) {
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

  return (
    <DrawerShell title="Priority tickets" subtitle={account.name} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs text-slate-500">The pipeline and work tickets that matter at this account{edit ? ', in your order. Drag to reorder; click one to open it.' : '. Click one to open it.'}</p>
          {account.tickets.length ? (
            <AccountTicketList tickets={account.tickets} edit={edit} onOpen={onOpenTicket}
              onReorder={setTickets} onRemove={(id) => setTickets(chosen.filter((x) => x !== id))} />
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
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
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
    </DrawerShell>
  );
}

/** An account's priority tickets as a list, dragged by the handle into the owner's order. */
function AccountTicketList({ tickets, edit, onReorder, onRemove, onOpen }) {
  const [order, setOrder] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = order || tickets.map((t) => t.id);
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    setOrder(next);
    onReorder(next).finally(() => setOrder(null));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {ids.map((id, i) => byId.get(id) && <SortableAccountTicket key={id} n={i + 1} ticket={byId.get(id)} edit={edit} onOpen={onOpen} onRemove={onRemove} />)}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

function SortableAccountTicket({ n, ticket: t, edit, onOpen, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: t.id, disabled: !edit });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1.5 bg-white py-2 pr-2 text-sm first:rounded-t-lg last:rounded-b-lg ${edit ? 'pl-1' : 'pl-3'} ${isDragging ? 'relative z-10 opacity-60 shadow-lg' : ''}`}>
      {edit && (
        <span {...attributes} {...listeners} className="cursor-grab touch-none p-1 text-slate-300 hover:text-slate-500 active:cursor-grabbing" aria-label={`Move ${t.opportunity_title}`}>
          <GripVertical size={14} />
        </span>
      )}
      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 px-1 text-[11px] font-semibold text-white">{n}</span>
      <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => onOpen(t.id)}>
        <div className="flex items-center gap-1.5"><span className="truncate font-medium text-slate-800">{t.opportunity_title}</span><TicketKindTag ticket={t} /></div>
        <div className="truncate text-xs text-slate-500">{detail(t)}</div>
      </button>
      {edit && <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" onClick={() => onRemove(t.id)} aria-label={`Remove ${t.opportunity_title}`}><X size={14} /></button>}
    </li>
  );
}

/** The pawn's pane: the foothold strategies and the AI strategy session. */
function StrategyDrawer({ account, organization, edit, save, onClose }) {
  return (
    <DrawerShell title="Strategy" subtitle={account.name} onClose={onClose}>
      <div className="space-y-5">
        <AccountStrategies account={account} edit={edit} save={save} />
        <CrmObjectives organization={organization} account />
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

/** The owner's foothold strategies, top priority first, dragged by the handle into order. Each has a status of its own. */
function AccountStrategies({ account, edit, save }) {
  const [order, setOrder] = useState(null); // while a move saves
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => { setOrder(null); }, [account.strategies]);
  const byId = new Map(account.strategies.map((s) => [s.id, s]));
  const ids = (order || account.strategies.map((s) => s.id)).filter((id) => byId.has(id));
  const onDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    setOrder(next);
    save(api.put(`/priority-accounts/accounts/${account.id}/strategies`, { ids: next }));
  };
  const add = async () => {
    if (!draft.trim()) return;
    const d = await save(api.post(`/priority-accounts/accounts/${account.id}/strategies`, { body: draft }));
    if (d) { setDraft(''); setAdding(false); }
  };
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Foothold strategies</h3>
        {edit && ids.length > 1 && <p className="text-xs text-slate-500">Drag to set their priority. The top one comes first.</p>}
      </div>
      {!ids.length && !adding && <p className="text-sm text-slate-400">No strategies yet.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {ids.map((id, i) => <StrategyCard key={id} n={i + 1} strategy={byId.get(id)} edit={edit} save={save} accountName={account.name} />)}
          </ol>
        </SortableContext>
      </DndContext>
      {edit && (adding ? (
        <div className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5">
          <textarea rows={3} autoFocus className="input resize-y text-sm" maxLength={10000} aria-label={`New foothold strategy for ${account.name}`} value={draft}
            placeholder={`How will you gain a foothold at ${account.name}? Who to reach, where to start, what would open the door…`}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), add())} />
          <div className="flex justify-end gap-1.5">
            <button type="button" className="btn-ghost text-xs" onClick={() => { setAdding(false); setDraft(''); }}>Cancel</button>
            <button type="button" className="btn-primary text-xs" onClick={add} disabled={!draft.trim()}>Add strategy</button>
          </div>
        </div>
      ) : <button type="button" className="btn text-xs" onClick={() => setAdding(true)}><Plus size={14} /> Add a strategy</button>)}
    </div>
  );
}

/** One foothold strategy: its text and its status, each the card's full width. Its move and remove controls show on hover. */
function StrategyCard({ n, strategy: s, edit, save, accountName }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled: !edit });
  const update = (fields) => save(api.put(`/priority-accounts/strategies/${s.id}`, fields));
  const remove = () => { if (window.confirm('Remove this foothold strategy and its status?')) save(api.del(`/priority-accounts/strategies/${s.id}`)); };
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group rounded-lg border border-slate-200 bg-white p-2 ${isDragging ? 'relative z-10 opacity-60 shadow-lg' : ''}`}>
      {edit ? <StrategyText rows={4} value={s.body} required label={`Foothold strategy ${n} for ${accountName}`} onSave={(body) => update({ body })} />
        : <p className="text-sm whitespace-pre-wrap text-slate-700">{s.body}</p>}
      <div className="mt-1.5 mb-1 flex h-6 items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Status</span>
        {edit && (
          <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
            <span {...attributes} {...listeners} className="cursor-grab touch-none p-1 text-slate-400 hover:text-slate-600 active:cursor-grabbing" aria-label={`Move strategy ${n}`}>
              <GripVertical size={14} />
            </span>
            <button type="button" className="btn-ghost p-1 text-slate-400 hover:text-red-600" onClick={remove} title="Remove strategy" aria-label={`Remove strategy ${n}`}><Trash2 size={14} /></button>
          </span>
        )}
      </div>
      {edit ? <StrategyText rows={3} value={s.status || ''} label={`Status of strategy ${n}`} placeholder="Where does this stand? What’s next?" onSave={(status) => update({ status })} />
        : s.status ? <p className="text-sm whitespace-pre-wrap text-slate-700">{s.status}</p> : <p className="text-sm text-slate-400">No status yet.</p>}
    </li>
  );
}

/** A box that saves on leaving it, like the account's name. A `required` one goes back to what it was if emptied. */
function StrategyText({ value, required, label, onSave, rows, placeholder }) {
  const [text, setText] = useState(value);
  const [state, setState] = useState('');
  useEffect(() => { setText(value); }, [value]);
  const leave = async () => {
    const next = text.trim();
    if (next === value) return;
    if (required && !next) { setText(value); return; }
    setState('saving');
    const d = await onSave(next);
    setState(d ? 'saved' : 'failed');
  };
  return (
    <div>
      <textarea rows={rows} className="input resize-y text-sm" maxLength={10000} aria-label={label} placeholder={placeholder} value={text}
        onChange={(e) => { setText(e.target.value); setState(''); }} onBlur={leave} />
      {state && <p className={`mt-0.5 text-[11px] ${state === 'failed' ? 'text-red-600' : 'text-slate-400'}`}>{{ saving: 'Saving…', saved: 'Saved', failed: 'Couldn’t save. Try again.' }[state]}</p>}
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
