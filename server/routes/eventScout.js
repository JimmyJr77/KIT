// The event scout: Gemini, grounded in Google Search, finds upcoming events worth attending. Refreshing appends what
// it finds to a running list of potential events; a search answers someone's own request, pointing at events already
// on either list and suggesting new ones. Potential events become real ones from the Events page (see routes/events.js).
import fs from 'node:fs';
import { Router } from 'express';
import { db, json } from '../db.js';
import { generateGroundedJson, geminiConfigured } from '../services/gemini.js';
import { ACCOUNT_TYPES } from './priorities.js';

const r = Router();
const SYSTEM = fs.readFileSync(new URL('../prompts/eventScout.md', import.meta.url), 'utf8');
const today = () => new Date().toLocaleDateString('en-CA');

const out = (c) => ({ ...c, location: json.parse(c.location, {}) });
const openList = () => db.prepare(`SELECT * FROM event_candidates WHERE status = 'open'
  ORDER BY date_from IS NULL, date_from, name`).all().map(out);

// Names compared loosely, so "AUSA Annual Meeting 2027" and "AUSA Annual Meeting" are the same event.
const key = (name) => String(name || '').toLowerCase().replace(/\b(19|20)\d{2}\b/g, '').replace(/[^a-z0-9]+/g, '');

/** What the scout already knows about, with refs (E = event list, P = potential list) a search can point at. */
function known() {
  const events = db.prepare('SELECT id, name, date_from, date_to FROM events WHERE date_to >= ? ORDER BY date_from').all(today());
  const candidates = db.prepare("SELECT id, name, date_from, date_to, status FROM event_candidates WHERE status != 'added'").all();
  return { events, candidates };
}

/** The team's customers and pursuits, so the scout looks where Knexus does business. */
function context() {
  const territories = db.prepare('SELECT name FROM territories ORDER BY position, name').all().map((t) => t.name);
  const orgs = db.prepare(`SELECT organization, COUNT(*) AS n FROM tickets WHERE ticket_type = 'bid' AND archived_at IS NULL
      AND COALESCE(pipeline_status, '') NOT IN ('Awarded', 'Lost') AND COALESCE(organization, '') != ''
    GROUP BY organization ORDER BY n DESC LIMIT 25`).all().map((o) => o.organization);
  return [
    `Account types: ${ACCOUNT_TYPES.join(', ')}`,
    territories.length && `Territories: ${territories.join(', ')}`,
    orgs.length && `Customers in the open pipeline: ${orgs.join('; ')}`,
  ].filter(Boolean).join('\n');
}

function promptFor({ events, candidates }, extra = '') {
  const line = (ref, e) => `${ref} ${e.name}${e.date_from ? ` (${e.date_from}${e.date_to && e.date_to !== e.date_from ? ` to ${e.date_to}` : ''})` : ''}`;
  return [
    `TODAY: ${today()}`,
    `CONTEXT:\n${context()}`,
    `KNOWN EVENTS:\n${[...events.map((e) => line(`E${e.id}`, e)), ...candidates.map((c) => line(`P${c.id}`, c))].join('\n') || '(none)'}`,
    extra,
  ].filter(Boolean).join('\n\n');
}

/** An event from Gemini, cleaned up into the shape the lists use. */
function clean(e = {}) {
  const s = (v) => (v == null ? '' : String(v).trim());
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(s(v)) ? s(v) : null);
  const fee = e.fee === '' || e.fee == null ? null : Number(e.fee);
  const intl = !!e.intl || (!!s(e.country) && !/^(us|usa|united states)/i.test(s(e.country)));
  const from = date(e.date_from);
  let website = s(e.website) || null;
  if (website && !/^https?:\/\//i.test(website)) website = `https://${website}`;
  return {
    name: s(e.name),
    date_from: from,
    date_to: date(e.date_to) || from,
    description: s(e.description) || null,
    goal: s(e.goal) || null,
    notes: s(e.notes) || null,
    fee: Number.isFinite(fee) && fee >= 0 ? fee : null,
    website,
    poc_name: s(e.poc_name) || null,
    poc_phone: s(e.poc_phone) || null,
    address: s(e.address) || null,
    location: { intl, city: s(e.city), state: intl ? s(e.state) : s(e.state).toUpperCase().slice(0, 2), country: intl ? s(e.country) : 'United States' },
    relevance: Math.min(5, Math.max(1, Math.round(Number(e.relevance) || 3))),
  };
}

