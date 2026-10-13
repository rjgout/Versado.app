import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test") throw new Error("Eigen wegwerpdatabase vereist");
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const file = `${process.env.CONTENT_MIGRATION_TEST_STATE}.mystery.json`;
const sql = readFileSync("prisma/migrations/20261028120000_mystery_attempt/migration.sql", "utf8");
async function fingerprint() {
  const result = {};
  for (const { tablename } of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations','MysteryAttempt') ORDER BY tablename")).rows) {
    const table = `"${tablename.replaceAll('"','""')}"`;
    result[tablename] = (await db.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS hash FROM ${table} t`)).rows[0];
  }
  return result;
}
try {
  if (process.argv[2] === "prepare") {
    await db.query(`INSERT INTO "MysteryProgress"(id,"userId","mysteryId",difficulty,completed,"completedAt","hintCount","tutorialSeenAt","updatedAt") VALUES ('mystery-old-result','m-user-1','mystery-001','DISCOVERER',true,'2026-10-01',7,'2026-10-01',NOW()),('mystery-old-tutorial','m-user-2','mystery-001','DISCOVERER',false,NULL,NULL,'2026-10-02',NOW())`);
    const before = await fingerprint();
    await db.query("BEGIN"); await db.query(sql); await assert.rejects(db.query("SELECT 1/0")); await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(), before); assert.equal((await db.query(`SELECT to_regclass('"MysteryAttempt"') AS name`)).rows[0].name, null);
    await db.query("BEGIN"); await db.query('CREATE TABLE "MysteryAttempt"(id TEXT)'); await assert.rejects(db.query(sql), /MYSTERY_ATTEMPT_REVIEW_REQUIRED/); await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(), before);
    writeFileSync(file, JSON.stringify(before), { mode: 0o600 });
  } else {
    const expected = JSON.parse(readFileSync(file, "utf8")); assert.deepEqual(await fingerprint(), expected);
    assert.equal((await db.query('SELECT count(*)::int n FROM "MysteryAttempt"')).rows[0].n, 0);
    await assert.rejects(db.query(sql), /MYSTERY_ATTEMPT_REVIEW_REQUIRED/);
    assert.deepEqual(await fingerprint(), expected);
    console.log(JSON.stringify({ mysteryMigrationPreservedTables: Object.keys(expected).length, historicalCompletionHintCountAndTutorialPreserved: true, noBackfill: true, abortedAndConflictingMigrationAtomic: true, productionTouched: false }));
  }
} finally { await db.end(); }
