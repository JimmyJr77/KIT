// Swim lanes on the Tickets page.
//   Work tickets stay in whichever lane people put them (To-do to start).
//   Bid tickets move on their own, unless locked:
//     no activity since it was created → To-do; activity within 7 days → In work;
//     7–14 days quiet → Stale / waiting; 14+ days quiet → back to To-do.
//   A bid that's Awarded or Lost is Done, locked or not.
//   Done tickets archive 14 days after reaching Done. Any ticket can be archived by hand, from any lane.

export const LANES = [
  { key: 'todo', label: 'To-do' },
  { key: 'in_work', label: 'In work' },
  { key: 'stale', label: 'Stale / waiting' },
  { key: 'done', label: 'Done' },
];
export const CLOSED_STAGES = ['Awarded', 'Lost'];
export const ARCHIVE_AFTER_DAYS = 14;

const DAY = 864e5;
const utc = (s) => (s ? Date.parse(`${s.replace(' ', 'T')}Z`) : NaN);

/** The lane a ticket is in right now. Needs created_at, last_activity, and the lane columns. */
export function laneFor(t, now = Date.now()) {
  if (t.ticket_type === 'work') return t.lane || 'todo';
  if (CLOSED_STAGES.includes(t.pipeline_status)) return 'done';
  if (t.lane_locked && t.lane) return t.lane;
  if (!(utc(t.last_activity) > utc(t.created_at))) return 'todo';
  const quiet = (now - utc(t.last_activity)) / DAY;
  return quiet < 7 ? 'in_work' : quiet < 14 ? 'stale' : 'todo';
}

/** Done tickets leave the board for the archive 14 days after reaching Done, or when archived by hand. */
export function isArchived(t, lane, now = Date.now()) {
  if (t.archived_at) return true; // archived by hand, from any lane
  if (lane !== 'done') return false;
  return !!t.done_at && now - utc(t.done_at) >= ARCHIVE_AFTER_DAYS * DAY;
}

/** Whole days until a Done ticket archives itself. */
export const daysToArchive = (t, now = Date.now()) =>
  (t.done_at ? Math.max(0, Math.ceil(ARCHIVE_AFTER_DAYS - (now - utc(t.done_at)) / DAY)) : ARCHIVE_AFTER_DAYS);
