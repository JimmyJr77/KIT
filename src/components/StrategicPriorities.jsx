import { useEffect, useMemo, useState } from 'react';
import { Building2, Star, Users, UserRound } from 'lucide-react';
import { api } from '../lib/api.js';
import { fullName, initials } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import SidePanel from './SidePanel.jsx';
import PriorityAccounts from './PriorityAccounts.jsx';
import { TicketCard } from '../pages/Pipeline.jsx';
import TicketTimeline from '../pages/TicketTimeline.jsx';

const money = (n) => (n == null ? '—' : usd(n).replace('.00', ''));
const CLOSED = ['Awarded', 'Lost'];
const readPref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const hasAny = (p) => p.list.length > 0 || p.tiers.some((t) => t.accounts.length);

/**
 * Strategic priorities: the Priority accounts and Priority tickets people keep on My dashboard, for the members shown.
 * "Team" rolls everyone's up together (tiers merged by name, accounts by name, tickets ranked by how many people list
 * them); "By member" shows each person's own, exactly as on their dashboard (yours editable).
 */
export default function StrategicPriorities({ members, me }) {
  const [mode, setModeState] = useState(() => readPref('kit.priorities.strategic', 'team'));
  const setMode = (m) => { setModeState(m); writePref('kit.priorities.strategic', m); };
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const ids = members.map((m) => m.id).join(',');
  const load = () => (ids
    ? api.get(`/priority-accounts/people?users=${ids}`).then((d) => { setPeople(d.people); setError(''); }).catch((e) => setError(e.message))
    : Promise.resolve(setPeople([])));
  // Reload on switching views too, so changes made under By member show in the roll-up.
  useEffect(() => { load(); }, [ids, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const withSome = (people || []).filter(hasAny).map((p) => ({ ...p, member: byId.get(p.user_id) })).filter((p) => p.member);
  const without = members.filter((m) => !withSome.some((p) => p.user_id === m.id));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200" role="radiogroup" aria-label="Show strategic priorities">
          {[['team', 'Team', Users], ['members', 'By member', UserRound]].map(([k, label, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${mode === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {mode === 'team'
            ? `Everyone's priority accounts and tickets together: ${withSome.length} of ${members.length} ${members.length === 1 ? 'person has' : 'people have'} set some.`
            : 'Each person\'s priority accounts and tickets, as on their dashboard. Yours can be changed here.'}
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!people ? <p className="text-sm text-slate-400">Loading…</p> : mode === 'team'
        ? <TeamRollup people={withSome} />
        : <ByMember people={withSome} without={without} members={members} me={me} />}
    </div>
  );
}

function Avatar({ member, extra }) {
  return (
    <span title={`${fullName(member)}${extra ? ` · ${extra}` : ''}`}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700 ring-2 ring-white">
      {initials(member)}
    </span>
  );
}

function Avatars({ list, max = 4 }) {
  return (
    <span className="flex -space-x-1.5">
      {list.slice(0, max).map((x) => <Avatar key={x.member.id} member={x.member} extra={x.extra} />)}
      {list.length > max && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-600 ring-2 ring-white">+{list.length - max}</span>}
    </span>
  );
}

// ---- Team: everyone's together.

function TeamRollup({ people }) {
  const [openAccount, setOpenAccount] = useState(null);
  const [ticketId, setTicketId] = useState(null);
  const [ticketStep, setTicketStep] = useState(undefined);
  const [cards, setCards] = useState([]);

  // Tiers merged by name (Tier 1 with Tier 1), in their usual order; accounts merged by name within a tier.
  const tiers = useMemo(() => {
    const cols = new Map();
    people.forEach((p) => p.tiers.forEach((t, i) => {
      const key = t.name.trim().toLowerCase();
      if (!cols.has(key)) cols.set(key, { key, name: t.name, positions: [], accounts: new Map() });
      const col = cols.get(key);
      col.positions.push(i);
      t.accounts.forEach((a) => {
        const ak = a.name.trim().toLowerCase();
        if (!col.accounts.has(ak)) col.accounts.set(ak, { key: `${key}|${ak}`, name: a.name, tier: t.name, people: [], tickets: new Map() });
        const acc = col.accounts.get(ak);
        acc.people.push({ member: p.member, extra: t.name });
        a.tickets.forEach((k) => {
          if (!acc.tickets.has(k.id)) acc.tickets.set(k.id, { ...k, people: [] });
          acc.tickets.get(k.id).people.push({ member: p.member });
        });
      });
    }));
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
    return [...cols.values()]
      .map((c) => ({ ...c, accounts: [...c.accounts.values()].map((a) => ({ ...a, tickets: [...a.tickets.values()] }))
        .sort((a, b) => b.people.length - a.people.length || a.name.localeCompare(b.name)) }))
      .filter((c) => c.accounts.length)
      .sort((a, b) => avg(a.positions) - avg(b.positions));
  }, [people]);

  // Priority tickets: those more people list come first, then by how high they're ranked.
  const ranked = useMemo(() => {
    const m = new Map();
    people.forEach((p) => p.list.forEach((id, i) => {
      if (!m.has(id)) m.set(id, { id, people: [] });
      m.get(id).people.push({ member: p.member, rank: i + 1, extra: `#${i + 1} on their list` });
    }));
    const best = (x) => Math.min(...x.people.map((y) => y.rank));
    const mean = (x) => x.people.reduce((s, y) => s + y.rank, 0) / x.people.length;
    return [...m.values()].sort((a, b) => b.people.length - a.people.length || best(a) - best(b) || mean(a) - mean(b));
  }, [people]);
  const idKey = ranked.map((x) => x.id).sort((a, b) => a - b).join(',');
  const loadCards = () => (idKey ? api.get(`/tickets?scope=all&kind=bid&ids=${idKey}`).then((d) => setCards(d.tickets)) : Promise.resolve(setCards([])));
  useEffect(() => { loadCards(); }, [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const list = ranked.filter((x) => cardById.has(x.id));
  const account = openAccount && tiers.flatMap((t) => t.accounts).find((a) => a.key === openAccount);

  if (!people.length) {
    return <p className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">No strategic priorities yet. Each person sets theirs under By member, or at the top of My dashboard.</p>;
  }
  return (
    <section className="space-y-5">
      <div>
        <div className="mb-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Building2 size={17} className="text-brand-600" /> Priority accounts</h2>
          <p className="text-xs text-slate-500">Everyone&apos;s tiers together. Faces show who lists each account; click one to see its priority pipeline tickets.</p>
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))]">
          {tiers.map((t) => (
            <div key={t.key} className="flex flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">{t.name} <span className="font-normal text-slate-400">{t.accounts.length}</span></h3>
              <div className="flex flex-col gap-1.5">
                {t.accounts.map((a) => {
                  const open = a.tickets.filter((k) => !CLOSED.includes(k.pipeline_status));
                  return (
                    <button key={a.key} type="button" onClick={() => setOpenAccount(a.key)}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-sm hover:border-brand-500">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{a.name}</span>
                        <span className="block text-[11px] text-slate-500">{a.tickets.length ? `${a.tickets.length} ticket${a.tickets.length === 1 ? '' : 's'} · ${money(open.reduce((s, k) => s + (k.value || 0), 0))}` : 'No tickets'}</span>
                      </span>
                      <Avatars list={a.people} max={3} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!tiers.length && <p className="text-sm text-slate-400">No priority accounts yet.</p>}
        </div>
      </div>

      <div>
        <div className="mb-3">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><Star size={17} className="fill-amber-400 text-amber-500" /> Priority tickets</h2>
          <p className="text-xs text-slate-500">Everyone&apos;s priority tickets together. Those on more lists come first, then those ranked higher. Faces show whose list each is on.</p>
        </div>
        {list.length ? (
          <ol className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {list.map((x, i) => (
              <li key={x.id} className="relative flex flex-col">
                <span className="absolute -top-2 -left-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-slate-800 px-1 text-[11px] font-semibold text-white">{i + 1}</span>
                <div role="button" tabIndex={-1} className="cursor-pointer" onClick={() => { setTicketStep(undefined); setTicketId(x.id); }}>
                  <TicketCard ticket={cardById.get(x.id)} onOpenStep={(t) => { setTicketStep(t.next_step?.id ?? null); setTicketId(t.id); }} />
                </div>
                <div className="mt-1.5 flex items-center gap-2 px-1 text-[11px] text-slate-500">
                  <Avatars list={x.people} max={5} />
                  <span className="truncate">{x.people.map((y) => `#${y.rank} ${y.member.first_name}`).join(' · ')}</span>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-400">No priority tickets yet.</p>
        )}
      </div>

      {account && (
        <SidePanel title={account.name} subtitle={`${account.tier} · listed by ${account.people.map((p) => fullName(p.member)).join(', ')}`} onClose={() => setOpenAccount(null)} wide>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Priority pipeline tickets</h3>
          {account.tickets.length ? (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {account.tickets.map((k) => (
                <li key={k.id}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { setTicketStep(undefined); setTicketId(k.id); }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-800">{k.opportunity_title}</span>
                      <span className="block truncate text-xs text-slate-500">{[k.organization, k.pipeline_status, money(k.value)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <Avatars list={k.people} max={4} />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">No pipeline tickets chosen for this account.</p>}
        </SidePanel>
      )}
      {ticketId && <TicketTimeline key={`${ticketId}-${ticketStep}`} ticketId={ticketId} activityId={ticketStep} onClose={() => { setTicketId(null); loadCards(); }} onChanged={loadCards} />}
    </section>
  );
}

// ---- By member: each person's own, as on their dashboard.

function ByMember({ people, without, members, me }) {
  // You always appear (if you're shown), so you can set yours up here.
  const mine = members.find((m) => m.id === me);
  const shown = [
    ...(mine ? [mine] : []),
    ...people.map((p) => p.member).filter((m) => m.id !== me),
  ];
  const rest = without.filter((m) => m.id !== me);
  return (
    <div className="space-y-4">
      {shown.map((m) => (
        <section key={m.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <header className="mb-4 flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials(m)}</div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{fullName(m)}{m.id === me && <span className="ml-1.5 font-normal text-slate-400">(you)</span>}</div>
              <div className="truncate text-xs text-slate-500">{[m.title, m.team_name].filter(Boolean).join(' · ')}</div>
            </div>
          </header>
          <PriorityAccounts userId={m.id === me ? undefined : m.id} name={fullName(m)} />
        </section>
      ))}
      {!shown.length && <p className="rounded-xl border-2 border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Nobody shown has set strategic priorities yet.</p>}
      {rest.length > 0 && (
        <p className="text-xs text-slate-500"><span className="font-medium text-slate-600">No strategic priorities yet:</span> {rest.map(fullName).join(', ')}</p>
      )}
    </div>
  );
}
