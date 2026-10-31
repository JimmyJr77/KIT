// Sample data from the command line: `npm run sample -- load | reset | remove | preview | hide | show | status`.
import 'dotenv/config';
import { loadSample, removeSample, resetSample, sampleStatus, setSampleHidden } from '../sample/index.js';

const action = process.argv[2] || 'status';
const actions = { load: loadSample, reset: resetSample, remove: () => removeSample(), preview: () => removeSample({ dryRun: true }), hide: () => (setSampleHidden(true), sampleStatus()), show: () => (setSampleHidden(false), sampleStatus()), status: sampleStatus };
if (!actions[action]) {
  console.error(`Unknown action "${action}". Use load, reset, remove, preview, hide, show or status.`);
  process.exit(1);
}
console.log(JSON.stringify(actions[action](), null, 2));
