import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
for (const name of ['recommendationCore', 'selectionEngine', 'defenseRecommendationCore', 'coordinatorReport', 'penaltyCatalog']) {
  const core = require(`../shared/${name}.js`);
  if (!core || !Object.keys(core).length) throw new Error(`Invalid PC core: ${name}`);
}
console.log('PC shared modules validated locally; no external sync.');
