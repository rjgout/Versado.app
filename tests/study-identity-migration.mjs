import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen wegwerpdatabase vereist");
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const file = `${process.env.CONTENT_MIGRATION_TEST_STATE}.study-identity.json`;
const sql = readFileSync("prisma/migrations/20261029120000_study_identity/migration.sql", "utf8");
const newTables = ["StudyPeriod", "StudyLesson", "StudyLessonEdition", "StudyRevision"];
async function proof() {
  const tables = {};
  for (const { tablename } of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows) {
    if (newTables.includes(tablename)) continue;
    const table = `"${tablename.replaceAll('"','""')}"`;
    tables[tablename] = (await db.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${table} t`)).rows[0];
  }
  const constraints = (await db.query(`SELECT c.conname, c.conrelid::regclass::text AS relation, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() AND c.contype IN ('f','p','u') ORDER BY c.conname,c.conrelid::regclass::text`)).rows.filter(c=>!newTables.some(t=>c.relation===`"${t}"`));
  const indexes = (await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname <> 'ContentCollection_id_work_key' ORDER BY tablename,indexname`)).rows.filter(i=>!newTables.includes(i.tablename));
  return { tables, constraints, indexes };
}
async function absent() { for(const table of newTables)assert.equal((await db.query('SELECT to_regclass($1) AS name',[`"${table}"`])).rows[0].name,null); }
try {
 if(process.argv[2]==="prepare") {
  await db.query(`INSERT INTO "UserStudyContext"("userId","workKey","activeLessonKey",version,"lastActionId","updatedAt") VALUES ('m-user-28','fsy','fsy:m-fsy-1',4,'existing-fsy-choice','2026-10-11')`);
  const before=await proof(); await absent();
  await db.query('BEGIN');await db.query(sql);await assert.rejects(db.query('SELECT 1/0'));await db.query('ROLLBACK');await absent();assert.deepEqual(await proof(),before);
  await db.query('BEGIN');await db.query('CREATE TABLE "StudyRevision"(id text)');await assert.rejects(db.query(sql),/STUDY_IDENTITY_REVIEW_REQUIRED/);await db.query('ROLLBACK');await absent();assert.deepEqual(await proof(),before);
  // Fout halverwege de DDL, niet alleen vóór het eerste CREATE: alles rolt terug.
  await db.query('BEGIN');await db.query('CREATE INDEX "StudyLessonEdition_collectionId_slug_key" ON "User"(id)');await assert.rejects(db.query(sql),e=>e.code==='42P07');await db.query('ROLLBACK');await absent();assert.deepEqual(await proof(),before);
  const blocker=new pg.Client({connectionString:url.href});await blocker.connect();await blocker.query('BEGIN; LOCK TABLE "ContentCollection" IN ACCESS EXCLUSIVE MODE');
  try {await assert.rejects(db.query(sql),e=>e.code==='55P03');}finally{await blocker.query('ROLLBACK');await blocker.end();}await absent();assert.deepEqual(await proof(),before);
  writeFileSync(file,JSON.stringify(before),{mode:0o600});
 }else{
  const before=JSON.parse(readFileSync(file,'utf8')),after=await proof();assert.deepEqual(after.tables,before.tables);assert.deepEqual(after.constraints,before.constraints);assert.deepEqual(after.indexes,before.indexes);
  for(const table of newTables)assert.equal((await db.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n,0);
  await assert.rejects(db.query(sql),/STUDY_IDENTITY_REVIEW_REQUIRED/);assert.deepEqual(await proof(),before);
  console.log(JSON.stringify({ studyIdentityMigration:"passed", preservedTables:Object.keys(before.tables).length,preservedConstraints:before.constraints.length,preservedIndexes:before.indexes.length,
    dynamicTableCount:true, fsyContentContextCoursesAndEconomyByteIdentical:true, noBackfill:true, atomicMidMigrationFailure:true,lockTimeoutRollback:true,productionTouched:false }));
 }
}finally{await db.end();}
