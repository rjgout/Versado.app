// Uitsluitend geïsoleerde testassets. Bestaande hashes blijven de autoriteit.
import fs from 'node:fs/promises';
import { entriesFromLocks, prepareRemote, prepareFrozen } from './cfm-test-assets.mjs';
const args = process.argv.slice(2);
if (args.some(a => !['--verify-upstream', '--offline'].includes(a)) || args.length > 1) throw Error('Kies --offline of --verify-upstream; geen impliciete moduswissel.');
const root = process.env.CFM_TEST_ASSETS;
const entries = await entriesFromLocks();
const diagnostics = [];
let report;
try {
  let result;
  if (args.includes('--offline')) {
    const manifest = JSON.parse(await fs.readFile('tests/fixtures/cfm/pinned-assets.lock.json', 'utf8'));
    if (manifest.version !== 1 || manifest.entries !== entries.length) throw Error('CFM_DATASET_MANIFEST');
    result = await prepareFrozen(root, entries, await fs.readFile('tests/fixtures/cfm/pinned-assets.json.gz'), manifest.sha256);
  } else result = await prepareRemote(root, entries, {
    fresh: args.includes('--verify-upstream'),
    onError: error => { diagnostics.push(error.diagnostic ?? { code: error.code ?? error.name }); console.error(error.message); },
  });
  report = { ...result, diagnostics };
  console.log(JSON.stringify(result));
} catch (error) {
  if (error.diagnostic) diagnostics.push(error.diagnostic);
  const code = error.result ? 'CFM_ASSET_PREPARATION_FAILED' : error.diagnostic?.code ?? (/^CFM_[A-Z_]+$/.test(error.message) ? error.message : error.code === 'ENOENT' ? 'CFM_DATASET_MISSING' : 'CFM_DATASET_UNAVAILABLE');
  report = { code, ...(error.result ?? {}), cause: error.code ?? error.name, diagnostics };
  console.error(JSON.stringify(report));
  process.exitCode = 1;
}

if (process.env.CFM_ASSET_REPORT) {
  const file = process.env.CFM_ASSET_REPORT;
  if (!/^\/tmp\/[a-zA-Z0-9_/-]+\.json$/.test(file) || file.includes('/../')) throw Error('CFM_REPORT_PATH');
  await fs.writeFile(file, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}
