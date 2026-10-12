import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
const url = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test") throw new Error("Eigen wegwerpdatabase vereist");
const db = new pg.Client({ connectionString: url.href }); await db.connect();
const file = `${process.env.CONTENT_MIGRATION_TEST_STATE}.qm.json`;
const sql = readFileSync("prisma/migrations/20261027120000_quick_missionary_source/migration.sql", "utf8");
async function fingerprint() {
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' ORDER BY tablename")).rows;
  const result = {};
  for (const { tablename } of tables) {
    const table = `"${tablename.replaceAll('"','""')}"`;
    const strip = ["QuickMissionaryRun", "LiveGamePlayer"].includes(tablename) ? "to_jsonb(t)-'contentCollectionId'" : "to_jsonb(t)";
    result[tablename] = (await db.query(`SELECT count(*)::int AS n, md5(coalesce(string_agg((${strip})::text,E'\\n' ORDER BY (${strip})::text),'')) AS hash FROM ${table} t`)).rows[0];
  }
  return result;
}
try {
  if (process.argv[2] === "prepare") {
    await db.query(`INSERT INTO "LiveGame"(id,code,"hostId",mode,status) VALUES ('qm-m-game','QMOLD','m-user-1','QUICK_MISSIONARY','IN_PROGRESS'),('qm-m-other','QMOTHER','m-user-2','STUDY','LOBBY');
      INSERT INTO "LiveGamePlayer"(id,"gameId","userId",score) VALUES ('qm-m-player','qm-m-game','m-user-1',17),('qm-m-other-player','qm-m-other','m-user-2',0);
      INSERT INTO "QuickMissionaryMatch"(id,"liveGameId",seed,"startsAt","participantCount") VALUES ('qm-m-match','qm-m-game','preserve-seed',NOW(),2);
      INSERT INTO "QuickMissionaryRun"(id,"userId","dayKey",score,status,"matchId","reviveUsed","reviveExerciseId","reviveOptionIds","updatedAt") VALUES ('qm-m-solo','m-user-1','2026-10-11',73,'FINISHED',NULL,true,'qm-m-question','["qm-m-c","qm-m-a","qm-m-b"]',NOW()),('qm-m-run','m-user-2','2026-10-11',19,'IN_PROGRESS','qm-m-match',false,NULL,NULL,NOW());
      INSERT INTO "QuickMissionaryReviveQuestion"(id,"contentKey","chapterId",variant,prompt,"updatedAt") VALUES ('qm-m-question','qm:proof','m-chapter-1',1,'Synthetische vraag',NOW());
      INSERT INTO "QuickMissionaryReviveOption"(id,"questionId",label,"isCorrect","order") VALUES ('qm-m-c','qm-m-question','Goed antwoord',true,0),('qm-m-a','qm-m-question','Fout antwoord',false,1),('qm-m-b','qm-m-question','Ander antwoord',false,2);
      INSERT INTO "QuickMissionaryReviveProgress"("userId","contentCollectionId","cursorBookOrder","cursorChapterOrder",cycle,"updatedAt") VALUES ('m-user-1','content_bom',9,4,2,NOW());
      INSERT INTO "QuickMissionaryReviveSeen"(id,"userId","questionId",cycle,"runId",outcome) VALUES ('qm-m-seen','m-user-1','qm-m-question',2,'qm-m-solo','WRONG');
      INSERT INTO "GeneesPurchase"(id,"userId","priceXp","stockBefore",source,"runId") VALUES ('qm-m-purchase','m-user-1',100,0,'GAME','qm-m-solo');`);
    const before = await fingerprint();
    // DDL + een fout in dezelfde transactie: oude rijen/schema blijven behouden.
    await db.query("BEGIN"); await db.query(sql); await assert.rejects(db.query("SELECT 1/0")); await db.query("ROLLBACK");
    assert.deepEqual(await fingerprint(), before);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='QuickMissionaryRun' AND column_name='contentCollectionId'`)).rows[0].n, 0);
    await db.query("BEGIN");
    await db.query('ALTER TABLE "LiveGamePlayer" ADD COLUMN "contentCollectionId" TEXT');
    await assert.rejects(db.query(sql), /QUICK_MISSIONARY_SOURCE_REVIEW_REQUIRED/);
    await db.query("ROLLBACK"); assert.deepEqual(await fingerprint(), before);
    const blocker = new pg.Client({ connectionString: url.href }); await blocker.connect();
    await blocker.query('BEGIN; LOCK TABLE "LiveGamePlayer" IN ACCESS EXCLUSIVE MODE');
    try { await assert.rejects(db.query(sql), error => error.code === "55P03"); }
    finally { await blocker.query("ROLLBACK"); await blocker.end(); }
    assert.deepEqual(await fingerprint(), before);
    writeFileSync(file, JSON.stringify(before), { mode: 0o600 });
  } else {
    const expected = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(await fingerprint(), expected);
    for (const table of ["QuickMissionaryRun", "LiveGamePlayer"]) assert.equal((await db.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "contentCollectionId" IS NOT NULL`)).rows[0].n, 0);
    await assert.rejects(db.query(`UPDATE "QuickMissionaryRun" SET "contentCollectionId"='missing-source' WHERE id='qm-m-run'`), error => error.code === "23503");
    assert.deepEqual(await fingerprint(), expected);
    console.log(JSON.stringify({ quickMissionaryMigrationPreservedTables: Object.keys(expected).length, legacyRunIdsScoresMatchesAndQuestionOrderPreserved: true, legacyLobbyAndOtherModesRemainNull: true, rollbackAndInvalidForeignKey: "passed", productionTouched: false }));
  }
} finally { await db.end(); }
