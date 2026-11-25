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
  // The Initial Gate Review is where a lead is qualified (`qualifies`): BD Notes and the architect's technical fit on top, the
  // qualification checklist under them, and the write-up folded away as Pursuit Notes, with price considerations ahead of
  // the recommendation. `staff` names who's picked at the top of its form, in place of who was there and who approved.
  { type: 'Initial Gate Review', tag: 'Initial Gate', phase: 'Qualify & Gate', gate: true, pricing: true, qualifies: true,
    requestLabel: 'BD Notes', saLabel: 'Technical Fit - Solution Architect Response', notesTitle: 'Pursuit Notes', pricingBefore: 'recommendation',
    staff: ['technical', 'strategy', 'pricing'],
    about: 'Gate Checklist presented; the SVP of Growth decides whether to pursue (S-1.3, S-1.4)',
    fields: [
      ['opportunity', 'Opportunity summary', 'Customer, requirement, estimated value, vehicle, set-aside, key dates, and where it came from'],
      ['customer', 'Customer access & intelligence', 'Who we know and how well; what leaders want and users need; what we’ve learned in capture'],
      ['alignment', 'Capability alignment & feasibility', 'The Solution Architect’s read (S-1.2): what we can deliver, what’s proven, and the gaps'],
      ['competition', 'Competition & win strategy', 'Incumbent, likely competitors, our discriminators and win themes, and why the PWIN is what it is'],
      ['teaming', 'Teaming & gap resolution', 'Partners needed and how each gap closes; NDAs and teaming agreements to put in place'],
      ['recommendation', 'Recommendations & Notes', 'Proceed, No-Bid, or revise and resolve gaps (S-1.4), with the reasons, and anything else worth keeping'],
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
  // Anything a solution architect is staffed to that isn't one of the above: the Request says what it is. It can come at
  // any stage, has no blocks of its own, and needs no approval.
  { type: 'Other', tag: 'Other', phase: 'Qualify & Gate', about: 'Any other work a solution architect is staffed to; the request says what’s needed', fields: [] },
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
  'Initial Gate Review': { fit: ['opportunity'], feasibility: ['alignment'], resources: [null, 'Resources & B&P'], recommendation: ['recommendation'] },
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
 * count it as. Stages not named here offer every one. Other is offered in every stage.
 */
export const BUCKETS_BY_STAGE = {
  Prospecting: ['RFI Response', 'White Paper', 'Initial Gate Review', 'Other'],
  Qualified: ['RFI Response', 'White Paper', 'Other'],
  Capture: ['RFI Response', 'White Paper', 'Final Gate Review', 'Statement of Objectives', 'Statement of Work', 'Rough Order of Magnitude', 'Proposal', 'Other'],
};
/**
 * The review gate a ticket is headed for next, by the stage its reports count it as: the Initial Gate Review out of
 * Prospecting, the Final Gate Review from Qualified or Capture. Other stages have none.
 */
export const NEXT_GATE = { Prospecting: 'Initial Gate Review', Qualified: 'Final Gate Review', Capture: 'Final Gate Review' };
export const nextGate = (stage) => (NEXT_GATE[stage] ? milestoneOf(NEXT_GATE[stage]) : null);
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

/** The Solution Architect Response on a staffing event: where the architect landed on the request. */
export const SA_RESPONSES = [
  { key: 'approve', label: 'Approve', tone: 'text-emerald-700' },
  { key: 'deny', label: 'Deny', tone: 'text-red-700' },
  { key: 'more_info', label: 'Need more info', tone: 'text-amber-700' },
];
/**
 * Whether a staffing event's Solution Architect Response ends in approve / deny / need more info: only the reviews where a
 * decision is taken (`gate`). An RFI response, a white paper, an SOO, an SOW or a proposal is written and answered, not approved.
 */
export const needsApproval = (type) => !!milestoneOf(type).gate;
/** The process_field of a link or document attached to the Solution Architect Response. */
export const SA_FIELD = 'sa_response';
/** The process_field of a link or document attached to the Request (BD Notes on an Initial Gate Review). */
export const REQUEST_FIELD = 'request';
/** The process_field of a link or document attached to the qualification checklist. */
export const QUAL_FIELD = 'qualification';
/** The process_fields that aren't one of an event's own blocks of work. */
export const SHARED_FIELDS = [SA_FIELD, REQUEST_FIELD, QUAL_FIELD];

/**
 * What makes a lead qualified, answered on the Initial Gate Review: three yes / no gates, then three scored 1 to 5.
 * [key, label, what it asks], numbered in this order.
 */
export const QUALIFICATION = [
  { key: 'requirement', kind: 'gate', label: 'Real requirement', hint: 'An identifiable need with a named customer office: a forecast entry, a sources sought notice or RFI, an expiring incumbent contract, or a direct conversation with the program office' },
  { key: 'funding', kind: 'gate', label: 'Funding', hint: 'The money is appropriated, budgeted, or credibly planned' },
  { key: 'eligibility', kind: 'gate', label: 'Eligibility and access', hint: 'We can actually bid: we hold, or can team onto, the contract vehicle, meet the set-aside status and NAICS size standard, and have any required clearances or certifications' },
  { key: 'fit', kind: 'score', label: 'Competitive Fit', hint: 'Relevant past performance, and we can staff and deliver the work at a competitive price; if a partner fills a gap, we know who it is',
    scale: {
      1: "Zero fit: no relevant past performance, no staff to deliver the work, and no partner identified to fill the gaps.",
      2: "Weak fit: only loosely related past performance, we cannot staff or price the work competitively today, and no partner is identified for the gaps.",
      3: "Partial fit: relevant past performance and we can staff and deliver the work, but our price is unproven or one gap remains with no partner named.",
      4: "Strong fit: directly relevant past performance, we can staff and deliver at a competitive price, and a named partner covers any remaining gap.",
      5: "Perfect fit: we have done this exact work for this kind of customer, the staff is on hand, our price is known to be competitive, and there are no gaps.",
    },
  },
  { key: 'timing', kind: 'score', label: 'Timing', hint: 'There is an expected solicitation or award date, far enough out to shape the deal',
    scale: {
      1: "Zero timing: no solicitation date and no award date is known or expected.",
      2: "A rough window only (a fiscal year or a rumor), or a date so close that there is no time left to shape the deal.",
      3: "An expected quarter for the solicitation or the award, with time to position ourselves but not to influence the requirement.",
      4: "An expected date stated by the customer or in a published forecast, and enough time to shape the requirement and build the team.",
      5: "Certain timing: the customer has confirmed the date in writing, and there is ample time to shape every part of the deal.",
    },
  },
  { key: 'position', kind: 'score', label: 'Customer access and competitive position', hint: 'We know the decision makers and have or can get a meeting; we know the incumbent and whether they are vulnerable',
    scale: {
      1: "Zero access: we do not know the decision makers, we have had no contact with the customer, and we do not know who the incumbent is.",
      2: "We know who the decision makers are or who the incumbent is, but we have had no contact and have no meeting in sight.",
      3: "We know the decision makers and can get a meeting, and we know who the incumbent is, but not whether they are vulnerable.",
      4: "We have met the decision makers, and we know the incumbent and where they are vulnerable.",
      5: "Full access: the decision makers know us and take our meetings, and the incumbent is confirmed vulnerable or there is no incumbent.",
    },
  },
].map((q, i) => ({ ...q, n: i + 1 }));
/** The scores a scored test can take. Each scored test's `scale` says exactly what each one means: 1 is zero, 5 is certainty. */
export const QUAL_SCORES = [1, 2, 3, 4, 5];
/**
 * What makes a qualified lead, as admins and BD leads set it in the pipeline's settings: `yes`, the yes/no tests that must
 * be a Yes; `min`, the least each scored test must score (0: the test isn't counted); and `sa`, whether the solution
 * architect has to approve the Technical Fit. This is the rule KIT starts with.
 */
export const DEFAULT_GATE_RULE = { yes: ['requirement', 'eligibility'], min: { fit: 2, timing: 2, position: 2 }, sa: true };
/** A rule as sent or saved, made whole: unknown tests dropped, scores held to 0-5, anything missing as the default has it. */
export function cleanGateRule(input) {
  const gates = QUALIFICATION.filter((q) => q.kind === 'gate').map((q) => q.key);
  const min = {};
  QUALIFICATION.filter((q) => q.kind === 'score').forEach((q) => {
    const v = Number(input?.min?.[q.key]);
    min[q.key] = Number.isInteger(v) && v >= 0 && v <= 5 ? v : DEFAULT_GATE_RULE.min[q.key];
  });
  return { yes: Array.isArray(input?.yes) ? gates.filter((k) => input.yes.includes(k)) : [...DEFAULT_GATE_RULE.yes], min, sa: input?.sa === undefined ? DEFAULT_GATE_RULE.sa : !!input.sa };
}
/** The rule in a sentence, for the checklist's heading. */
export function gateRuleText(rule = DEFAULT_GATE_RULE) {
  const n = (k) => QUALIFICATION.find((q) => q.key === k).n;
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const yes = QUALIFICATION.filter((q) => rule.yes.includes(q.key)).map((q) => q.n);
  const scored = QUALIFICATION.filter((q) => q.kind === 'score' && rule.min[q.key] > 0);
  const same = scored.every((q) => rule.min[q.key] === rule.min[scored[0].key]);
  const parts = [
    yes.length && `${list(yes)} a Yes`,
    scored.length && (same ? `${list(scored.map((q) => q.n))} ${scored.length > 1 ? 'each ' : ''}at ${rule.min[scored[0].key]} or higher` : scored.map((q) => `${n(q.key)} at ${rule.min[q.key]} or higher`).join(', ')),
    rule.sa && 'the Technical Fit approved',
  ].filter(Boolean);
  if (!parts.length) return 'Passes as soon as it is submitted: nothing is required.';
  return `Passes with ${parts.length > 2 ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}` : parts.join(' and ')}.`;
}
/** The checklist's answers, keyed as in QUALIFICATION: 'yes' or 'no' for a gate, 1 to 5 for a score; anything else is dropped. */
export function cleanQualification(input) {
  const out = {};
  QUALIFICATION.forEach(({ key, kind }) => {
    const v = input?.[key];
    if (kind === 'gate' && (v === 'yes' || v === 'no')) out[key] = v;
    if (kind === 'score' && QUAL_SCORES.includes(Number(v))) out[key] = Number(v);
  });
  return out;
}

/** Whether the checklist's own criteria are met under `rule`: its required gates a Yes and every counted test at its minimum or higher. */
export function criteriaMet(qualification, rule = DEFAULT_GATE_RULE) {
  const q = cleanQualification(qualification);
  return rule.yes.every((k) => q[k] === 'yes') && QUALIFICATION.filter((x) => x.kind === 'score' && rule.min[x.key] > 0).every((x) => q[x.key] >= rule.min[x.key]);
}
/** What a BD lead or an Exec Ldr can set an Initial Gate Review's decision to by hand, over what the answers come to. */
export const GATE_OVERRIDES = ['approved', 'denied'];
/**
 * Where an Initial Gate Review stands, by status: draft (being filled in, not yet submitted to the SAC), failure (submitted
 * with a criterion not met), review (submitted, criteria met, waiting on the solution architect), denied (the architect
 * denied the Technical Fit) or approved (criteria met and the architect approved).
 */
export const GATE_STATUS = {
  draft: 'Not submitted', failure: 'Gate Failure', review: 'With SA', denied: 'Denied', approved: 'Approved',
};
/**
 * An Initial Gate Review's decision, made for it each time it's saved: { status (a GATE_STATUS key), label, result
 * ('approved' | 'denied'), auto (the status the answers come to), overridden }. A hand-set gate_override wins. Null for
 * other events. `draft` is a review not yet submitted. `rule` is what makes a qualified lead (the saved setting).
 */
export function gateDecision(p = {}, rule = DEFAULT_GATE_RULE) {
  if (!milestoneOf(p.step_type).qualifies) return null;
  const overridden = GATE_OVERRIDES.includes(p.gate_override);
  const auto = p.draft ? 'draft' : !criteriaMet(p.qualification, rule) ? 'failure' : !rule.sa || p.sa_response === 'approve' ? 'approved' : p.sa_response === 'deny' ? 'denied' : 'review';
  const status = overridden ? p.gate_override : auto;
  return { status, label: GATE_STATUS[status], result: status === 'approved' ? 'approved' : 'denied', auto, overridden };
}
/** Whether a staffing event is a gate review a lead has passed (approved): the ticket can move into Qualified and beyond. */
export const gatePassed = (p, rule) => gateDecision(p, rule)?.result === 'approved';

/**
 * Who can be picked for each of the people at the top of an Initial Gate Review, given a person's teams ([{ name, role }]):
 * solution architects are on Technical Solutioning; leadership is a BD lead or an Exec Ldr; pricing is Finance or an Exec Ldr.
 */
export const EXEC_TEAM = 'Exec Ldr';
const onTeam = (u, name, role) => (u?.teams || []).some((t) => t.name === name && (!role || t.role === role));
/** Who can set an Initial Gate Review's decision by hand: a BD lead or an Exec Ldr. */
export const canOverrideGate = (u) => onTeam(u, 'BD', 'lead') || onTeam(u, EXEC_TEAM);
export const STAFF_PICKS = {
  technical: { label: 'Solution Architect', placeholder: 'Type a solution architect…', can: (u) => onTeam(u, 'Technical Solutioning') },
  strategy: { label: 'Leadership', placeholder: 'Type a BD lead or exec…', can: (u) => onTeam(u, 'BD', 'lead') || onTeam(u, EXEC_TEAM) },
  pricing: { label: 'Pricing', placeholder: 'Type someone in finance…', can: (u) => onTeam(u, 'Finance') || onTeam(u, EXEC_TEAM) },
};

/** What a gate review decided. */
export const DECISIONS = ['Proceed', 'Revise', 'No-Bid'];

/**
 * The roles at each staffing event, as in the workflow. Each records who was there, who approved, and any notes.
 * `at` lists the milestones the workflow expects that role at.
 */
export const REVIEW_AREAS = [
  { key: 'strategy', label: 'SVP of Growth & Leadership', short: 'Leadership', about: 'Gate decisions and final approval', at: ['Initial Gate Review', 'Final Gate Review'] },
  { key: 'technical', label: 'Solution Architect & Technical', short: 'Technical', about: 'Feasibility, capabilities and gaps; technical input and validation', at: ['RFI Response', 'White Paper', 'Initial Gate Review', 'Statement of Objectives', 'Statement of Work', 'Proposal', 'RFP', 'Color Team Review', 'Other'] },
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
