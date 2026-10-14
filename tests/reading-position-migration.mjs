import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const url = new URL(
  process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
);
if (
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/versado_content_access_test" ||
  process.env.DATABASE_URL !== url.href
)
  throw new Error("Eigen wegwerpdatabase vereist");
const db = new pg.Client({ connectionString: url.href });
await db.connect();
const sql = readFileSync(
  "prisma/migrations/20261031120000_reading_position/migration.sql",
  "utf8",
);
const file = `${process.env.CONTENT_MIGRATION_TEST_STATE}.reading.json`;
async function proof() {
  const tables = {};
  for (const { tablename } of (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename NOT IN ('ReadingPosition','_prisma_migrations') ORDER BY tablename",
    )
  ).rows) {
    const name = `"${tablename.replaceAll('"', '""')}"`;
    tables[tablename] = (
      await db.query(
        `SELECT count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${name} t`,
      )
    ).rows[0];
  }
  const constraints = (
    await db.query(
      `SELECT c.conname,c.conrelid::regclass::text relation,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() AND c.conrelid<>'"ReadingPosition"'::regclass ORDER BY c.conname,c.conrelid::regclass::text`.replace(
        `AND c.conrelid<>'"ReadingPosition"'::regclass`,
        `AND c.conrelid NOT IN (SELECT oid FROM pg_class WHERE relname='ReadingPosition')`,
      ),
    )
  ).rows;
  const indexes = (
    await db.query(
      `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND tablename<>'ReadingPosition' ORDER BY tablename,indexname`,
    )
  ).rows;
  const triggers = (
    await db.query(
      `SELECT t.tgname,t.tgrelid::regclass::text relation,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND c.relname<>'ReadingPosition' ORDER BY t.tgname,c.relname`,
    )
  ).rows;
  const functions = (
    await db.query(
      `SELECT p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname<>'validate_reading_position_anchor' ORDER BY p.proname,p.oid`,
    )
  ).rows;
  const columns = (
    await db.query(
      `SELECT table_name,column_name,ordinal_position,data_type,udt_name,column_default,is_nullable,character_maximum_length,numeric_precision FROM information_schema.columns WHERE table_schema=current_schema() AND table_name NOT IN ('ReadingPosition','_prisma_migrations') ORDER BY table_name,ordinal_position`,
    )
  ).rows;
  const enums = (
    await db.query(
      `SELECT t.typname,array_agg(e.enumlabel ORDER BY e.enumsortorder) labels FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname=current_schema() GROUP BY t.typname ORDER BY t.typname`,
    )
  ).rows;
  const sequences = (
    await db.query(
      `SELECT sequencename,data_type,start_value,min_value,max_value,increment_by,cycle,cache_size,last_value FROM pg_sequences WHERE schemaname=current_schema() ORDER BY sequencename`,
    )
  ).rows;
  return {
    tables,
    constraints,
    indexes,
    triggers,
    functions,
    columns,
    enums,
    sequences,
  };
}
try {
  if (process.argv[2] === "prepare") {
    const before = await proof();
    writeFileSync(file, JSON.stringify(before));
    await assert.rejects(
      db.query(
        sql.replace(
          '  CREATE INDEX "ReadingPosition_lessonEditionId_idx"',
          `  RAISE EXCEPTION 'injected';\n  CREATE INDEX "ReadingPosition_lessonEditionId_idx"`,
        ),
      ),
    );
    assert.equal(
      (await db.query(`SELECT to_regclass('"ReadingPosition"') name`)).rows[0]
        .name,
      null,
    );
    assert.deepEqual(await proof(), before);
    await db.query('CREATE TABLE "ReadingPosition"(id TEXT)');
    await assert.rejects(db.query(sql), /READING_POSITION_REVIEW_REQUIRED/);
    await db.query('DROP TABLE "ReadingPosition"');
    await db.query(
      'CREATE INDEX "ReadingPosition_lessonEditionId_idx" ON "StudyLessonEdition"(id)',
    );
    await assert.rejects(db.query(sql), /READING_POSITION_REVIEW_REQUIRED/);
    await db.query('DROP INDEX "ReadingPosition_lessonEditionId_idx"');
    const locker = new pg.Client({ connectionString: url.href });
    await locker.connect();
    try {
      await locker.query("BEGIN");
      await locker.query('LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE');
      await assert.rejects(db.query(sql), /lock timeout/);
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }
    assert.deepEqual(await proof(), before);
  } else {
    const before = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(await proof(), before);
    assert.equal(
      (await db.query('SELECT count(*)::int n FROM "ReadingPosition"')).rows[0]
        .n,
      0,
    );
    await assert.rejects(db.query(sql), /READING_POSITION_REVIEW_REQUIRED/);
    console.log(
      JSON.stringify({
        readingPositionMigration: "passed",
        preservedTables: Object.keys(before.tables).length,
        preservedConstraints: before.constraints.length,
        preservedIndexes: before.indexes.length,
        preservedTriggers: before.triggers.length,
        preservedFunctions: before.functions.length,
        preservedColumns: before.columns.length,
        preservedEnums: before.enums.length,
        preservedSequences: before.sequences.length,
        oldRowsByteIdentical: true,
        noBackfill: true,
        atomicFailureAndLockRollback: true,
        productionTouched: false,
      }),
    );
  }
} finally {
  await db.end();
}
