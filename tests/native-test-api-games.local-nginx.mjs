// Lokale variant van de Docker-integratietest voor de spelroutes: draait de GEGENEREERDE configuratie in een echte
// nginx-binary (vereist `nginx` in het PATH; geen Docker) met een synthetische upstream. Geen NAS, geen Cloudflare,
// geen netwerk buiten 127.0.0.1. Gebruik: node tests/native-test-api-games.local-nginx.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { render, TEST_API_HOST } from '../scripts/native/render-test-api-proxy.mjs';
import { clientRequests, rejectedRequests } from './fixtures/native-test-api-game-cases.mjs';

const nginx = spawnSync('nginx', ['-v'], { encoding: 'utf8' });
if (nginx.error) { console.error('nginx ontbreekt in het PATH: deze lokale variant is niet uitgevoerd (de Docker-integratietest draait in CI).'); process.exit(2); }
const root = mkdtempSync(join(tmpdir(), 'versado-games-proxy-'));
const upstreamPort = 38000 + Math.floor(Math.random() * 1000), apiPort = upstreamPort + 1000, webPort = upstreamPort + 2000;
let proxy;
const upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, uri: req.url, method: req.method, cookie: req.headers.cookie ?? '', authorization: req.headers.authorization ?? '' })); });
try {
  await new Promise(resolve => upstream.listen(upstreamPort, '127.0.0.1', resolve));
  const conf = render(readFileSync('deploy/nginx/nginx.conf', 'utf8'))
    .replaceAll('http://jehova-app:3000', `http://127.0.0.1:${upstreamPort}`).replace('listen 8081 default_server', `listen ${apiPort} default_server`).replace('    listen 80;', `    listen ${webPort};`);
  writeFileSync(join(root, 'nginx.conf'), conf);
  for (const candidate of ['/etc/nginx/mime.types', '/usr/local/etc/nginx/mime.types', '/opt/homebrew/etc/nginx/mime.types']) if (existsSync(candidate)) { copyFileSync(candidate, join(root, 'mime.types')); break; }
  const globals = `pid ${root}/nginx.pid; error_log ${root}/error.log;`;
  const test = spawnSync('nginx', ['-t', '-p', root, '-c', join(root, 'nginx.conf'), '-g', globals], { encoding: 'utf8' });
  assert.equal(test.status, 0, `nginx -t: ${test.stderr}`);
  proxy = spawn('nginx', ['-p', root, '-c', join(root, 'nginx.conf'), '-g', `${globals} daemon off;`], { stdio: 'ignore' });
  const request = (path, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: apiPort, path, method, timeout: 3000, headers: { Host: TEST_API_HOST, Origin: 'capacitor://localhost', ...headers } }, res => { let body = ''; res.on('data', v => body += v); res.on('end', () => resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
  });
  for (let i = 0; i < 50; i++) { try { await request('/'); break; } catch (error) { if (i === 49) throw error; await new Promise(r => setTimeout(r, 100)); } }
  const base = '/api/v1/native/';
  let accepted = 0;
  for (const [method, uri] of clientRequests()) {
    const r = await request(base + uri, method);
    assert.equal(r.status, 200, `client-verzoek moet door: ${method} ${uri} -> ${r.status}`);
    if (method !== 'HEAD') assert.equal(JSON.parse(r.body).uri, base + uri, 'de upstream ziet exact de oorspronkelijke request-uri');
    accepted++;
  }
  let refused = 0;
  for (const [reason, method, uri] of rejectedRequests) {
    const r = await request(base + uri, method);
    assert.equal(r.status, 404, `${reason}: ${method} ${uri} -> ${r.status}`);
    refused++;
  }
  // Methode, origin en host blijven begrensd, ook voor spelroutes.
  assert.equal((await request(`${base}games/page?route=%2Flive`, 'GET', { Origin: 'https://dev.versado.app' })).status, 403);
  assert.equal((await request(`${base}games/page?route=%2Flive`, 'GET', { Host: 'dev.versado.app' })).status, 404);
  assert.equal((await request(`${base}games/page?route=%2Flive`, 'OPTIONS')).status, 200);
  const authenticated = JSON.parse((await request(`${base}games/page?route=%2Flive`, 'GET', { Authorization: 'Bearer synthetic', Cookie: 'web-session=geheim' })).body);
  assert.equal(authenticated.authorization, 'Bearer synthetic'); assert.equal(authenticated.cookie, '', 'webcookies worden upstream verwijderd');
  // Bestaande routes ongewijzigd.
  for (const [path, status] of [['capabilities', 200], ['today-overview', 200], ['courses', 200], ['capabilities?token=secret', 404], ['%63apabilities', 404], ['capabilities/extra', 404]]) assert.equal((await request(base + path)).status, status, path);
  assert.equal((await request(`${base}realtime/session`, 'POST')).status, 200);
  assert.equal((await request('/socket.io/?EIO=4&transport=websocket')).status, 200);
  console.log(`nginx ${nginx.stderr.trim()}: ${accepted} clientverzoeken doorgelaten, ${refused} verdachte/foute verzoeken geweigerd; Vandaag/Leren/auth/realtime ongewijzigd.`);
} finally {
  proxy?.kill(); upstream.close(); rmSync(root, { recursive: true, force: true });
}
