// Usage: npm run gsa:import -- path/to/FY2027_PerDiemMasterRatesFile.csv [fiscalYear]
import fs from 'node:fs';
import { importGsaCsv, fiscalYear } from '../services/gsa.js';

const [file, fy] = process.argv.slice(2);
if (!file) {
  console.error('Usage: npm run gsa:import -- <file.csv> [fiscalYear]');
  process.exit(1);
}
const result = importGsaCsv(fs.readFileSync(file, 'utf8'), Number(fy) || fiscalYear());
console.log(`Imported ${result.imported} GSA rate rows for FY${result.fiscalYear}`);
