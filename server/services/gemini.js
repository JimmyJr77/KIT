import { GoogleGenAI } from '@google/genai';

let client;
export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;
export const geminiModel = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function ai() {
  if (!geminiConfigured()) throw new Error('GEMINI_API_KEY is not set');
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

/** Free-form text generation. */
export async function generate(prompt, { system } = {}) {
  const res = await ai().models.generateContent({
    model: geminiModel(),
    contents: prompt,
    config: system ? { systemInstruction: system } : undefined,
  });
  return res.text;
}

/**
 * Generation grounded in live Google Search results. Gemini can't combine search with a response schema, so the
 * prompt asks for JSON and this pulls the first JSON object out of the reply. Returns { data, sources: [{ title, uri }] }.
 */
export async function generateGroundedJson(prompt, { system } = {}) {
  const res = await ai().models.generateContent({
    model: geminiModel(),
    contents: prompt,
    config: { systemInstruction: system, tools: [{ googleSearch: {} }] },
  });
  const text = res.text || '';
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('Gemini did not return readable results. Try again.'); }
  const sources = (res.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web).filter((w) => w?.uri).map((w) => ({ title: w.title || w.uri, uri: w.uri }));
  return { data, sources };
}

/** Structured generation: returns parsed JSON matching `schema` (OpenAPI-style). */
export async function generateJson(prompt, schema, { system } = {}) {
  const res = await ai().models.generateContent({
    model: geminiModel(),
    contents: prompt,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });
  return JSON.parse(res.text);
}
