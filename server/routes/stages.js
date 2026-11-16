// A pipeline's stages: the columns of the BD Pipeline board. Everyone reads them; admins and BD team leads add one
// anywhere in the order, rename, move and delete them. These are Pipedrive's own stages: a stage added, renamed or
// deleted here is added, renamed or deleted there (pipedriveSend.js), and the other way round (pipedrive.js). Pipedrive
// doesn't let its API say where a stage goes, so the order set here is KIT's until someone reorders the stages in Pipedrive.
// KIT's own pipeline (no id, asked for as "kit") works the same way, except that nothing on it ever goes to Pipedrive.
//
// Whoever adds a stage makes two choices for it. Sync with Pipedrive: off (the default), the stage is KIT's own and nothing
// about it is sent; on, it's made in Pipedrive with the next send. And how reports count it: blended into a standard
// stage, as a step of its own, or not at all (see pipelines.js). A stage Pipedrive has always syncs.
import { Router } from 'express';
import { db, canManageBd } from '../db.js';
import { STANDARD_STAGES, BLEND_STAGES, OWN_STEP, KIT_PIPELINE_NAME, refreshReportStages } from '../pipelines.js';

const r = Router();
// Awarded and Lost are how every pipeline closes a ticket, so no stage can take, lose or drop those names.
const RESERVED = ['awarded', 'lost'];
const isReserved = (name) => RESERVED.includes(String(name).toLowerCase());

