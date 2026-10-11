// Gedeeld door beheer en het CLI-script: geen databasebinding, gebruikersdata of writes.
import { z } from "zod";

const text = z.string().max(1000);
const count = z.string().regex(/^\d+$/);
const collectionSchema = z.object({
  id: text, slug: text, work: text.nullable(), editionKey: text, language: text,
  enabled: z.boolean(), visibleToUsers: z.boolean(), publicationState: text.nullable(),
});
export type InventoryCollection = z.infer<typeof collectionSchema>;
const kinds = new Map<string, "SCRIPTURE" | "STUDY_PROGRAM" | "OTHER">([
  ["bofm", "SCRIPTURE"], ["dc-testament", "SCRIPTURE"], ["pgp", "SCRIPTURE"],
  ["old-testament", "SCRIPTURE"], ["new-testament", "SCRIPTURE"],
  ["fsy", "STUDY_PROGRAM"], ["podcasts", "OTHER"],
]);
const issueSchema = z.object({ type: z.enum(["ambiguous-work-key", "empty-identity", "duplicate-edition"]), key: text.optional(), collectionId: text.optional() });

/** Een voorstel voor mapping, nooit bewijs van publicatie of een automatische backfill. */
export function analyseIdentities(collections: Pick<InventoryCollection, "id" | "work" | "editionKey" | "language">[]) {
  const issues: z.infer<typeof issueSchema>[] = [];
  const keys = new Map<string, string>(), editions = new Set<string>();
  const works = new Map<string, { key: string; origin: "collection-id" | "work"; suggestedKind: "SCRIPTURE" | "STUDY_PROGRAM" | "OTHER"; collections: string[] }>();
  for (const collection of collections) {
    const key = collection.work ?? collection.id;
    const origin = collection.work === null ? "collection-id" : "work";
    if (keys.has(key) && keys.get(key) !== origin) issues.push({ type: "ambiguous-work-key", key });
    keys.set(key, origin);
    if (!key.trim() || !collection.editionKey.trim() || !collection.language.trim()) issues.push({ type: "empty-identity", collectionId: collection.id });
    const identity = JSON.stringify([key, collection.editionKey, collection.language]);
    if (editions.has(identity)) issues.push({ type: "duplicate-edition", collectionId: collection.id });
    editions.add(identity);
    const work = works.get(key) ?? { key, origin, suggestedKind: collection.work === null ? "OTHER" as const : kinds.get(key) ?? "OTHER" as const, collections: [] };
    work.collections.push(collection.id); works.set(key, work);
  }
  return { works: [...works.values()].sort((a, b) => a.key.localeCompare(b.key)), nullWorkCollectionIds: collections.filter((c) => c.work === null).map((c) => c.id), issues };
}

export const INVENTORY_TABLES = ["ContentCollection", "Book", "Chapter", "Verse", "Course", "CourseChapter", "CourseLesson", "User", "UserCourseProgress", "UserCourseLessonProgress", "ContentProgress", "ContentExerciseCredit", "ExerciseSession", "ReadingSession", "Bookmark", "Highlight", "Note", "PodcastPlaybackProgress", "PodcastEpisodeProgress", "FsyLesson", "GameContentScope", "XPTransaction", "StreakActivity", "StreakDay"] as const;
export const INTEGRITY_KEYS = ["booksWithoutCollection", "coursesWithoutCollection", "usersWithoutActiveCollection", "bookmarksWithoutVerse", "highlightsWithoutVerse", "notesWithoutVerse", "chaptersWithoutBook", "versesWithoutChapter", "readingSessionsWithoutChapter", "fsyWithoutCollection"] as const;
const fields = <T extends string>(keys: readonly T[]) => Object.fromEntries(keys.map((key) => [key, count])) as Record<T, typeof count>;
const date = z.iso.datetime();
// Expliciete allowlist, ook voor geneste objecten. Zod verwijdert onbekende velden.
const reportSchema = z.object({
  formatVersion: z.literal(3), capturedAt: date, readOnly: z.literal(true),
  publicationFieldPresent: z.boolean(), collections: z.array(collectionSchema).max(5000),
  identities: z.object({ works: z.array(z.object({ key: text, origin: z.enum(["collection-id", "work"]), suggestedKind: z.enum(["SCRIPTURE", "STUDY_PROGRAM", "OTHER"]), collections: z.array(text) })), nullWorkCollectionIds: z.array(text), issues: z.array(issueSchema) }),
  counts: z.object(fields(INVENTORY_TABLES)), integrity: z.object(fields(INTEGRITY_KEYS)),
  fsy: z.object({ total: count, published: count, publishedStatus: count, drafts: count, draftWithPublishedCopy: count }),
  migrations: z.array(z.object({ migration_name: text, checksum: text, started_at: date, finished_at: date.nullable(), rolled_back_at: date.nullable(), applied_steps_count: z.number().int().nonnegative() })).max(2000),
});
export type ContentInventory = z.infer<typeof reportSchema>;
export function sanitizeInventory(report: unknown): ContentInventory { return reportSchema.parse(report); }

