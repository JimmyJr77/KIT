// Airfare and rental car estimators.
//
// When an MCP server is configured, the query is built with the blueprint from
// the corresponding prompt (server/prompts/*.md), the MCP tool is called, and
// Gemini extracts a structured estimate from the tool payload using that prompt
// as its system instruction. Without MCP/Gemini, a clearly-labelled placeholder
// estimate is returned so the rest of the app keeps working.
import fs from 'node:fs';
import { Type } from '@google/genai';
import { callMcpTool, callMcpToolKeepAlive } from './mcp.js';
import { airportCodes } from './airports.js';
import { generateJson, geminiConfigured } from './gemini.js';

const prompt = (f) => fs.readFileSync(new URL(`../prompts/${f}`, import.meta.url), 'utf8');
const AIRFARE_PROMPT = prompt('airfare.md');
const RENTAL_PROMPT = prompt('rentalCar.md');

export const VEHICLE_CLASSES = ['Economy / Compact', 'Midsize / Full-size', 'SUV / Minivan', 'Luxury / Convertible'];

export const placeLabel = (l = {}) =>
  [l.city, l.state, l.intl ? l.country : null].filter(Boolean).join(', ');

const longDate = (iso) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const time12 = (t = '10:00') => {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const daysBetween = (a, b) => Math.max(1, Math.round((new Date(b) - new Date(a)) / 86400000));

export const mcpStatus = () => ({
  airfare: !!process.env.AIRFARE_MCP_URL,
  rentalCar: !!process.env.RENTALCAR_MCP_URL,
  gemini: geminiConfigured(),
});

// ---------------------------------------------------------------- Airfare

export function flightQuery({ tripType = 'round-trip', origin, destination, departDate, returnDate }) {
  const rt = tripType !== 'one-way';
  return `Find a ${rt ? 'round-trip' : 'one-way'} flight from ${origin} to ${destination} departing on ${longDate(departDate)}${rt && returnDate ? ` and returning on ${longDate(returnDate)}` : ''}.`;
}

const FLIGHT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    lowestPrice: { type: Type.NUMBER, description: 'Lowest available total price in USD' },
    averageLow: { type: Type.NUMBER, description: 'Low end of the average price band in USD' },
    averageHigh: { type: Type.NUMBER, description: 'High end of the average price band in USD' },
    airlines: { type: Type.ARRAY, items: { type: Type.STRING } },
    itinerary: { type: Type.STRING, enum: ['non-stop', 'layover', 'mixed', 'unknown'] },
    summary: { type: Type.STRING, description: 'One or two sentence clean summary for the user, no JSON' },
  },
  required: ['lowestPrice', 'summary'],
};

// Kiwi.com's official MCP server (https://mcp.kiwi.com, tool "search-flight") takes
// structured fields and returns structured itineraries, so no LLM parsing is needed.
const KIWI_TOOL = 'search-flight';
const ddmmyyyy = (iso) => iso.split('-').reverse().join('/');

// Kiwi resolves "Denver" or "DEN" but not "Denver, CO". Airport codes are sent when the
// location resolves (see airports.js); otherwise just the city name.
const kiwiPlace = (s) => String(s).split(',')[0].trim();

export function kiwiArgs({ tripType = 'round-trip', origin, destination, originPlace, destinationPlace, departDate, returnDate }) {
  return {
    flyFrom: airportCodes(originPlace ?? origin) || kiwiPlace(origin),
    flyTo: airportCodes(destinationPlace ?? destination) || kiwiPlace(destination),
    departureDate: ddmmyyyy(departDate),
    ...(tripType !== 'one-way' && returnDate ? { returnDate: ddmmyyyy(returnDate) } : {}),
    adults: 1,
    cabinClass: 'M',
    currency: 'USD',
    locale: 'en',
  };
}

/** Lowest fare, the middle-50% price band, airlines, and non-stop vs layover, per the Airfare prompt. */
const kiwiItineraries = ({ text, structured }) =>
  ((structured?.itineraries ? structured : JSON.parse(text)).itineraries || [])
    .filter((i) => Number.isFinite(i.price))
    .sort((a, b) => a.price - b.price);

/**
 * Lowest fare, the middle-50% price band, airlines, and non-stop vs layover, per the Airfare prompt.
 * `nonstopResult` is a separate non-stop-only search: Kiwi returns just the ~15 cheapest
 * itineraries, so non-stops rarely appear in the main results.
 */
