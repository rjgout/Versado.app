// Alleen eigen wegwerp-PostgreSQL; de vastgelegde main-commit is het echte upgradebeginpunt.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
const baseline = '29252462f0628329b006072dcb59315d216212be';
const container = `versado-main-upgrade-${randomUUID()}`;
const work = mkdtempSync(join(tmpdir(), 'versado-main-upgrade-'));
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete dockerEnv[key];
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw Error(`${command}: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const docker = args => run('docker', ['--host=unix:///var/run/docker.sock', ...args], dockerEnv).trim();
const archive = join(work, 'main.tar');
run('git', ['archive', '--output', archive, baseline, 'prisma/migrations', 'prisma/schema.prisma']);
run('tar', ['-xf', archive, '-C', work]);
const mainMigrations = readdirSync(join(work, 'prisma/migrations')).filter(n => n !== 'migration_lock.toml').sort();
const currentMigrations = readdirSync('prisma/migrations').filter(n => n !== 'migration_lock.toml').sort();
for (const name of mainMigrations) assert.equal(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'), readFileSync(join(work, `prisma/migrations/${name}/migration.sql`), 'utf8'), `Bestaande migratie gewijzigd: ${name}`);
const added = currentMigrations.filter(n => !mainMigrations.includes(n));
assert.deepEqual(added, ['20261127120000_native_security_setup', '20261203120000_live_quiz_actions']);
assert.ok(added.every(n => n > mainMigrations.at(-1)));
let client;
try {
  docker(['run','--rm','-d','--name',container,'-e','POSTGRES_PASSWORD=synthetic-only','-e','POSTGRES_DB=versado_main_upgrade_test','-p','127.0.0.1::5432','postgres:16-alpine']);
  let ready = false;
  for (let i=0; i<60; i++) { try { docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres']); ready=true; break; } catch {} await delay(250); }
  assert.ok(ready);
  const port = docker(['port',container,'5432/tcp']).split(':').at(-1);
  const url = `postgresql://postgres:synthetic-only@127.0.0.1:${port}/versado_main_upgrade_test`;
  const env = { ...process.env, DATABASE_URL: url };
  const config = join(work, 'prisma.config.ts');
  writeFileSync(config, `export default ${JSON.stringify({schema:join(work,'prisma/schema.prisma'), migrations:{path:join(work,'prisma/migrations')},datasource:{url}})}`);
  run('npx',['prisma','migrate','deploy','--config',config],env);
  client = new pg.Client({connectionString:url}); await client.connect();
  await client.query(`INSERT INTO "User" (id,email,handle,discriminator,"passwordHash","xpTotal","hintBalance") VALUES ('preserved','preserved@example.invalid','Bewaar','01','synthetic',71,9)`);
  await client.query(`INSERT INTO "StreakDay" (id,"userId","dayKey",status) VALUES ('day','preserved','2026-10-22','STUDIED')`);
  await client.query(`INSERT INTO "StreakActivity" (id,"userId",key) VALUES ('activity','preserved','live:historic')`);
  await client.query(`INSERT INTO "LiveGame" (id,code,"hostId",status) VALUES ('game','UPGRADE','preserved','FINISHED')`);
  await client.query(`INSERT INTO "LiveGamePlayer" (id,"gameId","userId",score) VALUES ('player','game','preserved',123)`);
  const tables = (await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name!='_prisma_migrations' ORDER BY table_name`)).rows;
  const fields = new Map();
  const q = value => '"'+value.replaceAll('"','""')+'"';
  for (const {table_name:name} of tables) fields.set(name,(await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,[name])).rows.map(r=>r.column_name));
  async function snapshot() { const result={}; for(const [name,columns] of fields) result[name]=(await client.query(`SELECT ${columns.map(q)} FROM ${q(name)}`)).rows.map(r=>JSON.stringify(r)).sort(); return result; }
  const before = await snapshot();
  const baselineDrift = run('npx',['prisma','migrate','diff','--config',config,'--from-config-datasource','--to-schema',join(work,'prisma/schema.prisma')],env);
  console.log('Bestaande main-schema-afwijkingen:',baselineDrift);
  run('npx',['prisma','migrate','deploy'],env);
  run('npx',['prisma','migrate','deploy'],env);
  assert.deepEqual(await snapshot(),before);
  const upgraded = (await client.query(`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows;
  assert.equal(run('npx',['prisma','migrate','diff','--from-config-datasource','--to-schema',resolve('prisma/schema.prisma')],env),baselineDrift,'Upgrade introduceert nieuwe schema-afwijking');
  await client.query('CREATE DATABASE versado_main_fresh_test');
  const freshEnv={...env,DATABASE_URL:url.replace('versado_main_upgrade_test','versado_main_fresh_test')};
  run('npx',['prisma','migrate','deploy'],freshEnv);
  run('npx',['prisma','migrate','deploy'],freshEnv);
  assert.equal(run('npx',['prisma','migrate','diff','--from-config-datasource','--to-schema',resolve('prisma/schema.prisma')],freshEnv),baselineDrift,'Verse installatie wijkt af van main-baseline');
  const fresh = new pg.Client({connectionString:freshEnv.DATABASE_URL}); await fresh.connect();
  try { assert.deepEqual((await fresh.query(`SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`)).rows,upgraded); } finally { await fresh.end(); }
  console.log(JSON.stringify({baseline,unchangedTables:tables.length,preserved:['XP','hintBalance','StreakDay','StreakActivity','LiveGame','LiveGamePlayer'],added,freshInstall:true,repeatedDeploy:true,newSchemaDrift:false}));
} finally { if(client) await client.end(); try { docker(['rm','-f',container]); } catch {} }
