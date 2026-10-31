import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive as ArchiveIcon, RotateCcw, Trash2, Search } from 'lucide-react';
import { api } from '../lib/api.js';
import { stamp, shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';

const money = (n) => (n == null ? '' : usd(n).replace('.00', ''));
const TABS = [['bid', 'Bid tickets'], ['work', 'Work tickets'], ['cards', 'Priority cards']];

/**
 * Everything taken off the boards: bid tickets, work tickets and priority cards. Select some or all to restore them,
 * or (admins) delete them for good.
 */
export default function Archive() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'bid';
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = () => api.get('/archive').then(setData);
  useEffect(() => { load(); }, []);
  useEffect(() => { setSelected(new Set()); }, [tab]);

  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const list = tab === 'cards'
      ? data.cards.map((c) => ({ ...c, key: c.id, search: `${c.title} ${c.opportunity_title} ${c.team_name} ${c.assignees.join(' ')}` }))
      : data.tickets.filter((t) => t.ticket_type === tab).map((t) => ({ ...t, key: t.id, search: `${t.opportunity_title} ${t.organization || ''} ${t.owner || ''}` }));
    return list.filter((r) => !s || r.search.toLowerCase().includes(s));
  }, [data, tab, q]);
  const counts = data && { bid: data.tickets.filter((t) => t.ticket_type === 'bid').length, work: data.tickets.filter((t) => t.ticket_type === 'work').length, cards: data.cards.length };

  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.key)));
  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const picked = rows.filter((r) => selected.has(r.key));
  const body = () => (tab === 'cards' ? { cards: picked.map((r) => r.id) } : { tickets: picked.map((r) => r.id) });
  const noun = (n) => (tab === 'cards' ? `priority card${n === 1 ? '' : 's'}` : `${tab} ticket${n === 1 ? '' : 's'}`);

  const run = async (fn, done) => {
    setBusy(true);
    setMsg(null);
    try { const r = await fn(); setSelected(new Set()); await load(); setMsg({ ok: true, text: done(r) }); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };
  const restore = () => run(() => api.post('/archive/restore', body()), () => `Restored ${picked.length} ${noun(picked.length)}.`);
  const remove = () => {
    const cards = tab === 'cards' ? 0 : picked.reduce((s, r) => s + r.card_count, 0);
    const files = tab === 'cards' ? 0 : picked.reduce((s, r) => s + r.file_count, 0);
    const extra = [cards && `${cards} priority card${cards === 1 ? '' : 's'}`, files && `${files} document${files === 1 ? '' : 's'}`].filter(Boolean);
    const text = `Permanently delete ${picked.length} ${noun(picked.length)}?${extra.length ? ` This also deletes ${extra.join(' and ')} on ${picked.length === 1 ? 'it' : 'them'}, plus comments, tasks and history.` : ''}\n\nThis can't be undone.`;
    if (!confirm(text)) return;
    run(() => api.post('/archive/delete', body()), (r) => `Deleted ${r.deleted.tickets ? `${r.deleted.tickets} ticket${r.deleted.tickets === 1 ? '' : 's'} and ` : ''}${r.deleted.cards} priority card${r.deleted.cards === 1 ? '' : 's'} for good.`);
  };

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Archive" subtitle="Tickets and priority cards taken off the boards. Restore them, or delete them for good.">
        <div className="flex h-9 rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams({ tab: k })}
              className={`rounded px-3 whitespace-nowrap ${tab === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>
              {l}{counts && <span className="ml-1 opacity-70">{counts[k]}</span>}
            </button>
          ))}
        </div>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
          <input className="input pl-9" placeholder="Search the archive…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="mr-auto text-sm text-slate-500">{picked.length ? `${picked.length} selected` : ''}</span>
        <button type="button" className="btn" onClick={restore} disabled={!picked.length || busy}><RotateCcw size={15} /> Restore</button>
        {data?.canDelete && (
          <button type="button" className="btn-danger" onClick={remove} disabled={!picked.length || busy}><Trash2 size={15} /> Delete permanently</button>
        )}
      </div>
      {msg && <p className={`rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</p>}

      {data && !rows.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <ArchiveIcon size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'Nothing in the archive matches.' : `No archived ${tab === 'cards' ? 'priority cards' : `${tab} tickets`}.`}
        </div>
      ) : data && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={allOn} onChange={toggleAll} aria-label="Select all" />
                </th>
                {tab === 'cards'
                  ? <><th className="px-3 py-2.5">Priority</th><th className="px-3 py-2.5">Ticket</th><th className="px-3 py-2.5">Team · week</th><th className="px-3 py-2.5">Assigned</th><th className="px-3 py-2.5">Archived</th></>
                  : <><th className="px-3 py-2.5">Ticket</th><th className="px-3 py-2.5">{tab === 'bid' ? 'Stage · value' : 'Owner'}</th><th className="px-3 py-2.5 text-right">Priorities</th><th className="px-3 py-2.5">Archived</th></>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className={`border-t border-slate-100 ${selected.has(r.key) ? 'bg-brand-50/50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2.5">
                    <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={selected.has(r.key)} onChange={() => toggle(r.key)}
                      aria-label={`Select ${tab === 'cards' ? r.title || 'priority' : r.opportunity_title}`} />
                  </td>
                  {tab === 'cards' ? (
                    <>
                      <td className="px-3 py-2.5 font-medium text-slate-800">{r.title || 'Untitled priority'}<div className="text-xs font-normal text-slate-400">{r.completed ? 'Completed' : 'Open'} · {r.tasks} task{r.tasks === 1 ? '' : 's'}</div></td>
                      <td className="px-3 py-2.5 text-slate-600">{r.opportunity_title}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{r.team_name} · {shortDate(r.week_start, { month: 'short', day: 'numeric' })}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.assignees.join(', ') || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{stamp(r.archived_at)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5">
                        <button type="button" className="text-left font-medium text-slate-800 hover:underline" onClick={() => navigate(`/tickets?open=${r.id}`)}>{r.opportunity_title}</button>
                        <div className="text-xs text-slate-400">{r.organization || `Ticket #${r.id}`}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{tab === 'bid' ? [r.pipeline_status, money(r.value)].filter(Boolean).join(' · ') || '—' : r.owner || '—'}</td>
                      <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums">{r.card_count}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-slate-500">{r.archived_at ? stamp(r.archived_at) : `Done ${stamp(r.done_at)} (auto)`}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && !data.canDelete && <p className="text-xs text-slate-500">Only admins can delete permanently.</p>}
    </div>
  );
}
