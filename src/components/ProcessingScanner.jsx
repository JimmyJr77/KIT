import { useProcessing } from '../lib/processing.js';

const CELLS = 11;      // lights in the bar
const TRAIL = 9;       // how many of them still glow behind the head before the trail dies out
const SWEEP_MS = 1150; // one pass from end to end
const CYCLE_MS = SWEEP_MS * 2;
const STEP = 1 / (CELLS - 1); // one cell, as a share of a sweep

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
          <style>{KEYFRAMES}</style>
          <div className="flex items-center gap-1 rounded-full bg-white/85 px-3 py-2 shadow-md ring-1 ring-slate-200/80 backdrop-blur-sm">
            {Array.from({ length: CELLS }, (_, i) => (
              <span key={i} className="kitt-cell block h-6 w-3.5 rounded-md bg-red-600" style={{ animationName: `kitt-cell-${i}` }} />
            ))}
          </div>
          <span className="sr-only">KIT is working…</span>
        </>
      )}
    </div>
  );
}

/**
 * Each light gets its own keyframes: it flares when the head passes (once each way) and dies down over the next
 * TRAIL cells' worth of travel, so the trail always falls behind the head whichever way it's going. The cycle is
 * drawn by CSS alone, so it keeps time even while the page is busy.
 */
function lit(t, peak) {
  const d = t - peak;
  if (d < 0) return Math.max(0, 1 + d / (STEP / 2)); // a quick rise over the half-cell before the head arrives
  return Math.max(0, 1 - d / (TRAIL * STEP)) ** 1.7;
}
function frames(i) {
  const peaks = [i * STEP, 2 - i * STEP]; // going right, then coming back (time in sweeps, 0..2)
  const times = new Set(peaks.flatMap((p) => [p - STEP / 2, p]).concat([0, 2]));
  for (let t = 0; t <= 2; t += 0.04) times.add(+t.toFixed(3));
  return [...times].filter((t) => t >= 0 && t <= 2).sort((a, b) => a - b).map((t) => {
    const v = Math.max(...peaks.map((p) => lit(t, p)), lit(t + 2, peaks[1])); // the return pass's trail carries over the cycle's start
    const glow = v > 0.05 ? `0 0 ${(10 * v).toFixed(1)}px ${(2 * v).toFixed(1)}px rgba(220,38,38,${(0.55 * v).toFixed(3)})` : '0 0 0 0 rgba(220,38,38,0)';
    return `${(t * 50).toFixed(2)}%{opacity:${v.toFixed(3)};box-shadow:${glow}}`;
  }).join('');
}
const KEYFRAMES = `.kitt-cell{animation-duration:${CYCLE_MS}ms;animation-timing-function:linear;animation-iteration-count:infinite}`
  + Array.from({ length: CELLS }, (_, i) => `@keyframes kitt-cell-${i}{${frames(i)}}`).join('')
  + `@media (prefers-reduced-motion:reduce){.kitt-cell{animation-duration:${CYCLE_MS * 3}ms}}`;
