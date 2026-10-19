// De bestaande productie-testserver, met uitsluitend een eigen lokale wegwerpdatabase.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
const container=`versado-dorp-${randomUUID()}`;
const dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
function docker(args){const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'Lokale Docker mislukt');return r.stdout.trim();}
function run(cmd,args,env){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env,stdio:'inherit'});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(`${cmd} stopte met ${c}`)));});}
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
let server,volumes=[];
try{
 docker(['run','--rm','-d','--name',container,'-p','127.0.0.1::5432','-e','POSTGRES_USER=dorp_test','-e','POSTGRES_PASSWORD=isolated_only','-e','POSTGRES_DB=versado_content_access_test','postgres:16-alpine']);
 volumes=JSON.parse(docker(['inspect',container]))[0].Mounts.filter(m=>m.Type==='volume').map(m=>m.Name);
 let ready=false;for(let i=0;i<60;i++){try{docker(['exec',container,'pg_isready','-U','dorp_test']);ready=true;break;}catch{await delay(500);}}
 if(!ready)throw Error('Lokale wegwerpdatabase niet gestart');
 const dbPort=docker(['port',container,'5432/tcp']).split(':').at(-1);
 const database=`postgresql://dorp_test:isolated_only@127.0.0.1:${dbPort}/versado_content_access_test`;
 const base=`http://127.0.0.1:${port}`;
 const env={...process.env,DATABASE_URL:database,CONTENT_ACCESS_TEST_DATABASE_URL:database,CONTENT_ACCESS_TEST_BASE_URL:base,DORP_TEST_DATABASE_URL:database,DORP_TEST_BASE_URL:base,APP_URL:base,SESSION_SECRET:'isolated-dorp-session-secret-only',VERSADO_DORP_PROTOTYPE_ENABLED:'true',REDIS_URL:'',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'};
 await run('npx',['prisma','migrate','deploy'],env);
 await run('npx',['prisma','migrate','deploy'],env);
 server=spawn('node',['scripts/content-architecture/test-server.mjs'],{env,stdio:'inherit',detached:true});
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok){healthy=true;break;}}catch{}if(server.exitCode!==null)throw Error('Testserver gestopt');await delay(500);}
 if(!healthy)throw Error('Productiebuild niet bereikbaar');
 if(!process.argv.includes('--prototype-only'))await run('npx',['tsx','--test','tests/dorp-server.integration.test.ts'],env);
 if(process.argv.includes('--browser'))await run('npx',['tsx','tests/dorp.browser.mjs'],env);
}finally{
 if(server){try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([new Promise(r=>server.once('exit',r)),delay(5000)]);}
 try{docker(['stop',container]);}catch{}
 for(const volume of volumes)try{docker(['volume','rm',volume]);}catch{}
}
