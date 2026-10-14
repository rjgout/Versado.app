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
  throw Error("Eigen wegwerpdatabase vereist");
const db = new pg.Client({ connectionString: url.href });
await db.connect();
const state = process.env.CONTENT_MIGRATION_TEST_STATE + ".selection.json";
async function fingerprint() {
  const rows = {};
  for (const { tablename } of (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  ).rows) {
    rows[tablename] = (
      await db.query(
        `SELECT count(*)::int n,md5(coalesce(string_agg((to_jsonb(t)-'contentSelectionVersion')::text,E'\\n' ORDER BY (to_jsonb(t)-'contentSelectionVersion')::text),'')) hash FROM "${tablename.replaceAll('"', '""')}" t`,
      )
    ).rows[0];
  }
  const columns = (
    await db.query(
      `SELECT table_name,column_name,data_type,column_default,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND column_name<>'contentSelectionVersion' ORDER BY table_name,ordinal_position`,
    )
  ).rows;
  const constraints = (
    await db.query(
      `SELECT conname,conrelid::regclass::text relation,pg_get_constraintdef(oid) definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname<>'User_contentSelectionVersion_nonnegative' ORDER BY conname,conrelid`,
    )
  ).rows;
  const indexes = (
    await db.query(
      `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() ORDER BY tablename,indexname`,
    )
  ).rows;
  const triggers = (
    await db.query(
      `SELECT tgname,tgrelid::regclass::text relation,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE NOT tgisinternal AND tgname<>'User_content_selection_version' ORDER BY tgname,tgrelid`,
    )
  ).rows;
  return { rows, columns, constraints, indexes, triggers };
}
try {
  if (process.argv[2] === "prepare")
    writeFileSync(state, JSON.stringify(await fingerprint()));
  else {
    assert.deepEqual(
      await fingerprint(),
      JSON.parse(readFileSync(state, "utf8")),
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "User" WHERE "contentSelectionVersion"<>0',
        )
      ).rows[0].n,
      0,
    );
    const { id } = (await db.query('SELECT id FROM "User" ORDER BY id LIMIT 1'))
      .rows[0];
    await db.query("BEGIN");
    await db.query('UPDATE "User" SET "contentLanguage"=\'en\' WHERE id=$1', [
      id,
    ]);
    const one = (
      await db.query(
        'SELECT "contentSelectionVersion" v FROM "User" WHERE id=$1',
        [id],
      )
    ).rows[0].v;
    assert.equal(one, 1);
    await db.query(
      'UPDATE "User" SET "contentLanguage"=\'en\',"xpTotal"="xpTotal" WHERE id=$1',
      [id],
    );
    assert.equal(
      (
        await db.query(
          'SELECT "contentSelectionVersion" v FROM "User" WHERE id=$1',
          [id],
        )
      ).rows[0].v,
      one,
    );
    await db.query('UPDATE "User" SET "contentLanguage"=\'nl\' WHERE id=$1', [
      id,
    ]);
    assert.equal(
      (
        await db.query(
          'SELECT "contentSelectionVersion" v FROM "User" WHERE id=$1',
          [id],
        )
      ).rows[0].v,
      2,
    );
    await db.query("SAVEPOINT tamper");
    await assert.rejects(
      db.query('UPDATE "User" SET "contentSelectionVersion"=0 WHERE id=$1', [
        id,
      ]),
      /IMMUTABLE/,
    );
    await db.query("ROLLBACK TO tamper");
    await db.query("ROLLBACK");
    assert.deepEqual(
      await fingerprint(),
      JSON.parse(readFileSync(state, "utf8")),
    );
    // Fout midden in de additieve DDL moet alles terugrollen.
    const sql = readFileSync(
      "prisma/migrations/20261101120000_content_selection_version/migration.sql",
      "utf8",
    );
    await db.query("BEGIN");
    await db.query('DROP TRIGGER "User_content_selection_version" ON "User"');
    await db.query("DROP FUNCTION protect_content_selection_version()");
    await db.query(
      'ALTER TABLE "User" DROP CONSTRAINT "User_contentSelectionVersion_nonnegative"',
    );
    await db.query('ALTER TABLE "User" DROP COLUMN "contentSelectionVersion"');
    await db.query("COMMIT");
    await assert.rejects(
      db.query(
        sql.replace(
          "CREATE FUNCTION protect_content_selection_version()",
          "SELECT missing_deliberate_migration_failure(); CREATE FUNCTION protect_content_selection_version()",
        ),
      ),
      /does not exist/,
    );
    await db.query("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM information_schema.columns WHERE table_name='User' AND column_name='contentSelectionVersion'",
        )
      ).rows[0].n,
      0,
    );
    await db.query(sql);
    await assert.rejects(db.query(sql), /REVIEW_REQUIRED/);
    await db.query("ROLLBACK");
    assert.deepEqual(
      await fingerprint(),
      JSON.parse(readFileSync(state, "utf8")),
    );
    console.log(
      "Content selection migration: all existing rows preserved; no-op, A→B→A, tamper and repeated raw DDL guarded.",
    );
  }
} finally {
  await db.end();
}
