// The win assessment on a bid ticket: eight criteria, each with prompts to fill in and a 1–5 score.
// Stored on the ticket as { [criterion key]: { score, answers: { [prompt key]: text } } }.
// Each criterion also carries its default PWIN weight, the reason for it, and whether it's a must-have;
// teams can change weights and must-haves in BD Pipeline › Settings.

export const SCORE_LABELS = {
  1: 'No information or evidence',
  2: 'Little information or evidence',
  3: 'Some information and evidence',
  4: 'Good information and evidence',
  5: 'Strong or full information and evidence',
};

export const CRITERIA = [
  {
    key: 'need', title: 'Customer need', weight: 15, mustHave: true,
    why: 'A real, prioritized problem the customer is actively trying to solve is the strongest sign an award will happen.',
    blurb: 'Specific mission problem, desired outcome, and evidence of customer prioritization.',
    prompts: [
      { key: 'problem', label: 'Specific mission problem', placeholder: 'What mission problem is the customer trying to solve?' },
      { key: 'outcome', label: 'Desired outcome', placeholder: 'What does success look like to them?' },
      { key: 'priority', label: 'Evidence of customer prioritization', placeholder: 'Statements, budgets, directives, or actions that show this matters now' },
    ],
  },
  {
    key: 'access', title: 'Customer access', weight: 30, mustHave: true,
    why: 'Customers buy from people they know and trust. Access to the mission owner lets us shape the requirement.',
    blurb: 'Named mission owner, decision influencers, and acquisition stakeholders.',
    prompts: [
      { key: 'owner', label: 'Named mission owner', placeholder: 'Name, role, and how we know them' },
      { key: 'influencers', label: 'Decision influencers', placeholder: 'Who shapes the decision, and our relationship with each' },
      { key: 'acquisition', label: 'Acquisition stakeholders', placeholder: 'Contracting officer, program office, small business office…' },
    ],
  },
  {
    key: 'funding', title: 'Funding confidence', weight: 20, mustHave: true,
    why: 'No money, no award. Confirmed funding is what turns customer interest into a contract.',
    blurb: 'Funding source, estimated budget, and status: confirmed, planned, or speculative with evidence.',
    prompts: [
      { key: 'source', label: 'Funding source', placeholder: 'Program element, appropriation, or color of money' },
      { key: 'budget', label: 'Estimated budget', placeholder: 'Amount and period of performance' },
      { key: 'status', label: 'Funding status', options: ['Confirmed', 'Planned', 'Speculative'] },
      { key: 'evidence', label: 'Evidence', placeholder: 'Budget documents, customer statements, or other proof' },
    ],
  },
  {
    key: 'acquisition', title: 'Acquisition path & timing', weight: 0,
    why: 'We need a vehicle we can bid on and a timeline we can meet, but a path can often be found or teamed into.',
    blurb: 'Expected vehicle, procurement plan, solicitation and award windows, and our eligibility or teaming path.',
    prompts: [
      { key: 'vehicle', label: 'Expected vehicle', placeholder: 'GSA schedule, IDIQ, OTA, full and open…' },
      { key: 'plan', label: 'Procurement plan', placeholder: 'Set-aside, evaluation approach, contract type' },
      { key: 'windows', label: 'Solicitation / award windows', placeholder: 'RFI, draft RFP, final RFP, and award dates' },
      { key: 'eligibility', label: 'Our eligibility or teaming path', placeholder: 'Prime, sub, or the partner we need' },
    ],
  },
  {
    key: 'solution', title: 'Solution & delivery fit', weight: 5,
    why: 'Capability gaps can usually be closed by hiring or teaming, so fit matters far less than customer pull.',
    blurb: 'Match to capabilities and past performance; staffing, clearance, technology, and gaps.',
    prompts: [
      { key: 'fit', label: 'Match to capabilities and past performance', placeholder: 'Relevant contracts and capabilities' },
      { key: 'staffing', label: 'Staffing', placeholder: 'Key personnel and hiring needs' },
      { key: 'clearance', label: 'Clearance', placeholder: 'Facility and personnel clearance requirements' },
      { key: 'technology', label: 'Technology', placeholder: 'Tools, platforms, and accreditations required' },
      { key: 'gaps', label: 'Gaps', placeholder: 'What we’re missing and how we’d close it' },
    ],
  },
  {
    key: 'competition', title: 'Competitive position', weight: 20,
    why: 'An entrenched incumbent or weak discriminators can sink an otherwise strong pursuit.',
    blurb: 'Incumbent and likely competitors, customer-valued discriminators, and evidence.',
    prompts: [
      { key: 'incumbent', label: 'Incumbent', placeholder: 'Who holds the work today, and how the customer views them' },
      { key: 'competitors', label: 'Likely competitors', placeholder: 'Who else will bid' },
      { key: 'discriminators', label: 'Customer-valued discriminators', placeholder: 'What sets us apart, in the customer’s terms' },
      { key: 'evidence', label: 'Evidence', placeholder: 'Feedback, debriefs, or market intelligence' },
    ],
  },
  {
    key: 'business', title: 'Business value', weight: 0,
    why: 'Tells us whether the win is worth having, not whether we will win it.',
    blurb: 'Estimated company share, expected margin, capture and proposal cost, and strategic account value.',
    prompts: [
      { key: 'share', label: 'Estimated company share', placeholder: 'Our share of the total value' },
      { key: 'margin', label: 'Expected margin', placeholder: 'Expected fee or margin' },
      { key: 'cost', label: 'Capture / proposal cost', placeholder: 'B&P budget and hours' },
      { key: 'strategic', label: 'Strategic account value', placeholder: 'Why this matters beyond the contract itself' },
    ],
  },
  {
    key: 'momentum', title: 'Pursuit momentum', weight: 10,
    why: 'Steady progress with a clear owner shows the pursuit is real and moving.',
    blurb: 'Next milestone, accountable owner, due date, and evidence of progress.',
    prompts: [
      { key: 'milestone', label: 'Next milestone', placeholder: 'The next concrete step' },
      { key: 'owner', label: 'Accountable owner', placeholder: 'Who owns it' },
      { key: 'due', label: 'Due date', type: 'date' },
      { key: 'progress', label: 'Evidence of progress', placeholder: 'What has moved since the last check-in' },
    ],
  },
];