export const READ_ONLY_SQL = "SET TRANSACTION READ ONLY";
export const TIMEOUT_SQL = "SET LOCAL statement_timeout = '10s'";
export const LOCK_TIMEOUT_SQL = "SET LOCAL lock_timeout = '3s'";
const collectionsSql = `SELECT c.id, c.slug, c.work, c."editionKey", c.language, c.enabled, c."visibleToUsers", to_jsonb(c)->>'publicationState' AS "publicationState" FROM "ContentCollection" c ORDER BY c.id LIMIT 5001`;
const integritySql = `SELECT
 (SELECT count(*)::text FROM "Book" b LEFT JOIN "ContentCollection" c ON c.id=b."contentCollectionId" WHERE c.id IS NULL) AS "booksWithoutCollection",
 (SELECT count(*)::text FROM "Course" b LEFT JOIN "ContentCollection" c ON c.id=b."contentCollectionId" WHERE c.id IS NULL) AS "coursesWithoutCollection",
 (SELECT count(*)::text FROM "User" u LEFT JOIN "ContentCollection" c ON c.id=u."activeContentCollectionId" WHERE u."activeContentCollectionId" IS NOT NULL AND c.id IS NULL) AS "usersWithoutActiveCollection",
 (SELECT count(*)::text FROM "Bookmark" b LEFT JOIN "Verse" v ON v.id=b."verseId" WHERE v.id IS NULL) AS "bookmarksWithoutVerse",
 (SELECT count(*)::text FROM "Highlight" b LEFT JOIN "Verse" v ON v.id=b."verseId" WHERE v.id IS NULL) AS "highlightsWithoutVerse",
 (SELECT count(*)::text FROM "Note" b LEFT JOIN "Verse" v ON v.id=b."verseId" WHERE v.id IS NULL) AS "notesWithoutVerse",
 (SELECT count(*)::text FROM "Chapter" c LEFT JOIN "Book" b ON b.id=c."bookId" WHERE b.id IS NULL) AS "chaptersWithoutBook",
 (SELECT count(*)::text FROM "Verse" v LEFT JOIN "Chapter" c ON c.id=v."chapterId" WHERE c.id IS NULL) AS "versesWithoutChapter",
 (SELECT count(*)::text FROM "ReadingSession" r LEFT JOIN "Chapter" c ON c.id=r."chapterId" WHERE c.id IS NULL) AS "readingSessionsWithoutChapter",
 (SELECT count(*)::text FROM "FsyLesson" f LEFT JOIN "ContentCollection" c ON c.id=f."contentCollectionId" WHERE c.id IS NULL) AS "fsyWithoutCollection"`;
export interface InventoryQuery { query(sql: string): Promise<{ rows: unknown[] }> }

/** Alleen SELECT; de aanroeper beheert dezelfde read-only snapshottransactie. */
export async function collectInventory(client: InventoryQuery): Promise<ContentInventory> {
  const rows = async (sql: string) => (await client.query(sql)).rows;
  const setting = await rows("SELECT current_setting('transaction_read_only') AS transaction_read_only");
  if ((setting[0] as { transaction_read_only?: string })?.transaction_read_only !== "on") throw new Error("READ_ONLY_REQUIRED");
  const collections = z.array(collectionSchema).max(5000).parse(await rows(collectionsSql));
  const publicationFieldPresent = (await rows("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'ContentCollection' AND column_name = 'publicationState'")).length > 0;
  const counts: Record<string, string> = {};
  for (const table of INVENTORY_TABLES) {
    // Namen komen uitsluitend uit de vaste allowlist, nooit uit een verzoek.
    counts[table] = count.parse(((await rows(`SELECT count(*)::text AS count FROM "${table}"`))[0] as { count: unknown }).count);
  }
  const integrity = (await rows(integritySql))[0];
  const fsy = (await rows(`SELECT count(*)::text AS total, count("publishedContent")::text AS published, count(*) FILTER (WHERE status = 'PUBLISHED')::text AS "publishedStatus", count(*) FILTER (WHERE status = 'DRAFT')::text AS drafts, count(*) FILTER (WHERE status = 'DRAFT' AND "publishedContent" IS NOT NULL)::text AS "draftWithPublishedCopy" FROM "FsyLesson"`))[0];
  const migrations = await rows('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY migration_name, started_at LIMIT 2001');
  return sanitizeInventory({ formatVersion: 3, capturedAt: new Date().toISOString(), readOnly: true, publicationFieldPresent, collections, identities: analyseIdentities(collections), counts, integrity, fsy, migrations: migrations.map((row) => {
    const r = row as Record<string, unknown>;
    return { ...r, started_at: r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at, finished_at: r.finished_at instanceof Date ? r.finished_at.toISOString() : r.finished_at, rolled_back_at: r.rolled_back_at instanceof Date ? r.rolled_back_at.toISOString() : r.rolled_back_at };
  }) });
}
