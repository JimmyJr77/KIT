import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Package, CheckSquare, MessageSquare, Paperclip, ListOrdered, UserRound, Plus, ArrowDownAZ, Columns3, Archive, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ago, fullName, fullStamp, ticketKind } from '../lib/format.js';
import { useApi } from '../lib/data.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import MultiSelect from '../components/MultiSelect.jsx';
import TicketTimeline from './TicketTimeline.jsx';
import NewTicketPanel from './NewTicketPanel.jsx';
import TicketLanes from './TicketLanes.jsx';
import SidePanel from '../components/SidePanel.jsx';
import { stamp } from '../lib/format.js';

/** Every master ticket the user created or has priorities on. */
export default function Tickets() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const teams = useApi('/teams');
  const ownersApi = useApi('/tickets/owners');
  const [scope, setScope] = useState('mine'); // mine | all | filter
  const [teamId, setTeamId] = useState('');
  const [owners, setOwners] = useState([]);
  const [q, setQ] = useState('');
  const [tickets, setTickets] = useState(null);
  const [creating, setCreating] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  // Alphabetical cards or swim lanes; the choice is remembered on this browser.
  const [view, setViewState] = useState(() => { try { return localStorage.getItem('kit.tickets.view') || 'az'; } catch { return 'az'; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem('kit.tickets.view', v); } catch { /* ignore */ } };
  const openId = Number(params.get('open')) || null;

  // Account holders: people who own at least one master ticket, narrowed to the chosen team.
  const ownerOptions = (ownersApi.data?.owners || [])
    .filter((o) => !teamId || o.team_id === Number(teamId))
    .map((o) => ({ value: o.id, label: fullName(o), sub: `${o.team_name || 'No team'} · ${o.ticket_count} ticket${o.ticket_count === 1 ? '' : 's'}` }));
  // Drop selected people who aren't on the newly chosen team.
  useEffect(() => {
    const allowed = new Set(ownerOptions.map((o) => o.value));
    setOwners((xs) => (xs.every((x) => allowed.has(x)) ? xs : xs.filter((x) => allowed.has(x))));
  }, [teamId, ownersApi.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => {
    const p = new URLSearchParams({ scope, q });
    if (scope !== 'mine' && teamId) p.set('team', teamId);
    if (scope === 'filter' && owners.length) p.set('owners', owners.join(','));
    return api.get(`/tickets?${p}`).then((d) => setTickets(d.tickets));
  };
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [scope, q, teamId, owners]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id) => setParams(id ? { open: String(id) } : {});
  // Archived tickets leave both views; they live in the archive.
  const live = (tickets || []).filter((t) => !t.archived)
    .sort((a, b) => a.opportunity_title.localeCompare(b.opportunity_title, undefined, { sensitivity: 'base' }));
  const archived = (tickets || []).filter((t) => t.archived);
  const restore = async (t) => { await api.put(`/tickets/${t.id}/lane`, { archived: false }); load(); };

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Tickets" subtitle="Master tickets you own or work on. Select one for its timeline.">
        {/* Team and the toggle share one height (h-9). Team narrows All tickets and Filter tickets. */}
        <select className="input h-9 w-44 py-0" value={teamId} onChange={(e) => setTeamId(e.target.value)} disabled={scope === 'mine'}
          aria-label="Team" title={scope === 'mine' ? 'Team applies to All tickets and Filter tickets' : 'Team'}>
          <option value="">All teams</option>
          {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300">
          {[['mine', 'My tickets'], ['all', 'All tickets'], ['filter', 'Filter tickets']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)}
              className={`rounded px-3 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search by opportunity or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" onClick={() => setCreating(true)} title="New ticket" aria-label="New ticket"
            className="btn-primary h-[38px] w-[38px] shrink-0 p-0"><Plus size={18} /></button>
        <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="radiogroup" aria-label="View">
          {[['az', 'A–Z', ArrowDownAZ], ['lanes', 'Swim lanes', Columns3]].map(([k, l, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} title={l} aria-label={l}
              className={`grid w-[34px] place-items-center rounded ${view === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              <Icon size={16} />
            </button>
          ))}
        </div>
        <button type="button" className="btn relative h-[38px] w-[38px] p-0" onClick={() => setArchiveOpen(true)}
          title={`Archive: done tickets, archived after 14 days or by hand${archived.length ? ` (${archived.length})` : ''}`} aria-label="Archive">
          <Archive size={16} />
          {archived.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-slate-500 px-1 text-[10px] font-semibold text-white">{archived.length}</span>
          )}
        </button>
        {scope === 'filter' && (
          <div className="min-w-72 flex-1">
            <label className="label">Account holders</label>
            <MultiSelect options={ownerOptions} value={owners} onChange={setOwners}
              placeholder={ownerOptions.length ? 'Everyone — type a name to filter…' : 'No one on this team owns a ticket'} />
          </div>
        )}
      </div>

      {tickets && !live.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Package size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'No tickets match your search.' : scope === 'mine'
            ? `No master tickets yet, ${user.first_name}. They appear here once you create a priority or are assigned to one.`
            : 'No master tickets yet.'}
        </div>
      )}

      {view === 'lanes' && tickets && live.length > 0 && <TicketLanes tickets={live} onOpen={open} onChanged={load} />}

      {view === 'az' && <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
        {live.map((t) => (
          <button key={t.id} type="button" onClick={() => open(t.id)}
            className={`flex flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md ${openId === t.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0">
                  <div className="font-semibold leading-snug text-slate-900">{t.opportunity_title}</div>
                  <div className="truncate text-xs text-slate-500">{t.organization || `Ticket #${t.id}`}</div>
                  {t.owner_first_name && (
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-400">
                      <UserRound size={11} /> {t.owner_first_name} {t.owner_last_name}{t.owner_team && ` · ${t.owner_team}`}
                    </div>
                  )}
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-slate-400" title={fullStamp(t.last_activity)}>{ago(t.last_activity)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              <span className={`rounded px-1.5 py-0.5 font-semibold ${t.ticket_type === 'work' ? 'bg-slate-200 text-slate-700' : 'bg-brand-50 text-brand-700'}`}>{ticketKind(t)}</span>
              {t.pipeline_status && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{t.pipeline_status}</span>}
              {t.value != null && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{usd(t.value).replace('.00', '')}</span>}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-xs text-slate-500">
              <Stat icon={ListOrdered} n={t.card_count} label="priorit" plural={['y', 'ies']} />
              <span className="flex items-center gap-1" title="Tasks done / total"><CheckSquare size={12} /> {t.tasks.done}/{t.tasks.open + t.tasks.done}</span>
              {t.question_count > 0 && <Stat icon={MessageSquare} n={t.question_count} label="question" plural={['', 's']} accent />}
              {t.comment_count > 0 && <Stat icon={MessageSquare} n={t.comment_count} label="comment" plural={['', 's']} />}
              {t.file_count > 0 && <Stat icon={Paperclip} n={t.file_count} label="document" plural={['', 's']} />}
            </div>
          </button>
        ))}
      </div>}

      {archiveOpen && (
        <SidePanel title="Archive" subtitle="Done tickets leave the board 14 days after reaching Done, or when archived by hand" onClose={() => setArchiveOpen(false)}>
          {archived.length ? (
            <ul className="space-y-2">
              {archived.map((t) => (
                <li key={t.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { setArchiveOpen(false); open(t.id); }}>
                    <div className="truncate text-sm font-semibold text-slate-800 hover:text-brand-700">{t.opportunity_title}</div>
                    <div className="text-xs text-slate-500">
                      {[ticketKind(t), t.pipeline_status, t.archived_at ? `archived ${stamp(t.archived_at)}` : t.done_at ? `done ${stamp(t.done_at)}` : null].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                  <button type="button" className="btn shrink-0 px-2.5 py-1 text-xs" onClick={() => restore(t)} title="Put it back in Done for another 14 days">
                    <RotateCcw size={13} /> Restore
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">Nothing archived{scope === 'mine' ? ' among your tickets' : ''} yet.</p>}
        </SidePanel>
      )}

      {creating && (
        <NewTicketPanel onClose={() => setCreating(false)}
          onCreated={(t) => { setCreating(false); load(); open(t.id); }} />
      )}

      {openId && <TicketTimeline key={openId} ticketId={openId} focus={params.get('focus')} onClose={() => open(null)} onChanged={load} />}
    </div>
  );
}

function Stat({ icon: Icon, n, label, plural, accent }) {
  return (
    <span className={`flex items-center gap-1 ${accent ? 'text-amber-700' : ''}`}>
      <Icon size={12} /> {n} {label}{n === 1 ? plural[0] : plural[1]}
    </span>
  );
}
