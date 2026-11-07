// Playbooks: each team's expectations and guidance, read by everyone and written by admins and the team's leads.
// A playbook is a row in `playbooks` (tagline, version, the workflow diagram) and its sections of markdown, the
// battle rhythm first. The BD team's is loaded once from server/playbook/bdPlaybook.js; every other team starts with
// an empty battle rhythm. KIT answers questions about a playbook from its sections alone (askAboutPlaybook).
import { db, canEditPlaybook } from '../db.js';
import { generate } from './gemini.js';
import { BD_META, BD_RHYTHM, BD_SECTIONS } from '../playbook/bdPlaybook.js';

export const RHYTHM_TITLE = 'Team battle rhythm';

/** Gemini's errors arrive as JSON in the message; this gives the sentence, and tries twice more when the model is busy. */
const geminiMessage = (e) => { try { return JSON.parse(e.message).error?.message || e.message; } catch { return e.message; } };
const busy = (e) => /UNAVAILABLE|RESOURCE_EXHAUSTED|"code":(503|429)|high demand|overloaded/i.test(e.message || '');
async function withRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (e) {
      if (attempt < 2 && busy(e)) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw new Error(busy(e) ? `KIT’s model is busy right now (${geminiMessage(e)}). Try again in a moment.` : geminiMessage(e));
    }
  }
}

/** The team's playbook row and its battle rhythm section exist after this; nothing else is touched. */
export function ensurePlaybook(teamId) {
  db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO playbooks (team_id) VALUES (?)').run(teamId);
    db.prepare(`INSERT INTO playbook_sections (team_id, kind, position, title, body) SELECT ?, 'rhythm', 0, ?, ''
      WHERE NOT EXISTS (SELECT 1 FROM playbook_sections WHERE team_id = ? AND kind = 'rhythm')`).run(teamId, RHYTHM_TITLE, teamId);
  })();
}

/** Loads the BD playbook the first time the BD team has no sections at all. Returns true when it loaded. */
export function seedBdPlaybook() {
  const bd = db.prepare("SELECT id FROM teams WHERE name = 'BD'").get();
  if (!bd) return false;
  if (db.prepare('SELECT 1 FROM playbook_sections WHERE team_id = ?').get(bd.id)) return false;
  db.transaction(() => {
    db.prepare(`INSERT INTO playbooks (team_id, tagline, version, workflow_image) VALUES (?, ?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET tagline = excluded.tagline, version = excluded.version, workflow_image = excluded.workflow_image`)
      .run(bd.id, BD_META.tagline, BD_META.version, BD_META.workflow_image);
    const add = db.prepare('INSERT INTO playbook_sections (team_id, kind, position, title, body) VALUES (?, ?, ?, ?, ?)');
    add.run(bd.id, 'rhythm', 0, BD_RHYTHM.title, BD_RHYTHM.body);
    BD_SECTIONS.forEach((s, i) => add.run(bd.id, 'section', i + 1, s.title, s.body));
  })();
  return true;
}

const SECTION_SQL = `SELECT s.*, u.first_name AS updated_first_name, u.last_name AS updated_last_name FROM playbook_sections s
  LEFT JOIN users u ON u.id = COALESCE(s.updated_by, s.created_by)`;

/** A team's playbook as the page shows it: its details, sections in order (rhythm first), and whether `user` may edit it. */
export function getPlaybook(teamId, user) {
  const team = db.prepare('SELECT id, name FROM teams WHERE id = ?').get(teamId);
  if (!team) return null;
  ensurePlaybook(team.id);
  const meta = db.prepare('SELECT tagline, version, workflow_image, updated_at FROM playbooks WHERE team_id = ?').get(team.id);
  const sections = db.prepare(`${SECTION_SQL} WHERE s.team_id = ? ORDER BY s.kind = 'rhythm' DESC, s.position, s.id`).all(team.id);
  return { team, ...meta, sections, can_edit: canEditPlaybook(user, team.id) };
}

export const getSection = (id) => db.prepare(`${SECTION_SQL} WHERE s.id = ?`).get(id);

/** Sections' positions as 0..n after the rhythm, in their current order. */
export function renumber(teamId) {
  const ids = db.prepare("SELECT id FROM playbook_sections WHERE team_id = ? AND kind = 'section' ORDER BY position, id").all(teamId);
  const set = db.prepare('UPDATE playbook_sections SET position = ? WHERE id = ?');
  ids.forEach((r, i) => set.run(i + 1, r.id));
}

// ---- Ask KIT about the playbook

const ASSISTANT_SYSTEM = `You are KIT, the Knexus Intelligence Toolkit assistant. You are answering questions about one team's
Playbook: the team's written expectations, guidance, processes, roles, tools, metrics and meeting cadence (its "battle
rhythm"), kept as titled sections of markdown. The whole playbook is given in the conversation.

Rules:
- Answer from the playbook. Never invent people, numbers, dates, rules or steps that aren't in it. If the playbook doesn't
  cover the question, say so plainly, and name the closest thing it does say.
- Name the section(s) you draw on (by title), and quote or closely paraphrase the text. Keep figures and names exact.
- Where the playbook marks something as TBD, draft, or for discussion, say so rather than treating it as settled.
- You may explain a general term (an acronym, a contract type) from general knowledge, but keep that apart from what the
  playbook says, and keep it short.
- Write in plain words, with short headings and bullet points where they help. No preamble.`;

/** The playbook as KIT reads it: every section's title and markdown. */
export function playbookContext(pb) {
  const head = [`# ${pb.team.name} Playbook${pb.tagline ? `: ${pb.tagline}` : ''}`, pb.version ? `Version ${pb.version}` : '']
    .filter(Boolean).join('\n');
  return [head, ...pb.sections.map((s) => `## ${s.title}${s.kind === 'rhythm' ? ' (the team battle rhythm)' : ''}\n\n${s.body.trim() || '(not written yet)'}`)].join('\n\n');
}

/**
 * Answer `question` from the playbook `pb`, with the earlier turns (`history`: [{ role: 'user' | 'kit', text }]) for
 * follow-ups. Returns the answer text.
 */
export async function askAboutPlaybook({ pb, question, history = [] }) {
  const turns = history.slice(-8).map((h) => `${h.role === 'kit' ? 'KIT' : 'User'}: ${h.text}`).join('\n\n');
  const prompt = [
    `The ${pb.team.name} team's playbook, ${pb.sections.length} section${pb.sections.length === 1 ? '' : 's'}:`,
    playbookContext(pb),
    turns ? `Conversation so far:\n\n${turns}` : '',
    `User: ${question}`,
    'KIT:',
  ].filter(Boolean).join('\n\n---\n\n');
  return withRetry(() => generate(prompt, { system: ASSISTANT_SYSTEM }));
}
