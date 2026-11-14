// Alleen lokale nginx met een synthetische upstream; geen NAS/Cloudflare/live requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { render, routes, TEST_API_HOST } from '../scripts/native/render-test-api-proxy.mjs';
const docker = (...args) => execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { encoding:'utf8', env:{...process.env,DOCKER_CONTEXT:'',DOCKER_HOST:'unix:///var/run/docker.sock'}, stdio:['ignore','pipe','pipe'] }).trim();
const root = mkdtempSync(join(tmpdir(),'versado-api-edge-'));
const suffix=randomUUID(), network=`versado-proxy-${suffix}`, devImage=`versado-proxy-test:${suffix}-dev`, prodImage=`versado-proxy-test:${suffix}-prod`;
const containers=[];
let container;
try {
  const base = readFileSync('deploy/nginx/nginx.conf','utf8');
  assert.ok(render(base).replace('    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;\n','').startsWith(base.trimEnd().slice(0,-1))); // websiteconfiguratie blijft behouden.
  const streamPath=`/api/v1/native/courses/c/read/chapters/ch/audio/${'a'.repeat(64)}/stream`;
  const mock = `server { listen 3000;
    location = ${streamPath} {
      add_header Content-Range $synthetic_content_range always;
      if ($http_range = "bytes=0-9") { return 206 '0123456789'; }
      if ($http_range = "bytes=1000-1009") { return 416 ''; }
      return 200 '';
    }
    location / { default_type application/json; add_header Set-Cookie "forbidden=1"; return 200 '{"cookie":"$http_cookie","cf":"$http_cf_access_client_secret","authorization":"$http_authorization","range":"$http_range","host":"$http_host"}'; } }`;
  // De echte Docker-buildtargets, zonder gemounte nginxconfiguratie in de proxy.
  docker('build','-f','deploy/nginx/Dockerfile','--target','development','-t',devImage,'.');
  docker('build','-f','deploy/nginx/Dockerfile','-t',prodImage,'.'); // Defaulttarget, zoals main.
  assert.equal(docker('run','--rm','--entrypoint','cat',devImage,'/etc/nginx/nginx.conf'),render(base).trim());
  assert.equal(docker('run','--rm','--entrypoint','cat',prodImage,'/etc/nginx/nginx.conf'),base.trim());
  for(const image of [devImage,prodImage]) {
    for(const [source,target] of [['deploy/nginx/maintenance.html','/usr/share/nginx/html/maintenance.html'],['public/mascots/static/family/family-support.webp','/usr/share/nginx/html/maintenance-assets/family-support.webp']]) {
      const expected=createHash('sha256').update(readFileSync(source)).digest('hex');
      assert.equal(docker('run','--rm','--entrypoint','sha256sum',image,target).split(' ')[0],expected);
    }
  }
  writeFileSync(join(root,'upstream.conf'),`events {} http { map $http_range $synthetic_content_range { default ""; "bytes=0-9" "bytes 0-9/100"; "bytes=1000-1009" "bytes */100"; } ${mock} }`);
  docker('network','create',network);
  containers.push(docker('run','-d','--rm','--network',network,'--network-alias','jehova-app','-v',`${root}/upstream.conf:/etc/nginx/nginx.conf:ro`,'nginx:alpine'));
  container = docker('run','-d','--rm','--network',network,'-p','127.0.0.1::8081','-p','127.0.0.1::80',devImage);
  containers.push(container);
  const production=docker('run','-d','--rm','--network',network,'-p','127.0.0.1::80','-p','127.0.0.1::8081',prodImage);
  containers.push(production);
  docker('exec',container,'nginx','-t');docker('exec',production,'nginx','-t');
  const port = Number(docker('port',container,'8081/tcp').split(':').at(-1));
  const request = (path,method='GET',headers={},selectedPort=port) => new Promise((resolve,reject) => {
    const req=http.request({hostname:'127.0.0.1',port:selectedPort,path,method,timeout:3000,headers:{Host:TEST_API_HOST,Origin:'capacitor://localhost',...headers}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Lokale proxy reageert niet')));req.end();
  });
  for(let i=0;i<50;i++){try{await request('/');break;}catch(e){if(i===49)throw e;await new Promise(r=>setTimeout(r,100));}}
  const webPort = Number(docker('port',container,'80/tcp').split(':').at(-1));
  const web = await request('/', 'GET', {Host:'dev.versado.app'}, webPort);
  assert.equal(web.status,200);assert.equal(web.headers['x-robots-tag'],'noindex, nofollow, noarchive');
  const productionPort=Number(docker('port',production,'80/tcp').split(':').at(-1));
  assert.equal((await request('/', 'GET', {Host:'dev.versado.app'}, productionPort)).status,200);
  const closedPort=Number(docker('port',production,'8081/tcp').split(':').at(-1));
  await assert.rejects(request('/', 'GET', {}, closedPort)); // Geen actieve API-listener in de productieimage.
  let count=0;
  const check=async(path,status,method='GET',headers={})=>{const r=await request(path,method,headers);assert.equal(r.status,status,`${method} ${path}: ${r.body}`);assert.equal(r.headers['x-robots-tag'],'noindex, nofollow, noarchive');count++;return r;};
  for(const path of ['/','/adminbackend','/api/health','/__maintenance-probe','/api/auth/login','/api/v1/native/diagnostics','/api/v1/native/capabilities/extra','/api/v1/native/capabilities?token=secret','/api/v1/native/%63apabilities','/x/../api/v1/native/capabilities','/api//v1/native/capabilities','/socket.io/?EIO=4&transport=websocket&token=secret'])await check(path,404);
  await check('/api/v1/native/capabilities',403,'GET',{Origin:'https://dev.versado.app'});
  await check('/api/v1/native/capabilities',404,'GET',{Host:'dev.versado.app'});
  await check('/api/v1/native/capabilities',404,'DELETE');
  for(const [path,method] of [['capabilities','GET'],['login','POST'],['refresh','POST'],['logout','POST'],['account','DELETE'],['courses/c/read/chapters/ch/audio/playback','GET'],[`courses/c/read/chapters/ch/audio/${'a'.repeat(64)}/stream`,'GET'],['realtime/session','POST'],['profile','GET'],['profile','POST'],['profile/two-factor','POST']])await check('/api/v1/native/'+path,200,method);
  for(const [path,method] of [['profile','PATCH'],['profile','DELETE'],['profile/two-factor','GET'],['profile/two-factor/disable','POST'],['profile?userId=other','GET'],['profile%2ftwo-factor','POST']])await check('/api/v1/native/'+path,404,method);
  const r=await check('/api/v1/native/capabilities',200,'GET',{Cookie:'web-session=secret','CF-Access-Client-Secret':'secret',Authorization:'Bearer synthetic',Range:'bytes=0-9','X-Forwarded-Host':'dev.versado.app'});
  assert.deepEqual(JSON.parse(r.body),{cookie:'',cf:'',authorization:'Bearer synthetic',range:'bytes=0-9',host:TEST_API_HOST});assert.equal(r.headers['set-cookie'],undefined);
  await check('/socket.io/?EIO=4&transport=websocket',200);
  await check('/socket.io/?EIO=4&transport=polling',404);
  const range=await check(streamPath,206,'GET',{Range:'bytes=0-9'});
  assert.equal(range.headers['content-range'],'bytes 0-9/100');assert.equal(range.body,'0123456789');
  assert.equal((await check(streamPath,206,'HEAD',{Range:'bytes=0-9'})).body,'');
  assert.equal((await check(streamPath,416,'GET',{Range:'bytes=1000-1009'})).headers['content-range'],'bytes */100');
  for(const c of [container,production]) {docker('exec',c,'mkdir','-p','/flag');docker('exec',c,'touch','/flag/maintenance.on');}
  const maintenance=await request('/', 'GET', {Host:'dev.versado.app'}, webPort);
  const originalMaintenance=await request('/', 'GET', {Host:'dev.versado.app'}, productionPort);
  assert.equal(maintenance.status,originalMaintenance.status);
  assert.equal(maintenance.body,readFileSync('deploy/nginx/maintenance.html','utf8'));
  assert.equal(maintenance.body,originalMaintenance.body);
  assert.equal((await request('/maintenance-assets/family-support.webp','GET',{},webPort)).status,200);
  assert.equal((await request('/maintenance-assets/family-support.webp','GET',{},productionPort)).status,200);
  assert.equal((await request('/__maintenance-probe','GET',{},webPort)).status,200);
  assert.equal((await request('/__maintenance-probe','GET',{},productionPort)).status,200);
  assert.ok(routes.length>8);
  console.log(`${count} echte nginx-verzoeken geslaagd; website behouden, routes/methoden/headers/encoding begrensd. Geen echte backendauthenticatie of WebSocket-upgrade geclaimd.`);
  console.log('Gebouwde DEV: 80 + 8081; standaardproductie: alleen 80. nginx -t, oorspronkelijke productieconfiguratie en onderhouds-/brandingassets gecontroleerd.');
} finally {
  for(const c of containers.reverse()){try{docker('rm','-f',c);}catch{}}
  try{docker('network','rm',network);}catch{}
  for(const image of [devImage,prodImage]){try{docker('image','rm',image);}catch{}}
  rmSync(root,{recursive:true,force:true});
}
