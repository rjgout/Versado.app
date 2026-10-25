// Alleen eigen wegwerpcontainers; leest geen productie-URL of Docker-context.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
const clean = {...process.env};
for (const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete clean[k];
function docker(args) { const r = spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:clean,encoding:'utf8'}); if(r.status) throw new Error(r.stderr); return r.stdout.trim(); }
async function run(cmd,args,env) { await new Promise((ok,no)=>{const child=spawn(cmd,args,{env,stdio:'inherit'});child.on('error',no);child.on('exit',code=>code===0?ok():no(new Error(`${cmd}: ${code}`)));}); }
async function port(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
const name='versado-audio-test-'+randomUUID().slice(0,8), redis=name+'-redis';
const temp=mkdtempSync(join(tmpdir(),'versado-audio-test-'));
let server; const volumes=[];
try {
 docker(['info','--format','{{.ServerVersion}}']);
 docker(['run','--rm','-d','--name',name,'-p','127.0.0.1::5432','-e','POSTGRES_USER=audio_test','-e','POSTGRES_PASSWORD=audio_test','-e','POSTGRES_DB=versado_audio_test','postgres:16-alpine']);
 volumes.push(...JSON.parse(docker(['inspect',name]))[0].Mounts.filter(x=>x.Type==='volume').map(x=>x.Name));
 docker(['run','--rm','-d','--name',redis,'-p','127.0.0.1::6379','redis:7-alpine']);
 let ready=false;for(let i=0;i<60;i++){try{docker(['exec',name,'pg_isready','-U','audio_test']);ready=true;break;}catch{await delay(500);}}
 if(!ready) throw new Error('Eigen testdatabase niet gereed');
 const dbPort=docker(['port',name,'5432/tcp']).split(':').at(-1),redisPort=docker(['port',redis,'6379/tcp']).split(':').at(-1);
 const url=`postgresql://audio_test:audio_test@127.0.0.1:${dbPort}/versado_audio_test`,base=`http://127.0.0.1:${await port()}`;
 const audio=join(temp,'audio');mkdirSync(audio,{mode:0o700});
 const env={...process.env,NODE_ENV:'production',DATABASE_URL:url,AUDIO_TEST_DATABASE_URL:url,AUDIO_TEST_ROOT:audio,AUDIO_DIR:audio,APP_URL:base,AUDIO_TEST_BASE_URL:base,REDIS_URL:`redis://127.0.0.1:${redisPort}`,SESSION_SECRET:'isolated-audio-tests-only-secret',ALLOW_INSECURE_COOKIES:'true',NEXT_TELEMETRY_DISABLED:'1'};
 const require=createRequire(import.meta.url), migrations=join(temp,'migrations');mkdirSync(migrations);
 for(const entry of readdirSync('prisma/migrations')) if(!['20261204120000_audio_library_v2','20261127120000_content_beheer_v2'].includes(entry)) cpSync(join('prisma/migrations',entry),join(migrations,entry),{recursive:true});
 const config=join(temp,'prisma.config.mjs');writeFileSync(config,`import {defineConfig} from ${JSON.stringify(require.resolve('prisma/config'))};export default defineConfig({schema:${JSON.stringify(resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}});`);
 await run('npx',['prisma','migrate','deploy','--config',config],env);
 await run('npx',['tsx','tests/audio-migration.ts','prepare'],env);
 cpSync('prisma/migrations/20261204120000_audio_library_v2',join(migrations,'20261204120000_audio_library_v2'),{recursive:true});
 await run('npx',['prisma','migrate','deploy','--config',config],env);
 await run('npx',['tsx','tests/audio-migration.ts','verify'],env);
 // PR #187 moet ook veilig kunnen volgen op een al toegepaste Audio V2-migratie (#194).
 if(readdirSync('prisma/migrations').includes('20261127120000_content_beheer_v2')) {
  cpSync('prisma/migrations/20261127120000_content_beheer_v2',join(migrations,'20261127120000_content_beheer_v2'),{recursive:true});
  await run('npx',['prisma','migrate','deploy','--config',config],env);
  await run('npx',['tsx','tests/audio-migration.ts','verify-contentchecks'],env);
 }
 await run('npx',['tsx','--test','--test-concurrency=1','tests/audio-library.integration.test.ts'],env);
 if(process.argv.includes('--official')) {
   // Echte bestanden alleen in deze aantoonbaar eigen DB/volume; nooit automatisch publiceren.
   await run('npx',['tsx','tests/audio-official-registration.ts','prepare'],env);
   await run('npx',['tsx','scripts/audio/import-official.ts','.audio-v2-work'],env);
   await run('npx',['tsx','tests/audio-official-registration.ts'],env);
 }
 if(process.argv.includes('--browser')) {
  const p=new URL(base).port;server=spawn('npx',['tsx','server.ts'],{env:{...env,PORT:p},detached:true,stdio:['ignore','pipe','pipe']});
  const log=join(temp,'server.log');server.stdout.on('data',d=>{writeFileSync(log,d,{flag:'a'});});server.stderr.on('data',d=>{writeFileSync(log,d,{flag:'a'});});
  let online=false;for(let i=0;i<240;i++){try{if((await fetch(base+'/api/health')).ok){online=true;break;}}catch{}await delay(500);}
  if(!online)throw new Error(readFileSync(log,'utf8').slice(-8000));
  await run('npx',['tsx','tests/audio-library.browser.mjs'],env);
 }
 console.log('Audio: geïsoleerde controles voltooid; geen productie/NAS gebruikt.');
} finally {
 if(server?.pid){try{process.kill(-server.pid,'SIGTERM');}catch{}}
 for(const n of [redis,name])try{docker(['rm','-f',n]);}catch{}
 for(const v of volumes)try{docker(['volume','rm',v]);}catch{}
 rmSync(temp,{recursive:true,force:true});
}
