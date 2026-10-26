import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Plane, TrainFront, Car, CarFront, Hotel, Utensils, Plus, Trash2, RefreshCw, Info } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PURPOSES, quarterFor, tripCosts, lodgingSegmentCost, mieCost, usd, nightsBetween } from '../lib/travelCalc.js';
import UserCombobox from '../components/UserCombobox.jsx';
import LocationInput, { EMPTY_LOCATION, locationKey, locationLabel } from '../components/LocationInput.jsx';

const uid = () => Math.random().toString(36).slice(2, 9);

export function newTrip(userId, mileageRate) {
  return {
    traveler_id: userId,
    purposes: [],
    location_from: { ...EMPTY_LOCATION },
    location_to: { ...EMPTY_LOCATION },
    details: '',
    date_from: '',
    date_to: '',
    airfare: { mode: 'estimated', tripType: 'round-trip', origin: '', destination: '', departDate: '', returnDate: '', datesCustom: false, estimate: null, bookedAmount: '', airline: '', confirmation: '' },
    train: '',
    pov: { enabled: false, miles: '', roundTrip: true, rate: mileageRate },
    car: { enabled: false, mode: 'estimated', vehicleClass: 'Economy / Compact', location: '', pickupDate: '', pickupTime: '10:00', dropoffDate: '', dropoffTime: '10:00', datesCustom: false, estimate: null, bookedAmount: '' },
    lodging: [{ id: uid(), hotelName: '', location: { ...EMPTY_LOCATION }, locationCustom: false, checkIn: '', checkOut: '', datesCustom: false, rates: null, ratesKey: '', overrideRate: '' }],
    mie: { rates: null, ratesKey: '', overrideRate: '' },
  };
}

const ratesUrl = (l) => `/gsa/rates?${new URLSearchParams({ city: l.city || '', state: l.state || '', country: l.country || '', intl: String(!!l.intl) })}`;

const SOURCE_LABEL = {
  'gsa-file': 'GSA FY rate (imported file)',
  'gsa-api': 'GSA FY rate (GSA API)',
  standard: 'GSA standard CONUS rate',
  manual: 'OCONUS — enter rate manually',
  mcp: 'Live (MCP)',
  placeholder: 'Placeholder',
};

