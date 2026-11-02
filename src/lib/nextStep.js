// A ticket's next step is its top open activity. Its circle says how soon it's due:
//   none            yellow yield-style caution sign, exclamation mark
//   overdue         red, left-pointing arrow
//   due today       flashing red, down-pointing arrow
//   due in 1–3 days yellow, right-pointing arrow
//   due later       green, right-pointing arrow
// With no date, it's judged by age instead: green for its first week, yellow in its second, dark gray after that.
import { todayIso, shortDate } from './format.js';

const DAY = 864e5;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function nextStepState(step, today = todayIso()) {
  if (!step) return { tone: 'yellow', arrow: 'none', label: 'No next step' };
  if (step.due_date) {
    const days = daysBetween(today, step.due_date);
    const due = shortDate(step.due_date);
    if (days < 0) return { tone: 'red', arrow: 'left', label: `Overdue since ${due}` };
    if (days === 0) return { tone: 'red', arrow: 'down', flash: true, label: 'Due today' };
    if (days <= 3) return { tone: 'yellow', arrow: 'right', label: `Due ${due}, in ${days} day${days === 1 ? '' : 's'}` };
    return { tone: 'green', arrow: 'right', label: `Due ${due}` };
  }
  const age = step.created_at ? daysBetween(step.created_at.slice(0, 10), today) : 0;
  const since = `no date, set ${age} day${age === 1 ? '' : 's'} ago`;
  if (age < 7) return { tone: 'green', arrow: 'right', label: `No date (${since})` };
  if (age < 14) return { tone: 'yellow', arrow: 'right', label: `No date (${since})` };
  return { tone: 'gray', arrow: 'right', label: `No date (${since})` };
}