export function summarizeKiwi(result, tripType, nonstopResult) {
  const its = kiwiItineraries(result);
  if (!its.length) throw new Error('No flights found for this route and dates');
  const legs = (i) => [i.outbound, i.inbound].filter(Boolean);
  const isNonstop = (i) => legs(i).every((l) => l.stops === 0);
  const prices = its.map((i) => i.price);
  const pct = (p) => prices[Math.round(p * (prices.length - 1))];
  const cheapest = its[0];
  const nonstop = (nonstopResult ? kiwiItineraries(nonstopResult) : []).find(isNonstop) || its.find(isNonstop);
  const itinerary = isNonstop(cheapest) ? 'non-stop' : 'layover';
  const route = legs(cheapest).map((l) => l.route.join(' → ')).join(' / ');
  const noCarryOn = cheapest.baggage && cheapest.baggage.cabinBag === 0;
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  return {
    lowestPrice: cheapest.price,
    averageLow: pct(0.25),
    averageHigh: pct(0.75),
    airlines: [...new Set(its.flatMap((i) => legs(i).flatMap((l) => l.segments.map((s) => s.carrierName))))].slice(0, 6),
    itinerary,
    nonstopPrice: nonstop?.price ?? null,
    bookingUrl: cheapest.bookingUrl,
    resultsCount: its.length,
    summary: `Lowest ${tripType === 'one-way' ? 'one-way' : 'round-trip'} economy fare ${money(cheapest.price)} (${itinerary}: ${route})` +
      `${noCarryOn ? ', carry-on bag not included' : ''}. ` +
      (nonstop ? `Cheapest non-stop: ${money(nonstop.price)}.` : 'No non-stop fares found on Kiwi.com (it does not sell every airline).'),
  };
}

export async function estimateFlight(input) {
  const query = flightQuery(input);
  const base = { query, updatedAt: new Date().toISOString() };
  const tool = process.env.AIRFARE_MCP_TOOL || 'search_flights';

  if (process.env.AIRFARE_MCP_URL) {
    try {
      if (tool === KIWI_TOOL) {
        const args = kiwiArgs(input);
        const call = (a) => callMcpTool({ url: process.env.AIRFARE_MCP_URL, headers: process.env.AIRFARE_MCP_HEADERS, tool, args: a });
        const [result, nonstopResult] = await Promise.all([
          call(args),
          call({ ...args, max_sector_stopovers: 0 }).catch(() => null),
        ]);
        return {
          ...base,
          source: 'mcp',
          provider: 'Kiwi.com',
          searched: `${args.flyFrom} → ${args.flyTo}`,
          ...summarizeKiwi(result, input.tripType, nonstopResult),
        };
      }
      // Any other server: send the natural-language blueprint query and let Gemini
      // extract the estimate using the Airfare prompt.
      const { text: payload } = await callMcpTool({
        url: process.env.AIRFARE_MCP_URL,
        headers: process.env.AIRFARE_MCP_HEADERS,
        tool,
        args: { query },
      });
      if (!geminiConfigured()) {
        const prices = [...payload.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter(Boolean);
        if (!prices.length) throw new Error('Could not parse a price from the MCP payload (set GEMINI_API_KEY for smart parsing)');
        return { ...base, source: 'mcp', lowestPrice: Math.min(...prices), summary: `Lowest fare found: $${Math.min(...prices)}` };
      }
      const est = await generateJson(
        `Tool query: ${query}\n\nTool payload from ${tool}:\n${payload.slice(0, 60000)}\n\nExtract the estimate.`,
        FLIGHT_SCHEMA,
        { system: AIRFARE_PROMPT },
      );
      return { ...base, source: 'mcp', ...est };
    } catch (e) {
      return {
        ...base,
        ...placeholderFlight(input),
        summary: 'Live fare search returned nothing, so this is a placeholder. Try airport codes (e.g. DCA → DEN) in Origin / Destination.',
        error: e.message,
      };
    }
  }
  return { ...base, ...placeholderFlight(input) };
}

function placeholderFlight({ tripType, intl }) {
  const rt = tripType !== 'one-way';
  const p = (intl ? 1200 : 450) * (rt ? 1 : 0.6);
  return {
    source: 'placeholder',
    lowestPrice: Math.round(p),
    averageLow: Math.round(p * 0.9),
    averageHigh: Math.round(p * 1.4),
    airlines: [],
    itinerary: 'unknown',
    summary: 'Placeholder estimate — configure AIRFARE_MCP_URL for live fares.',
  };
}

// ---------------------------------------------------------------- Rental car

export function carQuery({ vehicleClass, location, pickupDate, pickupTime, dropoffDate, dropoffTime }) {
  return `Find a ${vehicleClass} car rental at ${location} picking up on ${longDate(pickupDate)} at ${time12(pickupTime)} and dropping off on ${longDate(dropoffDate)} at ${time12(dropoffTime)}.`;
}

const CAR_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    totalEstimate: { type: Type.NUMBER, description: 'Total estimated cost in USD' },
    dailyRate: { type: Type.NUMBER, description: 'Daily rate in USD' },
    days: { type: Type.NUMBER },
    suppliers: { type: Type.ARRAY, items: { type: Type.STRING } },
    included: { type: Type.STRING, description: 'What the estimate includes, e.g. "base rate for 3 days"' },
    summary: { type: Type.STRING },
  },
  required: ['totalEstimate', 'summary'],
};

