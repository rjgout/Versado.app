// Expliciete maintaineractie, uitsluitend na verificatie van de bronbestanden en
// rechten. Leest een eigen tmp-cache; verandert nooit bron-/media-locks of de DB.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { entriesFromLocks, freezeDataset, prepareFrozen } from './cfm-test-assets.mjs';
const root = process.env.CFM_TEST_ASSETS;
const entries = await entriesFromLocks();
const archive = await freezeDataset(root, entries);
const sha256 = createHash('sha256').update(archive).digest('hex');
// Verifieer het uiteindelijke archief ook via de normale offline-consumer.
const check = '/tmp/versado-cfm-freeze-check-' + process.pid;
try { await prepareFrozen(check, entries, archive, sha256); }
finally { await fs.rm(check, { recursive: true, force: true }); }
const dir = 'tests/fixtures/cfm'; await fs.mkdir(dir, { recursive: true });
await fs.writeFile(`${dir}/pinned-assets.json.gz`, archive);
await fs.writeFile(`${dir}/pinned-assets.lock.json`, JSON.stringify({ version: 1, sha256, bytes: archive.length, entries: entries.length }, null, 2) + '\n');
console.log(JSON.stringify({ frozen: entries.length, sha256, bytes: archive.length, productionTouched: false }));
