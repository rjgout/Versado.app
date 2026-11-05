import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const workflow = readFileSync('.github/workflows/content-access.yml', 'utf8');
const external = readFileSync('.github/workflows/cfm-source-integrity.yml', 'utf8');
const jobs = Object.fromEntries([...workflow.matchAll(/^  ([a-z0-9-]+):\n([\s\S]*?)(?=^  [a-z0-9-]+:\n|$(?![\s\S]))/gm)].map(m => [m[1], m[2]]));
test('CFM: één gedeelde productiebuild, vijf echte consumers en dezelfde matrix-identiteiten', () => {
  const combined = jobs['cfm-test-setup'] + jobs['cfm-2026-import'] + jobs['cfm-programme'];
  assert.equal((combined.match(/npm run build/g) ?? []).length, 1);
  assert.match(jobs['cfm-2026-import'], /npm run test:cfm-2026:integration/);
  for (const suite of ['cfm-programme', 'cfm-auto-publish', 'cfm-2027', 'cfm-video-revision']) assert.match(jobs['cfm-programme'], new RegExp(`${suite}\\.integration\\.test\\.ts`));
  assert.match(jobs['cfm-programme'], /--cfm-suite=\$\{\{ matrix.suite \}\}/);
  assert.match(jobs['cfm-programme'], /fail-fast: false/);
});
test('CFM: een kapotte voorbereiding kan verplichte consumerchecks niet groen laten overslaan', () => {
  for (const name of ['cfm-2026-import', 'cfm-programme']) {
    assert.match(jobs[name], /needs: cfm-test-setup/);
    assert.match(jobs[name], /if: \$\{\{ always\(\) \}\}/);
    assert.match(jobs[name], /test "\$SETUP_RESULT" = success/);
    assert.doesNotMatch(jobs[name], /continue-on-error|npm run build|\|\| true/);
  }
});
test('CFM: gewone PR-tests gebruiken alleen offline bronbytes en buildartefact van dezelfde commit', () => {
  for (const name of ['cfm-test-setup', 'cfm-2026-import', 'cfm-programme']) {
    assert.match(jobs[name], /prepare-cfm-test-assets\.mjs --offline/);
    assert.doesNotMatch(jobs[name], /--verify-upstream|freeze-cfm|fetch-cfm|curl |wget /);
    assert.match(jobs[name], /name: cfm-test-build-\$\{\{ github.sha \}\}/);
  }
  assert.match(workflow, /branches: \[main, develop,/);
  assert.match(workflow, /'tests\/fixtures\/cfm\/\*\*'/);
});
test('CFM: strikte externe broncontrole blijft afzonderlijk, expliciet en zonder write-permissies', () => {
  assert.match(external, /workflow_dispatch:/);
  assert.match(external, /schedule:/);
  assert.match(external, /prepare-cfm-test-assets\.mjs --verify-upstream/);
  assert.match(external, /contents: read/);
  assert.doesNotMatch(external, /contents: write|pull_request_target|--offline|freeze-cfm|continue-on-error/);
  assert.doesNotMatch(external, /'src\/\*\*'/);
  assert.match(external, /CFM_ASSET_REPORT:/);
});
