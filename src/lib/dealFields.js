// Pipedrive's deal fields as KIT names and shows them. The fields themselves (and their choices) come from Pipedrive;
// this only says what KIT calls a few of them and which ones sit on the new-ticket form and in a ticket's Details box.

const norm = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** What KIT calls a Pipedrive deal field, where the two differ. (Account is the territory, and has its own place.) */
const KIT_LABELS = [
  ['google deal', 'Google Solution'],
  ['knexus ip', 'Knexus IP Utilization'],
  ['linked project', 'Linked Delivery'],
];
export const kitFieldLabel = (name) => KIT_LABELS.find(([start]) => norm(name).startsWith(start))?.[1] || name;

/** The deal fields asked for on a new pipeline ticket and shown in the Details box, in this order. */
const BOX_FIELDS = ['capability area', 'opportunity type', 'google deal', 'google fsr', 'knexus ip'];
export const boxFields = (fields) => BOX_FIELDS.map((start) => (fields || []).find((f) => f.custom && norm(f.name).startsWith(start))).filter(Boolean);

/**
 * The choices to offer for a field: Pipedrive's. Google Solution is a plain Yes or No in KIT, so its other Pipedrive
 * choices (N/A) are offered only on a deal that already has one.
 */
export function fieldChoices(field, current) {
  const labels = (field.options || []).map((o) => o.label);
  if (!norm(field.name).startsWith('google deal')) return labels;
  const yesNo = labels.filter((l) => ['yes', 'no'].includes(l.toLowerCase()));
  if (!yesNo.length) return labels;
  return current && !yesNo.includes(current) ? [...yesNo, current] : yesNo;
}
