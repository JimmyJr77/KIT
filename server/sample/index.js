// Sample data lives on development servers only. There it's loaded once, the first time the server starts, and from
// then on admins only hide or show it. Production never loads it, and removes a copy left from before (see
// cleanProduction) so real users never meet fake records.
import { recordSample, removeSample, sampleStatus, setSampleHidden } from './registry.js';
import { generateSample } from './generate.js';

export { removeSample, sampleStatus, setSampleHidden };

export const production = () => process.env.NODE_ENV === 'production';

/** Load the sample if it isn't loaded yet. Never in production. */
export function ensureSample() {
  if (production() || sampleStatus().loaded) return null;
  const loaded = recordSample(() => generateSample());
  setSampleHidden(false);
  return loaded;
}

/**
 * What removing the sample would take, for an admin to see first: `sample` counts the sample's own rows; `realDeleted`
 * and `realCleared` are real rows that can't exist without one (deleted) or that only point at one (the link cleared).
 */
export const removalPlan = () => (sampleStatus().loaded ? removeSample({ dryRun: true }) : null);
/** Whether removing the sample would touch anything real. */
const touchesReal = (plan) => !!plan && (Object.keys(plan.realDeleted).length > 0 || Object.keys(plan.realCleared).length > 0);

/**
 * Production, at startup: take off a sample left from before, as long as nothing real depends on it. If something real
 * does (a real record points at a sample one), it's left hidden and reported, and an admin removes it from Admin Access
 * after seeing what goes with it. Returns { removed } or { kept } with the plan, or null when there's nothing to do.
 */
export function cleanProduction() {
  if (!production()) return null;
  const plan = removalPlan();
  if (!plan) return null;
  if (touchesReal(plan)) { setSampleHidden(true); return { kept: plan }; }
  return { removed: removeSample() };
}

/** Remove the sample and load a fresh copy, keeping it hidden or shown. Never in production, which has no sample. */
export function resetSample() {
  if (production()) return null;
  const { hidden } = sampleStatus();
  const removed = removeSample();
  const loaded = recordSample(() => generateSample());
  setSampleHidden(hidden);
  return { removed, loaded };
}
