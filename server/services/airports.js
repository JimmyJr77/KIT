// Turns a trip location ("Denver, CO", "London, United Kingdom", "Bethesda, MD")
// into airport codes for the flight search. Data: server/data/airports.json,
// built from mwgg/Airports by server/scripts/buildAirports.js.
import fs from 'node:fs';
import { STATE_NAMES, CITY_COUNTY } from './gsa.js';

let data;
const load = () => (data ??= JSON.parse(fs.readFileSync(new URL('../data/airports.json', import.meta.url), 'utf8')));

// Multi-airport metros whose airports aren't listed under the city itself.
const METROS = {
  'washington|DC': ['DCA', 'IAD', 'BWI'],
  'new york|NY': ['JFK', 'LGA', 'EWR'],
  'new york city|NY': ['JFK', 'LGA', 'EWR'],
};

// DC suburbs (GSA's District of Columbia per diem area) fly out of the DC airports.
const DC_AREA = new Set([
  'VA|arlington', 'VA|alexandria', 'VA|fairfax', 'VA|falls church',
  ...Object.keys(CITY_COUNTY), // e.g. 'MD|bethesda', 'VA|tysons'
]);

const MAX_CODES = 6;
const NEARBY_KM = 120;

// Country name (any case) -> ISO 3166-1 alpha-2, from the runtime's region names.
let countries;
function countryCode(name) {
  if (!countries) {
    countries = { usa: 'US', 'united states of america': 'US', uk: 'GB', england: 'GB', scotland: 'GB', 'great britain': 'GB', korea: 'KR' };
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      try {
        const n = names.of(code);
        // First code wins, so "United Kingdom" maps to GB rather than the alias UK.
        if (n && n !== code) countries[n.toLowerCase()] ??= code;
      } catch { /* not a region */ }
    }
  }
  const s = String(name || '').trim();
  return /^[A-Z]{2}$/i.test(s) ? s.toUpperCase() : countries[s.toLowerCase()] || null;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

/** Parse free text like "DCA", "Portland, ME" or "London, United Kingdom" into a location. */
export function parsePlace(text) {
  const parts = String(text || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const [city, second, third] = parts;
  if (second && STATE_NAMES[second.toUpperCase()]) return { city, state: second.toUpperCase() };
  if (third) return { intl: true, city, state: second, country: third };
  if (second) return { intl: true, city, country: second };
  return { city };
}

/**
 * Returns a comma-separated list of airport codes for a location, or null when
 * the location can't be resolved (the caller then falls back to the city name).
 * Locations: { intl, city, state, country } or free text.
 */
export function airportCodes(place) {
  if (typeof place === 'string') {
    const codes = place.toUpperCase().replace(/\s/g, '');
    if (/^[A-Z]{3}(,[A-Z]{3})*$/.test(codes)) return codes;
    place = parsePlace(place);
  }
  if (!place?.city) return null;
  const city = place.city.trim().toLowerCase();
  const state = place.intl ? '' : String(place.state || '').toUpperCase();
  if (METROS[`${city}|${state}`]) return METROS[`${city}|${state}`].join(',');
  if (DC_AREA.has(`${state}|${city}`)) return METROS['washington|DC'].join(',');

  const country = place.intl ? countryCode(place.country) : 'US';
  if (!country) return null;
  const region = country === 'US' && state ? STATE_NAMES[state] : null;
  if (state && country === 'US' && !region) return null;

  const { iata, cities } = load();
  const inRegion = (a) => a[3] === country && (!region || a[2] === region);
  const local = iata.filter((a) => inRegion(a) && a[1].toLowerCase() === city);
  if (local.length) return local.slice(0, MAX_CODES).map((a) => a[0]).join(',');

  // No airport in the town itself: use the airports nearest to it.
  const coords = Object.entries(cities).find(([k]) => {
    const [c, s, ctry] = k.split('|');
    return c === city && ctry === country.toLowerCase() && (!region || s === region.toLowerCase());
  })?.[1];
  if (!coords) return null;
  const nearby = iata
    .filter((a) => a[3] === country)
    .map((a) => ({ code: a[0], km: distanceKm(coords[0], coords[1], a[4], a[5]) }))
    .filter((a) => a.km <= NEARBY_KM)
    .sort((x, y) => x.km - y.km)
    .slice(0, MAX_CODES);
  return nearby.length ? nearby.map((a) => a.code).join(',') : null;
}
