// Process flow on a bid ticket: the formal steps of a pursuit, shared by the server and the app.

/** The kinds of process step, in the order they usually happen. */
export const PROCESS_TYPES = ['RFI', 'RFP', 'White Paper', 'Initial Gate Review', 'Final Gate Review', 'ROM', 'Proposal'];

/** The reviews held at each step. Each records who was involved and any notes. */
export const REVIEW_AREAS = [
  { key: 'technical', label: 'Technical review' },
  { key: 'pricing', label: 'Pricing review' },
  { key: 'strategy', label: 'Strategy review' },
  { key: 'support', label: 'Additional support' },
];

/** Keep only known review areas, with people as user ids and notes as text. */
export function cleanReviews(input) {
  const out = {};
  REVIEW_AREAS.forEach(({ key }) => {
    const r = input?.[key] || {};
    out[key] = {
      people: [...new Set((Array.isArray(r.people) ? r.people : []).map(Number).filter(Boolean))],
      notes: typeof r.notes === 'string' ? r.notes.trim() : '',
    };
  });
  return out;
}
