// Airfare and rental car estimators.
//
// When an MCP server is configured, the query is built with the blueprint from
// the corresponding prompt (server/prompts/*.md), the MCP tool is called, and
// Gemini extracts a structured estimate from the tool payload using that prompt
// as its system instruction. Without MCP/Gemini, a clearly-labelled placeholder
// estimate is returned so the rest of the app keeps working.
import fs from 'node:fs';
import { Type } from '@google/genai';
import { callMcpTool } from './mcp.js';
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

const PLACEHOLDER_DAILY = { 'Economy / Compact': 55, 'Midsize / Full-size': 70, 'SUV / Minivan': 95, 'Luxury / Convertible': 140 };

export async function estimateCar(input) {
  const query = carQuery(input);
  const days = daysBetween(input.pickupDate, input.dropoffDate);
  const base = { query, updatedAt: new Date().toISOString() };

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
