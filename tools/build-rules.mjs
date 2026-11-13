// Generates extension/rules/redirects.json from the route table in extension/src/core/routes.js.
// Run: npm run build:rules   (tests fail if the committed file is out of date)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const routes = require('../extension/src/core/routes.js');

export function buildRules() {
  return routes.RULE_REGEXES.map((regexFilter, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: routes.REDIRECT_SUBSTITUTION } },
    condition: { regexFilter, resourceTypes: ['main_frame'] },
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = new URL('../extension/rules/redirects.json', import.meta.url);
  writeFileSync(out, JSON.stringify(buildRules(), null, 2) + '\n');
  console.log('wrote', fileURLToPath(out));
}
