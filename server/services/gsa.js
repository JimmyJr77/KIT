// GSA per diem (lodging + M&IE) and POV mileage lookups.
//
// Lookup order for a CONUS location:
//   1. Rates imported from the official GSA per diem master file (gsa_rates table)
//   2. The GSA Per Diem API (if GSA_API_KEY is set — free key at api.data.gov), cached
//   3. The standard CONUS rate from settings
// International (OCONUS) locations are not covered by GSA; the user enters rates manually.
import { db, getSetting, json } from '../db.js';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function fiscalYear() {
  return Number(getSetting('gsa_fiscal_year'));
}

function standardRate(fy) {
  return {
    source: 'standard',
    fiscalYear: fy,
    destination: 'Standard CONUS rate',
    county: null,
    seasons: [{ begin: '01-01', end: '12-31', lodging: Number(getSetting('conus_lodging')) }],
    mie: Number(getSetting('conus_mie')),
  };
}

function fromImported(city, state, fy) {
  const rows = db.prepare(`SELECT * FROM gsa_rates WHERE fiscal_year = ? AND state = ?
    AND (destination LIKE ? OR county LIKE ?) ORDER BY id`).all(fy, state, `%${city}%`, `%${city}%`);
  // GSA lists Washington, DC as "District of Columbia".
  if (!rows.length && state === 'DC') rows.push(...db.prepare('SELECT * FROM gsa_rates WHERE fiscal_year = ? AND state = ? ORDER BY id').all(fy, state));
  if (!rows.length) return null;
  // Prefer rows whose destination matches the city over county-only matches.
  const destRows = rows.filter((r) => r.destination.toLowerCase().includes(city.toLowerCase()));
  const pick = destRows.length ? destRows : rows;
  const first = pick[0];
  const same = pick.filter((r) => r.destination === first.destination);
  return {
    source: 'gsa-file',
    fiscalYear: fy,
    destination: first.destination,
    county: first.county,
    seasons: same.map((r) => ({ begin: r.season_begin || '01-01', end: r.season_end || '12-31', lodging: r.lodging })),
    mie: first.mie,
  };
}

async function fromApi(city, state, fy) {
  const key = process.env.GSA_API_KEY;
  if (!key) return null;
  const cacheKey = `${fy}|${state}|${city}`.toLowerCase();
  const cached = db.prepare("SELECT json FROM gsa_cache WHERE key = ? AND fetched_at > datetime('now', '-30 days')").get(cacheKey);
  if (cached) return json.parse(cached.json, null);
  try {
    const url = `https://api.gsa.gov/travel/perdiem/v2/rates/city/${encodeURIComponent(city)}/state/${encodeURIComponent(state)}/year/${fy}`;
    const res = await fetch(url, { headers: { 'x-api-key': key } });
    if (!res.ok) return null;
    const body = await res.json();
    const rate = body?.rates?.[0]?.rate?.[0];
    if (!rate) return null;
    const months = rate.months?.month || [];
    const result = {
      source: 'gsa-api',
      fiscalYear: fy,
      destination: rate.city,
      county: rate.county,
      seasons: months.map((m) => {
        const mm = String(m.number).padStart(2, '0');
        return { begin: `${mm}-01`, end: `${mm}-31`, lodging: Number(m.value) };
      }),
      mie: Number(rate.meals),
    };
    db.prepare('INSERT OR REPLACE INTO gsa_cache (key, json, fetched_at) VALUES (?, ?, datetime(\'now\'))').run(cacheKey, json.str(result));
    return result;
  } catch {
    return null;
  }
}

/** location = { intl, city, state, country } */
export async function lookupRates(location = {}) {
  const fy = fiscalYear();
  if (location.intl) {
    return { source: 'manual', fiscalYear: fy, destination: 'International (OCONUS) — enter rates manually', seasons: [], mie: null };
  }
  const city = String(location.city || '').trim();
  const state = String(location.state || '').trim().toUpperCase();
  if (!city || !state) return standardRate(fy);
  return fromImported(city, state, fy) || (await fromApi(city, state, fy)) || standardRate(fy);
}

export function mileageRate() {
  return Number(getSetting('pov_mileage_rate'));
}

// ---------------------------------------------------------------------------
// Importer for the GSA per diem master file (CSV export of the XLSX published
// at gsa.gov/travel/plan-book/per-diem-rates/per-diem-files).

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

function parseSeasonDate(v, fallback) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return fallback;
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^([a-z]{3})[a-z]*\.?\s*(\d{1,2})?/);
  if (m && MONTHS.includes(m[1])) {
    const mm = String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0');
    const dd = m[2] ? m[2].padStart(2, '0') : fallback === '12-31' ? '31' : '01';
    return `${mm}-${dd}`;
  }
  return fallback;
}

const money = (v) => Number(String(v || '').replace(/[$,\s]/g, ''));

export function importGsaCsv(text, fy = fiscalYear()) {
  const rows = parseCsv(text);
  const headerIdx = rows.findIndex((r) => {
    const h = r.join('|').toLowerCase();
    return h.includes('state') && h.includes('lodging');
  });
  if (headerIdx < 0) throw new Error('Could not find a header row containing "State" and "Lodging"');
  const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const col = (re) => header.findIndex((h) => re.test(h));
  const c = {
    state: col(/^state/),
    dest: col(/destination|city|location/),
    county: col(/county/),
    begin: col(/season.*begin|begin/),
    end: col(/season.*end|end/),
    lodging: col(/lodging/),
    mie: col(/m&ie|m & ie|mie|meals/),
  };
  if ([c.state, c.dest, c.lodging, c.mie].some((i) => i < 0)) {
    throw new Error(`Missing required columns. Found headers: ${header.join(', ')}`);
  }
  const data = rows.slice(headerIdx + 1)
    .map((r) => ({
      fiscal_year: fy,
      state: String(r[c.state] || '').trim().toUpperCase(),
      destination: String(r[c.dest] || '').trim(),
      county: c.county >= 0 ? String(r[c.county] || '').trim() : null,
      season_begin: c.begin >= 0 ? parseSeasonDate(r[c.begin], '01-01') : '01-01',
      season_end: c.end >= 0 ? parseSeasonDate(r[c.end], '12-31') : '12-31',
      lodging: money(r[c.lodging]),
      mie: money(r[c.mie]),
    }))
    .filter((d) => d.state && d.destination && d.lodging > 0);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM gsa_rates WHERE fiscal_year = ?').run(fy);
    const ins = db.prepare(`INSERT INTO gsa_rates (fiscal_year, state, destination, county, season_begin, season_end, lodging, mie)
      VALUES (@fiscal_year, @state, @destination, @county, @season_begin, @season_end, @lodging, @mie)`);
    data.forEach((d) => ins.run(d));
  });
  tx();
  return { imported: data.length, fiscalYear: fy };
}
