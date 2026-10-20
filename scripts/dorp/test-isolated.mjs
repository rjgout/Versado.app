// De bestaande productie-testserver, met uitsluitend een eigen lokale wegwerpdatabase.
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from 'node:net';
import {mkdtempSync,cpSync,readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
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
 const env={...process.env,DATABASE_URL:database,CONTENT_ACCESS_TEST_DATABASE_URL:database,CONTENT_ACCESS_TEST_BASE_URL:base,DORP_TEST_DATABASE_URL:database,LEARNING_TEST_DATABASE_URL:database,DORP_TEST_BASE_URL:base,APP_URL:base,SESSION_SECRET:'isolated-dorp-session-secret-only',VERSADO_DORP_PROTOTYPE_ENABLED:'true',REDIS_URL:'',NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1'};
 const migration='20261120120000_dorp_worlds';
 if(readdirSync('prisma/migrations').includes(migration)){
  const temporary=mkdtempSync(join(tmpdir(),'versado-dorp-migration-')),migrations=join(temporary,'migrations');
  for(const name of readdirSync('prisma/migrations'))if(name!==migration)cpSync(join('prisma/migrations',name),join(migrations,name),{recursive:true});
  const config=join(temporary,'prisma.config.mjs'),require=createRequire(import.meta.url);
  writeFileSync(config,`import {defineConfig} from ${JSON.stringify(require.resolve('prisma/config'))};export default defineConfig({schema:${JSON.stringify(resolve('prisma/schema.prisma'))},migrations:{path:${JSON.stringify(migrations)}},datasource:{url:process.env.DATABASE_URL}});`);
  await run('npx',['prisma','migrate','deploy','--config',config],env);
  const client=new pg.Client({connectionString:database});await client.connect();
  try{
   await client.query(`INSERT INTO "User" (id,email,handle,discriminator,"passwordHash","xpTotal") VALUES ('dorp-preserve','dorp-preserve@example.invalid','Preserve','01','synthetic',37)`);
   await client.query(`INSERT INTO "XPTransaction" (id,"userId",amount,reason,"createdAt") VALUES ('dorp-preserve-xp','dorp-preserve',37,'ACHIEVEMENT','2026-01-01T00:00:00Z')`);
   await client.query(`
    INSERT INTO "ContentWork" (key,kind) VALUES ('dorp-preserve-work','SCRIPTURE');
    INSERT INTO "ContentCollection" (id,slug,name,icon,work,"publicationState") VALUES ('dorp-preserve-collection','dorp-preserve-collection','Synthetische bron','','dorp-preserve-work','LEGACY');
    INSERT INTO "Book" (id,slug,name,"order","contentCollectionId") VALUES ('dorp-preserve-book','dorp-preserve-book','Synthetisch boek',1,'dorp-preserve-collection');
    INSERT INTO "Chapter" (id,"bookId",number,"order") VALUES ('dorp-preserve-chapter','dorp-preserve-book',1,1);
    INSERT INTO "Verse" (id,"chapterId",number,text) VALUES ('dorp-preserve-verse','dorp-preserve-chapter',1,'Synthetische tekst');
    INSERT INTO "Bookmark" (id,"userId","verseId","targetKey","createdAt") VALUES ('dorp-preserve-bookmark','dorp-preserve','dorp-preserve-verse','verse:dorp-preserve-verse','2026-01-01T00:00:00Z');
    INSERT INTO "Highlight" (id,"userId","verseId","targetKey",color,"createdAt") VALUES ('dorp-preserve-highlight','dorp-preserve','dorp-preserve-verse','verse:dorp-preserve-verse','purple','2026-01-01T00:00:00Z');
    INSERT INTO "Note" (id,"userId","verseId","targetKey",text,"createdAt","updatedAt") VALUES ('dorp-preserve-note','dorp-preserve','dorp-preserve-verse','verse:dorp-preserve-verse','Synthetische persoonlijke tekst','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z');
    INSERT INTO "ContentProgress" (id,"userId","contentKey","lastChapterId","readStatus","baseXpEarned","updatedAt") VALUES ('dorp-preserve-progress','dorp-preserve','chapter:dorp-preserve-chapter','dorp-preserve-chapter','READ',37,'2026-01-02T00:00:00Z');
   `);
   const columns=(await client.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`)).rows;
   const tables=new Map();for(const row of columns)tables.set(row.table_name,[...(tables.get(row.table_name)??[]),row.column_name]);
   const quote=s=>'"'+s.replaceAll('"','""')+'"';
   async function snapshot(){const result={};for(const [table,cols]of tables){const rows=(await client.query('SELECT '+cols.map(quote).join(',')+' FROM '+quote(table))).rows.map(r=>JSON.stringify(r)).sort();result[table]=createHash('sha256').update(JSON.stringify(rows)).digest('hex');}return result;}
   const constraints=(await client.query(`SELECT t.relname AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace='public'::regnamespace ORDER BY t.relname,c.conname`)).rows;
   const indexes=(await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`)).rows;
   const before=await snapshot(),sql=readFileSync(join('prisma/migrations',migration,'migration.sql'),'utf8');
   await assert.rejects(client.query(sql.replace('COMMIT;','SELECT 1/0; COMMIT;')));await client.query('ROLLBACK');
   assert.equal((await client.query(`SELECT to_regclass('"DorpVillage"') AS name`)).rows[0].name,null);
   assert.deepEqual(await snapshot(),before);
   await run('npx',['prisma','migrate','deploy'],env);await run('npx',['prisma','migrate','deploy'],env);
   assert.deepEqual(await snapshot(),before);
   const afterConstraints=(await client.query(`SELECT t.relname AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE c.connamespace='public'::regnamespace ORDER BY t.relname,c.conname`)).rows;
   for(const row of constraints)assert.deepEqual(afterConstraints.find(r=>r.table_name===row.table_name&&r.conname===row.conname),row);
   const afterIndexes=(await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`)).rows;
   for(const row of indexes)assert.deepEqual(afterIndexes.find(r=>r.tablename===row.tablename&&r.indexname===row.indexname),row);
   const objects=(await client.query(`SELECT (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public') AS tables,(SELECT COUNT(*) FROM pg_indexes WHERE schemaname='public') AS indexes,(SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace) AS constraints`)).rows[0];
   console.log('Dorp migratiebewijs:',JSON.stringify({unchangedTables:tables.size,unchangedConstraints:constraints.length,unchangedIndexes:indexes.length,faultRollback:true,repeatedDeploy:true,schemaObjects:objects}));
  }finally{await client.end();}
 }else{await run('npx',['prisma','migrate','deploy'],env);await run('npx',['prisma','migrate','deploy'],env);}
 if(!process.argv.includes('--migration-only')){
 server=spawn('node',['--import','tsx','scripts/dorp/test-server.ts'],{env,stdio:'inherit',detached:true});
 let healthy=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok){healthy=true;break;}}catch{}if(server.exitCode!==null)throw Error('Testserver gestopt');await delay(500);}
 if(!healthy)throw Error('Productiebuild niet bereikbaar');
 if(!process.argv.includes('--prototype-only'))await run('npx',['tsx','--test','--test-concurrency=1','tests/dorp-server.integration.test.ts','tests/dorp-audit.integration.test.ts'],env);
 if(process.argv.includes('--browser')){await run('npx',['tsx','tests/dorp.browser.mjs'],env);await run('npx',['tsx','tests/dorp-privacy.browser.mjs'],env);}
 if(process.argv.includes('--regressions')){await run('npm',['run','test:social'],env);await run('npm',['run','test:profile'],env);await run('npm',['run','test:leagues'],env);await run('npm',['run','test:genees-economy'],env);}
 }
}finally{
 if(server){try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([new Promise(r=>server.once('exit',r)),delay(5000)]);}
 try{docker(['stop',container]);}catch{}
 for(const volume of volumes)try{docker(['volume','rm',volume]);}catch{}
}
