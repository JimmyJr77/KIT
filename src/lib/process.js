// Process flow on a pipeline ticket: its milestones (the formal steps of a pursuit), shared by the server and the app.
// The phases, roles and gate decisions follow the Knexus Streamlined Response Workflow.

/** The phases of a pursuit, left to right, as in the Streamlined Response Workflow. */
export const PHASES = ['Qualify & Gate', 'Plan Response', 'Develop', 'Review & Approve', 'Submit & Close'];

/**
 * The kinds of milestone, in the order they usually happen, each in its phase. `gate` marks the reviews where a
 * decision is taken (proceed, no-bid, revise) and the price is considered.
 */
export const MILESTONES = [
  { type: 'RFI', phase: 'Qualify & Gate', about: 'A request for information arrived' },
  { type: 'RFI Response', phase: 'Qualify & Gate', about: 'Our response to the RFI or sources sought' },
  { type: 'White Paper', phase: 'Qualify & Gate', about: 'A white paper shaping the requirement' },
  { type: 'Initial Gate Review', phase: 'Qualify & Gate', gate: true, about: 'Gate checklist presented; the SVP of Growth decides whether to pursue (S-1.3, S-1.4)' },
  { type: 'RFP', phase: 'Plan Response', about: 'The solicitation arrived: workspace, schedule and assignments set up (S-1.5, S-1.6)' },
  { type: 'SOW', phase: 'Plan Response', about: 'Statement of work: response strategy and assignments confirmed (S-1.7)' },
  { type: 'ROM', phase: 'Develop', gate: true, about: 'Rough order of magnitude, pricing and Green Team (S-1.9)' },
  { type: 'Color Team Review', phase: 'Review & Approve', gate: true, about: 'Red Team review and feedback incorporated (S-1.10, S-1.11)' },
  { type: 'Final Gate Review', phase: 'Review & Approve', gate: true, about: 'Gold Team approval and final compliance check (S-1.12, S-1.13)' },
  { type: 'Proposal', phase: 'Submit & Close', about: 'Response submitted and archived (S-1.14)' },
];
export const PROCESS_TYPES = MILESTONES.map((m) => m.type);
export const milestoneOf = (type) => MILESTONES.find((m) => m.type === type) || { type, phase: PHASES[0] };

/** What a gate review decided. */
export const DECISIONS = ['Proceed', 'Revise', 'No-Bid'];

/**
 * The roles at each milestone, as in the workflow. Each records who was there, who approved, and any notes.
 * `at` lists the milestones the workflow expects that role at.
 */
export const REVIEW_AREAS = [
  { key: 'strategy', label: 'SVP of Growth & Leadership', short: 'Leadership', about: 'Gate decisions and final approval', at: ['Initial Gate Review', 'Final Gate Review'] },
  { key: 'technical', label: 'Solution Architect & Technical', short: 'Technical', about: 'Feasibility, capabilities and gaps; technical input and validation', at: ['Initial Gate Review', 'RFP', 'Proposal', 'Color Team Review'] },
  { key: 'pricing', label: 'Pricing / Finance', short: 'Pricing', about: 'ROM, pricing and Green Team', at: ['Initial Gate Review', 'ROM', 'Final Gate Review'] },
  { key: 'support', label: 'Proposal Manager, Coordinator & Contributors', short: 'Proposal team', about: 'Workspace, outline, drafting and reviews', at: ['RFP', 'SOW', 'Color Team Review', 'Final Gate Review', 'Proposal'] },
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
