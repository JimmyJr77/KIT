import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, RefreshCw, Upload, Settings, Settings2, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Receipt, Trash2, Loader2, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { usd, upcomingQuarters, shiftQuarter } from '../lib/travelCalc.js';
import { fullName, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import UserCombobox from '../components/UserCombobox.jsx';
import { locationLabel } from '../components/LocationInput.jsx';
import { LockButton, EstimateLockPanel } from '../components/EstimateLock.jsx';
import TripForm, { newTrip, tripFromEvent, travelFromOf, ApprovalBadge } from './TripForm.jsx';

export default function Travel() {
  const { user, setUser } = useAuth();
  const from = travelFromOf(user);
  const users = useApi('/users');
  const teams = useApi('/teams');
  const meta = useApi('/travel/meta');
  const [traveler, setTraveler] = useState(null);
  const [team, setTeam] = useState('');
  const [quarter, setQuarter] = useState('');
  const [month, setMonth] = useState(''); // an actual spend month card's month, "2026-11": the actual costs list shows only that month
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [trips, setTrips] = useState([]);
  const [quarterTotals, setQuarterTotals] = useState({}); // each quarter's estimated and actual totals, for the Quarter column
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [editing, setEditing] = useState(null);
  const [locking, setLocking] = useState(null); // the trip whose estimate is open in the side panel
  const thisQuarter = useMemo(() => upcomingQuarters(1)[0], []);
  const [outlook, setOutlook] = useState(null);
  const [outlookStart, setOutlookStart] = useState(thisQuarter); // the first of the four quarters the outlook shows
  const [mode, setMode] = useState('estimated'); // estimated | actual: what the list below the filters shows
  // The cards above pick what the list shows, one card at a time: a card replaces whichever was picked before, and
  // clicking the picked card again shows everything. A card is picked when the list is in its mode with its filters.
  const estimatePicked = (q) => mode === 'estimated' && quarter === q;
  const actualPicked = (q, m = '') => mode === 'actual' && quarter === q && month === m;
  const pickEstimate = (q) => { const again = estimatePicked(q); setMode('estimated'); setMonth(''); setQuarter(again ? '' : q); };
  const pickActual = (q, m = '') => { const again = actualPicked(q, m); setMode('actual'); setQuarter(again ? '' : q); setMonth(again ? '' : m); };
  const showMode = (k) => { setMode(k); setMonth(''); };
  const [actuals, setActuals] = useState([]);
  const [actualSummary, setActualSummary] = useState(null);
  const [actualQuarter, setActualQuarter] = useState(thisQuarter); // the quarter the actual spend cards show
  const [editingActual, setEditingActual] = useState(null);
  const [awaiting, setAwaiting] = useState([]); // requests waiting on my approval
  const [onlyAwaiting, setOnlyAwaiting] = useState(false);
  const [askDefault, setAskDefault] = useState(null); // a saved trip whose travel-from might become my default

  // Arriving from Events with an event: open a new trip filled in from it (once the mileage rate is known).
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const ev = location.state?.fromEvent;
    if (!ev || !meta.data) return;
    setEditing(tripFromEvent(ev, user.id, meta.data.mileageRate, from));
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Open one travel request: from an event you already have one for (state.openTrip), or an alert (?open=<trip id>).
  // An approval alert's "do it on the Travel page" link opens the trip's actual costs instead (?lock=<trip id>).
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const id = Number(location.state?.openTrip || params.get('open'));
    const lockId = Number(params.get('lock'));
    if (!id && !lockId) return;
    if (id) api.get(`/travel/${id}`).then((d) => setEditing(d.trip)).catch(() => {});
    else api.get(`/travel/${lockId}`).then((d) => setLocking(d.trip)).catch(() => {});
    if (params.get('open') || params.get('lock')) setParams({}, { replace: true });
    else navigate(location.pathname, { replace: true, state: null });
  }, [location.state, params]); // eslint-disable-line react-hooks/exhaustive-deps

  const scopeQs = () => {
    const qs = new URLSearchParams();
    if (user.focus) return qs;
    if (traveler) qs.set('traveler', traveler);
    if (team) qs.set('team', team);
    return qs;
  };
  const load = () => {
    const qs = scopeQs();
    if (quarter) qs.set('quarter', quarter);
    api.get(`/travel/actuals?${qs}`).then((d) => setActuals(d.actuals));
    api.get('/travel/awaiting').then((d) => setAwaiting(d.trips));
    return api.get(`/travel?${qs}`).then((d) => { setTrips(d.trips); setQuarterTotals(d.quarters); });
  };
  // The quarterly outlook and the actual spend cards ignore the Quarter filter so they're always visible, but follow
  // Traveler and Team; their arrows pick which quarters they show.
  const loadOutlook = () => { const qs = scopeQs(); qs.set('start', outlookStart); return api.get(`/travel/outlook?${qs}`).then((d) => setOutlook(d.quarters)); };
  const loadSummary = () => { const qs = scopeQs(); qs.set('quarter', actualQuarter); return api.get(`/travel/actuals/summary?${qs}`).then(setActualSummary); };

  // Re-price all estimated airfare and rental cars on every manual (page) refresh.
  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.post('/travel/refresh');
      setLastRefresh({ at: new Date(), updated: r.updated });
    } finally {
      setRefreshing(false);
      // Reload through the effect so it uses the filters as they are now, not as they were when the refresh began.
      setRefreshed((n) => n + 1);
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [traveler, team, quarter, refreshed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadOutlook(); }, [traveler, team, outlookStart, refreshed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadSummary(); }, [traveler, team, actualQuarter, refreshed]); // eslint-disable-line react-hooks/exhaustive-deps
  // Entering or changing actual costs changes the actual spend cards and the Quarter column's totals too.
  const reloadAll = () => { load(); loadOutlook(); loadSummary(); };

  const quarters = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1].flatMap((yr) => [1, 2, 3, 4].map((q) => `${yr} Q${q}`));
  }, []);

  const total = trips.reduce((s, t) => s + (t.total_estimate || 0), 0);
  const shownActuals = useMemo(() => (month ? actuals.filter((a) => a.spent_on.startsWith(month)) : actuals), [actuals, month]);
  const actualTotal = shownActuals.reduce((s, a) => s + a.amount, 0);
  const who = user.focus ? 'You' : traveler ? fullName(users.data?.users.find((u) => u.id === traveler))
    : team ? teams.data?.teams.find((t) => t.id === Number(team))?.name : 'All travelers';
  const newActual = () => setEditingActual({ traveler_id: traveler || user.id, spent_on: new Date().toLocaleDateString('en-CA'), amount: '', note: '' });
  // An actual cost that comes from a locked trip is changed on the trip.
  const openActual = (a) => (a.trip_id ? api.get(`/travel/${a.trip_id}`).then((d) => setLocking(d.trip)).catch(() => {}) : setEditingActual(a));

  // Text columns sort A–Z with blanks last; ties fall back to the newest trip first.
  const SORTS = {
    traveler: (t) => t.traveler_name,
    team: (t) => t.team_name,
    date: (t) => t.date_from,
    estimate: (t) => t.total_estimate || 0,
  };
  const sorted = useMemo(() => {
    const get = SORTS[sort.key];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return [...(onlyAwaiting ? awaiting : trips)].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x !== y) {
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return sign * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
      }
      return b.date_from.localeCompare(a.date_from);
    });
  }, [trips, awaiting, onlyAwaiting, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc') : key === 'date' || key === 'estimate' ? 'desc' : 'asc' }));
  const header = (key, label, className = '') => (
    <th className={`px-4 py-3 ${className}`} aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-slate-800" onClick={() => sortBy(key)}>
        {label}
        {sort.key === key ? (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-slate-300" />}
      </button>
    </th>
  );

  if (editing) {
    return (
      <TripForm
        initial={editing}
        users={users.data?.users || []}
        teams={teams.data?.teams || []}
        meta={meta.data}
        onClose={() => { setEditing(null); reloadAll(); }}
        onSaved={(t) => {
          setEditing(null);
          reloadAll();
          // Your first trip: offer to keep where you left from as your default.
          if (t && t.traveler_id === user.id && !user.travel_from_asked && !from && (t.location_from?.city || t.airfare?.origin)) setAskDefault(t);
        }}
      />
    );
  }
  const keepDefault = async (keep) => {
    const t = askDefault;
    setAskDefault(null);
    const d = await api.put('/users/me/travel-from', keep ? { location: t.location_from, airport: t.airfare?.origin } : { declined: true });
    setUser(d.user);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <PageHeader title="Travel" subtitle="Plan trips and estimate costs against GSA FY rates">
        <button className="btn-primary h-9" onClick={() => setEditing(newTrip(user.id, meta.data?.mileageRate, from))}><Plus size={15} /> New trip</button>
        <button className="btn h-9" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing estimates…' : 'Refresh estimates'}
        </button>
        <button className="btn h-9" onClick={() => navigate('/profile#travel', { state: { from: location.pathname + location.search } })} title="Your travel defaults: where you usually travel from and your flight preferences">
          <Settings size={15} /> Settings
        </button>
      </PageHeader>

      {outlook && (
        <section aria-label="Estimated travel spend by quarter">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-1 text-sm font-semibold text-slate-800">
              Estimated travel spend · {outlookStart === thisQuarter ? 'next four quarters' : `${outlook[0].quarter} – ${outlook[3].quarter}`}
              <QuarterArrows onShift={(n) => setOutlookStart((q) => shiftQuarter(q, n))} onReset={outlookStart !== thisQuarter ? () => setOutlookStart(thisQuarter) : null} />
            </h2>
            <span className="text-xs text-slate-500">{who} · {noCents(outlook.reduce((s, q) => s + q.total, 0))} total</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {outlook.map((q, i) => (
              <button key={q.quarter} type="button" onClick={() => pickEstimate(q.quarter)}
                title={estimatePicked(q.quarter) ? 'Show all trips' : `Show only ${q.quarter} trips`}
                className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-500 ${estimatePicked(q.quarter) ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>{q.quarter}</span>
                  {q.quarter === thisQuarter && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">This quarter</span>}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{usd(q.total).replace('.00', '')}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{q.trips} trip{q.trips === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {actualSummary && (
        <ActualSpend summary={actualSummary} who={who} thisQuarter={thisQuarter} onAdd={newActual} onShow={pickActual} picked={actualPicked}
          onShift={(n) => setActualQuarter((q) => shiftQuarter(q, n))} onReset={actualQuarter !== thisQuarter ? () => setActualQuarter(thisQuarter) : null} />
      )}

      <div className="panel flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Show</label>
          <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="radiogroup" aria-label="Estimated or actual">
            {[['estimated', 'Estimated'], ['actual', 'Actual']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => showMode(k)}
                className={`rounded px-3 ${mode === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
        </div>
        {/* With Focus on the page holds only your own travel, so there's no traveler or team to pick. */}
        {!user.focus && <>
        <div className="w-72">
          <label className="label">Traveler</label>
          {/* The Team filter beside this narrows the list, so the picker needs no team dropdown of its own. */}
          <UserCombobox users={(users.data?.users || []).filter((u) => !team || (u.team_ids || []).includes(Number(team)))}
            value={traveler} onChange={setTraveler} placeholder="All travelers" />
        </div>
        <div className="w-48">
          <label className="label">Team</label>
          <select className="input" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {teams.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        </>}
        <div className="w-40">
          <label className="label">Quarter</label>
          <select className="input" value={quarter} onChange={(e) => { setQuarter(e.target.value); setMonth(''); }}>
            <option value="">All quarters</option>
            {quarters.map((q) => <option key={q}>{q}</option>)}
          </select>
        </div>
        {mode === 'estimated' ? (
          <div className="ml-auto text-right">
            <div className="text-xs uppercase text-slate-500">{trips.length} trip{trips.length === 1 ? '' : 's'} · estimated total</div>
            <div className="text-xl font-bold text-brand-700">{usd(total)}</div>
            {lastRefresh && <div className="text-xs text-slate-400">Estimates refreshed {lastRefresh.at.toLocaleTimeString()} ({lastRefresh.updated} updated)</div>}
          </div>
        ) : (
          <div className="ml-auto text-right">
            <div className="text-xs uppercase text-slate-500">{shownActuals.length} entr{shownActuals.length === 1 ? 'y' : 'ies'} · actual total</div>
            <div className="text-xl font-bold text-emerald-700">{usd(actualTotal)}</div>
          </div>
        )}
      </div>

      {mode === 'estimated' && awaiting.length > 0 && (
        <button type="button" onClick={() => setOnlyAwaiting((v) => !v)} aria-pressed={onlyAwaiting}
          className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm shadow-sm ${onlyAwaiting ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100' : 'border-amber-200 bg-amber-50/60 hover:border-amber-400'}`}>
          <span className="font-medium text-amber-900">{awaiting.length} travel request{awaiting.length === 1 ? '' : 's'} waiting on your approval</span>
          <span className="text-xs text-amber-800">{onlyAwaiting ? 'Show all trips' : 'Show only these'}</span>
        </button>
      )}

      {mode === 'actual' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Traveler</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Quarter</th><th className="px-4 py-3">Note</th><th className="px-4 py-3 text-right">Actual</th></tr>
            </thead>
            <tbody>
              {shownActuals.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => openActual(a)}
                  title={a.trip_id ? 'From a locked trip: change it on the trip' : undefined}>
                  <td className="px-4 py-3 font-medium">{a.traveler_name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.team_name || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{shortDate(a.spent_on, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-4 py-3">{a.quarter}</td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className="inline-flex items-center gap-1.5">{a.trip_id && <Lock size={12} className="shrink-0 text-slate-400" aria-label="Locked trip" />}{a.note || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">{usd(a.amount)}</td>
                </tr>
              ))}
              {!shownActuals.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No actual travel costs yet. Enter a trip's actual costs with its lock button, or use “Add actual cost” above.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {header('traveler', 'Traveler')}{header('team', 'Team')}<th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Route</th>
              {header('date', 'Dates')}<th className="px-4 py-3">Quarter</th><th className="px-4 py-3">Air</th>{header('estimate', 'Estimate', 'text-right')}<th className="px-4 py-3">Approval</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setEditing(t)}>
                <td className="px-4 py-3 font-medium">{t.traveler_name}</td>
                <td className="px-4 py-3 text-slate-600">{t.team_name || '—'}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{t.purposes.map((p) => <span key={p} className="chip">{p}</span>)}</div></td>
                <td className="px-4 py-3">{locationLabel(t.location_from) || '—'} → {locationLabel(t.location_to) || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div>{shortDate(t.date_from, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  <div className="text-slate-500">to {shortDate(t.date_to, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div>{t.quarter}</div>
                  <div className="text-[11px] text-slate-500 tabular-nums" title={`All travel in ${t.quarter} for ${who}: estimated, and actually spent`}>
                    {noCents(quarterTotals[t.quarter]?.estimated || 0)} est · {noCents(quarterTotals[t.quarter]?.actual || 0)} actual
                  </div>
                </td>
                <td className="px-4 py-3 capitalize text-slate-500">{t.airfare?.mode === 'none' ? 'No air' : t.airfare?.mode}</td>
                <td className="px-4 py-3 font-semibold">
                  <div className="flex items-center justify-end gap-2">
                    <span title={t.locked_estimate ? 'Actual costs, entered by locking the trip' : 'Estimated'}>{usd(t.total_estimate)}</span>
                    <LockButton locked={!!t.locked_estimate} onClick={() => setLocking(t)} />
                  </div>
                </td>
                <td className="px-4 py-3" title={t.approver_name ? `${t.approval === 'declined' ? 'Declined' : 'Approved'} by ${t.approver_name}` : undefined}>
                  {t.approval ? <ApprovalBadge approval={t.approval} /> : <span className="text-slate-300">—</span>}
                </td>
              </tr>
            ))}
            {!sorted.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No trips yet. Click “New trip” to plan one.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {locking && <EstimateLockPanel trip={locking} onClose={() => setLocking(null)} onSaved={() => { setLocking(null); reloadAll(); }} />}

      {editingActual && (
        <ActualForm initial={editingActual} users={users.data?.users || []} onClose={() => setEditingActual(null)}
          onSaved={() => { setEditingActual(null); reloadAll(); }} />
      )}

      <GsaPanel isAdmin={user.role === 'admin'} />

      {askDefault && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="default-from-title" className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h2 id="default-from-title" className="text-base font-semibold text-slate-900">Keep this as where you travel from?</h2>
            <p className="mt-2 text-sm text-slate-600">
              New trips will start from <span className="font-semibold">{[locationLabel(askDefault.location_from), askDefault.airfare?.origin].filter(Boolean).join(' · ')}</span>.
              You can change it any time under Settings on this page, or in your profile.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => keepDefault(false)}>No thanks</button>
              <button type="button" className="btn-primary" autoFocus onClick={() => keepDefault(true)}>Keep as default</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GsaPanel({ isAdmin }) {
  const { data, reload } = useApi('/gsa/settings');
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (data) setForm(data); }, [data]);
  if (!form) return null;

  const saveSettings = async () => {
    try { await api.put('/gsa/settings', form); setMsg({ ok: true, text: 'Settings saved' }); reload(); } catch (e) { setMsg({ ok: false, text: e.message }); }
  };
  const upload = async () => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('fiscalYear', form.fiscalYear);
    try {
      const r = await api.post('/gsa/import', fd);
      setMsg({ ok: true, text: `Imported ${r.imported} rate rows for FY${r.fiscalYear}` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    }
  };
  const field = (k, label, step = '1') => (
    <div>
      <label className="label">{label}</label>
      <input type="number" step={step} className="input" value={form[k]} disabled={!isAdmin} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
    </div>
  );

  return (
    <details className="panel">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-800">
        <Settings2 size={16} className="text-brand-600" /> GSA rates · FY{data.fiscalYear}
        <span className="text-xs font-normal text-slate-500">
          {data.importedRows ? `${data.importedRows} non-standard areas imported` : 'No GSA file imported — using standard CONUS rate'}
          {data.apiConfigured && ' · GSA API enabled'}
        </span>
      </summary>
      <div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          {field('fiscalYear', 'Fiscal year')}
          {field('conusLodging', 'Standard CONUS lodging')}
          {field('conusMie', 'Standard CONUS M&IE')}
          {field('povMileageRate', 'POV mileage rate ($/mi)', '0.001')}
        </div>
        {isAdmin && (
          <>
            <button className="btn" onClick={saveSettings}>Save rate settings</button>
            <div className="rounded-lg border border-dashed border-slate-300 p-4">
              <p className="mb-2 text-sm text-slate-600">
                Upload the GSA per diem master rates file (FY{form.fiscalYear}) from gsa.gov → Per Diem Files. Save the XLSX as CSV first.
                Locations not in the file use the standard CONUS rate.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
                <button className="btn-primary" disabled={!file} onClick={upload}><Upload size={15} /> Import CSV</button>
              </div>
            </div>
          </>
        )}
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
      </div>
    </details>
  );
}

const monthName = (ym) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long' });
const noCents = (n) => usd(n).replace('.00', '');

/** Step a section back or forward a quarter, and back to this quarter when it has moved. */
function QuarterArrows({ onShift, onReset }) {
  return (
    <span className="ml-1 inline-flex items-center">
      <button type="button" className="btn-ghost p-0.5" onClick={() => onShift(-1)} title="Earlier quarter" aria-label="Earlier quarter"><ChevronLeft size={16} /></button>
      <button type="button" className="btn-ghost p-0.5" onClick={() => onShift(1)} title="Later quarter" aria-label="Later quarter"><ChevronRight size={16} /></button>
      {onReset && <button type="button" className="ml-1 text-xs font-normal text-brand-700 hover:underline" onClick={onReset}>This quarter</button>}
    </span>
  );
}

/** Actual against estimated: "$300 under estimate", "$120 over estimate", or on it. */
function Variance({ actual, estimated, className = '' }) {
  const d = Math.round(actual - estimated);
  if (!actual && !estimated) return <span className={className}>No travel</span>;
  if (!actual) return <span className={className}>No actual costs yet</span>;
  if (!d) return <span className={className}>On estimate</span>;
  return <span className={`${className} ${d > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{noCents(Math.abs(d))} {d > 0 ? 'over' : 'under'} estimate</span>;
}

/**
 * A quarter's travel spend, actual / estimated: each month's actual spend beside what its trips are estimated at, with
 * the running actual total so far, and the quarter in all. Arrows move to other quarters. Clicking a card shows its
 * actual costs in the list below (onShow(quarter, month)); picked(quarter, month) says whether a card is showing.
 */
function ActualSpend({ summary, who, thisQuarter, onAdd, onShow, picked, onShift, onReset }) {
  const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
  let running = 0;
  const pair = (actual, estimated, tone = 'text-slate-900') => (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 tabular-nums">
      <span className={`text-2xl font-bold ${tone}`}>{noCents(actual)}</span>
      <span className="text-sm text-slate-400">/ {noCents(estimated)}</span>
    </div>
  );
  return (
    <section aria-label="Actual travel spend by quarter">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1 text-sm font-semibold text-slate-800">
          Actual / estimated travel spend · {summary.quarter === thisQuarter ? 'this quarter' : summary.quarter}
          <QuarterArrows onShift={onShift} onReset={onReset} />
        </h2>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {who} · {summary.quarter}
          <button type="button" className="btn h-8 py-0 text-xs" onClick={onAdd}><Receipt size={14} /> Add actual cost</button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.months.map((m) => {
          running += m.total;
          return (
            <button key={m.month} type="button" onClick={() => onShow(summary.quarter, m.month)}
              title={picked(summary.quarter, m.month) ? 'Show all actual costs' : `Show only ${monthName(m.month)} actual costs`}
              className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-emerald-500 ${picked(summary.quarter, m.month) ? 'border-emerald-500 ring-2 ring-emerald-100' : m.month === thisMonth ? 'border-emerald-300' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>{monthName(m.month)}</span>
                {m.month === thisMonth && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">This month</span>}
              </div>
              {pair(m.total, m.estimated)}
              <div className="mt-0.5 text-[11px] text-slate-400">
                <Variance actual={m.total} estimated={m.estimated} /> · {m.entries} entr{m.entries === 1 ? 'y' : 'ies'}, {m.trips} trip{m.trips === 1 ? '' : 's'}
              </div>
              <div className="text-[11px] text-slate-400">{noCents(running)} actual so far this quarter</div>
            </button>
          );
        })}
        <button type="button" onClick={() => onShow(summary.quarter)}
          title={picked(summary.quarter) ? 'Show all actual costs' : `Show only ${summary.quarter} actual costs`}
          className={`rounded-xl border bg-emerald-50/60 p-4 text-left shadow-sm transition hover:border-emerald-500 ${picked(summary.quarter) ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-emerald-200'}`}>
          <div className="text-xs font-medium text-emerald-800">{summary.quarter} · actual / estimated</div>
          {pair(summary.total, summary.estimated, 'text-emerald-900')}
          <div className="mt-0.5 text-[11px] text-emerald-800/70">
            <Variance actual={summary.total} estimated={summary.estimated} /> · {summary.entries} entr{summary.entries === 1 ? 'y' : 'ies'}, {summary.trips} trip{summary.trips === 1 ? '' : 's'}
          </div>
        </button>
      </div>
    </section>
  );
}

/** Add or change one actual travel cost: who, when, and the total. A note is optional. */
function ActualForm({ initial, users, onClose, onSaved }) {
  const [form, setForm] = useState({ ...initial, amount: initial.amount === '' ? '' : String(initial.amount) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      if (form.id) await api.put(`/travel/actuals/${form.id}`, form);
      else await api.post('/travel/actuals', form);
      onSaved();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm('Delete this actual cost?')) return;
    await api.del(`/travel/actuals/${form.id}`);
    onSaved();
  };
  return (
    <SidePanel title={form.id ? 'Actual travel cost' : 'Add actual travel cost'} subtitle="The total spent; no breakdown needed" onClose={onClose}
      footer={(
        <div className="flex items-center gap-2">
          {form.id && <button type="button" className="btn-ghost px-2 text-red-600 hover:bg-red-50" onClick={remove} disabled={busy} aria-label="Delete"><Trash2 size={15} /></button>}
          <span className="mr-auto text-sm text-red-600">{error}</span>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary" onClick={save} disabled={busy}>{busy ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}</button>
        </div>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div>
          <label className="label">Traveler</label>
          <UserCombobox users={users} value={form.traveler_id} onChange={(v) => setForm((f) => ({ ...f, traveler_id: v }))} allowClear={false} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={form.spent_on} onChange={set('spent_on')} />
          </div>
          <div>
            <label className="label">Total spent ($)</label>
            <input className="input text-right tabular-nums" inputMode="decimal" value={form.amount} onChange={set('amount')} placeholder="0.00" autoFocus={!form.id} />
          </div>
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={form.note || ''} onChange={set('note')} placeholder="e.g. AUSA trip, October card statement" />
        </div>
        <button type="submit" hidden />
      </form>
    </SidePanel>
  );
}
