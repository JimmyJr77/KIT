// Pipelines and their stages. KIT's own pipeline (pipeline_id null) and the others, made to match Pipedrive's pipelines,
// each have their own stages (pipeline_stages). Every pipeline can also close a pipeline ticket as Awarded or Lost.
import { db, getSetting } from './db.js';

export const KIT_STAGES = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation', 'Awarded', 'Lost'];
export const KIT_PIPELINE_NAME = 'KIT pipeline';
const CLOSING = ['Awarded', 'Lost'];

/** A pipeline's statuses, in order: its stages, then Awarded (unless it's a stage already) and Lost. */
const withClosing = (stages) => [...stages.filter((s) => s !== 'Lost'), ...CLOSING.filter((c) => !stages.includes(c) || c === 'Lost')];

/** Whether an admin lets tickets go on KIT's own pipeline. Off (the default), only Pipedrive's pipelines take tickets. */
export const kitPipelineAllowed = () => getSetting('kit_pipeline_allowed') === '1';
export const KIT_PIPELINE_CLOSED = 'An admin has turned off the KIT pipeline: pipeline tickets go on Pipedrive’s pipelines.';

/**
 * Every pipeline: KIT's own first ({ id: null }), then the others in order. KIT's own is `closed` (nothing new goes on
 * it; tickets already there keep their stages) when an admin has turned it off and there's a Pipedrive pipeline to use.
 */
export function listPipelines() {
  const stages = db.prepare('SELECT pipeline_id, name FROM pipeline_stages ORDER BY position, id').all();
  const others = db.prepare('SELECT id, name, pipedrive_id FROM pipelines ORDER BY position, id').all()
    .map((p) => ({ ...p, statuses: withClosing(stages.filter((s) => s.pipeline_id === p.id).map((s) => s.name)) }));
  const own = stages.filter((s) => s.pipeline_id == null).map((s) => s.name);
  return [{ id: null, name: KIT_PIPELINE_NAME, statuses: own.length ? withClosing(own) : KIT_STAGES, ...(others.length && !kitPipelineAllowed() ? { closed: true } : {}) }, ...others];
}

// ---- Stages in reports
//
// Reports count the standard stages. A stage of another name is left out unless it says how it counts (reports_as):
// blended into a standard stage (its tickets count as being in that stage), or as a step of its own ('own'), which
// joins the lists below right after the standard stage it follows in its pipeline: open, and qualified too when that
// stage is Qualified or later.
export const STANDARD_STAGES = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation', 'Awarded'];
/** What a stage can blend into (Awarded isn't offered: it's how a pipeline closes). */
export const BLEND_STAGES = STANDARD_STAGES.filter((s) => s !== 'Awarded');
export const OWN_STEP = 'own';
// These three are kept current in place by refreshReportStages(), so every report reads today's lists.
/** Stages whose open tickets are the pipeline, in order. */
export const OPEN_STAGES = [...STANDARD_STAGES];
/** Open stages from Qualified on: the qualified pipeline. */
export const QUALIFIED_STAGES = STANDARD_STAGES.slice(1);
/** Qualified stages where a pursuit can stall (Awarded is only waiting to be marked won). */
export const STALL_STAGES = STANDARD_STAGES.slice(1, -1);

/** Rebuild the report stage lists from the stages as they are now. Called at startup and whenever stages change. */
export function refreshReportStages() {
  const open = [...STANDARD_STAGES];
  const early = new Set(); // own steps that come before Qualified
  const rows = db.prepare('SELECT pipeline_id, name, reports_as FROM pipeline_stages ORDER BY pipeline_id, position, id').all();
  let pipeline = null;
  let anchor = null; // the last stage before this one, in its pipeline, that the reports already have
  rows.forEach((s) => {
    if (s.pipeline_id !== pipeline) { pipeline = s.pipeline_id; anchor = null; }
    if (s.reports_as === OWN_STEP && !open.includes(s.name)) {
      const at = anchor == null ? 0 : open.indexOf(anchor) + 1;
      open.splice(at, 0, s.name);
      if (anchor == null || anchor === 'Prospecting' || early.has(anchor)) early.add(s.name);
    }
    if (open.includes(s.name)) anchor = s.name;
  });
  const qualified = open.filter((s) => s !== 'Prospecting' && !early.has(s));
  OPEN_STAGES.splice(0, OPEN_STAGES.length, ...open);
  QUALIFIED_STAGES.splice(0, QUALIFIED_STAGES.length, ...qualified);
  STALL_STAGES.splice(0, STALL_STAGES.length, ...qualified.filter((s) => s !== 'Awarded'));
}
refreshReportStages();

/**
 * The stage reports count a ticket under: of(pipelineId, stage) and ofTicket(ticketId, stage) give the standard stage a
 * blended stage counts as, and any other stage as it is.
 */
export function reportStager() {
  const blend = new Map(db.prepare(`SELECT pipeline_id, name, reports_as FROM pipeline_stages WHERE reports_as IS NOT NULL AND reports_as != '${OWN_STEP}'`).all()
    .filter((s) => BLEND_STAGES.includes(s.reports_as)).map((s) => [`${s.pipeline_id}|${s.name}`, s.reports_as]));
  const of = (pipelineId, stage) => blend.get(`${pipelineId}|${stage}`) ?? stage;
  if (!blend.size) return { of, ofTicket: (id, stage) => stage };
  const pipelineOf = new Map(db.prepare("SELECT id, pipeline_id FROM tickets WHERE ticket_type = 'bid'").all().map((t) => [t.id, t.pipeline_id]));
  return { of, ofTicket: (id, stage) => of(pipelineOf.get(id), stage) };
}

/** Where a new pipeline ticket goes when none is chosen: KIT's own while it's allowed, else Pipedrive's first pipeline. */
export const defaultPipeline = () => listPipelines().find((p) => !p.closed);

/** The pipeline a new ticket asking for `pipelineId` goes on: that one, or the default when it's unknown or closed. */
export function pipelineForNew(pipelineId) {
  const p = listPipelines().find((x) => x.id === (Number(pipelineId) || null));
  return p && !p.closed ? p : defaultPipeline();
}

/** The statuses a ticket on `pipelineId` can have. */
export function statusesFor(pipelineId) {
  return (listPipelines().find((p) => p.id === (pipelineId ?? null)) || listPipelines()[0]).statuses;
}

/** Every status any pipeline uses. */
export const allStatuses = () => [...new Set(listPipelines().flatMap((p) => p.statuses))];
