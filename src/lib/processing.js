import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * How many things KIT is working on right now: every API request counts itself in and out (see api.js), and
 * other slow work can do the same with beginProcessing(). The scanner at the foot of the page watches this.
 */
let active = 0;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const snapshot = () => active > 0;

/** Counts one piece of work in; call what it returns when the work is done (safe to call twice). */
export function beginProcessing() {
  active += 1;
  notify();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    active -= 1;
    notify();
  };
}

/** Counts a promise as work until it settles, and hands it back. */
export function withProcessing(promise) {
  const end = beginProcessing();
  return Promise.resolve(promise).finally(end);
}

/** Whether anything is in flight at this instant. */
export const useProcessingActive = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/**
 * Whether to show the processing animation: it waits a moment so a quick request doesn't flash it, and once shown
 * it stays up long enough to read as one motion rather than a flicker.
 */
export function useProcessing({ delay = 250, hold = 800 } = {}) {
  const busy = useProcessingActive();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (busy === shown) return undefined;
    const t = setTimeout(() => setShown(busy), busy ? delay : hold);
    return () => clearTimeout(t);
  }, [busy, shown, delay, hold]);
  return shown;
}
