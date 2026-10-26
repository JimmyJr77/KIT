// Builds server/data/airports.json from the mwgg/Airports dataset (MIT license,
// https://github.com/mwgg/Airports).
// Usage: node server/scripts/buildAirports.js [path-or-url-to-airports.json]
import fs from 'node:fs';

const SRC = process.argv[2] || 'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';
const raw = SRC.startsWith('http') ? await (await fetch(SRC)).json() : JSON.parse(fs.readFileSync(SRC, 'utf8'));

const round = (n) => Math.round(n * 1000) / 1000;
const key = (a) => `${a.city}|${a.state || ''}|${a.country}`.toLowerCase();

// Airports with an IATA code: [iata, city, state, country, lat, lon]
const iata = [];
// One coordinate per city (from any airfield, heliport, etc.) to find the nearest
// airports for towns that have no commercial airport of their own.
const cities = {};
for (const a of Object.values(raw)) {
  if (!a.city || !a.country) continue;
  if (a.iata && /^[A-Z]{3}$/.test(a.iata)) iata.push([a.iata, a.city, a.state || '', a.country, round(a.lat), round(a.lon)]);
  cities[key(a)] ??= [round(a.lat), round(a.lon)];
}

const out = new URL('../data/airports.json', import.meta.url);
fs.writeFileSync(out, JSON.stringify({ source: 'https://github.com/mwgg/Airports (MIT)', iata, cities }));
console.log(`Wrote ${iata.length} airports and ${Object.keys(cities).length} city coordinates to ${out.pathname}`);
