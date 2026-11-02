import { Play, Hourglass } from 'lucide-react';
import { nextStepState } from '../lib/nextStep.js';

const TONES = {
  green: 'bg-emerald-500 text-white ring-emerald-200',
  yellow: 'bg-amber-400 text-amber-950 ring-amber-200',
  red: 'bg-red-600 text-white ring-red-200',
  gray: 'bg-slate-600 text-white ring-slate-300',
};
const ROTATE = { right: '', left: 'rotate-180', down: 'rotate-90' };

/**
 * The ticket's next step as a circle: its color and arrow say how soon it's due (see lib/nextStep.js). Selecting it
 * opens the activity; with no next step it's a yellow yield-style caution sign that opens the Activity pane to add one.
 */
export default function NextStepBadge({ step, onOpen, className = '' }) {
  const s = nextStepState(step);
  const title = step ? `Next step: ${step.subject} · ${s.label}${step.waiting_client ? ' · Waiting on client' : ''}` : 'No next step. Add an activity.';
  // The next step is waiting on the client: a small hourglass rides on the badge's top-left.
  const waiting = step?.waiting_client ? (
    <span className="absolute -top-2 -left-2 grid h-4 w-4 place-items-center rounded-full bg-sky-100 text-sky-700 ring-2 ring-white" aria-hidden="true">
      <Hourglass size={9} strokeWidth={3} />
    </span>
  ) : null;
  if (s.arrow === 'none') {
    return (
      <button type="button" title={title} aria-label={title}
        onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen?.(step); }}
        className={`grid h-6 w-6 shrink-0 place-items-center drop-shadow-sm transition hover:scale-110 ${className}`}>
        <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
          <path d="M3 4.5h18L12 20.5z" className="fill-amber-400 stroke-amber-400" strokeWidth="4" strokeLinejoin="round" />
          <path d="M12 7.5v5" className="stroke-amber-950" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="15.6" r="1.3" className="fill-amber-950" />
        </svg>
      </button>
    );
  }
  return (
    <button type="button" title={title} aria-label={title}
      onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpen?.(step); }}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full shadow-sm ring-2 transition hover:scale-110 ${TONES[s.tone]} ${s.flash ? 'animate-blink' : ''} ${className}`}>
      <Play size={11} className={`fill-current ${s.arrow === 'right' ? 'translate-x-px' : ''} ${ROTATE[s.arrow]}`} strokeWidth={0} />
      {waiting}
    </button>
  );
}