/** Saves potential events, skipping any the lists already have. Returns how many were new. */
function append(list, { source, prompt, userId }) {
  const { events, candidates } = known();
  const seen = new Set([...events, ...candidates, ...db.prepare("SELECT name FROM event_candidates WHERE status = 'added'").all()].map((e) => key(e.name)));
  const insert = db.prepare(`INSERT INTO event_candidates (name, date_from, date_to, description, goal, notes, fee, website, poc_name, poc_phone,
      address, location, relevance, source, prompt, created_by)
    VALUES (@name, @date_from, @date_to, @description, @goal, @notes, @fee, @website, @poc_name, @poc_phone, @address, @location, @relevance,
      @source, @prompt, @created_by)`);
  const ids = [];
  for (const e of list.map(clean)) {
    if (!e.name || seen.has(key(e.name)) || (e.date_to && e.date_to < today())) continue;
    seen.add(key(e.name));
    ids.push(insert.run({ ...e, location: json.str(e.location), source, prompt: prompt || null, created_by: userId }).lastInsertRowid);
  }
  return ids;
}

// Gemini's errors arrive as JSON text; show people the sentence inside.
function failure(e) {
  if (/API_KEY_INVALID|API key not valid/i.test(e.message)) return 'Gemini rejected the API key. Ask an admin to update GEMINI_API_KEY on the server.';
  try { return JSON.parse(e.message).error?.message || e.message; } catch { return e.message; }
}
const needGemini = (res) => (geminiConfigured() ? false : res.status(503).json({ error: 'The event scout needs Gemini (set GEMINI_API_KEY).' }));

r.get('/', (req, res) => res.json({ candidates: openList(), configured: geminiConfigured() }));

/** Run the scout and append what it finds. Nothing already on the list is removed. */
r.post('/refresh', async (req, res) => {
  if (needGemini(res)) return;
  try {
    const { data, sources } = await generateGroundedJson(
      promptFor(known(), 'Find up to 12 events not in KNOWN EVENTS, most relevant first.'), { system: SYSTEM });
    const ids = append(Array.isArray(data?.events) ? data.events : [], { source: 'refresh', userId: req.user.id });
    res.json({ candidates: openList(), added: ids, sources });
  } catch (e) {
    res.status(502).json({ error: failure(e) });
  }
});

/**
 * Search on someone's own request. Body: { prompt }. Returns matches (events and potential events already listed that
 * support it, with why) and new suggestions, which aren't saved until someone adds them to a list.
 */
r.post('/search', async (req, res) => {
  if (needGemini(res)) return;
  const ask = String(req.body?.prompt || '').trim();
  if (!ask) return res.status(400).json({ error: 'Describe what you’re looking for' });
  const k = known();
  try {
    const { data, sources } = await generateGroundedJson(promptFor(k, [
      `USER REQUEST: ${ask.slice(0, 2000)}`,
      'Answer the request. First, list KNOWN EVENTS (E = event list, P = potential list) that support it in "matches", with a one-sentence reason each. Then find up to 8 new events that fit the request, following RULES.',
      'OUTPUT adds "matches" next to "events": {"matches":[{"ref":"E12","reason":""}],"events":[...]}',
    ].join('\n')), { system: SYSTEM });
    const events = db.prepare('SELECT id, name, date_from, date_to FROM events WHERE id = ?');
    const cand = db.prepare("SELECT * FROM event_candidates WHERE id = ? AND status = 'open'");
    const matches = (Array.isArray(data?.matches) ? data.matches : []).map((m) => {
      const [, kind, id] = String(m.ref || '').match(/^([EP])(\d+)$/i) || [];
      const item = kind?.toUpperCase() === 'E' ? events.get(id) : kind ? cand.get(id) : null;
      return item && { kind: kind.toUpperCase() === 'E' ? 'event' : 'potential', id: item.id, name: item.name, date_from: item.date_from, date_to: item.date_to, reason: String(m.reason || '') };
    }).filter(Boolean);
    const seen = new Set([...k.events, ...k.candidates].map((e) => key(e.name)));
    const suggestions = (Array.isArray(data?.events) ? data.events : []).map(clean)
      .filter((e) => e.name && !seen.has(key(e.name)) && !(e.date_to && e.date_to < today()));
    res.json({ matches, suggestions, sources });
  } catch (e) {
    res.status(502).json({ error: failure(e) });
  }
});

/** Add a search suggestion to the potential list. Body: the suggestion, plus the prompt that found it. */
r.post('/', (req, res) => {
  const ids = append([req.body || {}], { source: 'search', prompt: String(req.body?.prompt || '').trim(), userId: req.user.id });
  if (!ids.length) return res.status(409).json({ error: 'That event is already on a list' });
  res.json({ candidate: out(db.prepare('SELECT * FROM event_candidates WHERE id = ?').get(ids[0])) });
});

/** It's on the Events list now. Body: { event_id }. */
r.put('/:id/added', (req, res) => {
  db.prepare("UPDATE event_candidates SET status = 'added', event_id = ? WHERE id = ?").run(Number(req.body?.event_id) || null, req.params.id);
  res.json({ ok: true });
});

/** Take it off the potential list. It's kept as dismissed so the scout doesn't suggest it again. */
r.delete('/:id', (req, res) => {
  db.prepare("UPDATE event_candidates SET status = 'dismissed' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default r;
