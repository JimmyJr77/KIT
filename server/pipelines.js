// Pipelines and their stages. KIT's own pipeline (pipeline_id null) uses PIPELINE_STATUSES; others, made to match
// Pipedrive's pipelines, have their own stages. Every pipeline can also close a pipeline ticket as Awarded or Lost.
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
  return [{ id: null, name: KIT_PIPELINE_NAME, statuses: KIT_STAGES, ...(others.length && !kitPipelineAllowed() ? { closed: true } : {}) }, ...others];
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
