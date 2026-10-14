#!/usr/bin/env node
// Alleen lezen: dit hulpmiddel is bewust geen migratie-, import- of herstelpad.
import { chmod, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const outputArg = args.find((arg) => arg.startsWith("--output="));
const output = outputArg?.slice("--output=".length);
const usage = "Gebruik: node scripts/content-architecture/diagnose-otb-production-readonly.mjs --confirm-readonly [--output=/absoluut/pad/rapport.json]";
const expectedBooks = ["gen","exo","lev","num","deu","jos","jdg","rut","1sa","2sa","1ki","2ki","1ch","2ch","ezr","neh","est","job","psa","pro","ecc","sng","isa","jer","lam","ezk","dan","hos","joe","amo","oba","jon","mic","nah","hab","zep","hag","zac","mal"];
const required = new Map([
  ["ContentWork", []], ["ContentCollection", ["work","editionKey","language","enabled","visibleToUsers","publicationState"]],
  ["Book", ["id","key","order","contentCollectionId"]], ["Chapter", ["id","number","bookId"]], ["Verse", ["number","text","chapterId"]], ["_prisma_migrations", []],
]);

function clean(value) { return Array.isArray(value) ? value.map(clean) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value; }
function compact(items, limit = 20) { return items.slice(0, limit); }
function print(report) {
  console.log("VERSADO OTB READ-ONLY DIAGNOSE\n");
  console.log(`Schema: ${report.schema.status}`);
  console.log(`OTB: ${report.otb.status}`);
  console.log(`Books: verwacht ${expectedBooks.length}, gevonden ${report.books.found}, ontbrekend ${report.books.missing.length}`);
  console.log(`Chapters: ${report.chapters.found}, afwijkende boeken ${report.chapters.invalidBooks}`);
  console.log(`Verses: ${report.verses.found}, ongeldige hoofdstukken ${report.verses.invalidChapters}`);
  console.log(`CFM references: ${report.cfm.status}`);
  console.log(`Resolver: ${report.resolver.status}`);
  console.log(`Overall: ${report.overall}`);
  if (report.books.missing.length) console.log(`Ontbrekende boekcodes: ${report.books.missing.join(", ")}`);
}

if (!args.includes("--confirm-readonly") || args.some((arg) => !["--confirm-readonly", outputArg].includes(arg))) {
  console.error(usage); process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ontbreekt; er zijn geen databasequeries uitgevoerd."); process.exitCode = 2;
} else if (output && (!output.startsWith("/") || output.includes("\0"))) {
  console.error("--output moet een veilig absoluut pad zijn."); process.exitCode = 2;
} else {
  let client;
  try {
    // Laad de databaseclient pas na de twee weigeringspaden hierboven. Zo
    // opent een vergissing zonder bevestiging nooit indirect een verbinding.
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const readOnly = await client.query("SHOW transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") throw new Error("READ_ONLY_NOT_CONFIRMED");
    const columns = await client.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name = ANY($1::text[]) ORDER BY table_name, ordinal_position", [[...required.keys()]]);
    const byTable = new Map(); for (const row of columns.rows) byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
    const missing = [...required].flatMap(([table, fields]) => !byTable.has(table) ? [`table:${table}`] : fields.filter((field) => !byTable.get(table).includes(field)).map((field) => `column:${table}.${field}`));
    const report = { schema: { status: missing.length ? "MISSING" : "PRESENT", missing }, otb: { status: "COLLECTION_MISSING" }, books: { expected: expectedBooks.length, found: 0, missing: expectedBooks, unknown: [], duplicates: [] }, chapters: { found: 0, invalidBooks: 0, deviations: [] }, verses: { found: 0, invalidChapters: 0, deviations: [], sourceCompleteness: "NOT_VERIFIED" }, cfm: { status: "MAPPING_MISSING", total: 0, internalReady: 0, detail: "Het manifest bevat lesmetadata; volledige versinventaris volgt pas bij de bronadapter." }, resolver: { status: "TECHNICALLY_MISSING", detail: "De bestaande resolver bevat nog geen OTB-bewijsadapter." }, overall: "BLOCKED" };
    if (!missing.length) {
      const collection = await client.query('SELECT id, language, enabled, "visibleToUsers", "publicationState", work, "editionKey" FROM "ContentCollection" WHERE work=$1 AND "editionKey"=$2 AND language=$3 LIMIT 2', ["old-testament", "otb", "nl"]);
      if (collection.rows.length === 1) {
        const row = collection.rows[0];
        report.otb = { status: !row.enabled ? "COLLECTION_DISABLED" : !row.visibleToUsers ? "COLLECTION_HIDDEN" : row.publicationState !== "PUBLISHED" && row.publicationState !== "LEGACY" ? "COLLECTION_DRAFT" : "COLLECTION_PUBLISHED", language: row.language, enabled: row.enabled, visibleToUsers: row.visibleToUsers, publicationState: row.publicationState };
        const books = await client.query('SELECT key, "order", id FROM "Book" WHERE "contentCollectionId"=$1 ORDER BY "order", key LIMIT 100', [row.id]);
        const keys = books.rows.map((book) => book.key).filter(Boolean);
        report.books = { expected: expectedBooks.length, found: keys.length, missing: expectedBooks.filter((key) => !keys.includes(key)), unknown: compact(keys.filter((key) => !expectedBooks.includes(key))), duplicates: compact(keys.filter((key, index) => keys.indexOf(key) !== index)) };
        const detail = await client.query('SELECT b.key, count(DISTINCT c.id)::int AS chapters, count(v.id)::int AS verses, count(*) FILTER (WHERE v.id IS NULL)::int AS empty_chapters, count(*) FILTER (WHERE v.text IS NULL OR btrim(v.text)=\'\')::int AS empty_verses FROM "Book" b LEFT JOIN "Chapter" c ON c."bookId"=b.id LEFT JOIN "Verse" v ON v."chapterId"=c.id WHERE b."contentCollectionId"=$1 GROUP BY b.key ORDER BY b.key LIMIT 100', [row.id]);
        const chapterRows = detail.rows.reduce((total, item) => total + item.chapters, 0), verseRows = detail.rows.reduce((total, item) => total + item.verses, 0);
        report.chapters = { found: chapterRows, invalidBooks: detail.rows.filter((item) => item.empty_chapters > 0 || item.chapters === 0).length, deviations: compact(detail.rows.filter((item) => item.empty_chapters > 0 || item.chapters === 0).map((item) => ({ book: item.key, emptyChapters: item.empty_chapters }))) };
        report.verses = { found: verseRows, invalidChapters: detail.rows.filter((item) => item.empty_verses > 0).length, deviations: compact(detail.rows.filter((item) => item.empty_verses > 0).map((item) => ({ book: item.key, emptyVerses: item.empty_verses }))), sourceCompleteness: "NOT_VERIFIED" };
      } else if (collection.rows.length > 1) report.otb = { status: "COLLECTION_INCONSISTENT" };
    }
    await client.query("COMMIT");
    if (report.schema.status === "PRESENT" && report.otb.status === "COLLECTION_PUBLISHED" && !report.books.missing.length && !report.books.unknown.length && !report.chapters.invalidBooks && !report.verses.invalidChapters) report.overall = "CONTENT_PRESENT_BUT_RESOLVER_MAPPING_MISSING";
    print(clean(report));
    if (output) { await writeFile(resolve(output), JSON.stringify(clean(report), null, 2), { mode: 0o600, flag: "wx" }); await chmod(resolve(output), 0o600); console.log("Rapport veilig geschreven."); }
  } catch (error) { try { await client?.query("ROLLBACK"); } catch {} console.error(`Diagnose mislukt zonder wijziging: ${error instanceof Error ? error.message : "onbekende fout"}`); process.exitCode = 1; }
  finally { await client?.end(); }
}
