import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Package, CheckSquare, MessageSquare, Paperclip, ListOrdered } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { ago, fullStamp } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import PageHeader from '../components/PageHeader.jsx';
import TicketTimeline from './TicketTimeline.jsx';

/** Every master ticket the user created or has priorities on. */
export default function Tickets() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [scope, setScope] = useState('mine');
  const [q, setQ] = useState('');
  const [tickets, setTickets] = useState(null);
  const openId = Number(params.get('open')) || null;

  const load = () => api.get(`/tickets?scope=${scope}&q=${encodeURIComponent(q)}`).then((d) => setTickets(d.tickets));
  useEffect(() => {
    const h = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(h);
  }, [scope, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id) => setParams(id ? { open: String(id) } : {});

  return (
    <div className="space-y-5 p-8">
      <PageHeader title="Tickets" subtitle="Master tickets you created or have priorities on. Select one to see its full timeline.">
        <div className="flex rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-200">
          {[['mine', 'My tickets'], ['all', 'All tickets']].map(([k, l]) => (
            <button key={k} type="button" onClick={() => setScope(k)}
              className={`rounded px-3 py-1.5 ${scope === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
          ))}
        </div>
      </PageHeader>

      <div className="relative max-w-md">
        <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
        <input className="input pl-9" placeholder="Search by opportunity or organization…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {tickets && !tickets.length && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-400">
          <Package size={28} className="mx-auto mb-2 text-slate-300" />
          {q ? 'No tickets match your search.' : scope === 'mine'
            ? `No master tickets yet, ${user.first_name}. They appear here once you create a priority or are assigned to one.`
            : 'No master tickets yet.'}
        </div>
      )}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
        {tickets?.map((t) => (
          <button key={t.id} type="button" onClick={() => open(t.id)}
            className={`flex flex-col rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md ${openId === t.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <Package size={16} className="mt-0.5 shrink-0 text-brand-600" />
                <div className="min-w-0">
                  <div className="font-semibold leading-snug text-slate-900">{t.opportunity_title}</div>
                  <div className="truncate text-xs text-slate-500">{t.organization || `Ticket #${t.id}`}</div>
                </div>
              </div>
              <span className="shrink-0 text-[11px] text-slate-400" title={fullStamp(t.last_activity)}>{ago(t.last_activity)}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
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
      </div>

      {openId && <TicketTimeline key={openId} ticketId={openId} onClose={() => open(null)} onChanged={load} />}
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
