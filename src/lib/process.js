// Process flow on a pipeline ticket: its staffing events (the formal steps of a pursuit, once called milestones), shared by
// the server and the app.
// The phases, roles and gate decisions follow the Knexus Streamlined Response Workflow.

/** The phases of a pursuit, left to right, as in the Streamlined Response Workflow. */
export const PHASES = ['Qualify & Gate', 'Plan Response', 'Develop', 'Review & Approve', 'Submit & Close'];

/**
 * Staffing events: what a pipeline ticket is run through on its way to a bid (the BD process steps a solution architect is
 * staffed to), in the order they usually happen, each in its phase. `tag` is the process tag that goes with it; `gate` marks
 * the reviews where a decision is taken (proceed, no-bid, revise), and `pricing` adds the price considerations block.
 * `fields` are the sections the deliverable or review is made of, as [key, label, hint], each written as text or answered with
 * a document. They follow the Knexus playbook (the Streamlined Response Workflow's S-1 steps, the Gate Checklist, the CTO
 * technical and CEO pricing approvals required before anything binding goes out) and the standard federal formats.
 */
export const STAFFING_EVENTS = [
  { type: 'RFI Response', tag: 'RFI', phase: 'Qualify & Gate', about: 'Our response to an RFI or Sources Sought notice, run on the Streamlined Response Workflow',
    fields: [
      ['instructions', 'Instructions & compliance', 'From the notice (S-1.6): due date and time, submission method, page limit, format, and every item the government asked for'],
      ['company', 'Company information', 'UEI, CAGE code, NAICS codes, business size and socioeconomic status, contract vehicles (GSA MAS, BPAs, GWACs), point of contact'],
      ['responses', 'Answers to the government’s questions', 'Each question as the RFI numbers it, answered in its order, inside the page limit'],
      ['capability', 'Technical capability & approach', 'How Knexus meets the requirement: architecture, tools, how it runs in the customer’s IT environment (Solution Architect, S-1.2 and S-1.8)'],
      ['past_performance', 'Relevant past performance', 'Contract, customer, value, period of performance and why it’s relevant to this requirement'],
      ['shaping', 'Requirement shaping & acquisition recommendations', 'What we recommend to shape the RFP our way: set-aside, vehicle, NAICS, scope, evaluation approach'],
    ] },
  { type: 'White Paper', tag: 'Paper', phase: 'Qualify & Gate', about: 'A white paper shaping the requirement, solicited (BAA, CSO) or unsolicited',
    fields: [
      ['instructions', 'Call & evaluation criteria', 'The BAA, CSO or area of interest it answers, page limit, due date, and how it will be evaluated'],
      ['need', 'Mission need & problem', 'What government leaders want and what end users actually need: the pain points found in discovery'],
      ['approach', 'Proposed solution & technical approach', 'The solution and its architecture, and why it’s technically viable in the customer’s environment'],
      ['innovation', 'Innovation & differentiators', 'What’s new, and why Knexus and not someone else'],
      ['outcomes', 'Expected outcomes & measures of success', 'The mission results it delivers and how they’ll be measured'],
      ['schedule_cost', 'Schedule, milestones & ROM cost', 'Phases, milestones and a rough order of magnitude cost'],
      ['team', 'Team & qualifications', 'Key people, partners and the past performance that proves we can do it'],
    ] },
  { type: 'Initial Gate Review', tag: 'Initial Gate', phase: 'Qualify & Gate', gate: true, pricing: true,
    about: 'Gate Checklist presented; the SVP of Growth decides whether to pursue (S-1.3, S-1.4)',
    fields: [
      ['opportunity', 'Opportunity summary', 'Customer, requirement, estimated value, vehicle, set-aside, key dates, and where it came from'],
      ['customer', 'Customer access & intelligence', 'Who we know and how well; what leaders want and users need; what we’ve learned in capture'],
      ['alignment', 'Capability alignment & feasibility', 'The Solution Architect’s read (S-1.2): what we can deliver, what’s proven, and the gaps'],
      ['competition', 'Competition & win strategy', 'Incumbent, likely competitors, our discriminators and win themes, and why the PWIN is what it is'],
      ['teaming', 'Teaming & gap resolution', 'Partners needed and how each gap closes; NDAs and teaming agreements to put in place'],
      ['resources', 'Resources & B&P', 'Who has to work on it, the bid and proposal cost, and whether the schedule is achievable'],
      ['recommendation', 'Recommendation', 'Proceed, No-Bid, or revise and resolve gaps (S-1.4), with the reasons'],
    ] },
  { type: 'Final Gate Review', tag: 'Final Gate', phase: 'Review & Approve', gate: true,
    about: 'Gold Team approval and final compliance check before submission (S-1.12, S-1.13)',
    fields: [
      ['compliance', 'Compliance check', 'Compliance matrix complete: every instruction and evaluation factor addressed, format and page limits met (S-1.13)'],
      ['red_team', 'Red Team findings & resolution', 'What the Red Team raised and how each finding was resolved (S-1.10, S-1.11)'],
      ['technical_approval', 'CTO technical approval', 'Feasibility, architecture alignment, resource availability, WBS and delivery commitments, approved by the CTO'],
      ['pricing_approval', 'CEO pricing approval', 'Labor rates, margins, business and contract terms and the overall risk posture, approved by the CEO'],
      ['risks', 'Open risks & exceptions', 'Risks still open, assumptions and any exceptions taken to the terms'],
    ] },
  { type: 'Statement of Objectives', tag: 'SOO', phase: 'Plan Response', about: 'The outcomes the government wants, for offerors to build a SOW or PWS from',
    fields: [
      ['purpose', 'Purpose', 'Why the effort exists, in a sentence or two'],
      ['background', 'Background & current environment', 'The mission, today’s systems and processes, and what’s driving the change'],
      ['scope', 'Scope', 'What the effort covers, and what it doesn’t'],
      ['objectives', 'Performance objectives', 'The outcomes wanted, stated as results rather than methods, each measurable'],
      ['constraints', 'Operating constraints', 'Security, ATO and impact levels, data rights, the IT environment and policies the solution has to fit'],
      ['period', 'Period & place of performance', 'How long, where, and any phases or option periods'],
    ] },
  { type: 'Statement of Work', tag: 'SOW', phase: 'Plan Response', about: 'Statement of work: the tasks, deliverables and terms the work is performed under (S-1.7)',
    fields: [
      ['background', 'Background', 'The customer, the mission and why the work is needed'],
      ['scope', 'Scope', 'What’s in, what’s out'],
      ['tasks', 'Tasks & requirements', 'Each task numbered, as the WBS breaks it down, with what has to be done'],
      ['deliverables', 'Deliverables & schedule', 'Each deliverable, its format, and when it’s due'],
      ['period', 'Period & place of performance', 'Base and option periods, and where the work happens (on site, remote)'],
      ['gfi', 'Government-furnished information & equipment', 'Access, data, systems and equipment the government provides'],
      ['security', 'Security & compliance requirements', 'Clearances, ATO and impact level, FedRAMP, data handling'],
      ['acceptance', 'Acceptance criteria', 'How each deliverable is reviewed and accepted, and performance standards'],
    ] },
  { type: 'Rough Order of Magnitude', tag: 'ROM', phase: 'Develop', gate: true, about: 'Rough order of magnitude estimate, pricing and Green Team (S-1.9)',
    fields: [
      ['basis', 'Scope & basis of estimate', 'What’s being estimated, the source documents, and the method (analogy, parametric, bottom-up)'],
      ['wbs', 'Work breakdown structure', 'The work broken into tasks, with the technical team’s estimate for each'],
      ['labor', 'Labor categories & hours', 'Labor categories, hours by period, and the rates or rate source used'],
      ['odcs', 'Licenses, cloud & other direct costs', 'Software licenses, Google Cloud consumption, hardware, travel and other direct costs'],
      ['estimate', 'Estimate & range', 'The total by period and year, with a low–high range and how confident we are'],
      ['assumptions', 'Assumptions & exclusions', 'What the estimate assumes and what it leaves out'],
    ] },
  { type: 'Proposal', tag: 'Proposal', phase: 'Submit & Close', about: 'The proposal, run on the full Proposal Management Workflow: written, reviewed, submitted and archived (S-1.14)',
    fields: [
      ['compliance', 'Compliance matrix', 'Every Section L instruction and Section M evaluation factor mapped to where the proposal answers it (Proposal Manager)'],
      ['executive', 'Executive summary & win themes', 'The customer’s need, our solution and why we win, in the evaluator’s words; written last'],
      ['technical', 'Technical volume', 'Understanding of the requirement, technical approach and architecture, innovation and risk mitigation'],
      ['management', 'Management volume', 'Program management, organization, staffing plan, transition, quality control and schedule'],
      ['key_personnel', 'Key personnel & resumes', 'Who fills each key role, and resumes matched to the SOW requirements'],
      ['past_performance', 'Past performance volume', 'Relevant contracts as the RFP asks for them: scope, size, recency, customer references'],
      ['price', 'Price / cost volume', 'Pricing by CLIN and period, the basis of estimate and pricing narrative, with CEO pricing approval'],
    ] },
];
// Milestones recorded before staffing events replaced them. They keep their type; new ones can't be made.
const EARLIER = [
  { type: 'RFI', phase: 'Qualify & Gate', about: 'A request for information arrived' },
  { type: 'RFP', phase: 'Plan Response', about: 'The solicitation arrived: workspace, schedule and assignments set up (S-1.5, S-1.6)' },
  { type: 'Color Team Review', phase: 'Review & Approve', gate: true, about: 'Red Team review and feedback incorporated (S-1.10, S-1.11)' },
].map((m) => ({ ...m, earlier: true, fields: [] }));
export const MILESTONES = [...STAFFING_EVENTS, ...EARLIER];

