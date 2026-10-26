// Pure trip-cost math shared by the React app and the API server.

export const PURPOSES = ['Internal', 'Client', 'Partner', 'Conference', 'Other'];

const MS_DAY = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

export function addDays(iso, n) {
  return toIso(new Date(toDate(iso).getTime() + n * MS_DAY));
}

/** Calendar-year quarter, e.g. "2026 Q1". */
export function quarterFor(iso) {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
}

export function eachDate(from, to) {
  if (!from || !to || to < from) return [];
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export const nightsBetween = (a, b) => (a && b && b > a ? Math.round((toDate(b) - toDate(a)) / MS_DAY) : 0);

/** Lodging rate for a date given GSA seasons [{begin:'MM-DD', end:'MM-DD', lodging}] (handles wrap-around seasons). */
export function lodgingRateOn(seasons = [], iso) {
  const md = iso.slice(5);
  const hit = seasons.find((s) => (s.begin <= s.end ? md >= s.begin && md <= s.end : md >= s.begin || md <= s.end));
  return hit ? Number(hit.lodging) : seasons.length ? Number(seasons[0].lodging) : 0;
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function lodgingSegmentCost(seg = {}) {
  const nights = eachDate(seg.checkIn, seg.checkOut ? addDays(seg.checkOut, -1) : null);
  const override = num(seg.overrideRate);
  const perNight = nights.map((d) => ({ date: d, rate: override ?? lodgingRateOn(seg.rates?.seasons, d) }));
  return { nights: perNight.length, perNight, total: perNight.reduce((s, n) => s + n.rate, 0) };
}

/**
 * M&IE per GSA: full daily rate for each day of travel, 75% on the first and last day.
 * The daily rate comes from the lodging segment where the traveler sleeps that
 * night (or checks out, on the final day); otherwise the destination rate.
 */
export function mieCost(trip = {}) {
  const days = eachDate(trip.date_from, trip.date_to);
  const fallback = num(trip.mie?.overrideRate) ?? num(trip.mie?.rates?.mie) ?? 0;
  const segs = trip.lodging || [];
  const rateFor = (d, isLast) => {
    if (num(trip.mie?.overrideRate) != null) return fallback;
    const seg = segs.find((s) => s.checkIn && s.checkOut && (isLast ? d > s.checkIn && d <= s.checkOut : d >= s.checkIn && d < s.checkOut));
    return num(seg?.overrideMie) ?? num(seg?.rates?.mie) ?? fallback;
  };
  const breakdown = days.map((d, i) => {
    const first = i === 0;
    const last = i === days.length - 1;
    const full = rateFor(d, last && !first);
    const pct = first || last ? 0.75 : 1;
    return { date: d, rate: full, pct, amount: full * pct };
  });
  return { days: days.length, breakdown, total: breakdown.reduce((s, b) => s + b.amount, 0) };
}

export function airfareCost(a = {}) {
  if (a.mode === 'none') return 0;
  if (a.mode === 'booked') return num(a.bookedAmount) ?? 0;
  return num(a.estimate?.lowestPrice) ?? 0;
}

export function povCost(p = {}) {
  if (!p.enabled) return 0;
  return (num(p.miles) ?? 0) * (p.roundTrip ? 2 : 1) * (num(p.rate) ?? 0);
}

export function carCost(c = {}) {
  if (!c.enabled) return 0;
  if (c.mode === 'booked') return num(c.bookedAmount) ?? 0;
  return num(c.estimate?.totalEstimate) ?? 0;
}

export function tripCosts(trip = {}) {
  const lodging = (trip.lodging || []).map(lodgingSegmentCost);
  const costs = {
    airfare: airfareCost(trip.airfare),
    train: num(trip.train) ?? 0,
    pov: povCost(trip.pov),
    car: carCost(trip.car),
    lodging: lodging.reduce((s, l) => s + l.total, 0),
    mie: mieCost(trip).total,
  };
  costs.travel = costs.airfare + costs.train + costs.pov + costs.car;
  costs.total = costs.travel + costs.lodging + costs.mie;
  return costs;
}

export const usd = (n) =>
  (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
