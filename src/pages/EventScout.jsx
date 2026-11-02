import { Fragment, useState } from 'react';
import { Search, RefreshCw, Sparkles, ExternalLink, MapPin, X, Plus, CalendarPlus, Check, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { shortDate } from '../lib/format.js';
import { usd } from '../lib/travelCalc.js';
import { locationLabel } from '../components/LocationInput.jsx';

const money = (n) => usd(n).replace('.00', '');
const dates = (e) => {
  if (!e.date_from) return <span className="text-slate-400">Dates TBA</span>;
  const year = { month: 'short', day: 'numeric', year: 'numeric' };
  if (!e.date_to || e.date_from === e.date_to) return shortDate(e.date_from, year);
  return `${shortDate(e.date_from)} – ${shortDate(e.date_to, year)}`;
};
const text = (e) => [e.name, e.description, e.goal, e.notes, e.address, e.prompt, locationLabel(e.location)].filter(Boolean).join(' ').toLowerCase();

/** 1–5 dots: how worth attending the scout thinks it is. */
function Relevance({ n }) {
  return (
    <span className="flex gap-0.5" title={`Relevance ${n} of 5`} aria-label={`Relevance ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= n ? 'bg-brand-600' : 'bg-slate-200'}`} />)}
    </span>
  );
}

/**
 * Potential events in the same columns as the Events list. A row opens to show the rest of its details.
 * `actions(e)` renders the buttons at the end of each row.
 */