/**
 * Sections staffing events had before they were replaced with the real ones (2026-11), and where their text goes now. A key
 * mapped to null had no match: its text moves into the event's Request, under the old section's name.
 */
export const EARLIER_FIELDS = {
  'RFI Response': { ask: ['responses'], approach: ['capability'], past_performance: ['past_performance'], questions: [null, 'Gaps & questions back to the customer'] },
  'White Paper': { problem: ['need'], solution: ['approach'], differentiators: ['innovation'], draft: [null, 'Draft'] },
  'Initial Gate Review': { fit: ['opportunity'], feasibility: ['alignment'], resources: ['resources'], recommendation: ['recommendation'] },
  'Final Gate Review': { compliance: ['compliance'], solution: [null, 'Solution summary'], risks: ['risks'], recommendation: [null, 'Recommendation'] },
  'Statement of Objectives': { objectives: ['objectives'], approach: [null, 'Approach'], assumptions: ['constraints'] },
  'Statement of Work': { scope: ['scope'], deliverables: ['deliverables'], staffing: ['tasks'], assumptions: [null, 'Assumptions'] },
  'Rough Order of Magnitude': { basis: ['basis'], labor: ['labor'], estimate: ['estimate'], assumptions: ['assumptions'] },
  'Proposal': { technical: ['technical'], management: ['management'], staffing: ['key_personnel'], compliance: ['compliance'] },
};
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
/** How critical a new staffing event starts out, by the ticket's stage: As Available from Prospecting, else Queued. */
export const defaultCriticality = (stage) => (stage === 'Prospecting' ? 'available' : DEFAULT_CRITICALITY);
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
