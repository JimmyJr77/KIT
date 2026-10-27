import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Upload, Settings2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useApi } from '../lib/data.js';
import { usd } from '../lib/travelCalc.js';
import { fullName, shortDate } from '../lib/format.js';
import PageHeader from '../components/PageHeader.jsx';
import UserCombobox from '../components/UserCombobox.jsx';
import { locationLabel } from '../components/LocationInput.jsx';
import TripForm, { newTrip } from './TripForm.jsx';

export default function Travel() {
  const { user } = useAuth();
  const users = useApi('/users');
  const teams = useApi('/teams');
  const meta = useApi('/travel/meta');
  const [traveler, setTraveler] = useState(null);
  const [quarter, setQuarter] = useState('');
  const [trips, setTrips] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [editing, setEditing] = useState(null);
  const [outlook, setOutlook] = useState(null);

  const load = () => {
    const qs = new URLSearchParams();
    if (traveler) qs.set('traveler', traveler);
    if (quarter) qs.set('quarter', quarter);
    // The quarterly outlook ignores the Quarter filter so it's always visible, but follows Traveler.
    api.get(`/travel/outlook${traveler ? `?traveler=${traveler}` : ''}`).then((d) => setOutlook(d.quarters));
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
      load();
    }
  };

  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [traveler, quarter]); // eslint-disable-line react-hooks/exhaustive-deps

  const quarters = useMemo(() => {
    const y = new Date().getFullYear();
    return [y - 1, y, y + 1].flatMap((yr) => [1, 2, 3, 4].map((q) => `${yr} Q${q}`));
  }, []);

  const total = trips.reduce((s, t) => s + (t.total_estimate || 0), 0);

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
              {traveler ? fullName(users.data?.users.find((u) => u.id === traveler)) : 'All travelers'} · {usd(outlook.reduce((s, q) => s + q.total, 0)).replace('.00', '')} total
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

      <div className="panel flex flex-wrap items-end gap-4">
        <div className="w-72">
          <label className="label">Traveler</label>
          <UserCombobox users={users.data?.users || []} teams={teams.data?.teams || []} value={traveler} onChange={setTraveler} placeholder="All travelers" />
        </div>
        <div className="w-40">
          <label className="label">Quarter</label>
          <select className="input" value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            <option value="">All quarters</option>
            {quarters.map((q) => <option key={q}>{q}</option>)}
          </select>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xs uppercase text-slate-500">{trips.length} trip{trips.length === 1 ? '' : 's'} · estimated total</div>
          <div className="text-xl font-bold text-brand-700">{usd(total)}</div>
          {lastRefresh && <div className="text-xs text-slate-400">Estimates refreshed {lastRefresh.at.toLocaleTimeString()} ({lastRefresh.updated} updated)</div>}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Traveler</th><th className="px-4 py-3">Purpose</th><th className="px-4 py-3">Route</th>
              <th className="px-4 py-3">Dates</th><th className="px-4 py-3">Quarter</th><th className="px-4 py-3">Air</th><th className="px-4 py-3 text-right">Estimate</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.id} className="cursor-pointer border-t border-slate-100 hover:bg-brand-50/40" onClick={() => setEditing(t)}>
                <td className="px-4 py-3 font-medium">{t.traveler_name}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-1">{t.purposes.map((p) => <span key={p} className="chip">{p}</span>)}</div></td>
                <td className="px-4 py-3">{locationLabel(t.location_from) || '—'} → {locationLabel(t.location_to) || '—'}</td>
                <td className="px-4 py-3 whitespace-nowrap">{shortDate(t.date_from)} – {shortDate(t.date_to, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                <td className="px-4 py-3">{t.quarter}</td>
                <td className="px-4 py-3 capitalize text-slate-500">{t.airfare?.mode === 'none' ? 'No air' : t.airfare?.mode}</td>
                <td className="px-4 py-3 text-right font-semibold">{usd(t.total_estimate)}</td>
              </tr>
            ))}
            {!trips.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">No trips yet. Click “New trip” to plan one.</td></tr>}
          </tbody>
        </table>
      </div>

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