// OctoTrip's rental-car MCP server (free, no key): https://mcp.octotrip.app/rental-cars/mcp, tool "search".
// It takes structured fields and returns offers by category, so no Gemini parsing is needed.
const OCTOTRIP_TOOL = 'search';
const isOctoTrip = () => /octotrip/i.test(process.env.RENTALCAR_MCP_URL || '') || process.env.RENTALCAR_MCP_TOOL === OCTOTRIP_TOOL;
// Our vehicle classes, matched on OctoTrip's offers. Its `category` is only the car's size; the body type is the
// 2nd letter of the industry SIPP code (F = SUV, J = all-terrain, V = van, T = convertible, P = pickup).
const sippBody = (o) => String(o.sipp || '').toUpperCase()[1] || '';
const bodyIn = (o, letters) => !!sippBody(o) && letters.includes(sippBody(o));
const size = (o) => String(o.category || '').toLowerCase();
const OCTOTRIP_CLASS = {
  'Economy / Compact': (o) => /^(mini|economy|compact)/.test(size(o)) && !bodyIn(o, 'VPF'),
  'Midsize / Full-size': (o) => /^(intermediate|standard|full ?size|midsize)/.test(size(o)) && !bodyIn(o, 'VPFJ'),
  'SUV / Minivan': (o) => bodyIn(o, 'FJVGW') || /suv|van/.test(size(o)),
  'Luxury / Convertible': (o) => (/luxury|premium/.test(size(o)) && !bodyIn(o, 'P')) || bodyIn(o, 'T'),
};

// OctoTrip allows about one search per second per server, so searches wait their turn.
const OCTOTRIP_GAP_MS = 1200;
let octoTripQueue = Promise.resolve();
const octoTripTurn = () => {
  const turn = octoTripQueue.then(() => new Promise((r) => setTimeout(r, OCTOTRIP_GAP_MS)));
  octoTripQueue = turn.catch(() => {});
  return octoTripQueue;
};

async function octoTripSearch(location, input) {
  const run = async () => {
    const { text } = await callMcpToolKeepAlive({
      url: process.env.RENTALCAR_MCP_URL,
      headers: process.env.RENTALCAR_MCP_HEADERS,
      tool: process.env.RENTALCAR_MCP_TOOL || OCTOTRIP_TOOL,
      args: {
        location,
        pickup_date: input.pickupDate,
        dropoff_date: input.dropoffDate,
        pickup_time: input.pickupTime || '12:00',
        dropoff_time: input.dropoffTime || '12:00',
        currency: 'USD',
      },
    });
    return JSON.parse(text);
  };
  const wait = octoTripTurn();
  await wait;
  return run();
}

