// Oude kolommen/rijen worden vóór en na de echte migratie vergeleken; uitsluitend eigen wegwerp-Postgres.
import pg from "pg";
import { readFileSync, writeFileSync } from "node:fs";
const u = new URL(
  process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
);
if (
  u.hostname !== "127.0.0.1" ||
  u.pathname !== "/versado_content_access_test" ||
  process.env.DATABASE_URL !== u.href
)
  throw new Error("Eigen geïsoleerde runner vereist");
const db = new pg.Client({ connectionString: u.href });
await db.connect();
const file = `/tmp/cfm-migration-${u.port}.json`,
  quote = (s) => '"' + s.replaceAll('"', '""') + '"';
async function hash(table, columns) {
  return (
    await db.query(
      `SELECT count(*)::int count,md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM (SELECT ${columns.map(quote).join(",")} FROM ${quote(table)}) t`,
    )
  ).rows[0];
}
try {
  if (process.argv[2] === "prepare") {
    // Geforceerd naamconflict na de eerste ALTERs: geen gedeeltelijke migratie.
    await db.query(
      'ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_studyEdition_fkey" CHECK (true)',
    );
    try {
      await db.query(
        readFileSync(
          new URL(
            "../prisma/migrations/20261206120000_study_exercise_sessions/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      throw new Error("Verwacht constraintconflict bleef uit");
    } catch (error) {
      await db.query("ROLLBACK");
      if (error.code !== "42710") throw error;
    } finally {
      await db.query(
        'ALTER TABLE "Exercise" DROP CONSTRAINT "Exercise_studyEdition_fkey"',
      );
    }
    const partial = (
      await db.query(
        "SELECT column_name,is_nullable FROM information_schema.columns WHERE table_name='Exercise' AND column_name IN ('chapterId','studyLessonEditionId','studySource')",
      )
    ).rows;
    if (partial.length !== 1 || partial[0].is_nullable !== "NO")
      throw new Error("Gedeeltelijke migratie niet teruggerold");
    const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename",
      )
    ).rows;
    const state = [];
    for (const { tablename } of tables) {
      const columns = (
        await db.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          [tablename],
        )
      ).rows.map((r) => r.column_name);
      state.push({
        table: tablename,
        columns,
        ...(await hash(tablename, columns)),
      });
    }
    writeFileSync(file, JSON.stringify(state));
  } else {
    const state = JSON.parse(readFileSync(file, "utf8"));
    for (const row of state) {
      const after = await hash(row.table, row.columns);
      if (after.hash !== row.hash || after.count !== row.count)
        throw new Error("Bestaande gegevens gewijzigd in " + row.table);
    }
    const nullable = (
      await db.query(
        "SELECT is_nullable FROM information_schema.columns WHERE table_name='Exercise' AND column_name='chapterId'",
      )
    ).rows[0];
    if (nullable.is_nullable !== "YES")
      throw new Error("Geen compatibele hoofdstukuitbreiding");
    await db.query("BEGIN");
    try {
      await db.query(
        `INSERT INTO "Exercise"(id,"order",type,"verseRef",prompt,answers) VALUES('invalid-study-target',0,'FILL_BLANK','test','test','[]')`,
      );
      throw new Error("Ongeldig doel geaccepteerd");
    } catch (e) {
      if (e.code !== "23514") throw e;
    } finally {
      await db.query("ROLLBACK");
    }
    console.log(
      JSON.stringify({
        cfmExerciseMigration: "passed",
        preservedTables: state.length,
        oldRowsAndColumnsIdentical: true,
        forcedConflictRolledBackAtomically: true,
        invalidTargetRejected: true,
        productionTouched: false,
      }),
    );
  }
} finally {
  await db.end();
}