export default function TripForm({ initial, users, teams, meta, onClose, onSaved }) {
  const { user } = useAuth();
  const [trip, setTrip] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const costs = useMemo(() => tripCosts(trip), [trip]);

  const patch = (p) => setTrip((t) => ({ ...t, ...p }));
  const patchIn = (key, p) => setTrip((t) => ({ ...t, [key]: { ...t[key], ...p } }));

  // ---- Keep dependent dates/locations in sync with the trip until the user customizes them.
  useEffect(() => {
    setTrip((t) => ({
      ...t,
      airfare: t.airfare.datesCustom ? t.airfare : { ...t.airfare, departDate: t.date_from, returnDate: t.date_to },
      car: t.car.datesCustom ? t.car : { ...t.car, pickupDate: t.date_from, dropoffDate: t.date_to },
      lodging: t.lodging.map((s, i) => {
        if (s.datesCustom) return s;
        // First hotel defaults to the full trip; additional hotels keep their own dates.
        return i === 0 ? { ...s, checkIn: t.date_from, checkOut: t.date_to } : s;
      }),
    }));
  }, [trip.date_from, trip.date_to]);

  const destKey = locationKey(trip.location_to);
  useEffect(() => {
    setTrip((t) => ({ ...t, lodging: t.lodging.map((s) => (s.locationCustom ? s : { ...s, location: { ...t.location_to } })) }));
  }, [destKey]);

  // ---- GSA rate lookups for each hotel location and the destination (M&IE).
  const inflight = useRef(new Set());
  const fetchRates = (loc, key, apply) => {
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    api.get(ratesUrl(loc)).then(apply).finally(() => inflight.current.delete(key));
  };
  useEffect(() => {
    trip.lodging.forEach((s) => {
      const key = locationKey(s.location);
      if (s.ratesKey === key || !s.location.city || (!s.location.intl && !s.location.state)) return;
      fetchRates(s.location, `${s.id}:${key}`, (rates) =>
        setTrip((t) => ({ ...t, lodging: t.lodging.map((x) => (x.id === s.id && locationKey(x.location) === key ? { ...x, rates, ratesKey: key } : x)) })));
    });
    const to = trip.location_to;
    if (trip.mie.ratesKey !== destKey && to.city && (to.intl || to.state)) {
      fetchRates(to, `mie:${destKey}`, (rates) =>
        setTrip((t) => (locationKey(t.location_to) === destKey ? { ...t, mie: { ...t.mie, rates, ratesKey: destKey } } : t)));
    }
  }, [trip.lodging, destKey, trip.mie.ratesKey, trip.location_to]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Live airfare / rental car estimates; re-query whenever route, dates or class change.
  const flightKey = trip.airfare.mode === 'estimated'
    ? [trip.airfare.tripType, trip.airfare.origin || locationLabel(trip.location_from), trip.airfare.destination || locationLabel(trip.location_to), trip.airfare.departDate, trip.airfare.tripType === 'one-way' ? '' : trip.airfare.returnDate].join('|')
    : null;
  const carKey = trip.car.enabled && trip.car.mode === 'estimated'
    ? [trip.car.vehicleClass, trip.car.location || locationLabel(trip.location_to), trip.car.pickupDate, trip.car.pickupTime, trip.car.dropoffDate, trip.car.dropoffTime].join('|')
    : null;
  const [flightLoading, refreshFlight] = useEstimate(flightKey, trip.airfare.estimate?.key, async () => {
    const { estimate } = await api.post('/travel/estimate/flight', { airfare: trip.airfare, trip });
    patchIn('airfare', { estimate: { ...estimate, key: flightKey } });
  }, (k) => !k.split('|').slice(1, 4).some((v) => !v));
  const [carLoading, refreshCar] = useEstimate(carKey, trip.car.estimate?.key, async () => {
    const { estimate } = await api.post('/travel/estimate/car', { car: trip.car, trip });
    patchIn('car', { estimate: { ...estimate, key: carKey } });
  }, (k) => !k.split('|').slice(1, 5).some((v) => !v));

  const save = async () => {
    setError('');
    setSaving(true);
    try {
      const d = trip.id ? await api.put(`/travel/${trip.id}`, trip) : await api.post('/travel', trip);
      onSaved(d.trip);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this trip?')) return;
    await api.del(`/travel/${trip.id}`);
    onSaved(null);
  };

  const togglePurpose = (p) =>
    patch({ purposes: trip.purposes.includes(p) ? trip.purposes.filter((x) => x !== p) : [...trip.purposes, p] });

  return (
    <div className="mx-auto max-w-7xl p-8">
      <button className="btn-ghost mb-4 -ml-3" onClick={onClose}><ArrowLeft size={16} /> Back to trips</button>
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          {/* ---------------- Trip basics ---------------- */}
          <section className="panel space-y-5">
            <h2 className="text-lg font-semibold">{trip.id ? 'Edit trip' : 'New trip'}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Traveler</label>
                <UserCombobox users={users} teams={teams} value={trip.traveler_id} onChange={(id) => patch({ traveler_id: id })} allowClear={false} />
              </div>
              <div>
                <label className="label">General purpose</label>
                <div className="flex flex-wrap gap-1.5">
                  {PURPOSES.map((p) => (
                    <button key={p} type="button" onClick={() => togglePurpose(p)}
                      className={`rounded-full border px-3 py-1.5 text-sm ${trip.purposes.includes(p) ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-brand-500'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <LocationInput label="Location from" value={trip.location_from} onChange={(v) => patch({ location_from: v })} />
              <LocationInput label="Location to" value={trip.location_to} onChange={(v) => patch({ location_to: v })} />
              <div>
                <label className="label">Date from</label>
                <input type="date" className="input" value={trip.date_from} onChange={(e) => patch({ date_from: e.target.value, date_to: trip.date_to && trip.date_to < e.target.value ? e.target.value : trip.date_to })} />
              </div>
              <div className="grid grid-cols-[1fr_7rem] gap-3">
                <div>
                  <label className="label">Date to</label>
                  <input type="date" className="input" min={trip.date_from} value={trip.date_to} onChange={(e) => patch({ date_to: e.target.value })} />
                </div>
                <div>
                  <label className="label">Quarter</label>
                  <input className="input" value={quarterFor(trip.date_from)} disabled placeholder="Auto" />
                </div>
              </div>
            </div>
            <div>
              <label className="label">Details</label>
              <textarea className="input min-h-20" value={trip.details || ''} onChange={(e) => patch({ details: e.target.value })} placeholder="Meetings, agenda, opportunities supported…" />
            </div>
          </section>

          {/* ---------------- Travel ---------------- */}
          <section className="panel space-y-6">
            <h2 className="text-lg font-semibold">Travel</h2>

            <Sub icon={Plane} title="Airfare" right={usd(costs.airfare)}>
              <Segmented value={trip.airfare.mode} onChange={(mode) => patchIn('airfare', { mode })}
                options={[['estimated', 'Estimated'], ['booked', 'Booked'], ['none', 'No air travel']]} />
              {trip.airfare.mode === 'estimated' && (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div>
                      <label className="label">Trip type</label>
                      <select className="input" value={trip.airfare.tripType} onChange={(e) => patchIn('airfare', { tripType: e.target.value })}>
                        <option value="round-trip">Round-trip</option>
                        <option value="one-way">One-way</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Origin</label>
                      <input className="input" placeholder={locationLabel(trip.location_from) || 'City or airport code'} value={trip.airfare.origin} onChange={(e) => patchIn('airfare', { origin: e.target.value })} />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label">Destination</label>
                      <input className="input" placeholder={locationLabel(trip.location_to) || 'City or airport code'} value={trip.airfare.destination} onChange={(e) => patchIn('airfare', { destination: e.target.value })} />
                    </div>
                    <DateField label="Depart" value={trip.airfare.departDate} onChange={(v) => patchIn('airfare', { departDate: v, datesCustom: true })} />
                    {trip.airfare.tripType === 'round-trip' && (
                      <DateField label="Return" value={trip.airfare.returnDate} onChange={(v) => patchIn('airfare', { returnDate: v, datesCustom: true })} />
                    )}
                    <ResetDates show={trip.airfare.datesCustom} onClick={() => patchIn('airfare', { datesCustom: false, departDate: trip.date_from, returnDate: trip.date_to })} />
                  </div>
                  <EstimateCard loading={flightLoading} onRefresh={refreshFlight} estimate={trip.airfare.estimate}>
                    {(e) => (
                      <>
                        <div className="text-2xl font-bold">{usd(e.lowestPrice)}<span className="ml-2 text-xs font-normal text-slate-500">lowest · {e.itinerary && e.itinerary !== 'unknown' ? e.itinerary : 'itinerary n/a'}</span></div>
                        {e.averageLow != null && <div className="text-sm text-slate-600">Typical range {usd(e.averageLow)} – {usd(e.averageHigh)}</div>}
                        {e.searched && <div className="text-xs text-slate-400">Airports searched: {e.searched}</div>}
                        {e.airlines?.length > 0 && <div className="text-sm text-slate-600">Airlines: {e.airlines.join(', ')}</div>}
                        {e.bookingUrl && <a href={e.bookingUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-600 hover:underline">View cheapest fare on {e.provider || 'provider'} ↗</a>}
                      </>
                    )}
                  </EstimateCard>
                </div>
              )}
              {trip.airfare.mode === 'booked' && (
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Money label="Booked fare" value={trip.airfare.bookedAmount} onChange={(v) => patchIn('airfare', { bookedAmount: v })} />
                  <div><label className="label">Airline</label><input className="input" value={trip.airfare.airline} onChange={(e) => patchIn('airfare', { airline: e.target.value })} /></div>
                  <div><label className="label">Confirmation #</label><input className="input" value={trip.airfare.confirmation} onChange={(e) => patchIn('airfare', { confirmation: e.target.value })} /></div>
                </div>
              )}
            </Sub>

            <Sub icon={TrainFront} title="Train / Tram" right={usd(costs.train)}>
              <div className="sm:w-1/3"><Money label="Estimated cost" value={trip.train} onChange={(v) => patch({ train: v })} /></div>
            </Sub>

            <Sub icon={Car} title="POV (personally operated vehicle)" right={usd(costs.pov)}>
              <Toggle checked={trip.pov.enabled} onChange={(enabled) => patchIn('pov', { enabled, rate: trip.pov.rate || meta?.mileageRate })} label="Traveling via POV" />
              {trip.pov.enabled && (
                <div className="mt-3 grid items-end gap-3 sm:grid-cols-3">
                  <div><label className="label">One-way miles</label><input type="number" min="0" className="input" value={trip.pov.miles} onChange={(e) => patchIn('pov', { miles: e.target.value })} /></div>
                  <Toggle checked={trip.pov.roundTrip} onChange={(roundTrip) => patchIn('pov', { roundTrip })} label="Round trip (×2)" />
                  <div className="text-sm text-slate-600">
                    GSA mileage rate <b>${Number(trip.pov.rate || 0).toFixed(3)}/mi</b>
                    <p className="text-xs text-slate-400">The GSA POV rate covers fuel, wear and insurance — no separate gas reimbursement.</p>
                  </div>
                </div>
              )}
            </Sub>

            <Sub icon={CarFront} title="Car rental" right={usd(costs.car)}>
              <Toggle checked={trip.car.enabled} onChange={(enabled) => patchIn('car', { enabled })} label="Renting a car" />
              {trip.car.enabled && (
                <div className="mt-3 space-y-3">
                  <Segmented value={trip.car.mode} onChange={(mode) => patchIn('car', { mode })} options={[['estimated', 'Estimated'], ['booked', 'Booked']]} />
                  {trip.car.mode === 'estimated' ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="sm:col-span-2">
                          <label className="label">Vehicle class</label>
                          <select className="input" value={trip.car.vehicleClass} onChange={(e) => patchIn('car', { vehicleClass: e.target.value })}>
                            {(meta?.vehicleClasses || []).map((v) => <option key={v}>{v}</option>)}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="label">Pick-up location</label>
                          <input className="input" placeholder={locationLabel(trip.location_to) || 'City or airport'} value={trip.car.location} onChange={(e) => patchIn('car', { location: e.target.value })} />
                        </div>
                        <DateField label="Pick-up date" value={trip.car.pickupDate} onChange={(v) => patchIn('car', { pickupDate: v, datesCustom: true })} />
                        <div><label className="label">Pick-up time</label><input type="time" className="input" value={trip.car.pickupTime} onChange={(e) => patchIn('car', { pickupTime: e.target.value })} /></div>
                        <DateField label="Drop-off date" value={trip.car.dropoffDate} onChange={(v) => patchIn('car', { dropoffDate: v, datesCustom: true })} />
                        <div><label className="label">Drop-off time</label><input type="time" className="input" value={trip.car.dropoffTime} onChange={(e) => patchIn('car', { dropoffTime: e.target.value })} /></div>
                      </div>
                      <ResetDates show={trip.car.datesCustom} onClick={() => patchIn('car', { datesCustom: false, pickupDate: trip.date_from, dropoffDate: trip.date_to })} />
                      <EstimateCard loading={carLoading} onRefresh={refreshCar} estimate={trip.car.estimate}>
                        {(e) => (
                          <>
                            <div className="text-2xl font-bold">{usd(e.totalEstimate)}<span className="ml-2 text-xs font-normal text-slate-500">{e.dailyRate != null && `${usd(e.dailyRate)}/day`}</span></div>
                            {e.included && <div className="text-sm text-slate-600">{e.included}</div>}
                            {e.suppliers?.length > 0 && <div className="text-sm text-slate-600">Suppliers: {e.suppliers.join(', ')}</div>}
                          </>
                        )}
                      </EstimateCard>
                    </>
                  ) : (
                    <div className="sm:w-1/3"><Money label="Booked total" value={trip.car.bookedAmount} onChange={(v) => patchIn('car', { bookedAmount: v })} /></div>
                  )}
                </div>
              )}
            </Sub>
          </section>

          {/* ---------------- Lodging ---------------- */}
          <section className="panel space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Hotel size={18} className="text-brand-600" /> Lodging</h2>
              <span className="font-semibold">{usd(costs.lodging)}</span>
            </div>
            {trip.lodging.map((seg, i) => (
              <LodgingSegment key={seg.id} seg={seg} index={i} canRemove={trip.lodging.length > 1}
                onChange={(p) => setTrip((t) => ({ ...t, lodging: t.lodging.map((s) => (s.id === seg.id ? { ...s, ...p } : s)) }))}
                onRemove={() => setTrip((t) => ({ ...t, lodging: t.lodging.filter((s) => s.id !== seg.id) }))} />
            ))}
            <button type="button" className="btn" onClick={() => setTrip((t) => {
              const last = t.lodging[t.lodging.length - 1];
              const checkIn = last?.checkOut && last.checkOut < t.date_to ? last.checkOut : t.date_from;
              return { ...t, lodging: [...t.lodging, { ...newTrip().lodging[0], id: uid(), location: { ...t.location_to }, checkIn, checkOut: t.date_to, datesCustom: true }] };
            })}>
              <Plus size={15} /> Add hotel / split stay
            </button>
          </section>

          {/* ---------------- M&IE ---------------- */}
          <MieSection trip={trip} onChange={(p) => patchIn('mie', p)} total={costs.mie} />
        </div>

        {/* ---------------- Summary ---------------- */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="panel space-y-3">
            <h3 className="section-title">Cost estimate</h3>
            <div className="text-xs text-slate-500">{quarterFor(trip.date_from) || 'Quarter TBD'} · {users.find((u) => u.id === trip.traveler_id)?.first_name || '—'}</div>
            <dl className="space-y-1.5 text-sm">
              {[['Airfare', costs.airfare], ['Train / Tram', costs.train], ['POV', costs.pov], ['Car rental', costs.car]].map(([k, v]) => (
                <Row key={k} k={k} v={v} muted />
              ))}
              <Row k="Travel subtotal" v={costs.travel} />
              <Row k="Lodging" v={costs.lodging} />
              <Row k="M&IE" v={costs.mie} />
            </dl>
            <div className="flex items-center justify-between border-t border-slate-200 pt-3">
              <span className="font-semibold">Total</span>
              <span className="text-xl font-bold text-brand-700">{usd(costs.total)}</span>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save trip'}</button>
            {trip.id && (trip.created_by === user.id || user.role === 'admin') && (
              <button className="btn-danger w-full" onClick={remove}><Trash2 size={15} /> Delete trip</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Debounced auto-estimate whenever `key` changes; returns [loading, manualRefresh]. */
function useEstimate(key, currentKey, run, ready) {
  const [loading, setLoading] = useState(false);
  const runRef = useRef(run);
  runRef.current = run;
  const go = async () => {
    setLoading(true);
    try { await runRef.current(); } catch { /* surfaced via estimate.error */ } finally { setLoading(false); }
  };
  useEffect(() => {
    if (!key || key === currentKey || !ready(key)) return;
    const h = setTimeout(go, 700);
    return () => clearTimeout(h);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [loading, go];
}

function LodgingSegment({ seg, index, canRemove, onChange, onRemove }) {
  const c = lodgingSegmentCost(seg);
  const gsaRate = seg.rates?.seasons?.length ? [...new Set(seg.rates.seasons.map((s) => s.lodging))] : [];
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">Hotel {index + 1}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{c.nights} night{c.nights === 1 ? '' : 's'} · <b className="text-slate-800">{usd(c.total)}</b></span>
          {canRemove && <button type="button" className="text-slate-400 hover:text-red-600" onClick={onRemove}><Trash2 size={15} /></button>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <LocationInput label="Location" value={seg.location} onChange={(location) => onChange({ location, locationCustom: true })} />
        <div><label className="label">Hotel name (optional)</label><input className="input" value={seg.hotelName} onChange={(e) => onChange({ hotelName: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Check-in" value={seg.checkIn} onChange={(checkIn) => onChange({ checkIn, datesCustom: true })} />
          <DateField label="Check-out" value={seg.checkOut} onChange={(checkOut) => onChange({ checkOut, datesCustom: true })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className="label">GSA nightly rate</span>
            <div className="py-2 text-sm">
              {seg.rates?.source === 'manual' ? <span className="text-amber-600">Enter rate →</span> : gsaRate.length ? gsaRate.map((r) => usd(r)).join(' / ') : '—'}
              <div className="truncate text-xs text-slate-400" title={seg.rates?.destination}>{seg.rates ? SOURCE_LABEL[seg.rates.source] : 'Enter a location'}</div>
            </div>
          </div>
          <Money label="Override nightly" value={seg.overrideRate} onChange={(overrideRate) => onChange({ overrideRate })} />
        </div>
      </div>
      {seg.checkIn && seg.checkOut && nightsBetween(seg.checkIn, seg.checkOut) === 0 && (
        <p className="mt-2 text-xs text-amber-600">Check-out must be after check-in.</p>
      )}
    </div>
  );
}

function MieSection({ trip, onChange, total }) {
  const [open, setOpen] = useState(false);
  const m = mieCost(trip);
  const r = trip.mie.rates;
  return (
    <section className="panel space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Utensils size={18} className="text-brand-600" /> Meals & Incidentals</h2>
        <span className="font-semibold">{usd(total)}</span>
      </div>
      <div className="grid items-end gap-3 sm:grid-cols-3">
        <div>
          <span className="label">GSA M&IE daily rate</span>
          <div className="py-2 text-sm">{r?.mie != null ? usd(r.mie) : '—'}<div className="text-xs text-slate-400">{r ? SOURCE_LABEL[r.source] : 'Enter a destination'}</div></div>
        </div>
        <Money label="Override daily rate" value={trip.mie.overrideRate} onChange={(overrideRate) => onChange({ overrideRate })} />
        <div className="text-sm text-slate-600">{m.days} day{m.days === 1 ? '' : 's'} · first & last day at 75%</div>
      </div>
      {m.days > 0 && (
        <button type="button" className="text-sm text-brand-600 hover:underline" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} daily breakdown</button>
      )}
      {open && (
        <table className="w-full text-sm">
          <tbody>
            {m.breakdown.map((b) => (
              <tr key={b.date} className="border-t border-slate-100">
                <td className="py-1.5">{b.date}</td>
                <td className="py-1.5 text-slate-500">{usd(b.rate)} × {b.pct * 100}%</td>
                <td className="py-1.5 text-right">{usd(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- small pieces

function Sub({ icon: Icon, title, right, children }) {
  return (
    <div className="border-t border-slate-100 pt-5 first-of-type:border-0 first-of-type:pt-0">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-medium text-slate-800"><Icon size={17} className="text-brand-600" /> {title}</h3>
        <span className="text-sm font-semibold">{right}</span>
      </div>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`rounded-md px-3 py-1.5 text-sm ${value === v ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 py-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-brand-600" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function DateField({ label, value, onChange }) {
  return <div><label className="label">{label}</label><input type="date" className="input" value={value || ''} onChange={(e) => onChange(e.target.value)} /></div>;
}

function Money({ label, value, onChange }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="relative">
        <span className="absolute top-2 left-3 text-sm text-slate-400">$</span>
        <input type="number" min="0" step="0.01" inputMode="decimal" className="input pl-6" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}

function ResetDates({ show, onClick }) {
  if (!show) return null;
  return <button type="button" className="self-end pb-2 text-left text-xs text-brand-600 hover:underline" onClick={onClick}>Reset to trip dates</button>;
}

function EstimateCard({ loading, onRefresh, estimate, children }) {
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {estimate ? children(estimate) : <div className="text-sm text-slate-500">{loading ? 'Fetching estimate…' : 'Complete the route and dates to get an estimate.'}</div>}
          {estimate?.summary && <p className="text-sm text-slate-600">{estimate.summary}</p>}
          {estimate && (
            <p className="flex items-center gap-1 text-xs text-slate-400">
              <Info size={12} /> {estimate.provider ? `Live · ${estimate.provider}` : SOURCE_LABEL[estimate.source]} · updated {new Date(estimate.updatedAt).toLocaleString()}
            </p>
          )}
          {estimate?.error && <p className="text-xs text-amber-600">Live lookup failed: {estimate.error}</p>}
        </div>
        <button type="button" className="btn shrink-0" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
    </div>
  );
}

function Row({ k, v, muted }) {
  return (
    <div className={`flex justify-between ${muted ? 'pl-3 text-slate-500' : 'font-medium'}`}>
      <dt>{k}</dt><dd>{usd(v)}</dd>
    </div>
  );
}
