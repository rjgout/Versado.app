// Alleen de eigen wegwerpdatabase; alle oudere tabellen byte-identiek vergelijken.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? 'http://invalid');
if (url.hostname !== '127.0.0.1' || url.pathname !== '/versado_content_access_test' || process.env.DATABASE_URL !== url.href) throw new Error('Uitsluitend eigen studiecontext-testdatabase');
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const sql = readFileSync('prisma/migrations/20261021120000_user_study_context/migration.sql','utf8');
const state = `${process.env.CONTENT_MIGRATION_TEST_STATE}.study`;
async function fingerprint() {
  const tables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('_prisma_migrations','UserStudyContext') ORDER BY tablename`)).rows;
  const proof = {};
  for (const {tablename} of tables) proof[tablename] = (await db.query(`SELECT count(*)::int AS count, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${tablename.replaceAll('"','""')}" t`)).rows[0];
  return proof;
}
try {
  if (process.argv[2] === 'prepare') {
    const before = await fingerprint();
    assert.equal((await db.query(`SELECT to_regclass('"UserStudyContext"') AS present`)).rows[0].present,null);
    await db.query('BEGIN'); await db.query(sql); await assert.rejects(db.query('SELECT 1/0')); await db.query('ROLLBACK');
    assert.deepEqual(await fingerprint(),before);
    assert.equal((await db.query(`SELECT to_regclass('"UserStudyContext"') AS present`)).rows[0].present,null);
    await db.query('BEGIN'); await db.query('CREATE TABLE "UserStudyContext" (conflict text)');
    await assert.rejects(db.query(sql), /STUDY_CONTEXT_REVIEW_REQUIRED/); await db.query('ROLLBACK');
    assert.deepEqual(await fingerprint(),before);
    writeFileSync(state,JSON.stringify(before),{mode:0o600});
  } else {
    const before = JSON.parse(readFileSync(state,'utf8'));
    assert.deepEqual(await fingerprint(),before);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "UserStudyContext"')).rows[0].n,0,'Geen backfill');
    await db.query(sql); await db.query(sql);
    assert.deepEqual(await fingerprint(),before);
    await db.query('BEGIN');
    await db.query(`INSERT INTO "ContentWork" VALUES ('context-restrict-fixture','STUDY_PROGRAM')`);
    await db.query(`INSERT INTO "UserStudyContext"("userId","workKey","lastActionId","updatedAt") VALUES ('m-user-1','context-restrict-fixture','test',now())`);
    await assert.rejects(db.query(`DELETE FROM "ContentWork" WHERE key='context-restrict-fixture'`),e=>e.code==='23503');
    await db.query('ROLLBACK');
    assert.deepEqual(await fingerprint(),before);
    console.log(JSON.stringify({studyContextMigration:'passed',preservedTables:Object.keys(before).length,noBackfill:true,repeatSQL:true,abortAndConflictRollback:true,workDeleteRestricted:true,productionMutation:false}));
  }
} finally { await db.end(); }
