// Alleen-lezen voorbereiding; geen impliciete DATABASE_URL, backfill of publicatie.
import pg from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const kinds = new Map([
  ["bofm", "SCRIPTURE"], ["dc-testament", "SCRIPTURE"], ["pgp", "SCRIPTURE"],
  ["old-testament", "SCRIPTURE"], ["new-testament", "SCRIPTURE"],
  ["fsy", "STUDY_PROGRAM"], ["podcasts", "OTHER"],
]);
export function analyseIdentities(collections) {
  const issues = [];
  const keys = new Map();
  const editions = new Set();
  const works = new Map();
  for (const collection of collections) {
    const key = collection.work ?? collection.id;
    const origin = collection.work === null ? "collection-id" : "work";
    if (keys.has(key) && keys.get(key) !== origin) issues.push({ type: "ambiguous-work-key", key });
    keys.set(key, origin);
    if (!key?.trim() || !collection.editionKey?.trim() || !collection.language?.trim()) issues.push({ type: "empty-identity", collectionId: collection.id });
    const identity = JSON.stringify([key, collection.editionKey, collection.language]);
    if (editions.has(identity)) issues.push({ type: "duplicate-edition", collectionId: collection.id });
    editions.add(identity);
    const work = works.get(key) ?? { key, origin, suggestedKind: collection.work === null ? "OTHER" : (kinds.get(collection.work) ?? "OTHER"), collections: [] };
    work.collections.push(collection.id);
    works.set(key, work);
  }
  return { works: [...works.values()].sort((a, b) => a.key.localeCompare(b.key)),
    nullWorkCollectionIds: collections.filter((c) => c.work === null).map((c) => c.id), issues };
}

export async function collectInventory(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const setting = await client.query("SELECT current_setting('transaction_read_only') AS transaction_read_only");
    if (setting.rows[0].transaction_read_only !== "on") throw new Error("Inventaris vereist een alleen-lezen transactie");
    const collections = (await client.query('SELECT id, slug, work, "editionKey", language, enabled, "visibleToUsers" FROM "ContentCollection" ORDER BY id')).rows;
    const tables = ["ContentCollection", "Book", "Chapter", "Verse", "Course", "CourseChapter", "CourseLesson", "User", "UserCourseProgress", "UserCourseLessonProgress", "ContentProgress", "ContentExerciseCredit", "ExerciseSession", "ReadingSession", "Bookmark", "Highlight", "Note", "PodcastPlaybackProgress", "PodcastEpisodeProgress", "FsyLesson", "GameContentScope", "XPTransaction", "StreakActivity", "StreakDay"];
    const counts = {};
    for (const table of tables) counts[table] = (await client.query(`SELECT count(*)::text AS count FROM "${table}"`)).rows[0].count;
    const integrity = (await client.query(`SELECT
      (SELECT count(*)::text FROM "Book" b LEFT JOIN "ContentCollection" c ON c.id = b."contentCollectionId" WHERE c.id IS NULL) AS "booksWithoutCollection",
      (SELECT count(*)::text FROM "Course" b LEFT JOIN "ContentCollection" c ON c.id = b."contentCollectionId" WHERE c.id IS NULL) AS "coursesWithoutCollection",
      (SELECT count(*)::text FROM "User" u LEFT JOIN "ContentCollection" c ON c.id = u."activeContentCollectionId" WHERE u."activeContentCollectionId" IS NOT NULL AND c.id IS NULL) AS "usersWithoutActiveCollection",
      (SELECT count(*)::text FROM "Bookmark" b LEFT JOIN "Verse" v ON v.id = b."verseId" WHERE v.id IS NULL) AS "bookmarksWithoutVerse",
      (SELECT count(*)::text FROM "Highlight" b LEFT JOIN "Verse" v ON v.id = b."verseId" WHERE v.id IS NULL) AS "highlightsWithoutVerse",
      (SELECT count(*)::text FROM "Note" b LEFT JOIN "Verse" v ON v.id = b."verseId" WHERE v.id IS NULL) AS "notesWithoutVerse"`)).rows[0];
    const fsy = (await client.query('SELECT count(*)::text AS total, count("publishedContent")::text AS published, count(*) FILTER (WHERE status = \'DRAFT\')::text AS drafts, count(*) FILTER (WHERE status = \'DRAFT\' AND "publishedContent" IS NOT NULL)::text AS "draftWithPublishedCopy" FROM "FsyLesson"')).rows[0];
    // Inclusief onvoltooide/mislukte en teruggedraaide migraties, zonder logs.
    const migrations = (await client.query('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name, started_at')).rows;
    await client.query("COMMIT");
    return { formatVersion: 2, collections, identities: analyseIdentities(collections), counts, integrity, fsy, migrations };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const url = process.env.CONTENT_INVENTORY_DATABASE_URL;
  const destination = process.argv[2];
  if (!url || !destination) throw new Error("Vereist: expliciet geautoriseerde CONTENT_INVENTORY_DATABASE_URL en uitvoerbestand; geen DATABASE_URL-fallback");
  const client = new pg.Client({ connectionString: url, statement_timeout: 30_000, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const inventory = await collectInventory(client);
    await writeFile(destination, JSON.stringify({ capturedAt: new Date().toISOString(), ...inventory }, null, 2), { mode: 0o600, flag: "wx" });
    console.log(`Inventaris geschreven; ${inventory.collections.length} collecties, ${inventory.identities.issues.length} identiteitsproblemen. Geen gegevens gewijzigd.`);
  } finally { await client.end(); }
}
