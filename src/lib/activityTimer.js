// How long a bid ticket has gone without activity, as shown along the bottom of BD Pipeline cards.
//   Days 0–7:  a green bar that grows from left to right.
//   Days 7–14: a full bar that steps through yellow, orange, red, dark red, violet, dark purple, black (one per day).
//   After 14:  no bar, just a counter: days up to 89, then months in 30-day steps, then "1yr+" after 12 months.

const DAY = 864e5;
export const AGING_COLORS = ['bg-yellow-400', 'bg-orange-500', 'bg-red-500', 'bg-red-800', 'bg-violet-500', 'bg-purple-900', 'bg-black'];

/** Days (fractional) since a UTC "YYYY-MM-DD HH:MM:SS" timestamp. */
export const daysSince = (utc, now = Date.now()) => Math.max(0, (now - Date.parse(`${utc.replace(' ', 'T')}Z`)) / DAY);

/** { bar: { width: 0–100, color } | null, counter: string | null } for `days` without activity. */
export function activityTimer(days) {
  if (days < 7) return { bar: { width: (days / 7) * 100, color: 'bg-emerald-500' }, counter: null };
  if (days < 14) return { bar: { width: 100, color: AGING_COLORS[Math.floor(days - 7)] }, counter: null };
  const whole = Math.floor(days);
  if (whole < 90) return { bar: null, counter: `${whole}d` };
  if (whole < 365) return { bar: null, counter: `${Math.floor(whole / 30)}mo` };
  return { bar: null, counter: '1yr+' };
}
