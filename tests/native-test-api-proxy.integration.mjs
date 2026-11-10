// Alleen lokale nginx met een synthetische upstream; geen NAS/Cloudflare/live requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { render, routes, TEST_API_HOST } from '../scripts/native/render-test-api-proxy.mjs';
const docker = (...args) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding:'utf8', env:{...process.env,DOCKER_CONTEXT:'',DOCKER_HOST:'unix:///var/run/docker.sock'}, stdio:['ignore','pipe','pipe'] }).trim();
const root = mkdtempSync(join(tmpdir(),'versado-api-edge-'));
let container;
try {
  const base = readFileSync('deploy/nginx/nginx.conf','utf8');
  assert.ok(render(base).startsWith(base.trimEnd().slice(0,-1))); // websiteconfiguratie blijft behouden.
  const mock = `server { listen 3000; location / { default_type application/json; add_header Set-Cookie "forbidden=1"; return 200 '{"cookie":"$http_cookie","cf":"$http_cf_access_client_secret","authorization":"$http_authorization","range":"$http_range","host":"$http_host"}'; } }`;
  writeFileSync(join(root,'nginx.conf'),render(base).trimEnd().slice(0,-1)+mock+'}\n');
  container = docker('run','-d','--rm','--add-host','jehova-app:127.0.0.1','-p','127.0.0.1::8081','-v',`${root}/nginx.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine');
  const port = Number(docker('port',container,'8081/tcp').split(':').at(-1));
  const request = (path,method='GET',headers={}) => new Promise((resolve,reject) => {
    const req=http.request({hostname:'127.0.0.1',port,path,method,headers:{Host:TEST_API_HOST,Origin:'capacitor://localhost',...headers}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.end();
  });
  for(let i=0;i<50;i++){try{await request('/');break;}catch(e){if(i===49)throw e;await new Promise(r=>setTimeout(r,100));}}
  let count=0;
  const check=async(path,status,method='GET',headers={})=>{const r=await request(path,method,headers);assert.equal(r.status,status,`${method} ${path}: ${r.body}`);assert.equal(r.headers['x-robots-tag'],'noindex, nofollow, noarchive');count++;return r;};
  for(const path of ['/','/adminbackend','/api/health','/__maintenance-probe','/api/auth/login','/api/v1/native/diagnostics','/api/v1/native/capabilities/extra','/api/v1/native/capabilities?token=secret','/api/v1/native/%63apabilities','/x/../api/v1/native/capabilities','/api//v1/native/capabilities','/socket.io/?EIO=4&transport=websocket&token=secret'])await check(path,404);
  await check('/api/v1/native/capabilities',403,'GET',{Origin:'https://dev.versado.app'});
  await check('/api/v1/native/capabilities',404,'GET',{Host:'dev.versado.app'});
  await check('/api/v1/native/capabilities',404,'DELETE');
  for(const [path,method] of [['capabilities','GET'],['login','POST'],['refresh','POST'],['logout','POST'],['account','DELETE'],['courses/c/read/chapters/ch/audio/playback','GET'],[`courses/c/read/chapters/ch/audio/${'a'.repeat(64)}/stream`,'GET'],['realtime/session','POST']])await check('/api/v1/native/'+path,200,method);
  const r=await check('/api/v1/native/capabilities',200,'GET',{Cookie:'web-session=secret','CF-Access-Client-Secret':'secret',Authorization:'Bearer synthetic',Range:'bytes=0-9','X-Forwarded-Host':'dev.versado.app'});
  assert.deepEqual(JSON.parse(r.body),{cookie:'',cf:'',authorization:'Bearer synthetic',range:'bytes=0-9',host:TEST_API_HOST});assert.equal(r.headers['set-cookie'],undefined);
  await check('/socket.io/?EIO=4&transport=websocket',200);
  await check('/socket.io/?EIO=4&transport=polling',404);
  assert.ok(routes.length>8);
  console.log(`${count} echte nginx-verzoeken geslaagd; website behouden, routes/methoden/headers/encoding begrensd. Geen echte backendauthenticatie of WebSocket-upgrade geclaimd.`);
} finally { if(container)docker('rm','-f',container);rmSync(root,{recursive:true,force:true}); }
