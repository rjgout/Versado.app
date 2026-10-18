// Alleen synthetische gegevens in de eigen wegwerpdatabase. Geen vaste telling van oude schemaobjecten.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/versado_content_access_test' || process.env.DATABASE_URL !== url.href) throw Error('Eigen testdatabase vereist');
const db = new pg.Client({connectionString: url.href}); await db.connect();
const file = process.env.CONTENT_MIGRATION_TEST_STATE + '.fsy';
const sql = readFileSync('prisma/migrations/20261118120000_fsy_study_handover/migration.sql','utf8');
const q = v => '"'+v.replaceAll('"','""')+'"';
async function digest(table, columns) {return (await db.query(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM (SELECT ${columns.map(q).join(',')} FROM ${q(table)}) t`)).rows[0].hash;}
async function objects() {return (await db.query(`SELECT 'constraint' kind, conname name, pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace='public'::regnamespace UNION ALL SELECT 'index',indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY kind,name,definition`)).rows;}
try {
 if(process.argv[2]==='prepare') {
  const cols=(await db.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position`)).rows;
  const tables={};for(const c of cols)(tables[c.table_name]??=[]).push(c.column_name);
  const snapshots=[];for(const [table,columns] of Object.entries(tables))snapshots.push({table,columns,hash:await digest(table,columns)});
  const oldObjects=await objects();
  // Een naamconflict na ADD COLUMN mag geen gedeeltelijke wijziging nalaten.
  await assert.rejects(db.query(sql.replace('CREATE UNIQUE INDEX "FsyLesson_studyLessonEditionId_key"','CREATE UNIQUE INDEX "FsyLesson_contentCollectionId_sourceUrl_key"')),e=>e.code==='42P07');
  await db.query('ROLLBACK');
  assert.equal((await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='FsyLesson' AND column_name='studyLessonEditionId'`)).rows[0].n,0);
  for(const s of snapshots)assert.equal(await digest(s.table,s.columns),s.hash,s.table);
  writeFileSync(file,JSON.stringify({snapshots,oldObjects}),{mode:0o600});
 } else {
  const {snapshots,oldObjects}=JSON.parse(readFileSync(file,'utf8'));
  for(const s of snapshots)assert.equal(await digest(s.table,s.columns),s.hash,s.table);
  const now=await objects();for(const o of oldObjects)assert.ok(now.some(n=>JSON.stringify(n)===JSON.stringify(o)),o.name);
  assert.equal((await db.query(`SELECT count(*)::int n FROM "FsyLesson" WHERE "studyLessonEditionId" IS NOT NULL`)).rows[0].n,0);
  assert.ok(now.some(o=>o.name==='FsyLesson_studyLessonEditionId_fkey'));
  console.log(JSON.stringify({fsyMigration:'passed',preservedTables:snapshots.length,preservedSchemaObjects:oldObjects.length,noBackfill:true,oldRowsTimestampsAndPointersIdentical:true,conflictRollbackAtomic:true}));
 }
} finally {await db.end();}
