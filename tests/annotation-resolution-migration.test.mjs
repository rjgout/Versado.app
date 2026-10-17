// Fase 4D: databehoud van de additieve migratie. Op een eigen, tijdelijke database in dezelfde wegwerp-PostgreSQL:
// alle migraties vóór 4D, bestaande annotaties, dan alleen de 4D-migratie; de oorspronkelijke kolommen moeten byte-identiek blijven.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";

assertReferenceTestEnvironment();
const MIGRATION = "20261117120000_annotation_resolution";
const root = new URL("../prisma/migrations/", import.meta.url);
const names = readdirSync(root).filter((n) => /^\d{14}_/.test(n)).sort();

test("de 4D-migratie is uitsluitend additief (geen UPDATE, DELETE, DROP, INSERT of kolomwijziging)", () => {
  const sql = readFileSync(new URL(`${MIGRATION}/migration.sql`, root), "utf8").replace(/--[^\n]*/g, "");
  assert.equal(names.at(-1), MIGRATION, "dit is de nieuwste migratie");
  for (const forbidden of [/\bUPDATE\s+"/i, /\bDELETE\s+FROM\b/i, /\bDROP\b/i, /\bINSERT\b/i, /\bTRUNCATE\b/i, /ALTER COLUMN/i, /RENAME/i]) assert.doesNotMatch(sql, forbidden);
  assert.equal((sql.match(/ADD COLUMN/g) ?? []).length, 12);
});

test("bestaande annotaties zijn vóór en na de migratie byte-identiek; nieuwe kolommen zijn leeg", async () => {
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect();
  const scratch = `scratch_4d_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  await admin.query(`CREATE DATABASE "${scratch}"`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${scratch}`;
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    for (const name of names.filter((n) => n < MIGRATION)) await client.query(readFileSync(new URL(`${name}/migration.sql`, root), "utf8"));
    // Bestaande gegevens: een vers met alle drie de annotatietypen (legacy-vorm, met oorspronkelijke tijdstempels).
    const id = () => `t${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const user = id(), book = id(), chapter = id(), verse = id(), other = id();
    const columns = async (table) => (await client.query(`SELECT column_name, is_nullable, column_default, data_type FROM information_schema.columns WHERE table_name=$1 AND table_schema='public'`, [table])).rows;
    const fill = async (table, values) => {
      const cols = await columns(table);
      const row = { ...values };
      for (const c of cols) if (c.is_nullable === "NO" && c.column_default === null && row[c.column_name] === undefined) row[c.column_name] = c.data_type.includes("int") ? 1 : c.data_type === "boolean" ? false : c.data_type.startsWith("timestamp") ? new Date("2026-01-02T03:04:05.678Z") : c.data_type === "jsonb" ? "{}" : `x-${c.column_name}-${randomUUID().slice(0, 6)}`;
      const keys = Object.keys(row);
      await client.query(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`, keys.map((k) => row[k]));
    };
    await fill("User", { id: user, email: `${user}@scratch.invalid`, handle: "Scratch", discriminator: "01" });
    await fill("User", { id: other, email: `${other}@scratch.invalid`, handle: "Scratch2", discriminator: "02" });
    await fill("ContentCollection", { id: "content_bom" }).catch(() => {});
    const collectionId = (await client.query(`SELECT id FROM "ContentCollection" LIMIT 1`)).rows[0]?.id ?? "content_bom";
    await fill("Book", { id: book, contentCollectionId: collectionId });
    await fill("Chapter", { id: chapter, bookId: book });
    await fill("Verse", { id: verse, chapterId: chapter, number: 1, text: "Oorspronkelijke vers-tekst" });
    const stamp = new Date("2025-03-04T05:06:07.089Z"), updated = new Date("2025-04-05T06:07:08.910Z");
    await client.query(`INSERT INTO "Bookmark"(id,"userId","verseId","createdAt") VALUES ($1,$2,$3,$4)`, [id(), user, verse, stamp]);
    await client.query(`INSERT INTO "Highlight"(id,"userId","verseId",color,"createdAt") VALUES ($1,$2,$3,'purple',$4)`, [id(), user, verse, stamp]);
    await client.query(`INSERT INTO "Note"(id,"userId","verseId",text,"createdAt","updatedAt") VALUES ($1,$2,$3,'Een oude notitie',$4,$5)`, [id(), user, verse, stamp, updated]);
    const digest = async (strip) => (await client.query(
      `SELECT 'Bookmark' t, md5(coalesce(string_agg((to_jsonb(x)${strip})::text, E'\\n' ORDER BY id),'')) h, count(*)::int n FROM "Bookmark" x
       UNION ALL SELECT 'Highlight', md5(coalesce(string_agg((to_jsonb(x)${strip})::text, E'\\n' ORDER BY id),'')), count(*)::int FROM "Highlight" x
       UNION ALL SELECT 'Note', md5(coalesce(string_agg((to_jsonb(x)${strip})::text, E'\\n' ORDER BY id),'')), count(*)::int FROM "Note" x ORDER BY 1`)).rows;
    const before = await digest("");
    assert.deepEqual(before.map((r) => r.n), [1, 1, 1]);
    await client.query(readFileSync(new URL(`${MIGRATION}/migration.sql`, root), "utf8"));
    const after = await digest(` - 'resolvedRevisionId' - 'resolvedSelector' - 'resolvedAt' - 'resolutionHistory'`);
    assert.deepEqual(after, before, "oorspronkelijke kolommen, tijdstempels en Note.updatedAt zijn byte-identiek");
    const fresh = await client.query(`SELECT count(*)::int n FROM (
      SELECT "resolvedRevisionId","resolvedSelector","resolvedAt","resolutionHistory" FROM "Bookmark" UNION ALL SELECT "resolvedRevisionId","resolvedSelector","resolvedAt","resolutionHistory" FROM "Highlight" UNION ALL SELECT "resolvedRevisionId","resolvedSelector","resolvedAt","resolutionHistory" FROM "Note") a
      WHERE "resolvedRevisionId" IS NOT NULL OR "resolvedSelector" IS NOT NULL OR "resolvedAt" IS NOT NULL OR "resolutionHistory" IS NOT NULL`);
    assert.equal(fresh.rows[0].n, 0, "geen backfill: bestaande annotaties hebben geen resolutie");
    // Verse-annotaties blijven bruikbaar met hun oude constraints.
    await assert.rejects(client.query(`UPDATE "Highlight" SET "resolvedRevisionId"='x', "resolvedSelector"='{}'::jsonb, "resolvedAt"=now()`), /check|foreign key/i);
  } finally {
    await client.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}" WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});