/** Default PWIN weights, one per criterion. They're relative: a criterion's share of the score is its weight over the total. */
export const DEFAULT_PWIN_WEIGHTS = Object.fromEntries(CRITERIA.map((c) => [c.key, c.weight]));

/** Areas that sink PWIN when weak, whatever their weight (Customer need, access, and funding by default). */
export const DEFAULT_PWIN_GATES = CRITERIA.filter((c) => c.mustHave).map((c) => c.key);

/** The best possible PWIN, for a ticket rated 5 in every area. Even a perfect pursuit isn't a sure win. */
export const MAX_PWIN = 0.7;

/** Share of an area's weight earned at each rating. Each step further from 5 costs more than a straight line would. */
export const RATING_CREDIT = { 5: 1, 4: 0.7, 3: 0.4, 2: 0.15, 1: 0 };
/** Below 3, a must-have area multiplies the whole score by this, whatever its weight. */
export const MUST_HAVE_PENALTY = { 2: 0.5, 1: 0.15 };
/** Below 3, any other area multiplies the score by this raised to (3 × its share of the weight): heavier areas cut deeper. */
export const WEIGHTED_PENALTY = { 2: 0.5, 1: 0.2 };
const WEIGHTED_PENALTY_STRENGTH = 3;

/**
 * PWIN: a 0–100 score from the win assessment.
 *   1. Base: each area earns RATING_CREDIT of its weight, so falling short of 5 costs more and more.
 *   2. Below 3, the base is multiplied down: hard for must-have areas, in proportion to weight for the rest.
 *      A weak must-have (say, no evidence the customer needs this) sinks the score however strong the rest is.
 *   3. The result is scaled to MAX_PWIN, so all 5s gives 70%, not 100%.
 * Areas not yet rated count as 1, since 1 means "no information". Returns null until an area that counts is rated.
 * Also returns the base before penalties and each penalty applied, so the score can be explained.
 */
export function pwin(assessment = {}, weights = DEFAULT_PWIN_WEIGHTS, gates = DEFAULT_PWIN_GATES) {
  const weight = (c) => Math.max(0, Number(weights[c.key]) || 0);
  const total = CRITERIA.reduce((sum, c) => sum + weight(c), 0);
  const counts = (c) => weight(c) > 0 || gates.includes(c.key);
  if (!total || !CRITERIA.some((c) => counts(c) && assessment?.[c.key]?.score)) return null;

  const rating = (c) => assessment?.[c.key]?.score || 1;
  const base = CRITERIA.reduce((sum, c) => sum + (weight(c) / total) * RATING_CREDIT[rating(c)], 0);
  const penalties = CRITERIA.filter((c) => rating(c) < 3).map((c) => ({
    key: c.key,
    title: c.title,
    rating: rating(c),
    rated: !!assessment?.[c.key]?.score,
    mustHave: gates.includes(c.key),
    factor: gates.includes(c.key) ? MUST_HAVE_PENALTY[rating(c)] : WEIGHTED_PENALTY[rating(c)] ** (WEIGHTED_PENALTY_STRENGTH * (weight(c) / total)),
  })).filter((x) => x.factor < 1);
  const score = base * penalties.reduce((product, x) => product * x.factor, 1);
  return {
    score: Math.round(score * MAX_PWIN * 100),
    base: Math.round(base * MAX_PWIN * 100),
    penalties,
    rated: CRITERIA.filter((c) => assessment?.[c.key]?.score).length,
    total: CRITERIA.length,
  };
}

/** Each criterion's share of the score, in percent. */
export function weightShares(weights = DEFAULT_PWIN_WEIGHTS) {
  const total = CRITERIA.reduce((sum, c) => sum + (Number(weights[c.key]) || 0), 0);
  return Object.fromEntries(CRITERIA.map((c) => [c.key, total ? ((Number(weights[c.key]) || 0) / total) * 100 : 0]));
}
