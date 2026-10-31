// Sample data is always there. It's loaded once, the first time the server starts, and from then on admins only
// hide or show it. Works the same in development and production.
import { recordSample, removeSample, sampleStatus, setSampleHidden } from './registry.js';
import { generateSample } from './generate.js';

export { removeSample, sampleStatus, setSampleHidden };

/**
 * Load the sample if it isn't loaded yet. In production it starts hidden, so real users don't meet fake records
 * until an admin chooses to show them.
 */
export function ensureSample() {
  if (sampleStatus().loaded) return null;
  const loaded = recordSample(() => generateSample());
  setSampleHidden(process.env.NODE_ENV === 'production');
  return loaded;
}

/** For developers, from the command line only: remove the sample and load a fresh copy, keeping it hidden or shown. */
export function resetSample() {
  const { hidden } = sampleStatus();
  const removed = removeSample();
  const loaded = recordSample(() => generateSample());
  setSampleHidden(hidden);
  return { removed, loaded };
}
