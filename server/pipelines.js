// Pipelines and their stages. KIT's own pipeline (pipeline_id null) uses PIPELINE_STATUSES; others, made to match
// Pipedrive's pipelines, have their own stages. Every pipeline can also close a pipeline ticket as Awarded or Lost.
import { db } from './db.js';

export const KIT_STAGES = ['Prospecting', 'Qualified', 'Capture', 'Proposal', 'Under Evaluation', 'Awarded', 'Lost'];
export const KIT_PIPELINE_NAME = 'KIT pipeline';
const CLOSING = ['Awarded', 'Lost'];

/** A pipeline's statuses, in order: its stages, then Awarded (unless it's a stage already) and Lost. */
const withClosing = (stages) => [...stages.filter((s) => s !== 'Lost'), ...CLOSING.filter((c) => !stages.includes(c) || c === 'Lost')];

/** Every pipeline: KIT's own first ({ id: null }), then the others in order. */
export function listPipelines() {
  const stages = db.prepare('SELECT pipeline_id, name FROM pipeline_stages ORDER BY position, id').all();
  return [
    { id: null, name: KIT_PIPELINE_NAME, statuses: KIT_STAGES },
    ...db.prepare('SELECT id, name, pipedrive_id FROM pipelines ORDER BY position, id').all()
      .map((p) => ({ ...p, statuses: withClosing(stages.filter((s) => s.pipeline_id === p.id).map((s) => s.name)) })),
  ];
}

/** The statuses a ticket on `pipelineId` can have. */
export function statusesFor(pipelineId) {
  return (listPipelines().find((p) => p.id === (pipelineId ?? null)) || listPipelines()[0]).statuses;
}

/** Every status any pipeline uses. */
export const allStatuses = () => [...new Set(listPipelines().flatMap((p) => p.statuses))];
