import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Plane, ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import ProfileFields from '../components/ProfileFields.jsx';
import PageHeader from '../components/PageHeader.jsx';
import LocationInput, { EMPTY_LOCATION } from '../components/LocationInput.jsx';
import { travelFromOf, FlightLimits } from './TripForm.jsx';
import { flightPrefs, flightLimitsChanged } from '../lib/travelCalc.js';

const pick = (u) => ({
  first_name: u.first_name, last_name: u.last_name, email: u.email, phone: u.phone || '',
  username: u.username, title: u.title || '', team_ids: u.team_ids || [],
});

/** Team id → 'member' | 'lead', for coloring someone's team tags. */
export const rolesOf = (u) => Object.fromEntries((u?.teams || []).map((t) => [t.id, t.role]));

export default function Profile() {
  const { user, setUser } = useAuth();
  const back = useBackToTravel();
  const [form, setForm] = useState(pick(user));
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    try {
      const d = await api.put('/users/me', form);
      setUser(d.user);
      setMsg({ ok: true, text: 'Profile saved' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-8">
      <PageHeader title="Profile" subtitle="Your contact details and team">{back && <BackToTravel onClick={back} />}</PageHeader>
      <form onSubmit={save} className="panel space-y-5">
        <ProfileFields value={form} onChange={setForm} roles={rolesOf(user)} />
        <div className="flex items-center gap-3">
          <button className="btn-primary">Save profile</button>
          {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
        </div>
      </form>
      <TravelDefaults />
      <PasswordPanel />
    </div>
  );
}

function PasswordPanel() {
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    try {
      await api.put('/users/me/password', pw);
      setPw({ current: '', next: '' });
      setMsg({ ok: true, text: 'Password updated' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };
  return (
    <form onSubmit={save} className="panel">
      <h2 className="section-title mb-4">Change password</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <input className="input" type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
        <input className="input" type="password" placeholder="New password (8+ chars)" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
        <button className="btn">Update password</button>
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</p>}
    </form>
  );
}

/**
 * The Travel page's Settings button lands on this page at #travel, with where it came from in the location state. When it
 * did, the page offers a way back there; opened any other way (the sidebar, a typed address), there is nowhere to go back to.
 */
function useBackToTravel() {
  const { hash, state } = useLocation();
  const navigate = useNavigate();
  if (hash !== '#travel') return null;
  return () => navigate(state?.from || '/travel');
}

const BackToTravel = ({ onClick }) => <button type="button" className="btn h-9" onClick={onClick}><ArrowLeft size={15} /> Back to Travel</button>;

/** Where you usually travel from and the flights you'll take: new trips start from them. The Travel page's Settings button lands here (#travel). */
function TravelDefaults() {
  const { user, setUser } = useAuth();
  const back = useBackToTravel();
  const saved = travelFromOf(user);
  const [form, setForm] = useState({ location: { ...EMPTY_LOCATION, ...saved?.location }, airport: saved?.airport || '', flight: flightPrefs(saved?.flight) });
  const [msg, setMsg] = useState(null);
  const ref = useRef(null);
  const { hash } = useLocation();
  useEffect(() => { if (hash === '#travel') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [hash]);

  const save = async (e) => {
    e.preventDefault();
    try {
      const d = await api.put('/users/me/travel-from', form);
      setUser(d.user);
      setMsg({ ok: true, text: form.location.city || form.airport || flightLimitsChanged(form.flight) ? 'Travel defaults saved' : 'Travel defaults cleared' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };
  return (
    <form id="travel" ref={ref} onSubmit={save} className="panel scroll-mt-6">
      <h2 className="section-title mb-1 flex items-center gap-2"><Plane size={16} className="text-brand-600" /> Travel defaults</h2>
      <p className="mb-4 text-sm text-slate-500">Where you usually travel from and the flights you’re willing to take. New trips start with these; you can still change them on any trip.</p>
      <div className="grid items-end gap-4 sm:grid-cols-[1fr_12rem]">
        <LocationInput label="Travel from" value={form.location} onChange={(location) => setForm((f) => ({ ...f, location }))} />
        <div>
          <label className="label">Home airport</label>
          <input className="input" placeholder="e.g. DCA or IAD" value={form.airport} onChange={(e) => setForm((f) => ({ ...f, airport: e.target.value.toUpperCase() }))} />
        </div>
      </div>
      <div className="mt-4">
        <FlightLimits limits={form.flight} onChange={(p) => setForm((f) => ({ ...f, flight: { ...f.flight, ...p } }))} />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn-primary">Save travel defaults</button>
        {back && <BackToTravel onClick={back} />}
        {msg && <span className={`text-sm ${msg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
