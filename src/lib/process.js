// Process flow on a pipeline ticket: its staffing events (the formal steps of a pursuit, once called milestones), shared by
// the server and the app.
// The phases, roles and gate decisions follow the Knexus Streamlined Response Workflow.

/** The phases of a pursuit, left to right, as in the Streamlined Response Workflow. */
export const PHASES = ['Qualify & Gate', 'Plan Response', 'Develop', 'Review & Approve', 'Submit & Close'];

/**
 * Staffing events: what a pipeline ticket is run through on its way to a bid (the BD process steps a solution architect is
 * staffed to), in the order they usually happen, each in its phase. `tag` is the process tag that goes with it; `gate` marks
 * the reviews where a decision is taken (proceed, no-bid, revise) and the price is considered. `fields` are the blocks of work
 * the event asks for, each written as text or answered with a document.
 */
export const STAFFING_EVENTS = [
  { type: 'RFI Response', tag: 'RFI', phase: 'Qualify & Gate', about: 'Our response to an RFI or sources sought',
    fields: [['ask', 'What the customer is asking'], ['approach', 'Technical approach & capabilities'], ['past_performance', 'Relevant past performance'], ['questions', 'Gaps & questions back to the customer']] },
  { type: 'White Paper', tag: 'Paper', phase: 'Qualify & Gate', about: 'A white paper shaping the requirement',
    fields: [['problem', 'The customer’s problem'], ['solution', 'Proposed solution'], ['differentiators', 'Differentiators'], ['draft', 'Draft']] },
  { type: 'Initial Gate Review', tag: 'Initial Gate', phase: 'Qualify & Gate', gate: true, about: 'Gate checklist presented; the SVP of Growth decides whether to pursue (S-1.3, S-1.4)',
    fields: [['fit', 'Opportunity fit'], ['feasibility', 'Technical feasibility & gaps'], ['resources', 'Resources needed to pursue'], ['recommendation', 'Recommendation']] },
  { type: 'Final Gate Review', tag: 'Final Gate', phase: 'Review & Approve', gate: true, about: 'Gold Team approval and final compliance check (S-1.12, S-1.13)',
    fields: [['compliance', 'Compliance check'], ['solution', 'Solution summary'], ['risks', 'Risks & mitigations'], ['recommendation', 'Recommendation']] },
  { type: 'Statement of Objectives', tag: 'SOO', phase: 'Plan Response', about: 'The outcomes the customer wants, for them to build a SOW or PWS from',
    fields: [['objectives', 'Objectives'], ['approach', 'Approach'], ['assumptions', 'Assumptions & constraints']] },
  { type: 'Statement of Work', tag: 'SOW', phase: 'Plan Response', about: 'Statement of work: scope, tasks and deliverables (S-1.7)',
    fields: [['scope', 'Scope & tasks'], ['deliverables', 'Deliverables'], ['staffing', 'Staffing & labor categories'], ['assumptions', 'Assumptions']] },
  { type: 'Rough Order of Magnitude', tag: 'ROM', phase: 'Develop', gate: true, about: 'Rough order of magnitude, pricing and Green Team (S-1.9)',
    fields: [['basis', 'Scope basis'], ['labor', 'Labor mix & hours'], ['estimate', 'Cost estimate'], ['assumptions', 'Assumptions']] },
  { type: 'Proposal', tag: 'Proposal', phase: 'Submit & Close', about: 'Response written, reviewed, submitted and archived (S-1.14)',
    fields: [['technical', 'Technical volume'], ['management', 'Management volume'], ['staffing', 'Staffing plan'], ['compliance', 'Compliance matrix']] },
];
// Milestones recorded before staffing events replaced them. They keep their type; new ones can't be made.
const EARLIER = [
  { type: 'RFI', phase: 'Qualify & Gate', about: 'A request for information arrived' },
  { type: 'RFP', phase: 'Plan Response', about: 'The solicitation arrived: workspace, schedule and assignments set up (S-1.5, S-1.6)' },
  { type: 'Color Team Review', phase: 'Review & Approve', gate: true, about: 'Red Team review and feedback incorporated (S-1.10, S-1.11)' },
].map((m) => ({ ...m, earlier: true, fields: [] }));
export const MILESTONES = [...STAFFING_EVENTS, ...EARLIER];
/** The staffing events that can be added. */
export const PROCESS_TYPES = STAFFING_EVENTS.map((m) => m.type);
/** Every type a staffing event can have, the earlier milestones' included. */
export const KNOWN_TYPES = MILESTONES.map((m) => m.type);
export const milestoneOf = (type) => MILESTONES.find((m) => m.type === type) || { type, phase: PHASES[0], fields: [] };
/** The staffing event a process tag stands for, or undefined. */
export const eventForTag = (tag) => STAFFING_EVENTS.find((m) => m.tag.toLowerCase() === String(tag || '').toLowerCase());
/** The process tags, one per staffing event, in order. */
export const PROCESS_TAG_NAMES = STAFFING_EVENTS.map((m) => m.tag);

