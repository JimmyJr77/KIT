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

export async function estimateFlight(input) {
  const query = flightQuery(input);
  const base = { query, updatedAt: new Date().toISOString() };

  if (process.env.AIRFARE_MCP_URL) {
    try {
      const payload = await callMcpTool({
        url: process.env.AIRFARE_MCP_URL,
        headers: process.env.AIRFARE_MCP_HEADERS,
        tool: process.env.AIRFARE_MCP_TOOL || 'search_flights',
        args: { query },
      });
      if (!geminiConfigured()) {
        const prices = [...payload.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter(Boolean);
        if (!prices.length) throw new Error('Could not parse a price from the MCP payload (set GEMINI_API_KEY for smart parsing)');
        return { ...base, source: 'mcp', lowestPrice: Math.min(...prices), summary: `Lowest fare found: $${Math.min(...prices)}` };
      }
      const est = await generateJson(
        `Tool query: ${query}\n\nTool payload from search_flights:\n${payload.slice(0, 60000)}\n\nExtract the estimate.`,
        FLIGHT_SCHEMA,
        { system: AIRFARE_PROMPT },
      );
      return { ...base, source: 'mcp', ...est };
    } catch (e) {
      return { ...base, ...placeholderFlight(input), error: e.message };
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
      const payload = await callMcpTool({
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
      return { ...base, ...placeholderCar(input, days), error: e.message };
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
