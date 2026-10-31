// Sample data: load it, remove it, or reset it (remove, then load fresh). Works the same in development and production.
import { recordSample, removeSample, sampleStatus, setSampleHidden } from './registry.js';
import { generateSample } from './generate.js';

export { removeSample, sampleStatus, setSampleHidden };

/** Load the sample. Refuses if it's already loaded (reset instead). */
export function loadSample() {
  if (sampleStatus().loaded) throw new Error('Sample data is already loaded. Reset it to load a fresh copy.');
  setSampleHidden(false);
  return recordSample(() => generateSample());
}

/** Remove whatever sample is loaded (hidden or not), then load a fresh copy, shown. */
export function resetSample() {
  const removed = removeSample();
  const loaded = recordSample(() => generateSample());
  return { removed, loaded };
}
