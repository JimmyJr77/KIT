// Playbooks: a team's expectations and guidance. Everyone reads any team's; admins and that team's leads write it.
import { Router } from 'express';
import { db, canEditPlaybook } from '../db.js';
import { geminiConfigured } from '../services/gemini.js';
import { askAboutPlaybook, getPlaybook, getSection, renumber } from '../services/playbook.js';

const r = Router();

const text = (v, max) => String(v ?? '').trim().slice(0, max);
const NOT_ALLOWED = 'Only admins and this team’s leads can change its playbook';

/** The team must exist and the person must be allowed to write its playbook. */
function editable(req, res, teamId) {
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return null; }
  if (!canEditPlaybook(req.user, team.id)) { res.status(403).json({ error: NOT_ALLOWED }); return null; }
  return team;
}

r.get('/:teamId', (req, res) => {
  const pb = getPlaybook(req.params.teamId, req.user);
  if (!pb) return res.status(404).json({ error: 'Team not found' });
  res.json({ ...pb, gemini: geminiConfigured() });
});

/** Body: { tagline, version }. The playbook's details under its title. */
r.put('/:teamId', (req, res) => {
  const team = editable(req, res, req.params.teamId);
  if (!team) return;
  const b = req.body || {};
  db.prepare(`INSERT INTO playbooks (team_id, tagline, version, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(team_id) DO UPDATE SET tagline = excluded.tagline, version = excluded.version, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(team.id, text(b.tagline, 200) || null, text(b.version, 80) || null, req.user.id);
  res.json(getPlaybook(team.id, req.user));
});

/** Body: { title, body, after_id }. A new section, at the end or right after `after_id`. */
r.post('/:teamId/sections', (req, res) => {
  const team = editable(req, res, req.params.teamId);
  if (!team) return;
  const b = req.body || {};
  const title = text(b.title, 160);
  if (!title) return res.status(400).json({ error: 'Give the section a title' });
  const id = db.transaction(() => {
    renumber(team.id);
    const after = b.after_id ? db.prepare("SELECT position FROM playbook_sections WHERE id = ? AND team_id = ? AND kind = 'section'").get(b.after_id, team.id) : null;
    const position = after ? after.position + 1 : (db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM playbook_sections WHERE team_id = ?').get(team.id).p);
    if (after) db.prepare('UPDATE playbook_sections SET position = position + 1 WHERE team_id = ? AND position >= ?').run(team.id, position);
    return db.prepare(`INSERT INTO playbook_sections (team_id, kind, position, title, body, created_by) VALUES (?, 'section', ?, ?, ?, ?)`)
      .run(team.id, position, title, text(b.body, 60000), req.user.id).lastInsertRowid;
  })();
  res.status(201).json({ section: getSection(id) });
});

/** Body: { title, body }. */
r.put('/sections/:id', (req, res) => {
  const s = getSection(req.params.id);
  if (!s) return res.status(404).json({ error: 'Section not found' });
  if (!canEditPlaybook(req.user, s.team_id)) return res.status(403).json({ error: NOT_ALLOWED });
  const b = req.body || {};
  const title = text(b.title, 160);
  if (!title) return res.status(400).json({ error: 'Give the section a title' });
  db.prepare("UPDATE playbook_sections SET title = ?, body = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title, text(b.body, 60000), req.user.id, s.id);
  res.json({ section: getSection(s.id) });
});

r.delete('/sections/:id', (req, res) => {
  const s = getSection(req.params.id);
  if (!s) return res.status(404).json({ error: 'Section not found' });
  if (!canEditPlaybook(req.user, s.team_id)) return res.status(403).json({ error: NOT_ALLOWED });
  if (s.kind === 'rhythm') return res.status(400).json({ error: 'The battle rhythm stays; clear its text instead' });
  db.transaction(() => {
    db.prepare('DELETE FROM playbook_sections WHERE id = ?').run(s.id);
    renumber(s.team_id);
  })();
  res.json({ ok: true });
});

/** Body: { ids }: the team's sections (not the rhythm) in their new order. Ids left out keep their relative order after them. */
r.put('/:teamId/order', (req, res) => {
  const team = editable(req, res, req.params.teamId);
  if (!team) return;
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number);
  db.transaction(() => {
    const set = db.prepare("UPDATE playbook_sections SET position = ? WHERE id = ? AND team_id = ? AND kind = 'section'");
    ids.forEach((id, i) => set.run(i + 1, id, team.id));
    db.prepare(`UPDATE playbook_sections SET position = position + ? WHERE team_id = ? AND kind = 'section' AND id NOT IN (SELECT value FROM json_each(?))`)
      .run(ids.length + 1, team.id, JSON.stringify(ids));
    renumber(team.id);
  })();
  res.json(getPlaybook(team.id, req.user));
});

// ---- Ask KIT about the playbook: answered from its sections, never from memory.
const NO_GEMINI = 'KIT’s assistant isn’t set up on this server: Gemini needs a GEMINI_API_KEY.';

/** Body: { question, history: [{ role: 'user' | 'kit', text }] }. */
r.post('/:teamId/ask', async (req, res) => {
  if (!geminiConfigured()) return res.status(503).json({ error: NO_GEMINI });
  const pb = getPlaybook(req.params.teamId, req.user);
  if (!pb) return res.status(404).json({ error: 'Team not found' });
  const b = req.body || {};
  const question = text(b.question, 2000);
  if (!question) return res.status(400).json({ error: 'Ask something about the playbook' });
  const history = (Array.isArray(b.history) ? b.history : []).slice(-8)
    .map((h) => ({ role: h?.role === 'kit' ? 'kit' : 'user', text: text(h?.text, 6000) })).filter((h) => h.text);
  try {
    const answer = await askAboutPlaybook({ pb, question, history });
    res.json({ text: answer, scope: { team: pb.team.name, sections: pb.sections.length } });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

export default r;
