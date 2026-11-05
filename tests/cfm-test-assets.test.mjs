import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { AssetError, digest, downloadEntry, entriesFromLocks, prepareRemote, freezeDataset, prepareFrozen } from '../scripts/study-content/cfm-test-assets.mjs';
const bytes = Buffer.from('Eigen synthetische CI-testbytes, geen officiële afbeelding.');
const entry = { file: 'media/test', url: 'https://www.churchofjesuschrist.org/test-only', sha: createHash('sha256').update(bytes).digest('hex'), git: false, byteSize: bytes.length, mimeType: 'image/jpeg' };
const response = (body = bytes, init = {}) => new Response(body, { headers: { 'content-type': entry.mimeType }, ...init });
const hash = b => createHash('sha256').update(b).digest('hex');
async function temporary(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cfm-assets-test-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }

test('locks: dedupliceert 11 identieke mediaregels, behoudt alle 929 OTB-pins', async () => {
  const entries = await entriesFromLocks();
  assert.equal(entries.filter(e => !e.git).length, 712);
  assert.equal(entries.filter(e => e.git).length, 929);
  assert.equal(new Set(entries.map(e => e.file)).size, entries.length);
});
test('download: correcte bytes blijven exact behouden; geen schrijfactie of hashvervanging', async () => {
  assert.deepEqual(await downloadEntry(entry, async () => response()), bytes);
});
test('HTTP 200-foutpagina: bestandsidentiteit, beide hashes, status en type zonder URL of body', async () => {
  const body = '<html>confidential-server-detail</html>';
  await assert.rejects(downloadEntry(entry, async () => response(body, { headers: { 'content-type': 'text/html' } })), error => {
    assert.ok(error instanceof AssetError);
    assert.deepEqual(error.diagnostic, { code: 'CFM_ASSET_HASH', file: entry.file, expectedHash: entry.sha, receivedHash: hash(body), httpStatus: 200, contentType: 'text/html', expectedBytes: bytes.length, receivedBytes: Buffer.byteLength(body), cause: null });
    assert.ok(!error.message.includes('https://') && !error.message.includes('confidential-server-detail')); return true;
  });
});
test('zelfde bytes met verkeerd type, HTTP-fout en ruwe netwerkfout worden afzonderlijk gediagnosticeerd', async () => {
  for (const [code, fetcher] of [
    ['CFM_ASSET_TYPE', async () => response(bytes, { headers: { 'content-type': 'text/html' } })],
    ['CFM_ASSET_HTTP', async () => response('error-secret', { status: 503 })],
    ['CFM_ASSET_NETWORK', async () => { throw Error('secret https://user:password@host'); }],
  ]) await assert.rejects(downloadEntry(entry, fetcher), e => e.diagnostic.code === code && !e.message.includes('secret') && !e.message.includes('password'));
});
test('redirects: alleen begrensde HTTPS op dezelfde toegestane host', async () => {
  let calls = 0;
  const valid = await downloadEntry(entry, async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: '/canonical' } }) : response());
  assert.deepEqual(valid, bytes);
  for (const location of ['http://www.churchofjesuschrist.org/x', 'https://evil.invalid/x', 'https://user:secret@www.churchofjesuschrist.org/x']) {
    await assert.rejects(downloadEntry(entry, async () => new Response(null, { status: 302, headers: { location } })), e => e.diagnostic.code === 'CFM_TEST_REDIRECT_HOST' && !e.message.includes('secret'));
  }
  await assert.rejects(downloadEntry(entry, async () => new Response(null, { status: 302, headers: { location: '/loop' } })), e => e.diagnostic.code === 'CFM_TEST_REDIRECT_LIMIT');
});
test('cache: hergebruik, corruptieherstel en expliciete broncontrole zonder cache', async t => {
  const root = await temporary(t); let calls = 0;
  const fetcher = async () => { calls++; return response(); };
  assert.equal((await prepareRemote(root, [entry], { fetcher })).downloaded, 1);
  assert.equal((await prepareRemote(root, [entry], { fetcher })).cached, 1);
  assert.equal(calls, 1);
  await fs.writeFile(path.join(root, entry.file), 'beschadigd');
  assert.equal((await prepareRemote(root, [entry], { fetcher })).downloaded, 1);
  assert.equal((await prepareRemote(root, [entry], { fetcher, fresh: true })).downloaded, 1);
  assert.equal(calls, 3);
});
test('gedeeltelijke fouten: geen foutbestand installeren, alle identiteiten diagnosticeren en hervatten', async t => {
  const root = await temporary(t), bad = { ...entry, file: 'media/bad' }; const diagnostics = [];
  await assert.rejects(prepareRemote(root, [entry, bad], { fetcher: async () => response('damaged'), onError: e => diagnostics.push(e.diagnostic) }), e => e.result.failures === 2);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(await fs.readdir(root), []);
  await prepareRemote(root, [entry, bad], { fetcher: async () => response() });
  assert.deepEqual(await fs.readFile(path.join(root, bad.file)), bytes);
});
test('vaste dataset: reproduceerbaar, offline, beide hashalgoritmen en nul downloads', async t => {
  const input = await temporary(t), output = await temporary(t);
  const otb = { file: 'otb/Test/1.md', git: true, sha: digest(bytes, { git: true }) };
  for (const e of [entry, otb]) { const p = path.join(input, e.file); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, bytes); }
  const archive = await freezeDataset(input, [entry, otb]);
  assert.deepEqual(await freezeDataset(input, [entry, otb]), archive);
  assert.deepEqual(await prepareFrozen(output, [entry, otb], archive, hash(archive)), { entries: 2, downloaded: 0, productionTouched: false });
  assert.deepEqual(await fs.readFile(path.join(output, otb.file)), bytes);
});
test('vaste dataset: buitenste hash, ontbrekende leden en gewijzigde bytes falen vóór de eerste write', async t => {
  const root = await temporary(t);
  const pack = files => gzipSync(Buffer.from(JSON.stringify({ version: 1, files })));
  const good = pack({ [entry.file]: bytes.toString('base64') });
  await assert.rejects(prepareFrozen(root, [entry], good, '0'.repeat(64)), /CFM_DATASET_HASH/);
  for (const files of [{}, { [entry.file]: Buffer.from('changed').toString('base64') }, { '../escape': 'YWJj' }]) {
    const archive = pack(files);
    await assert.rejects(prepareFrozen(root, [entry], archive, hash(archive)));
    assert.deepEqual(await fs.readdir(root), []);
  }
});
test('bevriezen weigert een ontbrekend of beschadigd origineel; nooit automatische repin', async t => {
  const root = await temporary(t);
  await assert.rejects(freezeDataset(root, [entry]), { code: 'ENOENT' });
  await fs.mkdir(path.join(root, 'media')); await fs.writeFile(path.join(root, entry.file), 'changed');
  await assert.rejects(freezeDataset(root, [entry]), e => e.diagnostic.code === 'CFM_ASSET_HASH');
});
test('installatie weigert een cachemap buiten de eigen tmp-boom en symlink-ontsnapping', async t => {
  await assert.rejects(prepareRemote('/workspace/not-a-test-cache', [], {}));
  const root = await temporary(t), other = await temporary(t);
  await fs.symlink(other, path.join(root, 'media'));
  await assert.rejects(prepareRemote(root, [entry], { fetcher: async () => response() }), e => e.result.failures === 1);
  assert.deepEqual(await fs.readdir(other), []);
});
