import { Play } from 'lucide-react';
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
 * opens the activity; with no next step it opens the Activity pane to add one.
 */
export default function NextStepBadge({ step, onOpen, className = '' }) {
  const s = nextStepState(step);
  const title = step ? `Next step: ${step.subject} · ${s.label}` : 'No next step. Add an activity.';
  return (
    <button type="button" title={title} aria-label={title}
      onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onOpen?.(step); }}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded-full shadow-sm ring-2 transition hover:scale-110 ${TONES[s.tone]} ${s.flash ? 'animate-blink' : ''} ${className}`}>
      {s.arrow === 'none'
        ? <span className="text-sm leading-none font-black">!</span>
        : <Play size={11} className={`fill-current ${s.arrow === 'right' ? 'translate-x-px' : ''} ${ROTATE[s.arrow]}`} strokeWidth={0} />}
    </button>
  );
}
