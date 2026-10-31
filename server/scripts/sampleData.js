// Sample data from the command line: `npm run sample -- hide | show | status`, plus `reset` for a fresh copy in development.
import 'dotenv/config';
import { resetSample, sampleStatus, setSampleHidden } from '../sample/index.js';

const action = process.argv[2] || 'status';
const actions = { hide: () => (setSampleHidden(true), sampleStatus()), show: () => (setSampleHidden(false), sampleStatus()), reset: resetSample, status: sampleStatus };
if (!actions[action]) {
  console.error(`Unknown action "${action}". Use hide, show, status or reset.`);
  process.exit(1);
}
console.log(JSON.stringify(actions[action](), null, 2));
