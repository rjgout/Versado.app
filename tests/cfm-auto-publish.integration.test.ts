import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { importCfm2026Drafts, importAllCfmDrafts } from "../src/lib/studyContent/cfm2026Import";
import { autoPublishCfmVolume } from "../src/lib/studyContent/cfmAutoPublish";
import { CFM_SOURCE_2026 } from "../src/lib/studyContent/cfmSources";

// Eigen geïsoleerde database en eigen gepinde testassets vereist (zoals tests/cfm-2026-import.integration.test.mjs).
const database = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || process.env.DATABASE_URL !== database.href)
  throw new Error("Eigen geïsoleerde runner vereist");
const assets = process.env.CFM_TEST_ASSETS;
if (!assets?.startsWith("/tmp/")) throw new Error("Eigen gepinde testassets vereist (CFM_TEST_ASSETS)");
const options = { mediaBytes: (a: { file: string }) => fs.readFile(path.join(assets, "media", a.file)) };
const collectionId = CFM_SOURCE_2026.volume.collectionId;

after(() => prisma.$disconnect());

async function actor(isAdmin: boolean) {
  const row = await prisma.user.create({ data: { email: `${randomUUID()}@cfm-auto.test.invalid`, passwordHash: "test-only", handle: `A${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin } });
  return { id: row.id, isAdmin };
}
const actions = () => prisma.studyPublicationAction.count({ where: { edition: { collectionId } } });

test("een gewone gebruiker kan niet automatisch publiceren", async () => {
  await assert.rejects(autoPublishCfmVolume(await actor(false), CFM_SOURCE_2026), (e: { code?: string }) => e.code === "FORBIDDEN");
});

test("zonder collectie (nog niet geïmporteerd) publiceert niets en meldt dat", async () => {
  const exists = await prisma.contentCollection.findUnique({ where: { id: collectionId } });
  if (exists) return; // een eerdere run liet de collectie achter; dit pad is dan niet te bereiken
  const report = await autoPublishCfmVolume(await actor(true), CFM_SOURCE_2026);
  assert.equal(report.status, "skipped");
  assert.equal(report.reason, "COLLECTION_MISSING");
});

test("import blijft concept; één geblokkeerde les houdt de rest niet tegen en blijft concept", async () => {
  const admin = await actor(true);
  const imported = await importCfm2026Drafts(admin, options);
  assert.equal(imported.publicationChanged, false);
  assert.equal(imported.importedLessons, 52);
  const editions = await prisma.studyLessonEdition.findMany({ where: { collectionId }, orderBy: { lesson: { order: "asc" } }, include: { lesson: true } });
  assert.equal(editions.length, 52);
  // Een concept waarvan de importrun niet (meer) afgerond is, is technisch niet publiceerbaar: zet de run van één les
  // tijdelijk op FAILED (media en revisies zijn in de database onveranderlijk, de importaudit niet).
  const target = editions.find((e) => e.draftRevisionId && !e.publishedRevisionId);
  assert.ok(target, "na een verse import zijn alle lessen concept");
  const item = await prisma.contentImportItem.findFirstOrThrow({ where: { lessonEditionId: target.id, revisionId: target.draftRevisionId! }, select: { runId: true } });
  await prisma.contentImportRun.update({ where: { id: item.runId }, data: { status: "FAILED" } });
  try {
    const before = await actions();
    const report = await autoPublishCfmVolume(admin, CFM_SOURCE_2026);
    assert.equal(report.status, "partial");
    assert.ok(report.blocked.some((b) => b.sourceKey === target.lesson.sourceKey), "de les met een onafgeronde import is geblokkeerd");
    assert.equal(report.blocked.length, 1, "de overige lessen worden niet door één blokkade tegengehouden");
    assert.equal(report.publishedNow, 51);
    assert.equal(report.released, false, "zonder volledige set geen vrijgave");
    assert.equal((await actions()) - before, 51);
    const still = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(still.publishedRevisionId, null, "de geblokkeerde les is niet gepubliceerd");
    assert.equal(still.draftRevisionId, target.draftRevisionId, "en blijft concept");
    assert.equal((await prisma.contentCollection.findUniqueOrThrow({ where: { id: collectionId } })).publicationState, "DRAFT");
  } finally {
    await prisma.contentImportRun.update({ where: { id: item.runId }, data: { status: "DRAFT_READY" } });
  }
});

test("hervatten publiceert de rest; zichtbaarheid blijft uit en bekende onoplosbare verwijzingen blokkeren niet", async () => {
  const admin = await actor(true);
  const report = await autoPublishCfmVolume(admin, CFM_SOURCE_2026);
  assert.equal(report.status, "done", JSON.stringify({ blocked: report.blocked, failed: report.failed }));
  assert.equal(report.total, 52);
  assert.equal(report.publishedNow, 1, "alleen de eerder geblokkeerde les moet nog");
  assert.equal(report.alreadyPublished, 51);
  assert.equal(report.released, true, "volledige set: inhoudelijke vrijgave van de collectie");
  assert.equal(report.references.blocking, 0);
  assert.equal(report.references.verified + report.references.displayOnly, report.references.total, "elke verwijzing is bewezen of een veilige tekst");
  const collection = await prisma.contentCollection.findUniqueOrThrow({ where: { id: collectionId } });
  assert.equal(collection.visibleToUsers, false, "publicatie is geen zichtbaarheid");
  assert.equal(collection.publicationState, "PUBLISHED");
  assert.equal(await prisma.studyLessonEdition.count({ where: { collectionId, publishedRevisionId: null } }), 0);
});

test("herhalen is idempotent: geen nieuwe publicaties, geen nieuwe audit, geen wijziging van zichtbaarheid", async () => {
  const admin = await actor(true);
  const before = await actions();
  const second = await autoPublishCfmVolume(admin, CFM_SOURCE_2026);
  assert.equal(second.publishedNow, 0);
  assert.equal(second.status, "done");
  assert.equal(await actions(), before);
  // Een tweede import van dezelfde pinned bron levert geen nieuwe revisies of lessen op en verandert de publicatie niet.
  const revisions = await prisma.studyRevision.count({ where: { edition: { collectionId } } });
  const results = await importAllCfmDrafts(admin, options);
  assert.ok(results.every((r) => r.ok), "import van alle jaargangen slaagt");
  assert.equal(await prisma.studyRevision.count({ where: { edition: { collectionId } } }), revisions);
  assert.equal(await prisma.studyLessonEdition.count({ where: { collectionId } }), 52);
  assert.equal((await autoPublishCfmVolume(admin, CFM_SOURCE_2026)).publishedNow, 0);
  assert.equal(await actions(), before);
});

test("een gelijktijdige run krijgt BUSY in plaats van te wachten of dubbel te publiceren", async () => {
  const admin = await actor(true);
  const key = `study-program-batch:${collectionId}`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let locked!: () => void;
  const hasLock = new Promise<void>((resolve) => (locked = resolve));
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    locked();
    await held;
  }, { timeout: 30_000 });
  await hasLock;
  try {
    const report = await autoPublishCfmVolume(admin, CFM_SOURCE_2026);
    assert.equal(report.status, "busy");
    assert.equal(report.publishedNow, 0);
  } finally {
    release();
    await holder;
  }
});
