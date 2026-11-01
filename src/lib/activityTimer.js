// How long a ticket has gone without activity, as shown along the bottom of ticket cards. Each week is a color, and
// the bar starts over each week, growing from a sliver on its first day to full on its seventh:
//   Days 1–7: green · 8–14: yellow · 15–21: orange · 22–28: red · 29 on: a full black bar, with the count of days
//   (then months, then "1yr+") in the card's bottom-right corner.

const DAY = 864e5;
const PHASES = ['bg-emerald-500', 'bg-yellow-400', 'bg-orange-500', 'bg-red-600'];
const START = 14; // how much of the bar shows on a phase's first day, in percent

/** Days (fractional) since a UTC "YYYY-MM-DD HH:MM:SS" timestamp. */
export const daysSince = (utc, now = Date.now()) => Math.max(0, (now - Date.parse(`${utc.replace(' ', 'T')}Z`)) / DAY);

/** { bar: { width: 0–100, color }, counter: string | null } for `days` without activity. */
export function activityTimer(days) {
  const phase = Math.floor(days / 7);
  if (phase < PHASES.length) {
    return { bar: { width: START + ((days - phase * 7) / 7) * (100 - START), color: PHASES[phase] }, counter: null };
  }
  const whole = Math.floor(days);
  const counter = whole < 90 ? `${whole}d` : whole < 365 ? `${Math.floor(whole / 30)}mo` : '1yr+';
  return { bar: { width: 100, color: 'bg-black' }, counter };
}
