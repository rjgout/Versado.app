// Alleen de bestaande geïsoleerde migratierunner; geen productieverbinding.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
const raw=process.env.CONTENT_ACCESS_TEST_DATABASE_URL, url=new URL(raw ?? 'http://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/versado_content_access_test'||process.env.DATABASE_URL!==raw)throw Error('Eigen testdatabase vereist');
const db=new pg.Client({connectionString:raw});await db.connect();
const file=process.env.CONTENT_MIGRATION_TEST_STATE+'.hymns-visibility';
const quote=v=>'"'+v.replaceAll('"','""')+'"';
async function hash(table, columns){return (await db.query(`SELECT md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM (SELECT ${columns.map(quote).join(',')} FROM ${quote(table)}) t`)).rows[0].hash;}
try {
 if(process.argv[2]==='prepare'){
  await db.query(`INSERT INTO "ContentSwitcherSettings" (id,enabled) VALUES ('singleton',true) ON CONFLICT (id) DO UPDATE SET enabled=true`);
  const columns=(await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`)).rows;
  const tables={}; for(const row of columns)(tables[row.table_name]??=[]).push(row.column_name);
  const snapshots=[];for(const [table,columns] of Object.entries(tables))snapshots.push({table,columns,hash:await hash(table,columns)});
  writeFileSync(file,JSON.stringify(snapshots),{mode:0o600});
 }else{
  const snapshots=JSON.parse(readFileSync(file,'utf8'));
  for(const s of snapshots)assert.equal(await hash(s.table,s.columns),s.hash,`${s.table}: bestaande rijinhoud behouden`);
  const row=(await db.query(`SELECT enabled,"hymnsVisibleToUsers" FROM "ContentSwitcherSettings" WHERE id='singleton'`)).rows[0];
  assert.equal(row.enabled,true);assert.equal(row.hymnsVisibleToUsers,false);
  await db.query('BEGIN');await db.query(`UPDATE "ContentSwitcherSettings" SET enabled=false WHERE id='singleton'`);
  await assert.rejects(db.query(`ALTER TABLE "ContentSwitcherSettings" ADD COLUMN "hymnsVisibleToUsers" BOOLEAN NOT NULL DEFAULT false`),e=>e.code==='42701');
  await db.query('ROLLBACK');
  assert.equal((await db.query(`SELECT enabled FROM "ContentSwitcherSettings" WHERE id='singleton'`)).rows[0].enabled,true);
  console.log(JSON.stringify({hymnsVisibilityMigration:'passed',preservedTables:snapshots.length,existingSwitcherEnabledPreserved:true,newActivityDefaultHidden:true,conflictRollback:true,productionTouched:false}));
 }
}finally{await db.end();}