function CandidateTable({ rows, actions }) {
  const [openId, setOpenId] = useState(null);
  const id = (e, i) => e.id ?? `s${i}`;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-3">Event</th><th className="px-4 py-3">Dates</th><th className="px-4 py-3">Goal / benefit</th>
            <th className="px-4 py-3 text-right">Fee</th><th className="px-4 py-3">Relevance</th><th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => {
            const expanded = openId === id(e, i);
            return (
              <Fragment key={id(e, i)}>
                <tr onClick={() => setOpenId(expanded ? null : id(e, i))} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-1.5">
                      {expanded ? <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-400" /> : <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-400" />}
                      <div>
                        <div className="font-semibold text-slate-900">{e.name}</div>
                        {locationLabel(e.location) && <div className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={11} /> {locationLabel(e.location)}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-700">{dates(e)}</td>
                  <td className="max-w-sm px-4 py-3 text-slate-600"><p className="line-clamp-2">{e.goal || <span className="text-slate-300">—</span>}</p></td>
                  <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{e.fee != null ? (e.fee ? money(e.fee) : 'Free') : <span className="text-slate-300">—</span>}</td>
                  <td className="px-4 py-3"><Relevance n={e.relevance || 3} /></td>
                  <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1.5">
                      {e.website && (
                        <a href={e.website} target="_blank" rel="noreferrer" className="btn px-2 py-1" title="Open website" aria-label="Open website"><ExternalLink size={13} /></a>
                      )}
                      {actions(e)}
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-t border-slate-100 bg-slate-50/60">
                    <td colSpan={6} className="px-4 py-3">
                      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
                        {[['Description', e.description], ['Notes', e.notes], ['POC', [e.poc_name, e.poc_phone].filter(Boolean).join(' · ')],
                          ['Address', e.address], ['Found by', e.prompt ? `Search: “${e.prompt}”` : e.source === 'refresh' ? 'Scout refresh' : null]]
                          .filter(([, v]) => v).map(([k, v]) => (
                            <div key={k}><dt className="font-semibold text-slate-500 uppercase">{k}</dt><dd className="whitespace-pre-wrap text-slate-700">{v}</dd></div>
                          ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Sources({ sources }) {
  if (!sources?.length) return null;
  return (
    <details className="text-xs text-slate-500">
      <summary className="cursor-pointer">{sources.length} web source{sources.length === 1 ? '' : 's'}</summary>
      <ul className="mt-1 space-y-0.5">
        {sources.map((s, i) => <li key={i}><a href={s.uri} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{s.title}</a></li>)}
      </ul>
    </details>
  );
}

/**
 * The running list of potential events the scout has found. Refresh runs the scout again and appends what's new;
 * nothing comes off the list unless someone adds it to Events or dismisses it.
 */
export function PotentialEvents({ candidates, setCandidates, configured, onAddToEvents }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [sources, setSources] = useState(null);
  const [fresh, setFresh] = useState([]); // ids the last refresh added

  const refresh = async () => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      const r = await api.post('/event-scout/refresh', {});
      setCandidates(r.candidates);
      setFresh(r.added);
      setSources(r.sources);
      setNote(r.added.length ? `Added ${r.added.length} new event${r.added.length === 1 ? '' : 's'}.` : 'Nothing new this time.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async (c) => {
    if (!confirm(`Take “${c.name}” off the potential list? The scout won't suggest it again.`)) return;
    await api.del(`/event-scout/${c.id}`);
    setCandidates((xs) => xs.filter((x) => x.id !== c.id));
  };

  const s = q.trim().toLowerCase();
  const shown = (candidates || []).filter((c) => !s || text(c).includes(s));

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold text-slate-900"><Sparkles size={17} className="text-brand-600" /> Potential events</h2>
          <p className="text-sm text-slate-500">Found by the event scout. Refresh to look again; new finds are added, nothing is removed.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-72">
            <Search size={15} className="absolute top-2.5 left-3 text-slate-400" />
            <input className="input pl-9" placeholder="Filter potential events…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="btn h-[38px]" onClick={refresh} disabled={busy || !configured}
            title={configured ? 'Search the web for upcoming events and add new ones to this list' : 'Needs Gemini (GEMINI_API_KEY)'}>
            <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> {busy ? 'Searching…' : 'Refresh'}
          </button>
        </div>
      </div>
      {(busy || note || error) && (
        <p className={`text-sm ${error ? 'text-red-600' : busy ? 'text-slate-500' : 'text-emerald-700'}`}>
          {error || (busy ? 'Searching the web for upcoming events. This can take up to a minute.' : note)}
        </p>
      )}
      <Sources sources={sources} />

      {candidates && !shown.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white py-10 text-center text-sm text-slate-400">
          {s ? 'No potential events match your filter.' : configured ? 'No potential events yet. Click Refresh to have the scout look.' : 'The event scout needs Gemini (set GEMINI_API_KEY on the server).'}
        </div>
      ) : shown.length > 0 && (
        <CandidateTable rows={shown} actions={(c) => (
          <>
            {fresh.includes(c.id) && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">New</span>}
            <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => onAddToEvents(c)}><CalendarPlus size={13} /> Add to events</button>
            <button type="button" className="btn px-2 py-1" onClick={() => dismiss(c)} title="Dismiss" aria-label={`Dismiss ${c.name}`}><X size={13} /></button>
          </>
        )} />
      )}
    </section>
  );
}

/**
 * Ask the scout for something specific. It points at events already on either list that fit, and suggests new ones,
 * which can go on the potential list or straight onto Events.
 */
export function EventSearch({ configured, onAddToEvents, onAddedToPotential, onOpenEvent }) {
  const [prompt, setPrompt] = useState('');
  const [asked, setAsked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { matches, suggestions, sources }
  const [done, setDone] = useState({}); // suggestion index → 'potential' | 'event'

  const search = async (e) => {
    e?.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/event-scout/search', { prompt });
      setResult(r);
      setAsked(prompt.trim());
      setDone({});
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const toPotential = async (s, i) => {
    try {
      const r = await api.post('/event-scout', { ...s, ...s.location, prompt: asked });
      onAddedToPotential(r.candidate);
      setDone((d) => ({ ...d, [i]: 'potential' }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-lg font-semibold text-slate-900"><Search size={17} className="text-brand-600" /> Find events</h2>
        <p className="text-sm text-slate-500">Describe what you’re after: a customer, a technology, a region, a timeframe. The scout checks both lists and suggests new events.</p>
      </div>
      <form onSubmit={search} className="flex flex-wrap items-start gap-2">
        <textarea className="input min-h-[38px] flex-1 basis-80 text-sm" rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) search(e); }}
          placeholder="e.g. Army aviation industry days in the Southeast this spring, or AI/ML events where Air Force program offices present" />
        <button type="submit" className="btn-primary h-[38px]" disabled={busy || !prompt.trim() || !configured}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> Searching…</> : <><Sparkles size={15} /> Search</>}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {busy && <p className="text-sm text-slate-500">Searching the web and your lists. This can take up to a minute.</p>}

      {result && !busy && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Already on your lists</h3>
            {result.matches.length ? (
              <ul className="space-y-1.5">
                {result.matches.map((m) => (
                  <li key={`${m.kind}${m.id}`} className="flex flex-wrap items-baseline gap-x-2 rounded-md bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${m.kind === 'event' ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800'}`}>
                      {m.kind === 'event' ? 'Event' : 'Potential'}
                    </span>
                    {m.kind === 'event'
                      ? <button type="button" className="font-semibold text-brand-700 hover:underline" onClick={() => onOpenEvent(m.id)}>{m.name}</button>
                      : <span className="font-semibold text-slate-900">{m.name}</span>}
                    <span className="text-xs text-slate-500">{dates(m)}</span>
                    <span className="basis-full text-slate-600">{m.reason}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-400">Nothing on either list fits this search.</p>}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">New suggestions</h3>
            {result.suggestions.length ? (
              <CandidateTable rows={result.suggestions.map((s) => ({ ...s, prompt: asked }))} actions={(s) => {
                const i = result.suggestions.findIndex((x) => x.name === s.name);
                if (done[i]) return <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={13} /> {done[i] === 'event' ? 'On events' : 'On potential list'}</span>;
                return (
                  <>
                    <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => toPotential(s, i)} title="Add to the potential events list"><Plus size={13} /> Potential</button>
                    <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => onAddToEvents(s, () => setDone((d) => ({ ...d, [i]: 'event' })))}>
                      <CalendarPlus size={13} /> Add to events
                    </button>
                  </>
                );
              }} />
            ) : <p className="text-sm text-slate-400">No new events found. Try wording it differently or widening the timeframe.</p>}
          </div>
          <Sources sources={result.sources} />
        </div>
      )}
    </section>
  );
}
