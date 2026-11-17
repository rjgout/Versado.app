// CI-gereedschap; geen database, applicatie-authenticatie of productie-import.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_DATASET_BYTES = 96 * 1024 * 1024;
const hosts = new Set(['www.churchofjesuschrist.org', 'raw.githubusercontent.com']);
export const digest = (bytes, entry) => createHash(entry.git ? 'sha1' : 'sha256')
  .update(entry.git ? Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]) : bytes).digest('hex');
function safeFile(file) {
  if (typeof file !== 'string' || !/^(media|otb)\//.test(file) || file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) throw Error('CFM_ASSET_PATH');
  return file;
}
export async function entriesFromLocks() {
  const entries = [];
  for (const volume of ['cfm-2026-nl', 'cfm-2027-nl']) {
    const media = JSON.parse(await fs.readFile(`data/study-content/${volume}/media-lock.json`, 'utf8'));
    entries.push(...media.map(a => ({ file: `media/${a.file}`, url: a.url, sha: a.checksum, git: false, byteSize: a.byteSize, mimeType: a.mimeType })));
  }
  const index = JSON.parse(await fs.readFile('data/study-content/cfm-2026-nl/otb-index.json', 'utf8'));
  entries.push(...index.chapters.map(c => ({ file: `otb/${c.sourceFile}`, url: `https://raw.githubusercontent.com/OpenTranslationBible/open-bible/${index.upstreamCommit}/lang/nl-NL/${encodeURI(c.sourceFile)}`, sha: c.sourceBlob, git: true })));
  const unique = new Map();
  for (const e of entries) {
    safeFile(e.file);
    if (!new RegExp(`^[a-f0-9]{${e.git ? 40 : 64}}$`).test(e.sha)) throw Error('CFM_ASSET_PIN');
    const previous = unique.get(e.file);
    if (previous && JSON.stringify(previous) !== JSON.stringify(e)) throw Error('CFM_ASSET_CONFLICT');
    unique.set(e.file, e);
  }
  return [...unique.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
}
export class AssetError extends Error {
  constructor(code, entry, bytes, response, cause) {
    // Geen URL, body, headers of ruwe netwerkfout: die kunnen vertrouwelijke data bevatten.
    const diagnostic = { code, file: entry.file, expectedHash: entry.sha, receivedHash: bytes ? digest(bytes, entry) : null,
      httpStatus: response?.status ?? null, contentType: response?.headers?.get('content-type')?.split(';')[0]?.slice(0, 80) ?? null,
      expectedBytes: entry.byteSize ?? null, receivedBytes: bytes?.length ?? null, cause: cause?.name ?? null };
    super(JSON.stringify(diagnostic)); this.name = 'AssetError'; this.diagnostic = diagnostic;
  }
}
export function verifyBytes(bytes, entry, response) {
  if (bytes.length > MAX_ASSET_BYTES) throw new AssetError('CFM_ASSET_SIZE', entry, bytes, response);
  if (digest(bytes, entry) !== entry.sha) throw new AssetError('CFM_ASSET_HASH', entry, bytes, response);
  if (entry.byteSize !== undefined && bytes.length !== entry.byteSize) throw new AssetError('CFM_ASSET_SIZE', entry, bytes, response);
  if (response && entry.mimeType && response.headers.get('content-type')?.split(';')[0] !== entry.mimeType) throw new AssetError('CFM_ASSET_TYPE', entry, bytes, response);
}
export async function downloadEntry(entry, fetcher = fetch) {
  let url = new URL(entry.url);
  const host = url.hostname;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== 'https:' || !hosts.has(host) || url.hostname !== host || url.username || url.password || url.port) throw new AssetError('CFM_TEST_REDIRECT_HOST', entry);
    let response;
    try { response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(45000) }); }
    catch (error) { throw new AssetError('CFM_ASSET_NETWORK', entry, undefined, undefined, error); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || redirects === 3) throw new AssetError('CFM_TEST_REDIRECT_LIMIT', entry, undefined, response);
      try { url = new URL(location, url); } catch { throw new AssetError('CFM_TEST_REDIRECT_HOST', entry, undefined, response); }
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new AssetError('CFM_ASSET_HTTP', entry, undefined, response); }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_ASSET_BYTES) { await response.body?.cancel().catch(() => {}); throw new AssetError('CFM_ASSET_SIZE', entry, undefined, response); }
        chunks.push(chunk);
      }
    } catch (error) { if (error instanceof AssetError) throw error; throw new AssetError('CFM_ASSET_NETWORK', entry, undefined, response, error); }
    const bytes = Buffer.concat(chunks); verifyBytes(bytes, entry, response); return bytes;
  }
  throw new AssetError('CFM_TEST_REDIRECT_LIMIT', entry);
}
export async function prepareDirectory(root) {
  if (!root || !path.isAbsolute(root) || !path.resolve(root).startsWith('/tmp/')) throw Error('CFM_ASSET_ROOT');
  await fs.mkdir(root, { recursive: true });
  if (!(await fs.realpath(root)).startsWith('/tmp/')) throw Error('CFM_ASSET_PATH');
}
async function install(root, entry, bytes) {
  safeFile(entry.file);
  const target = path.join(root, entry.file), parent = path.dirname(target);
  await fs.mkdir(parent, { recursive: true });
  if (!(await fs.realpath(parent)).startsWith(await fs.realpath(root) + '/')) throw Error('CFM_ASSET_PATH');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, target); }
  finally { await fs.rm(temporary, { force: true }); }
}
export async function prepareRemote(root, entries, { fetcher = fetch, fresh = false, onError = () => {} } = {}) {
  await prepareDirectory(root);
  let next = 0, downloaded = 0, cached = 0; const errors = [];
  async function worker() {
    while (next < entries.length) {
      const e = entries[next++];
      try {
        if (!fresh) {
          try { verifyBytes(await fs.readFile(path.join(root, safeFile(e.file))), e); cached++; continue; }
          catch (error) { if (!(error instanceof AssetError) && error.code !== 'ENOENT') throw error; }
        }
        const bytes = await downloadEntry(e, fetcher); await install(root, e, bytes); downloaded++;
      } catch (error) { errors.push(error); onError(error); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  const result = { entries: entries.length, downloaded, cached, failures: errors.length, productionTouched: false };
  if (errors.length) throw Object.assign(Error('CFM_ASSET_PREPARATION_FAILED'), { result });
  return result;
}
// Alleen een expliciet aangeboden, volledige cache met de bestaande hashes kan
// worden bevroren. Geen netwerk, gegenereerde vervangers of automatische repin.
export async function freezeDataset(root, entries) {
  await prepareDirectory(root);
  const files = {};
  for (const e of entries) { const bytes = await fs.readFile(path.join(root, safeFile(e.file))); verifyBytes(bytes, e); files[e.file] = bytes.toString('base64'); }
  return gzipSync(Buffer.from(JSON.stringify({ version: 1, files })), { level: 9 });
}
export async function prepareFrozen(root, entries, archive, expectedArchiveHash) {
  if (archive.length > MAX_DATASET_BYTES || createHash('sha256').update(archive).digest('hex') !== expectedArchiveHash) throw Error('CFM_DATASET_HASH');
  const dataset = JSON.parse(gunzipSync(archive, { maxOutputLength: MAX_DATASET_BYTES }));
  if (dataset.version !== 1 || !dataset.files || Array.isArray(dataset.files)) throw Error('CFM_DATASET_FORMAT');
  const expected = entries.map(e => safeFile(e.file)).sort();
  if (JSON.stringify(Object.keys(dataset.files).sort()) !== JSON.stringify(expected)) throw Error('CFM_DATASET_MEMBERS');
  // Alles valideren vóór de eerste write; corruptie geeft nooit een halve dataset.
  const verified = entries.map(e => {
    const value = dataset.files[e.file]; if (typeof value !== 'string') throw Error('CFM_DATASET_FORMAT');
    const bytes = Buffer.from(value, 'base64'); if (bytes.toString('base64') !== value) throw Error('CFM_DATASET_FORMAT');
    verifyBytes(bytes, e); return [e, bytes];
  });
  await prepareDirectory(root);
  for (const [e, bytes] of verified) await install(root, e, bytes);
  return { entries: entries.length, downloaded: 0, productionTouched: false };
}