const KIT = 'kit';
const pipelineOf = (id) => (id === KIT ? { id: null, name: KIT_PIPELINE_NAME } : db.prepare('SELECT * FROM pipelines WHERE id = ?').get(Number(id) || 0));
const rows = (pipelineId) => db.prepare('SELECT * FROM pipeline_stages WHERE pipeline_id IS ? ORDER BY position, id').all(pipelineId);
const list = (pipelineId) => rows(pipelineId).map((s) => ({
  id: s.id, name: s.name, pipedrive_id: s.pipedrive_id, fixed: isReserved(s.name), sync: !!s.sync || !!s.pipedrive_id,
  standard: STANDARD_STAGES.includes(s.name), reports_as: STANDARD_STAGES.includes(s.name) ? null : s.reports_as,
  tickets: db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE pipeline_id IS ? AND pipeline_status = ? AND ticket_type = 'bid' AND archive_set_id IS NULL").get(pipelineId, s.name).n,
}));
/** Number a pipeline's stages 0, 1, 2… in the order given (stage ids). */
const reorder = (ids) => ids.forEach((id, i) => db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?').run(i, id));

r.get('/', (req, res) => {
  const p = pipelineOf(req.query.pipeline_id);
  if (!p) return res.status(404).json({ error: 'Pipeline not found' });
  res.json({ stages: list(p.id), canManage: canManageBd(req.user), reportChoices: BLEND_STAGES, ownStep: OWN_STEP, kit: p.id == null });
});

function manager(req, res, next) {
  if (!canManageBd(req.user)) return res.status(403).json({ error: 'Only admins and BD team leads can change a pipeline’s stages' });
  next();
}

/** reports_as from a request: a standard stage to blend into, 'own', or null (left out). undefined when it isn't one of those. */
const reportChoice = (v) => (v == null || v === '' ? null : v === OWN_STEP || BLEND_STAGES.includes(v) ? v : undefined);
const cleanName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
const taken = (pipelineId, name, id = 0) => !!db.prepare('SELECT 1 FROM pipeline_stages WHERE pipeline_id IS ? AND name = ? COLLATE NOCASE AND id != ?').get(pipelineId, name, id);
const nameError = (pipelineId, name, id) => (!name ? 'Name the stage'
  : isReserved(name) ? `${name} is how a pipeline closes a ticket; pick another name`
    : taken(pipelineId, name, id) ? `This pipeline already has a ${name} stage` : null);

/**
 * Body: { pipeline_id, name, after_id?, sync?, reports_as? }. The new stage goes right after `after_id`, or first when it's
 * null. It doesn't sync with Pipedrive unless `sync` says so, and reports leave it out unless `reports_as` says how it counts.
 */
r.post('/', manager, (req, res) => {
  const p = pipelineOf(req.body?.pipeline_id);
  if (!p) return res.status(404).json({ error: 'Pipeline not found' });
  const name = cleanName(req.body?.name);
  const error = nameError(p.id, name);
  if (error) return res.status(error.startsWith('This pipeline') ? 409 : 400).json({ error });
  const order = rows(p.id).map((s) => s.id);
  const after = req.body?.after_id == null ? -1 : order.indexOf(Number(req.body.after_id));
  if (req.body?.after_id != null && after < 0) return res.status(400).json({ error: 'Unknown stage to put it after' });
  const reportsAs = reportChoice(req.body?.reports_as);
  if (reportsAs === undefined) return res.status(400).json({ error: 'Unknown choice for how reports count this stage' });
  db.transaction(() => {
    const id = db.prepare('INSERT INTO pipeline_stages (pipeline_id, name, position, sync, reports_as) VALUES (?, ?, 0, ?, ?)').run(p.id, name, req.body?.sync && p.id != null ? 1 : 0, STANDARD_STAGES.includes(name) ? null : reportsAs).lastInsertRowid;
    order.splice(after + 1, 0, id);
    reorder(order);
  })();
  refreshReportStages();
  res.json({ stages: list(p.id) });
});

/**
 * Body: { name?, sync?, reports_as? }. Tickets in the stage, and their stage history, follow a new name. Sync can be
 * turned on, and off again until Pipedrive has the stage.
 */
r.put('/:id', manager, (req, res) => {
  const s = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Stage not found' });
  const b = req.body || {};
  if (b.sync !== undefined) {
    if (b.sync && s.pipeline_id == null) return res.status(400).json({ error: 'Stages of KIT’s own pipeline don’t go to Pipedrive' });
    if (!b.sync && s.pipedrive_id) return res.status(400).json({ error: `Pipedrive already has ${s.name}, so it stays in sync` });
    db.prepare('UPDATE pipeline_stages SET sync = ? WHERE id = ?').run(b.sync ? 1 : 0, s.id);
  }
  if (b.reports_as !== undefined) {
    const reportsAs = reportChoice(b.reports_as);
    if (reportsAs === undefined) return res.status(400).json({ error: 'Unknown choice for how reports count this stage' });
    if (STANDARD_STAGES.includes(s.name)) return res.status(400).json({ error: `${s.name} is a standard stage: reports always count it as itself` });
    db.prepare('UPDATE pipeline_stages SET reports_as = ? WHERE id = ?').run(reportsAs, s.id);
  }
  if (b.name === undefined) { refreshReportStages(); return res.json({ stages: list(s.pipeline_id) }); }
  if (isReserved(s.name)) return res.status(400).json({ error: `${s.name} can’t be renamed: it’s how the pipeline closes a ticket` });
  const name = cleanName(b.name);
  const error = nameError(s.pipeline_id, name, s.id);
  if (error) return res.status(error.startsWith('This pipeline') ? 409 : 400).json({ error });
  if (name !== s.name) {
    db.transaction(() => {
      db.prepare('UPDATE pipeline_stages SET name = ? WHERE id = ?').run(name, s.id);
      // The same stage under a new name: no ticket moved, so nothing new goes in their history and nothing is left to send for them.
      const before = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM ticket_history').get().id;
      const at = { p: s.pipeline_id, old: s.name, name };
      db.prepare(`UPDATE tickets SET pipeline_status = @name,
          pipedrive_snapshot = CASE WHEN json_valid(pipedrive_snapshot) AND json_extract(pipedrive_snapshot, '$.pipeline_status') = @old
            THEN json_set(pipedrive_snapshot, '$.pipeline_status', @name) ELSE pipedrive_snapshot END
        WHERE pipeline_id IS @p AND pipeline_status = @old`).run(at);
      db.prepare('DELETE FROM ticket_history WHERE id > ? AND ticket_id IN (SELECT id FROM tickets WHERE pipeline_id IS ?)').run(before, s.pipeline_id);
      db.prepare('UPDATE ticket_history SET pipeline_status = @name WHERE pipeline_status = @old AND ticket_id IN (SELECT id FROM tickets WHERE pipeline_id IS @p)').run(at);
      // A standard name counts as itself.
      if (STANDARD_STAGES.includes(name)) db.prepare('UPDATE pipeline_stages SET reports_as = NULL WHERE id = ?').run(s.id);
    })();
  }
  refreshReportStages();
  res.json({ stages: list(s.pipeline_id) });
});

/** Body: { direction: -1 | 1 }. Moves the stage one place earlier or later. */
r.put('/:id/move', manager, (req, res) => {
  const s = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Stage not found' });
  const order = rows(s.pipeline_id).map((x) => x.id);
  const from = order.indexOf(s.id);
  const to = from + (Number(req.body?.direction) < 0 ? -1 : 1);
  if (to >= 0 && to < order.length) {
    order.splice(to, 0, order.splice(from, 1)[0]);
    db.transaction(() => reorder(order))();
    refreshReportStages(); // a step of its own sits in the reports where it sits here
  }
  res.json({ stages: list(s.pipeline_id) });
});

/** An empty stage only: move its tickets first. If Pipedrive has it, it's deleted there with the next send. */
r.delete('/:id', manager, (req, res) => {
  const s = db.prepare('SELECT * FROM pipeline_stages WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Stage not found' });
  if (isReserved(s.name)) return res.status(400).json({ error: `${s.name} can’t be deleted: it’s how the pipeline closes a ticket` });
  const inIt = list(s.pipeline_id).find((x) => x.id === s.id).tickets;
  if (inIt) return res.status(400).json({ error: `${s.name} still has ${inIt} ticket${inIt === 1 ? '' : 's'} (won, lost and archived ones count). Move them to another stage first.` });
  if (rows(s.pipeline_id).length <= 1) return res.status(400).json({ error: 'A pipeline needs at least one stage' });
  db.transaction(() => {
    if (s.pipedrive_id) db.prepare('INSERT OR REPLACE INTO stage_deletes (pipedrive_id, name) VALUES (?, ?)').run(s.pipedrive_id, s.pipedrive_name || s.name);
    db.prepare('DELETE FROM pipeline_stages WHERE id = ?').run(s.id);
    reorder(rows(s.pipeline_id).map((x) => x.id));
  })();
  refreshReportStages();
  res.json({ stages: list(s.pipeline_id) });
});

export default r;
