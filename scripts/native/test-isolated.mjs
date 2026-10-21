// Alleen eigen PostgreSQL, bestaande productieroute-testserver; geen scheduler/seed/NAS.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
import {mkdtempSync,cpSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import pg from 'pg';
const container=`versado-native-${randomUUID()}`,dockerEnv={...process.env};
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete dockerEnv[key];
function docker(args){const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:dockerEnv,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'Lokale Docker mislukt');return r.stdout.trim();}
function run(cmd,args,env){return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env,stdio:'inherit'});p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(Error(`${cmd} stopte met ${c}`)));});}
const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
let server;
try{
 docker(['run','--rm','-d','--name',container,'-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=versado_content_access_test','-p','127.0.0.1::5432','postgres:16-alpine']);
 let ready=false;for(let i=0;i<60;i++){try{docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']);ready=true;break;}catch{}await delay(250);}if(!ready)throw Error('Eigen Postgres start niet');
 const dbPort=docker(['port',container,'5432/tcp']).split(':').at(-1),db=`postgresql://postgres:synthetic-only@127.0.0.1:${dbPort}/versado_content_access_test`,base=`http://127.0.0.1:${port}`;
 const env={...process.env,DATABASE_URL:db,CONTENT_ACCESS_TEST_DATABASE_URL:db,CONTENT_ACCESS_TEST_BASE_URL:base,NATIVE_TEST_DATABASE_URL:db,LEARNING_TEST_DATABASE_URL:db,NATIVE_TEST_BASE_URL:base,APP_URL:base,SESSION_SECRET:'native-isolated-web-secret-at-least-32-chars',NATIVE_SESSION_SECRET:'native-isolated-only-secret-at-least-32-chars',NATIVE_API_ENABLED:'1',APPLE_SIGN_IN_ENABLED:'1',APPLE_TEAM_ID:'TESTTEAM01',APPLE_IOS_CLIENT_ID:'app.versado.synthetic',NODE_ENV:'production'};
 // Gecontroleerde oude database: alle bestaande migraties zonder nieuwe auth-DDL.
 const migration='20261125120000_native_auth_foundation',work=mkdtempSync(join(tmpdir(),'versado-native-')),path=join(work,'migrations');
 cpSync('prisma/migrations',path,{recursive:true,filter:src=>!src.endsWith(migration)&&!src.includes(`${migration}/`)});
 const config=join(work,'prisma.config.ts');writeFileSync(config,`export default ${JSON.stringify({schema:resolve('prisma/schema.prisma'),migrations:{path},datasource:{url:db}})}`);
 await run('npx',['prisma','migrate','deploy','--config',config],env);
 const client=new pg.Client({connectionString:db});await client.connect();
 try{
  await client.query(`INSERT INTO "User" (id,email,handle,discriminator,"passwordHash") VALUES ('native-preserved','preserved@example.invalid','Bewaar','01','synthetic-hash')`);
  const tables=(await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name!='_prisma_migrations' ORDER BY table_name`)).rows;
  const columns=new Map();for(const {table_name}of tables)columns.set(table_name,(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[table_name])).rows.map(r=>r.column_name));
  const quoted=value=>'"'+value.replaceAll('"','""')+'"';
  async function snapshot(){const result={};for(const [name,fields]of columns){const rows=(await client.query(`SELECT ${fields.map(quoted).join(',')} FROM ${quoted(name)}`)).rows;result[name]=rows.map(r=>JSON.stringify(r)).sort();}return result;}
  const before=await snapshot(),constraints=(await client.query(`SELECT conname,conrelid::regclass::text AS tablename,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname`)).rows;
  const sql=readFileSync(`prisma/migrations/${migration}/migration.sql`,'utf8');
  await assert.rejects(client.query(sql.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;')));await client.query('ROLLBACK');assert.deepEqual(await snapshot(),before);
  await run('npx',['prisma','migrate','deploy'],env);await run('npx',['prisma','migrate','deploy'],env);
  assert.deepEqual(await snapshot(),before);
  const after=(await client.query(`SELECT conname,conrelid::regclass::text AS tablename,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conname`)).rows;
  for(const row of constraints)assert.ok(after.some(r=>JSON.stringify(r)===JSON.stringify(row)));
  assert.equal((await client.query(`SELECT "passwordLoginEnabled" FROM "User" WHERE id='native-preserved'`)).rows[0].passwordLoginEnabled,true);
  console.log('Native migratiebehoud:',JSON.stringify({unchangedTables:tables.length,unchangedConstraints:constraints.length,faultRollback:true,repeatedDeploy:true}));
 }finally{await client.end();}
 server=spawn('node',['scripts/content-architecture/test-server.mjs'],{env,stdio:'inherit',detached:true});
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok){healthy=true;break;}}catch{}if(server.exitCode!==null)throw Error('Testserver gestopt');await delay(500);}if(!healthy)throw Error('Productiebuild niet bereikbaar');
 await run('npx',['tsx','--test','--test-concurrency=1','tests/native-foundation.integration.test.ts','tests/registration.integration.test.ts'],env);
 if(!process.argv.includes('--no-browser'))await run('npx',['tsx','tests/native-foundation.browser.mjs'],env);
}finally{
 if(server){try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([new Promise(r=>server.once('exit',r)),delay(5000)]);}
 try{docker(['stop',container]);}catch{}
}
