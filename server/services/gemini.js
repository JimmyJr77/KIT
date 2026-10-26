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
