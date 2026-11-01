import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw, Upload, Settings2, ChevronUp, ChevronDown, ChevronsUpDown, Receipt, Trash2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { usd } from '../lib/travelCalc.js';
import { fullName, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import SidePanel from '../components/SidePanel.jsx';
import UserCombobox from '../components/UserCombobox.jsx';
import { locationLabel } from '../components/LocationInput.jsx';
import TripForm, { newTrip, tripFromEvent } from './TripForm.jsx';

export default function Travel() {
  const { user } = useAuth();
  const users = useApi('/users');
  const teams = useApi('/teams');
  const meta = useApi('/travel/meta');
  const [traveler, setTraveler] = useState(null);
  const [team, setTeam] = useState('');
  const [quarter, setQuarter] = useState('');
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [trips, setTrips] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [editing, setEditing] = useState(null);
  const [outlook, setOutlook] = useState(null);
  const [mode, setMode] = useState('estimated'); // estimated | actual: what the list below the filters shows
  const [actuals, setActuals] = useState([]);
  const [actualSummary, setActualSummary] = useState(null);
  const [editingActual, setEditingActual] = useState(null);

  // Arriving from Events with an event: open a new trip filled in from it (once the mileage rate is known).
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const ev = location.state?.fromEvent;
    if (!ev || !meta.data) return;
    setEditing(tripFromEvent(ev, user.id, meta.data.mileageRate));
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = () => {
    const qs = new URLSearchParams();
    if (traveler) qs.set('traveler', traveler);
    if (team) qs.set('team', team);
    // The quarterly outlook ignores the Quarter filter so it's always visible, but follows Traveler and Team.
    api.get(`/travel/outlook?${qs}`).then((d) => setOutlook(d.quarters));
    api.get(`/travel/actuals/summary?${qs}`).then(setActualSummary);
    if (quarter) qs.set('quarter', quarter);
    api.get(`/travel/actuals?${qs}`).then((d) => setActuals(d.actuals));
    return api.get(`/travel?${qs}`).then((d) => setTrips(d.trips));
  };

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

  const quarters = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1].flatMap((yr) => [1, 2, 3, 4].map((q) => `${yr} Q${q}`));
  }, []);

  const total = trips.reduce((s, t) => s + (t.total_estimate || 0), 0);
  const actualTotal = actuals.reduce((s, a) => s + a.amount, 0);
  const who = traveler ? fullName(users.data?.users.find((u) => u.id === traveler))
    : team ? teams.data?.teams.find((t) => t.id === Number(team))?.name : 'All travelers';
  const newActual = () => setEditingActual({ traveler_id: traveler || user.id, spent_on: new Date().toLocaleDateString('en-CA'), amount: '', note: '' });

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
    return [...trips].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x !== y) {
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return sign * (typeof x === 'number' ? x - y : String(x).localeCompare(String(y)));
      }
      return b.date_from.localeCompare(a.date_from);
    });
  }, [trips, sort]); // eslint-disable-line react-hooks/exhaustive-deps
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
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <PageHeader title="Travel" subtitle="Plan trips and estimate costs against GSA FY rates">
        <button className="btn" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing estimates…' : 'Refresh estimates'}
        </button>
        <button className="btn-primary" onClick={() => setEditing(newTrip(user.id, meta.data?.mileageRate))}><Plus size={15} /> New trip</button>
      </PageHeader>

      {outlook && (
        <section aria-label="Estimated travel spend by quarter">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-800">Estimated travel spend · next four quarters</h2>
            <span className="text-xs text-slate-500">
              {traveler ? fullName(users.data?.users.find((u) => u.id === traveler))
                : team ? teams.data?.teams.find((t) => t.id === Number(team))?.name : 'All travelers'} · {usd(outlook.reduce((s, q) => s + q.total, 0)).replace('.00', '')} total
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {outlook.map((q, i) => (
              <button key={q.quarter} type="button" onClick={() => setQuarter(quarter === q.quarter ? '' : q.quarter)}
                title={quarter === q.quarter ? 'Show all quarters' : `Show only ${q.quarter} trips`}
                className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-500 ${quarter === q.quarter ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200'}`}>
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>{q.quarter}</span>
                  {i === 0 && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">This quarter</span>}
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{usd(q.total).replace('.00', '')}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{q.trips} trip{q.trips === 1 ? '' : 's'}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {actualSummary && <ActualSpend summary={actualSummary} who={who} onAdd={newActual} onShow={() => setMode('actual')} />}

      <div className="panel flex flex-wrap items-end gap-4">
        <div>
          <label className="label">Show</label>
          <div className="flex h-[38px] rounded-md bg-white p-0.5 text-sm ring-1 ring-slate-300" role="radiogroup" aria-label="Estimated or actual">
            {[['estimated', 'Estimated'], ['actual', 'Actual']].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}
                className={`rounded px-3 ${mode === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
        </div>
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
        <div className="w-40">
          <label className="label">Quarter</label>
          <select className="input" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
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
            <div className="text-xs uppercase text-slate-500">{actuals.length} entr{actuals.length === 1 ? 'y' : 'ies'} · actual total</div>
            <div className="text-xl font-bold text-emerald-700">{usd(actualTotal)}</div>
          </div>
        )}
      </div>

      {mode === 'actual' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-4 py-3">Traveler</th><th className="px-4 py-3">Team</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Quarter</th><th className="px-4 py-3">Note</th><th className="px-4 py-3 text-right">Actual</th></tr>
            </thead>
            <tbody>
              {actuals.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setEditingActual(a)}>
                  <td className="px-4 py-3 font-medium">{a.traveler_name}</td>
                  <td className="px-4 py-3 text-slate-600">{a.team_name || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">{shortDate(a.spent_on, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td className="px-4 py-3">{a.quarter}</td>
                  <td className="px-4 py-3 text-slate-600">{a.note || '—'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{usd(a.amount)}</td>
                </tr>
              ))}
              {!actuals.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No actual travel costs yet. Use “Add actual cost” above to enter one.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              {header('traveler', 'Traveler')}{header('team', 'Team')}<th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Route</th>
              {header('date', 'Dates')}<th className="px-4 py-3">Quarter</th><th className="px-4 py-3">Air</th>{header('estimate', 'Estimate', 'text-right')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setEditing(t)}>
                <td className="px-4 py-3 font-medium">{t.traveler_name}</td>
                <td className="px-4 py-3 text-slate-600">{t.team_name || '—'}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{t.purposes.map((p) => <span key={p} className="chip">{p}</span>)}</div></td>
                <td className="px-4 py-3">{locationLabel(t.location_from) || '—'} → {locationLabel(t.location_to) || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{shortDate(t.date_from)} – {shortDate(t.date_to, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td className="px-4 py-3">{t.quarter}</td>
                <td className="px-4 py-3 capitalize text-slate-500">{t.airfare?.mode === 'none' ? 'No air' : t.airfare?.mode}</td>
                <td className="px-4 py-3 text-right font-semibold">{usd(t.total_estimate)}</td>
              </tr>
            ))}
            {!trips.length && <tr><td colSpan={8}className="px-4 py-10 text-center text-slate-400">No trips yet. Click “New trip” to plan one.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {editingActual && (
        <ActualForm initial={editingActual} users={users.data?.users || []} onClose={() => setEditingActual(null)}
          onSaved={() => { setEditingActual(null); load(); }} />
      )}

      <GsaPanel isAdmin={user.role === 'admin'} />
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

/** This quarter's actual travel spend: each month, with the running total so far, and the quarter in all. */
function ActualSpend({ summary, who, onAdd, onShow }) {
  const thisMonth = new Date().toLocaleDateString('en-CA').slice(0, 7);
  let running = 0;
  return (
    <section aria-label="Actual travel spend this quarter">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">Actual travel spend · this quarter</h2>
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {who} · {summary.quarter}
          <button type="button" className="btn h-8 py-0 text-xs" onClick={onAdd}><Receipt size={14} /> Add actual cost</button>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.months.map((m) => {
          running += m.total;
          return (
            <button key={m.month} type="button" onClick={onShow} title="Show actual costs"
              className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-emerald-500 ${m.month === thisMonth ? 'border-emerald-300' : 'border-slate-200'}`}>
              <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                <span>{monthName(m.month)}</span>
                {m.month === thisMonth && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">This month</span>}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900 tabular-nums">{usd(m.total).replace('.00', '')}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {m.entries} entr{m.entries === 1 ? 'y' : 'ies'} · {usd(running).replace('.00', '')} so far this quarter
              </div>
            </button>
          );
        })}
        <button type="button" onClick={onShow} title="Show actual costs"
          className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-left shadow-sm transition hover:border-emerald-500">
          <div className="text-xs font-medium text-emerald-800">{summary.quarter} total</div>
          <div className="mt-1 text-2xl font-bold text-emerald-900 tabular-nums">{usd(summary.total).replace('.00', '')}</div>
          <div className="mt-0.5 text-[11px] text-emerald-800/70">{summary.entries} entr{summary.entries === 1 ? 'y' : 'ies'} this quarter</div>
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
