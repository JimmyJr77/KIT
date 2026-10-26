import { Router } from 'express';
import { generate, geminiConfigured, geminiModel } from '../services/gemini.js';
import { mcpStatus } from '../services/estimators.js';

const r = Router();

r.get('/status', (req, res) => {
  res.json({
    gemini: geminiConfigured(),
    model: geminiConfigured() ? geminiModel() : null,
    ...mcpStatus(),
    googleWorkspace: !!process.env.GOOGLE_CLIENT_ID,
    gsaApi: !!process.env.GSA_API_KEY,
  });
});

// General-purpose Gemini endpoint, the hook for future Workspace-grounded features.
r.post('/ask', async (req, res) => {
  if (!geminiConfigured()) return res.status(503).json({ error: 'Gemini is not configured (set GEMINI_API_KEY)' });
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  try {
    res.json({ text: await generate(prompt, { system: 'You are KIT, the Knexus Intelligence Toolkit assistant for a business development team. Be concise.' }) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default r;
