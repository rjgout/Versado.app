#!/usr/bin/env node
// Alleen lezen: geen import-, migratie- of herstelpad. Telt (zonder gebruikers- of tekstgegevens uit te lezen) of een eerdere contentreload
// verweesde oefensessies, bijna lege lessen of onzichtbare actieve contentkeuzes heeft achtergelaten. Zie docs/CONTENTBEHEER.md ("Uitrol en herstel").
//   DATABASE_URL=... node scripts/content-architecture/diagnose-content-integrity-readonly.mjs --confirm-readonly [--output=/absoluut/pad/rapport.json]
import { chmod, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const outputArg = args.find((arg) => arg.startsWith("--output="));
const output = outputArg?.slice("--output=".length);
const usage = "Gebruik: node scripts/content-architecture/diagnose-content-integrity-readonly.mjs --confirm-readonly [--output=/absoluut/pad/rapport.json]";

if (!args.includes("--confirm-readonly") || args.some((arg) => arg !== "--confirm-readonly" && arg !== outputArg)) {
  console.error(usage); process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ontbreekt; er zijn geen databasequeries uitgevoerd."); process.exitCode = 2;
} else if (output && (!output.startsWith("/") || output.includes("\0"))) {
  console.error("--output moet een veilig absoluut pad zijn."); process.exitCode = 2;
} else {
  let client;
  try {
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '30s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    if ((await client.query("SHOW transaction_read_only")).rows[0]?.transaction_read_only !== "on") throw new Error("READ_ONLY_NOT_CONFIRMED");
    const one = async (sql) => Object.fromEntries(Object.entries((await client.query(sql)).rows[0]).map(([key, value]) => [key, Number(value)]));

    const sessions = await one(`
      WITH issued AS (
        SELECT s.id, s."submittedAt", e.value AS exercise_id
        FROM "ExerciseSession" s, LATERAL jsonb_array_elements_text(s."exerciseIds"::jsonb) AS e(value)
      )
      SELECT
        (SELECT count(*) FROM "ExerciseSession") AS total,
        (SELECT count(*) FROM "ExerciseSession" WHERE "submittedAt" IS NULL) AS open,
        count(DISTINCT i.id) FILTER (WHERE ex.id IS NULL AND i."submittedAt" IS NULL) AS "openMetVerdwenenOefening",
        count(DISTINCT i.id) FILTER (WHERE ex.id IS NOT NULL AND ex.status <> 'APPROVED' AND i."submittedAt" IS NULL) AS "openMetBuitenGebruikOefening"
      FROM issued i LEFT JOIN "Exercise" ex ON ex.id = i.exercise_id`);
    const exercises = await one(`SELECT count(*) AS total, count(*) FILTER (WHERE status <> 'APPROVED') AS "nietGoedgekeurd" FROM "Exercise"`);
    const lessons = await one(`SELECT count(*) AS total, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM "CourseLessonExercise" l WHERE l."lessonId" = cl.id)) AS "zonderOefeningen" FROM "CourseLesson" cl`);
    const collections = (await client.query(`SELECT id, work, "editionKey", language, enabled, "visibleToUsers", "publicationState" FROM "ContentCollection" ORDER BY "order", id`)).rows;
    const hiddenActive = (await client.query(`
      SELECT c.id, count(u.id)::int AS gebruikers
      FROM "ContentCollection" c JOIN "User" u ON u."activeContentCollectionId" = c.id
      WHERE NOT (c.enabled AND c."visibleToUsers" AND c."publicationState" IN ('LEGACY','PUBLISHED'))
      GROUP BY c.id ORDER BY c.id`)).rows;
    const report = {
      sessions, exercises, lessons,
      collections: collections.map((c) => ({ ...c, beschikbaarVoorGebruikers: c.enabled && c.visibleToUsers && ["LEGACY", "PUBLISHED"].includes(c.publicationState) })),
      actieveKeuzeOpOnbeschikbareCollectie: hiddenActive,
      verdict: sessions.openMetVerdwenenOefening > 0 ? "VERWEESDE_SESSIES" : hiddenActive.length > 0 ? "ACTIEVE_KEUZE_ONBESCHIKBAAR" : "GEEN_BEKENDE_SCHADE",
    };
    await client.query("ROLLBACK");
    console.log(JSON.stringify(report, null, 2));
    if (output) { await writeFile(output, JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 }); await chmod(output, 0o600); }
  } catch (error) {
    console.error(`Diagnose mislukt: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1;
  } finally {
    await client?.end().catch(() => undefined);
  }
}