/** How urgent a staffing event is, as its owner sees it. Queued unless they say otherwise. */
export const CRITICALITY = [
  { key: 'critical', label: 'Critical', tone: 'bg-red-50 text-red-700 ring-red-200' },
  { key: 'moderate', label: 'Moderately Critical', tone: 'bg-amber-50 text-amber-800 ring-amber-200' },
  { key: 'queued', label: 'Queued', tone: 'bg-sky-50 text-sky-800 ring-sky-200' },
  { key: 'available', label: 'As Available', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
];
export const DEFAULT_CRITICALITY = 'queued';
export const criticalityOf = (key) => CRITICALITY.find((c) => c.key === key) || CRITICALITY.find((c) => c.key === DEFAULT_CRITICALITY);

/**
 * The staffing events a ticket can be dropped into when dragged out of its stage on the board, by the stage its reports
 * count it as. Stages not named here offer every one.
 */
export const BUCKETS_BY_STAGE = {
  Prospecting: ['RFI Response', 'White Paper', 'Initial Gate Review'],
  Qualified: ['RFI Response', 'White Paper'],
  Capture: ['RFI Response', 'White Paper', 'Final Gate Review', 'Statement of Objectives', 'Statement of Work', 'Rough Order of Magnitude', 'Proposal'],
};
export const bucketsFor = (stage) => (BUCKETS_BY_STAGE[stage] || PROCESS_TYPES).map(milestoneOf);

/** Field text keyed by the event's field keys, trimmed; unknown keys are dropped. */
export function cleanFields(type, input) {
  const out = {};
  milestoneOf(type).fields.forEach(([key]) => {
    const v = input?.[key];
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 20000);
  });
  return out;
}

/** What a gate review decided. */
export const DECISIONS = ['Proceed', 'Revise', 'No-Bid'];

/**
 * The roles at each staffing event, as in the workflow. Each records who was there, who approved, and any notes.
 * `at` lists the milestones the workflow expects that role at.
 */
export const REVIEW_AREAS = [
  { key: 'strategy', label: 'SVP of Growth & Leadership', short: 'Leadership', about: 'Gate decisions and final approval', at: ['Initial Gate Review', 'Final Gate Review'] },
  { key: 'technical', label: 'Solution Architect & Technical', short: 'Technical', about: 'Feasibility, capabilities and gaps; technical input and validation', at: ['RFI Response', 'White Paper', 'Initial Gate Review', 'Statement of Objectives', 'Statement of Work', 'Proposal', 'RFP', 'Color Team Review'] },
  { key: 'pricing', label: 'Pricing / Finance', short: 'Pricing', about: 'ROM, pricing and Green Team', at: ['Initial Gate Review', 'Rough Order of Magnitude', 'Final Gate Review'] },
  { key: 'support', label: 'Proposal Manager, Coordinator & Contributors', short: 'Proposal team', about: 'Workspace, outline, drafting and reviews', at: ['RFP', 'Statement of Work', 'Color Team Review', 'Final Gate Review', 'Proposal'] },
];

const ids = (xs) => [...new Set((Array.isArray(xs) ? xs : []).map(Number).filter(Boolean))];

/** Keep only known review areas, with people and approvers as user ids and notes as text. */
export function cleanReviews(input) {
  const out = {};
  REVIEW_AREAS.forEach(({ key }) => {
    const r = input?.[key] || {};
    out[key] = {
      people: ids(r.people),
      approved: ids(r.approved),
      notes: typeof r.notes === 'string' ? r.notes.trim() : '',
    };
  });
  return out;
}

/** Where a contract's documents go, in the order the work usually happens. Anything else is an Additional document. */
export const CONTRACT_DOC_TYPES = ['RFI', 'RFI Response', 'White Paper', 'RFP', 'Proposal', 'SOW', 'ROM', 'PO', 'Contract / Award', 'Modifications',
  'Teaming Agreement', 'NDA', 'DD 254', 'Deliverables'];
export const ADDITIONAL_DOCS = 'Additional';
