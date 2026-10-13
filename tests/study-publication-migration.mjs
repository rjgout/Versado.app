import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const file = `${process.env.CONTENT_MIGRATION_TEST_STATE}.publication.json`,
  sql = readFileSync(
    "prisma/migrations/20261030120000_study_import_publication/migration.sql",
    "utf8",
  );
const added = [
  "ContentImportRun",
  "ContentImportItem",
  "ContentMedia",
  "StudyRevisionMedia",
  "ContentReference",
  "StudyPublicationAction",
];
async function proof() {
  const tables = {};
  for (const { tablename } of (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=current_schema() AND tablename<>'_prisma_migrations' ORDER BY tablename",
    )
  ).rows) {
    if (added.includes(tablename)) continue;
    const name = `"${tablename.replaceAll('"', '""')}"`,
      projection =
        tablename === "StudyLessonEdition"
          ? "(to_jsonb(t)-'publicationVersion')"
          : "to_jsonb(t)";
    tables[tablename] = (
      await db.query(
        `SELECT count(*)::int AS n,md5(coalesce(string_agg(${projection}::text,E'\\n' ORDER BY ${projection}::text),'')) AS hash FROM ${name} t`,
      )
    ).rows[0];
  }
  const constraints = (
    await db.query(
      `SELECT c.conname,c.conrelid::regclass::text AS relation,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname=current_schema() AND c.contype IN ('f','p','u') ORDER BY c.conname,c.conrelid::regclass::text`,
    )
  ).rows.filter((c) => !added.some((t) => c.relation === `"${t}"`));
  const indexes = (
    await db.query(
      `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname=current_schema() AND indexname NOT IN ('ContentCollection_id_work_editionKey_language_key','StudyRevision_lessonEditionId_contentHash_idx') ORDER BY tablename,indexname`,
    )
  ).rows.filter((i) => !added.includes(i.tablename));
  return { tables, constraints, indexes };
}
async function absent() {
  for (const name of added)
    assert.equal(
      (await db.query("SELECT to_regclass($1) AS name", [`"${name}"`])).rows[0]
        .name,
      null,
    );
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM information_schema.columns WHERE table_name='StudyLessonEdition' AND column_name='publicationVersion'`,
      )
    ).rows[0].n,
    0,
  );
}
try {
  if (process.argv[2] === "prepare") {
    await db.query(
      `INSERT INTO "StudyPeriod"(id,"workKey","sourceKey",label) VALUES ('legacy-2a-period','fsy','legacy-2a-fixture','Bestaande synthetische 2A-periode'); INSERT INTO "StudyLesson"(id,"workKey","periodId","sourceKey") VALUES ('legacy-2a-lesson','fsy','legacy-2a-period','legacy-2a-lesson'); INSERT INTO "StudyLessonEdition"(id,"lessonId","collectionId","workKey",slug) VALUES ('legacy-2a-edition','legacy-2a-lesson','content_fsy','fsy','legacy-2a-fixture')`,
    );
    const value = {
      schemaVersion: 1,
      title: "Bestaande synthetische revisie",
      body: {
        schemaVersion: 1,
        sections: [
          {
            id: "legacy-section",
            blocks: [
              {
                id: "legacy-paragraph",
                type: "paragraph",
                content: [{ type: "text", text: "Oud synthetisch materiaal" }],
              },
            ],
          },
        ],
      },
      sourceMetadata: { sourceKey: "legacy:fixture" },
      rightsMetadata: { holder: "Test", permission: "Alleen test" },
    };
    const sort = (v) =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, sort(v[k])]),
            )
          : v;
    const hash = createHash("sha256")
      .update(JSON.stringify(sort(value)))
      .digest("hex");
    await db.query(
      `INSERT INTO "StudyRevision"(id,"lessonEditionId","revisionNumber","schemaVersion","contentHash",title,body,"sourceMetadata","rightsMetadata") VALUES ('legacy-2a-revision','legacy-2a-edition',1,1,$1,$2,$3,$4,$5)`,
      [
        hash,
        value.title,
        value.body,
        value.sourceMetadata,
        value.rightsMetadata,
      ],
    );
    await db.query(
      `UPDATE "StudyLessonEdition" SET "publishedRevisionId"='legacy-2a-revision' WHERE id='legacy-2a-edition'`,
    );
    const before = await proof();
    await absent();
    await db.query("BEGIN");
    await db.query(sql);
    await assert.rejects(db.query("SELECT 1/0"));
    await db.query("ROLLBACK");
    await absent();
    assert.deepEqual(await proof(), before);
    await db.query("BEGIN");
    await db.query('CREATE TABLE "ContentMedia"(id text)');
    await assert.rejects(db.query(sql), /STUDY_PUBLICATION_REVIEW_REQUIRED/);
    await db.query("ROLLBACK");
    await absent();
    assert.deepEqual(await proof(), before);
    await db.query("BEGIN");
    await db.query(
      'CREATE INDEX "ContentImportItem_revisionId_lessonEditionId_idx" ON "User"(id)',
    );
    await assert.rejects(db.query(sql), (e) => e.code === "42P07");
    await db.query("ROLLBACK");
    await absent();
    assert.deepEqual(await proof(), before);
    const blocker = new pg.Client({ connectionString: url.href });
    await blocker.connect();
    await blocker.query(
      'BEGIN;LOCK TABLE "StudyLessonEdition" IN ACCESS EXCLUSIVE MODE',
    );
    try {
      await assert.rejects(db.query(sql), (e) => e.code === "55P03");
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    await absent();
    assert.deepEqual(await proof(), before);
    writeFileSync(file, JSON.stringify(before), { mode: 0o600 });
  } else {
    const before = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(await proof(), before);
    for (const name of added)
      assert.equal(
        (await db.query(`SELECT count(*)::int n FROM "${name}"`)).rows[0].n,
        0,
      );
    const edition = (
      await db.query(
        `SELECT "publishedRevisionId","publicationVersion" FROM "StudyLessonEdition" WHERE id='legacy-2a-edition'`,
      )
    ).rows[0];
    assert.deepEqual(edition, {
      publishedRevisionId: "legacy-2a-revision",
      publicationVersion: 0,
    });
    await assert.rejects(db.query(sql), /STUDY_PUBLICATION_REVIEW_REQUIRED/);
    assert.deepEqual(await proof(), before);
    console.log(
      JSON.stringify({
        studyPublicationMigration: "passed",
        preservedTables: Object.keys(before.tables).length,
        preservedConstraints: before.constraints.length,
        preservedIndexes: before.indexes.length,
        oldColumnHashesIdentical: true,
        oldPublicationPointerPreserved: true,
        newVersionZero: true,
        noBackfill: true,
        atomicErrorAndLockRollback: true,
        productionTouched: false,
      }),
    );
  }
} finally {
  await db.end();
}