async function octoTripCar(input, days) {
  // A city name resolves to its downtown branches, which often have little. "<City> airport" finds the main airport;
  // airport codes alone are unreliable ("SAN" resolved to Rimini), so they go last and carry the word "airport".
  const city = String(input.location || '').split(',')[0].trim();
  const codes = String(airportCodes(input.location) || '').split(',').filter(Boolean).slice(0, 2);
  const tries = [...new Set([input.location, city && `${city} airport`, ...codes.map((c) => `${c} airport`)].filter(Boolean))];
  const matches = OCTOTRIP_CLASS[input.vehicleClass] || (() => true);
  let data = null;
  let offers = [];
  let inClass = [];
  let fallback = null; // the first place with any cars, in case none have the requested class
  for (const location of tries) {
    const found = await octoTripSearch(location, input);
    const usable = (found.results || []).filter((o) => o.currency === 'USD' && Number.isFinite(o.price));
    if (usable.length && !fallback) fallback = { data: found, offers: usable };
    if (usable.some(matches)) { data = found; offers = usable; inClass = usable.filter(matches); break; }
  }
  if (!inClass.length && fallback) ({ data, offers } = fallback);
  if (!offers.length) throw new Error('No rental cars found for that location and dates');
  const pool = (inClass.length ? inClass : offers).sort((a, b) => a.price - b.price);
  const best = pool[0];
  const rentalDays = data.rental_days || days;
  return {
    source: 'mcp',
    provider: 'OctoTrip',
    days: rentalDays,
    dailyRate: Math.round((best.price_per_day ?? best.price / rentalDays) * 100) / 100,
    totalEstimate: Math.round(best.price),
    suppliers: [...new Set(pool.slice(0, 5).map((o) => o.vendor).filter(Boolean))],
    included: `${best.category} ${best.name} from ${best.vendor}, ${rentalDays} day(s), ${best.mileage || 'mileage per vendor'}${best.included_protections?.length ? `; includes ${best.included_protections.slice(0, 3).join(', ')}` : ''}`,
    summary: `Cheapest ${inClass.length ? input.vehicleClass : 'available'} car near ${data.pickup_location_resolved || input.location}: `
      + `${best.name} from ${best.vendor}, $${Math.round(best.price)} for ${rentalDays} day(s)`
      + `${inClass.length ? '' : ` (no ${input.vehicleClass} offers, so the cheapest of any class)`}. ${offers.length} offers checked.`,
  };
}

const PLACEHOLDER_DAILY = { 'Economy / Compact': 55, 'Midsize / Full-size': 70, 'SUV / Minivan': 95, 'Luxury / Convertible': 140 };

export async function estimateCar(input) {
  const query = carQuery(input);
  const days = daysBetween(input.pickupDate, input.dropoffDate);
  const base = { query, updatedAt: new Date().toISOString() };

  if (process.env.RENTALCAR_MCP_URL && isOctoTrip()) {
    try {
      return { ...base, ...(await octoTripCar(input, days)) };
    } catch (e) {
      return { ...base, ...placeholderCar(input, days), summary: 'Live rental search failed, so this is a placeholder estimate.', error: e.message };
    }
  }
  if (process.env.RENTALCAR_MCP_URL) {
    try {
      const { text: payload } = await callMcpTool({
        url: process.env.RENTALCAR_MCP_URL,
        headers: process.env.RENTALCAR_MCP_HEADERS,
        tool: process.env.RENTALCAR_MCP_TOOL || 'find_car_rental_offerings',
        args: { query },
      });
      if (!geminiConfigured()) throw new Error('Set GEMINI_API_KEY to parse rental car results');
      const est = await generateJson(
        `Tool query: ${query}\nRental length: ${days} day(s)\n\nTool payload from find_car_rental_offerings:\n${payload.slice(0, 60000)}\n\nExtract the estimate.`,
        CAR_SCHEMA,
        { system: RENTAL_PROMPT },
      );
      return { ...base, source: 'mcp', days, ...est };
    } catch (e) {
      return { ...base, ...placeholderCar(input, days), summary: 'Live rental search failed, so this is a placeholder estimate.', error: e.message };
    }
  }
  return { ...base, ...placeholderCar(input, days) };
}

function placeholderCar({ vehicleClass }, days) {
  const daily = PLACEHOLDER_DAILY[vehicleClass] || 70;
  return {
    source: 'placeholder',
    days,
    dailyRate: daily,
    totalEstimate: Math.round(daily * days * 1.25),
    suppliers: [],
    included: `Base rate for ${days} day(s) plus ~25% taxes/fees`,
    summary: 'Placeholder estimate — configure RENTALCAR_MCP_URL for live rates.',
  };
}
