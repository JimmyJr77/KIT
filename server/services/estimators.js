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

// Estimates assume a normal business trip: direct flights leaving between 10am and 8pm local time, on full-service
// airlines. Budget and ultra-low-cost carriers (IATA codes) are used only when no full-service airline flies direct.
export const BUDGET_AIRLINES = [
  'NK', 'F9', 'G4', 'SY', 'XP', 'MX', 'WN', 'F8', 'Y4', 'VB', // North America
  'FR', 'RK', 'U2', 'EC', 'DS', 'W6', 'W4', 'W9', 'VY', 'V7', 'HV', 'TO', 'DY', 'D8', 'EW', 'PC', 'LS', 'BY', // Europe
  'AK', 'FD', 'D7', 'QZ', 'TR', 'JQ', '3K', 'GK', '5J', '6E', 'SG', 'IX', 'VJ', 'MM', 'ZG', '7C', 'LJ', 'TW', // Asia-Pacific
  'G9', 'FZ', 'XY', 'J9', 'JA', 'H2', 'G3', // Middle East, Latin America
];
const BUDGET = new Set(BUDGET_AIRLINES);
export const FLIGHT_HOURS = { from: 10, to: 20 };
const hm = (iso) => Number(iso.slice(11, 13)) + Number(iso.slice(14, 16)) / 60;
const isDaytime = (iso) => !!iso && hm(iso) >= FLIGHT_HOURS.from && hm(iso) <= FLIGHT_HOURS.to;
const FLIGHT_RULE = 'direct flights on full-service airlines, departing 10am–8pm';
const BUDGET_RULE = 'direct flights on budget airlines, departing 10am–8pm (no full-service direct flights found)';
const NO_DIRECT = 'No direct flights departing 10am–8pm on these dates';

export function flightQuery({ tripType = 'round-trip', origin, destination, departDate, returnDate }) {
  const rt = tripType !== 'one-way';
  return `Find a ${rt ? 'round-trip' : 'one-way'} flight from ${origin} to ${destination} departing on ${longDate(departDate)}${rt && returnDate ? ` and returning on ${longDate(returnDate)}` : ''}, direct (non-stop) only, departing between 10am and 8pm local time each way, on full-service airlines, or on budget airlines if no full-service airline flies direct.`;
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
    // Direct daytime departures only, both ways, on full-service airlines (see budgetFallback for the search without them).
    max_sector_stopovers: 0,
    exclude_airlines: BUDGET_AIRLINES.join(','),
    dtime_from: FLIGHT_HOURS.from,
    dtime_to: FLIGHT_HOURS.to,
    ...(tripType !== 'one-way' && returnDate ? { ret_dtime_from: FLIGHT_HOURS.from, ret_dtime_to: FLIGHT_HOURS.to } : {}),
  };
}

/** The same search on any airline. Kiwi returns just the ~15 cheapest, so budget fares would crowd out full-service ones in one search. */
const budgetFallback = ({ exclude_airlines, ...args }) => args;

const legsOf = (i) => [i.outbound, i.inbound].filter(Boolean);

/**
 * Priced itineraries, cheapest first, keeping only those where each leg (out and back) is direct and departs
 * 10:00–20:00 local time. Kiwi applies the same filters; this enforces them exactly (its hour filter lets 20:59 through).
 */
const kiwiItineraries = ({ text, structured }) =>
  ((structured?.itineraries ? structured : JSON.parse(text)).itineraries || [])
    .filter((i) => Number.isFinite(i.price))
    .filter((i) => legsOf(i).length && legsOf(i).every((l) => l.stops === 0 && isDaytime(l.departureTime)))
    .sort((a, b) => a.price - b.price);

const isFullService = (i) => legsOf(i).every((l) => l.segments.every((s) => !BUDGET.has(s.carrier)));

/**
 * Lowest fare, the middle-50% price band and airlines, per the Airfare prompt. Uses the full-service flights in
 * `result`, or if there are none, the flights in `budgetResult` (the same search on any airline).
 */
export function summarizeKiwi(result, tripType, budgetResult) {
  const fullService = kiwiItineraries(result).filter(isFullService);
  const its = fullService.length ? fullService : budgetResult ? kiwiItineraries(budgetResult) : [];
  if (!its.length) throw new Error(NO_DIRECT);
  const rule = fullService.length ? FLIGHT_RULE : BUDGET_RULE;
  const prices = its.map((i) => i.price);
  const pct = (p) => prices[Math.round(p * (prices.length - 1))];
  const cheapest = its[0];
  const route = legsOf(cheapest).map((l) => l.route.join(' → ')).join(' / ');
  const noCarryOn = cheapest.baggage && cheapest.baggage.cabinBag === 0;
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  return {
    lowestPrice: cheapest.price,
    averageLow: pct(0.25),
    averageHigh: pct(0.75),
    airlines: [...new Set(its.flatMap((i) => legsOf(i).flatMap((l) => l.segments.map((s) => s.carrierName))))].slice(0, 6),
    itinerary: 'non-stop',
    bookingUrl: cheapest.bookingUrl,
    resultsCount: its.length,
    rule,
    summary: `Lowest ${tripType === 'one-way' ? 'one-way' : 'round-trip'} economy fare on ${rule}: ${money(cheapest.price)} (${route})` +
      `${noCarryOn ? ', carry-on bag not included' : ''}.`,
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
        const [result, budgetResult] = await Promise.all([
          call(args),
          call(budgetFallback(args)).catch(() => null),
        ]);
        return {
          ...base,
          source: 'mcp',
          provider: 'Kiwi.com',
          searched: `${args.flyFrom} → ${args.flyTo}`,
          ...summarizeKiwi(result, input.tripType, budgetResult),
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
      return { ...base, source: 'mcp', rule: FLIGHT_RULE, ...est };
    } catch (e) {
      return {
        ...base,
        ...placeholderFlight(input),
        summary: e.message === NO_DIRECT
          ? 'Placeholder estimate. Kiwi.com does not sell every airline, so check for a direct flight elsewhere or enter the fare under Booked.'
          : 'Live fare search returned nothing, so this is a placeholder. Try airport codes (e.g. DCA → DEN) in Origin / Destination.',
        error: e.message,
      };
    }
  }
  return { ...base, ...placeholderFlight(input) };
}

function placeholderFlight({ tripType, intl }) {
  const rt = tripType !== 'one-way';
  // Typical direct, full-service daytime economy fares, a little above the cheapest budget fares.
  const p = (intl ? 1300 : 550) * (rt ? 1 : 0.6);
  return {
    source: 'placeholder',
    lowestPrice: Math.round(p),
    averageLow: Math.round(p * 0.9),
    averageHigh: Math.round(p * 1.4),
    airlines: [],
    itinerary: 'unknown',
    rule: FLIGHT_RULE,
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
