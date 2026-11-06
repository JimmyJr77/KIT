import { useEffect, useRef } from 'react';
import { useProcessing } from '../lib/processing.js';

const CELLS = 11;      // lights in the bar
const TRAIL = 9;       // how many of them glow behind the head before the trail dies out
const SWEEP_MS = 1150; // one pass from end to end

/**
 * KITT's scanner: a red light that sweeps the bar and leaves a fading trail behind it. It sits at the bottom
 * middle of the screen whenever KIT is working on something, which mostly means waiting on an answer from
 * Gemini. Pass `always` to keep it up regardless (the sign-in bootstrap uses that).
 */
export default function ProcessingScanner({ always = false }) {
  const shown = useProcessing() || always;
  return (
    <div aria-hidden={!shown} role="status" aria-live="polite"
      className={`pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 transition-opacity duration-200 print:hidden ${shown ? 'opacity-100' : 'opacity-0'}`}>
      {shown && (
        <>
          <Scanner />
          <span className="sr-only">KIT is working…</span>
        </>
      )}
    </div>
  );
}

/** The sweep is driven frame by frame so the trail always falls behind the head, whichever way it's going. */
function Scanner() {
  const cells = useRef([]);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      cells.current.forEach((el, i) => el && paint(el, Math.max(0, 1 - i / TRAIL)));
      return undefined;
    }
    let frame;
    const start = performance.now();
    const tick = (now) => {
      const phase = ((now - start) / SWEEP_MS) % 2;          // 0→1 going right, 1→2 coming back
      const forward = phase < 1;
      const head = (forward ? phase : 2 - phase) * (CELLS - 1);
      cells.current.forEach((el, i) => {
        if (!el) return;
        const behind = forward ? head - i : i - head;        // distance back from the head along its path
        const lit = behind < 0 ? Math.max(0, 1 + behind * 2) : Math.max(0, 1 - behind / TRAIL);
        paint(el, lit ** 1.7);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="flex items-center gap-1 rounded-full bg-white/85 px-3 py-2 shadow-md ring-1 ring-slate-200/80 backdrop-blur-sm">
      {Array.from({ length: CELLS }, (_, i) => (
        <span key={i} ref={(el) => { cells.current[i] = el; }} className="block h-6 w-3.5 rounded-md bg-red-600" style={{ opacity: 0 }} />
      ))}
    </div>
  );
}

function paint(el, lit) {
  el.style.opacity = lit.toFixed(3);
  el.style.boxShadow = lit > 0.05 ? `0 0 ${(10 * lit).toFixed(1)}px ${(2 * lit).toFixed(1)}px rgba(220, 38, 38, ${(0.55 * lit).toFixed(3)})` : 'none';
}
